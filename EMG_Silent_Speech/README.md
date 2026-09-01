# EMG Silent Speech

This project is now a calibrated ESP32 EMG + potentiometer word recognizer.

The important fix: new captures are saved as clean two-column files:

```text
emg;pot
```

Old five-column files are still readable, but the trainer filters flat/noisy old captures and inconsistent potentiometer clusters so they do not poison the model.

## Hardware

Use `Hardware/esp32_ai_usb_bluetooth/esp32_ai_usb_bluetooth.ino`.

Wiring:

- EMG signal pin -> `GPIO34`
- Potentiometer middle pin -> `GPIO35`
- Pot left pin -> `3V3`
- Pot right pin -> `GND`
- ESP32 ground and EMG ground must be common

## Best Exhibition Workflow

Use these short commands from the project folder.

1. Check the board port:

```bash
python ai.py ports
```

2. Capture at least 6 words. For each word, record 3 to 5 good takes:

```bash
python ai.py add water
python ai.py add help
python ai.py add yes
python ai.py add no
python ai.py add pain
python ai.py add stop
```

During each word capture:

- rotate the potentiometer until the value is right for that word
- press Enter once
- the script records EMG for 16 seconds
- answer `y` to capture another take for the same word
- it will not ask you to rotate the knob again for that same word

3. Rebuild the calibrated model:

```bash
python ai.py train
```

4. Verify the local pipeline:

```bash
python ai.py verify
```

5. Test live prediction:

```bash
python ai.py live
```

6. Predict from a saved file:

```bash
python ai.py predict captures\water\water_20260706_005542.txt
```

## What The AI Does Now

The recognizer uses a calibrated prototype model built from your own EMG + POT captures.

It is designed for small calibration data:

- EMG shape features capture the muscle pattern over time.
- EMG summary features capture strength, spread, envelope, and movement.
- The potentiometer is used as an intentional context feature.
- Flat EMG files are rejected as low-quality input.
- Old captures with inconsistent knob positions are filtered out.
- If confidence is too low, prediction returns `unknown` instead of forcing a wrong word.
- Adding a new word rebuilds the compact calibrated bank; it does not retrain a heavy neural network from scratch.

## Why The Potentiometer Is Not A Limitation

If someone asks why the potentiometer is used, say:

> The potentiometer is a deliberate calibration/context channel. A single low-cost EMG channel can be ambiguous because different mouth gestures can produce similar voltage patterns, and electrode placement changes between people. The knob gives the model a stable user-set context for the intended word group, while the EMG still provides the real muscle signal. This makes the demo reliable with small data. With more EMG channels and a much larger dataset, the knob can be reduced or removed.

Short version:

> It is not replacing EMG. It is helping a one-channel EMG system become reliable for a live demo.

## Current Data Status

Run:

```bash
python ai.py train
```

The trainer prints how many captures are usable per word. A 16-second capture should usually be around 800 samples at 50 Hz. If a file has thousands of samples, it likely contains old serial-buffer data and the trainer now filters it as `stale-buffer-suspected`. Capture fresh takes until each word says `3+ usable takes`, then run `python ai.py verify` and confirm the usable capture audit passes.

## Online Facial EMG Data Note

I checked public facial/speech EMG datasets. They are useful for research comparison, but they should not be mixed directly into this calibration model unless converted and validated, because their electrodes, sampling rates, labels, and channel counts do not match this ESP32 one-channel setup.

Useful references:

- [JapanEEG](https://arxiv.org/abs/2606.01264): a large OpenNeuro BIDS dataset with synchronized EEG, facial EMG, and audio.
- [AVE Speech Dataset](https://arxiv.org/abs/2501.16780): audio/video/EMG speech dataset with six EMG channels.

For this project, your own sensor captures are the truth. External data can be used only as a sanity check, not as direct training data for the exhibition model.


