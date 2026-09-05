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

const messageRoutes = require("./routes/messages");
const aiRoutes = require("./routes/ai");
const payrollRoutes = require("./routes/payroll");
const emailRoutes = require("./routes/email");
const automationRoutes = require("./routes/automation");
const taskRoutes = require("./routes/tasks");

const automationEngine = require("./services/automation-engine");


const app = express();
const PORT = process.env.PORT || 3000;

// 1. CORS Configuration MUST be first to handle OPTIONS preflight
app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:5501', 'http://127.0.0.1:5501', 'http://localhost:3000'],
    methods: 'GET,POST,PUT,DELETE',
    credentials: true
}));

// Security Middlewares
// 2. Set Security HTTP Headers with Dev-Friendly CSP
app.use(helmet({
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    contentSecurityPolicy: {
        directives: {
            "default-src":      ["'self'"],
            "script-src":       ["'self'", "'unsafe-inline'", "https://www.gstatic.com", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://cdnjs.cloudflare.com", "https://apis.google.com"],
            "script-src-attr":  ["'unsafe-inline'"],   // ← allows onclick/onchange attributes (was defaulting to 'none')
            "style-src":        ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            "img-src":          ["'self'", "data:", "https:"],
            "connect-src":      ["'self'", "https://*.gstatic.com", "https://*.googleapis.com", "https://identitytoolkit.googleapis.com", "https://securetoken.googleapis.com", "https://firestore.googleapis.com", "wss://*.firebaseio.com", "https://*.firebaseapp.com", "http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:5501", "http://127.0.0.1:5501", "http://127.0.0.1:5500", "http://localhost:5500", "https://unpkg.com", "https://cdn.jsdelivr.net"],
            "font-src":         ["'self'", "https://fonts.gstatic.com", "data:"],
            "frame-src":        ["'self'", "https://kylrxai.firebaseapp.com", "https://*.firebaseapp.com", "https://accounts.google.com", "https://apis.google.com"],
            "object-src":       ["'none'"],
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

// Serve static files from workspace root
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use(express.static(__dirname));

// Route Wiring
app.use("/api/auth", authRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/admin", adminRoutes);

app.use("/api/messages", messageRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/payroll-runs", payrollRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/automations", automationRoutes);
app.use("/api/tasks", taskRoutes);

// Reconciliation Engine API (ESM module — loaded via dynamic import)
// Endpoints: POST /api/reconciliation/ingest
//            GET  /api/reconciliation/exceptions/:batchId
//            GET  /api/reconciliation/exceptions/:batchId/summary
//            GET  /api/reconciliation/finance-ops/review-items
//            GET  /api/reconciliation/finance-ops/review-items/:batchId
//            PATCH /api/reconciliation/exceptions/:exceptionId/resolve
//            GET  /api/reconciliation/runs/:runId
//            GET  /api/reconciliation/batches/:batchId/status
import('./routes/reconciliation.mjs')
  .then(({ default: reconciliationRoutes }) => {
    app.use('/api/reconciliation', reconciliationRoutes);
    logger.info('[ReconciliationEngine] Routes registered at /api/reconciliation');
  })
  .catch((err) => {
    logger.error('[ReconciliationEngine] Failed to load reconciliation routes:', err.message);
  });

// ESIC Automation Engine API (Column 1 Compliance Blueprint)
// Endpoints: POST /api/v1/esic/upload-master
//            GET  /api/v1/esic/template
//            GET  /api/v1/esic/profiles
//            POST /api/v1/esic/trigger
//            GET  /api/v1/esic/summary/:batchId
//            GET  /api/v1/esic/stepper/:batchId
//            POST /api/v1/esic/stepper/:batchId/advance
//            GET  /api/v1/esic/exceptions
//            POST /api/v1/esic/exceptions/:exceptionId/resolve
//            GET  /api/v1/esic/tasks
//            GET  /api/v1/esic/export/:batchId
async function startServer() {
  try {
    const { default: esicRoutes } = await import('./routes/esic.mjs');
    app.use('/api/v1/esic', esicRoutes);
    app.use('/api/esic', esicRoutes);
    logger.info('[EsicAutomationEngine] Routes registered at /api/v1/esic and /api/esic');

    try {
      const eventBus = require('./services/event-bus');
      const { globalEsicAutomationEngine } = await import('./services/esic-automation-engine.mjs');
      globalEsicAutomationEngine.attachPayrollFinalizedListener(eventBus);
      logger.info('[EsicAutomationEngine] Attached PAYROLL_FINALIZED listener on EventBus');
    } catch (e) {
      logger.warn('[EsicAutomationEngine] Could not wire EventBus listener:', e.message);
    }
  } catch (err) {
    logger.error('[EsicAutomationEngine] Failed to load ESIC routes:', err.message);
  }

  try {
    const { default: gratuityRoutes } = await import('./routes/gratuity.mjs');
    app.use('/api/v1/gratuity', gratuityRoutes);
    app.use('/api/gratuity', gratuityRoutes);
    logger.info('[GratuityAutomationEngine] Routes registered at /api/v1/gratuity and /api/gratuity');

    try {
      const eventBus = require('./services/event-bus');
      const { globalGratuityAutomationEngine } = await import('./services/gratuity-automation-engine.mjs');
      globalGratuityAutomationEngine.attachEventListeners(eventBus);
      logger.info('[GratuityAutomationEngine] Attached Exit & PAYROLL_FINALIZED listeners on EventBus');
    } catch (e) {
      logger.warn('[GratuityAutomationEngine] Could not wire EventBus listeners:', e.message);
    }
  } catch (err) {
    logger.error('[GratuityAutomationEngine] Failed to load Gratuity routes:', err.message);
  }

  try {
    const { default: npsRoutes } = await import('./routes/nps.mjs');
    app.use('/api/v1/nps', npsRoutes);
    app.use('/api/nps', npsRoutes);
    logger.info('[CorporateNpsAutomationEngine] Routes registered at /api/v1/nps and /api/nps');

    try {
      const eventBus = require('./services/event-bus');
      const { globalCorporateNpsAutomationEngine } = await import('./services/corporate-nps-automation-engine.mjs');
      globalCorporateNpsAutomationEngine.attachPayrollFinalizedListener(eventBus);
      logger.info('[CorporateNpsAutomationEngine] Attached PAYROLL_FINALIZED listener on EventBus');
    } catch (e) {
      logger.warn('[CorporateNpsAutomationEngine] Could not wire EventBus listener:', e.message);
    }
  } catch (err) {
    logger.error('[CorporateNpsAutomationEngine] Failed to load NPS routes:', err.message);
  }

  try {
    const { default: unifiedComplianceRoutes } = await import('./routes/unified-compliance.mjs');
    app.use('/api/v1/compliance', unifiedComplianceRoutes);
    app.use('/api/compliance', unifiedComplianceRoutes);
    logger.info('[UnifiedStatutoryOrchestrator] Routes registered at /api/v1/compliance and /api/compliance');

    try {
      const { db } = require('./config/firebase');
      const eventBus = require('./services/event-bus');
      const { globalUnifiedStatutoryOrchestrator } = await import('./services/unified-statutory-orchestration-service.mjs');
      globalUnifiedStatutoryOrchestrator.attachPayrollRunsListener(db);
      globalUnifiedStatutoryOrchestrator.attachEventBusListener(eventBus);
      logger.info('[UnifiedStatutoryOrchestrator] Master trigger attached to Firebase payroll_runs & EventBus');
    } catch (e) {
      logger.warn('[UnifiedStatutoryOrchestrator] Could not attach master trigger:', e.message);
    }
  } catch (err) {
    logger.error('[UnifiedStatutoryOrchestrator] Failed to load Compliance routes:', err.message);
  }

  try {
    const { default: pfComplianceRoutes } = await import('./routes/pf-compliance.mjs');
    app.use('/api/v1/pf', pfComplianceRoutes);
    app.use('/api/pf', pfComplianceRoutes);
    logger.info('[PfEcrAutomationEngine] Routes registered at /api/v1/pf and /api/pf');

    try {
      const eventBus = require('./services/event-bus');
      const { globalPfEcrAutomationEngine } = await import('./services/pf-ecr-automation-engine.mjs');
      globalPfEcrAutomationEngine.attachEventBusListener(eventBus);
      logger.info('[PfEcrAutomationEngine] EventBus listener wired to PAYROLL_FINALIZED');
    } catch (e) {
      logger.warn('[PfEcrAutomationEngine] Could not wire EventBus listener:', e.message);
    }
  } catch (err) {
    logger.error('[PfEcrAutomationEngine] Failed to load PF routes:', err.message);
  }

  // Unhandled Route Fallback (ONLY registered AFTER all routes are registered!)
  app.use((req, res, next) => {
    res.status(404);
    next(new Error(`Can't find ${req.originalUrl} on this server!`));
  });

  // Global Error Handler
  app.use(errorHandler);

  // Start Server
  app.listen(PORT, () => {
    logger.info(`🚀 Secure HRFlow Enterprise Backend running on http://localhost:${PORT}`);
    console.log(`🚀 Secure HRFlow Enterprise Backend running on http://localhost:${PORT}`);
    
    // Initialize the centralized automation engine
    automationEngine.start();
    
    // Onboarding Document submission Reminder scheduler (Twice daily: every 12 hours)
    const { runReminderJob } = require("./utils/reminder-scheduler");
    setInterval(() => {
      runReminderJob().catch(err => console.error("Error in scheduled reminder job:", err));
    }, 12 * 60 * 60 * 1000);
  });
}

// Handle Uncaught Exceptions and Unhandled Rejections globally to guarantee ZERO-CRASH
process.on('uncaughtException', (err) => {
    logger.error(`UNCAUGHT EXCEPTION: ${err.name} - ${err.message}`, { stack: err.stack });
});

process.on('unhandledRejection', (err) => {
    logger.error(`UNHANDLED REJECTION: ${err.name} - ${err.message}`, { stack: err.stack });
});

startServer();


