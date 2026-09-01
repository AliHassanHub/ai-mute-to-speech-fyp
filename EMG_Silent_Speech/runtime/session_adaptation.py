from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def _robust_percentile(values, q, fallback):
    arr = np.asarray(values, dtype=np.float32).reshape(-1)
    arr = arr[np.isfinite(arr)]
    if arr.size == 0:
        return float(fallback)
    return float(np.percentile(arr, q))


@dataclass
class SessionProfile:
    baseline: float
    noise_floor: float
    active_scale: float
    peak_scale: float
    quiet_gate: float


def estimate_session_profile(emg_values):
    emg = np.asarray(emg_values, dtype=np.float32).reshape(-1)
    finite = emg[np.isfinite(emg)]
    if finite.size == 0:
        raise ValueError("cannot estimate session profile from empty or invalid EMG values")

    baseline = float(np.median(finite))
    centered = np.maximum(0.0, finite - baseline)
    noise_floor = max(1.0, _robust_percentile(centered, 90, 1.0))
    active_scale = max(noise_floor * 2.5, _robust_percentile(centered, 99, noise_floor * 2.5))
    peak_scale = max(active_scale, _robust_percentile(centered, 99.7, active_scale))
    quiet_gate = baseline + max(noise_floor * 2.4, 10.0)
    return SessionProfile(
        baseline=baseline,
        noise_floor=noise_floor,
        active_scale=active_scale,
        peak_scale=peak_scale,
        quiet_gate=quiet_gate,
    )


def blend_profiles(profiles):
    items = list(profiles)
    if not items:
        raise ValueError("cannot blend zero profiles")
    return SessionProfile(
        baseline=float(np.median([p.baseline for p in items])),
        noise_floor=float(np.median([p.noise_floor for p in items])),
        active_scale=float(np.median([p.active_scale for p in items])),
        peak_scale=float(np.median([p.peak_scale for p in items])),
        quiet_gate=float(np.median([p.quiet_gate for p in items])),
    )


def profile_to_array(profile):
    return np.asarray(
        [profile.baseline, profile.noise_floor, profile.active_scale, profile.peak_scale, profile.quiet_gate],
        dtype=np.float32,
    )


def array_to_profile(values):
    arr = np.asarray(values, dtype=np.float32).reshape(-1)
    if arr.size != 5:
        raise ValueError("session profile array must have 5 values")
    return SessionProfile(
        baseline=float(arr[0]),
        noise_floor=float(arr[1]),
        active_scale=float(arr[2]),
        peak_scale=float(arr[3]),
        quiet_gate=float(arr[4]),
    )


def build_training_profile(captures):
    profiles = []
    for capture in captures:
        arr = np.asarray(capture, dtype=np.float32)
        if arr.ndim != 2 or arr.shape[1] != 2 or arr.shape[0] < 4:
            continue
        profiles.append(estimate_session_profile(arr[:, 0]))
    if not profiles:
        raise ValueError("no valid captures for training profile")
    return blend_profiles(profiles)


class SessionAdapter:
    def __init__(self, training_profile: SessionProfile, session_profile: SessionProfile):
        self.training_profile = training_profile
        self.baseline = float(session_profile.baseline)
        self.noise_floor = float(max(1.0, session_profile.noise_floor))
        self.active_scale = float(max(self.noise_floor * 2.5, session_profile.active_scale))
        self.peak_scale = float(max(self.active_scale, session_profile.peak_scale))

    @property
    def quiet_gate(self):
        return self.baseline + max(self.noise_floor * 2.6, 10.0)

    def observe_sample(self, emg_value):
        value = float(emg_value)
        if not np.isfinite(value):
            return
        if value <= self.quiet_gate:
            self.baseline = (0.997 * self.baseline) + (0.003 * value)
            residual = max(0.0, value - self.baseline)
            self.noise_floor = max(1.0, (0.995 * self.noise_floor) + (0.005 * residual))
            self.active_scale = max(self.noise_floor * 2.5, 0.998 * self.active_scale + 0.002 * max(residual, self.active_scale))
            self.peak_scale = max(self.active_scale, 0.999 * self.peak_scale + 0.001 * max(residual, self.peak_scale))

    def adapt_emg(self, emg_values):
        emg = np.asarray(emg_values, dtype=np.float32).reshape(-1)
        if emg.size == 0:
            return emg.astype(np.float32)

        centered = np.maximum(0.0, emg - self.baseline)
        noise_suppressed = np.maximum(0.0, centered - self.noise_floor * 0.75)

        window_scale = _robust_percentile(noise_suppressed, 95, self.active_scale)
        source_scale = max(self.noise_floor * 2.5, min(max(window_scale, self.active_scale), self.peak_scale * 1.15))
        target_scale = max(self.training_profile.noise_floor * 2.5, self.training_profile.active_scale)
        gain = float(np.clip(target_scale / max(source_scale, 1e-6), 0.35, 3.2))

        aligned = noise_suppressed * gain
        aligned += self.training_profile.noise_floor * 0.35
        return np.clip(aligned, 0.0, 4095.0).astype(np.float32)

    def adapt_capture(self, capture):
        arr = np.asarray(capture, dtype=np.float32)
        if arr.ndim != 2 or arr.shape[1] != 2:
            raise ValueError("expected capture array with shape (samples, 2)")
        out = arr.copy()
        out[:, 0] = self.adapt_emg(out[:, 0])
        return out

