"""Shared storage for custom animations."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

STORAGE_KEY = f"{DOMAIN}.custom_animations"
STORAGE_VERSION = 1


class AnimationStore:
    """Manage shared custom animation storage."""

    def __init__(self, hass: HomeAssistant) -> None:
        """Initialize the store."""
        self._hass = hass
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self._animations: dict[str, dict[str, Any]] = {}
        self._listeners: list[callback] = []

    @property
    def animations(self) -> dict[str, dict[str, Any]]:
        """Return all custom animations."""
        return self._animations

    def get_animation_names(self) -> list[str]:
        """Return list of custom animation names."""
        return list(self._animations.keys())

    def get_animation(self, name: str) -> dict[str, Any] | None:
        """Return a specific animation by name."""
        return self._animations.get(name)

    async def async_load(self) -> None:
        """Load animations from storage."""
        data = await self._store.async_load()
        if data is not None:
            self._animations = data.get("animations", {})
        else:
            self._animations = {}

    async def async_save(self) -> None:
        """Save animations to storage."""
        await self._store.async_save({"animations": self._animations})
        self._notify_listeners()

    async def async_add_animation(
        self, name: str, animation: dict[str, Any]
    ) -> None:
        """Add or update a custom animation."""
        self._animations[name] = animation
        await self.async_save()

    async def async_delete_animation(self, name: str) -> bool:
        """Delete a custom animation. Returns True if it existed."""
        if name in self._animations:
            del self._animations[name]
            await self.async_save()
            return True
        return False

    @callback
    def async_add_listener(self, listener: callback) -> callback:
        """Add a listener for animation changes. Returns remove callback."""
        self._listeners.append(listener)

        @callback
        def remove_listener() -> None:
            self._listeners.remove(listener)

        return remove_listener

    @callback
    def _notify_listeners(self) -> None:
        """Notify all listeners of a change."""
        for listener in self._listeners:
            listener()
