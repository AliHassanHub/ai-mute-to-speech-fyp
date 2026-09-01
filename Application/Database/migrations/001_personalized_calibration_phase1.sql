-- Migration: 001_personalized_calibration_phase1
-- Date: 2026-08-29
-- Purpose: Normalized per-user calibration foundation (word entries + neutral baseline)
-- Rollback: See Database/migrations/001_personalized_calibration_phase1_rollback.sql
-- Applied by: server/scripts/run-phase1-migration.js

-- ---------------------------------------------------------------------------
-- 1. Extend calibration_profiles (non-destructive)
-- ---------------------------------------------------------------------------
ALTER TABLE calibration_profiles
    ADD COLUMN profile_version INT NOT NULL DEFAULT 1 AFTER user_id,
    ADD COLUMN model_sha256 VARCHAR(64) NULL AFTER profile_version,
    ADD COLUMN status ENUM('draft', 'active', 'archived') NOT NULL DEFAULT 'active' AFTER model_sha256,
    ADD COLUMN overall_quality DECIMAL(5, 2) NULL AFTER status;

-- ---------------------------------------------------------------------------
-- 2. calibration_neutral_baseline — one neutral row per calibration profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calibration_neutral_baseline (
    neutral_id INT NOT NULL AUTO_INCREMENT,
    calibration_id INT NOT NULL,
    baseline_adc DECIMAL(10, 5) NOT NULL,
    noise_floor DECIMAL(10, 5) NULL,
    emg_std DECIMAL(10, 5) NULL,
    pot_mean DECIMAL(10, 5) NULL,
    sample_count INT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (neutral_id),
    UNIQUE KEY uk_cnb_calibration_id (calibration_id),
    CONSTRAINT calibration_neutral_baseline_ibfk_1
        FOREIGN KEY (calibration_id)
        REFERENCES calibration_profiles (calibration_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 3. calibration_word_entries — per-word state within a profile
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calibration_word_entries (
    entry_id INT NOT NULL AUTO_INCREMENT,
    calibration_id INT NOT NULL,
    word_label VARCHAR(50) NOT NULL,
    state ENUM('pending', 'calibrated', 'failed') NOT NULL DEFAULT 'pending',
    pot_center DECIMAL(10, 5) NULL,
    pot_radius DECIMAL(10, 5) NULL,
    emg_reference JSON NULL,
    quality_score DECIMAL(5, 2) NULL,
    capture_count INT NOT NULL DEFAULT 0,
    capture_metadata JSON NULL,
    calibrated_at TIMESTAMP NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (entry_id),
    UNIQUE KEY uk_cwe_calibration_word (calibration_id, word_label),
    KEY idx_cwe_calibration_id (calibration_id),
    KEY idx_cwe_word_label (word_label),
    CONSTRAINT calibration_word_entries_ibfk_1
        FOREIGN KEY (calibration_id)
        REFERENCES calibration_profiles (calibration_id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 4. Indexes on calibration_profiles for lookup by user + status/active
-- ---------------------------------------------------------------------------
CREATE INDEX idx_cp_user_status ON calibration_profiles (user_id, status);
CREATE INDEX idx_cp_user_active ON calibration_profiles (user_id, is_active);
