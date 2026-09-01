# TODO - EMG Silent Speech fixes

## Done

- [x] New captures save as clean `emg;pot` rows.
- [x] Potentiometer is set once per word capture session and reused for repeated takes.
- [x] Prediction, calibration, live mode, and rebuild use one shared parser/preprocessor.
- [x] The old duplicate `go.py` model path now delegates to `ai.py`.
- [x] Small-data overfitting is reduced with balanced reference matching, quality filtering, and confidence rejection.
- [x] Flat/noisy captures are rejected as `unknown` instead of being forced into a word.
- [x] Stale serial-buffer captures with unrealistic sample counts are filtered out.
- [x] Potentiometer position is used as a strong class gate so the first-added word cannot dominate all predictions.
- [x] `python ai.py verify` runs a capture audit and confirms usable captures classify correctly.

## Still Needs Real Hardware Data

- [ ] Capture at least 6 words.
- [ ] Capture 3 to 5 fresh usable takes for each word.
- [ ] Run `python ai.py train` and confirm every word has `3+ usable takes`.
- [ ] Run `python ai.py verify` and confirm `usable capture audit` passes.
- [ ] Run `python ai.py live` and test with the actual ESP32 sensor during the exhibition setup.
