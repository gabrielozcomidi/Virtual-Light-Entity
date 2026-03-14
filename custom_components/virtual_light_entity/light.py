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
from homeassistant.helpers.device_registry import DeviceInfo
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
    _attr_name = None  # Use device name as entity name

    def __init__(self, config_entry: ConfigEntry) -> None:
        """Initialize the virtual light."""
        self._config_entry = config_entry
        data = config_entry.data
        light_name = data.get(CONF_LIGHT_NAME, "Virtual Light")

        self._attr_unique_id = config_entry.entry_id

        # Color mode setup — sanitize per HA rules:
        # BRIGHTNESS must not coexist with any other color mode (it's implied).
        # ONOFF must not coexist with any other mode.
        raw_modes = set(data.get(CONF_SUPPORTED_COLOR_MODES, [ColorMode.BRIGHTNESS]))
        color_modes = raw_modes - {ColorMode.BRIGHTNESS, ColorMode.ONOFF}
        if color_modes:
            # Other modes present — brightness is implied, remove it
            self._attr_supported_color_modes = color_modes
        elif ColorMode.BRIGHTNESS in raw_modes:
            self._attr_supported_color_modes = {ColorMode.BRIGHTNESS}
        else:
            self._attr_supported_color_modes = {ColorMode.ONOFF}

        # Effect/animation setup
        effects = data.get(CONF_ANIMATIONS, [])
        if effects:
            self._attr_supported_features = LightEntityFeature.EFFECT | LightEntityFeature.TRANSITION
            self._attr_effect_list = list(effects)
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

        # Set initial color mode — must be one of the supported modes
        self._attr_color_mode = self._pick_initial_color_mode()

        # Color temp range (mireds)
        if ColorMode.COLOR_TEMP in self._attr_supported_color_modes:
            self._attr_min_mireds = 153   # ~6500K
            self._attr_max_mireds = 500   # ~2000K

        # Device info
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, config_entry.entry_id)},
            name=light_name,
            manufacturer="Virtual Light Entity",
            model="Virtual Light",
            sw_version="1.0.0",
        )

        # Animation engine
        self._animation = AnimationEngine(self._animation_update)

    def _pick_initial_color_mode(self) -> ColorMode:
        """Pick an initial color mode from supported modes."""
        modes = self._attr_supported_color_modes
        for preferred in (
            ColorMode.HS,
            ColorMode.RGB,
            ColorMode.RGBW,
            ColorMode.RGBWW,
            ColorMode.XY,
            ColorMode.COLOR_TEMP,
            ColorMode.BRIGHTNESS,
            ColorMode.ONOFF,
        ):
            if preferred in modes:
                return preferred
        return ColorMode.UNKNOWN

    def _animation_update(self) -> None:
        """Handle animation state update."""
        state = self._animation.get_state()
        if not state or not self._attr_is_on:
            return

        if "brightness" in state:
            self._attr_brightness = state["brightness"]

        modes = self._attr_supported_color_modes

        if "rgb_color" in state:
            if ColorMode.RGB in modes:
                self._attr_rgb_color = state["rgb_color"]
                self._attr_color_mode = ColorMode.RGB
            elif ColorMode.HS in modes:
                # Convert RGB to HS for entities that only support HS
                r, g, b = state["rgb_color"]
                import colorsys
                h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
                self._attr_hs_color = (h * 360, s * 100)
                self._attr_color_mode = ColorMode.HS

        if "hs_color" in state:
            if ColorMode.HS in modes:
                hs = state["hs_color"]
                self._attr_hs_color = (hs[0], hs[1])
                self._attr_color_mode = ColorMode.HS
            elif ColorMode.RGB in modes:
                # Convert HS to RGB for entities that only support RGB
                import colorsys
                h, s = state["hs_color"]
                r, g, b = colorsys.hsv_to_rgb(h / 360, s / 100, 1.0)
                self._attr_rgb_color = (int(r * 255), int(g * 255), int(b * 255))
                self._attr_color_mode = ColorMode.RGB

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

        # Sanitize color modes the same way as __init__
        raw_modes = set(data.get(CONF_SUPPORTED_COLOR_MODES, [ColorMode.BRIGHTNESS]))
        color_modes = raw_modes - {ColorMode.BRIGHTNESS, ColorMode.ONOFF}
        if color_modes:
            self._attr_supported_color_modes = color_modes
        elif ColorMode.BRIGHTNESS in raw_modes:
            self._attr_supported_color_modes = {ColorMode.BRIGHTNESS}
        else:
            self._attr_supported_color_modes = {ColorMode.ONOFF}

        effects = data.get(CONF_ANIMATIONS, [])
        if effects:
            self._attr_supported_features = LightEntityFeature.EFFECT | LightEntityFeature.TRANSITION
            self._attr_effect_list = list(effects)
        else:
            self._attr_supported_features = LightEntityFeature.TRANSITION
            self._attr_effect_list = []

        if ColorMode.COLOR_TEMP in self._attr_supported_color_modes:
            self._attr_min_mireds = 153
            self._attr_max_mireds = 500

        # Ensure current color_mode is still valid
        if self._attr_color_mode not in self._attr_supported_color_modes:
            self._attr_color_mode = self._pick_initial_color_mode()

        self.async_write_ha_state()
