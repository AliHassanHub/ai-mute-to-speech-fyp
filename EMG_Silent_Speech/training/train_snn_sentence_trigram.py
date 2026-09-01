import csv
import json
import math
import random
import sys
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix


BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from preprocessing.core.channel_processing import extract_emg_signal
from preprocessing.core.signal_cleaning import normalize_signal, remove_offset, validate_signal
from preprocessing.core.signal_length import resize_signal
from preprocessing.core.signal_reader import read_signal


CONFIG_PATH = BASE_DIR / "config" / "snn_sentence_trigram_config.json"
MODELS_DIR = BASE_DIR / "models"
RESULTS_DIR = BASE_DIR / "results"


class SignalEncoder(nn.Module):
    def __init__(self, embedding_dim):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Conv1d(1, 16, kernel_size=9, padding=4),
            nn.BatchNorm1d(16),
            nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Conv1d(16, 32, kernel_size=7, padding=3),
            nn.BatchNorm1d(32),
            nn.ReLU(),
            nn.MaxPool1d(2),
            nn.Conv1d(32, 64, kernel_size=5, padding=2),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.AdaptiveAvgPool1d(1),
        )
        self.final = nn.Linear(64, embedding_dim)

    def forward(self, x):
        x = self.layers(x).squeeze(-1)
        x = self.final(x)
        return F.normalize(x, dim=1)


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def read_rows(path):
    with Path(path).open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))

    clean_rows = []
    seen = set()
    for row in rows:
        if row["path"] in seen:
            continue
        seen.add(row["path"])
        clean_rows.append(row)
    return clean_rows


def prepare_rows(rows, config):
    signals = []
    labels = []

    for row in rows:
        signal = read_signal(row["path"])
        signal = extract_emg_signal(signal, int(config["emg_column_index"]))
        signal = validate_signal(signal)
        signal = remove_offset(signal)
        signal = normalize_signal(signal, config["normalization_type"])
        signal = resize_signal(signal, int(config["target_length"]))
        signals.append(signal.astype(np.float32)[None, :])
        labels.append(int(row["label_id"]))

    return np.stack(signals), np.asarray(labels, dtype=np.int64)


def group_indices_by_label(labels):
    groups = {}
    for index, label in enumerate(labels):
        label = int(label)
        if label not in groups:
            groups[label] = []
        groups[label].append(index)
    return groups


def make_training_pairs(signals, labels, pair_count):
    groups = group_indices_by_label(labels)
    label_keys = sorted(groups.keys())

    first_list = []
    second_list = []
    target_list = []

    for _ in range(pair_count):
        use_same = random.random() < 0.5
        label = random.choice(label_keys)
        first_index = random.choice(groups[label])

        if use_same and len(groups[label]) > 1:
            second_index = random.choice(groups[label])
            while second_index == first_index:
                second_index = random.choice(groups[label])
            target = 1.0
        else:
            other_labels = []
            for value in label_keys:
                if value != label:
                    other_labels.append(value)
            other_label = random.choice(other_labels)
            second_index = random.choice(groups[other_label])
            target = 0.0

        first_list.append(signals[first_index])
        second_list.append(signals[second_index])
        target_list.append(target)

    first_tensor = torch.tensor(np.stack(first_list), dtype=torch.float32)
    second_tensor = torch.tensor(np.stack(second_list), dtype=torch.float32)
    target_tensor = torch.tensor(target_list, dtype=torch.float32)
    return first_tensor, second_tensor, target_tensor


def contrastive_loss(emb_a, emb_b, targets, margin=1.0):
    distance = F.pairwise_distance(emb_a, emb_b)
    same_loss = targets * distance.pow(2)
    diff_loss = (1.0 - targets) * torch.clamp(margin - distance, min=0.0).pow(2)
    return torch.mean(same_loss + diff_loss)


def train_encoder(model, signals, labels, config):
    optimizer = torch.optim.Adam(
        model.parameters(),
        lr=float(config["learning_rate"]),
        weight_decay=float(config["weight_decay"]),
    )
    batch_size = int(config["batch_size"])
    pair_count = int(config["pairs_per_epoch"])
    epoch_count = int(config["epochs"])
    losses = []

    for epoch in range(epoch_count):
        model.train()
        pair_a, pair_b, pair_targets = make_training_pairs(signals, labels, pair_count)
        batch_losses = []

        start = 0
        while start < pair_count:
            end = start + batch_size
            first_batch = pair_a[start:end]
            second_batch = pair_b[start:end]
            target_batch = pair_targets[start:end]

            emb_a = model(first_batch)
            emb_b = model(second_batch)
            loss = contrastive_loss(emb_a, emb_b, target_batch)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

            batch_losses.append(float(loss.item()))
            start = end

        mean_loss = float(np.mean(batch_losses))
        losses.append(mean_loss)
        print(f"Epoch {epoch + 1}: loss = {mean_loss:.4f}")

    return losses


