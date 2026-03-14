"""Animation engine for Virtual Light Entity."""

from __future__ import annotations

import asyncio
import math
import random
import time
from typing import Any, Callable

from .const import (
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
    ANIMATION_STEP_INTERVAL,
)


class AnimationEngine:
    """Manages light animation effects."""

    def __init__(self, update_callback: Callable[[], None]) -> None:
        """Initialize the animation engine."""
        self._update_callback = update_callback
        self._task: asyncio.Task | None = None
        self._running = False
        self._effect: str | None = None
        self._custom_animations: dict[str, dict[str, Any]] = {}

    @property
    def current_effect(self) -> str | None:
        """Return the current effect."""
        return self._effect

    def set_custom_animations(self, animations: dict[str, dict[str, Any]]) -> None:
        """Update available custom animations."""
        self._custom_animations = animations

    def start(self, effect: str) -> None:
        """Start an animation effect."""
        self.stop()
        self._effect = effect
        self._running = True
        self._task = asyncio.ensure_future(self._run(effect))

    def stop(self) -> None:
        """Stop the current animation."""
        self._running = False
        self._effect = None
        if self._task and not self._task.done():
            self._task.cancel()
        self._task = None

    async def _run(self, effect: str) -> None:
        """Run the animation loop."""
        try:
            # Check built-in effects first
            handler = _EFFECT_HANDLERS.get(effect)
            if handler is not None:
                async for state in handler():
                    if not self._running:
                        break
                    self._current_state = state
                    self._update_callback()
                    await asyncio.sleep(ANIMATION_STEP_INTERVAL)
                return

            # Check custom keyframe animations
            custom = self._custom_animations.get(effect)
            if custom is not None:
                async for state in _keyframe_animation(custom):
                    if not self._running:
                        break
                    self._current_state = state
                    self._update_callback()
                    await asyncio.sleep(ANIMATION_STEP_INTERVAL)
        except asyncio.CancelledError:
            pass

    def get_state(self) -> dict[str, Any]:
        """Return the current animation state."""
        return getattr(self, "_current_state", {})


async def _candle_flicker():
    """Simulate candle flicker with warm tones and random brightness."""
    while True:
        brightness = random.randint(120, 255)
        # Warm candle colors: slight variation in warm orange/yellow
        r = random.randint(220, 255)
        g = random.randint(100, 160)
        b = random.randint(10, 40)
        yield {"brightness": brightness, "rgb_color": (r, g, b)}
        await asyncio.sleep(random.uniform(0.05, 0.25))


async def _breathing():
    """Smooth breathing/pulse effect."""
    step = 0
    while True:
        # Sine wave for smooth breathing
        brightness = int(127.5 + 127.5 * math.sin(step * 0.05))
        brightness = max(1, min(255, brightness))
        yield {"brightness": brightness}
        step += 1
        await asyncio.sleep(0)


async def _color_loop():
    """Cycle through all hues smoothly."""
    hue = 0.0
    while True:
        yield {"hs_color": (hue, 100)}
        hue = (hue + 0.5) % 360
        await asyncio.sleep(0)


async def _rainbow():
    """Rainbow cycle with smooth transitions."""
    hue = 0.0
    while True:
        yield {"hs_color": (hue, 100), "brightness": 255}
        hue = (hue + 1.0) % 360
        await asyncio.sleep(0)


async def _strobe():
    """Fast on/off strobe effect."""
    on = True
    while True:
        yield {"brightness": 255 if on else 0}
        on = not on
        await asyncio.sleep(0)


async def _sunrise():
    """Gradual sunrise simulation: dark red to warm white."""
    steps = 600  # 60 seconds at 0.1s interval
    for i in range(steps):
        progress = i / steps
        if progress < 0.3:
            # Deep red to orange
            t = progress / 0.3
            r = int(80 + 175 * t)
            g = int(20 * t)
            b = 0
            brightness = int(10 + 60 * t)
        elif progress < 0.7:
            # Orange to warm yellow
            t = (progress - 0.3) / 0.4
            r = 255
            g = int(20 + 160 * t)
            b = int(40 * t)
            brightness = int(70 + 120 * t)
        else:
            # Warm yellow to daylight
            t = (progress - 0.7) / 0.3
            r = 255
            g = int(180 + 60 * t)
            b = int(40 + 180 * t)
            brightness = int(190 + 65 * t)

        brightness = max(1, min(255, brightness))
        yield {"brightness": brightness, "rgb_color": (r, g, b)}
        await asyncio.sleep(0)

    # Hold at daylight
    while True:
        yield {"brightness": 255, "rgb_color": (255, 240, 220)}
        await asyncio.sleep(1.0)


