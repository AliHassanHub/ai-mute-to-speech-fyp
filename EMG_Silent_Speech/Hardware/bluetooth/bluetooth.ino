#include "BluetoothSerial.h"
#include "esp_system.h"

BluetoothSerial SerialBT;

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  // Reset reason print karo - pata chal jayega asal wajah
  esp_reset_reason_t reason = esp_reset_reason();
  Serial.print("Reset Reason: ");
  switch(reason) {
    case ESP_RST_POWERON: Serial.println("Power On"); break;
    case ESP_RST_BROWNOUT: Serial.println("BROWNOUT - Power issue!"); break;
    case ESP_RST_TASK_WDT: Serial.println("Watchdog Timeout"); break;
    case ESP_RST_PANIC: Serial.println("Software Crash/Panic"); break;
    default: Serial.println(reason); break;
  }
  
  SerialBT.begin("ESP32_BT_Device");
  Serial.println("Bluetooth Started!");
}

void loop() {
  static unsigned long lastCheck = 0;
  if (millis() - lastCheck > 1000) {
    lastCheck = millis();
    Serial.print("BT Connected: ");
    Serial.println(SerialBT.hasClient() ? "YES ✅" : "NO ❌");
  }
  
  if (SerialBT.available()) {
    Serial.write(SerialBT.read());
  }
}