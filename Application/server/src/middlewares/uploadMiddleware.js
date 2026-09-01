const multer = require("multer");

const path = require("path");

const storage = multer.diskStorage({

    destination: (req, file, cb) => {

        cb(

            null,

            "uploads/profile-images"

        );

    },

    filename: (req, file, cb) => {

        const uniqueFileName =

            `user-${req.user.user_id}-${Date.now()}${path.extname(file.originalname)}`;

        cb(

            null,

            uniqueFileName

        );

    }

});

const fileFilter = (req, file, cb) => {

    const allowedTypes = [

        "image/jpeg",

        "image/jpg",

        "image/png",

        "image/webp"

    ];

    if (allowedTypes.includes(file.mimetype)) {

        return cb(null, true);

    }

    const error = new Error(

        "Only JPG, JPEG, PNG and WEBP images are allowed."

    );

    error.status = 400;

    cb(error);

};

const uploadProfileImage = multer({

    storage,

    fileFilter,

    limits: {

        fileSize: 5 * 1024 * 1024

    }

});

module.exports = {

    uploadProfileImage

};