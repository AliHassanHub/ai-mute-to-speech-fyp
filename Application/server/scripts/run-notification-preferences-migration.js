/**
 * Notification preferences database migration (002).
 *
 * Adds users.notification_preferences JSON column with safe defaults.
 * Idempotent: skips if column already exists.
 *
 * Usage: node scripts/run-notification-preferences-migration.js
 */

require("dotenv").config({
    path: require("path").join(__dirname, "..", ".env"),
});

const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const MIGRATION_SQL = path.join(
    __dirname,
    "..",
    "..",
    "Database",
    "migrations",
    "002_notification_preferences.sql"
);

async function columnExists(connection, table, column) {
    const [rows] = await connection.query(
        `SELECT COUNT(*) AS c
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?`,
        [table, column]
    );
    return Number(rows[0].c) > 0;
}

function stripSqlComments(sqlText) {
    return sqlText
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n");
}

async function applySchemaStatements(connection, sqlText) {
    const cleaned = stripSqlComments(sqlText);
    const statements = cleaned
        .split(";")
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0);

    for (const statement of statements) {
        await connection.query(statement);
    }
}

async function main() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        multipleStatements: true,
    });

    try {
        const alreadyApplied = await columnExists(
            connection,
            "users",
            "notification_preferences"
        );

        if (alreadyApplied) {
            console.log(
                "Notification preferences column already exists. Skipping DDL."
            );
            return;
        }

        console.log("Applying notification preferences migration...");
        const sql = fs.readFileSync(MIGRATION_SQL, "utf8");
        await applySchemaStatements(connection, sql);
        console.log("Notification preferences migration applied.");
    } finally {
        await connection.end();
    }
}

main().catch((error) => {
    console.error("Notification preferences migration failed:", error.message);
    process.exit(1);
});
