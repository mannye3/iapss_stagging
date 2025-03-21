class ErrorResponse extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
    }
}

export default ErrorResponse;  // ✅ Correct export

export const errorHandler = (err, req, res, next) => {
    console.error("Error:", err);

    const statusCode = err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(statusCode).json({
        success: false,
        error: message,
        stack: process.env.NODE_ENV === "production" ? undefined : err.stack, // Hide stack trace in production
    });
};
