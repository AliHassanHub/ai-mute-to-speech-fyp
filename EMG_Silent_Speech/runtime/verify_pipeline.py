import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

import numpy as np

from runtime.robust_word_model import (
    MODEL_PATH,
    load_model,
    load_records,
    predict_capture,
    predict_file,
    select_usable_records,
    train_word_model,
)
from runtime.session_adaptation import SessionAdapter, estimate_session_profile
from runtime.signal_io import parse_capture_pair, read_capture


def check(name, condition, detail=""):
    if not condition:
        raise AssertionError(f"{name} failed {detail}".strip())
    print(f"ok - {name}")


def verify_usable_captures():
    all_labels, all_records, _counts = load_records()
    labels, records, _usable_counts, _all_counts, rejected = select_usable_records(all_labels, all_records)
    failures = []
    total = 0
    for label_id, path, _capture in records:
        expected = labels[label_id]
        result = predict_file(path)
        total += 1
        if result.label != expected:
            failures.append(f"{Path(path).name}: expected {expected}, got {result.label}/{result.best_label}")

    check("usable captures classify correctly", not failures, "; ".join(failures[:5]))
    print(f"ok - usable capture audit {total}/{total}")
    if rejected:
        print(f"ok - filtered low-quality captures {len(rejected)}")


def shifted_capture(capture, offset, gain):
    arr = np.asarray(capture, dtype=np.float32).copy()
    arr[:, 0] = np.clip((arr[:, 0] * gain) + offset, 0.0, 4095.0)
    return arr


def build_shifted_neutral(capture, offset, gain):
    emg = np.asarray(capture, dtype=np.float32)[:, 0]
    baseline = float(np.median(emg))
    quiet_mask = emg <= baseline + max(12.0, np.percentile(np.maximum(0.0, emg - baseline), 30))
    quiet = emg[quiet_mask]
    if quiet.size < 80:
        quiet = np.full(120, baseline, dtype=np.float32)
    quiet_shifted = np.clip((quiet * gain) + offset, 0.0, 4095.0)
    reps = int(np.ceil(240 / max(1, quiet_shifted.size)))
    return np.tile(quiet_shifted, reps)[:240].astype(np.float32)


def verify_electrode_shift_tolerance():
    model = load_model()
    check("training profile saved", model["training_profile"] is not None)

    all_labels, all_records, _counts = load_records()
    labels, records, _usable_counts, _all_counts, _rejected = select_usable_records(all_labels, all_records)
    failures = []
    checked = 0
    for label_id, path, capture in records[: min(20, len(records))]:
        expected = labels[label_id]
        for offset, gain in ((80.0, 1.0), (220.0, 0.85), (-60.0, 1.15), (140.0, 1.35)):
            shifted = shifted_capture(capture, offset, gain)
            neutral = build_shifted_neutral(capture, offset, gain)
            adapter = SessionAdapter(model["training_profile"], estimate_session_profile(neutral))
            result = predict_capture(shifted, adapter=adapter)
            checked += 1
            if result.label != expected:
                failures.append(
                    f"{Path(path).name}: offset={offset:g}, gain={gain:g}, expected {expected}, got {result.label}/{result.best_label}"
                )
    check("session adaptation tolerates electrode shifts", not failures, "; ".join(failures[:5]))
    print(f"ok - session adaptation simulation {checked}/{checked}")


def main():
    check("parse new emg;pot", parse_capture_pair("123;45") == (123.0, 45.0))
    check("parse esp32 line", parse_capture_pair("EMG:321  POT:12") == (321.0, 12.0))
    check("parse legacy row", parse_capture_pair("0;1202;1202;13;0") == (1202.0, 13.0))

    summary = train_word_model()
    check("model file exists", MODEL_PATH.is_file(), str(MODEL_PATH))
    check("two or more labels", len(summary["labels"]) >= 2, str(summary["labels"]))
    check("training profile in summary", "training_profile" in summary)
    check("no leave-one-out errors", not summary["leave_one_file_out_errors"], str(summary["leave_one_file_out_errors"][:3]))
    verify_usable_captures()
    verify_electrode_shift_tolerance()

    first_capture = next((PROJECT_DIR / "captures").glob("*/*.txt"))
    arr = read_capture(first_capture)
    check("read capture shape", arr.ndim == 2 and arr.shape[1] == 2, str(arr.shape))
    check("finite capture values", bool(np.isfinite(arr).all()))

    print("pipeline verification passed")


if __name__ == "__main__":
    main()
