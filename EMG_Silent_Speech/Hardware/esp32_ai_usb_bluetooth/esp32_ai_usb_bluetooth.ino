#include "BluetoothSerial.h"
#include "esp_system.h"

#define EMG_PIN 34
#define POT_PIN 35

BluetoothSerial SerialBT;

const unsigned long BAUD_RATE = 115200;
const unsigned long SAMPLE_INTERVAL_MS = 20;
const int BASELINE_SAMPLES = 160;
const float EMG_SMOOTHING = 0.20f;
const float BASELINE_TRACKING = 0.002f;

int emgBaseline = 0;
float emgEnvelope = 0.0f;
unsigned long lastSampleMs = 0;
String usbLine = "";
String btLine = "";

int clampInt(int value, int lo, int hi) {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

void printBoth(const String &text) {
  Serial.println(text);
  if (SerialBT.hasClient()) {
    SerialBT.println(text);
  }
}

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
  printBoth("CALIBRATING keep electrodes/muscles relaxed");
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
  if (SerialBT.hasClient()) {
    SerialBT.print("BASELINE:");
    SerialBT.println(emgBaseline);
  }
  printBoth("CALIBRATION DONE");
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
    if (SerialBT.hasClient()) {
      SerialBT.print("ERR unknown command: ");
      SerialBT.println(cmd);
    }
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

void readCommands() {
  consumeStream(Serial, usbLine);
  if (SerialBT.hasClient()) {
    consumeStream(SerialBT, btLine);
  }
}

void emitSample() {
  int emg = readEmgEnvelope();
  int pot = readPotMapped();

  Serial.print("EMG:");
  Serial.print(emg);
  Serial.print("  POT:");
  Serial.println(pot);

  if (SerialBT.hasClient()) {
    SerialBT.print("EMG:");
    SerialBT.print(emg);
    SerialBT.print("  POT:");
    SerialBT.println(pot);
  }
}

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
    default: Serial.println(reason); break;
  }

  SerialBT.begin("ESP32_BT_Device");
  Serial.println("Bluetooth Started!");

  analogReadResolution(12);
  analogSetPinAttenuation(EMG_PIN, ADC_11db);
  analogSetPinAttenuation(POT_PIN, ADC_11db);

  printBoth("READY ESP32-EMG-AI");
  printBoth("FORMAT EMG:<0-4095>  POT:<0-100>");

  calibrateBaseline();
  printBoth("STREAMING STARTED");
}

void loop() {
  static unsigned long lastBtCheck = 0;
  readCommands();

  unsigned long now = millis();
  if (now - lastBtCheck > 1000) {
    lastBtCheck = now;
    Serial.print("BT Connected: ");
    Serial.println(SerialBT.hasClient() ? "YES" : "NO");
  }

  if (lastSampleMs == 0 || now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    lastSampleMs = now;
    emitSample();
  }
}
