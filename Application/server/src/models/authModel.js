const pool = require("../config/db");



const findUserByEmail = async (email) => {

    const [rows] = await pool.query(

        `
        SELECT *
        FROM users
        WHERE email = ?
        LIMIT 1
        `,
        [email]

    );

    return rows[0];

};


const findPendingVerification = async (email) => {

    const [rows] = await pool.query(

        `
        SELECT *
        FROM email_verification_tokens
        WHERE user_email = ?
        LIMIT 1
        `,
        [email]

    );

    return rows[0];

};

const deletePendingVerification = async (email) => {

    await pool.query(

        `
        DELETE
        FROM email_verification_tokens
        WHERE user_email = ?
        `,
        [email]

    );

};


const saveVerificationToken = async (

    name,
    email,
    passwordHash,
    otp,
    expiresAt

) => {

    const [result] = await pool.query(

        `
        INSERT INTO email_verification_tokens
        (
            user_email,
            name,
            password_hash,
            otp_code,
            expires_at
        )

        VALUES (?, ?, ?, ?, ?)
        `,

        [
            email,
            name,
            passwordHash,
            otp,
            expiresAt
        ]

    );

    return result.insertId;

};


const getVerificationRecord = async (email) => {

    const [rows] = await pool.query(

        `
        SELECT *
        FROM email_verification_tokens
        WHERE user_email = ?
        LIMIT 1
        `,
        [email]

    );

    return rows[0];

};


const createUser = async (
    connection,
    name,
    email,
    passwordHash
) => {

    const [result] = await connection.query(

        `
        INSERT INTO users
        (
            name,
            email,
            password_hash
        )
        VALUES (?, ?, ?)
        `,

        [
            name,
            email,
            passwordHash
        ]

    );

    return result.insertId;

};


const deleteVerificationRecord = async (
    connection,
    email
) => {

    await connection.query(

        `
        DELETE FROM email_verification_tokens
        WHERE user_email = ?
        `,

        [email]

    );

};


const findUserById = async (userId) => {

    const [rows] = await pool.query(

        `
        SELECT

            user_id,

            name,

            email,

            profile_image_url,

            language,

            notifications_enabled,

            is_active,

            created_at

        FROM users

        WHERE user_id = ?

        LIMIT 1
        `,

        [userId]

    );

    return rows[0];

};

const updateLastLogin = async (userId) => {

    await pool.query(

        `
        UPDATE users
        SET last_login = CURRENT_TIMESTAMP
        WHERE user_id = ?
        `,

        [userId]

    );

};

const deletePasswordResetToken = async (userId) => {

    await pool.query(

        `
        DELETE FROM password_reset_tokens
        WHERE user_id = ?
        `,

        [userId]

    );

};

const savePasswordResetToken = async (

    userId,

    otp,

    expiresAt

) => {

    await pool.query(

        `
        INSERT INTO password_reset_tokens
        (

            user_id,

            otp_code,

            expires_at,

            used

        )

        VALUES (?, ?, ?, FALSE)

        `,

        [

            userId,

            otp,

            expiresAt

        ]

    );

};

const getPasswordResetToken = async (userId) => {

    const [rows] = await pool.query(

        `
        SELECT *

        FROM password_reset_tokens

        WHERE user_id = ?

        LIMIT 1
        `,

        [userId]

    );

    return rows[0];

};

const getPasswordResetTokenByEmail = async (email) => {

    const [rows] = await pool.query(

        `
        SELECT
            prt.*,
            u.email
        FROM password_reset_tokens prt
        INNER JOIN users u
            ON prt.user_id = u.user_id
        WHERE u.email = ?
        LIMIT 1
        `,

        [email]

    );

    return rows[0];

};

const markPasswordResetTokenAsUsed = async (tokenId) => {

    await pool.query(

        `
        UPDATE password_reset_tokens
        SET used = TRUE
        WHERE token_id = ?
        `,

        [tokenId]

    );

};

const deletePasswordResetTokenById = async (tokenId) => {

    await pool.query(

        `
        DELETE
        FROM password_reset_tokens
        WHERE token_id = ?
        `,

        [tokenId]

    );

};

const markPasswordResetTokenAsVerified = async (tokenId) => {

    await pool.query(

        `
        UPDATE password_reset_tokens
        SET verified = TRUE
        WHERE token_id = ?
        `,

        [tokenId]

    );

};

const getVerifiedPasswordResetToken = async (userId) => {

    const [rows] = await pool.query(

        `
        SELECT *
        FROM password_reset_tokens
        WHERE user_id = ?
        AND verified = TRUE
        AND used = FALSE
        LIMIT 1
        `,

        [userId]

    );

    return rows[0];

};

const updateUserPassword = async (

    userId,

    passwordHash

) => {

    await pool.query(

        `
        UPDATE users
        SET password_hash = ?
        WHERE user_id = ?
        `,

        [

            passwordHash,

            userId

        ]

    );

};

const completePasswordReset = async (

    tokenId

) => {

    await pool.query(

        `
        UPDATE password_reset_tokens
        SET used = TRUE
        WHERE token_id = ?
        `,

        [

            tokenId

        ]

    );

};


module.exports = {

    findUserByEmail,

    findPendingVerification,

    deletePendingVerification,

    saveVerificationToken,

    getVerificationRecord,

    createUser,

    deleteVerificationRecord,

    findUserById,

    updateLastLogin,

    deletePasswordResetToken,

    savePasswordResetToken,

    getPasswordResetToken,

      getPasswordResetTokenByEmail,

    markPasswordResetTokenAsUsed,

    deletePasswordResetTokenById,

     markPasswordResetTokenAsVerified,

    getVerifiedPasswordResetToken,

    updateUserPassword,

    completePasswordReset

};