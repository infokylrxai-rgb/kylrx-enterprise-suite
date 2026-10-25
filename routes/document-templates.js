const express = require('express');
const router = express.Router();
const documentTemplateEngine = require('../services/document-template-engine');
const TenantEngineStore = require('../services/tenant-engine-store');
const documentAi = require('../services/document-ai-service');
const logger = require('../utils/logger');
const { rawCollection } = require('../config/firebase');
const { orgDocs, ownerOrgId, LEGACY_ORG_ID } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');

router.use(verifyToken);
router.use(authorize(ADMIN_HR_ROLES));

/**
 * 11. Document & Template Integration REST API
 *
 * Centralizes all document generation via the Document/Template Engine.
 * Full Automation delegates document-generation logic to this engine.
 *
 * IMPORTANT: Static routes (/generate, /generated) MUST be registered
 * BEFORE dynamic routes (/:key) to avoid Express matching them as :key params.
 *
 * Supports:
 * - Versioning (draft -> pending_approval -> approved)
 * - Effective dates (effectiveFrom / effectiveTo)
 * - Approval lifecycle with audit
 * - Employee-field mapping with token interpolation
 * - Permitted modules security gating
 *
 * Each organization works on its own copy of the engine: the 10 built-in templates plus the
 * versions it created/approved (Firestore `document_templates`) and the documents it
 * generated (Firestore `generated_documents`). Changes respond only after Firestore
 * confirmed them (503 otherwise).
 */

const store = new TenantEngineStore({
    name: 'DocumentTemplates',
    createEngine: () => new documentTemplateEngine.constructor(),
    maps: [
        { field: 'templates', collection: 'document_templates', idOf: t => t.key, put: (engine, t) => engine.templates.set(t.key, t) },
        { field: 'generatedDocuments', collection: 'generated_documents', idOf: d => d.docId, put: (engine, d) => engine.generatedDocuments.set(d.docId, d) }
    ]
});

const VERSION_RE = /^v?\d+(\.\d+){0,2}$/;

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}

function actorName(req) {
    return (req.user && (req.user.name || req.user.displayName || req.user.email)) || 'Administrator';
}

function sendError(res, error, context, status = 500) {
    logger.error(`[DocumentTemplatesAPI] ${context}:`, error);
    res.status(error.status || status).json({ success: false, firebaseSaved: false, error: error.message, message: error.message });
}

function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    return err;
}

/** Company shown in documents, from the organization's profile (organizations/{orgId}) */
async function companyOf(orgId) {
    try {
        const snap = await rawCollection('organizations').doc(orgId).get();
        const org = snap.exists ? snap.data() : {};
        const name = org.legalName || org.Legal_Name || org.displayName || org.Display_Name || org.name;
        const cin = org.cinOrLlpin || org.CIN_or_LLPIN;
        return name ? { name, ...(cin ? { taxId: `CIN: ${cin}` } : {}), address: org.registeredAddress || org.Registered_Address || '' } : null;
    } catch (_) {
        return null;
    }
}

// GET /api/document-templates - List all 10 standard templates
router.get('/', async (req, res) => {
    try {
        const templates = await store.read(orgOf(req), engine => engine.listTemplates());
        res.status(200).json({ success: true, data: templates, total: templates.length });
    } catch (error) {
        sendError(res, error, 'Error listing templates');
    }
});

// POST /api/document-templates/generate - Generate document from permitted module
// MUST be before /:key to avoid Express matching 'generate' as a key param
router.post('/generate', async (req, res) => {
    try {
        const { templateKey, dataContext, callerModule, asOfDate } = req.body || {};
        if (!templateKey) {
            return res.status(400).json({ success: false, error: 'templateKey is required.' });
        }
        const orgId = orgOf(req);
        const company = await companyOf(orgId);
        const context = { ...(company ? { company } : {}), ...(dataContext && typeof dataContext === 'object' ? dataContext : {}) };

        const docRecord = await store.change(orgId, async engine => {
            try {
                const record = await engine.generateDocument(templateKey, context, { callerModule: callerModule || 'hr_admin', actor: actorName(req), asOfDate });
                // Kept with the document for its letterhead (the record is saved with this change)
                record.companyName = (context.company && context.company.name) || null;
                return record;
            } catch (err) {
                if (err.message.includes('not permitted')) err.status = 403;
                else if (/not found|No approved/.test(err.message)) err.status = 400;
                throw err;
            }
        });

        res.status(200).json({
            success: true,
            firebaseSaved: true,
            data: {
                docId: docRecord.docId,
                templateName: docRecord.templateName,
                versionNumber: docRecord.versionNumber,
                sha256: docRecord.sha256,
                recipientName: docRecord.recipientName,
                generatedAt: docRecord.generatedAt
            },
            message: `Document '${docRecord.docId}' generated and saved.`
        });
    } catch (error) {
        sendError(res, error, 'Error generating document');
    }
});

