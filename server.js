const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const xss = require("xss-clean");
const hpp = require("hpp");
const morgan = require("morgan");
require('dotenv').config();

// Utils & Middleware
const logger = require("./utils/logger");
const errorHandler = require("./middleware/errorHandler");

// Route Imports
const authRoutes = require("./routes/auth");
const dataRoutes = require("./routes/data");
const notificationRoutes = require("./routes/notifications");
const adminRoutes = require("./routes/admin");
const employeeRoutes = require("./routes/employeeRoutes");
const messageRoutes = require("./routes/messages");
const aiRoutes = require("./routes/ai");

const app = express();
const PORT = process.env.PORT || 3000;

// 1. CORS Configuration MUST be first to handle OPTIONS preflight
app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:3000'],
    methods: 'GET,POST,PUT,DELETE',
    credentials: true
}));

// Security Middlewares
// 2. Set Security HTTP Headers with Dev-Friendly CSP
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'", "'unsafe-inline'", "https://www.gstatic.com", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://cdnjs.cloudflare.com", "https://apis.google.com"],
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            "img-src": ["'self'", "data:", "https:"],
            "connect-src": ["'self'", "https://www.gstatic.com", "https://identitytoolkit.googleapis.com", "https://firestore.googleapis.com", "http://localhost:3000", "http://127.0.0.1:3000", "http://127.0.0.1:5500", "https://unpkg.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
            "object-src": ["'none'"],
            "upgrade-insecure-requests": [],
        },
    },
}));

// 3. Rate Limiting (100 requests per 15 mins)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 100,
    message: { success: false, error: "Too many requests from this IP, please try again in 15 minutes." }
});
app.use('/api', limiter);

// 4. Body Parser
app.use(express.json({ limit: '10kb' })); // Body limit is 10kb
app.use(bodyParser.urlencoded({ extended: true }));

// 5. Prevent Parameter Pollution
app.use(hpp());

// Request Logging
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));

// Professional Root Status
app.get("/", (req, res) => {
    res.json({
        status: "success",
        service: "HRFlow Backend API",
        version: "3.0.0 (Enterprise)",
        message: "All services are securely operational",
        timestamp: new Date().toISOString()
    });
});

// Route Wiring
app.use("/api/auth", authRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/ai", aiRoutes);

// Unhandled Route Fallback
app.use((req, res, next) => {
    res.status(404);
    next(new Error(`Can't find ${req.originalUrl} on this server!`));
});

// Global Error Handler
app.use(errorHandler);

// Handle Uncaught Exceptions and Unhandled Rejections globally to guarantee ZERO-CRASH
process.on('uncaughtException', (err) => {
    logger.error(`UNCAUGHT EXCEPTION: ${err.name} - ${err.message}`, { stack: err.stack });
    // In production we should restart, but here we keep it alive for zero-crash
});

process.on('unhandledRejection', (err) => {
    logger.error(`UNHANDLED REJECTION: ${err.name} - ${err.message}`, { stack: err.stack });
});

// Start Server
app.listen(PORT, () => {
    logger.info(`🚀 Secure HRFlow Enterprise Backend running on http://localhost:${PORT}`);
    console.log(`🚀 Secure HRFlow Enterprise Backend running on http://localhost:${PORT}`);
});

