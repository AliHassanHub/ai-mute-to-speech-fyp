"""Incrementally extend the calibrated word model with new real captures.

Usage examples:

  # Audit which candidate words have enough calibration data
  python runtime/extend_vocabulary.py audit

  # Create a versioned artefact without adding labels (copies base -> v2)
  python runtime/extend_vocabulary.py snapshot

  # Attempt to append every discoverable new folder under captures/
  python runtime/extend_vocabulary.py extend

  # Append specific labels only
  python runtime/extend_vocabulary.py extend Assistance Medical
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime.robust_word_model import (  # noqa: E402
    MODEL_PATH,
    MODEL_PATH_V1_BACKUP,
    MODEL_PATH_V2,
    audit_calibration_candidates,
    extend_word_model,
    load_model,
    print_summary,
    verify_label_regression,
)
from training.vocabulary import CANDIDATE_EXTENSION_LABELS  # noqa: E402


def cmd_audit(args):
    active = load_model(args.base)["label_names"] if args.base.is_file() else []
    report = audit_calibration_candidates(
        data_dir=args.data_dir,
        active_labels=active,
        candidate_labels=args.labels or CANDIDATE_EXTENSION_LABELS,
        min_usable_per_word=args.min_usable,
    )
    print(json.dumps(report, indent=2))
    ready = [item["label"] for item in report if item["status"] == "READY_FOR_EXTENSION"]
    missing = [item["label"] for item in report if item["status"] == "CALIBRATION_DATA_MISSING"]
    insufficient = [item["label"] for item in report if item["status"] == "INSUFFICIENT_CAPTURES"]
    print()
    print(f"ready: {ready or 'none'}")
    print(f"missing: {missing or 'none'}")
    print(f"insufficient: {insufficient or 'none'}")
    return 0


def cmd_snapshot(args):
    if not args.base.is_file():
        raise SystemExit(f"base model not found: {args.base}")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.base, args.out)
    if args.backup and not args.backup.exists():
        shutil.copy2(args.base, args.backup)
        print(f"backup written: {args.backup}")
    summary = extend_word_model(
        base_model_path=args.base,
        data_dir=args.data_dir,
        output_path=args.out,
        target_labels=[],
    )
    print(f"snapshot written: {args.out}")
    print_summary(summary)
    return 0


def cmd_extend(args):
    try:
        summary = extend_word_model(
            base_model_path=args.base,
            data_dir=args.data_dir,
            output_path=args.out,
            target_labels=args.labels if args.labels else None,
            min_usable_per_word=args.min_usable,
        )
    except ValueError as exc:
        print(f"extension refused: {exc}")
        return 1
    print_summary(summary)
    regression = verify_label_regression(args.base, data_dir=args.data_dir)
    print(
        f"regression on original labels: {regression['checked']} checked, "
        f"{len(regression['failures'])} failures"
    )
    return 0


def main():
    parser = argparse.ArgumentParser(description="Incremental calibrated vocabulary extension")
    parser.add_argument("--base", type=Path, default=MODEL_PATH)
    parser.add_argument("--out", type=Path, default=MODEL_PATH_V2)
    parser.add_argument("--backup", type=Path, default=MODEL_PATH_V1_BACKUP)
    parser.add_argument("--data-dir", type=Path, default=ROOT / "captures")
    parser.add_argument("--min-usable", type=int, default=8)
    sub = parser.add_subparsers(dest="cmd", required=True)

    audit = sub.add_parser("audit", help="Report calibration readiness per candidate word")
    audit.add_argument("labels", nargs="*", help="Optional subset of candidate labels")
    audit.set_defaults(func=cmd_audit)

    snap = sub.add_parser("snapshot", help="Copy the verified base model to a versioned artefact")
    snap.set_defaults(func=cmd_snapshot)

    extend = sub.add_parser("extend", help="Append new words with real calibration captures")
    extend.add_argument("labels", nargs="*", help="Optional explicit labels to add")
    extend.set_defaults(func=cmd_extend)

    args = parser.parse_args()
    raise SystemExit(args.func(args))


if __name__ == "__main__":
    main()
