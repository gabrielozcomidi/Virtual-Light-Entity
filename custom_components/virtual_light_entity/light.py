"""Light platform for Virtual Light Entity integration."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.light import (
    ATTR_BRIGHTNESS,
    ATTR_COLOR_TEMP,
    ATTR_EFFECT,
    ATTR_HS_COLOR,
    ATTR_RGB_COLOR,
    ATTR_RGBW_COLOR,
    ATTR_RGBWW_COLOR,
    ATTR_TRANSITION,
    ATTR_XY_COLOR,
    ColorMode,
    LightEntity,
    LightEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .animations import AnimationEngine
from .const import (
    DOMAIN,
    CONF_LIGHT_NAME,
    CONF_SUPPORTED_COLOR_MODES,
    CONF_ANIMATIONS,
    CONF_INITIAL_STATE,
    CONF_INITIAL_BRIGHTNESS,
    DEFAULT_INITIAL_STATE,
    DEFAULT_INITIAL_BRIGHTNESS,
)

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Virtual Light from a config entry."""
    async_add_entities([VirtualLight(config_entry)])


class VirtualLight(LightEntity, RestoreEntity):
    """Representation of a Virtual Light."""

    _attr_has_entity_name = True

    def __init__(self, config_entry: ConfigEntry) -> None:
        """Initialize the virtual light."""
        self._config_entry = config_entry
        data = config_entry.data

        self._attr_unique_id = config_entry.entry_id
        self._attr_name = data.get(CONF_LIGHT_NAME, "Virtual Light")

        # Color mode setup
        raw_modes = data.get(CONF_SUPPORTED_COLOR_MODES, [ColorMode.BRIGHTNESS])
        self._attr_supported_color_modes = set(raw_modes)

        # If no color modes selected, default to brightness
        if not self._attr_supported_color_modes:
            self._attr_supported_color_modes = {ColorMode.BRIGHTNESS}

        # Effect/animation setup
        effects = data.get(CONF_ANIMATIONS, [])
        if effects:
            self._attr_supported_features = LightEntityFeature.EFFECT | LightEntityFeature.TRANSITION
            self._attr_effect_list = effects
        else:
            self._attr_supported_features = LightEntityFeature.TRANSITION
            self._attr_effect_list = []

        # State defaults
        self._attr_is_on = data.get(CONF_INITIAL_STATE, DEFAULT_INITIAL_STATE)
        self._attr_brightness = data.get(CONF_INITIAL_BRIGHTNESS, DEFAULT_INITIAL_BRIGHTNESS)
        self._attr_color_temp = None
        self._attr_hs_color = None
        self._attr_rgb_color = None
        self._attr_rgbw_color = None
        self._attr_rgbww_color = None
        self._attr_xy_color = None
        self._attr_effect = None

        # Set initial color mode
        modes = self._attr_supported_color_modes
        if ColorMode.HS in modes:
            self._attr_color_mode = ColorMode.HS
        elif ColorMode.RGB in modes:
            self._attr_color_mode = ColorMode.RGB
        elif ColorMode.RGBW in modes:
            self._attr_color_mode = ColorMode.RGBW
        elif ColorMode.RGBWW in modes:
            self._attr_color_mode = ColorMode.RGBWW
        elif ColorMode.XY in modes:
            self._attr_color_mode = ColorMode.XY
        elif ColorMode.COLOR_TEMP in modes:
            self._attr_color_mode = ColorMode.COLOR_TEMP
        else:
            self._attr_color_mode = ColorMode.BRIGHTNESS

        # Color temp range (mireds)
        if ColorMode.COLOR_TEMP in modes:
            self._attr_min_mireds = 153   # ~6500K
            self._attr_max_mireds = 500   # ~2000K

        # Device info
        self._attr_device_info = {
            "identifiers": {(DOMAIN, config_entry.entry_id)},
            "name": data.get(CONF_LIGHT_NAME, "Virtual Light"),
            "manufacturer": "Virtual Light Entity",
            "model": "Virtual Light",
            "sw_version": "1.0.0",
        }

        # Animation engine
        self._animation = AnimationEngine(self._animation_update)

    def _animation_update(self) -> None:
        """Handle animation state update."""
        state = self._animation.get_state()
        if not state or not self._attr_is_on:
            return

        if "brightness" in state:
            self._attr_brightness = state["brightness"]
        if "rgb_color" in state:
            self._attr_rgb_color = state["rgb_color"]
            self._attr_color_mode = ColorMode.RGB
        if "hs_color" in state:
            hs = state["hs_color"]
            self._attr_hs_color = (hs[0], hs[1])
            self._attr_color_mode = ColorMode.HS

        self.async_write_ha_state()

    async def async_added_to_hass(self) -> None:
        """Restore last state when added to hass."""
        await super().async_added_to_hass()

        last_state = await self.async_get_last_state()
        if last_state is None:
            return

        self._attr_is_on = last_state.state == "on"
        attrs = last_state.attributes

        if ATTR_BRIGHTNESS in attrs and attrs[ATTR_BRIGHTNESS] is not None:
            self._attr_brightness = attrs[ATTR_BRIGHTNESS]
        if ATTR_COLOR_TEMP in attrs and attrs[ATTR_COLOR_TEMP] is not None:
            self._attr_color_temp = attrs[ATTR_COLOR_TEMP]
        if ATTR_HS_COLOR in attrs and attrs[ATTR_HS_COLOR] is not None:
            self._attr_hs_color = tuple(attrs[ATTR_HS_COLOR])
        if ATTR_RGB_COLOR in attrs and attrs[ATTR_RGB_COLOR] is not None:
            self._attr_rgb_color = tuple(attrs[ATTR_RGB_COLOR])
        if ATTR_RGBW_COLOR in attrs and attrs[ATTR_RGBW_COLOR] is not None:
            self._attr_rgbw_color = tuple(attrs[ATTR_RGBW_COLOR])
        if ATTR_RGBWW_COLOR in attrs and attrs[ATTR_RGBWW_COLOR] is not None:
            self._attr_rgbww_color = tuple(attrs[ATTR_RGBWW_COLOR])
        if ATTR_XY_COLOR in attrs and attrs[ATTR_XY_COLOR] is not None:
            self._attr_xy_color = tuple(attrs[ATTR_XY_COLOR])
        if ATTR_EFFECT in attrs and attrs[ATTR_EFFECT] is not None:
            self._attr_effect = attrs[ATTR_EFFECT]

        # Determine color mode from restored state
        if self._attr_hs_color and ColorMode.HS in self._attr_supported_color_modes:
            self._attr_color_mode = ColorMode.HS
        elif self._attr_rgb_color and ColorMode.RGB in self._attr_supported_color_modes:
            self._attr_color_mode = ColorMode.RGB
        elif self._attr_color_temp and ColorMode.COLOR_TEMP in self._attr_supported_color_modes:
            self._attr_color_mode = ColorMode.COLOR_TEMP

    async def async_will_remove_from_hass(self) -> None:
        """Stop animations when entity is removed."""
        self._animation.stop()

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Turn on the virtual light."""
        self._attr_is_on = True

        if ATTR_BRIGHTNESS in kwargs:
            self._attr_brightness = kwargs[ATTR_BRIGHTNESS]

        if ATTR_COLOR_TEMP in kwargs:
            self._attr_color_temp = kwargs[ATTR_COLOR_TEMP]
            self._attr_color_mode = ColorMode.COLOR_TEMP
            # Clear other color attrs when switching to color temp
            self._attr_hs_color = None
            self._attr_rgb_color = None
            self._attr_rgbw_color = None
            self._attr_rgbww_color = None
            self._attr_xy_color = None

        if ATTR_HS_COLOR in kwargs:
            self._attr_hs_color = kwargs[ATTR_HS_COLOR]
            self._attr_color_mode = ColorMode.HS
            self._attr_color_temp = None

        if ATTR_RGB_COLOR in kwargs:
            self._attr_rgb_color = kwargs[ATTR_RGB_COLOR]
            self._attr_color_mode = ColorMode.RGB
            self._attr_color_temp = None

        if ATTR_RGBW_COLOR in kwargs:
            self._attr_rgbw_color = kwargs[ATTR_RGBW_COLOR]
            self._attr_color_mode = ColorMode.RGBW
            self._attr_color_temp = None

        if ATTR_RGBWW_COLOR in kwargs:
            self._attr_rgbww_color = kwargs[ATTR_RGBWW_COLOR]
            self._attr_color_mode = ColorMode.RGBWW
            self._attr_color_temp = None

        if ATTR_XY_COLOR in kwargs:
            self._attr_xy_color = kwargs[ATTR_XY_COLOR]
            self._attr_color_mode = ColorMode.XY
            self._attr_color_temp = None

        if ATTR_EFFECT in kwargs:
            effect = kwargs[ATTR_EFFECT]
            if effect and effect in (self._attr_effect_list or []):
                self._attr_effect = effect
                self._animation.start(effect)
            else:
                self._attr_effect = None
                self._animation.stop()
        elif any(k in kwargs for k in (ATTR_BRIGHTNESS, ATTR_COLOR_TEMP, ATTR_HS_COLOR,
                                        ATTR_RGB_COLOR, ATTR_RGBW_COLOR, ATTR_RGBWW_COLOR,
                                        ATTR_XY_COLOR)):
            # Stop animation if user manually changes a light attribute
            if self._animation.current_effect:
                self._attr_effect = None
                self._animation.stop()

        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Turn off the virtual light."""
        self._attr_is_on = False
        self._animation.stop()
        self._attr_effect = None
        self.async_write_ha_state()

    async def async_update_from_options(self) -> None:
        """Update entity when options change."""
        data = self._config_entry.data

        self._attr_name = data.get(CONF_LIGHT_NAME, "Virtual Light")

        raw_modes = data.get(CONF_SUPPORTED_COLOR_MODES, [ColorMode.BRIGHTNESS])
        self._attr_supported_color_modes = set(raw_modes)
        if not self._attr_supported_color_modes:
            self._attr_supported_color_modes = {ColorMode.BRIGHTNESS}

        effects = data.get(CONF_ANIMATIONS, [])
        if effects:
            self._attr_supported_features = LightEntityFeature.EFFECT | LightEntityFeature.TRANSITION
            self._attr_effect_list = effects
        else:
            self._attr_supported_features = LightEntityFeature.TRANSITION
            self._attr_effect_list = []

        if ColorMode.COLOR_TEMP in self._attr_supported_color_modes:
            self._attr_min_mireds = 153
            self._attr_max_mireds = 500

        self.async_write_ha_state()
