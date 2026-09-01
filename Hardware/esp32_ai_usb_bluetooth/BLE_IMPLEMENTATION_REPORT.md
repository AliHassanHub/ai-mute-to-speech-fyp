# BLE Implementation Report

**Firmware:** `Hardware/esp32_ai_usb_bluetooth/esp32_ai_usb_bluetooth.ino`  
**Date:** 2026-08-25  
**Scope:** ESP32 transport only — React Native / Node.js / AI / translation / TTS **not modified**.

---

## 1. Original Bluetooth implementation

The functional base sketch used:

```cpp
#include "BluetoothSerial.h"
BluetoothSerial SerialBT;
SerialBT.begin("ESP32_BT_Device");
```

That is **Bluetooth Classic SPP** (serial port profile).

EMG samples were mirrored to:

- USB `Serial`
- `SerialBT` when `SerialBT.hasClient()`

---

## 2. Why BluetoothSerial was incompatible

| Classic SPP (`BluetoothSerial`) | App (`react-native-ble-plx`) |
|---------------------------------|------------------------------|
| Bluetooth Classic | **BLE / GATT only** |
| RFCOMM serial port | GATT services & characteristics |
| Not visible in BLE scans | Scans BLE advertisements |
| No Nordic UART UUIDs | Expects NUS UUIDs |

Therefore Classic SPP cannot satisfy the existing mobile BLE architecture.

---

## 3. New BLE architecture

```
ADC EMG (GPIO34) + POT (GPIO35)
        ↓  preserved envelope / baseline / mapping
   emitSample() @ 20 ms (~50 Hz)
        ├── USB Serial  (always; debug + samples)
        └── BLE Notify  (only if central connected)
                 NUS service 6e400001-…
                 Notify char 6e400003-…
        ↑
   BLE Write 6e400002-…  (CAL / CALIBRATE)
```

Functions organized as:

- `setupBLE()` / `startAdvertising()`
- `ServerCallbacks` connect/disconnect
- `WriteCallbacks` (`handleBLEWrite` path)
- `sendEmgSample()` / `sendEmgSampleBle()`
- `calibrateBaseline()`

---

## 4. UUIDs

| Item | UUID |
|------|------|
| Service (NUS) | `6e400001-b5a3-f393-e0a9-e50e24dcca9e` |
| Notify | `6e400003-b5a3-f393-e0a9-e50e24dcca9e` |
| Write | `6e400002-b5a3-f393-e0a9-e50e24dcca9e` |

Service UUID is included in advertising data.

---

## 5. Device name

Exact name:

```text
ESP32_BT_Device
```

---

## 6. Data format

Notify / USB sample line:

```text
EMG:<0-4095>  POT:<0-100>\n
```

Example: `EMG:812  POT:39`

Calibration status on BLE (parser-safe):

```text
STATUS:CALIBRATION_DONE
```

Debug (`Reset Reason`, `BLE central connected`, etc.) → **USB Serial only**.

---

## 7. Sampling rate

| Constant | Value |
|----------|--------|
| `SAMPLE_INTERVAL_MS` | 20 |
| Target | ~50 samples/s |
| Loop timing | `millis()` gated (streaming loop does not `delay()` for pacing) |

---

## 8. Calibration

Preserved:

- `BASELINE_SAMPLES = 160`
- Envelope smoothing / baseline tracking constants
- Commands `CAL` / `CALIBRATE` from USB Serial and BLE write

---

## 9. Libraries

| Dependency | Source | Extra Library Manager install? |
|------------|--------|--------------------------------|
| `BLEDevice`, `BLEServer`, `BLEUtils`, `BLE2902` | **ESP32 Arduino core** (Espressif) | **No** |
| `BluetoothSerial` | Removed from production sketch | — |

### Board family

Inferred from original firmware:

- `BluetoothSerial` → classic **ESP32** (WROOM / DevKit), **not** ESP32-S2
- ADC pins **34 / 35** → classic ESP32 ADC1 input-only pins

Selected BLE API (`BLEDevice` Bluedroid wrapper) is the standard stack for **classic ESP32** Arduino cores.

---

## 10. Files modified / created

| Path | Action |
|------|--------|
| `Hardware/esp32_ai_usb_bluetooth/esp32_ai_usb_bluetooth.ino` | **Rewritten** → BLE NUS |
| `Hardware/esp32_ai_usb_bluetooth/esp32_ai_usb_bluetooth_classic_backup.ino` | Original Classic SPP backup |
| `Hardware/esp32_ai_usb_bluetooth/BLE_PROTOCOL.md` | Created |
| `Hardware/esp32_ai_usb_bluetooth/README.md` | Created |
| `Hardware/esp32_ai_usb_bluetooth/BLE_IMPLEMENTATION_REPORT.md` | Created (this file) |
| `Hardware/esp32_emg_only/` | Restored from zip (unchanged) |
| `Hardware/esp32_pot_only/` | Restored from zip (unchanged) |
| `Hardware/bluetooth/` | Restored Classic demo (reference) |

**Not touched:** `Application/client`, `Application/server`, AI, translation, TTS.

---

## 11. Validation checklist

| Check | Result |
|-------|--------|
| Service UUID matches app | **PASS** (code review) |
| Notify UUID matches app | **PASS** (code review) |
| Write UUID present | **PASS** (code review) |
| Device name `ESP32_BT_Device` | **PASS** (code review) |
| NUS advertised | **PASS** (code review: `addServiceUUID`) |
| EMG format `EMG:…  POT:…` | **PASS** (code review) |
| ~50 Hz timing | **PASS** (code review: 20 ms `millis`) |
| Calibration commands | **PASS** (code review) |
| Reconnect advertising | **PASS** (code review: restart on disconnect) |
| USB Serial debug | **PASS** (code review) |
| Arduino compile / upload | **NOT COMPILED** — **REQUIRES ARDUINO IDE VERIFICATION** |
| Phone nRF Connect / app live test | **NOT TESTED** (no hardware run in this environment) |

---

## 12. Testing still required

1. Compile & upload in Arduino IDE to physical ESP32 Dev Module.
2. Confirm advertising name and UUIDs in **nRF Connect**.
3. Connect from FYP Expo **Dev Client** → `DeviceConnectionScreen`.
4. Confirm Record screen mode = **Hardware** (not Simulation).
5. Measure approximate sample rate (count lines / second).
6. Send BLE write `CAL` and confirm `STATUS:CALIBRATION_DONE` plus USB baseline logs.
7. Disconnect phone → confirm advertising returns; reconnect from another phone.

---

## 13. Known limitations

1. **Compilation not executed** in Cursor — must verify with Arduino IDE / ESP32 core version in use.
2. `getValue().c_str()` assumes the core returns a type with `c_str()` (`String` or `std::string`). Very old cores may need a one-line tweak.
3. Classic ESP32 cannot usefully run Classic BT + BLE together; this build is **BLE-only**.
4. ESP32-S3/C3 boards need different pin maps and possibly NimBLE APIs — **not** this sketch’s target.
5. Notify rate depends on connection interval; phone stacks may slightly jitter around 50 Hz.
6. Mobile app still does not write `CAL` yet — write characteristic is ready for a future app change.

---

## 14. Compilation status

```text
NOT COMPILED
REQUIRES ARDUINO IDE VERIFICATION
```
