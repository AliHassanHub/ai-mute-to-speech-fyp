/**
 * ESP32 EMG + Potentiometer → BLE Nordic UART (NUS)
 *
 * Compatible with React Native react-native-ble-plx:
 *   Service:  6e400001-b5a3-f393-e0a9-e50e24dcca9e
 *   Notify:   6e400003-b5a3-f393-e0a9-e50e24dcca9e
 *   Write:    6e400002-b5a3-f393-e0a9-e50e24dcca9e
 *
 * Device name: ESP32_BT_Device
 *
 * EMG algorithm preserved from the Classic BluetoothSerial firmware.
 * Transport only: Classic SPP removed → BLE/GATT.
 *
 * Board family: Classic ESP32 (ADC pins 34/35). Requires ESP32 Arduino core
 * BLE stack (BLEDevice / BLEServer) — bundled with espressif/arduino-esp32.
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "esp_system.h"

// -----------------------------------------------------------------------------
// Pins & EMG algorithm (unchanged from functional base)
// -----------------------------------------------------------------------------
#define EMG_PIN 34
#define POT_PIN 35

static const unsigned long BAUD_RATE = 115200;
static const unsigned long SAMPLE_INTERVAL_MS = 20;  // ~50 Hz
static const int BASELINE_SAMPLES = 160;
static const float EMG_SMOOTHING = 0.20f;
static const float BASELINE_TRACKING = 0.002f;

// -----------------------------------------------------------------------------
// Nordic UART Service (NUS) — must match React Native app
// -----------------------------------------------------------------------------
static const char *DEVICE_NAME = "ESP32_BT_Device";
static const char *NUS_SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E";
static const char *NUS_WRITE_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E";   // phone → ESP32
static const char *NUS_NOTIFY_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E";  // ESP32 → phone

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------
int emgBaseline = 0;
float emgEnvelope = 0.0f;
unsigned long lastSampleMs = 0;
String usbLine = "";
String bleWriteLine = "";

bool bleClientConnected = false;

BLEServer *bleServer = nullptr;
BLECharacteristic *nusNotifyCharacteristic = nullptr;
BLECharacteristic *nusWriteCharacteristic = nullptr;
BLEAdvertising *bleAdvertising = nullptr;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
int clampInt(int value, int lo, int hi) {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

bool canSendBleNotify() {
  if (!bleClientConnected || nusNotifyCharacteristic == nullptr || bleServer == nullptr) {
    return false;
  }
  return bleServer->getConnectedCount() > 0;
}

void notifyBleText(const String &text) {
  if (!canSendBleNotify()) {
    return;
  }
  nusNotifyCharacteristic->setValue(text.c_str());
  nusNotifyCharacteristic->notify();
}

void sendEmgSampleBle(int emg, int pot) {
  // Exact app parser format: EMG:<value>  POT:<value>\n
  char payload[48];
  snprintf(payload, sizeof(payload), "EMG:%d  POT:%d\n", emg, pot);
  notifyBleText(String(payload));
}

void sendBleStatus(const char *statusCode) {
  // Prefixed so React Native EMG parser ignores these lines.
  char payload[64];
  snprintf(payload, sizeof(payload), "STATUS:%s\n", statusCode);
  notifyBleText(String(payload));
}

// -----------------------------------------------------------------------------
// EMG / POT (preserved algorithm)
// -----------------------------------------------------------------------------
int readPotMapped() {
  int raw = analogRead(POT_PIN);
  int mapped = map(raw, 0, 4095, 0, 100);
  return clampInt(mapped, 0, 100);
}

int readEmgEnvelope() {
  int raw = analogRead(EMG_PIN);
  int rectified = abs(raw - emgBaseline);
  emgEnvelope = (EMG_SMOOTHING * rectified) + ((1.0f - EMG_SMOOTHING) * emgEnvelope);

  if (rectified < 25) {
    emgBaseline = (int)((1.0f - BASELINE_TRACKING) * emgBaseline + BASELINE_TRACKING * raw);
  }

  return clampInt((int)(emgEnvelope + 0.5f), 0, 4095);
}

void calibrateBaseline() {
  Serial.println("CALIBRATING keep electrodes/muscles relaxed");
  delay(200);

  long sum = 0;
  for (int i = 0; i < BASELINE_SAMPLES; i++) {
    sum += analogRead(EMG_PIN);
    delay(5);
  }
  emgBaseline = (int)(sum / BASELINE_SAMPLES);
  emgEnvelope = 0.0f;

  Serial.print("BASELINE:");
  Serial.println(emgBaseline);
  Serial.println("CALIBRATION DONE");

  // Distinct from EMG lines so the mobile parser will not treat this as a sample.
  sendBleStatus("CALIBRATION_DONE");
}

void handleCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;

  String upper = cmd;
  upper.toUpperCase();

  if (upper == "CAL" || upper == "CALIBRATE") {
    calibrateBaseline();
  } else {
    Serial.print("ERR unknown command: ");
    Serial.println(cmd);
  }
}

void consumeStream(Stream &stream, String &buffer) {
  while (stream.available()) {
    char ch = (char)stream.read();
    if (ch == '\r') continue;
    if (ch == '\n') {
      handleCommand(buffer);
      buffer = "";
    } else if (buffer.length() < 96) {
      buffer += ch;
    }
  }
}

void readUsbCommands() {
  consumeStream(Serial, usbLine);
}

void emitSample() {
  int emg = readEmgEnvelope();
  int pot = readPotMapped();

  // USB Serial: always useful for debugging (includes sample stream).
  Serial.print("EMG:");
  Serial.print(emg);
  Serial.print("  POT:");
  Serial.println(pot);

  // BLE notify: only when a central is connected and notifications are enabled.
  if (canSendBleNotify()) {
    sendEmgSampleBle(emg, pot);
  }
}

// -----------------------------------------------------------------------------
// BLE callbacks
// -----------------------------------------------------------------------------
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    bleClientConnected = true;
    Serial.println("BLE central connected");
  }

  void onDisconnect(BLEServer *server) override {
    (void)server;
    bleClientConnected = false;
    Serial.println("BLE central disconnected — restarting advertising");
    delay(100);
    if (bleAdvertising != nullptr) {
      bleAdvertising->start();
    }
  }
};

class WriteCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) override {
    // ESP32 Arduino core: getValue() returns String (core 3.x) or std::string (2.x).
    // Convert via c_str() for compatibility.
    String value = String(characteristic->getValue().c_str());
    if (value.length() == 0) {
      return;
    }

    bool sawNewline = false;
    for (unsigned int i = 0; i < value.length(); i++) {
      char ch = value.charAt(i);
      if (ch == '\r') continue;
      if (ch == '\n') {
        sawNewline = true;
        handleCommand(bleWriteLine);
        bleWriteLine = "";
      } else if (bleWriteLine.length() < 96) {
        bleWriteLine += ch;
      }
    }

    // Accept a single write packet without trailing newline (e.g. "CAL").
    if (!sawNewline && bleWriteLine.length() > 0) {
      handleCommand(bleWriteLine);
      bleWriteLine = "";
    }
  }
};

// -----------------------------------------------------------------------------
// BLE setup
// -----------------------------------------------------------------------------
void startAdvertising() {
  if (bleAdvertising == nullptr) {
    return;
  }
  bleAdvertising->start();
  Serial.println("BLE advertising started");
}

void setupBLE() {
  BLEDevice::init(DEVICE_NAME);

  bleServer = BLEDevice::createServer();
  bleServer->setCallbacks(new ServerCallbacks());

  BLEService *nusService = bleServer->createService(NUS_SERVICE_UUID);

  // Notify characteristic (ESP32 → phone) — required by React Native app
  nusNotifyCharacteristic = nusService->createCharacteristic(
      NUS_NOTIFY_UUID,
      BLECharacteristic::PROPERTY_NOTIFY
  );
  // CCCD required for mobile clients to enable notifications.
  nusNotifyCharacteristic->addDescriptor(new BLE2902());

  // Write characteristic (phone → ESP32) — CAL / CALIBRATE
  nusWriteCharacteristic = nusService->createCharacteristic(
      NUS_WRITE_UUID,
      BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR
  );
  nusWriteCharacteristic->setCallbacks(new WriteCallbacks());

  nusService->start();

  bleAdvertising = BLEDevice::getAdvertising();
  bleAdvertising->addServiceUUID(NUS_SERVICE_UUID);
  bleAdvertising->setScanResponse(true);
  // Prefer connectable advertising for phones
  bleAdvertising->setMinPreferred(0x06);
  bleAdvertising->setMaxPreferred(0x12);

  startAdvertising();

  Serial.println("Bluetooth/BLE Started");
  Serial.print("Device Name: ");
  Serial.println(DEVICE_NAME);
  Serial.print("Service UUID: ");
  Serial.println(NUS_SERVICE_UUID);
  Serial.print("Notify Characteristic UUID: ");
  Serial.println(NUS_NOTIFY_UUID);
  Serial.print("Write Characteristic UUID: ");
  Serial.println(NUS_WRITE_UUID);
  Serial.println("Waiting for BLE connection");
}

void handleBLEConnect() {
  // Connection handled in ServerCallbacks::onConnect
}

void handleBLEDisconnect() {
  // Disconnect handled in ServerCallbacks::onDisconnect
}

void handleBLEWrite() {
  // Writes handled in WriteCallbacks::onWrite
}

void sendEmgSample() {
  emitSample();
}

// -----------------------------------------------------------------------------
// Arduino entry
// -----------------------------------------------------------------------------
void setup() {
  Serial.begin(BAUD_RATE);
  delay(1000);

  esp_reset_reason_t reason = esp_reset_reason();
  Serial.print("Reset Reason: ");
  switch (reason) {
    case ESP_RST_POWERON: Serial.println("Power On"); break;
    case ESP_RST_BROWNOUT: Serial.println("BROWNOUT - Power issue!"); break;
    case ESP_RST_TASK_WDT: Serial.println("Watchdog Timeout"); break;
    case ESP_RST_PANIC: Serial.println("Software Crash/Panic"); break;
    default: Serial.println((int)reason); break;
  }

  analogReadResolution(12);
  analogSetPinAttenuation(EMG_PIN, ADC_11db);
  analogSetPinAttenuation(POT_PIN, ADC_11db);

  setupBLE();

  Serial.println("READY ESP32-EMG-AI (BLE)");
  Serial.println("FORMAT EMG:<0-4095>  POT:<0-100>");

  calibrateBaseline();
  Serial.println("STREAMING READY (BLE notifies only when phone is connected)");
}

void loop() {
  readUsbCommands();

  unsigned long now = millis();
  if (lastSampleMs == 0 || now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    lastSampleMs = now;
    sendEmgSample();
  }
}
