const { admin, db } = require('../config/firebase');
const fs = require('fs');
const csv = require('csv-parser');
const Joi = require('joi');
const logger = require('../utils/logger');
const { generateEmployeeId } = require('../utils/idGenerator');
const { generateSecurePassword } = require('../utils/passwordGenerator');

// Joi Schema for Strict Validation
const employeeSchema = Joi.object({
    name: Joi.string().min(2).max(50).required().messages({
        'string.empty': 'Full Name is required',
        'string.min': 'Name must be at least 2 characters long'
    }),
    email: Joi.string().email().required().messages({
        'string.email': 'Invalid email format',
        'string.empty': 'Email Address is required'
    }),
    department: Joi.string().required().messages({
        'string.empty': 'Department is required (e.g., Engineering, Finance)'
    }),
    role: Joi.string().valid('manager', 'employee').insensitive().required().messages({
        'any.only': 'Role must be either "manager" or "employee"',
        'string.empty': 'Role is required'
    }),
    salary: Joi.number().min(0).default(0),
    phone: Joi.string().allow('', null).optional(),
    address: Joi.string().allow('', null).optional(),
    joiningDate: Joi.string().isoDate().allow('', null).optional(),
    password: Joi.string().min(6).allow('', null).optional()
});

exports.bulkUploadCSV = async (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'Please upload a CSV file' });
    }

    const results = [];
    const errors = [];
    let rowCount = 0;

    // Load departments for mapping names to IDs
    let deptMap = {};
    try {
        const depts = await db.collection('departments').get();
        depts.forEach(doc => {
            const d = doc.data();
            deptMap[d.departmentName.toLowerCase()] = d.departmentId;
            deptMap[d.departmentCode.toLowerCase()] = d.departmentId;
            deptMap[d.departmentId.toLowerCase()] = d.departmentId;
        });
    } catch (e) {
        logger.error("Failed to load departments for mapping: " + e.message);
    }

    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => {
            rowCount++;
            // Map headers flexibly
            const rawData = {
                name: data.name || data.Name || data['Full Name'],
                email: data.email || data.Email || data['Email Address'],
                department: data.department || data.Department || data.Dept,
                role: data.role || data.Role || data.roleType,
                salary: data.salary || data.Salary || data['Base Salary'] || 0,
                phone: data.phone || data.Phone || data['Phone Number'],
                address: data.address || data.Address || data['Residential Address'],
                joiningDate: data.joiningDate || data.JoiningDate || data['Joining Date'],
                password: data.password || data.Password || data['Initial Password']
            };

            const { error, value } = employeeSchema.validate(rawData);

            if (error) {
                errors.push({ row: rowCount, data, message: error.details[0].message });
            } else {
                // Standardize values
                value.role = value.role.toLowerCase();
                
                // Map Department Name to ID
                const deptSearch = (value.department || '').toLowerCase();
                if (deptMap[deptSearch]) {
                    value.departmentId = deptMap[deptSearch];
                } else {
                    value.departmentId = value.department || 'operations'; // Default fallback
                }
                delete value.department;

                results.push(value);
            }
        })
        .on('end', async () => {
            // Delete temp file
            if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

            if (results.length === 0) {
                return res.status(200).json({
                    success: true,
                    data: { processed: rowCount, inserted: 0, failed: errors.length, errors: errors }
                });
            }

            const batch = db.batch();
            let successCount = 0;
            const insertedRecords = [];

            try {
                // Fetch existing emails to avoid duplicates
                const emailList = results.map(r => r.email);
                let existingEmails = new Set();
                
                // Firestore limit for 'in' query is 10. For bulk, we'll check individually or just let it process
                for (let employee of results) {
                    // Check if user already exists
                    const existingDocs = await db.collection('users').where('email', '==', employee.email).limit(1).get();
                    if (!existingDocs.empty) {
                        errors.push({ email: employee.email, message: 'Personnel already exists in database' });
                        continue;
                    }

                    // Get Department Code for ID generation
                    let deptCode = 'GEN';
                    const deptDoc = await db.collection('departments').doc(employee.departmentId).get();
                    if (deptDoc.exists) deptCode = deptDoc.data().departmentCode;

                    const employeeId = await generateEmployeeId(deptCode);
                    const docRef = db.collection('users').doc();
                    
                    // Standardize data for Firestore
                    const employeeData = {
                        ...employee,
                        employeeId,
                        uid: docRef.id,
                        status: 'active',
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        joiningDate: employee.joiningDate || new Date().toISOString()
                    };

                    // Handle initial password
                    if (employee.password) {
                        employeeData.tempPassword = employee.password;
                    } else {
                        // Auto-generate if missing
                        employeeData.tempPassword = generateSecurePassword(employee.name);
                    }

                    batch.set(docRef, employeeData);
                    insertedRecords.push({
                        name: employeeData.name,
                        email: employeeData.email,
                        employeeId: employeeData.employeeId,
                        tempPassword: employeeData.tempPassword,
                        departmentId: employeeData.departmentId,
                        role: employeeData.role
                    });
                    successCount++;
                }

                if (successCount > 0) {
                    await batch.commit();
                }

                res.status(200).json({
                    success: true,
                    data: {
                        processed: rowCount,
                        inserted: successCount,
                        failed: errors.length,
                        errors: errors,
                        records: insertedRecords
                    }
                });
            } catch (error) {
                logger.error(`Bulk Upload Execution Error: ${error.message}`);
                res.status(500).json({ success: false, error: 'Internal server error during synchronization' });
            }
        });
};
