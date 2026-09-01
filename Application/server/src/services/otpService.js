const bcrypt = require("bcrypt");

const generateOTP = require("../utils/generateOTP");

const authModel = require("../models/authModel");

const { sendOTPEmail } = require("./emailService");

const pool = require("../config/db");

const sendSignupOTP = async (

    name,

    email,

    password

) => {

    const passwordHash = await bcrypt.hash(password, 10);

    const otp = generateOTP();

    const expiresAt = new Date(
    Date.now() +
    process.env.OTP_EXPIRE_MINUTES *
    60 *
    1000
);

await authModel.deletePendingVerification(email);

await authModel.saveVerificationToken(

    name,

    email,

    passwordHash,

    otp,

    expiresAt

);


await sendOTPEmail(

    email,

    otp,

    "Email Verification"

);

return {

    success: true,

    message: "Verification code sent successfully."

};

};

const sendForgotPasswordOTP = async (email) => {

    const user = await authModel.findUserByEmail(email);

    if (!user) {
        const error = new Error("No account found with this email.");

error.status = 404;

throw error;
    }

    const otp = generateOTP();

    const expiresAt = new Date(
        Date.now() +
        process.env.OTP_EXPIRE_MINUTES *
        60 *
        1000
    );

    await authModel.deletePasswordResetToken(
        user.user_id
    );

    await authModel.savePasswordResetToken(
        user.user_id,
        otp,
        expiresAt
    );

    await sendOTPEmail(
        email,
        otp,
        "Password Reset"
    );

    return {
        success: true,
        message: "Password reset OTP sent successfully."
    };
};

const verifyPasswordResetOTP = async (email, otp) => {

    const resetToken = await authModel.getPasswordResetTokenByEmail(email);

    if (!resetToken) {
        throw new Error("No password reset request found.");
    }

    if (resetToken.used) {
        throw new Error("This OTP has already been used.");
    }

    if (resetToken.otp_code !== otp) {
        throw new Error("Invalid OTP.");
    }

    const currentTime = new Date();
    const expiryTime = new Date(resetToken.expires_at);

    if (currentTime > expiryTime) {
        await authModel.deletePasswordResetTokenById(resetToken.token_id);

        throw new Error("OTP has expired.");
    }

    await authModel.markPasswordResetTokenAsVerified(
    resetToken.token_id
);

    return {
        success: true,
        message: "OTP verified successfully."
    };

};


const resetPassword = async (email, newPassword) => {
    const resetToken = await authModel.getPasswordResetTokenByEmail(email);

    if (!resetToken) {
        const error = new Error("Password reset request not found.");
        error.status = 404;
        throw error;
    }

    if (!resetToken.verified) {
        const error = new Error("OTP has not been verified.");
        error.status = 400;
        throw error;
    }

    if (resetToken.used) {
        const error = new Error("Password reset request already used.");
        error.status = 400;
        throw error;
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        await connection.query(
            `
            UPDATE users
            SET password_hash = ?
            WHERE user_id = ?
            `,
            [passwordHash, resetToken.user_id]
        );

        await connection.query(
            `
            UPDATE password_reset_tokens
            SET used = TRUE
            WHERE token_id = ?
            `,
            [resetToken.token_id]
        );

        await connection.query(
            `
            DELETE
            FROM password_reset_tokens
            WHERE token_id = ?
            `,
            [resetToken.token_id]
        );

        await connection.commit();

    } catch (error) {
        await connection.rollback();
        throw error;

    } finally {
        connection.release();
    }

    return {
        success: true,
        message: "Password reset successfully."
    };
};


module.exports = {

    sendSignupOTP,

    sendForgotPasswordOTP,

    verifyPasswordResetOTP,

    resetPassword

};