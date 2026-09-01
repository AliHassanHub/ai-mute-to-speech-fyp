const profileService = require("../services/profileService");

const getProfile = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const result = await profileService.getProfile(userId);

        return res.status(200).json({

            success: true,

            ...result

        });

    }

    catch (error) {

        console.error(error);

        return res.status(error.status || 500).json({

            success: false,

            message: error.message || "Internal Server Error"

        });

    }

};

const updateProfile = async (

    req,

    res

) => {

    try {

        const userId = req.user.user_id;

        const {

            name

        } = req.body;

        const result = await profileService.updateProfile(

            userId,

            name

        );

        return res.status(200).json(result);

    }

    catch (error) {

        console.error(error);

        return res.status(

            error.status || 500

        ).json({

            success: false,

            message:

                error.message ||

                "Internal Server Error"

        });

    }

};

const uploadProfileImage = async (req, res) => {
    try {
        const userId = req.user.user_id;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Please upload an image."
            });
        }

        const imagePath = `profile-images/${req.file.filename}`;

        const result = await profileService.updateProfileImage(
            userId,
            imagePath
        );

        return res.status(200).json(result);

    } catch (error) {
        console.error(error);

        return res.status(error.status || 500).json({
            success: false,
            message: error.message || "Internal Server Error"
        });
    }
};

const changePassword = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const {

            currentPassword,

            newPassword

        } = req.body;

        const result = await profileService.changePassword(

            userId,

            currentPassword,

            newPassword

        );

        return res.status(200).json(result);

    }

    catch (error) {

        console.error(error);

        return res.status(

            error.status || 500

        ).json({

            success: false,

            message:

                error.message ||

                "Internal Server Error"

        });

    }

};

const updateNotificationPreference = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const {

            notificationsEnabled,

            preferences

        } = req.body;

        const result = preferences
            ? await profileService.updateNotificationSettings(userId, {
                  notificationsEnabled,
                  preferences,
              })
            : await profileService.updateNotificationPreference(
                  userId,
                  notificationsEnabled
              );

        return res.status(200).json(result);

    }

    catch (error) {

        console.error(error);

        return res.status(

            error.status || 500

        ).json({

            success: false,

            message:

                error.message ||

                "Internal Server Error"

        });

    }

};

const getNotificationSettings = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const result = await profileService.getNotificationSettings(userId);
        return res.status(200).json(result);
    } catch (error) {
        console.error(error);
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || "Internal Server Error",
        });
    }
};

const updateLanguagePreference = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const { translationLanguage, speechLanguage, targetLanguage } = req.body;

        const result = await profileService.updateLanguagePreference(
            userId,
            {
                translationLanguage,
                speechLanguage,
                targetLanguage,
            }
        );

        return res.status(200).json(result);

    }

    catch (error) {

        console.error(error);

        return res.status(

            error.status || 500

        ).json({

            success: false,

            message:

                error.message ||

                "Internal Server Error"

        });

    }

};

const getLanguageSettings = async (req, res) => {
    try {
        const userId = req.user.user_id;
        const result = await profileService.getLanguageSettings(userId);
        return res.status(200).json(result);
    } catch (error) {
        console.error(error);
        return res.status(error.status || 500).json({
            success: false,
            message: error.message || "Internal Server Error",
        });
    }
};

const deleteUserAccount = async (req, res) => {

    try {

        const userId = req.user.user_id;

        const result = await profileService.deleteUserAccount(

            userId

        );

        return res.status(200).json(result);

    }

    catch (error) {

        console.error(error);

        return res.status(

            error.status || 500

        ).json({

            success: false,

            message:

                error.message ||

                "Internal Server Error"

        });

    }

};

const logout = async (req, res) => {

    try {

        const result = await profileService.logout();

        return res.status(200).json(result);

    }

    catch (error) {

        console.error(error);

        return res.status(

            error.status || 500

        ).json({

            success: false,

            message:

                error.message ||

                "Internal Server Error"

        });

    }

};

module.exports = {

    getProfile,

    updateProfile,

    uploadProfileImage,

    changePassword,

    updateNotificationPreference,

    getNotificationSettings,

    updateLanguagePreference,

    getLanguageSettings,

    deleteUserAccount,

    logout

};