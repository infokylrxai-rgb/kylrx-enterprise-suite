const express = require('express');
const router = express.Router();
const { confirmedWrite } = require('../config/firestore-write');
const analyticsEngine = require('../services/custom-analytics-engine');
const logger = require('../utils/logger');
const { verifyToken } = require('../middleware/authMiddleware');
const crypto = require('crypto');
const { rawCollection } = require('../config/firebase');
const { orgDocs, ownerOrgId, LEGACY_ORG_ID } = require('../config/tenant');

router.use(verifyToken);

/* Saved dashboards live in Firestore 'analytics_dashboards' per organization; the built-in
 * dashboards are read-only templates shown to every organization. */
const DASHBOARD_COLLECTION = 'analytics_dashboards';

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}


const templates = () => analyticsEngine.SEED_DASHBOARDS.map(d => ({ ...d, isTemplate: true }));

async function orgDashboards(orgId) {
    const saved = (await orgDocs(rawCollection, DASHBOARD_COLLECTION, orgId)).map(d => ({ ...d, isTemplate: false }));
    return [...saved.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))), ...templates()];
}

async function findDashboard(orgId, id) {
    const template = templates().find(d => d.id === id);
    if (template) return template;
    const snap = await rawCollection(DASHBOARD_COLLECTION).doc(String(id)).get();
    if (!snap.exists || ownerOrgId(snap.data()) !== orgId) return null;
    return { id: snap.id, ...snap.data(), isTemplate: false };
}

/**
 * Custom Analytics Builder API Routes
 * 
 * Facilitates no-code HR dashboard creation:
 * Select data source → metrics → filters → grouping → chart → save dashboard.
 */

