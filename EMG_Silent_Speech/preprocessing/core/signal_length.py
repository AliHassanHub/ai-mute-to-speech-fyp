import numpy as np


def pad_or_trim(signal, target_length, pad_value=0.0):
    signal = np.asarray(signal, dtype=np.float32)

    if signal.ndim != 1:
        raise ValueError("Expected a 1D signal")

    if target_length <= 0:
        raise ValueError("target_length must be greater than 0")

    current_length = signal.shape[0]

    if current_length == target_length:
        return signal.copy()

    if current_length > target_length:
        return signal[:target_length].copy()

    pad_count = target_length - current_length
    padding = np.full(pad_count, pad_value, dtype=np.float32)
    return np.concatenate([signal, padding])


def resize_signal(signal, target_length):
    signal = np.asarray(signal, dtype=np.float32)

    if signal.ndim != 1:
        raise ValueError("Expected a 1D signal")

    if target_length <= 0:
        raise ValueError("target_length must be greater than 0")

    if signal.size == 0:
        raise ValueError("Signal is empty")

    if signal.size == 1:
        return np.full(target_length, signal[0], dtype=np.float32)

    old_x = np.linspace(0, 1, num=signal.size)
    new_x = np.linspace(0, 1, num=target_length)
    return np.interp(new_x, old_x, signal).astype(np.float32)


def make_windows(signal, window_size, stride):
    signal = np.asarray(signal, dtype=np.float32)

    if signal.ndim != 1:
        raise ValueError("Expected a 1D signal")

    if window_size <= 0 or stride <= 0:
        raise ValueError("window_size and stride must be greater than 0")

    if signal.size == 0:
        raise ValueError("Signal is empty")

    if signal.size < window_size:
        return pad_or_trim(signal, window_size).reshape(1, window_size)

    windows = []
    start = 0
    while True:
        end = start + window_size
        if end > signal.size:
            break
        windows.append(signal[start:end])
        start = start + stride

    if not windows:
        return pad_or_trim(signal, window_size).reshape(1, window_size)

    return np.stack(windows).astype(np.float32)
