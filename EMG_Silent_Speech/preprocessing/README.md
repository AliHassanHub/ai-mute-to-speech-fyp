# Preprocessing (Beginner Friendly)

This folder holds **small helper files** that clean and prepare EMG signals.
They are used by training and runtime scripts.

Files in `preprocessing/core/`:

## 1) `signal_reader.py`
**What it does**
- Reads a `.txt` EMG file.
- Converts it into a 2D array (rows = samples, columns = channels).

**Why it matters**
- Your models only work if data is read correctly.

---

## 2) `channel_processing.py`
**What it does**
- Picks one column (channel) from the EMG data.

**Why it matters**
- Your project uses **single‑channel EMG**, so we keep only one column.

---

## 3) `signal_cleaning.py`
**What it does**
- Checks if the signal is valid.
- Removes DC offset (mean).
- Normalizes the signal (z‑score or min‑max).

**Why it matters**
- Normalization makes signals from different users look similar.

---

## 4) `signal_length.py`
**What it does**
- Makes every signal the **same length** by trimming or padding.
- Can also resize smoothly.

**Why it matters**
- Neural networks need fixed‑length input.

---

## Typical flow (very simple)
1. Read file  
2. Select EMG channel  
3. Remove offset  
4. Normalize  
5. Resize to fixed length  

That’s it.
