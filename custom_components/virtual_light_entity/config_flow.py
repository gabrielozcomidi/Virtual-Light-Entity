"""Config flow for Virtual Light Entity integration."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, OptionsFlow, ConfigEntry
from homeassistant.core import callback
from homeassistant.data_entry_flow import FlowResult
from homeassistant.components.light import ColorMode
from homeassistant.helpers import selector

from .const import (
    DOMAIN,
    CONF_LIGHT_NAME,
    CONF_SUPPORTED_COLOR_MODES,
    CONF_ANIMATIONS,
    CONF_INITIAL_STATE,
    CONF_INITIAL_BRIGHTNESS,
    COLOR_MODE_OPTIONS,
    ALL_EFFECTS,
    DEFAULT_INITIAL_STATE,
    DEFAULT_INITIAL_BRIGHTNESS,
    CONF_ANIM_SELECT,
    CUSTOM_EFFECT_PREFIX,
    DATA_STORE,
)


class VirtualLightConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Virtual Light Entity."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialize the config flow."""
        self._data: dict[str, Any] = {}

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Step 1: Name and initial state."""
        if user_input is not None:
            self._data.update(user_input)
            return await self.async_step_color_modes()

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_LIGHT_NAME): selector.TextSelector(
                        selector.TextSelectorConfig(type=selector.TextSelectorType.TEXT)
                    ),
                    vol.Optional(
                        CONF_INITIAL_STATE, default=DEFAULT_INITIAL_STATE
                    ): selector.BooleanSelector(),
                    vol.Optional(
                        CONF_INITIAL_BRIGHTNESS, default=DEFAULT_INITIAL_BRIGHTNESS
                    ): selector.NumberSelector(
                        selector.NumberSelectorConfig(
                            min=1, max=255, step=1, mode=selector.NumberSelectorMode.SLIDER
                        )
                    ),
                }
            ),
        )

    async def async_step_color_modes(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Step 2: Select supported color modes."""
        if user_input is not None:
            selected = user_input.get(CONF_SUPPORTED_COLOR_MODES, [])
            if not selected:
                selected = [ColorMode.BRIGHTNESS]
            self._data[CONF_SUPPORTED_COLOR_MODES] = selected
            return await self.async_step_animations()

        color_mode_options = [
            selector.SelectOptionDict(value=mode, label=label)
            for mode, label in COLOR_MODE_OPTIONS.items()
        ]

        return self.async_show_form(
            step_id="color_modes",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        CONF_SUPPORTED_COLOR_MODES,
                        default=[ColorMode.BRIGHTNESS, ColorMode.COLOR_TEMP, ColorMode.HS],
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=color_mode_options,
                            multiple=True,
                            mode=selector.SelectSelectorMode.LIST,
                        )
                    ),
                }
            ),
        )

    async def async_step_animations(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Step 3: Select animations."""
        if user_input is not None:
            self._data[CONF_ANIMATIONS] = user_input.get(CONF_ANIMATIONS, [])
            return self.async_create_entry(
                title=self._data[CONF_LIGHT_NAME],
                data=self._data,
            )

        effect_options = [
            selector.SelectOptionDict(value=effect, label=effect)
            for effect in ALL_EFFECTS
        ]

        return self.async_show_form(
            step_id="animations",
            data_schema=vol.Schema(
                {
                    vol.Optional(
                        CONF_ANIMATIONS, default=ALL_EFFECTS
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=effect_options,
                            multiple=True,
                            mode=selector.SelectSelectorMode.LIST,
                        )
                    ),
                }
            ),
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> VirtualLightOptionsFlow:
        """Get the options flow for this handler."""
        return VirtualLightOptionsFlow(config_entry)


class VirtualLightOptionsFlow(OptionsFlow):
    """Handle options flow for Virtual Light Entity."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        """Initialize options flow."""
        self._config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Show the main options menu."""
        return self.async_show_menu(
            step_id="init",
            menu_options=[
                "light_settings",
                "delete_animation",
            ],
        )

    # --- Light settings ---

    async def async_step_light_settings(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Manage light entity settings."""
        if user_input is not None:
            new_data = {**self._config_entry.data, **user_input}
            self.hass.config_entries.async_update_entry(
                self._config_entry, data=new_data
            )
            return self.async_create_entry(title="", data={})

        current = self._config_entry.data

        # Build effect list including custom animations
        effect_options = [
            selector.SelectOptionDict(value=effect, label=effect)
            for effect in ALL_EFFECTS
        ]
        store = self.hass.data.get(DOMAIN, {}).get(DATA_STORE)
        if store:
            for name in store.get_animation_names():
                display_name = f"{CUSTOM_EFFECT_PREFIX}{name}"
                effect_options.append(
                    selector.SelectOptionDict(value=display_name, label=display_name)
                )

        color_mode_options = [
            selector.SelectOptionDict(value=mode, label=label)
            for mode, label in COLOR_MODE_OPTIONS.items()
        ]

        return self.async_show_form(
            step_id="light_settings",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_LIGHT_NAME,
                        default=current.get(CONF_LIGHT_NAME, ""),
                    ): selector.TextSelector(
                        selector.TextSelectorConfig(type=selector.TextSelectorType.TEXT)
                    ),
                    vol.Optional(
                        CONF_SUPPORTED_COLOR_MODES,
                        default=current.get(
                            CONF_SUPPORTED_COLOR_MODES,
                            [ColorMode.BRIGHTNESS],
                        ),
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=color_mode_options,
                            multiple=True,
                            mode=selector.SelectSelectorMode.LIST,
                        )
                    ),
                    vol.Optional(
                        CONF_ANIMATIONS,
                        default=current.get(CONF_ANIMATIONS, ALL_EFFECTS),
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=effect_options,
                            multiple=True,
                            mode=selector.SelectSelectorMode.LIST,
                        )
                    ),
                    vol.Optional(
                        CONF_INITIAL_BRIGHTNESS,
                        default=current.get(CONF_INITIAL_BRIGHTNESS, DEFAULT_INITIAL_BRIGHTNESS),
                    ): selector.NumberSelector(
                        selector.NumberSelectorConfig(
                            min=1, max=255, step=1, mode=selector.NumberSelectorMode.SLIDER
                        )
                    ),
                }
            ),
        )

    # --- Delete custom animation ---

    async def async_step_delete_animation(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Delete a custom animation."""
        store = self.hass.data.get(DOMAIN, {}).get(DATA_STORE)
        if store is None:
            return self.async_abort(reason="store_not_available")

        names = store.get_animation_names()
        if not names:
            return self.async_abort(reason="no_custom_animations")

        if user_input is not None:
            selected = user_input.get(CONF_ANIM_SELECT)
            if selected:
                await store.async_delete_animation(selected)
            return self.async_create_entry(title="", data={})

        anim_options = [
            selector.SelectOptionDict(value=name, label=f"{CUSTOM_EFFECT_PREFIX}{name}")
            for name in names
        ]

        return self.async_show_form(
            step_id="delete_animation",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ANIM_SELECT): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=anim_options,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        )
                    ),
                }
            ),
        )
