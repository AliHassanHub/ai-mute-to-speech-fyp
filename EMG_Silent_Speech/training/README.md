# Training (Beginner Friendly)

This folder trains **one SNN model** that can work for both:
- Sentence classification
- Word classification

File:
- `train_models.py`

---

## What this script does (simple flow)
1. **Start**
2. Read dataset folders
3. Build train/val/test split
4. Preprocess EMG (single channel, normalize, resize)
5. Build training pairs (same class vs different class)
6. Train the Siamese encoder
7. Build a reference bank
8. Evaluate on holdout + test
9. Save models + reference banks
10. End

---

## Important settings (easy language)

### Sentence model
- **Epochs:** 8  
- **Pairs per epoch:** 1024  
- **Batch size:** 64  
- **Target length:** 768  
- **Embedding size:** 64  
- **Learning rate:** 0.001  
- **Weight decay:** 0.0001  

### Word model
- **Epochs:** 15  
- **Pairs per epoch:** 2048  
- **Batch size:** 64  
- **Target length:** 384  
- **Embedding size:** 64  
- **Learning rate:** 0.001  
- **Weight decay:** 0.0001  
- **Data augmentation:** ON (light noise + scaling)

---

## Why these values
- **Epochs**: small, so training is fast and simple  
- **Pairs per epoch**: enough for similarity learning  
- **Batch size 64**: stable and common  
- **Embedding 64**: small but good enough  

---

## How training avoids overfitting
We **do not measure training on the same references**.  
Instead, we hold out part of the training set and test on that.
So the "train accuracy" you see is more honest.

---

## Outputs (saved files)
Models:
- `training/models/snn_sentence_encoder.pt`
- `training/models/snn_word_encoder.pt`

Reference banks:
- `training/results/snn_sentence_reference_bank.npz`
- `training/results/snn_word_reference_bank.npz`

Confusion matrices:
- `training/results/snn_sentence_confusion.png`
- `training/results/word_confusion.png`

---

## How to run
```bash
python training/train_models.py
```

---

## Latest verified results
Sentence Test:
- Accuracy **0.9574**
- Precision **0.9608**
- Recall **0.9577**
- F1 **0.9573**

Word Test:
- Accuracy **0.8118**
- Precision **0.7996**
- Recall **0.8034**
- F1 **0.7972**

These are the numbers you can show in your internal.