"""Per-user calibration context for personalized inference.

This module does not replace the global calibrated_word_model.npz artefact.
It overlays user-specific POT gating, optional EMG reference prototypes, and
optional stored neutral baseline adaptation on top of the global model.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from runtime.session_adaptation import SessionAdapter, SessionProfile


@dataclass
class UserNeutralCalibration:
    baseline_adc: float
    noise_floor: float | None = None
    emg_std: float | None = None
    pot_mean: float | None = None
    sample_count: int | None = None


@dataclass
class UserWordCalibration:
    word_label: str
    state: str
    pot_center: float | None = None
    pot_radius: float | None = None
    emg_reference: np.ndarray | None = None
    quality_score: float | None = None
    capture_count: int = 0

    @property
    def is_calibrated(self) -> bool:
        return self.state == "calibrated"

    @property
    def has_pot_personalization(self) -> bool:
        return self.is_calibrated and self.pot_center is not None

    @property
    def has_emg_reference(self) -> bool:
        return (
            self.is_calibrated
            and self.emg_reference is not None
            and self.emg_reference.size > 0
        )


@dataclass
class UserCalibrationContext:
    profile_version: int
    model_sha256: str | None
    profile_compatible: bool
    neutral: UserNeutralCalibration | None = None
    words: dict[str, UserWordCalibration] = field(default_factory=dict)

    def is_applicable(self) -> bool:
        if not self.profile_compatible:
            return False
        if self.neutral is not None:
            return True
        return any(word.has_pot_personalization or word.has_emg_reference for word in self.words.values())

    def calibrated_word_labels(self) -> list[str]:
        return sorted(
            word.word_label
            for word in self.words.values()
            if word.is_calibrated
        )

    def pot_personalized_labels(self) -> list[str]:
        return sorted(
            word.word_label for word in self.words.values() if word.has_pot_personalization
        )

    def emg_reference_labels(self) -> list[str]:
        return sorted(word.word_label for word in self.words.values() if word.has_emg_reference)

    def effective_pot_arrays(self, model: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
        label_names = list(model["label_names"])
        pot_centers = np.asarray(model["pot_centers"], dtype=np.float32).copy()
        pot_radii = np.asarray(model["pot_radii"], dtype=np.float32).copy()

        for index, label in enumerate(label_names):
            word = self.words.get(label)
            if word is None or not word.has_pot_personalization:
                continue
            pot_centers[index] = float(word.pot_center)
            if word.pot_radius is not None and float(word.pot_radius) > 0:
                pot_radii[index] = max(1.0, float(word.pot_radius))

        return pot_centers, pot_radii

    def effective_references(
        self, model: dict[str, Any]
    ) -> tuple[np.ndarray, np.ndarray]:
        references = np.asarray(model["references"], dtype=np.float32)
        reference_labels = np.asarray(model["reference_labels"], dtype=np.int64)

        extra_refs = []
        extra_labels = []
        label_to_id = {name: idx for idx, name in enumerate(model["label_names"])}

        for label, word in self.words.items():
            if not word.has_emg_reference:
                continue
            label_id = label_to_id.get(label)
            if label_id is None:
                continue
            extra_refs.append(np.asarray(word.emg_reference, dtype=np.float32).reshape(-1))
            extra_labels.append(label_id)

        if not extra_refs:
            return references, reference_labels

        appended_refs = np.vstack([references, np.vstack(extra_refs)])
        appended_labels = np.concatenate([reference_labels, np.asarray(extra_labels, dtype=np.int64)])
        return appended_refs, appended_labels

    def create_baseline_adapter(self, model: dict[str, Any]) -> SessionAdapter | None:
        if self.neutral is None:
            return None
        training_profile = model.get("training_profile")
        if training_profile is None:
            return None

        noise_floor = float(self.neutral.noise_floor or 1.0)
        emg_std = float(self.neutral.emg_std or noise_floor)
        active_scale = max(noise_floor * 2.5, emg_std * 2.5)
        peak_scale = max(active_scale, active_scale * 1.15)
        quiet_gate = float(self.neutral.baseline_adc) + max(noise_floor * 2.4, 10.0)

        session_profile = SessionProfile(
            baseline=float(self.neutral.baseline_adc),
            noise_floor=noise_floor,
            active_scale=active_scale,
            peak_scale=peak_scale,
            quiet_gate=quiet_gate,
        )
        return SessionAdapter(training_profile, session_profile)

    def personalization_meta(self) -> dict[str, Any]:
        return {
            "applied": self.is_applicable(),
            "profileVersion": int(self.profile_version),
            "modelSha256Match": bool(self.profile_compatible),
            "profileFallbackRequired": not self.profile_compatible,
            "calibratedWords": self.calibrated_word_labels(),
            "potPersonalizedWords": self.pot_personalized_labels(),
            "emgReferenceWords": self.emg_reference_labels(),
        }


def _parse_emg_reference(raw: Any) -> np.ndarray | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        arr = np.asarray(raw, dtype=np.float32).reshape(-1)
        if arr.size == 0 or not np.isfinite(arr).all():
            return None
        return arr
    return None


def parse_user_calibration_payload(payload: dict[str, Any] | None) -> UserCalibrationContext | None:
    if not payload:
        return None

    profile_version = int(payload.get("profileVersion") or 1)
    model_sha256 = payload.get("modelSha256")
    profile_compatible = bool(payload.get("profileCompatible", True))

    neutral = None
    neutral_raw = payload.get("neutral")
    if isinstance(neutral_raw, dict) and neutral_raw.get("baselineAdc") is not None:
        neutral = UserNeutralCalibration(
            baseline_adc=float(neutral_raw["baselineAdc"]),
            noise_floor=(
                float(neutral_raw["noiseFloor"])
                if neutral_raw.get("noiseFloor") is not None
                else None
            ),
            emg_std=(
                float(neutral_raw["emgStd"]) if neutral_raw.get("emgStd") is not None else None
            ),
            pot_mean=(
                float(neutral_raw["potMean"]) if neutral_raw.get("potMean") is not None else None
            ),
            sample_count=(
                int(neutral_raw["sampleCount"])
                if neutral_raw.get("sampleCount") is not None
                else None
            ),
        )

    words: dict[str, UserWordCalibration] = {}
    words_raw = payload.get("words") or {}
    if isinstance(words_raw, dict):
        for label, item in words_raw.items():
            if not isinstance(item, dict):
                continue
            words[str(label)] = UserWordCalibration(
                word_label=str(label),
                state=str(item.get("state") or "pending"),
                pot_center=(
                    float(item["potCenter"]) if item.get("potCenter") is not None else None
                ),
                pot_radius=(
                    float(item["potRadius"]) if item.get("potRadius") is not None else None
                ),
                emg_reference=_parse_emg_reference(item.get("emgReference")),
                quality_score=(
                    float(item["qualityScore"])
                    if item.get("qualityScore") is not None
                    else None
                ),
                capture_count=int(item.get("captureCount") or 0),
            )

    return UserCalibrationContext(
        profile_version=profile_version,
        model_sha256=str(model_sha256) if model_sha256 else None,
        profile_compatible=profile_compatible,
        neutral=neutral,
        words=words,
    )
