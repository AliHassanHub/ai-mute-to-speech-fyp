import argparse
import sys
import time
from collections import deque
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    serial = None
    list_ports = None

try:
    import msvcrt
except ImportError:
    msvcrt = None

from runtime.predict import DEFAULT_MIN_CONFIDENCE, TARGET_LENGTH_WORD, predict_from_signal_array
from runtime.robust_word_model import load_model
from runtime.session_adaptation import SessionAdapter, estimate_session_profile
from runtime.signal_io import parse_capture_pair

DEFAULT_BAUD = 115200
DEFAULT_ADAPT_SECONDS = 6.0
PREFERRED_PORT_KEYWORDS = (
    "ESP32",
    "CH910",
    "CH340",
    "USB-Enhanced-SERIAL",
    "USB-SERIAL",
    "USB Serial",
    "wch.cn",
    "Bluetooth",
    "CP210",
    "FTDI",
    "Arduino",
)
AVOID_PORT_KEYWORDS = ("Intel(R) Active Management", " AMT", " SOL ")


def choose_port():
    if list_ports is None:
        return None
    ports = list(list_ports.comports())
    if not ports:
        return None

    def description(port):
        return f" {port.device} {port.description} {port.manufacturer} {port.hwid} ".lower()

    def should_avoid(port):
        desc = description(port)
        return any(keyword.lower() in desc for keyword in AVOID_PORT_KEYWORDS)

    for keyword in PREFERRED_PORT_KEYWORDS:
        for port in ports:
            if not should_avoid(port) and keyword.lower() in description(port):
                return port.device

    for port in ports:
        if not should_avoid(port):
            return port.device

    return ports[0].device


def open_serial(port, baud):
    return serial.Serial(port=port, baudrate=baud, timeout=0.1, write_timeout=1, dsrdtr=False, rtscts=False)


def enter_pressed():
    if msvcrt is None:
        return False
    if not msvcrt.kbhit():
        return False
    ch = msvcrt.getwch()
    return ch in ("\r", "\n")


def collect_session_profile(ser, seconds):
    print(f"Session adaptation: keep face relaxed for {seconds:.1f} seconds. Do not speak silently yet.")
    start = time.time()
    values = []
    last_print = 0.0
    while time.time() - start < seconds:
        raw = ser.readline()
        if not raw:
            continue
        pair = parse_capture_pair(raw.decode("ascii", errors="ignore"))
        if pair is None:
            continue
        emg, pot = pair
        values.append(float(emg))
        now = time.time()
        if now - last_print > 0.5:
            remaining = max(0.0, seconds - (now - start))
            print(f"adapting... emg={int(emg)} pot={int(pot)} remaining={remaining:.1f}s")
            last_print = now
    if len(values) < 80:
        raise RuntimeError("not enough neutral EMG samples collected for session adaptation")
    profile = estimate_session_profile(values)
    print(
        "Session profile ready: "
        f"baseline={profile.baseline:.1f} noise={profile.noise_floor:.1f} active={profile.active_scale:.1f}"
    )
    return profile


def wait_for_knob(ser, adapter):
    print("Rotate the potentiometer for the word you want to test. Press Enter once to lock it.")
    last_print = 0.0
    locked_pot = None
    while True:
        raw = ser.readline()
        if raw:
            pair = parse_capture_pair(raw.decode("ascii", errors="ignore"))
            if pair is not None:
                emg, pot = pair
                adapter.observe_sample(emg)
                locked_pot = float(pot)
                now = time.time()
                if now - last_print > 0.35:
                    print(f"emg={int(emg)}  pot={int(pot)}")
                    last_print = now
        if enter_pressed() and locked_pot is not None:
            print(f"POT locked at {int(locked_pot)}. Speak/try the word now.")
            return locked_pot


def main():
    parser = argparse.ArgumentParser(description="Live calibrated EMG word prediction from an ESP32 stream.")
    parser.add_argument("--port", help="Serial port, for example COM7")
    parser.add_argument("--baud", type=int, default=DEFAULT_BAUD, help="ESP32 baud rate")
    parser.add_argument("--kind", default="word", choices=["word", "sentence", "both"], help="Only word is supported in calibrated mode")
    parser.add_argument("--min-confidence", type=float, default=DEFAULT_MIN_CONFIDENCE, help="Reject low-confidence predictions")
    parser.add_argument("--stride", type=int, default=48, help="Number of EMG samples between predictions")
    parser.add_argument("--adapt-seconds", type=float, default=DEFAULT_ADAPT_SECONDS, help="Neutral relaxed EMG collection before live prediction")
    args = parser.parse_args()

    if serial is None:
        print("pyserial is required. Install with: python -m pip install pyserial")
        raise SystemExit(1)
    if args.kind != "word":
        print("Sentence prediction is disabled in the calibrated hardware workflow. Running word prediction.")

    port = args.port or choose_port()
    if not port:
        print("No serial port found. Connect the ESP32 and retry.")
        raise SystemExit(1)

    model = load_model()
    if model["training_profile"] is None:
        print("Model is missing training session metadata. Run: python ai.py train")
        raise SystemExit(1)

    word_buffer = deque(maxlen=TARGET_LENGTH_WORD)
    sample_count = 0
    last_report = 0

    print(f"Opening {port} at {args.baud} baud...")
    with open_serial(port, args.baud) as ser:
        time.sleep(2.0)
        ser.reset_input_buffer()
        session_profile = collect_session_profile(ser, args.adapt_seconds)
        adapter = SessionAdapter(model["training_profile"], session_profile)
        ser.reset_input_buffer()
        locked_pot = wait_for_knob(ser, adapter)
        print("Streaming live EMG with session adaptation. Press Ctrl+C to stop.")
        try:
            while True:
                raw = ser.readline()
                if not raw:
                    continue
                pair = parse_capture_pair(raw.decode("ascii", errors="ignore"))
                if pair is None:
                    continue
                emg, _live_pot = pair
                adapter.observe_sample(emg)
                word_buffer.append((emg, locked_pot))
                sample_count += 1

                if sample_count < TARGET_LENGTH_WORD:
                    continue
                if sample_count - last_report < args.stride:
                    continue
                last_report = sample_count

                result = predict_from_signal_array(
                    "word",
                    list(word_buffer),
                    min_confidence=args.min_confidence,
                    adapter=adapter,
                )
                if result["accepted"]:
                    print(f"word: {result['label']}  confidence={result['confidence']:.2f}")
                else:
                    print(f"word: unknown  best={result['best_label']}  confidence={result['confidence']:.2f}")
        except KeyboardInterrupt:
            print("Stopped.")


if __name__ == "__main__":
    main()
