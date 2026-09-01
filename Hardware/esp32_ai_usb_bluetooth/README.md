# ESP32 AI USB + Bluetooth (BLE) Firmware

EMG + potentiometer acquisition for the **AI Mute-to-Speech** FYP.

This sketch streams samples over:

1. **USB Serial** (debug / PC tools)
2. **BLE GATT Nordic UART Service** (React Native `react-native-ble-plx`)

> Classic `BluetoothSerial` (SPP) was replaced. Phones using BLE cannot see Classic SPP devices.

---

## 1. Open in Arduino IDE

1. Install [Arduino IDE](https://www.arduino.cc/en/software) (2.x recommended).
2. File → Open → select:
   ```text
   Hardware/esp32_ai_usb_bluetooth/esp32_ai_usb_bluetooth.ino
   ```
3. The sketch folder name must match the `.ino` name (`esp32_ai_usb_bluetooth`).

---

## 2. Select the ESP32 board

This firmware targets a **classic ESP32** (e.g. ESP32-WROOM-32 / DevKit V1):

- Uses ADC pins **GPIO 34** (EMG) and **GPIO 35** (POT) — input-only ADC1 pins on classic ESP32.
- Uses the Espressif **Bluedroid BLE** Arduino API (`BLEDevice`, `BLEServer`, …).

In Arduino IDE:

1. **Tools → Board → ESP32 Arduino → ESP32 Dev Module**  
   (or your exact classic ESP32 board entry)
2. Do **not** select ESP32-S2 / C3 / C6 unless you redesign pins and BLE APIs.

Flash size / partition: defaults are usually fine for this sketch size.

---

## 3. Select COM port

1. Connect the ESP32 by USB.
2. **Tools → Port → COMx** (Windows) matching the USB-UART bridge.
3. If no port appears: install the CP210x / CH340 driver for your board.

---

## 4. Install required libraries

### ESP32 Arduino core (required)

1. **File → Preferences → Additional boards manager URLs**  
   Add (if not present):
   ```text
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```
2. **Tools → Board → Boards Manager** → search **esp32** by Espressif → Install.

### Extra Arduino Library Manager packages

**None required for BLE.**

`BLEDevice.h` / `BLEServer.h` / `BLE2902.h` ship with the **ESP32 Arduino core**.

Optional: if your core build fails to find BLE headers, update the ESP32 core to a recent 2.x or 3.x release and reselect **ESP32 Dev Module**.

---

## 5. Upload firmware

1. Tools → Upload Speed: `115200` (or board default).
2. Click **Upload**.
3. If upload fails, hold **BOOT**, click Upload, release when compiling finishes (varies by board).

---

## 6. Open Serial Monitor

1. **Tools → Serial Monitor**
2. Baud: **115200**
3. Line ending: **Newline**

You should see messages similar to:

```text
Bluetooth/BLE Started
Device Name: ESP32_BT_Device
Service UUID: 6E400001-...
Notify Characteristic UUID: 6E400003-...
Write Characteristic UUID: 6E400002-...
Waiting for BLE connection
READY ESP32-EMG-AI (BLE)
...
EMG:…  POT:…
```

USB continues printing EMG samples even when no phone is connected.

---

## 7. Verify BLE advertising

On a phone:

1. Use a BLE scanner (e.g. **nRF Connect**) **or** the FYP app Dev Client.
2. Look for device name: **`ESP32_BT_Device`**
3. Confirm service UUID: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
4. Confirm notify characteristic: `6e400003-…`
5. Confirm write characteristic: `6e400002-…`

Classic Bluetooth phone menus will **not** list this device — that is expected.

---

## 8. Connect from the mobile app

1. Build/run the Expo **Development Client** (not Expo Go) — BLE needs `react-native-ble-plx`.
2. Open **Connect EMG Device**.
3. Scan → select **ESP32_BT_Device**.
4. Connect.
5. Start recording/calibration → app should receive `EMG:… POT:…` lines (hardware mode).

### Calibration over BLE

Write ASCII to characteristic `6e400002-…`:

```text
CAL
```

or

```text
CALIBRATE
```

USB Serial accepts the same commands.

---

## Pins

| Function | GPIO |
|----------|------|
| EMG analog | 34 |
| Potentiometer analog | 35 |

---

## Related docs

- [`BLE_PROTOCOL.md`](./BLE_PROTOCOL.md) — UUIDs, format, rates
- [`BLE_IMPLEMENTATION_REPORT.md`](./BLE_IMPLEMENTATION_REPORT.md) — change history & testing

## Legacy

- `esp32_ai_usb_bluetooth_classic_backup.ino` — original Classic SPP firmware (reference only; do not flash for the mobile app)
