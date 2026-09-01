# AI Mute-to-Speech (EMG FYP 2026)

Final-year project: a mobile-assisted EMG silent-speech system that connects an ESP32
EMG + potentiometer sensor over Bluetooth, runs personalized calibration, predicts
calibrated words via a Python AI service, and supports translation, TTS, and
notifications through a Node.js backend.

## Project Overview

Users wear/connect an ESP32-based EMG sensor, calibrate word-specific EMG + POT
profiles, perform live word inference, and receive spoken/translated output. The
system stores sessions, recordings, calibration data, and history in MySQL.

## Architecture

```
Android APK (Expo / React Native)
    ↓ HTTPS / REST + JWT
Node.js API (Express)
    ↓ HTTP (private)
Python FastAPI AI service (calibrated word model)
    ↓
MySQL
```

BLE communication between the phone and ESP32 is local only and does not pass
through the backend.

## Monorepo Structure

```
AI-Mute-To-Speech-FYP-2026/
├── Application/
│   ├── client/          # React Native / Expo Android app
│   ├── server/          # Node.js Express API
│   └── Database/        # Canonical schema, migrations, and backups
├── EMG_Silent_Speech/
│   ├── ai_service/      # FastAPI inference HTTP service
│   ├── runtime/         # Calibrated word predictor implementation
│   ├── training/        # Training scripts and model artefacts
│   ├── captures/        # Validation / reference EMG captures
│   └── tests/           # Python integration tests
└── Hardware/
    └── esp32_ai_usb_bluetooth/   # ESP32 firmware (BLE + EMG + POT)
```

## Client

- **Stack:** React Native, Expo, EAS Build
- **Location:** `Application/client/`
- **Key areas:** BLE connection, calibration UI, live inference buffer, translation,
  TTS, notifications
- **API config:** `EXPO_PUBLIC_API_URL` (must end with `/api`)

### Development

```bash
cd Application/client
cp .env.example .env
npm install
npx expo start --dev-client
```

## Node.js API

- **Stack:** Express 5, MySQL2, JWT, bcrypt, nodemailer
- **Location:** `Application/server/`
- **Entry:** `src/server.js`
- **Default port:** `5000`
- **Proxies inference** to the Python AI service via `AI_SERVICE_URL`

### Development

```bash
cd Application/server
cp .env.example .env
npm install
npm run dev
```

## Python AI

- **Stack:** FastAPI, uvicorn, numpy
- **Location:** `EMG_Silent_Speech/ai_service/`
- **Active model:** `training/results/calibrated_word_model_v6.npz`
- **Labels (9):** help, no, pain, stop, Assistance, Medical, Pick, Land, Up
- **Default port:** `8077`

### Development

```bash
cd EMG_Silent_Speech
python -m pip install -r ai_service/requirements.txt
cp ai_service/.env.example ai_service/.env
# Set EMG_AI_MODEL_PATH in ai_service/.env if needed
python -m uvicorn ai_service.app.main:app --port 8077
```

Health check: `GET /health` on the Python service (default port `8077`).

## MySQL

- **Database name:** `emg_mute_to_speech` (configurable)
- **Charset:** `utf8mb4` / `utf8mb4_unicode_ci`
- **Location:** `Application/Database/` — canonical schema, migrations, and backups

### Fresh database setup

Apply in this order:

**a. Create database**

