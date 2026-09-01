const transporter = require("../config/mail");

const sendOTPEmail = async (email, otp, purpose = "Verification") => {
    const mailOptions = {
        from: `"AI Mute-to-Speech" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: `${purpose} Code`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width:600px; margin:auto;">
                <h2 style="color:#4F46E5;">AI Mute-to-Speech</h2>

                <p>Hello,</p>

                <p>Your verification code is:</p>

                <h1 style="
                    background:#4F46E5;
                    color:white;
                    padding:15px;
                    border-radius:10px;
                    display:inline-block;
                    letter-spacing:6px;
                ">
                    ${otp}
                </h1>

                <p>This code will expire in ${process.env.OTP_EXPIRE_MINUTES} minutes.</p>

                <p>If you did not request this, please ignore this email.</p>

                <hr>

                <small>
                    AI Mute-to-Speech System<br>
                    Final Year Project
                </small>

            </div>
        `
    };

    return transporter.sendMail(mailOptions);
};

module.exports = {
    sendOTPEmail
};