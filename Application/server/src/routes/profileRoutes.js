const express = require("express");

const router = express.Router();

const profileController = require("../controllers/profileController");

const { authenticate } = require("../middlewares/authMiddleware");

const {

    updateProfileValidation,

    changePasswordValidation,

    notificationPreferenceValidation,

    languagePreferenceValidation

} = require("../validators/profileValidator");

const validateRequest = require("../middlewares/validationMiddleware");

const {

    uploadProfileImage

} = require("../middlewares/uploadMiddleware");

router.get(

    "/",

    authenticate,

    profileController.getProfile

);

router.put(

    "/",

    authenticate,

    updateProfileValidation,

    validateRequest,

    profileController.updateProfile

);

router.post(

    "/image",

    authenticate,

    uploadProfileImage.single("profileImage"),

    profileController.uploadProfileImage

);

router.put(

    "/change-password",

    authenticate,

    changePasswordValidation,

    validateRequest,

    profileController.changePassword

);

router.put(

    "/notifications",

    authenticate,

    notificationPreferenceValidation,

    validateRequest,

    profileController.updateNotificationPreference

);

router.get(

    "/notifications",

    authenticate,

    profileController.getNotificationSettings

);

router.get(

    "/language",

    authenticate,

    profileController.getLanguageSettings

);

router.put(

    "/language",

    authenticate,

    languagePreferenceValidation,

    validateRequest,

    profileController.updateLanguagePreference

);

router.delete(

    "/",

    authenticate,

    profileController.deleteUserAccount

);

router.post(

    "/logout",

    authenticate,

    profileController.logout

);

module.exports = router;