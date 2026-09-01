import csv
import random
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.metrics import accuracy_score, confusion_matrix, precision_recall_fscore_support
import matplotlib.pyplot as plt

PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from training.labels import SENTENCE_LABELS
from preprocessing.core.channel_processing import extract_emg_and_pot

from preprocessing.core.signal_cleaning import normalize_signal, remove_offset, validate_signal
from preprocessing.core.signal_length import resize_signal
from preprocessing.core.signal_reader import read_signal
def word_folders_sorted(dataset_dir):
    root = Path(dataset_dir)
    if not root.is_dir():
        return []
    out = []
    for folder in sorted(root.iterdir()):
        if folder.is_dir() and folder.name not in SENTENCE_LABELS and list(folder.glob("*.txt")):
            out.append(folder.name)
    return out

DATASET_DIR = PROJECT_DIR / "captures"
SPLIT_CSV = PROJECT_DIR / "preprocessing" / "outputs" / "all_split.csv"
MODELS_DIR = PROJECT_DIR / "training" / "models"
RESULTS_DIR = PROJECT_DIR / "training" / "results"

BATCH_SIZE = 64


class SignalEncoder(nn.Module):
    def __init__(self, embedding_dim):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Conv1d(2, 16, 9, padding=4), nn.BatchNorm1d(16), nn.ReLU(), nn.MaxPool1d(2),
            nn.Conv1d(16, 32, 7, padding=3), nn.BatchNorm1d(32), nn.ReLU(), nn.MaxPool1d(2),
            nn.Conv1d(32, 64, 5, padding=2), nn.BatchNorm1d(64), nn.ReLU(),
            nn.AdaptiveAvgPool1d(1),
        )
        self.final = nn.Linear(64, embedding_dim)

    def forward(self, x):
        return F.normalize(self.final(self.layers(x).squeeze(-1)), dim=1)



def preprocess_file(path, target_length):
    sig = read_signal(path)
    # Training expects at least 2 columns (EMG + POT). Some datasets may have only 2 columns.
    # If POT column (index=3) doesn't exist, fall back to last available column.
    pot_index = 3
    if sig.shape[1] <= pot_index:
        pot_index = sig.shape[1] - 1
    emg_pot = extract_emg_and_pot(sig, emg_column_index=1, pot_column_index=pot_index)  # (T,2)

    # validate + normalize per channel (validate_signal only supports 1D)
    emg = emg_pot[:, 0]
    pot = emg_pot[:, 1]
    emg = remove_offset(validate_signal(emg))
    pot = remove_offset(validate_signal(pot))
    emg = normalize_signal(emg, "zscore")
    pot = normalize_signal(pot, "zscore")
    # resize each channel to target_length
    emg = resize_signal(emg, target_length)
    pot = resize_signal(pot, target_length)

    x = np.stack([emg, pot], axis=0).astype(np.float32)  # (2,T)
    return x




def augment(sig):
    noise = np.random.randn(*sig.shape).astype(np.float32) * 0.05
    return (sig * np.random.uniform(0.9, 1.1) + noise).astype(np.float32)


def make_split_file():
    rows = []
    random.seed(42)
    word_names = word_folders_sorted(DATASET_DIR)
    for folder in sorted(DATASET_DIR.iterdir()):
        if not folder.is_dir():
            continue
        name = folder.name
        if name in SENTENCE_LABELS:
            rtype, lid = "sentence", SENTENCE_LABELS.index(name)
        elif name in word_names:
            rtype, lid = "word", word_names.index(name)
        else:
            continue
        for p in sorted(folder.glob("*.txt")):
            r = random.random()
            split = "train" if r < 0.7 else ("val" if r < 0.85 else "test")
            rows.append({"path": str(p), "label": name, "label_id": lid,
                         "type": rtype, "split": split})

    SPLIT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with SPLIT_CSV.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["path", "label", "label_id", "type", "split"])
        w.writeheader()
        w.writerows(rows)


