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
    CONF_ANIM_NAME,
    CONF_ANIM_LOOP,
    CONF_ANIM_KF_RGB,
    CONF_ANIM_KF_BRIGHTNESS,
    CONF_ANIM_KF_DURATION,
    CONF_ANIM_KF_TRANSITION,
    CONF_ANIM_ADD_MORE,
    CONF_ANIM_SELECT,
    TRANSITION_LINEAR,
    TRANSITION_EASE,
    TRANSITION_OPTIONS,
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
        self._anim_name: str = ""
        self._anim_loop: bool = True
        self._anim_keyframes: list[dict[str, Any]] = []

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Show the main options menu."""
        return self.async_show_menu(
            step_id="init",
            menu_options=[
                "light_settings",
                "create_animation",
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

    # --- Create custom animation ---

    async def async_step_create_animation(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Step 1 of animation designer: name and loop setting."""
        errors: dict[str, str] = {}

        if user_input is not None:
            name = user_input[CONF_ANIM_NAME].strip()

            # Check for name conflicts with built-in effects
            if name in ALL_EFFECTS or f"{CUSTOM_EFFECT_PREFIX}{name}" in ALL_EFFECTS:
                errors[CONF_ANIM_NAME] = "name_conflict"
            elif not name:
                errors[CONF_ANIM_NAME] = "name_empty"
            else:
                self._anim_name = name
                self._anim_loop = user_input.get(CONF_ANIM_LOOP, True)
                self._anim_keyframes = []
                return await self.async_step_add_keyframe()

        return self.async_show_form(
            step_id="create_animation",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ANIM_NAME): selector.TextSelector(
                        selector.TextSelectorConfig(type=selector.TextSelectorType.TEXT)
                    ),
                    vol.Optional(
                        CONF_ANIM_LOOP, default=True
                    ): selector.BooleanSelector(),
                }
            ),
            errors=errors,
        )

    async def async_step_add_keyframe(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Add a keyframe to the animation."""
        if user_input is not None:
            # Parse the RGB color value
            rgb_hex = user_input.get(CONF_ANIM_KF_RGB, "#ffffff")
            rgb = _hex_to_rgb(rgb_hex)

            keyframe = {
                "rgb": list(rgb),
                "brightness": int(user_input.get(CONF_ANIM_KF_BRIGHTNESS, 255)),
                "duration": float(user_input.get(CONF_ANIM_KF_DURATION, 1.0)),
                "transition": user_input.get(CONF_ANIM_KF_TRANSITION, TRANSITION_LINEAR),
            }
            self._anim_keyframes.append(keyframe)

            add_more = user_input.get(CONF_ANIM_ADD_MORE, False)
            if add_more:
                return await self.async_step_add_keyframe()

            # Save the animation
            return await self._async_save_animation()

        kf_num = len(self._anim_keyframes) + 1
        transition_options = [
            selector.SelectOptionDict(value=val, label=label)
            for val, label in TRANSITION_OPTIONS.items()
        ]

        return self.async_show_form(
            step_id="add_keyframe",
            description_placeholders={
                "name": self._anim_name,
                "keyframe_num": str(kf_num),
            },
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_ANIM_KF_RGB, default="#ffffff"
                    ): selector.ColorRGBSelector(),
                    vol.Required(
                        CONF_ANIM_KF_BRIGHTNESS, default=255
                    ): selector.NumberSelector(
                        selector.NumberSelectorConfig(
                            min=1, max=255, step=1, mode=selector.NumberSelectorMode.SLIDER
                        )
                    ),
                    vol.Required(
                        CONF_ANIM_KF_DURATION, default=1.0
                    ): selector.NumberSelector(
                        selector.NumberSelectorConfig(
                            min=0.1, max=60.0, step=0.1,
                            unit_of_measurement="seconds",
                            mode=selector.NumberSelectorMode.BOX,
                        )
                    ),
                    vol.Required(
                        CONF_ANIM_KF_TRANSITION, default=TRANSITION_LINEAR
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=transition_options,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        )
                    ),
                    vol.Required(
                        CONF_ANIM_ADD_MORE, default=True
                    ): selector.BooleanSelector(),
                }
            ),
        )

    async def _async_save_animation(self) -> FlowResult:
        """Save the custom animation to the shared store."""
        store = self.hass.data.get(DOMAIN, {}).get(DATA_STORE)
        if store is None:
            return self.async_abort(reason="store_not_available")

        animation_data = {
            "loop": self._anim_loop,
            "keyframes": self._anim_keyframes,
        }

        await store.async_add_animation(self._anim_name, animation_data)

        # Reset state
        self._anim_name = ""
        self._anim_keyframes = []

        return self.async_create_entry(title="", data={})

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


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    """Convert hex color string to RGB tuple."""
    hex_color = hex_color.lstrip("#")
    if len(hex_color) != 6:
        return (255, 255, 255)
    return (
        int(hex_color[0:2], 16),
        int(hex_color[2:4], 16),
        int(hex_color[4:6], 16),
    )
