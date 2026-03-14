# Virtual Light Entity for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![GitHub Release](https://img.shields.io/github/v/release/gabrielozcomidi/Virtual-Light-Entity)](https://github.com/gabrielozcomidi/Virtual-Light-Entity/releases)
[![License](https://img.shields.io/github/license/gabrielozcomidi/Virtual-Light-Entity)](LICENSE)

Create fully-featured virtual light entities in Home Assistant — no hardware needed. Build creative dashboards, test automations, or design ambient lighting scenes using software-only lights that behave exactly like real smart bulbs.

Home Assistant's built-in light helper is limited and unintuitive. **Virtual Light Entity** gives you a simple UI wizard to create lights with full color support, brightness control, and **11 built-in animations** — all configurable per entity.

---

## Features

- **Full color mode support** — Brightness, Color Temperature, RGB, RGBW, RGBWW, HS, and XY
- **11 built-in animations** — Candle Flicker, Breathing, Color Loop, Rainbow Cycle, Strobe, Sunrise, Sunset, Party Mode, Fireplace, Ocean Wave, and Aurora
- **3-step setup wizard** — Name your light, pick color modes, choose animations. Done.
- **Reconfigure anytime** — Change settings through the options flow without deleting and recreating
- **State restoration** — Lights remember their state across Home Assistant restarts
- **Per-entity configuration** — Each virtual light can have different capabilities
- **Device registration** — Each light appears as a proper device in the Home Assistant device registry
- **Transition support** — Works with Home Assistant's built-in transition service calls
- **HACS compatible** — Install and update through the Home Assistant Community Store

---

## Installation

### HACS (Recommended)

1. Open **HACS** in your Home Assistant instance
2. Click the three dots in the top right corner and select **Custom repositories**
3. Add `https://github.com/gabrielozcomidi/Virtual-Light-Entity` as an **Integration**
4. Search for **Virtual Light Entity** and click **Install**
5. Restart Home Assistant

### Manual

1. Download the latest release from the [Releases](https://github.com/gabrielozcomidi/Virtual-Light-Entity/releases) page
2. Copy the `custom_components/virtual_light_entity` folder into your Home Assistant `custom_components` directory
3. Restart Home Assistant

---

## Setup

1. Go to **Settings > Devices & Services > Add Integration**
2. Search for **Virtual Light Entity**
3. Follow the 3-step wizard:

### Step 1 — Name & Initial State

| Option | Description |
|---|---|
| **Light Name** | Display name for your virtual light |
| **Start turned on** | Whether the light should be on when first created |
| **Initial Brightness** | Default brightness level (1–255) |

### Step 2 — Color Modes

Select which color modes your virtual light supports. You can pick any combination:

| Mode | Description |
|---|---|
| **Brightness** | Dimmable white light |
| **Color Temperature** | Warm to cool white (153–500 mireds) |
| **HS Color** | Hue & Saturation color control |
| **RGB Color** | Red, Green, Blue color mixing |
| **RGBW Color** | RGB + dedicated White channel |
| **RGBWW Color** | RGB + Warm White + Cool White channels |
| **XY Color** | CIE 1931 color space |

### Step 3 — Animations

Choose which animation effects to enable. These appear in the light's **Effect** dropdown:

| Animation | Description |
|---|---|
| **Candle Flicker** | Warm, randomized flicker simulating a real candle |
| **Breathing** | Smooth sine-wave pulse that fades in and out |
| **Color Loop** | Slowly cycles through all hues |
| **Rainbow Cycle** | Full-brightness rainbow rotation |
| **Strobe** | Fast on/off flash |
| **Sunrise** | 60-second gradual transition from deep red to daylight |
| **Sunset** | 60-second gradual transition from daylight to dark red |
| **Party Mode** | Fast random color and brightness changes |
| **Fireplace** | Warm orange/red flickering fire simulation |
| **Ocean Wave** | Gentle blue-green sine wave |
| **Aurora** | Shifting greens and purples simulating northern lights |

---

## Reconfiguring

To change a virtual light's settings after creation:

1. Go to **Settings > Devices & Services**
2. Find **Virtual Light Entity** and click **Configure** on the light you want to edit
3. Update the name, color modes, animations, or default brightness
4. Click **Submit** — changes apply immediately

---

## Use Cases

- **Dashboard design** — Create ambient light cards that animate and respond to input without needing physical hardware
- **Automation testing** — Test light automations before applying them to real devices
- **Demo environments** — Set up showcase dashboards with fully functional light controls
- **Scene prototyping** — Design and preview lighting scenes before buying hardware
- **Creative displays** — Use animations like Aurora or Ocean Wave as visual elements in wall-mounted dashboards

---

## Example Automations

### Start a sunrise animation at 6:30 AM

```yaml
automation:
  - alias: "Morning Sunrise"
    trigger:
      - platform: time
        at: "06:30:00"
    action:
      - service: light.turn_on
        target:
          entity_id: light.bedroom_virtual
        data:
          effect: "Sunrise"
```

### Set a virtual light to match another light

```yaml
automation:
  - alias: "Mirror Living Room Light"
    trigger:
      - platform: state
        entity_id: light.living_room
    action:
      - service: light.turn_on
        target:
          entity_id: light.virtual_mirror
        data:
          brightness: "{{ state_attr('light.living_room', 'brightness') }}"
          rgb_color: "{{ state_attr('light.living_room', 'rgb_color') }}"
```

### Toggle fireplace mode from a dashboard button

```yaml
type: button
entity: light.virtual_fireplace
tap_action:
  action: call-service
  service: light.turn_on
  data:
    effect: "Fireplace"
  target:
    entity_id: light.virtual_fireplace
```

---

## Requirements

- Home Assistant **2024.1.0** or newer
- HACS (for automatic installation and updates)

---

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on [GitHub](https://github.com/gabrielozcomidi/Virtual-Light-Entity).

---

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
