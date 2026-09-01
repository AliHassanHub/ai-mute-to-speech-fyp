# ESP32 Hardware Setup

Recommended sketch for normal use:

- `esp32_ai_usb_bluetooth/esp32_ai_usb_bluetooth.ino`

Helper sketches are only for one-sensor testing:

- `esp32_emg_only/esp32_emg_only.ino`
- `esp32_pot_only.ino`

## Wiring

EMG module:

- EMG output -> `GPIO34`
- ESP32 ground and EMG ground must be common
- Power the EMG module exactly as its board requires

Potentiometer:

- Left pin -> `3V3`
- Middle pin -> `GPIO35`
- Right pin -> `GND`

## Serial Settings

- Baud rate: `115200`
- USB Serial streaming output

## Output Format

The sketch outputs one stable row format:

```text
EMG:<0-4095>  POT:<0-100>
```

The Python AI parser converts this into the clean project file format:

```text
emg;pot
```

## Sketch Commands

The sketch only accepts:

- `CAL`
- `CALIBRATE`

## Recommended Flow

1. Upload `esp32_ai_usb_bluetooth.ino` to the ESP32.
2. Run `python ai.py ports` and confirm the ESP32 COM port appears.
3. Run `python ai.py add water`.
4. Rotate the knob until the pot value is right for that word.
5. Press Enter once. The Python script locks that pot value.
6. Record the EMG for 16 seconds.
7. Choose `y` to capture another take for the same word, or `n` to finish.
8. Run `python ai.py train` and `python ai.py verify`.
9. Run `python ai.py live` for live prediction.

## Upload Reminder

If Arduino IDE is used, select an ESP32 board such as `ESP32 Dev Module`, select the ESP32 COM port, then upload this sketch:

```text
Hardware/esp32_ai_usb_bluetooth/esp32_ai_usb_bluetooth.ino
```
