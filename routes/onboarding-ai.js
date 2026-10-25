const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { admin, db, rawCollection } = require('../config/firebase');
const { confirmedWrite } = require('../config/firestore-write');
const { orgDocs, LEGACY_ORG_ID } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');
const intel = require('../services/onboarding-intel-service');

router.use(verifyToken);
router.use(authorize(ADMIN_HR_ROLES));

/**
 * AI Command Center for onboarding (admin-onboarding-ai.html).
 *
 * All figures come from this organization's data: users, Firebase Authentication sign-in
 * times (read only) and reviewed EODs. Insights and the action plan are derived from them;
 * ticked plan items are saved per organization (`onboarding_ai_plans/{orgId}`). Each admin
 * has their own assistant chat history (`onboarding_ai_chats`). Saves respond only after
 * Firestore confirmed them.
 */

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}

function meOf(req) {
    const u = req.user || {};
    return { id: u.uid || u.id || 'admin', name: u.name || u.displayName || u.email || 'Administrator' };
}

function sendError(res, err, context) {
    logger.error(`[OnboardingAiAPI] ${context}:`, err.message);
    res.status(err.status || 500).json({ success: false, firebaseSaved: false, error: err.message, message: err.message });
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

async function signIns(uids) {
    const map = new Map();
    for (let i = 0; i < uids.length; i += 100) {
        try {
            const { users } = await admin.auth().getUsers(uids.slice(i, i + 100).map(uid => ({ uid })));
            users.forEach(u => { if (u.metadata && u.metadata.lastSignInTime) map.set(u.uid, Date.parse(u.metadata.lastSignInTime)); });
        } catch (err) {
            logger.warn(`[OnboardingAiAPI] Sign-in lookup notice: ${err.message}`);
        }
    }
    return map;
}

async function factsFor(req) {
    const orgId = orgOf(req);
    const [users, eods] = await Promise.all([
        orgDocs(rawCollection, 'users', orgId, 2000),
        orgDocs(rawCollection, 'employee_eods', orgId, 2000)
    ]);
    const facts = intel.buildFacts({
        users,
        signIns: await signIns([...new Set(users.map(u => u.uid || u.id))]),
        eods: eods.filter(e => /^reviewed$/i.test(String(e.status || '')))
    });
    return { facts, insights: intel.buildInsights(facts) };
}

// GET /api/onboarding-ai/overview
router.get('/overview', async (req, res) => {
    try {
        const { facts, insights } = await factsFor(req);
        const planSnap = await rawCollection('onboarding_ai_plans').doc(orgOf(req)).get();
        const done = planSnap.exists ? (planSnap.data().done || {}) : {};
        res.json({
            success: true,
            data: {
                stats: {
                    total: facts.total, activated: facts.activated, awaiting: facts.awaiting,
                    activationRate: facts.activationRate, avgCompleteness: facts.avgCompleteness,
                    sentiment: facts.sentiment, sentimentCount: facts.sentimentCount
                },
                weekly: facts.weekly,
                departments: facts.departments,
                insights,
                plan: intel.planFrom(insights).map(t => ({ ...t, done: Boolean(done[t.id]) })),
                aiConfigured: intel.aiConfigured()
            }
        });
    } catch (err) {
        sendError(res, err, 'Overview error');
    }
});

// PUT /api/onboarding-ai/plan/:taskId - Tick or untick an action-plan item
router.put('/plan/:taskId', async (req, res) => {
    try {
        const id = String(req.params.taskId).replace(/[^a-z0-9_]/gi, '').slice(0, 60);
        if (!id) throw httpError(400, 'Unknown task.');
        const done = Boolean(req.body && req.body.done);
        await confirmedWrite(() => rawCollection('onboarding_ai_plans').doc(orgOf(req)).set({
            orgId: orgOf(req),
            done: { [id]: done ? { by: meOf(req).name, at: new Date().toISOString() } : admin.firestore.FieldValue.delete() },
            updatedAt: new Date()
        }, { merge: true }));
        res.json({ success: true, firebaseSaved: true });
    } catch (err) {
        sendError(res, err, 'Plan error');
    }
});

// POST /api/onboarding-ai/insights/:id/notify - In-app message to HR/admins about an insight
router.post('/insights/:id/notify', async (req, res) => {
    try {
        const { insights } = await factsFor(req);
        const insight = insights.find(i => i.id === req.params.id);
        if (!insight) throw httpError(404, 'This issue is no longer open.');
        const orgId = orgOf(req);
        const me = meOf(req);
        const users = await orgDocs(rawCollection, 'users', orgId, 2000);
        const hr = users.filter(u => u.id !== me.id && /hr|admin/i.test(String(u.role || '')) && !(u.isActive === false));
        if (!hr.length) throw httpError(409, 'No other HR or admin user to notify.');
        const now = new Date();
        const who = insight.people.slice(0, 15).map(p => `${p.name}${p.detail ? ` (${p.detail})` : ''}`).join(', ');
        const message = `${insight.title}. ${insight.description} Affected: ${who}${insight.people.length > 15 ? ` and ${insight.people.length - 15} more` : ''}.`;
        const batch = db.batch();
        hr.slice(0, 20).forEach(u => batch.set(rawCollection('notifications').doc(), {
            orgId, userId: u.id, targetUid: u.id, target: u.id,
            title: `Onboarding: ${insight.title}`, text: message, message,
            type: 'onboarding_insight', priority: insight.type === 'bottleneck' ? 'high' : 'normal',
            read: false, timestamp: now, createdAt: now.toISOString(), sentBy: me.name
        }));
        await confirmedWrite(() => batch.commit());
        res.json({ success: true, firebaseSaved: true, data: { notified: hr.slice(0, 20).map(u => u.name || u.email) } });
    } catch (err) {
        sendError(res, err, 'Notify error');
    }
});

/* ━━━━━━━━━━━━━━━━━━━━ Assistant chat (per admin) ━━━━━━━━━━━━━━━━━━━━ */

async function myChats(req) {
    const me = meOf(req);
    const snap = await rawCollection('onboarding_ai_chats').where('orgId', '==', orgOf(req)).where('userId', '==', me.id).limit(300).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

async function ownMessage(req) {
    const ref = rawCollection('onboarding_ai_chats').doc(String(req.params.id));
    const snap = await ref.get();
    if (!snap.exists || snap.data().orgId !== orgOf(req) || snap.data().userId !== meOf(req).id) throw httpError(404, 'Message not found.');
    return { ref, data: snap.data() };
}

// GET /api/onboarding-ai/chat
router.get('/chat', async (req, res) => {
    try {
        const chats = await myChats(req);
        res.json({ success: true, data: chats.slice(-60).map(c => ({ id: c.id, role: c.role, message: c.message, createdAt: c.createdAt, edited: Boolean(c.editedAt) })) });
    } catch (err) {
        sendError(res, err, 'Chat history error');
    }
});

// POST /api/onboarding-ai/chat - Ask the assistant (question and answer are saved)
router.post('/chat', async (req, res) => {
    try {
        const question = String((req.body && req.body.message) || '').trim().slice(0, 500);
        if (!question) throw httpError(400, 'Please type a question.');
        const { facts, insights } = await factsFor(req);
        const reply = await intel.answer(question, facts, insights);
        const orgId = orgOf(req);
        const me = meOf(req);
        const now = Date.now();
        const userRef = rawCollection('onboarding_ai_chats').doc();
        const aiRef = rawCollection('onboarding_ai_chats').doc();
        const batch = db.batch();
        batch.set(userRef, { orgId, userId: me.id, role: 'user', message: question, createdAt: new Date(now).toISOString() });
        batch.set(aiRef, { orgId, userId: me.id, role: 'ai', message: reply.message, source: reply.source, createdAt: new Date(now + 1).toISOString() });
        await confirmedWrite(() => batch.commit());
        res.json({ success: true, firebaseSaved: true, data: { question: { id: userRef.id, message: question }, answer: { id: aiRef.id, message: reply.message, source: reply.source } } });
    } catch (err) {
        sendError(res, err, 'Chat error');
    }
});

// PUT /api/onboarding-ai/chat/:id - Edit one of my questions
router.put('/chat/:id', async (req, res) => {
    try {
        const { ref, data } = await ownMessage(req);
        if (data.role !== 'user') throw httpError(400, 'Only your own questions can be edited.');
        const message = String((req.body && req.body.message) || '').trim().slice(0, 500);
        if (!message) throw httpError(400, 'The message cannot be empty.');
        await confirmedWrite(() => ref.update({ message, editedAt: new Date().toISOString() }));
        res.json({ success: true, firebaseSaved: true });
    } catch (err) {
        sendError(res, err, 'Chat edit error');
    }
});

// DELETE /api/onboarding-ai/chat/:id - Delete one of my messages
router.delete('/chat/:id', async (req, res) => {
    try {
        const { ref } = await ownMessage(req);
        await confirmedWrite(() => ref.delete());
        res.json({ success: true, firebaseSaved: true });
    } catch (err) {
        sendError(res, err, 'Chat delete error');
    }
});

// DELETE /api/onboarding-ai/chat - Clear my history
router.delete('/chat', async (req, res) => {
    try {
        const chats = await myChats(req);
        for (let i = 0; i < chats.length; i += 400) {
            const batch = db.batch();
            chats.slice(i, i + 400).forEach(c => batch.delete(rawCollection('onboarding_ai_chats').doc(c.id)));
            await confirmedWrite(() => batch.commit());
        }
        res.json({ success: true, firebaseSaved: true, data: { deleted: chats.length } });
    } catch (err) {
        sendError(res, err, 'Chat clear error');
    }
});

module.exports = router;