def load_split(row_type, split):
    with SPLIT_CSV.open("r", encoding="utf-8", newline="") as f:
        return [r for r in csv.DictReader(f)
                if r["type"] == row_type and r["split"] == split]


def make_pairs(signals, labels, n_pairs, do_augment=False):
    groups = defaultdict(list)
    for i, lab in enumerate(labels):
        groups[int(lab)].append(i)
    all_labels = sorted(groups)

    a_list, b_list, t_list = [], [], []
    for _ in range(n_pairs):
        la = random.choice(all_labels)
        ia = random.choice(groups[la])
        if random.random() < 0.5 and len(groups[la]) > 1:
            ib = random.choice([j for j in groups[la] if j != ia])
            t_list.append(1.0)
        else:
            lb = random.choice([l for l in all_labels if l != la])
            ib = random.choice(groups[lb])
            t_list.append(0.0)
        sa, sb = signals[ia], signals[ib]
        if do_augment:
            sa, sb = augment(sa), augment(sb)
        a_list.append(sa)
        b_list.append(sb)

    return (torch.tensor(np.stack(a_list), dtype=torch.float32),
            torch.tensor(np.stack(b_list), dtype=torch.float32),
            torch.tensor(t_list, dtype=torch.float32))


def contrastive_loss(ea, eb, targets, margin=1.0):
    d = F.pairwise_distance(ea, eb)
    return (targets * d ** 2 + (1 - targets) * torch.clamp(margin - d, min=0) ** 2).mean()


def train_loop(model, signals, labels, epochs, n_pairs, do_augment=False):
    opt = torch.optim.Adam(model.parameters(), lr=1e-3, weight_decay=1e-4)

    for ep in range(epochs):
        model.train()
        pa, pb, pt = make_pairs(signals, labels, n_pairs, do_augment)
        losses = []
        for i in range(0, n_pairs, BATCH_SIZE):
            ea = model(pa[i:i + BATCH_SIZE])
            eb = model(pb[i:i + BATCH_SIZE])
            loss = contrastive_loss(ea, eb, pt[i:i + BATCH_SIZE])
            opt.zero_grad()
            loss.backward()
            opt.step()
            losses.append(loss.item())
        print(f"  Epoch {ep + 1}/{epochs}: loss = {np.mean(losses):.4f}")


def embed_all(model, signals):
    model.eval()
    with torch.no_grad():
        return np.stack([
            model(torch.tensor(s).unsqueeze(0)).cpu().numpy()[0]
            for s in signals
        ])


def build_bank(embeddings, labels, keep_all=False, keep_k=1):
    bank = {}
    for lab in sorted(set(labels.tolist())):
        if keep_all:
            bank[int(lab)] = embeddings[labels == lab]
        else:
            group = embeddings[labels == lab]
            if keep_k > 1:
                bank[int(lab)] = group[:keep_k]
            else:
                c = group.mean(axis=0)
                n = np.linalg.norm(c)
                bank[int(lab)] = (c / n if n > 0 else c)[None, :]
    return bank


def predict(embeddings, bank):
    keys = sorted(bank.keys())
    preds = []
    for emb in embeddings:
        best = None
        best_score = -1e9
        for k in keys:
            refs = bank[k]
            score = float(np.max(refs @ emb))
            if score > best_score:
                best_score = score
                best = k
        preds.append(best)
    return np.array(preds, dtype=np.int64)


def show_metrics(y_true, y_pred, title):
    acc = accuracy_score(y_true, y_pred)
    p, r, f1, _ = precision_recall_fscore_support(
        y_true, y_pred, average="macro", zero_division=0)
    print(f"\n{title}")
    print(f"  Accuracy: {acc:.4f}  Precision: {p:.4f}  Recall: {r:.4f}  F1: {f1:.4f}")


def save_confusion(y_true, y_pred, names, path):
    cm = confusion_matrix(y_true, y_pred, labels=list(range(len(names))))
    plt.figure(figsize=(6, 4))
    plt.imshow(cm, cmap="Oranges")
    plt.xticks(range(len(names)), names, rotation=30, ha="right")
    plt.yticks(range(len(names)), names)
    plt.colorbar()
    plt.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(path, dpi=180)
    plt.close()

