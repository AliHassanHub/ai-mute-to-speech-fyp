require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const pool = require("../src/config/db");

async function main() {
    const [users] = await pool.query(
        `SELECT user_id, notifications_enabled, notification_preferences
         FROM users
         ORDER BY user_id
         LIMIT 5`
    );

    const [columns] = await pool.query(
        `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'users'
           AND COLUMN_NAME IN ('notifications_enabled', 'notification_preferences')`
    );

    console.log(
        JSON.stringify(
            {
                schema: columns,
                sampleUsers: users.map((row) => ({
                    user_id: row.user_id,
                    notifications_enabled: row.notifications_enabled,
                    notification_preferences:
                        typeof row.notification_preferences === "string"
                            ? JSON.parse(row.notification_preferences)
                            : row.notification_preferences,
                })),
            },
            null,
            2
        )
    );

    await pool.end();
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
