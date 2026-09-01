const { normalizeError } = require("../utils/AppError");

function notFoundHandler(req, res) {
    return res.status(404).json({
        success: false,
        message: "The requested resource was not found.",
        code: "NOT_FOUND",
    });
}

function errorHandler(error, req, res, next) {
    if (res.headersSent) {
        return next(error);
    }

    const normalized = normalizeError(error);
    const isProduction = process.env.NODE_ENV === "production";
    const status = normalized.status || 500;

    if (!isProduction) {
        console.error("[error]", {
            method: req.method,
            path: req.originalUrl,
            status,
            message: normalized.message,
            code: normalized.code,
        });
    } else if (status >= 500) {
        console.error("[error]", {
            method: req.method,
            path: req.originalUrl,
            status,
            code: normalized.code,
        });
    }

    const message =
        status >= 500 && isProduction
            ? "Internal Server Error"
            : normalized.message || "Internal Server Error";

    const payload = {
        success: false,
        message,
    };

    if (normalized.code) {
        payload.code = normalized.code;
    }

    if (error.errors) {
        payload.errors = error.errors;
    }

    return res.status(status).json(payload);
}

module.exports = {
    notFoundHandler,
    errorHandler,
};
