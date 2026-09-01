/**
 * Fresh-database schema validation (temporary test harness).
 * Creates emg_mute_to_speech_schema_test, applies schema + migrations,
 * compares structure to live dev DB. Does NOT modify live database.
 */
const fs = require("fs");
const path = require("path");
const serverRoot = path.join(__dirname, "../../server");
require(path.join(serverRoot, "node_modules/dotenv")).config({
    path: path.join(serverRoot, ".env"),
});
const mysql = require(path.join(serverRoot, "node_modules/mysql2/promise"));

const TEST_DB = "emg_mute_to_speech_schema_test";
const DB_ROOT = path.join(__dirname, "..");
const SCHEMA_SQL = path.join(DB_ROOT, "schema.sql");
const MIGRATION_001 = path.join(
    DB_ROOT,
    "migrations/001_personalized_calibration_phase1.sql"
);
const MIGRATION_002 = path.join(
    DB_ROOT,
    "migrations/002_notification_preferences.sql"
);

const REQUIRED_TABLES = [
    "users",
    "email_verification_tokens",
    "password_reset_tokens",
    "calibration_profiles",
    "calibration_word_entries",
    "calibration_neutral_baseline",
    "bluetooth_connections",
    "sessions",
    "emg_recordings",
    "processed_recordings",
    "text_results",
];

function stripSqlComments(sqlText) {
    return sqlText
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
}

async function applySqlFile(connection, filePath) {
    const sql = fs.readFileSync(filePath, "utf8");
    const cleaned = stripSqlComments(sql);
    const statements = cleaned
        .split(";")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);

    for (const statement of statements) {
        const indexMatch = statement.match(/^CREATE INDEX\s+(\w+)\s+ON\s+(\w+)/i);
        if (indexMatch) {
            const [, indexName, tableName] = indexMatch;
            const [rows] = await connection.query(
                `SELECT COUNT(*) AS c
                 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = ?
                   AND INDEX_NAME = ?`,
                [tableName, indexName]
            );
            if (Number(rows[0].c) > 0) {
                continue;
            }
        }
        await connection.query(statement);
    }
}

function normalizeCreateTable(ddl) {
    return ddl
        .replace(/\s+AUTO_INCREMENT=\d+/gi, "")
        .replace(/`/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

async function getCreateMap(connection) {
    const [tables] = await connection.query(
        `SELECT TABLE_NAME
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE()
         ORDER BY TABLE_NAME`
    );
    const map = new Map();
    for (const row of tables) {
        const name = row.TABLE_NAME;
        const [createRows] = await connection.query("SHOW CREATE TABLE ??", [name]);
        map.set(name, createRows[0]["Create Table"]);
    }
    return map;
}

async function main() {
    const liveDb = process.env.DB_NAME;
    const rootConnection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        multipleStatements: true,
    });

    console.log(`[1/6] Dropping and creating test database: ${TEST_DB}`);
    await rootConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
    await rootConnection.query(
        `CREATE DATABASE \`${TEST_DB}\`
         DEFAULT CHARACTER SET utf8mb4
         COLLATE utf8mb4_unicode_ci`
    );

    const testConnection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: TEST_DB,
        multipleStatements: true,
    });

    try {
        console.log("[2/6] Applying schema.sql");
        await applySqlFile(testConnection, SCHEMA_SQL);

        console.log("[3/6] Applying migration 001");
        await applySqlFile(testConnection, MIGRATION_001);

        console.log("[4/6] Applying migration 002");
        await applySqlFile(testConnection, MIGRATION_002);

        console.log("[5/6] Verifying required tables/columns");
        for (const table of REQUIRED_TABLES) {
            const [rows] = await testConnection.query(
                `SELECT COUNT(*) AS c
                 FROM information_schema.TABLES
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = ?`,
                [table]
            );
            if (Number(rows[0].c) !== 1) {
                throw new Error(`Missing table: ${table}`);
            }
        }

        const [userCols] = await testConnection.query(
            `SELECT COLUMN_NAME
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'users'
             ORDER BY ORDINAL_POSITION`
        );
        const userColumnNames = userCols.map((row) => row.COLUMN_NAME);
        for (const column of [
            "notifications_enabled",
            "notification_preferences",
            "email_verified",
        ]) {
            if (!userColumnNames.includes(column)) {
                throw new Error(`Missing users.${column}`);
            }
        }

        const liveConnection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: liveDb,
        });

        console.log("[6/6] Comparing test schema to live development schema");
        const testMap = await getCreateMap(testConnection);
        const liveMap = await getCreateMap(liveConnection);
        const differences = [];

        for (const table of REQUIRED_TABLES) {
            const testDdl = testMap.get(table);
            const liveDdl = liveMap.get(table);
            if (!testDdl || !liveDdl) {
                differences.push({ table, issue: "missing in one database" });
                continue;
            }
            if (normalizeCreateTable(testDdl) !== normalizeCreateTable(liveDdl)) {
                differences.push({ table, issue: "DDL mismatch" });
            }
        }

        await liveConnection.end();

        if (differences.length > 0) {
            console.error("Schema differences found:");
            for (const diff of differences) {
                console.error(` - ${diff.table}: ${diff.issue}`);
            }
            process.exitCode = 1;
            return;
        }

        console.log("PASS: test schema matches live development schema structure.");
        console.log(`PASS: all ${REQUIRED_TABLES.length} required tables present.`);
        console.log("PASS: migrations 001 and 002 applied successfully.");
    } finally {
        await testConnection.end();
        await rootConnection.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
        await rootConnection.end();
    }
}

main().catch((error) => {
    console.error("Schema validation failed:", error.message);
    process.exit(1);
});
