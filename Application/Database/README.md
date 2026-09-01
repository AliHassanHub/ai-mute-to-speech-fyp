# Database

Version-controlled MySQL schema for `emg_mute_to_speech`.

## Convention

| Artifact | Purpose |
|----------|---------|
| `schema.sql` | **Base schema** — fresh database DDL (pre-migration) |
| `migrations/001_*.sql` | Phase 1 personalized calibration tables + profile columns |
| `migrations/002_*.sql` | Per-category `users.notification_preferences` JSON |
| `migrations/*_rollback.sql` | Rollback scripts where provided |
| `scripts/validate-fresh-schema.js` | Validates base + migrations against live dev schema |
| `backups/` | Generated pre-migration backups (gitignored) |

**Versioning rule:** `schema.sql` is the original base. Migrations `001` and `002` are applied **in order** on top. Do not duplicate migration-only tables/columns in `schema.sql`.

## Fresh database setup

### 1. Create database

```sql
CREATE DATABASE emg_mute_to_speech
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

### 2. Apply base schema

```bash
mysql -u <user> -p emg_mute_to_speech < Application/Database/schema.sql
```

### 3. Apply migration 001 (personalized calibration)

```bash
cd Application/server
node scripts/run-phase1-migration.js
```

Or apply SQL directly:

```bash
mysql -u <user> -p emg_mute_to_speech < Application/Database/migrations/001_personalized_calibration_phase1.sql
```

### 4. Apply migration 002 (notification preferences)

```bash
cd Application/server
node scripts/run-notification-preferences-migration.js
```

Or apply SQL directly:

```bash
mysql -u <user> -p emg_mute_to_speech < Application/Database/migrations/002_notification_preferences.sql
```

### 5. Verify

```bash
cd Application/server
node scripts/verify-phase1-migration.js
node scripts/verify-notification-preferences.js
```

Validate full base + migration chain (creates and drops a temporary test database):

```bash
node Application/Database/scripts/validate-fresh-schema.js
```

## Base tables (`schema.sql`)

| Table | Purpose |
|-------|---------|
| `users` | Accounts, profile, language, master notification toggle |
| `email_verification_tokens` | Pending signup OTP records |
| `password_reset_tokens` | Password reset OTP flow |
| `calibration_profiles` | Legacy JSON calibration blob + scalar baseline |
| `bluetooth_connections` | Last known BLE device per user |
| `sessions` | EMG recording sessions |
| `emg_recordings` | Raw EMG/POT signal JSON |
| `processed_recordings` | Processed signal + feature vectors |
| `text_results` | Recognized / translated text |

## Added by migrations

| Migration | Adds |
|-----------|------|
| **001** | `calibration_word_entries`, `calibration_neutral_baseline`; extends `calibration_profiles` with `profile_version`, `model_sha256`, `status`, `overall_quality`; index `idx_cp_user_status` |
| **002** | `users.notification_preferences` JSON column |

## Character set

- **Charset:** `utf8mb4`
- **Collation:** `utf8mb4_unicode_ci`
- **Engine:** `InnoDB`

Supports Urdu/Punjabi and other Unicode text in `TEXT` / `LONGTEXT` / `JSON` columns.

## Applied migrations log

| Version | Date | File | Purpose |
|---------|------|------|---------|
| 001 | 2026-08-29 | `001_personalized_calibration_phase1.sql` | Normalized per-user calibration |
| 002 | 2026-08-30 | `002_notification_preferences.sql` | Per-category notification JSON |

## Rollback

Phase 1 rollback (does not remove `calibration_profiles` rows or JSON):

```bash
mysql -u <user> -p emg_mute_to_speech < Application/Database/migrations/001_personalized_calibration_phase1_rollback.sql
```

Migration 002 rollback:

```sql
ALTER TABLE users DROP COLUMN notification_preferences;
```

## Notes

- Migration runners are idempotent (skip DDL if column/table/index already exists).
- `schema.sql` contains **DDL only** — no seed data, passwords, or tokens.
- Do not run validation or migration tests against production data without a separate database.
