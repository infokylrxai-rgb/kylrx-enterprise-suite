const express = require('express');
const router = express.Router();
const customTemplateEngine = require('../services/custom-template-engine');
const TenantEngineStore = require('../services/tenant-engine-store');
const logger = require('../utils/logger');
const { LEGACY_ORG_ID } = require('../config/tenant');
const { verifyToken, authorize, ADMIN_HR_ROLES } = require('../middleware/authMiddleware');

router.use(verifyToken);
router.use(authorize(ADMIN_HR_ROLES));

/**
 * Customisable Templates REST API Router
 * Requirement 1.2 Customisable Templates & 1.3 Module-level templates
 *
 * Each organization works on its own copy of the engine: the built-in module templates plus
 * the templates it created or changed (Firestore `custom_templates`). Changes respond only
 * after Firestore confirmed them (503 otherwise). The acting user is the signed-in user, not
 * an "actor" sent by the browser.
 */

const store = new TenantEngineStore({
    name: 'CustomTemplates',
    createEngine: () => new customTemplateEngine.constructor(),
    maps: [{
        field: 'templates',
        collection: 'custom_templates',
        idOf: t => t.id,
        put: (engine, t) => { engine.templates.set(t.id, t); if (t.key) engine.templates.set(t.key, t); }
    }]
});

function orgOf(req) {
    return req.tenantOrgId || (req.user && req.user.orgId) || LEGACY_ORG_ID;
}

/** Engine actor for the signed-in user (super admins keep super_admin; other admins act as hr_admin) */
function actorOf(req) {
    const u = req.user || {};
    const role = String(u.role || '').toLowerCase().replace(/[\s_-]+/g, '');
    return {
        id: u.uid || u.id,
        name: u.name || u.displayName || u.email || 'Administrator',
        role: role === 'superadmin' || u.super_admin === true || u.superadmin === true ? 'super_admin' : 'hr_admin'
    };
}

function statusFor(error, fallback = 500) {
    if (error.status) return error.status;
    const m = error.message || '';
    if (/Permission Denied|not authorized|not permitted|Access Denied|Denied/.test(m)) return 403;
    if (/not found/i.test(m)) return 404;
    if (/required|Archived|Draft|already|invalid/i.test(m)) return 400;
    return fallback;
}

function sendError(res, error, context, fallback) {
    logger.error(`[CustomTemplatesAPI] ${context}:`, error);
    res.status(statusFor(error, fallback)).json({ success: false, firebaseSaved: false, error: error.message, message: error.message });
}

const listFilters = (q) => ({
    module: q.module, status: q.status, role: q.role, search: q.search,
    scope: q.scope, ownerId: q.ownerId, forGeneralUse: q.forGeneralUse === 'true'
});

// GET /api/custom-templates - List templates with module, status, role, scope filtering
router.get('/', async (req, res) => {
    try {
        const templates = await store.read(orgOf(req), engine => engine.listTemplates(listFilters(req.query)));
        res.status(200).json({ success: true, data: templates, total: templates.length });
    } catch (error) {
        sendError(res, error, 'Error listing templates');
    }
});

// GET /api/custom-templates/module/:module - Get templates for specific module
router.get('/module/:module', async (req, res) => {
    try {
        const { status, role, scope } = req.query;
        const templates = await store.read(orgOf(req), engine => engine.listTemplates({ module: req.params.module, status, role, scope }));
        res.status(200).json({ success: true, module: req.params.module, data: templates, total: templates.length });
    } catch (error) {
        sendError(res, error, `Error getting module ${req.params.module} templates`);
    }
});

// GET /api/custom-templates/:id/versions - Get all versions of a template
router.get('/:id/versions', async (req, res) => {
    try {
        const versions = await store.read(orgOf(req), engine => engine.getTemplateVersions(req.params.id));
        res.status(200).json({ success: true, templateId: req.params.id, data: versions, total: versions.length });
    } catch (error) {
        sendError(res, error, `Error getting versions for ${req.params.id}`, 404);
    }
});

// GET /api/custom-templates/:id - Get single template
router.get('/:id', async (req, res) => {
    try {
        const template = await store.read(orgOf(req), engine => engine.getTemplate(req.params.id));
        res.status(200).json({ success: true, data: template });
    } catch (error) {
        sendError(res, error, `Error getting template ${req.params.id}`, 404);
    }
});

// POST /api/custom-templates/shared - Administrator provides a shared template (PRD 1.3)
router.post('/shared', async (req, res) => {
    try {
        const { name, module, category, description, instructions, permittedFields, lockedFields, structure, status, permissions } = req.body || {};
        if (!name || !module) {
            return res.status(400).json({ success: false, error: 'Template name and module are required.' });
        }
        const sharedTemplate = await store.change(orgOf(req), engine => engine.provideSharedTemplate(
            { name, module, category, description, instructions, permittedFields, lockedFields, structure, status, permissions },
            actorOf(req)
        ));
        res.status(201).json({
            success: true,
            firebaseSaved: true,
            data: sharedTemplate,
            message: `Shared administrator template "${sharedTemplate.name}" created (${sharedTemplate.status}).`
        });
    } catch (error) {
        sendError(res, error, 'Error providing shared template');
    }
});

// POST /api/custom-templates - Create new template
router.post('/', async (req, res) => {
    try {
        const { name, module, category, description, instructions, permittedFields, lockedFields, structure, status, permissions, scope, isPersonal } = req.body || {};
        if (!name || !module) {
            return res.status(400).json({ success: false, error: 'Template name and module are required.' });
        }
        const newTemplate = await store.change(orgOf(req), engine => engine.createTemplate(
            { name, module, category, description, instructions, permittedFields, lockedFields, structure, status, permissions, scope, isPersonal },
            actorOf(req)
        ));
        res.status(201).json({
            success: true,
            firebaseSaved: true,
            data: newTemplate,
            message: `Template "${newTemplate.name}" created (${newTemplate.status}).`
        });
    } catch (error) {
        sendError(res, error, 'Error creating template');
    }
});

