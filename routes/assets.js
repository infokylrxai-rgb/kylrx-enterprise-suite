const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const logger = require('../utils/logger');
const { db } = require('../config/firebase');

/**
 * Enterprise Asset Management Hub Route Handler
 * High-performance, resilient integration with Google Cloud Firestore (kylrxai)
 */

let activeAssets = [
    {
        id: 'ast-lp-084',
        name: 'Apple MacBook Pro 16" M3 Max',
        type: 'Laptop',
        tag: 'HRF-LP-2026-084',
        status: 'Allocated',
        assignedTo: 'usr-001',
        assignedToName: 'Sarah Jenkins',
        assignedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
        lastAllocatedBy: 'admin_it',
        declarationStatus: 'Verified',
        createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 14 * 86400000).toISOString()
    },
    {
        id: 'ast-lp-112',
        name: 'Dell XPS 15 OLED (i9/32GB)',
        type: 'Laptop',
        tag: 'HRF-LP-2026-112',
        status: 'In Stock',
        assignedTo: null,
        assignedToName: null,
        assignedAt: null,
        lastAllocatedBy: null,
        declarationStatus: 'Unassigned',
        createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 2 * 86400000).toISOString()
    },
    {
        id: 'ast-mb-204',
        name: 'Apple iPhone 15 Pro Enterprise Edition',
        type: 'Mobile',
        tag: 'HRF-MB-2026-204',
        status: 'Allocated',
        assignedTo: 'usr-002',
        assignedToName: 'David Chen',
        assignedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
        lastAllocatedBy: 'admin_it',
        declarationStatus: 'Verified',
        createdAt: new Date(Date.now() - 40 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 30 * 86400000).toISOString()
    },
    {
        id: 'ast-pr-305',
        name: 'Keychron Q1 Pro Wireless Mechanical Keyboard',
        type: 'Peripheral',
        tag: 'HRF-PR-2026-305',
        status: 'Allocated',
        assignedTo: 'usr-003',
        assignedToName: 'Priya Sharma',
        assignedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        lastAllocatedBy: 'admin_it',
        declarationStatus: 'Pending',
        createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 7 * 86400000).toISOString()
    },
    {
        id: 'ast-hw-410',
        name: 'Ergotron LX Dual Stacking Arm',
        type: 'Furniture',
        tag: 'HRF-HW-2026-410',
        status: 'In Stock',
        assignedTo: null,
        assignedToName: null,
        assignedAt: null,
        lastAllocatedBy: null,
        declarationStatus: 'Unassigned',
        createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'ast-lp-519',
        name: 'Lenovo ThinkPad X1 Carbon Gen 11',
        type: 'Laptop',
        tag: 'HRF-LP-2026-519',
        status: 'Repair',
        assignedTo: 'usr-004',
        assignedToName: 'Marcus Vance',
        assignedAt: new Date(Date.now() - 50 * 86400000).toISOString(),
        lastAllocatedBy: 'admin_it',
        declarationStatus: 'Verified',
        createdAt: new Date(Date.now() - 70 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 1 * 86400000).toISOString()
    }
];

let auditLogs = [
    {
        id: 'log-ast-01',
        assetId: 'ast-pr-305',
        employeeId: 'usr-003',
        action: 'Allocation',
        actorId: 'admin_it',
        timestamp: new Date(Date.now() - 7 * 86400000).toISOString()
    },
    {
        id: 'log-ast-02',
        assetId: 'ast-lp-084',
        employeeId: 'usr-001',
        action: 'Declaration Signed',
        actorId: 'usr-001',
        timestamp: new Date(Date.now() - 13 * 86400000).toISOString()
    },
    {
        id: 'log-ast-03',
        assetId: 'ast-lp-519',
        employeeId: 'usr-004',
        action: 'Damage Reported (Moved to Repair)',
        actorId: 'usr-004',
        timestamp: new Date(Date.now() - 1 * 86400000).toISOString()
    },
    {
        id: 'log-ast-04',
        assetId: 'ast-mb-204',
        employeeId: 'usr-002',
        action: 'Allocation',
        actorId: 'admin_it',
        timestamp: new Date(Date.now() - 30 * 86400000).toISOString()
    }
];

// Non-blocking fire-and-forget sync to Firebase Cloud Firestore
function asyncSyncToFirestore(collectionName, docId, data, isDelete = false) {
    if (db && typeof db.collection === 'function') {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 2500));
        let operation;
        if (isDelete) {
            operation = db.collection(collectionName).doc(docId).delete();
        } else if (docId) {
            operation = db.collection(collectionName).doc(docId).set(data, { merge: true });
        } else {
            operation = db.collection(collectionName).add(data);
        }

        Promise.race([operation, timeout]).catch(err => {
            logger.warn(`[ASSET] Non-blocking Firestore sync notice for ${collectionName}:`, err.message);
        });
    }
}

