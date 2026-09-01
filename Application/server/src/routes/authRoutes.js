const express = require("express");

const router = express.Router();

const authController = require("../controllers/authController");

const { signupValidation, resetPasswordValidation, loginValidation, forgotPasswordValidation,
    verifyEmailValidation, verifyResetOTPValidation } = require("../validators/authValidator");

const validateRequest = require("../middlewares/validationMiddleware");

const { authenticate } = require("../middlewares/authMiddleware");
const {
    loginLimiter,
    otpGenerateLimiter,
    otpVerifyLimiter,
    authGeneralLimiter,
} = require("../middlewares/rateLimitMiddleware");

router.get(

    "/me",

    authenticate,

    (req, res) => {

        res.json({

            success: true,

            message: "Protected route accessed successfully.",

            user: req.user

        });

    }

);


router.post(

    "/verify-email",

    otpVerifyLimiter,

    verifyEmailValidation,

    validateRequest,

    authController.verifyEmail

);

router.post(
    "/signup",
    otpGenerateLimiter,
    signupValidation,
    validateRequest,
    authController.signup
);

router.post(

    "/login",

    loginLimiter,

    loginValidation,

    validateRequest,

    authController.login

);


router.post(

    "/forgot-password",

    otpGenerateLimiter,

    forgotPasswordValidation,

    validateRequest,

    authController.forgotPassword

);

router.post(

    "/verify-reset-otp",

    otpVerifyLimiter,

    verifyResetOTPValidation,

    validateRequest,

    authController.verifyResetOTP

);

router.put(

    "/reset-password",

    authGeneralLimiter,

    resetPasswordValidation,

    validateRequest,

    authController.resetUserPassword

);
module.exports = router;