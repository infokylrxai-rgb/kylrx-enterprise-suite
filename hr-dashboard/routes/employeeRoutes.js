const express = require('express');
const multer = require('multer');
const { bulkUploadCSV } = require('../controllers/employeeController');
const { verifyToken, authorize } = require('../middleware/authMiddleware');
const auditLogger = require('../middleware/auditMiddleware');

const router = express.Router();

// Multer setup for CSV
const upload = multer({ dest: 'uploads/', fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel') {
        cb(null, true);
    } else {
        cb(new Error('Not a CSV file!'), false);
    }
}});

// Protect all employee routes
router.use(verifyToken);
router.use(auditLogger);

// Admin & Manager Only
router.post('/bulk-upload', authorize('Super Admin', 'Admin', 'Manager'), upload.single('file'), bulkUploadCSV);

module.exports = router;