// GET /api/document-templates/generated - List generated documents archive
// MUST be before /:key and /generated/:docId to avoid ambiguity
router.get('/generated', async (req, res) => {
    try {
        const { templateKey, recipientId, limit } = req.query;
        const docs = await store.read(orgOf(req), engine => engine.listGeneratedDocuments({
            templateKey,
            recipientId,
            limit: limit ? Math.min(parseInt(limit, 10) || 50, 500) : 200
        }));
        // The archive table needs no document bodies; one document is fetched to view it
        const total = await store.read(orgOf(req), engine => engine.generatedDocuments.size);
        res.status(200).json({ success: true, data: docs.map(({ renderedHtml, ...d }) => d), total });
    } catch (error) {
        sendError(res, error, 'Error listing generated documents');
    }
});

// GET /api/document-templates/generated/:docId - View single generated document
router.get('/generated/:docId', async (req, res) => {
    try {
        const doc = await store.read(orgOf(req), engine => engine.getGeneratedDocument(req.params.docId));
        res.status(200).json({ success: true, data: doc });
    } catch (error) {
        sendError(res, error, `Error fetching generated document '${req.params.docId}'`, 404);
    }
});

// ---- AI assistance (registered before /:key) ----

/** Version to work on: the given one, else the active approved one, else the latest */
function pickVersion(template, versionNumber) {
    const versions = template.versions || [];
    return (versionNumber && versions.find(v => v.versionNumber === versionNumber))
        || versions.find(v => v.isActive && v.status === 'approved')
        || versions[versions.length - 1];
}

// GET /api/document-templates/ai/status - Whether a language model is configured
router.get('/ai/status', (req, res) => {
    res.status(200).json({ success: true, data: { aiConfigured: documentAi.aiConfigured() } });
});

// POST /api/document-templates/ai/review - Check a template version (or an unsaved body)
router.post('/ai/review', async (req, res) => {
    try {
        const { templateKey, versionNumber, templateBody } = req.body || {};
        const template = await store.read(orgOf(req), engine => engine.getTemplate(templateKey));
        const version = pickVersion(template, versionNumber);
        const body = templateBody !== undefined ? String(templateBody) : version && version.templateBody;
        const review = await documentAi.reviewTemplate({ templateName: template.name, templateBody: body, fieldMappings: (version && version.fieldMappings) || [] });
        res.status(200).json({ success: true, data: { ...review, versionNumber: templateBody !== undefined ? null : version && version.versionNumber } });
    } catch (error) {
        sendError(res, error, 'Error reviewing template', /not found/.test(error.message) ? 404 : 500);
    }
});

// POST /api/document-templates/ai/draft - Propose a revised body from an instruction (not saved)
router.post('/ai/draft', async (req, res) => {
    try {
        const { templateKey, instruction, baseVersion } = req.body || {};
        const template = await store.read(orgOf(req), engine => engine.getTemplate(templateKey));
        const base = pickVersion(template, baseVersion);
        const draft = await documentAi.draftTemplate({
            templateName: template.name,
            instruction,
            baseBody: base ? base.templateBody : '',
            fieldMappings: (base && base.fieldMappings) || []
        });
        const review = documentAi.ruleReview(draft.templateBody, (base && base.fieldMappings) || []);
        res.status(200).json({ success: true, data: { ...draft, baseVersion: base && base.versionNumber, review } });
    } catch (error) {
        sendError(res, error, 'Error drafting template', /not found/.test(error.message) ? 404 : 500);
    }
});

