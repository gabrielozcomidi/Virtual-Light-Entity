"""Constants for the Virtual Light Entity integration."""

from homeassistant.components.light import ColorMode

DOMAIN = "virtual_light_entity"
PLATFORMS = ["light"]

# Config keys
CONF_LIGHT_NAME = "light_name"
CONF_SUPPORTED_COLOR_MODES = "supported_color_modes"
CONF_ANIMATIONS = "animations"
CONF_INITIAL_STATE = "initial_state"
CONF_INITIAL_BRIGHTNESS = "initial_brightness"

# Default values
DEFAULT_INITIAL_STATE = False
DEFAULT_INITIAL_BRIGHTNESS = 255

# Available color modes for UI selection
COLOR_MODE_OPTIONS = {
    ColorMode.BRIGHTNESS: "Brightness (dimmable white)",
    ColorMode.COLOR_TEMP: "Color Temperature (warm to cool white)",
    ColorMode.HS: "HS Color (Hue & Saturation)",
    ColorMode.RGB: "RGB Color",
    ColorMode.RGBW: "RGBW Color (RGB + White)",
    ColorMode.RGBWW: "RGBWW Color (RGB + Warm/Cool White)",
    ColorMode.XY: "XY Color (CIE 1931)",
}

# Animation effects
EFFECT_CANDLE = "Candle Flicker"
EFFECT_BREATHING = "Breathing"
EFFECT_COLOR_LOOP = "Color Loop"
EFFECT_RAINBOW = "Rainbow Cycle"
EFFECT_STROBE = "Strobe"
EFFECT_SUNRISE = "Sunrise"
EFFECT_SUNSET = "Sunset"
EFFECT_PARTY = "Party Mode"
EFFECT_FIREPLACE = "Fireplace"
EFFECT_OCEAN = "Ocean Wave"
EFFECT_AURORA = "Aurora"

ALL_EFFECTS = [
    EFFECT_CANDLE,
    EFFECT_BREATHING,
    EFFECT_COLOR_LOOP,
    EFFECT_RAINBOW,
    EFFECT_STROBE,
    EFFECT_SUNRISE,
    EFFECT_SUNSET,
    EFFECT_PARTY,
    EFFECT_FIREPLACE,
    EFFECT_OCEAN,
    EFFECT_AURORA,
]

# Animation timing (seconds)
ANIMATION_STEP_INTERVAL = 0.1