def embed_signals(model, signals, batch_size=128):
    model.eval()
    all_embeddings = []

    with torch.no_grad():
        start = 0
        while start < len(signals):
            end = start + batch_size
            batch = torch.tensor(signals[start:end], dtype=torch.float32)
            all_embeddings.append(model(batch).cpu().numpy())
            start = end

    return np.concatenate(all_embeddings, axis=0)


def build_reference_bank(embeddings, labels, shots):
    bank = {}
    for label in sorted(set(labels.tolist())):
        indices = np.where(labels == label)[0]
        if shots == -1:
            bank[int(label)] = embeddings[indices]
        else:
            bank[int(label)] = embeddings[indices[:shots]]
    return bank


def predict_from_references(embeddings, reference_bank):
    ordered_labels = sorted(reference_bank.keys())
    predictions = []
    score_matrix = []

    for embedding in embeddings:
        row_scores = []
        best_label = None
        best_score = -1e9

        for label in ordered_labels:
            score = float(np.mean(reference_bank[label] @ embedding))
            row_scores.append(score)
            if score > best_score:
                best_score = score
                best_label = label

        predictions.append(best_label)
        score_matrix.append(row_scores)

    return np.asarray(predictions, dtype=np.int64), np.asarray(score_matrix, dtype=np.float32)


def build_trigram_language_model(sentences):
    vocab = {"</s>"}
    trigram_counts = {}
    bigram_counts = {}

    for sentence in sentences:
        for word in sentence.split():
            vocab.add(word)

    vocab_size = len(vocab)

    for sentence in sentences:
        tokens = ["<s>", "<s>"] + sentence.split() + ["</s>"]
        for i in range(2, len(tokens)):
            bigram = (tokens[i - 2], tokens[i - 1])
            trigram = (tokens[i - 2], tokens[i - 1], tokens[i])
            bigram_counts[bigram] = bigram_counts.get(bigram, 0) + 1
            trigram_counts[trigram] = trigram_counts.get(trigram, 0) + 1

    sentence_scores = {}
    for sentence in sorted(set(sentences)):
        tokens = ["<s>", "<s>"] + sentence.split() + ["</s>"]
        total_log = 0.0
        steps = 0

        for i in range(2, len(tokens)):
            bigram = (tokens[i - 2], tokens[i - 1])
            trigram = (tokens[i - 2], tokens[i - 1], tokens[i])
            numerator = trigram_counts.get(trigram, 0) + 1
            denominator = bigram_counts.get(bigram, 0) + vocab_size
            total_log += math.log(numerator / denominator)
            steps += 1

        sentence_scores[sentence] = total_log / steps

    return {"sentence_scores": sentence_scores, "vocab": sorted(vocab)}


def apply_language_model(score_matrix, ordered_labels, label_names, lm_data, lm_weight):
    adjusted = score_matrix.copy()

    for column, label_id in enumerate(ordered_labels):
        sentence = label_names[label_id]
        adjusted[:, column] += lm_weight * lm_data["sentence_scores"][sentence]

    best_columns = np.argmax(adjusted, axis=1)
    final_predictions = []
    for column in best_columns:
        final_predictions.append(ordered_labels[int(column)])

    return np.asarray(final_predictions, dtype=np.int64)


def save_reference_bank(rows, embeddings, labels, ordered_labels, shots):
    vectors = []
    vector_labels = []
    vector_paths = []

    for label_id in ordered_labels:
        indices = np.where(labels == label_id)[0]
        if shots != -1:
            indices = indices[:shots]

        for index in indices:
            vectors.append(embeddings[index])
            vector_labels.append(int(label_id))
            vector_paths.append(rows[index]["path"])

    np.savez(
        RESULTS_DIR / "snn_sentence_reference_bank.npz",
        embeddings=np.asarray(vectors, dtype=np.float32),
        labels=np.asarray(vector_labels, dtype=np.int64),
        paths=np.asarray(vector_paths),
    )


def plot_confusion(cm, class_names, path):
    plt.figure(figsize=(7, 5))
    plt.imshow(cm, cmap="Oranges")
    plt.xticks(range(len(class_names)), class_names, rotation=30, ha="right")
    plt.yticks(range(len(class_names)), class_names)
    plt.colorbar()
    plt.tight_layout()
    plt.savefig(path, dpi=180)
    plt.close()


def plot_loss(losses, path):
    plt.figure(figsize=(7, 4))
    plt.plot(range(1, len(losses) + 1), losses, color="#c45a1a")
    plt.xlabel("Epoch")
    plt.ylabel("Contrastive loss")
    plt.tight_layout()
    plt.savefig(path, dpi=180)
    plt.close()


