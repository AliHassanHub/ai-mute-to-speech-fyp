class AppError extends Error {
    constructor(message, status = 500, code = null) {
        super(message);
        this.name = "AppError";
        this.status = status;
        this.code = code;
    }
}

function normalizeError(error) {
    if (error instanceof AppError) {
        return error;
    }

    if (error && typeof error === "object" && error.status && error.message) {
        return new AppError(error.message, error.status, error.code || null);
    }

    if (error && error.name === "ValidationError") {
        return new AppError(error.message, 400, "VALIDATION_ERROR");
    }

    if (error && error.name === "JsonWebTokenError") {
        return new AppError("Invalid or expired token.", 401, "INVALID_TOKEN");
    }

    if (error && error.name === "TokenExpiredError") {
        return new AppError("Invalid or expired token.", 401, "TOKEN_EXPIRED");
    }

    return new AppError(
        "Internal Server Error",
        500,
        "INTERNAL_ERROR"
    );
}

module.exports = {
    AppError,
    normalizeError,
};
