const pool = require("../config/db");

const getProfileByUserId = async (userId) => {

    const [rows] = await pool.query(

        `
       SELECT

    u.user_id,

    u.name,

    u.email,

    u.profile_image_url,

    u.language,

    u.notifications_enabled,

    u.notification_preferences,

    u.created_at,

    u.updated_at,

    cp.calibration_id,

    cp.calibration_date,

    cp.is_active

FROM users u

LEFT JOIN calibration_profiles cp

ON cp.calibration_id = (

    SELECT calibration_id

    FROM calibration_profiles

    WHERE user_id = u.user_id

    AND is_active = TRUE

    ORDER BY calibration_date DESC

    LIMIT 1

)

WHERE u.user_id = ?

LIMIT 1;
        `,

        [userId]

    );

    return rows[0];

};

const getUserById = async (userId) => {

    const [rows] = await pool.query(

        `
        SELECT *

        FROM users

        WHERE user_id = ?

        LIMIT 1
        `,

        [userId]

    );

    return rows[0];

};


const updateProfile = async (

    userId,

    name

) => {

    const [result] = await pool.query(

        `
        UPDATE users

        SET

            name = ?

        WHERE user_id = ?
        `,

        [

            name,

            userId

        ]

    );

    return result;

};

const updateProfileImage = async (

    userId,

    profileImageUrl

) => {

    const [result] = await pool.query(

        `
        UPDATE users

        SET

            profile_image_url = ?

        WHERE user_id = ?
        `,

        [

            profileImageUrl,

            userId

        ]

    );

    return result;

};

const getPasswordByUserId = async (

    userId

) => {

    const [rows] = await pool.query(

        `
        SELECT

            password_hash

        FROM users

        WHERE user_id = ?

        LIMIT 1
        `,

        [

            userId

        ]

    );

    return rows[0];

};

const updatePassword = async (

    userId,

    passwordHash

) => {

    const [result] = await pool.query(

        `
        UPDATE users

        SET

            password_hash = ?

        WHERE user_id = ?
        `,

        [

            passwordHash,

            userId

        ]

    );

    return result;

};

const updatePasswordWithTransaction = async (

    userId,

    passwordHash

) => {

    await updatePassword(userId, passwordHash);

};

const updateNotificationPreference = async (

    userId,

    notificationsEnabled

) => {

    const [result] = await pool.query(

        `
        UPDATE users

        SET

            notifications_enabled = ?

        WHERE user_id = ?
        `,

        [

            notificationsEnabled,

            userId

        ]

    );

    return result;

};

const updateNotificationSettings = async (

    userId,

    { notificationsEnabled, notificationPreferences }

) => {

    const fields = [];
    const values = [];

    if (typeof notificationsEnabled === "boolean") {
        fields.push("notifications_enabled = ?");
        values.push(notificationsEnabled);
    }

    if (notificationPreferences != null) {
        fields.push("notification_preferences = ?");
        values.push(notificationPreferences);
    }

    if (fields.length === 0) {
        return { affectedRows: 0 };
    }

    values.push(userId);

    const [result] = await pool.query(

        `
        UPDATE users

        SET

            ${fields.join(", ")}

        WHERE user_id = ?
        `,

        values

    );

    return result;

};

const updateLanguagePreference = async (

    userId,

    languageValue

) => {

    const [result] = await pool.query(

        `
        UPDATE users

        SET

            language = ?

        WHERE user_id = ?
        `,

        [

            languageValue,

            userId

        ]

    );

    return result;

};

const deleteUserAccount = async (userId) => {

    const [result] = await pool.query(

        `
        DELETE

        FROM users

        WHERE user_id = ?
        `,

        [

            userId

        ]

    );

    return result;

};

module.exports = {

    getProfileByUserId,

    getUserById,

    updateProfile,

    updateProfileImage,

    getPasswordByUserId,

    updatePassword,

    updatePasswordWithTransaction,

    updateNotificationPreference,

    updateNotificationSettings,

    updateLanguagePreference,

    deleteUserAccount

};