```sql
CREATE DATABASE emg_mute_to_speech
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

**b. Apply base schema**

```bash
mysql -u <user> -p emg_mute_to_speech < Application/Database/schema.sql
```

**c. Run migration 001**

```bash
cd Application/server
node scripts/run-phase1-migration.js
```

Or apply SQL directly:

```bash
mysql -u <user> -p emg_mute_to_speech < Application/Database/migrations/001_personalized_calibration_phase1.sql
```

**d. Run migration 002**

```bash
cd Application/server
node scripts/run-notification-preferences-migration.js
```

Or apply SQL directly:

```bash
mysql -u <user> -p emg_mute_to_speech < Application/Database/migrations/002_notification_preferences.sql
```

See `Application/Database/README.md` for verification steps.

## BLE / ESP32

- **Firmware:** `Hardware/esp32_ai_usb_bluetooth/esp32_ai_usb_bluetooth.ino`
- **Protocol docs:** `Hardware/esp32_ai_usb_bluetooth/BLE_PROTOCOL.md`
- EMG on GPIO34, potentiometer on GPIO35
- The mobile app scans and connects via `react-native-ble-plx`

## Personalized Calibration

Each user calibrates supported words using real EMG and potentiometer (POT)
captures from the ESP32 sensor. Personalized references are stored per user in
MySQL (`calibration_profiles`, `calibration_word_entries`,
`calibration_neutral_baseline`). The global model (`calibrated_word_model_v6.npz`)
remains the fallback for words not yet personalized.

Word references are built via the Python `/calibration/word-reference` endpoint.
Migration 001 normalizes legacy JSON calibration data into the per-word tables.

## Translation

- Client-side translation integration for recognized / predicted text
- Results stored in `text_results` with source and target language fields

## TTS

- Client-side text-to-speech for spoken output of recognized phrases

## Notifications

Local push notifications with per-category preferences (`users.notification_preferences`,
migration 002). Supported events:

- Device connected / disconnected (BLE)
- Calibration complete / calibration required
- Accepted prediction result

Users can enable or disable categories independently. A master toggle is available
via `users.notifications_enabled`.

## Development Setup

1. Install **Node.js 18+**, **Python 3.10+**, and **MySQL 8**
2. Set up MySQL using `Application/Database/schema.sql` and migrations 001–002
   (see **MySQL** section above)
3. Copy `.env.example` → `.env` in `Application/server`, `Application/client`, and
   `EMG_Silent_Speech/ai_service`
4. Start MySQL, Python AI, Node API, then the Expo client
5. Flash ESP32 firmware and pair from the app

## Environment Variables

| Component | File | Key variables |
|-----------|------|---------------|
| Server | `Application/server/.env` | `PORT`, `JWT_SECRET`, `DB_*`, `EMAIL_*`, `AI_SERVICE_URL` |
| Client | `Application/client/.env` | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_ALLOW_EMG_SIMULATION` |
| Python AI | `EMG_Silent_Speech/ai_service/.env` | `EMG_AI_MODEL_PATH` |

Never commit real `.env` files. Use the `.env.example` templates only.

## Testing

### Client

```bash
cd Application/client
npm test
```

### Server

```bash
cd Application/server
npm test
```

### Python AI

```bash
cd EMG_Silent_Speech
python -m pytest ai_service/tests -q
```

## AI Model

| Property | Value |
|----------|-------|
| Active artefact | `calibrated_word_model_v6.npz` |
| Path | `EMG_Silent_Speech/training/results/calibrated_word_model_v6.npz` |
| Active labels (9) | help, no, pain, stop, Assistance, Medical, Pick, Land, Up |
| Size | ~384 KB |
| SHA-256 | `e829b06eb168567590c77a33f7bad8bc3fab44f6bdbb2bd11d8edaea2730a0ba` |
| Dependencies | numpy only (no torch at inference time) |

Earlier model versions (v1–v5) are retained in `EMG_Silent_Speech/training/results/`
for reference.

## Database Migrations

| Migration | Purpose |
|-----------|---------|
| `001_personalized_calibration_phase1.sql` | Normalized calibration tables |
| `002_notification_preferences.sql` | Per-category notification JSON on users |

Verification scripts are in `Application/server/scripts/`.

## Production Deployment Status

Production deployment is **planned but not yet completed**. The application is
fully implemented for development and FYP demonstration. Before go-live:

- HTTPS API endpoint and production Android build configuration
- Hosted Node.js API, private Python AI service, and managed MySQL
- Environment secrets and TLS termination

Component setup is documented in `Application/Database/README.md`,
`EMG_Silent_Speech/ai_service/README.md`, and the respective `.env.example`
files under `Application/server/` and `Application/client/`.

## Documentation

| Topic | Location |
|-------|----------|
| Database schema and migrations | `Application/Database/README.md` |
| Python inference API | `EMG_Silent_Speech/ai_service/README.md` |
| BLE protocol and firmware | `Hardware/esp32_ai_usb_bluetooth/` |

## License

Academic FYP project — see course/university requirements before public release.
