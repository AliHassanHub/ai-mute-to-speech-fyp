import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from runtime.signal_io import POT_MAX, normalize_emg, normalize_pot, read_capture, resize_1d
from runtime.session_adaptation import array_to_profile, build_training_profile, profile_to_array
from runtime.user_calibration import UserCalibrationContext
from training.labels import SENTENCE_LABELS

CAPTURES_DIR = PROJECT_DIR / "captures"
RESULTS_DIR = PROJECT_DIR / "training" / "results"
MODEL_PATH = RESULTS_DIR / "calibrated_word_model.npz"
MODEL_PATH_V1_BACKUP = RESULTS_DIR / "calibrated_word_model_v1.npz"
MODEL_PATH_V2 = RESULTS_DIR / "calibrated_word_model_v2.npz"

FEATURE_LENGTH = 96
MIN_SAMPLES = 50
MAX_SAMPLES = 1800
POT_GATE_PAD = 3.0
# Recommended minimum usable captures before a new word is admitted to the model.
MIN_USABLE_CAPTURES_FOR_EXTENSION = 8


@dataclass
class Prediction:
    label: str
    best_label: str
    confidence: float
    accepted: bool
    distance: float
    margin: float


def word_folders(data_dir=CAPTURES_DIR):
    root = Path(data_dir)
    if not root.is_dir():
        return []
    return [
        folder
        for folder in sorted(root.iterdir())
        if folder.is_dir() and folder.name not in SENTENCE_LABELS and list(folder.glob("*.txt"))
    ]


def capture_stats(capture):
    arr = np.asarray(capture, dtype=np.float32)
    emg = arr[:, 0]
    pot = arr[:, 1]
    return {
        "samples": int(arr.shape[0]),
        "emg_mean": float(np.mean(emg)),
        "emg_std": float(np.std(emg)),
        "emg_range": float(np.percentile(emg, 95) - np.percentile(emg, 5)),
        "pot_mean": float(np.mean(pot)),
        "pot_std": float(np.std(pot)),
    }


def quality_reason(capture):
    arr = np.asarray(capture, dtype=np.float32)
    if arr.ndim != 2 or arr.shape[1] != 2:
        return "bad-shape"
    if arr.shape[0] < MIN_SAMPLES:
        return f"too-short:{arr.shape[0]}"
    if arr.shape[0] > MAX_SAMPLES:
        return f"stale-buffer-suspected:samples={arr.shape[0]}"
    if not np.isfinite(arr).all():
        return "nan-or-inf"
    stats = capture_stats(arr)
    if stats["emg_std"] < 8.0 and stats["emg_range"] < 50.0:
        return f"flat-emg:std={stats['emg_std']:.1f}"
    if stats["pot_std"] > 3.5:
        return f"unstable-pot:std={stats['pot_std']:.1f}"
    return "ok"


def _smooth(values, window=9):
    values = np.asarray(values, dtype=np.float32).reshape(-1)
    if values.size < 3:
        return values.copy()
    window = max(3, min(window, values.size))
    kernel = np.ones(window, dtype=np.float32) / float(window)
    return np.convolve(values, kernel, mode="same").astype(np.float32)