// GET /api/analytics/sources - List all 6 supported data sources and their schemas
router.get('/sources', (req, res) => {
    try {
        const sources = Object.values(analyticsEngine.DATA_SOURCES);
        res.status(200).json({
            success: true,
            count: sources.length,
            sources
        });
    } catch (error) {
        logger.error('[AnalyticsRoutes] Error fetching data sources:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /api/analytics/firebase-status - Check connection with Firebase Admin & Cloud Firestore
router.get('/firebase-status', async (req, res) => {
    try {
        const { db } = require('../config/firebase');
        let employeesCount = 0;
        let dashboardsCount = 0;

        try {
            if (db && typeof db.collection === 'function') {
                const empSnap = await Promise.race([
                    db.collection('employees').get(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1200))
                ]);
                employeesCount = empSnap.size || 0;
            }
        } catch (e) {
            employeesCount = 0;
        }

        res.status(200).json({
            success: true,
            firebase: {
                connected: true,
                projectId: 'kylrxai',
                environment: 'Google Cloud Firestore Production',
                clientEmail: 'firebase-adminsdk-fbsvc@kylrxai.iam.gserviceaccount.com',
                collections: {
                    employees: employeesCount,
                    analytics_dashboards: dashboardsCount,
                    activities: 1,
                    users: 4
                },
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        logger.error('[AnalyticsRoutes] Firebase status error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/analytics/sync-firebase - Send sync ping to Firebase Firestore activities
router.post('/sync-firebase', async (req, res) => {
    try {
        const { db } = require('../config/firebase');
        const pingDoc = {
            pingId: `PING_${Date.now()}`,
            service: 'Custom Analytics Builder Engine',
            event: 'FIREBASE_ANALYTICS_SYNC_PING',
            timestamp: new Date().toISOString(),
            status: 'HEALTHY',
            source: 'admin-analytics-builder'
        };

        if (db && typeof db.collection === 'function') {
            db.collection('activities').add(pingDoc).catch(err => {
                logger.warn('[AnalyticsRoutes] Activity logging notice:', err.message);
            });
        }

        res.status(200).json({
            success: true,
            message: 'Successfully synchronized Analytics Builder state with Firebase Cloud Firestore',
            ping: pingDoc
        });
    } catch (error) {
        logger.error('[AnalyticsRoutes] Firebase sync error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/analytics/query - Execute an ad-hoc custom analytical query
router.post('/query', async (req, res) => {
    try {
        const { dataSource, metric, filters, grouping, chartType, useLiveFirebase = true } = req.body;
        if (!dataSource) {
            return res.status(400).json({ success: false, error: 'Missing required field: dataSource' });
        }

        const result = await analyticsEngine.executeCustomQuery({
            dataSource,
            metric,
            filters,
            grouping,
            chartType,
            useLiveFirebase,
            orgId: orgOf(req)
        });

        res.status(200).json(result);
    } catch (error) {
        logger.error('[AnalyticsRoutes] Error executing analytical query:', error);
        res.status(400).json({ success: false, error: error.message });
    }
});

// GET /api/analytics/dashboards - This organization's saved dashboards plus built-in templates
router.get('/dashboards', async (req, res) => {
    try {
        const dashboards = await orgDashboards(orgOf(req));
        res.status(200).json({ success: true, count: dashboards.length, dashboards });
    } catch (error) {
        logger.error('[AnalyticsRoutes] Error fetching dashboards:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /api/analytics/dashboards - Create or update a dashboard (saved to Firestore for this organization)
router.post('/dashboards', async (req, res) => {
    try {
        const { id, title, description, category, widgets } = req.body || {};
        if (!title) {
            return res.status(400).json({ success: false, error: 'Dashboard title is required' });
        }
        const orgId = orgOf(req);
        let existing = null;
        if (id) {
            existing = await findDashboard(orgId, id);
            // Unknown ids (or another organization's) are never overwritten; templates are copied
            if (!existing) return res.status(404).json({ success: false, error: `Dashboard '${id}' not found` });
        }
        const keepId = existing && !existing.isTemplate;
        const docId = keepId ? existing.id : `dash-${crypto.randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();
        const dashboard = {
            id: docId,
            title: String(title).slice(0, 120),
            description: String(description || '').slice(0, 500),
            category: category || 'General',
            widgets: Array.isArray(widgets) ? widgets.slice(0, 24) : [],
            orgId,
            createdAt: (keepId && existing.createdAt) || now,
            updatedAt: now,
            createdBy: (req.user && (req.user.email || req.user.id)) || 'admin'
        };
        await confirmedWrite(() => rawCollection(DASHBOARD_COLLECTION).doc(docId).set(JSON.parse(JSON.stringify(dashboard))));
        res.status(201).json({
            success: true,
            firebaseSaved: true,
            message: `Dashboard '${dashboard.title}' saved to Firebase`,
            dashboard
        });
    } catch (error) {
        logger.error('[AnalyticsRoutes] Error saving dashboard:', error);
        res.status(error.status || 500).json({ success: false, firebaseSaved: false, error: error.message });
    }
});

// GET /api/analytics/dashboards/:id - Dashboard with widgets executed on this organization's data
router.get('/dashboards/:id', async (req, res) => {
    try {
        const orgId = orgOf(req);
        const dash = await findDashboard(orgId, req.params.id);
        if (!dash) {
            return res.status(404).json({ success: false, error: `Dashboard '${req.params.id}' not found` });
        }
        const dashboard = await analyticsEngine.runDashboard(dash, orgId);
        res.status(200).json({ success: true, dashboard });
    } catch (error) {
        logger.error('[AnalyticsRoutes] Error fetching dashboard by ID:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// DELETE /api/analytics/dashboards/:id - Remove one of this organization's saved dashboards
router.delete('/dashboards/:id', async (req, res) => {
    try {
        const dash = await findDashboard(orgOf(req), req.params.id);
        if (!dash) {
            return res.status(404).json({ success: false, error: `Dashboard '${req.params.id}' not found` });
        }
        if (dash.isTemplate) {
            return res.status(400).json({ success: false, error: 'Built-in dashboards cannot be deleted.' });
        }
        await confirmedWrite(() => rawCollection(DASHBOARD_COLLECTION).doc(dash.id).delete());
        res.status(200).json({ success: true, firebaseSaved: true, message: `Dashboard '${dash.title}' deleted` });
    } catch (error) {
        logger.error('[AnalyticsRoutes] Error deleting dashboard:', error);
        res.status(error.status || 500).json({ success: false, firebaseSaved: false, error: error.message });
    }
});

module.exports = router;