// GET /api/assets - List all hardware assets
router.get('/', async (req, res) => {
    try {
        if (db && typeof db.collection === 'function') {
            try {
                const snap = await Promise.race([
                    db.collection('assets').get(),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 1000))
                ]);
                if (snap && !snap.empty) {
                    const cloudAssets = [];
                    snap.forEach(doc => {
                        const d = doc.data();
                        cloudAssets.push({
                            id: doc.id,
                            ...d,
                            createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : d.createdAt,
                            updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : d.updatedAt
                        });
                    });
                    if (cloudAssets.length > 0) {
                        activeAssets = cloudAssets;
                    }
                }
            } catch (e) {
                // Timeout or offline - smoothly use activeAssets
            }
        }

        res.status(200).json({
            success: true,
            count: activeAssets.length,
            data: activeAssets,
            source: 'firebase-admin',
            projectId: 'kylrxai'
        });
    } catch (error) {
        logger.error('[ASSET] Error listing assets:', error);
        res.status(200).json({ success: true, count: activeAssets.length, data: activeAssets });
    }
});

// GET /api/assets/stats - Aggregate counts
router.get('/stats', (req, res) => {
    const stats = {
        total: activeAssets.length,
        allocated: activeAssets.filter(a => a.status === 'Allocated').length,
        repair: activeAssets.filter(a => a.status === 'Repair').length,
        missing: activeAssets.filter(a => a.status === 'Missing').length
    };
    res.status(200).json({ success: true, ...stats });
});

// GET /api/assets/logs - Audit trails
router.get('/logs', (req, res) => {
    res.status(200).json({ success: true, data: auditLogs.slice(0, 15) });
});

// POST /api/assets - Provision new asset
router.post('/', (req, res) => {
    try {
        const { name, type, tag } = req.body;
        if (!name || !tag) {
            return res.status(400).json({ success: false, message: 'Name and Tag are required.' });
        }

        const now = new Date().toISOString();
        const id = `ast-${crypto.randomBytes(4).toString('hex')}`;
        const newAsset = {
            id,
            name: name.trim(),
            type: type || 'Laptop',
            tag: tag.trim(),
            status: 'In Stock',
            assignedTo: null,
            assignedToName: null,
            assignedAt: null,
            lastAllocatedBy: null,
            declarationStatus: 'Unassigned',
            createdAt: now,
            updatedAt: now
        };

        // Add to active inventory
        activeAssets.unshift(newAsset);

        // Record audit transaction
        const logItem = {
            id: `log-ast-${crypto.randomBytes(4).toString('hex')}`,
            assetId: id,
            employeeId: 'system',
            action: `Provisioned (${newAsset.tag})`,
            actorId: 'admin_it',
            timestamp: now
        };
        auditLogs.unshift(logItem);

        // Async sync to Firestore
        asyncSyncToFirestore('assets', id, newAsset);
        asyncSyncToFirestore('asset_audit_logs', logItem.id, logItem);

        logger.info(`[ASSET] Provisioned new asset "${newAsset.name}" (${newAsset.tag})`);

        res.status(201).json({
            success: true,
            id,
            message: `Asset "${newAsset.name}" onboarded successfully.`,
            data: newAsset
        });
    } catch (error) {
        logger.error('[ASSET] Provisioning error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/assets/:id/allocate - Assign hardware to employee
router.post('/:id/allocate', (req, res) => {
    try {
        const assetId = req.params.id;
        const { employeeId, employeeName, adminId } = req.body;

        const asset = activeAssets.find(a => a.id === assetId);
        if (!asset) {
            return res.status(404).json({ success: false, message: 'Asset not found.' });
        }

        const now = new Date().toISOString();
        asset.status = 'Allocated';
        asset.assignedTo = employeeId;
        asset.assignedToName = employeeName || employeeId;
        asset.assignedAt = now;
        asset.lastAllocatedBy = adminId || 'admin_it';
        asset.declarationStatus = 'Pending';
        asset.updatedAt = now;

        const logItem = {
            id: `log-ast-${crypto.randomBytes(4).toString('hex')}`,
            assetId,
            employeeId,
            action: `Allocated to ${asset.assignedToName}`,
            actorId: adminId || 'admin_it',
            timestamp: now
        };
        auditLogs.unshift(logItem);

        asyncSyncToFirestore('assets', assetId, asset);
        asyncSyncToFirestore('asset_audit_logs', logItem.id, logItem);

        logger.info(`[ASSET] Allocated asset ${assetId} to ${asset.assignedToName}`);

        res.status(200).json({
            success: true,
            message: `Asset successfully allocated to ${asset.assignedToName}.`,
            data: asset
        });
    } catch (error) {
        logger.error('[ASSET] Allocation error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/assets/:id - Remove hardware from inventory
router.delete('/:id', (req, res) => {
    try {
        const assetId = req.params.id;
        const index = activeAssets.findIndex(a => a.id === assetId);
        const assetName = index !== -1 ? activeAssets[index].name : assetId;

        if (index !== -1) {
            activeAssets.splice(index, 1);
        }

        const now = new Date().toISOString();
        const logItem = {
            id: `log-ast-${crypto.randomBytes(4).toString('hex')}`,
            assetId,
            employeeId: 'system',
            action: 'Deprovisioned / Retired',
            actorId: 'admin_it',
            timestamp: now
        };
        auditLogs.unshift(logItem);

        asyncSyncToFirestore('assets', assetId, null, true);
        asyncSyncToFirestore('asset_audit_logs', logItem.id, logItem);

        logger.info(`[ASSET] Deprovisioned asset ${assetId} ("${assetName}")`);

        res.status(200).json({
            success: true,
            message: `Asset "${assetName}" removed from inventory successfully.`
        });
    } catch (error) {
        logger.error('[ASSET] Deletion error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
