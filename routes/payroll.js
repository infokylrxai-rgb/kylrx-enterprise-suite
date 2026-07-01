const express = require('express');
const router = express.Router();

let admin, db;
try {
    ({ admin, db } = require('../config/firebase'));
} catch (e) {
    console.warn('[PAYROLL] Firebase Admin not available:', e.message);
}

/**
 * Signed download URL for payslip PDFs (works with strict Storage rules).
 * GET /api/payroll/documents/:docId/download-url?employeeId=...
 */
router.get('/documents/:docId/download-url', async (req, res) => {
    try {
        if (!admin || !admin.apps || admin.apps.length === 0) {
            return res.status(503).json({ success: false, error: 'Firebase Admin not configured' });
        }
        const { docId } = req.params;
        const { employeeId } = req.query;

        if (!employeeId) {
            return res.status(400).json({ success: false, error: 'employeeId is required' });
        }

        const docSnap = await db.collection('payroll_documents').doc(docId).get();
        if (!docSnap.exists) {
            return res.status(404).json({ success: false, error: 'Payroll document not found' });
        }

        const data = docSnap.data();
        if (data.employeeId !== employeeId) {
            return res.status(403).json({ success: false, error: 'Not authorized for this document' });
        }

        if (data.storageUrl) {
            return res.json({ success: true, url: data.storageUrl, source: 'firestore' });
        }

        if (!data.storagePath) {
            return res.status(404).json({ success: false, error: 'No PDF file attached to this document' });
        }

        const bucket = admin.storage().bucket();
        const file = bucket.file(data.storagePath);
        const [url] = await file.getSignedUrl({
            action: 'read',
            expires: Date.now() + 15 * 60 * 1000
        });

        return res.json({
            success: true,
            url,
            fileName: data.fileName || 'payslip.pdf',
            source: 'signed'
        });
    } catch (error) {
        console.error('[PAYROLL] Signed URL error:', error.message);
        return res.status(500).json({ success: false, error: 'Failed to generate download URL' });
    }
});

/**
 * List payslips for an employee (employee portal).
 * GET /api/payroll/employee/:employeeId/documents
 */
router.get('/employee/:employeeId/documents', async (req, res) => {
    try {
        const { employeeId } = req.params;
        const snap = await db.collection('payroll_documents')
            .where('employeeId', '==', employeeId)
            .orderBy('createdAt', 'desc')
            .limit(50)
            .get();

        const documents = [];
        snap.forEach((doc) => {
            const d = doc.data();
            if (d.docType === 'Payslip' || d.docType === 'Invoice') {
                documents.push({
                    id: doc.id,
                    docType: d.docType,
                    period: d.period,
                    status: d.status,
                    fileName: d.fileName,
                    createdAt: d.createdAt?.toDate?.()?.toISOString?.() || null
                });
            }
        });

        return res.json({ success: true, count: documents.length, data: documents });
    } catch (error) {
        console.error('[PAYROLL] List documents error:', error.message);
        return res.status(500).json({ success: false, error: 'Failed to list payroll documents' });
    }
});

module.exports = router;