// POST /api/custom-templates/:id/personal-copy - Manager creates personal copy (PRD 1.3)
router.post('/:id/personal-copy', async (req, res) => {
    try {
        const { overrides } = req.body || {};
        const personalCopy = await store.change(orgOf(req), engine => engine.createPersonalCopy(req.params.id, actorOf(req), overrides || {}));
        res.status(201).json({
            success: true,
            firebaseSaved: true,
            data: personalCopy,
            message: `Personal copy "${personalCopy.name}" created successfully.`
        });
    } catch (error) {
        sendError(res, error, `Error creating personal copy of ${req.params.id}`);
    }
});

// POST /api/custom-templates/:id/archive - Archive template (PRD 1.3: Retained for history; unavailable for new use)
router.post('/:id/archive', async (req, res) => {
    try {
        const { reason } = req.body || {};
        const archived = await store.change(orgOf(req), engine => engine.archiveTemplate(req.params.id, actorOf(req), reason));
        res.status(200).json({
            success: true,
            firebaseSaved: true,
            data: archived,
            message: `Template "${archived.name}" archived. Retained for history; unavailable for new use.`
        });
    } catch (error) {
        sendError(res, error, `Error archiving template ${req.params.id}`);
    }
});

// POST /api/custom-templates/:id/version - Create new version of template (PRD 1.3)
router.post('/:id/version', async (req, res) => {
    try {
        const { versionData } = req.body || {};
        if (!versionData) {
            return res.status(400).json({ success: false, error: 'versionData payload is required.' });
        }
        const updated = await store.change(orgOf(req), engine => engine.createTemplateVersion(req.params.id, versionData, actorOf(req)));
        res.status(200).json({
            success: true,
            firebaseSaved: true,
            data: updated,
            version: updated.version,
            message: `Template updated to version ${updated.version}. Existing records remain unaffected.`
        });
    } catch (error) {
        sendError(res, error, `Error versioning template ${req.params.id}`);
    }
});

// PUT /api/custom-templates/:id - Edit permitted fields and instructions
router.put('/:id', async (req, res) => {
    try {
        const { name, description, instructions, permittedFields, lockedFields, structure, changeNotes, status } = req.body || {};
        const updated = await store.change(orgOf(req), engine => engine.updateTemplate(
            req.params.id,
            { name, description, instructions, permittedFields, lockedFields, structure, changeNotes, status },
            actorOf(req)
        ));
        res.status(200).json({
            success: true,
            firebaseSaved: true,
            data: updated,
            message: `Template "${updated.name}" updated successfully.`
        });
    } catch (error) {
        sendError(res, error, `Error updating template ${req.params.id}`);
    }
});

// POST /api/custom-templates/:id/preview - Pre-save preview
router.post('/:id/preview', async (req, res) => {
    try {
        const { customFieldValues } = req.body || {};
        const preview = await store.read(orgOf(req), engine => engine.previewTemplate(req.params.id, customFieldValues || {}));
        res.status(200).json({ success: true, data: preview });
    } catch (error) {
        sendError(res, error, `Error previewing template ${req.params.id}`);
    }
});

// POST /api/custom-templates/:id/save-draft - Save as draft
router.post('/:id/save-draft', async (req, res) => {
    try {
        const { updates } = req.body || {};
        const template = await store.change(orgOf(req), engine => engine.saveAsDraft(req.params.id, updates || {}, actorOf(req)));
        res.status(200).json({ success: true, firebaseSaved: true, data: template, message: 'Template saved as draft.' });
    } catch (error) {
        sendError(res, error, `Error saving draft ${req.params.id}`);
    }
});

// POST /api/custom-templates/:id/publish - Publish template
router.post('/:id/publish', async (req, res) => {
    try {
        const template = await store.change(orgOf(req), engine => engine.publishTemplate(req.params.id, actorOf(req)));
        res.status(200).json({
            success: true,
            firebaseSaved: true,
            data: template,
            message: `Template "${template.name}" published successfully.`
        });
    } catch (error) {
        sendError(res, error, `Error publishing template ${req.params.id}`);
    }
});

// PUT /api/custom-templates/:id/permissions - Administrator manages template permissions
router.put('/:id/permissions', async (req, res) => {
    try {
        const { permissions } = req.body || {};
        if (!permissions) {
            return res.status(400).json({ success: false, error: 'Permissions payload is required.' });
        }
        const template = await store.change(orgOf(req), engine => engine.updateTemplatePermissions(req.params.id, permissions, actorOf(req)));
        res.status(200).json({
            success: true,
            firebaseSaved: true,
            data: template,
            message: `Permissions updated for template "${template.name}".`
        });
    } catch (error) {
        sendError(res, error, `Error updating permissions on ${req.params.id}`);
    }
});

// POST /api/custom-templates/:id/instantiate - Instantiate template with permitted values
router.post('/:id/instantiate', async (req, res) => {
    try {
        const { userInputs } = req.body || {};
        const instantiated = await store.read(orgOf(req), engine => engine.instantiateTemplate(req.params.id, userInputs || {}, actorOf(req)));
        res.status(200).json({
            success: true,
            data: instantiated,
            message: `Template "${instantiated.templateName}" instantiated successfully.`
        });
    } catch (error) {
        sendError(res, error, `Error instantiating template ${req.params.id}`);
    }
});

module.exports = router;
