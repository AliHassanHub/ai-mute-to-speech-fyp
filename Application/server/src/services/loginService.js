const bcrypt = require("bcrypt");

const authModel = require("../models/authModel");

const jwtService = require("./jwtService");


const login = async (email, password) => {

    const user = await authModel.findUserByEmail(email);

if (!user) {

    throw {

        status: 401,

        message: "Invalid email or password."

    };

}

if (!user.is_active) {

    throw {

        status: 403,

        message: "Your account has been deactivated."

    };

}

const passwordMatched = await bcrypt.compare(

    password,

    user.password_hash

);

if (!passwordMatched) {

    throw {

        status:401,

        message:"Invalid email or password."

    };

}

await authModel.updateLastLogin(

    user.user_id

);

const token = jwtService.generateToken(user);

delete user.password_hash;

return {

    success: true,

    message: "Login successful.",

    token,

    user

};

};

module.exports = {

    login

};