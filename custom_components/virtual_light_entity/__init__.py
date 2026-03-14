"""Virtual Light Entity integration for Home Assistant."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import frontend, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, callback
import homeassistant.helpers.config_validation as cv

from .const import DOMAIN, PLATFORMS, DATA_STORE

_LOGGER = logging.getLogger(__name__)

PANEL_URL = "/virtual_light_entity/animation-editor-panel.js"
PANEL_PATH = str(Path(__file__).parent / "frontend" / "animation-editor-card.js")
PANEL_NAME = "vle-animation-editor-panel"
PANEL_TITLE = "Animation Editor"
PANEL_ICON = "mdi:palette-advanced"
PANEL_FRONTEND_PATH = "virtual-light-editor"

# Track whether global setup has been done
DATA_SETUP_DONE = "setup_done"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Virtual Light Entity from a config entry."""
    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = entry.data

    # One-time global setup: store, services, frontend panel, websocket
    if not hass.data[DOMAIN].get(DATA_SETUP_DONE):
        await _async_global_setup(hass)
        hass.data[DOMAIN][DATA_SETUP_DONE] = True

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    return True


async def _async_global_setup(hass: HomeAssistant) -> None:
    """Perform one-time setup: store, services, sidebar panel, websocket API."""
    from .store import AnimationStore

    # Animation store
    if DATA_STORE not in hass.data[DOMAIN]:
        store = AnimationStore(hass)
        await store.async_load()
        hass.data[DOMAIN][DATA_STORE] = store

    # Serve the panel JS file
    await hass.http.async_register_static_paths(
        [StaticPathConfig(PANEL_URL, PANEL_PATH, cache_headers=False)]
    )

    # Register sidebar panel
    frontend.async_register_built_in_panel(
        hass,
        component_name="custom",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        frontend_url_path=PANEL_FRONTEND_PATH,
        config={
            "_panel_custom": {
                "name": PANEL_NAME,
                "module_url": PANEL_URL,
            }
        },
        require_admin=False,
    )

    # Register websocket commands
    websocket_api.async_register_command(hass, ws_list_animations)
    websocket_api.async_register_command(hass, ws_get_animation)

    # Register services
    await _register_services(hass)


async def _register_services(hass: HomeAssistant) -> None:
    """Register animation management services."""

    async def handle_save_animation(call: ServiceCall) -> None:
        """Save a custom animation."""
        store = hass.data.get(DOMAIN, {}).get(DATA_STORE)
        if store is None:
            _LOGGER.error("Animation store not available")
            return

        name = call.data["name"]
        animation_data = {
            "loop": call.data.get("loop", True),
            "steps": call.data.get("steps", []),
        }
        await store.async_add_animation(name, animation_data)
        _LOGGER.info("Saved animation: %s", name)

    async def handle_delete_animation(call: ServiceCall) -> None:
        """Delete a custom animation."""
        store = hass.data.get(DOMAIN, {}).get(DATA_STORE)
        if store is None:
            _LOGGER.error("Animation store not available")
            return

        name = call.data["name"]
        deleted = await store.async_delete_animation(name)
        if deleted:
            _LOGGER.info("Deleted animation: %s", name)
        else:
            _LOGGER.warning("Animation not found: %s", name)

    hass.services.async_register(
        DOMAIN,
        "save_animation",
        handle_save_animation,
        schema=vol.Schema(
            {
                vol.Required("name"): cv.string,
                vol.Optional("loop", default=True): cv.boolean,
                vol.Optional("steps", default=[]): vol.All(
                    cv.ensure_list,
                    [
                        vol.Any(
                            vol.Schema(
                                {
                                    vol.Required("type"): "keyframe",
                                    vol.Required("rgb"): vol.All(
                                        cv.ensure_list, [vol.Coerce(int)]
                                    ),
                                    vol.Required("brightness"): vol.All(
                                        vol.Coerce(int), vol.Range(min=1, max=255)
                                    ),
                                    vol.Required("duration"): vol.All(
                                        vol.Coerce(float), vol.Range(min=0.1, max=30)
                                    ),
                                }
                            ),
                            vol.Schema(
                                {
                                    vol.Required("type"): "transition",
                                    vol.Required("style"): vol.In(["solid", "fade"]),
                                    vol.Optional("duration", default=0): vol.All(
                                        vol.Coerce(float), vol.Range(min=0, max=30)
                                    ),
                                    vol.Optional("easing", default="ease-in-out"): vol.In(
                                        ["linear", "ease-in", "ease-out", "ease-in-out"]
                                    ),
                                }
                            ),
                        )
                    ],
                ),
            }
        ),
    )

    hass.services.async_register(
        DOMAIN,
        "delete_animation",
        handle_delete_animation,
        schema=vol.Schema({vol.Required("name"): cv.string}),
    )


# --- Websocket API ---


@websocket_api.websocket_command(
    {vol.Required("type"): "virtual_light_entity/list_animations"}
)
@callback
def ws_list_animations(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """List all custom animations."""
    store = hass.data.get(DOMAIN, {}).get(DATA_STORE)
    animations = store.get_animation_names() if store else []
    connection.send_result(msg["id"], {"animations": animations})


@websocket_api.websocket_command(
    {
        vol.Required("type"): "virtual_light_entity/get_animation",
        vol.Required("name"): str,
    }
)
@callback
def ws_get_animation(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Get a specific animation's data."""
    store = hass.data.get(DOMAIN, {}).get(DATA_STORE)
    animation = store.get_animation(msg["name"]) if store else None
    if animation:
        connection.send_result(msg["id"], {"animation": animation})
    else:
        connection.send_error(msg["id"], "not_found", "Animation not found")


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)

    return unload_ok


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Handle options update."""
    await hass.config_entries.async_reload(entry.entry_id)
