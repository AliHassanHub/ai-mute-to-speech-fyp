static const int POT_PIN = 35;

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  analogSetPinAttenuation(POT_PIN, ADC_11db);
  Serial.println("READY POT ONLY");
}

void loop() {
  long sum = 0;
  for (int i = 0; i < 12; i++) {
    sum += analogRead(POT_PIN);
    delayMicroseconds(300);
  }
  int potValue = (int)(sum / 12);
  Serial.println(potValue);
  delay(150);
}
