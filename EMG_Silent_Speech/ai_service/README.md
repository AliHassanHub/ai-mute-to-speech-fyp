# EMG Calibrated Word Inference API

HTTP wrapper around the **existing** calibrated word predictor. It adds no model
logic of its own.

```
runtime/predict.py  ->  runtime/robust_word_model.py  ->  training/results/calibrated_word_model.npz
                              ^
                              |
                     ai_service (this folder)
```

The `.pt` encoders in `training/models/` are **not** used. Sentence inference is
**not** supported.

## Install

```bash
cd EMG_Silent_Speech
python -m pip install -r ai_service/requirements.txt
```

`torch` is not required.

## Run

```bash
cd EMG_Silent_Speech
python -m uvicorn ai_service.app.main:app --host 127.0.0.1 --port 8077
```

Interactive docs at `http://127.0.0.1:8077/docs`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Service status and verifiable model identity |
| POST | `/session` | Build a session profile from a neutral relaxed baseline |
| POST | `/predict` | Calibrated word prediction |

### GET /health

```json
{
  "status": "ok",
  "model": "calibrated_word_model",
  "word_model_loaded": true,
  "labels": ["help", "no", "pain", "stop"],
  "version": "0.1.0",
  "model_sha256": "28655d4f5084e2ffbfc2d8e1e46ea0eb703f474aca0fb651b1d83e52bdf7f7a8",
  "model_size_bytes": 174849,
  "model_modified_utc": "2026-07-06T13:48:56Z",
  "sentence_model_supported": false,
  "min_predict_samples": 768,
  "max_predict_samples": 1800,
  "hard_min_samples": 50,
  "default_min_confidence": 0.5
}
```

`version` is this service's version. The **model** identifies itself by SHA-256,
so no version number is invented for it.

Returns **503** when the artefact is missing or unreadable.

### POST /predict

```json
{
  "kind": "word",
  "signal": {
    "format": "samples",
    "rows": [{ "emg": 1234, "pot": 39 }]
  },
  "minConfidence": null,
  "sessionId": null
}
```

Response:

```json
{
  "kind": "word",
  "label": "help",
  "bestLabel": "help",
  "confidence": 0.98,
  "accepted": true,
  "distance": 0.0165,
  "margin": 12.0,
  "processingTimeMs": 3.71,
  "sampleCount": 802,
  "quality": "ok",
  "sessionAdaptation": "none",
  "requiredConfidence": 0.5
}
```

## Sample-count requirement

**A single BLE packet cannot produce a prediction.** Two separate limits apply.

The predictor's own gate (`robust_word_model.MIN_SAMPLES` / `MAX_SAMPLES`)
accepts **50 to 1800** samples. Passing it is necessary but not sufficient.

Measured agreement with the verified ground truth, using trailing windows of the
41 real captures the model accepts:

| Window | Agreement |
|-------:|----------:|
| 50 | 41.5 % |
| 128 | 65.9 % |
| 256 | 82.9 % |
| 384 | 87.8 % |
| 512 | 90.2 % |
| 640 | 95.1 % |
| **768** | **100.0 %** |
| full | 100.0 % |

The API therefore requires **768 samples** (≈15.4 s at 50 Hz), overridable with
`EMG_AI_MIN_PREDICT_SAMPLES`. Above 1800 samples the predictor reports
`stale-buffer-suspected`, so the API rejects that too.

## EMG and POT are both mandatory

POT is not auxiliary. In `robust_word_model._predict_scaled` it **gates which
labels are even considered** (`pot_centers` ±`pot_radii + 3.0`) and contributes
**48 %** of the confidence score. `pot` is a required field; a request without it
is rejected with 422.

## Interpreting the numbers

**`confidence` is not a probability and not a cosine similarity.** It is the
predictor's weighted heuristic, capped at 0.98:

```
confidence = min(0.98, 0.48 * pot_conf + 0.34 * distance_conf + 0.18 * gap_conf)
```

**`margin` is in potentiometer counts, not feature distance.** With the current
model all `pot_radii` are 1.0 and the `pot_centers` are 39/27/6/15, so only one
label ever clears the POT gate. `margin` therefore falls through to `pot_gap` —
which is why it is always exactly 12.0 or 9.0. Do not treat it as a
feature-space separation.

**`distance`** is a scaled feature-space RMS distance to the three nearest
in-class references. It is `null` when the signal was rejected before scoring
(the predictor uses infinity there, which JSON cannot represent).

## Unknown handling

The closest label is never forced. On rejection you get `label: "unknown"` with
`accepted: false`, while `bestLabel` still reports what was closest — or a
`low-quality-signal:<reason>` marker when the quality gate fired.

Rejection reasons come from `robust_word_model.quality_reason`: `too-short`,
`stale-buffer-suspected`, `nan-or-inf`, `flat-emg`, `unstable-pot`.

## Session adaptation

Optional, and off by default — which matches how the saved-capture predictions
were verified.

It matters for **live** inference. `runtime/verify_pipeline.py` shows the session
adapter is what makes the model tolerate electrode shifts, and
`runtime/live_predict.py` collects a 6-second neutral baseline before predicting.

```
POST /session  { "signal": { "format": "samples", "rows": [ ...neutral... ] } }
   -> { "sessionId": "...", "baseline": 60.0, "noiseFloor": 1883.7, ... }

POST /predict  { ..., "sessionId": "..." }
   -> { ..., "sessionAdaptation": "applied" }
```

Requires ≥ 80 neutral samples, matching `live_predict.py`. Every prediction
reports `sessionAdaptation` as `"none"` or `"applied"` so a caller always knows
which regime produced the result.

One thing to carry over from `live_predict.py`: it **locks POT once** and feeds
that single value with every sample, because POT selects the word. Live callers
should do the same rather than streaming a moving knob value.

## Sentence mode

`kind: "sentence"` returns **501** with the runtime's own refusal values:

```json
{
  "kind": "sentence",
  "label": "unknown",
  "bestLabel": "sentence-model-disabled",
  "confidence": 0.0,
  "accepted": false,
  "supported": false,
  "reason": "Sentence prediction is disabled in the calibrated hardware workflow..."
}
```

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `EMG_AI_MODEL_PATH` | `training/results/calibrated_word_model.npz` | Artefact location |
| `EMG_AI_MIN_PREDICT_SAMPLES` | `768` | Minimum calibrated window |
| `EMG_AI_MIN_SESSION_SAMPLES` | `80` | Minimum neutral baseline |
| `EMG_AI_CACHE_MODEL` | `1` | Memoise `load_model` on file identity |

## Tests

```bash
cd EMG_Silent_Speech/ai_service
python -m pytest
```

45 tests, all driven by real files from `captures/{help,no,pain,stop}`. No
synthetic labels.

Live check against a running server:

```bash
python ai_service/tests/live_smoke.py
```

## Status

**PYTHON AI API READY.** Node.js integration has not started.
