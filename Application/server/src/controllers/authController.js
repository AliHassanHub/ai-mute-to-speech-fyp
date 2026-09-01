const authModel = require("../models/authModel");

const {

    sendSignupOTP,

    sendForgotPasswordOTP,

    verifyPasswordResetOTP,

    resetPassword

} = require("../services/otpService");

const verificationService = require("../services/verificationService");

const loginService = require("../services/loginService");


const signup = async (req, res) => {

    try {

        const {

            name,

            email,

            password

        } = req.body;

        const existingUser = await authModel.findUserByEmail(email);

        if (existingUser) {

            return res.status(409).json({

                success: false,

                message: "Email is already registered."

            });

        }



        const result = await sendSignupOTP(

            name,

            email,

            password

        );

        return res.status(200).json({

            success: true,

            message: result.message,

            email

        });

    }

    catch (error) {

        console.error(error);

        return res.status(500).json({

            success: false,

            message: "Internal Server Error"

        });

    }

};


const verifyEmail = async (req, res) => {

    try {

        const { email, otp } = req.body;

        const result =
        await verificationService.verifyOTP(
            email,
            otp
        );

        return res.status(201).json(result);

    }

    catch(error){

        console.error(error);

        return res.status(error.status || 500).json({

            success:false,

            message:error.message || "Internal Server Error"

        });

    }

};

const login = async (req, res) => {

    try {

        const {

            email,

            password

        } = req.body;

        const result = await loginService.login(

            email,

            password

        );

        return res.status(200).json(result);

    }

    catch (error) {

        console.error(error);

        return res.status(error.status || 500).json({

            success: false,

            message: error.message || "Internal Server Error"

        });

    }

};

const forgotPassword = async (req, res) => {

    try {

        const { email } = req.body;

        const result = await sendForgotPasswordOTP(email);

        return res.status(200).json({
            success: true,
            message: result.message
        });

    }catch (error) {

    console.error(error);

    return res.status(

        error.status || 500

    ).json({

        success: false,

        message: error.message || "Internal Server Error"

    });

}

};

const verifyResetOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;

        const result = await verifyPasswordResetOTP(email, otp);

        return res.status(200).json({
            success: true,
            message: result.message
        });

    } catch (error) {
        console.error(error);

        return res.status(error.status || 500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
};

const resetUserPassword = async (req, res) => {
    try {
        const {
            email,
            newPassword,
            confirmPassword
        } = req.body;

        if (newPassword !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: "Passwords do not match."
            });
        }

        const result = await resetPassword(
            email,
            newPassword
        );

        return res.status(200).json({
            success: true,
            message: result.message
        });

    } catch (error) {
        console.error(error);

        return res.status(error.status || 500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
};

module.exports = {

    signup,

    verifyEmail,

    login,

    forgotPassword,

    verifyResetOTP,

    resetUserPassword

};