def main():
    config = load_json(CONFIG_PATH)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    seed = int(config["random_seed"])
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.set_num_threads(1)

    train_rows = read_rows(config["train_split_path"])
    val_rows = read_rows(config["val_split_path"])
    test_rows = read_rows(config["test_split_path"])

    label_names = {}
    for row in train_rows + val_rows + test_rows:
        label_names[int(row["label_id"])] = row["label"]

    ordered_labels = sorted(label_names.keys())
    class_names = [label_names[label_id] for label_id in ordered_labels]

    x_train, y_train = prepare_rows(train_rows, config)
    x_val, y_val = prepare_rows(val_rows, config)
    x_test, y_test = prepare_rows(test_rows, config)

    model = SignalEncoder(int(config["embedding_dim"]))
    losses = train_encoder(model, x_train, y_train, config)

    train_embeddings = embed_signals(model, x_train)
    val_embeddings = embed_signals(model, x_val)
    train_sentences = [row["label"] for row in train_rows]
    train_lm = build_trigram_language_model(train_sentences)

    best_choice = None
    for shots in config["candidate_reference_shots"]:
        bank = build_reference_bank(train_embeddings, y_train, int(shots))
        _, val_scores = predict_from_references(val_embeddings, bank)

        for lm_weight in config["candidate_lm_weights"]:
            val_predictions = apply_language_model(
                val_scores,
                ordered_labels,
                label_names,
                train_lm,
                float(lm_weight),
            )
            val_accuracy = float(accuracy_score(y_val, val_predictions))

            if best_choice is None or val_accuracy > best_choice["val_accuracy"]:
                best_choice = {
                    "reference_shots": int(shots),
                    "lm_weight": float(lm_weight),
                    "val_accuracy": val_accuracy,
                }

    all_train_rows = train_rows + val_rows
    x_train_full, y_train_full = prepare_rows(all_train_rows, config)
    train_full_embeddings = embed_signals(model, x_train_full)
    test_embeddings = embed_signals(model, x_test)

    final_bank = build_reference_bank(train_full_embeddings, y_train_full, int(best_choice["reference_shots"]))
    _, test_scores = predict_from_references(test_embeddings, final_bank)
    final_lm = build_trigram_language_model([row["label"] for row in all_train_rows])
    final_predictions = apply_language_model(
        test_scores,
        ordered_labels,
        label_names,
        final_lm,
        float(best_choice["lm_weight"]),
    )
    final_accuracy = float(accuracy_score(y_test, final_predictions))

    torch.save(
        {
            "model_state_dict": model.state_dict(),
            "embedding_dim": int(config["embedding_dim"]),
            "input_channels": 1,
            "emg_column_index": int(config["emg_column_index"]),
            "target_length": int(config["target_length"]),
            "normalization_type": config["normalization_type"],
        },
        MODELS_DIR / "snn_sentence_encoder.pt",
    )

    save_reference_bank(
        all_train_rows,
        train_full_embeddings,
        y_train_full,
        ordered_labels,
        int(best_choice["reference_shots"]),
    )

    (RESULTS_DIR / "snn_trigram_language_model.json").write_text(
        json.dumps(final_lm, indent=2),
        encoding="utf-8",
    )

    confusion = confusion_matrix(y_test, final_predictions, labels=ordered_labels)
    plot_confusion(confusion, class_names, RESULTS_DIR / "snn_sentence_confusion.png")
    plot_loss(losses, RESULTS_DIR / "snn_sentence_training_loss.png")

    metrics = {
        "train_samples": len(train_rows),
        "val_samples": len(val_rows),
        "train_plus_val_samples": len(all_train_rows),
        "test_samples": len(test_rows),
        "num_classes": len(class_names),
        "signal_type": "single_channel_emg",
        "input_channels": 1,
        "emg_column_index": int(config["emg_column_index"]),
        "target_length": int(config["target_length"]),
        "embedding_dim": int(config["embedding_dim"]),
        "selected_reference_shots": int(best_choice["reference_shots"]),
        "selected_lm_weight": float(best_choice["lm_weight"]),
        "best_val_accuracy": round(float(best_choice["val_accuracy"]), 6),
        "final_test_accuracy": round(final_accuracy, 6),
        "classification_report": classification_report(
            y_test,
            final_predictions,
            labels=ordered_labels,
            target_names=class_names,
            output_dict=True,
            zero_division=0,
        ),
    }

    (RESULTS_DIR / "snn_sentence_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")

    print("Train samples:", len(train_rows))
    print("Val samples:", len(val_rows))
    print("Train+Val samples:", len(all_train_rows))
    print("Test samples:", len(test_rows))
    print("Selected reference shots:", int(best_choice["reference_shots"]))
    print("Selected LM weight:", float(best_choice["lm_weight"]))
    print("Best val accuracy:", round(float(best_choice["val_accuracy"]), 4))
    print("Final test accuracy:", round(final_accuracy, 4))
    print("Results folder:", RESULTS_DIR)


if __name__ == "__main__":
    main()
