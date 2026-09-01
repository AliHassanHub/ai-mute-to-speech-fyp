-- Migration: 002_notification_preferences
-- Date: 2026-08-30
-- Purpose: Per-category notification preferences for authenticated users
-- Rollback: ALTER TABLE users DROP COLUMN notification_preferences;

ALTER TABLE users
    ADD COLUMN notification_preferences JSON NULL
    COMMENT 'Per-category notification preferences JSON object'
    AFTER notifications_enabled;

UPDATE users
SET notification_preferences = JSON_OBJECT(
    'deviceConnected', CAST(TRUE AS JSON),
    'deviceDisconnected', CAST(TRUE AS JSON),
    'calibrationComplete', CAST(TRUE AS JSON),
    'calibrationRequired', CAST(TRUE AS JSON),
    'predictionResult', CAST(TRUE AS JSON)
)
WHERE notification_preferences IS NULL;
