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
    CONF_ANIM_TRANS_STYLE,
    CONF_ANIM_TRANS_DURATION,
    CONF_ANIM_SELECT,
    TRANSITION_SOLID,
    TRANSITION_FADE,
    CUSTOM_EFFECT_PREFIX,
    DATA_STORE,
    MAX_ANIMATION_DURATION,
)


def _build_timeline_summary(steps: list[dict[str, Any]]) -> str:
    """Build a human-readable timeline summary of the animation so far."""
    if not steps:
        return "Timeline is empty. Add your first keyframe."

    lines = []
    total_time = 0.0

    for i, step in enumerate(steps):
        if step["type"] == "keyframe":
            r, g, b = step["rgb"]
            bri = step["brightness"]
            dur = step["duration"]
            lines.append(
                f"  [{i+1}] Keyframe: RGB({r},{g},{b}) "
                f"Brightness {bri} - Hold {dur}s"
            )
            total_time += dur
        elif step["type"] == "transition":
            style = step["style"].capitalize()
            dur = step.get("duration", 0)
            if step["style"] == TRANSITION_SOLID:
                lines.append(f"  [{i+1}] Transition: Instant")
            else:
                lines.append(f"  [{i+1}] Transition: Fade ({dur}s)")
                total_time += dur

    remaining = MAX_ANIMATION_DURATION - total_time
    lines.append(f"\nTotal: {total_time:.1f}s / {MAX_ANIMATION_DURATION:.0f}s "
                 f"({remaining:.1f}s remaining)")
    return "\n".join(lines)


def _total_duration(steps: list[dict[str, Any]]) -> float:
    """Calculate total duration of all steps."""
    total = 0.0
    for step in steps:
        total += step.get("duration", 0)
    return total


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
        self._anim_steps: list[dict[str, Any]] = []

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
        """Step 1: Name and loop setting for the animation."""
        errors: dict[str, str] = {}

        if user_input is not None:
            name = user_input[CONF_ANIM_NAME].strip()
            if name in ALL_EFFECTS or f"{CUSTOM_EFFECT_PREFIX}{name}" in ALL_EFFECTS:
                errors[CONF_ANIM_NAME] = "name_conflict"
            elif not name:
                errors[CONF_ANIM_NAME] = "name_empty"
            else:
                self._anim_name = name
                self._anim_loop = user_input.get(CONF_ANIM_LOOP, True)
                self._anim_steps = []
                return await self.async_step_animation_builder()

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

    async def async_step_animation_builder(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Animation builder menu — add keyframes, transitions, or save."""
        # Determine which options are available
        menu_options = ["add_keyframe"]

        # Can only add transition if last step is a keyframe
        last_is_keyframe = (
            self._anim_steps and self._anim_steps[-1]["type"] == "keyframe"
        )
        if last_is_keyframe:
            menu_options.append("add_transition")

        # Can save if we have at least one keyframe
        has_keyframe = any(s["type"] == "keyframe" for s in self._anim_steps)
        if has_keyframe:
            menu_options.append("save_animation")

        timeline = _build_timeline_summary(self._anim_steps)

        return self.async_show_menu(
            step_id="animation_builder",
            menu_options=menu_options,
            description_placeholders={
                "name": self._anim_name,
                "timeline": timeline,
            },
        )

    async def async_step_add_keyframe(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Add a keyframe step."""
        errors: dict[str, str] = {}
        remaining = MAX_ANIMATION_DURATION - _total_duration(self._anim_steps)

        if user_input is not None:
            duration = float(user_input.get(CONF_ANIM_KF_DURATION, 1.0))
            if duration > remaining:
                errors[CONF_ANIM_KF_DURATION] = "exceeds_max_duration"
            else:
                # ColorRGBSelector returns [r, g, b] as a list of ints
                rgb_value = user_input.get(CONF_ANIM_KF_RGB, [255, 255, 255])
                if isinstance(rgb_value, list):
                    rgb = rgb_value[:3]
                else:
                    rgb = [255, 255, 255]

                keyframe = {
                    "type": "keyframe",
                    "rgb": rgb,
                    "brightness": int(user_input.get(CONF_ANIM_KF_BRIGHTNESS, 255)),
                    "duration": duration,
                }
                self._anim_steps.append(keyframe)
                return await self.async_step_animation_builder()

        max_dur = min(remaining, MAX_ANIMATION_DURATION)

        return self.async_show_form(
            step_id="add_keyframe",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ANIM_KF_RGB): selector.ColorRGBSelector(),
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
                            min=0.1, max=max_dur, step=0.1,
                            unit_of_measurement="seconds",
                            mode=selector.NumberSelectorMode.BOX,
                        )
                    ),
                }
            ),
            errors=errors,
            description_placeholders={
                "remaining": f"{remaining:.1f}",
            },
        )

    async def async_step_add_transition(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Add a transition between keyframes."""
        errors: dict[str, str] = {}
        remaining = MAX_ANIMATION_DURATION - _total_duration(self._anim_steps)

        if user_input is not None:
            style = user_input.get(CONF_ANIM_TRANS_STYLE, TRANSITION_SOLID)
            duration = 0.0

            if style == TRANSITION_FADE:
                duration = float(user_input.get(CONF_ANIM_TRANS_DURATION, 1.0))
                if duration > remaining:
                    errors[CONF_ANIM_TRANS_DURATION] = "exceeds_max_duration"

            if not errors:
                transition = {
                    "type": "transition",
                    "style": style,
                    "duration": duration,
                }
                self._anim_steps.append(transition)
                return await self.async_step_animation_builder()

        transition_options = [
            selector.SelectOptionDict(
                value=TRANSITION_SOLID, label="Solid (instant jump)"
            ),
            selector.SelectOptionDict(
                value=TRANSITION_FADE, label="Fade (smooth blend)"
            ),
        ]

        max_dur = min(remaining, MAX_ANIMATION_DURATION)

        return self.async_show_form(
            step_id="add_transition",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_ANIM_TRANS_STYLE, default=TRANSITION_FADE
                    ): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=transition_options,
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        )
                    ),
                    vol.Optional(
                        CONF_ANIM_TRANS_DURATION, default=1.0
                    ): selector.NumberSelector(
                        selector.NumberSelectorConfig(
                            min=0.1, max=max_dur, step=0.1,
                            unit_of_measurement="seconds",
                            mode=selector.NumberSelectorMode.BOX,
                        )
                    ),
                }
            ),
            errors=errors,
            description_placeholders={
                "remaining": f"{remaining:.1f}",
            },
        )

    async def async_step_save_animation(
        self, user_input: dict[str, Any] | None = None
    ) -> FlowResult:
        """Save the custom animation to the shared store."""
        store = self.hass.data.get(DOMAIN, {}).get(DATA_STORE)
        if store is None:
            return self.async_abort(reason="store_not_available")

        animation_data = {
            "loop": self._anim_loop,
            "steps": self._anim_steps,
        }

        await store.async_add_animation(self._anim_name, animation_data)

        self._anim_name = ""
        self._anim_steps = []

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
