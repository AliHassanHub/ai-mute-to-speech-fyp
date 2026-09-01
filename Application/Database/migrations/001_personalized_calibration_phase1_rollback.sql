-- Rollback: 001_personalized_calibration_phase1
-- WARNING: Destroys normalized calibration rows created in Phase 1.
-- Does NOT remove calibration_profiles rows or calibration_data JSON.
-- Run only if Phase 1 migration must be reversed before Phase 2.

DROP TABLE IF EXISTS calibration_word_entries;
DROP TABLE IF EXISTS calibration_neutral_baseline;

DROP INDEX idx_cp_user_status ON calibration_profiles;
DROP INDEX idx_cp_user_active ON calibration_profiles;

ALTER TABLE calibration_profiles
    DROP COLUMN overall_quality,
    DROP COLUMN status,
    DROP COLUMN model_sha256,
    DROP COLUMN profile_version;
