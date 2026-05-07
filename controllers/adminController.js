const { admin, db } = require('../config/firebase');
const { generateEmployeeId } = require('../utils/idGenerator');
const { generateSecurePassword } = require('../utils/passwordGenerator');

/**
 * Helper to get next sequential ID for departments
 */
const getNextDeptId = async () => {
    const counterRef = db.collection('counters').doc('department');
    return await db.runTransaction(async (t) => {
        const doc = await t.get(counterRef);
        const count = (doc.exists ? doc.data().count : 0) + 1;
        t.set(counterRef, { count }, { merge: true });
        return `DEP${count.toString().padStart(3, '0')}`;
    });
};

/**
 * POST /departments
 * Create a new department
 */
exports.createDepartment = async (req, res, next) => {
    try {
        const { departmentName, departmentCode } = req.body;
        
        const departmentId = await getNextDeptId();
        const deptData = {
            departmentId,
            departmentName,
            departmentCode: departmentCode.toUpperCase(),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        await db.collection('departments').doc(departmentId).set(deptData);
        
        res.status(201).json({
            status: 'success',
            message: 'Department created successfully',
            data: deptData
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /employees
 * Create a new employee with Auth and Firestore record
 */
exports.createEmployee = async (req, res, next) => {
    try {
        const { name, email, phone, departmentId, role, salary, bankDetails, joiningDate } = req.body;

        // 1. Get Department Code
        const deptDoc = await db.collection('departments').doc(departmentId).get();
        if (!deptDoc.exists) throw new Error('Invalid Department ID');
        const deptCode = deptDoc.data().departmentCode;

        // 2. Generate ID and Password
        const employeeId = await generateEmployeeId(deptCode);
        const password = generateSecurePassword(name);

        // 3. Create Firebase Auth User
        let userRecord;
        try {
            userRecord = await admin.auth().createUser({
                email,
                password,
                displayName: name
            });
        } catch (authError) {
            if (authError.code === 'auth/email-already-in-use') {
                return res.status(400).json({ status: 'error', message: 'The email address is already in use by another account.' });
            }
            throw authError;
        }

        // 4. Set Claims
        await admin.auth().setCustomUserClaims(userRecord.uid, { role: role || 'employee', departmentId });

        // 6. Save to Firestore
        const employeeData = {
            uid: userRecord.uid,
            employeeId,
            name,
            email,
            phone,
            address: req.body.address || '',
            tempPassword: password, // Storing for admin visibility
            departmentId,
            role: role || "employee",
            salary,
            bankDetails: bankDetails || {},
            joiningDate: joiningDate || new Date().toISOString(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            status: "active"
        };
        await db.collection('users').doc(userRecord.uid).set(employeeData);

        res.status(201).json({
            status: 'success',
            data: { employeeId, email, tempPassword: password }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /managers
 * Create a manager (same as employee but with manager role)
 */
exports.createManager = async (req, res, next) => {
    req.body.role = 'manager';
    return exports.createEmployee(req, res, next);
};

/**
 * PUT /employees/:id
 * Update an existing employee record
 */
exports.updateEmployee = async (req, res, next) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        
        // 1. Update Firebase Authentication if email or password is changed
        const authUpdates = {};
        if (updateData.email) authUpdates.email = updateData.email;
        if (updateData.password) authUpdates.password = updateData.password;
        
        if (Object.keys(authUpdates).length > 0) {
            await admin.auth().updateUser(id, authUpdates);
        }

        // 2. Clean up data for Firestore
        const tempPassword = updateData.password; // Keep track for visibility
        delete updateData.employeeId;
        delete updateData.uid;
        delete updateData.createdAt;
        delete updateData.password; // Don't store plain password, store in tempPassword field

        await db.collection('users').doc(id).update({
            ...updateData,
            ...(tempPassword ? { tempPassword } : {}),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ status: 'success', message: 'Employee and Auth records updated successfully' });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /employees
 * List all employees
 */
exports.getAllEmployees = async (req, res, next) => {
    try {
        const snapshot = await db.collection('users').orderBy('createdAt', 'desc').get();
        const employees = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                uid: data.uid || doc.id // Fallback to doc.id if uid is missing (e.g. bulk upload)
            };
        });
        res.json({ status: 'success', data: employees });
    } catch (error) {
        next(error);
    }
};

/**
 * DELETE /employees/:id
 * Delete an employee from Auth and Firestore
 */
exports.deleteEmployee = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // 1. Delete from Firebase Authentication
        try {
            await admin.auth().deleteUser(id);
        } catch (authError) {
            console.warn(`Auth user not found or already deleted: ${id}`);
        }

        // 2. Delete from Firestore
        await db.collection('users').doc(id).delete();

        res.json({ status: 'success', message: 'Employee deleted successfully' });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /departments
 * List all departments
 */
exports.getAllDepartments = async (req, res, next) => {
    try {
        const snapshot = await db.collection('departments').get();
        const departments = snapshot.docs.map(doc => doc.data());
        res.json({ status: 'success', data: departments });
    } catch (error) {
        next(error);
    }
};
