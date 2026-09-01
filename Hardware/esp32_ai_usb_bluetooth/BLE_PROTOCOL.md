# BLE Protocol — ESP32 EMG Mute-to-Speech

Firmware folder: `Hardware/esp32_ai_usb_bluetooth/`

This document defines the BLE contract expected by the React Native app
(`react-native-ble-plx` + Nordic UART Service).

---

## Device

| Field | Value |
|-------|--------|
| Device name | `ESP32_BT_Device` |
| Transport | **BLE GATT only** (not Bluetooth Classic SPP) |
| Role | Peripheral (GATT server) |

---

## Nordic UART Service (NUS)

| Role | UUID |
|------|------|
| **Service** | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` |
| **Write** (phone → ESP32) | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` |
| **Notify** (ESP32 → phone) | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` |

Advertising includes the NUS **service UUID** so mobiles can filter scans.

### Characteristic properties

| Characteristic | Properties |
|----------------|------------|
| Notify `…0003…` | `NOTIFY` (+ CCCD / BLE2902) |
| Write `…0002…` | `WRITE`, `WRITE_NR` |

---

## EMG notification data format

**Text only.** One sample per notification line:

```text
EMG:<value>  POT:<value>\n
```

Example:

```text
EMG:812  POT:39
```

| Field | Range | Meaning |
|-------|-------|---------|
| EMG | 0–4095 | Smoothed envelope (12-bit ADC processing) |
| POT | 0–100 | Potentiometer mapped from 0–4095 ADC |

Do **not** send JSON or binary on the notify characteristic.

Debug strings (connection messages, reset reason, etc.) go to **USB Serial only**, not BLE notify.

---

## Sampling

| Parameter | Value |
|-----------|--------|
| `SAMPLE_INTERVAL_MS` | 20 |
| Target rate | **~50 Hz** |
| Timing | `millis()`-based (no blocking `delay()` in the streaming loop) |

BLE notifications are sent **only while a central is connected**.

USB Serial continues to print EMG samples for bench debugging even when no phone is connected.

---

## Calibration

| Item | Value |
|------|--------|
| USB Serial commands | `CAL` or `CALIBRATE` (newline-terminated) |
| BLE write commands | `CAL` or `CALIBRATE` (with or without `\n`) |
| Baseline samples | 160 |
| Algorithm | Same as original firmware (relaxed electrodes) |

After BLE-triggered calibration, notify (if connected):

```text
STATUS:CALIBRATION_DONE
```

The `STATUS:` prefix keeps this out of the React Native EMG line parser (`EMG:… POT:…`).

USB Serial still prints human-readable `CALIBRATION DONE` / `BASELINE:…`.

---

## Connection behavior

| State | Behavior |
|-------|----------|
| No BLE client | No EMG notifications; advertising active; USB Serial may stream samples |
| Client connects | Notifications allowed; ~50 Hz EMG/POT lines on notify char |
| Client disconnects | Stop notifies; clear connection flag; **restart advertising** |

---

## Pins

| Signal | GPIO |
|--------|------|
| EMG | 34 |
| POT | 35 |
| ADC | 12-bit |

---

## Compatibility note

This protocol matches the current mobile hardcodes in:

- `Application/client/src/services/emgStreamService.js` (service + notify UUIDs)
- `Application/client/src/utils/emgSignal.js` (`EMG:… POT:…` parser)
- `Application/client/src/services/bleService.js` (name filter includes `esp32`)
