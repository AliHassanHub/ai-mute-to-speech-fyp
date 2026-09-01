const multer = require("multer");

const uploadErrorHandler = (

    error,

    req,

    res,

    next

) => {

    if (error instanceof multer.MulterError) {

        if (error.code === "LIMIT_FILE_SIZE") {

            return res.status(400).json({

                success: false,

                message: "Image size must not exceed 5 MB.",

                code: "FILE_TOO_LARGE"

            });

        }

        return res.status(400).json({

            success: false,

            message: error.message,

            code: "UPLOAD_ERROR"

        });

    }

    if (error) {

        return res.status(

            error.status || 400

        ).json({

            success: false,

            message: error.message,

            code: "UPLOAD_ERROR"

        });

    }

    next();

};

module.exports = uploadErrorHandler;