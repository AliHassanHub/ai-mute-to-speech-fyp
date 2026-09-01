import argparse
import subprocess
import sys
import time
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

try:
    import serial
    from serial import SerialException
    from serial.tools import list_ports
except ImportError:
    serial = None
    SerialException = Exception
    list_ports = None

try:
    import msvcrt
except ImportError:
    msvcrt = None

from runtime.signal_io import parse_capture_pair, safe_name, write_capture

DEFAULT_BAUD = 115200
DEFAULT_SECONDS = 16.0
DEFAULT_STARTUP_WAIT = 2.0
CAPTURES_DIR = PROJECT_DIR / "captures"
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
    return serial.Serial(
        port=port,
        baudrate=baud,
        timeout=0.1,
        write_timeout=1,
        dsrdtr=False,
        rtscts=False,
    )


def reset_board(ser, wait_seconds):
    ser.setDTR(False)
    time.sleep(0.15)
    ser.reset_input_buffer()
    ser.setDTR(True)
    time.sleep(max(0.0, wait_seconds))
    ser.reset_input_buffer()


def enter_pressed():
    if msvcrt is None:
        return False
    if not msvcrt.kbhit():
        return False
    ch = msvcrt.getwch()
    return ch in ("\r", "\n")


def wait_for_knob(ser):
    print("Rotate the potentiometer. Press Enter once when the value is set.", flush=True)
    print("After this, the same POT value is reused for every take of this word.", flush=True)
    last_print = 0.0
    locked_pot = None
    while True:
        raw = ser.readline()
        if raw:
            pair = parse_capture_pair(raw.decode("ascii", errors="ignore"))
            if pair is not None:
                emg, pot = pair
                locked_pot = float(pot)
                now = time.time()
                if now - last_print > 0.35:
                    print(f"emg={int(emg)}  pot={int(pot)}", flush=True)
                    last_print = now
        if enter_pressed() and locked_pot is not None:
            print(f"POT locked at {int(locked_pot)}.", flush=True)
            return locked_pot


def capture_window(ser, label, seconds, out_dir, locked_pot):
    folder = out_dir / safe_name(label)
    folder.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    path = folder / f"{safe_name(label)}_{stamp}.txt"

    rows = []
    ignored = 0
    capture_started = None
    ser.reset_input_buffer()
    time.sleep(0.15)
    start_wait = time.time()
    next_status = start_wait + 1.0

    print(f"Try/speak: {label}", flush=True)
    while True:
        now = time.time()
        if capture_started is None and now - start_wait > 8.0:
            break
        if capture_started is not None and now - capture_started >= seconds:
            break
        if now >= next_status:
            if capture_started is None:
                print("Waiting for first EMG row...", flush=True)
            else:
                remaining = max(0.0, seconds - (now - capture_started))
                print(f"Capturing... samples={len(rows)} remaining={remaining:.1f}s", flush=True)
            next_status = now + 1.0

        raw = ser.readline()
        if not raw:
            continue
        pair = parse_capture_pair(raw.decode("ascii", errors="ignore"))
        if pair is None:
            ignored += 1
            continue
        emg, _live_pot = pair
        if capture_started is None:
            capture_started = time.time()
            print(f"First EMG row received. Capturing for {seconds:g} seconds...", flush=True)
        rows.append((emg, locked_pot))

    if len(rows) < 50:
        print(f"Too few samples captured: {len(rows)}", flush=True)
        return None

    write_capture(path, rows)
    print(f"Saved {len(rows)} samples to {path}", flush=True)
    if ignored:
        print(f"Ignored {ignored} non-data lines.", flush=True)
    return path


def update_ai(label, files):
    print("Updating the calibrated word model...", flush=True)
    cmd = [sys.executable, str(PROJECT_DIR / "runtime" / "calibrate.py"), label, *[str(p) for p in files]]
    subprocess.run(cmd, check=True)


def main():
    parser = argparse.ArgumentParser(description="Capture clean EMG;POT word data from the ESP32.")
    parser.add_argument("label", help="Word label, for example water")
    parser.add_argument("--port", help="ESP32 serial port, for example COM7")
    parser.add_argument("--baud", type=int, default=DEFAULT_BAUD, help="ESP32 baud rate")
    parser.add_argument("--seconds", type=float, default=DEFAULT_SECONDS, help="Capture length in seconds")
    parser.add_argument("--startup-wait", type=float, default=DEFAULT_STARTUP_WAIT, help="Seconds to wait after opening the port")
    parser.add_argument("--out-dir", default=str(CAPTURES_DIR), help="Folder that stores one subfolder per label")
    parser.add_argument("--no-train", action="store_true", help="Do not update the AI after the final capture")
    args = parser.parse_args()

    if serial is None:
        print("pyserial is required. Install with: python -m pip install pyserial", flush=True)
        raise SystemExit(1)

    port = args.port or choose_port()
    if not port:
        print("No serial port found. Connect the ESP32 and retry.", flush=True)
        raise SystemExit(1)

    out_dir = Path(args.out_dir)
    label = safe_name(args.label)
    print(f"Using port: {port}", flush=True)
    print(f"Saving under: {out_dir / label}", flush=True)

    captured_files = []
    try:
        with open_serial(port, args.baud) as ser:
            print("Opening port and resetting the board...", flush=True)
            reset_board(ser, args.startup_wait)
            locked_pot = wait_for_knob(ser)

            while True:
                path = capture_window(ser, label, args.seconds, out_dir, locked_pot)
                if path is None:
                    answer = input("Capture failed. Try again with same POT? [y/N]: ").strip().lower()
                    if answer != "y":
                        break
                    continue

                captured_files.append(path)
                answer = input("Capture another take for the same word with same POT? [y/N]: ").strip().lower()
                if answer != "y":
                    break
    except SerialException as exc:
        print(f"Serial communication failed: {exc}", flush=True)
        raise SystemExit(1)

    if not args.no_train and captured_files:
        update_ai(label, captured_files)
        print("AI updated. You can now run prediction or live mode.", flush=True)


if __name__ == "__main__":
    main()