// GET /api/document-templates/ai/people - This organization's people to fill documents for
router.get('/ai/people', async (req, res) => {
    try {
        const users = await orgDocs(rawCollection, 'users', orgOf(req));
        const data = users
            .filter(u => u.name || u.displayName || u.email)
            .map(u => ({
                id: u.id,
                name: u.name || u.displayName || u.email,
                email: String(u.email || '').toLowerCase(),
                department: u.departmentName || u.department || '',
                exited: u.isActive === false || /exited|relieved|inactive/i.test(String(u.employmentStatus || u.status || ''))
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
        res.status(200).json({ success: true, data });
    } catch (error) {
        sendError(res, error, 'Error listing people');
    }
});

// POST /api/document-templates/ai/autofill - Values for a template's fields from an employee's record
router.post('/ai/autofill', async (req, res) => {
    try {
        const { templateKey, employeeId } = req.body || {};
        const orgId = orgOf(req);
        const template = await store.read(orgId, engine => engine.getTemplate(templateKey));
        const version = pickVersion(template);
        const snap = employeeId ? await rawCollection('users').doc(String(employeeId)).get() : null;
        if (!snap || !snap.exists || ownerOrgId(snap.data()) !== orgId) throw httpError(404, 'Employee not found in your organization.');

        const exits = (await orgDocs(rawCollection, 'employee_exits', orgId)).filter(e => e.employeeId === snap.id)
            .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        const result = documentAi.autofillValues({
            fieldMappings: (version && version.fieldMappings) || [],
            user: snap.data(),
            exit: exits[0] || null,
            company: await companyOf(orgId),
            signatoryName: actorName(req)
        });
        res.status(200).json({ success: true, data: result });
    } catch (error) {
        sendError(res, error, 'Error filling document fields');
    }
});

// GET /api/document-templates/:key - Full template detail with version history
router.get('/:key', async (req, res) => {
    try {
        const template = await store.read(orgOf(req), engine => engine.getTemplate(req.params.key));
        res.status(200).json({ success: true, data: template });
    } catch (error) {
        sendError(res, error, `Error fetching template '${req.params.key}'`, 404);
    }
});

// POST /api/document-templates/:key/versions - Create new draft version
router.post('/:key/versions', async (req, res) => {
    try {
        const { versionNumber, templateBody, effectiveFrom, changeNotes, fieldMappings } = req.body || {};
        const version = String(versionNumber || '').trim();
        if (!VERSION_RE.test(version)) throw httpError(400, 'Enter a version number such as v1.1.');
        if (!String(templateBody || '').trim()) throw httpError(400, 'The template body cannot be empty.');
        if (String(templateBody).length > 200000) throw httpError(400, 'The template body is too long.');
        if (effectiveFrom && !Number.isFinite(Date.parse(effectiveFrom))) throw httpError(400, 'Enter a valid effective date.');

        const newVersion = await store.change(orgOf(req), engine => {
            try {
                engine.getTemplate(req.params.key);
            } catch (err) {
                throw httpError(404, err.message);
            }
            try {
                return engine.createTemplateVersion(req.params.key, {
                    versionNumber: version,
                    templateBody: String(templateBody),
                    effectiveFrom: effectiveFrom ? new Date(effectiveFrom).toISOString() : undefined,
                    changeNotes: String(changeNotes || '').slice(0, 500) || undefined,
                    createdBy: actorName(req),
                    fieldMappings: Array.isArray(fieldMappings) ? fieldMappings : undefined
                });
            } catch (err) {
                throw httpError(409, err.message);
            }
        });

        res.status(201).json({ success: true, firebaseSaved: true, data: newVersion, message: `Version '${newVersion.versionNumber}' created as draft.` });
    } catch (error) {
        sendError(res, error, `Error creating version for '${req.params.key}'`);
    }
});

// POST /api/document-templates/:key/versions/:versionNumber/approve - Approve a version
router.post('/:key/versions/:versionNumber/approve', async (req, res) => {
    try {
        const { approvalRemarks } = req.body || {};
        const approved = await store.change(orgOf(req), engine => {
            try {
                return engine.approveTemplateVersion(req.params.key, req.params.versionNumber, {
                    approvedBy: actorName(req),
                    approvalRemarks: String(approvalRemarks || 'Approved for production use.').slice(0, 500)
                });
            } catch (err) {
                throw httpError(404, err.message);
            }
        });
        res.status(200).json({ success: true, firebaseSaved: true, data: approved, message: `Version '${req.params.versionNumber}' approved.` });
    } catch (error) {
        sendError(res, error, `Error approving version '${req.params.versionNumber}' for '${req.params.key}'`);
    }
});

// POST /api/document-templates/:key/preview - Render preview with sample or custom data
router.post('/:key/preview', async (req, res) => {
    try {
        const { versionNumber, dataContext } = req.body || {};
        const company = await companyOf(orgOf(req));
        const preview = await store.read(orgOf(req), engine => {
            try {
                return engine.previewTemplate(req.params.key, { versionNumber, dataContext: { ...(company ? { company } : {}), ...(dataContext || {}) } });
            } catch (err) {
                throw httpError(404, err.message);
            }
        });
        res.status(200).json({ success: true, data: preview });
    } catch (error) {
        sendError(res, error, `Error previewing template '${req.params.key}'`);
    }
});

module.exports = router;
