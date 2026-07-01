const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
    logger.error(`${err.name || 'Error'}: ${err.message}`, {
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        stack: err.stack,
    });

    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    res.status(statusCode).json({
        success: false,
        error: {
            message: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message,
            stack: process.env.NODE_ENV === 'production' ? null : err.stack,
            type: err.name || 'ServerError'
        }
    });
};

module.exports = errorHandler;
