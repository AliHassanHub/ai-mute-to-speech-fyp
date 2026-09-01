import csv
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

DATASET_DIR = Path(r"D:\data-20260324T130558Z-3-001\data")
SPLIT_FILE = Path(__file__).resolve().parents[1] / "preprocessing" / "outputs" / "all_split.csv"
PLOTS_DIR = Path(__file__).resolve().parent / "plots"
PLOTS_DIR.mkdir(parents=True, exist_ok=True)

SENTENCE_LABELS = ("Need Medical Assistance", "Do Not Land Here", "Pick Us Up")

if not DATASET_DIR.exists():
    print("Dataset folder not found")
    raise SystemExit(1)

WORD_LABELS = []
for folder in sorted(DATASET_DIR.iterdir()):
    if folder.is_dir():
        if folder.name in SENTENCE_LABELS:
            continue
        has_txt = False
        for f in folder.glob("*.txt"):
            has_txt = True
            break
        if has_txt:
            WORD_LABELS.append(folder.name)

def read_emg(path):
    rows = []
    f = open(path, "r", encoding="utf-8")
    for line in f:
        line = line.strip()
        if line == "":
            continue
        parts = line.split(";")
        values = []
        for p in parts:
            values.append(float(p))
        rows.append(values)
    f.close()
    data = np.array(rows, dtype=np.float32)
    if data.shape[1] > 1:
        emg = data[:, 1]
    else:
        emg = data[:, 0]
    return emg, data


print("EMG Silent Speech - Dataset Analysis")
print("-" * 45)

folders = []
for folder in sorted(DATASET_DIR.iterdir()):
    if not folder.is_dir():
        continue
    name = folder.name
    if name in SENTENCE_LABELS:
        label_type = "sentence"
    elif name in WORD_LABELS:
        label_type = "word"
    else:
        continue
    files = sorted(folder.glob("*.txt"))
    folders.append((name, label_type, files))

print("\nSAMPLES PER CLASS")
word_total = 0
sent_total = 0
for name, label_type, files in folders:
    count = len(files)
    print(f"  {name:25s}  {count:4d} files  ({label_type})")
    if label_type == "word":
        word_total = word_total + count
    if label_type == "sentence":
        sent_total = sent_total + count
print(f"  Sentences: {sent_total}   Words: {word_total}   Total: {sent_total + word_total}")

print("\nSIGNAL LENGTHS")
word_lengths = []
sent_lengths = []
for _, label_type, files in folders:
    for fpath in files:
        f = open(fpath, "r", encoding="utf-8")
        length = 0
        for line in f:
            if line.strip() != "":
                length = length + 1
        f.close()
        if label_type == "word":
            word_lengths.append(length)
        else:
            sent_lengths.append(length)

for name, arr in [("Word", word_lengths), ("Sentence", sent_lengths)]:
    arr = np.array(arr)
    print(f"  {name}: count={len(arr)}  min={arr.min()}  max={arr.max()}  mean={arr.mean():.0f}")

print("\nBALANCE CHECK")
counts = []
for name, _, files in folders:
    if name in SENTENCE_LABELS:
        counts.append(len(files))
if len(counts) > 0 and max(counts) > 2 * min(counts):
    print(f"  Sentence: IMBALANCED (min={min(counts)}, max={max(counts)})")
else:
    print("  Sentence: Balanced")

counts = []
for name, _, files in folders:
    if name in WORD_LABELS:
        counts.append(len(files))
if len(counts) > 0 and max(counts) > 2 * min(counts):
    print(f"  Word: IMBALANCED (min={min(counts)}, max={max(counts)})")
else:
    print("  Word: Balanced")

print("\nOUTLIER CHECK")
for group_name, lengths in [("Sentence", sent_lengths), ("Word", word_lengths)]:
    arr = np.array(lengths, dtype=np.float32)
    q1 = np.percentile(arr, 25)
    q3 = np.percentile(arr, 75)
    iqr = q3 - q1
    low = q1 - 1.5 * iqr
    high = q3 + 1.5 * iqr
    outliers = 0
    for v in lengths:
        if v < low or v > high:
            outliers = outliers + 1
    print(f"  {group_name}: outliers={outliers}/{len(lengths)}")

print("\nNORMALIZATION CHECK")
means = []
stds = []
for name, _, files in folders:
    if name in SENTENCE_LABELS:
        for fpath in files[:5]:
            emg, _ = read_emg(fpath)
            means.append(float(np.mean(emg)))
            stds.append(float(np.std(emg)))
if len(means) > 0:
    print(f"  Sentence: mean={np.mean(means):.1f}  std={np.mean(stds):.1f}")

means = []
stds = []
for name, _, files in folders:
    if name in WORD_LABELS:
        for fpath in files[:5]:
            emg, _ = read_emg(fpath)
            means.append(float(np.mean(emg)))
            stds.append(float(np.std(emg)))
if len(means) > 0:
    print(f"  Word: mean={np.mean(means):.1f}  std={np.mean(stds):.1f}")

print("\nCHANNEL INFO")
for name, _, files in folders:
    _, data = read_emg(files[0])
    print(f"  {name:25s}  channels={data.shape[1]}  samples={data.shape[0]}")

print("\nFEATURES (RMS, MAV, ZC)")
for name, _, files in folders:
    rms_vals = []
    mav_vals = []
    zc_vals = []
    for fpath in files[:5]:
        emg, _ = read_emg(fpath)
        rms_vals.append(float(np.sqrt(np.mean(emg ** 2))))
        mav_vals.append(float(np.mean(np.abs(emg))))
        zc = 0
        for i in range(1, len(emg)):
            if (emg[i - 1] > 0 and emg[i] < 0) or (emg[i - 1] < 0 and emg[i] > 0):
                zc = zc + 1
        zc_vals.append(zc)
    print(f"  {name:25s}  RMS={np.mean(rms_vals):.1f}  MAV={np.mean(mav_vals):.1f}  ZC={np.mean(zc_vals):.0f}")

print("\nSAVE ONE WAVEFORM PLOT PER CLASS")
for name, _, files in folders:
    emg, _ = read_emg(files[0])
    plt.figure(figsize=(10, 3))
    plt.plot(emg, linewidth=0.5)
    plt.title("Waveform: " + name)
    plt.tight_layout()
    plt.savefig(PLOTS_DIR / ("waveform_" + name.replace(" ", "_") + ".png"), dpi=150)
    plt.close()
print("  Saved plots to:", PLOTS_DIR)

if SPLIT_FILE.exists():
    print("\nTRAIN / VAL / TEST SPLIT")
    f = open(SPLIT_FILE, "r", encoding="utf-8")
    all_rows = list(csv.DictReader(f))
    f.close()
    for dt in ["sentence", "word"]:
        tr = 0
        va = 0
        te = 0
        for r in all_rows:
            if r["type"] == dt and r["split"] == "train":
                tr = tr + 1
            if r["type"] == dt and r["split"] == "val":
                va = va + 1
            if r["type"] == dt and r["split"] == "test":
                te = te + 1
        print(f"  {dt.capitalize():10s}  train={tr}  val={va}  test={te}")