async def _sunset():
    """Gradual sunset simulation: daylight to warm to dark red."""
    steps = 600
    for i in range(steps):
        progress = i / steps
        if progress < 0.3:
            # Daylight to warm
            t = progress / 0.3
            r = 255
            g = int(240 - 80 * t)
            b = int(220 - 180 * t)
            brightness = int(255 - 65 * t)
        elif progress < 0.7:
            # Warm to deep orange
            t = (progress - 0.3) / 0.4
            r = 255
            g = int(160 - 140 * t)
            b = int(40 - 40 * t)
            brightness = int(190 - 120 * t)
        else:
            # Deep orange to dark red, fade out
            t = (progress - 0.7) / 0.3
            r = int(255 - 175 * t)
            g = int(20 - 20 * t)
            b = 0
            brightness = int(70 - 60 * t)

        brightness = max(1, min(255, brightness))
        yield {"brightness": brightness, "rgb_color": (r, g, b)}
        await asyncio.sleep(0)

    # Hold at near-off
    while True:
        yield {"brightness": 1, "rgb_color": (80, 0, 0)}
        await asyncio.sleep(1.0)


async def _party():
    """Fast random color changes."""
    while True:
        hue = random.uniform(0, 360)
        brightness = random.randint(180, 255)
        yield {"hs_color": (hue, 100), "brightness": brightness}
        await asyncio.sleep(random.uniform(0.1, 0.4))


async def _fireplace():
    """Warm flickering fire simulation."""
    while True:
        brightness = random.randint(140, 240)
        r = random.randint(200, 255)
        g = random.randint(60, 120)
        b = random.randint(0, 20)
        yield {"brightness": brightness, "rgb_color": (r, g, b)}
        await asyncio.sleep(random.uniform(0.08, 0.3))


async def _ocean_wave():
    """Blue-green ocean wave simulation."""
    step = 0
    while True:
        wave = math.sin(step * 0.03)
        brightness = int(100 + 80 * wave)
        r = int(0 + 30 * (wave + 1) / 2)
        g = int(80 + 80 * (wave + 1) / 2)
        b = int(160 + 60 * (wave + 1) / 2)
        brightness = max(1, min(255, brightness))
        yield {"brightness": brightness, "rgb_color": (r, g, b)}
        step += 1
        await asyncio.sleep(0)


async def _aurora():
    """Northern lights simulation with shifting greens and purples."""
    step = 0
    while True:
        # Multiple sine waves for organic movement
        wave1 = math.sin(step * 0.02)
        wave2 = math.sin(step * 0.035 + 2.0)
        wave3 = math.sin(step * 0.015 + 4.0)

        hue = (120 + 80 * wave1 + 40 * wave2) % 360  # Greens to purples
        saturation = 70 + 30 * (wave3 + 1) / 2
        brightness = int(80 + 120 * (wave2 + 1) / 2)
        brightness = max(1, min(255, brightness))

        yield {"hs_color": (hue, saturation), "brightness": brightness}
        step += 1
        await asyncio.sleep(0)


_EFFECT_HANDLERS = {
    EFFECT_CANDLE: _candle_flicker,
    EFFECT_BREATHING: _breathing,
    EFFECT_COLOR_LOOP: _color_loop,
    EFFECT_RAINBOW: _rainbow,
    EFFECT_STROBE: _strobe,
    EFFECT_SUNRISE: _sunrise,
    EFFECT_SUNSET: _sunset,
    EFFECT_PARTY: _party,
    EFFECT_FIREPLACE: _fireplace,
    EFFECT_OCEAN: _ocean_wave,
    EFFECT_AURORA: _aurora,
}


# --- Keyframe + Transition interpolation engine ---


def _ease_in_out(t: float) -> float:
    """Ease in-out curve (smooth acceleration and deceleration)."""
    return t * t * (3.0 - 2.0 * t)


