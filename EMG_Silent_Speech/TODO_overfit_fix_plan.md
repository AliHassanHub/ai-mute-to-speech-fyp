# Overfitting Fix Plan (EMG+POT project)

## What we know (from code)
- Model training (`training/train_models.py`) and prediction (`runtime/predict.py`) currently use **only 1D EMG** (column index 1).
- Reference bank building also embeds **only EMG**.
- Overfitting symptoms likely come from:
  - too-strong pairing setup (contrastive without proper negative hardness control)
  - weak validation/selection (only one train run, no early stopping)
  - word model uses `keep_all_refs=True` (can memorize if dataset small)
  - weak augmentation and no regularization besides weight decay.

## Fixes to apply (fast, minimal user time)
1) Add **early stopping + best checkpoint selection** using the existing `val` split.
2) Reduce memorization in word bank:
   - set `keep_all_refs=False` and keep only a **single robust prototype** per class (mean embedding).
3) Improve augmentation:
   - stronger time-domain jitter: random gain + random crop/shift before resize.
4) Calibrate confidence to reduce overconfidence:
   - during prediction, use a slightly higher min-confidence OR compute temperature scaling using val embeddings.
5) Add a quick dataset sanity script to show train/val/test gap (optional).

## Implementation steps
- Edit `training/train_models.py` to:
  - create val_loader split
  - train for up to N epochs with early stopping
  - evaluate on val each epoch using holdout pair accuracy
- Edit `runtime/predict.py` and `runtime/rebuild_word_bank.py` (if needed) for prototype-only bank.
- Re-run `python runtime/project_pipeline.py train`.