def _event_crop(values):
    values = np.asarray(values, dtype=np.float32).reshape(-1)
    if values.size < 16:
        return values
    env = _smooth(np.abs(normalize_emg(values)), window=max(5, min(41, values.size // 20)))
    peak = int(np.argmax(env))
    width = max(80, min(values.size, int(values.size * 0.55)))
    start = max(0, min(values.size - width, peak - width // 2))
    return values[start : start + width]


def augment_capture(capture, rng):
    arr = np.asarray(capture, dtype=np.float32).copy()
    if arr.shape[0] < 4:
        return arr
    shift = int(rng.integers(-max(1, arr.shape[0] // 30), max(2, arr.shape[0] // 30 + 1)))
    arr[:, 0] = np.roll(arr[:, 0], shift)
    arr[:, 0] *= float(rng.uniform(0.92, 1.08))
    noise = float(np.std(arr[:, 0]) or 1.0) * float(rng.uniform(0.005, 0.025))
    arr[:, 0] += rng.normal(0.0, noise, size=arr.shape[0]).astype(np.float32)
    arr[:, 1] += rng.normal(0.0, 0.35, size=arr.shape[0]).astype(np.float32)
    arr[:, 0] = np.clip(arr[:, 0], 0.0, 4095.0)
    arr[:, 1] = np.clip(arr[:, 1], 0.0, POT_MAX)
    return arr


def extract_features(capture):
    arr = np.asarray(capture, dtype=np.float32)
    if arr.ndim != 2 or arr.shape[1] != 2:
        raise ValueError("expected capture array with shape (samples, 2)")
    if arr.shape[0] < 4:
        raise ValueError("capture is too short for feature extraction")

    emg_raw_full = np.clip(arr[:, 0], 0.0, 4095.0)
    emg_raw = _event_crop(emg_raw_full)
    emg_norm = normalize_emg(emg_raw)
    envelope = _smooth(np.abs(emg_norm), window=max(3, min(31, len(emg_norm) // 12 or 3)))
    derivative = np.diff(emg_norm, prepend=emg_norm[0])

    shape = resize_1d(emg_norm, FEATURE_LENGTH) * 0.55
    env = resize_1d(envelope, FEATURE_LENGTH // 2) * 0.85
    diff = resize_1d(derivative, FEATURE_LENGTH // 2) * 0.20

    baseline = float(np.median(emg_raw_full))
    centered_full = emg_raw_full - baseline
    robust_scale = float(np.percentile(np.abs(centered_full), 95))
    if robust_scale < 1e-6:
        robust_scale = float(np.std(centered_full))
    if robust_scale < 1e-6:
        robust_scale = 1.0
    rel_full = np.clip(centered_full / robust_scale, -5.0, 5.0)
    abs_rel = np.abs(rel_full)
    p10, p25, p50, p75, p90 = np.percentile(abs_rel, [10, 25, 50, 75, 90])
    active = abs_rel > max(0.25, np.percentile(abs_rel, 65))
    stats = np.asarray(
        [
            np.mean(rel_full),
            np.std(rel_full),
            p10,
            p25,
            p50,
            p75,
            p90,
            p90 - p10,
            np.sqrt(np.mean(np.square(rel_full))),
            float(np.mean(active)),
            np.mean(np.abs(derivative)) / 5.0,
        ],
        dtype=np.float32,
    ) * 0.9
    return np.concatenate([shape, env, diff, stats]).astype(np.float32)


def _feature_matrix(records, augment_count=0, seed=42):
    rng = np.random.default_rng(seed)
    xs = []
    ys = []
    file_ids = []
    for file_id, (label_id, path, capture) in enumerate(records):
        xs.append(extract_features(capture))
        ys.append(label_id)
        file_ids.append(file_id)
        for _ in range(augment_count):
            xs.append(extract_features(augment_capture(capture, rng)))
            ys.append(label_id)
            file_ids.append(file_id)
    return np.vstack(xs), np.asarray(ys, dtype=np.int64), np.asarray(file_ids, dtype=np.int64)


def _make_scaler(x):
    center = np.median(x, axis=0)
    scale = np.percentile(np.abs(x - center), 75, axis=0)
    scale = np.maximum(scale, 0.03)
    return center.astype(np.float32), scale.astype(np.float32)


def _distances(x_scaled, refs):
    diff = refs - x_scaled.reshape(1, -1)
    return np.sqrt(np.mean(np.square(diff), axis=1))


def _class_distance(x_scaled, references, reference_labels, label_id, k=3):
    d = _distances(x_scaled, references[reference_labels == label_id])
    if d.size == 0:
        return float("inf")
    return float(np.mean(np.sort(d)[: min(k, d.size)]))


def _predict_scaled(x_scaled, pot_value, references, reference_labels, pot_centers, pot_radii, thresholds):
    labels = list(range(len(pot_centers)))
    pot_dist = np.abs(np.asarray(pot_centers, dtype=np.float32) - float(pot_value))
    nearest_pot = int(np.argmin(pot_dist))
    second_pot = float(np.partition(pot_dist, 1)[1]) if len(pot_dist) > 1 else float("inf")
    pot_gap = second_pot - float(pot_dist[nearest_pot]) if np.isfinite(second_pot) else float("inf")

    allowed = []
    for label_id in labels:
        gate = max(POT_GATE_PAD, float(pot_radii[label_id]) + POT_GATE_PAD)
        if pot_dist[label_id] <= gate:
            allowed.append(label_id)
    if not allowed:
        allowed = [nearest_pot]
    elif nearest_pot not in allowed:
        allowed.append(nearest_pot)

    raw_class_distances = np.asarray(
        [_class_distance(x_scaled, references, reference_labels, label_id) for label_id in labels],
        dtype=np.float32,
    )
    final_distances = np.full(len(labels), np.inf, dtype=np.float32)
    for label_id in allowed:
        pot_penalty = 0.18 * (pot_dist[label_id] / max(POT_GATE_PAD, float(pot_radii[label_id]) + 1.0))
        final_distances[label_id] = raw_class_distances[label_id] + pot_penalty

    order = np.argsort(final_distances)
    best = int(order[0])
    second = float(final_distances[order[1]]) if len(order) > 1 and np.isfinite(final_distances[order[1]]) else float("inf")
    best_distance = float(final_distances[best])
    margin = second - best_distance if np.isfinite(second) else pot_gap
    return best, best_distance, float(margin), raw_class_distances, pot_dist, pot_gap


def load_records(data_dir=CAPTURES_DIR):
    records = []
    labels = []
    raw_counts = []
    for label_id, folder in enumerate(word_folders(data_dir)):
        labels.append(folder.name)
        files = sorted(folder.glob("*.txt"))
        raw_counts.append((folder.name, len(files)))
        for path in files:
            records.append((label_id, path, read_capture(path)))
    return labels, records, raw_counts


def _pot_cluster_keep_indices(group):
    if len(group) <= 3:
        return set(range(len(group)))
    pot_means = np.asarray([capture_stats(item[2])["pot_mean"] for item in group], dtype=np.float32)
    if float(np.max(pot_means) - np.min(pot_means)) < 4.0:
        return set(range(len(group)))

    order = np.argsort(pot_means)
    window = max(3, int(math.ceil(len(group) * 0.60)))
    best_start = 0
    best_span = float("inf")
    for start in range(0, len(group) - window + 1):
        vals = pot_means[order[start : start + window]]
        span = float(vals[-1] - vals[0])
        if span < best_span:
            best_span = span
            best_start = start
    chosen = order[best_start : best_start + window]
    center = float(np.median(pot_means[chosen]))
    tolerance = max(2.0, best_span + 0.5)
    return {i for i, value in enumerate(pot_means) if abs(float(value) - center) <= tolerance}


def select_usable_records(label_names, records):
    good_by_label = {i: [] for i in range(len(label_names))}
    rejected = []
    for label_id, path, capture in records:
        reason = quality_reason(capture)
        if reason == "ok":
            good_by_label[label_id].append((label_id, path, capture))
        else:
            rejected.append((str(path), label_names[label_id], reason))

    clustered = []
    raw_usable_counts = []
    for old_label_id, name in enumerate(label_names):
        group = good_by_label[old_label_id]
        keep = _pot_cluster_keep_indices(group)
        kept_count = 0
        for i, item in enumerate(group):
            if i in keep:
                clustered.append(item)
                kept_count += 1
            else:
                pot = capture_stats(item[2])["pot_mean"]
                rejected.append((str(item[1]), name, f"pot-cluster-outlier:pot={pot:.1f}"))
        raw_count = sum(1 for rec in records if rec[0] == old_label_id)
        raw_usable_counts.append((old_label_id, name, raw_count, kept_count))

    old_ids = sorted({item[0] for item in clustered})
    remap = {old_id: new_id for new_id, old_id in enumerate(old_ids)}
    usable_names = [label_names[old_id] for old_id in old_ids]
    usable_counts = [(name, raw, usable) for old_id, name, raw, usable in raw_usable_counts if old_id in remap]
    remapped_records = [(remap[label_id], path, capture) for label_id, path, capture in clustered if label_id in remap]
    return usable_names, remapped_records, usable_counts, raw_usable_counts, rejected


def _build_thresholds(x_scaled, y, label_count):
    thresholds = []
    for label_id in range(label_count):
        group = x_scaled[y == label_id]
        if len(group) <= 1:
            thresholds.append(1.25)
            continue
        dists = []
        for i in range(len(group)):
            refs = np.delete(group, i, axis=0)
            dists.append(float(np.min(_distances(group[i], refs))))
        thresholds.append(float(np.percentile(dists, 90) * 1.75 + 0.08))
    return np.asarray(thresholds, dtype=np.float32)


def _parse_summary_json(model):
    raw = model.get("summary_json")
    if not raw:
        return {}
    try:
        return json.loads(str(raw))
    except json.JSONDecodeError:
        return {}


def save_model_bundle(
    model_path,
    *,
    label_names,
    references,
    reference_labels,
    center,
    scale,
    pot_centers,
    pot_radii,
    thresholds,
    training_profile,
    max_accept_distance,
    min_margin,
    min_confidence,
    summary,
):
    model_path = Path(model_path)
    model_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        model_path,
        label_names=np.asarray(label_names, dtype=object),
        references=np.asarray(references, dtype=np.float32),
        reference_labels=np.asarray(reference_labels, dtype=np.int64),
        center=np.asarray(center, dtype=np.float32),
        scale=np.asarray(scale, dtype=np.float32),
        pot_centers=np.asarray(pot_centers, dtype=np.float32),
        pot_radii=np.asarray(pot_radii, dtype=np.float32),
        thresholds=np.asarray(thresholds, dtype=np.float32),
        training_profile=profile_to_array(training_profile),
        max_accept_distance=np.asarray(max_accept_distance, dtype=np.float32),
        min_margin=np.asarray(min_margin, dtype=np.float32),
        min_confidence=np.asarray(min_confidence, dtype=np.float32),
        summary_json=np.asarray(json.dumps(summary), dtype=object),
    )


def audit_calibration_candidates(
    data_dir=CAPTURES_DIR,
    active_labels=None,
    candidate_labels=None,
    min_usable_per_word=MIN_USABLE_CAPTURES_FOR_EXTENSION,
):
    """Report which words have enough real calibration captures to be extended."""
    from training.vocabulary import CANDIDATE_EXTENSION_LABELS

    active = list(active_labels or [])
    candidates = list(candidate_labels or CANDIDATE_EXTENSION_LABELS)
    root = Path(data_dir)
    report = []

    for label in candidates:
        if label in active:
            report.append(
                {
                    "label": label,
                    "status": "ALREADY_ACTIVE",
                    "raw_files": None,
                    "usable_files": None,
                    "required_usable": min_usable_per_word,
                    "rejected": [],
                }
            )
            continue

        folder = root / label
        if not folder.is_dir():
            report.append(
                {
                    "label": label,
                    "status": "CALIBRATION_DATA_MISSING",
                    "raw_files": 0,
                    "usable_files": 0,
                    "required_usable": min_usable_per_word,
                    "rejected": [],
                }
            )
            continue

        files = sorted(folder.glob("*.txt"))
        records = [(0, path, read_capture(path)) for path in files]
        _names, usable_records, _counts, _all_counts, rejected = select_usable_records(
            [label], records
        )
        usable_count = len(usable_records)
        status = "READY_FOR_EXTENSION" if usable_count >= min_usable_per_word else "INSUFFICIENT_CAPTURES"
        report.append(
            {
                "label": label,
                "status": status,
                "raw_files": len(files),
                "usable_files": usable_count,
                "required_usable": min_usable_per_word,
                "rejected": rejected,
            }
        )
    return report


def verify_label_regression(model_path, data_dir=CAPTURES_DIR, labels=None):
    """Ensure captures for the given labels still classify as before."""
    model = load_model(model_path)
    label_set = set(labels or model["label_names"])
    failures = []
    checked = 0
    for label_name in model["label_names"]:
        if label_name not in label_set:
            continue
        folder = Path(data_dir) / label_name
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.txt")):
            capture = read_capture(path)
            if quality_reason(capture) != "ok":
                continue
            expected = label_name
            result = predict_capture(capture, model_path=model_path)
            checked += 1
            if result.label != expected:
                failures.append(
                    {
                        "path": str(path),
                        "expected": expected,
                        "got": result.label,
                        "best_label": result.best_label,
                        "accepted": result.accepted,
                        "confidence": result.confidence,
                    }
                )
    return {"checked": checked, "failures": failures}


def extend_word_model(
    base_model_path=MODEL_PATH,
    data_dir=CAPTURES_DIR,
    output_path=MODEL_PATH_V2,
    target_labels=None,
    min_usable_per_word=MIN_USABLE_CAPTURES_FOR_EXTENSION,
    augment_count=None,
):
    """Append new calibrated words without rebuilding existing class references.

    Existing label references, scaler, thresholds, and POT metadata for the
    original classes are preserved byte-for-byte in the arrays. Only genuinely
    new labels discovered under ``captures/<label>/`` are admitted.
    """
    base_model_path = Path(base_model_path)
    output_path = Path(output_path)
    base = load_model(base_model_path)
    base_summary = _parse_summary_json(base)
    existing_labels = list(base["label_names"])
    existing_set = set(existing_labels)

    if augment_count is None:
        augment_count = int(base_summary.get("augment_count", 4))

    root = Path(data_dir)
    discovered = [
        folder.name
        for folder in word_folders(data_dir)
        if folder.name not in existing_set
    ]
    if target_labels is not None:
        requested = [str(label).strip() for label in target_labels if str(label).strip()]
        missing_folders = [label for label in requested if not (root / label).is_dir()]
        if missing_folders:
            raise ValueError(
                "Calibration data missing for: " + ", ".join(missing_folders)
            )
        new_labels = [label for label in requested if label not in existing_set]
    else:
        new_labels = discovered

    if not new_labels:
        summary = dict(base_summary)
        summary.update(
            {
                "extension": {
                    "mode": "append",
                    "base_model": str(base_model_path),
                    "added_labels": [],
                    "message": "No new labels requested; model copied unchanged.",
                }
            }
        )
        save_model_bundle(
            output_path,
            label_names=existing_labels,
            references=base["references"],
            reference_labels=base["reference_labels"],
            center=base["center"],
            scale=base["scale"],
            pot_centers=base["pot_centers"],
            pot_radii=base["pot_radii"],
            thresholds=base["thresholds"],
            training_profile=base["training_profile"],
            max_accept_distance=base["max_accept_distance"],
            min_margin=base["min_margin"],
            min_confidence=base["min_confidence"],
            summary=summary,
        )
        return summary

    audit = audit_calibration_candidates(
        data_dir=data_dir,
        active_labels=existing_labels,
        candidate_labels=new_labels,
        min_usable_per_word=min_usable_per_word,
    )

    admitted = []
    rejected_all = []
    new_records = []
    for item in audit:
        label = item["label"]
        rejected_all.extend(item.get("rejected", []))
        if item["status"] == "READY_FOR_EXTENSION":
            admitted.append(label)
        elif item["status"] == "INSUFFICIENT_CAPTURES":
            raise ValueError(
                f"Calibration data insufficient for {label}: "
                f"{item['usable_files']}/{item['required_usable']} usable captures"
            )
        elif item["status"] == "CALIBRATION_DATA_MISSING":
            raise ValueError(f"Calibration data missing for: {label}")

    if not admitted:
        blocking = [item for item in audit if item["status"] != "ALREADY_ACTIVE"]
        details = ", ".join(
            f"{item['label']} ({item['status'].lower()})" for item in blocking
        )
        raise ValueError(f"No new labels ready for extension: {details}")

    center = base["center"]
    scale = base["scale"]
    references = [row.copy() for row in base["references"]]
    reference_labels = base["reference_labels"].tolist()
    pot_centers = base["pot_centers"].tolist()
    pot_radii = base["pot_radii"].tolist()
    thresholds = base["thresholds"].tolist()
    label_names = list(existing_labels)

    added_counts = []
    for offset, label in enumerate(admitted):
        label_id = len(label_names)
        label_names.append(label)
        folder = root / label
        files = sorted(folder.glob("*.txt"))
        records = [(0, path, read_capture(path)) for path in files]
        _names, usable_records, counts, _all_counts, rejected = select_usable_records(
            [label], records
        )
        rejected_all.extend(rejected)
        added_counts.append(counts[0])

        xs = []
        ys = []
        rng = np.random.default_rng(42 + offset)
        for _rec_label, _path, capture in usable_records:
            xs.append(extract_features(capture))
            ys.append(label_id)
            for _ in range(augment_count):
                xs.append(extract_features(augment_capture(capture, rng)))
                ys.append(label_id)
        x = np.vstack(xs)
        y = np.asarray(ys, dtype=np.int64)
        x_scaled = (x - center) / scale

        references.extend(x_scaled.astype(np.float32))
        reference_labels.extend(y.tolist())

        pots = [capture_stats(capture)["pot_mean"] for _r, _p, capture in usable_records]
        center_pot = float(np.median(pots))
        radius = float(max(1.0, np.percentile(np.abs(np.asarray(pots) - center_pot), 90) + 1.0))
        pot_centers.append(center_pot)
        pot_radii.append(radius)
        thresholds.append(
            float(
                _build_thresholds(x_scaled, y, 1)[0]
                if len(x_scaled) > 1
                else 1.25
            )
        )

    references_arr = np.asarray(references, dtype=np.float32)
    reference_labels_arr = np.asarray(reference_labels, dtype=np.int64)
    pot_centers_arr = np.asarray(pot_centers, dtype=np.float32)
    pot_radii_arr = np.asarray(pot_radii, dtype=np.float32)
    thresholds_arr = np.asarray(thresholds, dtype=np.float32)

    regression_before = verify_label_regression(
        base_model_path, data_dir=data_dir, labels=existing_labels
    )
    if regression_before["failures"]:
        raise RuntimeError(
            "Base model regression failed before extension: "
            + str(regression_before["failures"][:3])
        )

    # Materialise extended model in memory, then regression-check frozen labels.
    temp_summary = dict(base_summary)
    temp_summary["labels"] = label_names
    save_model_bundle(
        output_path,
        label_names=label_names,
        references=references_arr,
        reference_labels=reference_labels_arr,
        center=center,
        scale=scale,
        pot_centers=pot_centers_arr,
        pot_radii=pot_radii_arr,
        thresholds=thresholds_arr,
        training_profile=base["training_profile"],
        max_accept_distance=base["max_accept_distance"],
        min_margin=base["min_margin"],
        min_confidence=base["min_confidence"],
        summary=temp_summary,
    )

    regression_after = verify_label_regression(
        output_path, data_dir=data_dir, labels=existing_labels
    )
    if regression_after["failures"]:
        output_path.unlink(missing_ok=True)
        raise RuntimeError(
            "Existing labels regressed after extension; output removed: "
            + str(regression_after["failures"][:3])
        )

    new_validation = []
    for label in admitted:
        folder = root / label
        for path in sorted(folder.glob("*.txt")):
            capture = read_capture(path)
            if quality_reason(capture) != "ok":
                continue
            result = predict_capture(capture, model_path=output_path)
            new_validation.append(
                {
                    "path": str(path),
                    "expected": label,
                    "label": result.label,
                    "accepted": result.accepted,
                    "confidence": result.confidence,
                }
            )

    summary = dict(base_summary)
    summary.update(
        {
            "labels": label_names,
            "counts": list(base_summary.get("counts", [])) + added_counts,
            "rejected": list(base_summary.get("rejected", [])) + rejected_all,
            "pot_centers": pot_centers,
            "pot_radii": pot_radii,
            "thresholds": thresholds,
            "extension": {
                "mode": "append",
                "base_model": str(base_model_path),
                "added_labels": admitted,
                "min_usable_per_word": min_usable_per_word,
                "augment_count": augment_count,
                "regression_checked": regression_after["checked"],
                "new_word_validation": new_validation,
            },
        }
    )
    save_model_bundle(
        output_path,
        label_names=label_names,
        references=references_arr,
        reference_labels=reference_labels_arr,
        center=center,
        scale=scale,
        pot_centers=pot_centers_arr,
        pot_radii=pot_radii_arr,
        thresholds=thresholds_arr,
        training_profile=base["training_profile"],
        max_accept_distance=base["max_accept_distance"],
        min_margin=base["min_margin"],
        min_confidence=base["min_confidence"],
        summary=summary,
    )
    return summary


def train_word_model(data_dir=CAPTURES_DIR, model_path=MODEL_PATH, augment_count=4):
    all_label_names, all_records, raw_counts = load_records(data_dir)
    if len(all_label_names) < 2:
        raise ValueError("capture at least two different words before training")
    if not all_records:
        raise ValueError("no capture files found")

    label_names, records, counts, all_counts, rejected = select_usable_records(all_label_names, all_records)
    if len(label_names) < 2:
        raise ValueError("fewer than two usable word classes after quality filtering")

    x, y, file_ids = _feature_matrix(records, augment_count=augment_count)
    center, scale = _make_scaler(x)
    x_scaled = (x - center) / scale
    training_profile = build_training_profile([capture for _label_id, _path, capture in records])

    references = x_scaled.astype(np.float32)
    reference_labels = y.astype(np.int64)
    thresholds = _build_thresholds(x_scaled[file_ids < len(records)], y[file_ids < len(records)], len(label_names))

    pot_centers = []
    pot_radii = []
    for label_id in range(len(label_names)):
        pots = [capture_stats(capture)["pot_mean"] for rec_label, _path, capture in records if rec_label == label_id]
        center_pot = float(np.median(pots))
        radius = float(max(1.0, np.percentile(np.abs(np.asarray(pots) - center_pot), 90) + 1.0))
        pot_centers.append(center_pot)
        pot_radii.append(radius)

    correct_distances = []
    correct_margins = []
    mistakes = []
    for file_id, (true_label, path, capture) in enumerate(records):
        holdout = file_ids != file_id
        if np.sum(holdout & (y == true_label)) == 0:
            holdout = np.ones_like(file_ids, dtype=bool)
        feat = (extract_features(capture) - center) / scale
        pot = capture_stats(capture)["pot_mean"]
        pred, dist, margin, _raw, _pot_dist, _pot_gap = _predict_scaled(
            feat,
            pot,
            references[holdout],
            reference_labels[holdout],
            pot_centers,
            pot_radii,
            thresholds,
        )
        if pred == true_label:
            correct_distances.append(dist)
            correct_margins.append(margin)
        else:
            mistakes.append((str(path), label_names[true_label], label_names[pred], dist, margin))

    max_accept_distance = float(np.percentile(correct_distances, 95) * 1.35 + 0.08) if correct_distances else 1.5
    min_margin = float(max(0.01, np.percentile(correct_margins, 10) * 0.40)) if correct_margins else 0.01
    usable_min = min(usable for _, _, usable in counts)
    min_confidence = 0.50 if usable_min >= 3 else 0.62

    summary = {
        "labels": label_names,
        "counts": counts,
        "all_counts": all_counts,
        "rejected": rejected,
        "leave_one_file_out_errors": mistakes,
        "max_accept_distance": max_accept_distance,
        "min_margin": min_margin,
        "min_confidence": min_confidence,
        "augment_count": augment_count,
        "feature_length": FEATURE_LENGTH,
        "pot_centers": pot_centers,
        "pot_radii": pot_radii,
        "thresholds": thresholds.tolist(),
        "training_profile": {
            "baseline": training_profile.baseline,
            "noise_floor": training_profile.noise_floor,
            "active_scale": training_profile.active_scale,
            "peak_scale": training_profile.peak_scale,
            "quiet_gate": training_profile.quiet_gate,
        },
        "extension": {
            "mode": "full_train",
            "added_labels": label_names,
        },
    }

    save_model_bundle(
        model_path,
        label_names=label_names,
        references=references,
        reference_labels=reference_labels,
        center=center,
        scale=scale,
        pot_centers=pot_centers,
        pot_radii=pot_radii,
        thresholds=thresholds,
        training_profile=training_profile,
        max_accept_distance=max_accept_distance,
        min_margin=min_margin,
        min_confidence=min_confidence,
        summary=summary,
    )
    return summary


def load_model(model_path=MODEL_PATH):
    model_path = Path(model_path)
    if not model_path.is_file():
        raise FileNotFoundError(f"model not found: {model_path}. Run: python ai.py train")
    data = np.load(model_path, allow_pickle=True)
    if "references" not in data.files:
        raise ValueError("old model format found. Run: python ai.py train")
    return {
        "label_names": [str(x) for x in data["label_names"].tolist()],
        "references": np.asarray(data["references"], dtype=np.float32),
        "reference_labels": np.asarray(data["reference_labels"], dtype=np.int64),
        "center": np.asarray(data["center"], dtype=np.float32),
        "scale": np.asarray(data["scale"], dtype=np.float32),
        "pot_centers": np.asarray(data["pot_centers"], dtype=np.float32),
        "pot_radii": np.asarray(data["pot_radii"], dtype=np.float32),
        "thresholds": np.asarray(data["thresholds"], dtype=np.float32),
        "training_profile": array_to_profile(data["training_profile"]) if "training_profile" in data.files else None,
        "max_accept_distance": float(data["max_accept_distance"]),
        "min_margin": float(data["min_margin"]),
        "min_confidence": float(data["min_confidence"]),
        "summary_json": str(data["summary_json"].tolist()) if "summary_json" in data.files else None,
    }


def predict_capture(
    capture,
    min_confidence=None,
    model_path=MODEL_PATH,
    adapter=None,
    user_calibration: UserCalibrationContext | None = None,
):
    model = load_model(model_path)

    effective_adapter = adapter
    if (
        effective_adapter is None
        and user_calibration is not None
        and user_calibration.is_applicable()
    ):
        effective_adapter = user_calibration.create_baseline_adapter(model)

    if effective_adapter is not None:
        capture = effective_adapter.adapt_capture(capture)
    reason = quality_reason(capture)
    if reason != "ok":
        return Prediction("unknown", f"low-quality-signal:{reason}", 0.0, False, float("inf"), 0.0)

    stats = capture_stats(capture)
    pot = stats["pot_mean"]
    feat = (extract_features(capture) - model["center"]) / model["scale"]

    pot_centers = model["pot_centers"]
    pot_radii = model["pot_radii"]
    references = model["references"]
    reference_labels = model["reference_labels"]

    if user_calibration is not None and user_calibration.is_applicable():
        pot_centers, pot_radii = user_calibration.effective_pot_arrays(model)
        references, reference_labels = user_calibration.effective_references(model)

    best, best_dist, margin, raw_distances, pot_distances, pot_gap = _predict_scaled(
        feat,
        pot,
        references,
        reference_labels,
        pot_centers,
        pot_radii,
        model["thresholds"],
    )

    threshold = float(model["thresholds"][best])
    pot_gate = max(POT_GATE_PAD, float(model["pot_radii"][best]) + POT_GATE_PAD)
    pot_ok = float(pot_distances[best]) <= pot_gate
    distance_ok = best_dist <= max(threshold * 1.45, model["max_accept_distance"] * 1.20)

    distance_conf = max(0.0, min(1.0, 1.0 - best_dist / max(threshold * 1.8, 1e-6)))
    pot_conf = max(0.0, min(1.0, 1.0 - float(pot_distances[best]) / max(pot_gate, 1e-6)))
    gap_conf = max(0.0, min(1.0, pot_gap / 6.0))
    confidence = min(0.98, 0.48 * pot_conf + 0.34 * distance_conf + 0.18 * gap_conf)

    required_confidence = float(min_confidence) if min_confidence is not None else model["min_confidence"]
    accepted = confidence >= required_confidence and pot_ok and distance_ok
    best_label = model["label_names"][best]
    return Prediction(best_label if accepted else "unknown", best_label, float(confidence), bool(accepted), float(best_dist), float(margin))


def predict_file(path, min_confidence=None, model_path=MODEL_PATH, adapter=None):
    return predict_capture(read_capture(path), min_confidence=min_confidence, model_path=model_path, adapter=adapter)


def print_summary(summary):
    print("trained calibrated word model")
    print("labels:")
    for idx, item in enumerate(summary["counts"]):
        name, raw_count, usable_count = item
        note = " ok" if usable_count >= 3 else " needs 3+ usable takes"
        pot = summary.get("pot_centers", [None] * len(summary["counts"]))[idx]
        pot_text = f" pot={pot:.1f}" if pot is not None else ""
        print(f"  {name}: {usable_count}/{raw_count} usable files{pot_text}{note}")
    rejected = summary.get("rejected", [])
    if rejected:
        print("filtered captures:")
        for path, label, reason in rejected[:12]:
            print(f"  {Path(path).name}: {label} ({reason})")
        if len(rejected) > 12:
            print(f"  ... {len(rejected) - 12} more")
    if "training_profile" in summary:
        profile = summary["training_profile"]
        print(
            "training profile: "
            f"baseline={profile['baseline']:.1f} "
            f"noise={profile['noise_floor']:.1f} "
            f"active={profile['active_scale']:.1f}"
        )
    print(f"reject distance: {summary['max_accept_distance']:.3f}")
    print(f"reject margin: {summary['min_margin']:.3f}")
    print(f"default min confidence: {summary['min_confidence']:.2f}")
    errors = summary["leave_one_file_out_errors"]
    if errors:
        print("validation warnings:")
        for path, true_label, pred_label, dist, margin in errors[:8]:
            print(f"  {Path(path).name}: expected {true_label}, got {pred_label}, distance={dist:.3f}, margin={margin:.3f}")
    else:
        print("leave-one-file-out check: no errors")