def train_and_evaluate(row_type, ModelClass, label_names, target_length,
                       embedding_dim, epochs, n_pairs, do_augment,
                       model_path, bank_path, conf_path,
                       keep_all_refs=False, keep_k=1):
    print(f"\n=== {row_type.title()} Model ===")
    train_rows = load_split(row_type, "train")
    test_rows = load_split(row_type, "test")
    if not train_rows:
        print(f"No {row_type} rows found, skipping.")
        return

    x_train = np.stack([preprocess_file(r["path"], target_length) for r in train_rows])
    y_train = np.array([int(r["label_id"]) for r in train_rows], dtype=np.int64)
    x_test = np.stack([preprocess_file(r["path"], target_length) for r in test_rows])
    y_test = np.array([int(r["label_id"]) for r in test_rows], dtype=np.int64)

    model = ModelClass(embedding_dim)
    train_loop(model, x_train, y_train, epochs, n_pairs, do_augment)

    train_emb = embed_all(model, x_train)
    test_emb = embed_all(model, x_test)
    bank = build_bank(train_emb, y_train, keep_all=keep_all_refs, keep_k=keep_k)
    rng = np.random.RandomState(42)
    idx = np.arange(len(train_emb))
    rng.shuffle(idx)
    cut = max(1, int(len(idx) * 0.8))
    train_a = idx[:cut]
    train_b = idx[cut:]
    if len(train_b) == 0:
        train_b = train_a
    bank_holdout = build_bank(train_emb[train_a], y_train[train_a], keep_all=keep_all_refs, keep_k=keep_k)
    train_preds = predict(train_emb[train_b], bank_holdout)
    preds = predict(test_emb, bank)

    model_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save({"model_state_dict": model.state_dict(), "embedding_dim": embedding_dim,
                "target_length": target_length, "label_names": label_names}, model_path)

    ids = sorted(bank.keys())
    bank_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        bank_path,
        embeddings=np.array([bank[i][0] for i in ids], dtype=np.float32),
        labels=np.array(ids, dtype=np.int64),
        label_names=np.array(label_names, dtype=object),
    )

    show_metrics(y_train[train_b], train_preds, f"{row_type.title()} Train (Holdout)")
    show_metrics(y_test, preds, f"{row_type.title()} Test")
    save_confusion(y_test, preds, label_names, conf_path)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Train the EMG models from local capture folders.")
    parser.add_argument("--data-dir", default=str(DATASET_DIR), help="Dataset root with one folder per label")
    args = parser.parse_args()

    dataset_dir = Path(args.data_dir)
    globals()["DATASET_DIR"] = dataset_dir

    random.seed(42)
    np.random.seed(42)
    torch.manual_seed(42)
    torch.set_num_threads(1)

    make_split_file()
    word_names = word_folders_sorted(DATASET_DIR)

    train_and_evaluate(
        "sentence", SignalEncoder, list(SENTENCE_LABELS), 768, 64, 8, 1024,
        do_augment=False,
        model_path=MODELS_DIR / "snn_sentence_encoder.pt",
        bank_path=RESULTS_DIR / "snn_sentence_reference_bank.npz",
        conf_path=RESULTS_DIR / "snn_sentence_confusion.png",
    )
    if len(word_names) >= 2:
        train_and_evaluate(
            "word", SignalEncoder, word_names, 384, 64, 25, 4096,
            do_augment=True,

            model_path=MODELS_DIR / "snn_word_encoder.pt",

            bank_path=RESULTS_DIR / "snn_word_reference_bank.npz",
            conf_path=RESULTS_DIR / "word_confusion.png",
            keep_all_refs=False,
        )
    elif word_names:
        print("\nOnly one word class found in captures/. Capture at least two different words for full word-model retraining.")


if __name__ == "__main__":
    main()
