const jwtService = require("../services/jwtService");
const authModel = require("../models/authModel");

const authenticate = async (req, res, next) => {

    try {

        const authHeader = req.headers.authorization;

        if (!authHeader) {

            return res.status(401).json({

                success: false,

                message: "Access token is required."

            });

        }

        if (!authHeader.startsWith("Bearer ")) {

            return res.status(401).json({

                success: false,

                message: "Invalid authorization format."

            });

        }

        const token = authHeader.split(" ")[1];

        const decoded = jwtService.verifyToken(token);

        const user = await authModel.findUserById(decoded.userId);

        if (!user) {

            return res.status(401).json({

                success: false,

                message: "User no longer exists."

            });

        }

        if (!user.is_active) {

            return res.status(403).json({

                success: false,

                message: "Your account has been deactivated."

            });

        }

        req.user = user;

        next();

    }

    catch (error) {

        return res.status(401).json({

            success: false,

            message: "Invalid or expired token."

        });

    }

};

module.exports = {

    authenticate

};