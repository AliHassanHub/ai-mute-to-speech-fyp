const pool = require("../config/db");
const authModel = require("../models/authModel");


const verifyOTP = async (email, otp) => {

    const verificationRecord =
    await authModel.getVerificationRecord(email);

if (!verificationRecord) {

    throw {

        status:404,

        message:"Verification request not found."

    };

}

if (verificationRecord.otp_code !== otp) {

    throw {

        status:400,

        message:"Invalid OTP."

    };

}

const now = new Date();

const expiry = new Date(
    verificationRecord.expires_at
);

if (now > expiry) {

    throw {

        status:400,

        message:"OTP has expired."

    };

}

const connection =
    await pool.getConnection();

try {

    await connection.beginTransaction();
    const userId =
await authModel.createUser(

    connection,

    verificationRecord.name,

    verificationRecord.user_email,

    verificationRecord.password_hash

);

await authModel.deleteVerificationRecord(

    connection,

    verificationRecord.user_email

);

await connection.commit();

const user =
await authModel.findUserById(userId);

return{

    success:true,

    message:"Account created successfully.",

    user

};


}
catch(error){

    connection.release();

    throw error;

}

finally{

    connection.release();

}

};

module.exports = {

    verifyOTP

};
