const { body } = require("express-validator");

const signupValidation = [

    body("name")
        .trim()
        .notEmpty()
        .withMessage("Name is required.")
        .isLength({ min: 3, max: 100 })
        .withMessage("Name must be between 3 and 100 characters."),

    body("email")
        .trim()
        .notEmpty()
        .withMessage("Email is required.")
        .isEmail()
        .withMessage("Please enter a valid email address.")
        .normalizeEmail(),

    body("password")
        .notEmpty()
        .withMessage("Password is required.")
        .isLength({ min: 8 })
        .withMessage("Password must be at least 8 characters.")
        .matches(/[A-Z]/)
        .withMessage("Password must contain at least one uppercase letter.")
        .matches(/[a-z]/)
        .withMessage("Password must contain at least one lowercase letter.")
        .matches(/[0-9]/)
        .withMessage("Password must contain at least one number.")
        .matches(/[!@#$%^&*(),.?":{}|<>]/)
        .withMessage("Password must contain at least one special character."),

    body("confirmPassword")
        .custom((value, { req }) => {

            if (value !== req.body.password) {

                throw new Error("Passwords do not match.");

            }

            return true;

        })

];

const loginValidation = [

    body("email")
        .trim()
        .notEmpty()
        .withMessage("Email is required.")
        .isEmail()
        .withMessage("Please enter a valid email address.")
        .normalizeEmail(),

    body("password")
        .notEmpty()
        .withMessage("Password is required.")

];

const forgotPasswordValidation = [

    body("email")
        .trim()
        .notEmpty()
        .withMessage("Email is required.")
        .isEmail()
        .withMessage("Please enter a valid email address.")
        .normalizeEmail()

];

const verifyEmailValidation = [

    body("email")
        .trim()
        .notEmpty()
        .withMessage("Email is required.")
        .isEmail()
        .withMessage("Please enter a valid email address.")
        .normalizeEmail(),

    body("otp")
        .trim()
        .notEmpty()
        .withMessage("OTP is required.")
        .isLength({ min: 6, max: 6 })
        .withMessage("OTP must be 6 digits.")

];

const verifyResetOTPValidation = [

    body("email")
        .trim()
        .notEmpty()
        .withMessage("Email is required.")
        .isEmail()
        .withMessage("Please enter a valid email address."),

    body("otp")
        .trim()
        .notEmpty()
        .withMessage("OTP is required.")
        .isLength({ min: 6, max: 6 })
        .withMessage("OTP must be 6 digits.")

];

const resetPasswordValidation = [

    body("email")
        .trim()
        .notEmpty()
        .withMessage("Email is required.")
        .isEmail()
        .withMessage("Please enter a valid email address."),

    body("newPassword")
        .notEmpty()
        .withMessage("New password is required.")
        .isLength({ min: 8 })
        .withMessage("Password must be at least 8 characters.")
        .matches(/[A-Z]/)
        .withMessage("Password must contain at least one uppercase letter.")
        .matches(/[a-z]/)
        .withMessage("Password must contain at least one lowercase letter.")
        .matches(/[0-9]/)
        .withMessage("Password must contain at least one number.")
        .matches(/[!@#$%^&*(),.?":{}|<>]/)
        .withMessage("Password must contain at least one special character."),

    body("confirmPassword")
        .custom((value, { req }) => {

            if (value !== req.body.newPassword) {

                throw new Error("Passwords do not match.");

            }

            return true;

        })

];



module.exports = {

    signupValidation,

    loginValidation,

    forgotPasswordValidation,

    verifyEmailValidation,

    verifyResetOTPValidation,

    resetPasswordValidation

};