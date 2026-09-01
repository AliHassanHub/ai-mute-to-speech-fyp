static const int EMG_PIN = 34;

void setup() {
  Serial.begin(9600);
  analogReadResolution(12);
  analogSetPinAttenuation(EMG_PIN, ADC_11db);
  Serial.println("READY EMG ONLY");
}

void loop() {
  long sum = 0;
  for (int i = 0; i < 20; i++) {
    sum += analogRead(EMG_PIN);
    delayMicroseconds(500);
  }
  int emgValue = (int)(sum / 20);
  Serial.println(emgValue);
  delay(600);
}