def _ease_in(t: float) -> float:
    """Ease in curve (accelerate)."""
    return t * t


def _ease_out(t: float) -> float:
    """Ease out curve (decelerate)."""
    return t * (2.0 - t)


def _apply_easing(t: float, easing: str) -> float:
    """Apply the specified easing function to a progress value."""
    if easing == "linear":
        return t
    elif easing == "ease-in":
        return _ease_in(t)
    elif easing == "ease-out":
        return _ease_out(t)
    else:  # ease-in-out (default)
        return _ease_in_out(t)


def _interpolate_value(start: float, end: float, t: float) -> float:
    """Linearly interpolate between two values."""
    return start + (end - start) * t


def _interpolate_color(
    start: list[int],
    end: list[int],
    t: float,
) -> tuple[int, int, int]:
    """Interpolate between two RGB colors."""
    return (
        int(_interpolate_value(start[0], end[0], t)),
        int(_interpolate_value(start[1], end[1], t)),
        int(_interpolate_value(start[2], end[2], t)),
    )


async def _keyframe_animation(animation_data: dict[str, Any]):
    """Play a custom animation with keyframe and transition steps.

    Data model:
      steps: [
        {"type": "keyframe", "rgb": [r,g,b], "brightness": N, "duration": secs},
        {"type": "transition", "style": "solid"|"fade", "duration": secs},
        {"type": "keyframe", ...},
        ...
      ]
    """
    steps = animation_data.get("steps", [])
    loop = animation_data.get("loop", True)

    # Extract just the keyframes for reference
    keyframes = [s for s in steps if s["type"] == "keyframe"]
    if not keyframes:
        return

    while True:
        kf_index = 0  # Track which keyframe we're on

        for i, step in enumerate(steps):
            if step["type"] == "keyframe":
                # Hold at this keyframe's color/brightness for its duration
                rgb = tuple(step["rgb"])
                brightness = max(1, min(255, int(step["brightness"])))
                hold_steps = max(1, int(float(step["duration"]) / ANIMATION_STEP_INTERVAL))

                for _ in range(hold_steps):
                    yield {"brightness": brightness, "rgb_color": rgb}
                    await asyncio.sleep(0)

                kf_index += 1

            elif step["type"] == "transition":
                # Find the previous and next keyframe
                prev_kf = None
                next_kf = None

                # Previous keyframe is the last one before this transition
                for j in range(i - 1, -1, -1):
                    if steps[j]["type"] == "keyframe":
                        prev_kf = steps[j]
                        break

                # Next keyframe is the first one after this transition
                for j in range(i + 1, len(steps)):
                    if steps[j]["type"] == "keyframe":
                        next_kf = steps[j]
                        break

                # If looping and no next keyframe, wrap to first keyframe
                if next_kf is None and loop:
                    next_kf = keyframes[0]

                if prev_kf is None or next_kf is None:
                    continue

                style = step.get("style", "solid")

                if style == "solid":
                    # Instant jump — just yield the next keyframe once
                    yield {
                        "brightness": max(1, min(255, int(next_kf["brightness"]))),
                        "rgb_color": tuple(next_kf["rgb"]),
                    }
                    await asyncio.sleep(0)

                elif style == "fade":
                    duration = float(step.get("duration", 1.0))
                    easing = step.get("easing", "ease-in-out")
                    fade_steps = max(1, int(duration / ANIMATION_STEP_INTERVAL))

                    for s in range(fade_steps):
                        t = s / fade_steps
                        t_smooth = _apply_easing(t, easing)

                        brightness = int(
                            _interpolate_value(
                                prev_kf["brightness"],
                                next_kf["brightness"],
                                t_smooth,
                            )
                        )
                        brightness = max(1, min(255, brightness))

                        rgb = _interpolate_color(
                            prev_kf["rgb"],
                            next_kf["rgb"],
                            t_smooth,
                        )

                        yield {"brightness": brightness, "rgb_color": rgb}
                        await asyncio.sleep(0)

        if not loop:
            # Hold last keyframe
            last_kf = keyframes[-1]
            while True:
                yield {
                    "brightness": max(1, min(255, int(last_kf["brightness"]))),
                    "rgb_color": tuple(last_kf["rgb"]),
                }
                await asyncio.sleep(0.5)
            break
