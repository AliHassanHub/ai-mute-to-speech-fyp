-- =============================================================================
-- EMG Mute-to-Speech — Canonical BASE database schema
-- =============================================================================
--
-- Convention:
--   1. Apply this file to a fresh empty database (schema.sql = pre-migration base)
--   2. Apply migrations/001_personalized_calibration_phase1.sql
--   3. Apply migrations/002_notification_preferences.sql
--
-- This file intentionally does NOT include:
--   - calibration_word_entries / calibration_neutral_baseline (migration 001)
--   - calibration_profiles Phase-1 columns (profile_version, model_sha256, status, overall_quality)
--   - users.notification_preferences (migration 002)
--
-- Engine / charset: InnoDB, utf8mb4 / utf8mb4_unicode_ci
-- DDL only — no seed data, no credentials.
-- =============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
    `user_id` INT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(150) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `profile_image_url` VARCHAR(255) DEFAULT NULL,
    `language` VARCHAR(20) DEFAULT 'English',
    `notifications_enabled` TINYINT(1) DEFAULT 1,
    `is_active` TINYINT(1) DEFAULT 1,
    `last_login` TIMESTAMP NULL DEFAULT NULL,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `email_verified` TINYINT(1) DEFAULT 0,
    PRIMARY KEY (`user_id`),
    UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- email_verification_tokens (pending signup OTP records)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `email_verification_tokens` (
    `verification_id` INT NOT NULL AUTO_INCREMENT,
    `user_email` VARCHAR(150) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `otp_code` VARCHAR(6) NOT NULL,
    `expires_at` TIMESTAMP NOT NULL,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`verification_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- password_reset_tokens
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `password_reset_tokens` (
    `token_id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `otp_code` VARCHAR(255) NOT NULL,
    `verified` TINYINT(1) DEFAULT 0,
    `expires_at` TIMESTAMP NOT NULL,
    `used` TINYINT(1) DEFAULT 0,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`token_id`),
    UNIQUE KEY `token` (`otp_code`),
    UNIQUE KEY `unique_reset_user` (`user_id`),
    CONSTRAINT `password_reset_tokens_ibfk_1`
        FOREIGN KEY (`user_id`)
        REFERENCES `users` (`user_id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- calibration_profiles (legacy JSON blob + scalar baseline fields)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `calibration_profiles` (
    `calibration_id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `baseline_value` DECIMAL(10, 5) NOT NULL,
    `threshold_level` DECIMAL(10, 5) NOT NULL,
    `calibration_data` LONGTEXT DEFAULT NULL,
    `calibration_date` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `is_active` TINYINT(1) DEFAULT 1,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`calibration_id`),
    KEY `idx_cp_user_active` (`user_id`, `is_active`),
    CONSTRAINT `calibration_profiles_ibfk_1`
        FOREIGN KEY (`user_id`)
        REFERENCES `users` (`user_id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- bluetooth_connections (one row per user)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bluetooth_connections` (
    `connection_id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `device_name` VARCHAR(100) NOT NULL,
    `device_mac` VARCHAR(50) DEFAULT NULL,
    `connection_status` ENUM('connected', 'disconnected') DEFAULT 'disconnected',
    `connected_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `disconnected_at` TIMESTAMP NULL DEFAULT NULL,
    `last_seen` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`connection_id`),
    UNIQUE KEY `uk_bluetooth_user` (`user_id`),
    CONSTRAINT `bluetooth_connections_ibfk_1`
        FOREIGN KEY (`user_id`)
        REFERENCES `users` (`user_id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- sessions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sessions` (
    `session_id` INT NOT NULL AUTO_INCREMENT,
    `user_id` INT NOT NULL,
    `start_time` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `end_time` TIMESTAMP NULL DEFAULT NULL,
    `status` ENUM('active', 'completed', 'failed') DEFAULT 'active',
    `device_name` VARCHAR(100) DEFAULT NULL,
    `word_count` INT DEFAULT 0,
    `average_confidence` DECIMAL(5, 2) DEFAULT NULL,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`session_id`),
    KEY `user_id` (`user_id`),
    CONSTRAINT `sessions_ibfk_1`
        FOREIGN KEY (`user_id`)
        REFERENCES `users` (`user_id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- emg_recordings
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `emg_recordings` (
    `recording_id` INT NOT NULL AUTO_INCREMENT,
    `session_id` INT NOT NULL,
    `raw_signal_data` LONGTEXT NOT NULL,
    `channel_count` TINYINT DEFAULT 6,
    `sampling_rate` INT NOT NULL,
    `duration_ms` INT NOT NULL,
    `signal_label` VARCHAR(50) DEFAULT NULL,
    `timestamp` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`recording_id`),
    KEY `session_id` (`session_id`),
    CONSTRAINT `emg_recordings_ibfk_1`
        FOREIGN KEY (`session_id`)
        REFERENCES `sessions` (`session_id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- processed_recordings
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `processed_recordings` (
    `processed_id` INT NOT NULL AUTO_INCREMENT,
    `recording_id` INT NOT NULL,
    `processed_data` LONGTEXT DEFAULT NULL,
    `feature_vector` LONGTEXT NOT NULL,
    `normalization_factor` DECIMAL(10, 5) NOT NULL,
    `noise_reduction_level` DECIMAL(10, 5) DEFAULT NULL,
    `processed_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`processed_id`),
    UNIQUE KEY `recording_id` (`recording_id`),
    CONSTRAINT `processed_recordings_ibfk_1`
        FOREIGN KEY (`recording_id`)
        REFERENCES `emg_recordings` (`recording_id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- text_results
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `text_results` (
    `text_id` INT NOT NULL AUTO_INCREMENT,
    `processed_id` INT NOT NULL,
    `recognized_text` TEXT NOT NULL,
    `translated_text` TEXT DEFAULT NULL,
    `source_language` VARCHAR(20) DEFAULT 'English',
    `target_language` VARCHAR(20) DEFAULT 'English',
    `confidence_score` DECIMAL(5, 2) NOT NULL,
    `processing_time_ms` INT NOT NULL,
    `created_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`text_id`),
    UNIQUE KEY `processed_id` (`processed_id`),
    CONSTRAINT `text_results_ibfk_1`
        FOREIGN KEY (`processed_id`)
        REFERENCES `processed_recordings` (`processed_id`)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
