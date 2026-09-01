const toPositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const isProduction = process.env.NODE_ENV === "production";

module.exports = {
    login: {
        windowMs: toPositiveInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS, 15 * 60 * 1000),
        max: toPositiveInt(
            process.env.RATE_LIMIT_LOGIN_MAX,
            isProduction ? 10 : 100
        ),
    },
    otpGenerate: {
        windowMs: toPositiveInt(process.env.RATE_LIMIT_OTP_GENERATE_WINDOW_MS, 15 * 60 * 1000),
        max: toPositiveInt(
            process.env.RATE_LIMIT_OTP_GENERATE_MAX,
            isProduction ? 5 : 50
        ),
    },
    otpVerify: {
        windowMs: toPositiveInt(process.env.RATE_LIMIT_OTP_VERIFY_WINDOW_MS, 15 * 60 * 1000),
        max: toPositiveInt(
            process.env.RATE_LIMIT_OTP_VERIFY_MAX,
            isProduction ? 15 : 100
        ),
    },
    authGeneral: {
        windowMs: toPositiveInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60 * 1000),
        max: toPositiveInt(
            process.env.RATE_LIMIT_AUTH_MAX,
            isProduction ? 30 : 200
        ),
    },
};
