const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
    logger.error(`${err.name || 'Error'}: ${err.message}`, {
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        stack: err.stack,
    });

    let statusCode = (err.statusCode && Number.isInteger(err.statusCode) && err.statusCode >= 400 && err.statusCode < 600)
        ? err.statusCode
        : (err.status && Number.isInteger(err.status) && err.status >= 400 && err.status < 600)
            ? err.status
            : (res.statusCode >= 400 && res.statusCode < 600 ? res.statusCode : 500);

    if (err.message === 'Not allowed by CORS' && statusCode === 500) {
        statusCode = 403;
    }

    const is4xx = statusCode >= 400 && statusCode < 500;
    const isProduction = process.env.NODE_ENV === 'production';

    // Keep the real status code and message for 4xx errors; only mask 5xx errors
    const message = is4xx
        ? (err.message || 'Client Error')
        : (isProduction ? 'Internal Server Error' : (err.message || 'Internal Server Error'));

    res.status(statusCode).json({
        success: false,
        message,
        error: {
            message,
            stack: isProduction ? null : err.stack,
            type: err.name || (is4xx ? 'ClientError' : 'ServerError')
        }
    });
};

module.exports = errorHandler;
