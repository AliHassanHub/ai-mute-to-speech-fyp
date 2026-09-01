"""Live HTTP smoke test against a running uvicorn server.

Not part of the pytest suite: it needs a real server. Run with

    python -m uvicorn ai_service.app.main:app --port 8077
    python ai_service/tests/live_smoke.py

It re-verifies the four real capture categories over the network and reports
end-to-end latency, so the numbers in AI_API_INTEGRATION_REPORT.md come from an
actual server rather than TestClient.
"""

from __future__ import annotations

import json
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[2]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from runtime.robust_word_model import MAX_SAMPLES, MIN_SAMPLES, predict_file
from runtime.signal_io import read_capture

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8077"
LABELS = ("help", "no", "pain", "stop")


def call(path, payload=None, method=None):
    url = f"{BASE}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data, method=method or ("POST" if data else "GET"),
        headers={"Content-Type": "application/json"},
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read())
            code = resp.status
    except urllib.error.HTTPError as exc:
        body = json.loads(exc.read())
        code = exc.code
    return code, body, (time.perf_counter() - started) * 1000.0


def main():
    print("=" * 74)
    print("GET /health")
    print("=" * 74)
    code, health, ms = call("/health")
    print(f"HTTP {code}  ({ms:.1f} ms)")
    for key in (
        "status", "model", "word_model_loaded", "labels", "version",
        "model_sha256", "model_size_bytes", "model_modified_utc",
        "sentence_model_supported", "min_predict_samples",
        "max_predict_samples", "hard_min_samples", "default_min_confidence",
    ):
        print(f"  {key}: {health.get(key)}")
    assert code == 200 and health["word_model_loaded"] is True

    print()
    print("=" * 74)
    print("POST /predict  — real captures vs direct predictor")
    print("=" * 74)
    print(f"{'capture':34s} {'n':>5} {'direct':>8} {'api':>8} {'conf':>6} {'dist':>8} {'marg':>6} {'ms':>7}")

    latencies = []
    server_times = []
    mismatches = []
    checked = 0

    for label in LABELS:
        for path in sorted((PROJECT_DIR / "captures" / label).glob("*.txt")):
            arr = read_capture(path)
            n = arr.shape[0]
            if not (MIN_SAMPLES <= n <= MAX_SAMPLES):
                continue
            direct = predict_file(path)
            rows = [{"emg": float(e), "pot": float(p)} for e, p in arr]
            code, body, ms = call(
                "/predict",
                {"kind": "word", "signal": {"format": "samples", "rows": rows}},
            )
            assert code == 200, body
            checked += 1
            latencies.append(ms)
            server_times.append(body["processingTimeMs"])
            ok = body["label"] == direct.label and body["accepted"] == bool(direct.accepted)
            if not ok:
                mismatches.append(f"{path.name}: direct={direct.label} api={body['label']}")
            flag = " " if ok else "X"
            print(
                f"{flag}{label}/{path.name:27s} {n:>5} {direct.label:>8} {body['label']:>8} "
                f"{body['confidence']:>6.3f} {body['distance']:>8.4f} {body['margin']:>6.1f} {ms:>7.1f}"
            )

    print()
    print("=" * 74)
    print("POST /predict  — rejection paths")
    print("=" * 74)

    first = read_capture(sorted((PROJECT_DIR / "captures" / "help").glob("*.txt"))[0])
    rows = [{"emg": float(e), "pot": float(p)} for e, p in first]

    cases = [
        ("single BLE packet", {"kind": "word", "signal": {"format": "samples", "rows": rows[:1]}}),
        ("empty signal", {"kind": "word", "signal": {"format": "samples", "rows": []}}),
        ("below min window", {"kind": "word", "signal": {"format": "samples", "rows": rows[:700]}}),
        ("sentence kind", {"kind": "sentence", "signal": {"format": "samples", "rows": rows}}),
        ("bad kind", {"kind": "hum", "signal": {"format": "samples", "rows": rows}}),
        ("nan value", {"kind": "word", "signal": {"format": "samples",
                                                  "rows": [{"emg": "nan", "pot": 39.0}] * 800}}),
        ("flat emg", {"kind": "word", "signal": {"format": "samples",
                                                 "rows": [{"emg": 600.0, "pot": 39.0}] * 800}}),
        ("unknown session", {"kind": "word", "signal": {"format": "samples", "rows": rows},
                             "sessionId": "0" * 32}),
    ]
    for name, payload in cases:
        code, body, ms = call("/predict", payload)
        summary = body.get("error") or f"{body.get('label')}/accepted={body.get('accepted')}"
        print(f"  {name:20s} HTTP {code}  {summary}")

    print()
    print("=" * 74)
    print("POST /session  — session adaptation")
    print("=" * 74)
    code, body, ms = call("/session", {"signal": {"format": "samples", "rows": rows}})
    print(f"  create: HTTP {code}  ({ms:.1f} ms)")
    for k, v in body.items():
        print(f"    {k}: {v}")
    if code == 200:
        sid = body["sessionId"]
        code2, body2, _ = call(
            "/predict",
            {"kind": "word", "signal": {"format": "samples", "rows": rows}, "sessionId": sid},
        )
        print(f"  predict with session: HTTP {code2}  label={body2.get('label')} "
              f"adaptation={body2.get('sessionAdaptation')}")

    code, body, _ = call("/session", {"signal": {"format": "samples", "rows": rows[:40]}})
    print(f"  short baseline: HTTP {code}  {body.get('error')}")

    print()
    print("=" * 74)
    print("RESULT")
    print("=" * 74)
    print(f"captures checked          : {checked}")
    print(f"label/acceptance mismatches: {len(mismatches)}")
    for m in mismatches:
        print(f"  {m}")
    print(f"server-reported predict   : mean {statistics.mean(server_times):.2f} ms  "
          f"p95 {sorted(server_times)[int(0.95 * len(server_times)) - 1]:.2f} ms  "
          f"max {max(server_times):.2f} ms")
    print(f"end-to-end HTTP round trip: mean {statistics.mean(latencies):.1f} ms  "
          f"p95 {sorted(latencies)[int(0.95 * len(latencies)) - 1]:.1f} ms  "
          f"max {max(latencies):.1f} ms")
    print()
    print("PASS" if not mismatches else "FAIL")
    return 0 if not mismatches else 1


if __name__ == "__main__":
    raise SystemExit(main())
