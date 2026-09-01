const rateLimit = require("express-rate-limit");
const rateLimitConfig = require("../config/rateLimit");

function createLimiter({ windowMs, max, code, message }) {
    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        handler(req, res) {
            return res.status(429).json({
                success: false,
                message,
                code,
            });
        },
    });
}

const loginLimiter = createLimiter({
    ...rateLimitConfig.login,
    code: "RATE_LIMIT_LOGIN",
    message: "Too many login attempts. Please try again later.",
});

const otpGenerateLimiter = createLimiter({
    ...rateLimitConfig.otpGenerate,
    code: "RATE_LIMIT_OTP",
    message: "Too many OTP requests. Please try again later.",
});

const otpVerifyLimiter = createLimiter({
    ...rateLimitConfig.otpVerify,
    code: "RATE_LIMIT_OTP_VERIFY",
    message: "Too many OTP verification attempts. Please try again later.",
});

const authGeneralLimiter = createLimiter({
    ...rateLimitConfig.authGeneral,
    code: "RATE_LIMIT_AUTH",
    message: "Too many requests. Please try again later.",
});

module.exports = {
    loginLimiter,
    otpGenerateLimiter,
    otpVerifyLimiter,
    authGeneralLimiter,
};
