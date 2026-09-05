const { admin, db } = require('../config/firebase');
const { generateEmployeeId } = require('../utils/idGenerator');
const { generateSecurePassword } = require('../utils/passwordGenerator');
const { sendEmail } = require('../utils/email');

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
        const { name, email, phone, departmentId, role, salary, bankDetails, joiningDate, password, send_email_now } = req.body;

        // 1. Get Department Code & Name (check departments collection first, then command_centers, then hrms/fallback)
        let deptCode = 'GEN';
        let deptName = 'General';

        if (departmentId === 'hrms') {
            deptCode = 'HRMS';
            deptName = 'HRMS Core';
        } else if (departmentId) {
            try {
                let deptDoc = await db.collection('departments').doc(departmentId).get();
                if (!deptDoc.exists) {
                    deptDoc = await db.collection('command_centers').doc(departmentId).get();
                }
                if (deptDoc.exists) {
                    const dData = deptDoc.data();
                    deptCode = dData.unitId || dData.departmentCode || (departmentId.length <= 4 ? departmentId.toUpperCase() : 'UNIT');
                    deptName = dData.name || dData.departmentName || 'General';
                } else if (departmentId.length <= 6) {
                    deptCode = departmentId.toUpperCase();
                    deptName = departmentId;
                }
            } catch (deptErr) {
                console.warn('[AdminController] Department resolution warning:', deptErr.message);
            }
        }

        // 2. Generate ID and Password
        const employeeId = await generateEmployeeId(deptCode);
        const finalPassword = password || generateSecurePassword(name);

        // 3. Create or Update Firebase Auth User
        let userRecord;
        try {
            userRecord = await admin.auth().createUser({
                email,
                password: finalPassword,
                displayName: name
            });
        } catch (authError) {
            const isEmailInUse = authError.code === 'auth/email-already-in-use' || 
                                 (authError.errorInfo && authError.errorInfo.code === 'auth/email-already-in-use') ||
                                 authError.message?.includes('already in use');
            if (isEmailInUse) {
                userRecord = await admin.auth().getUserByEmail(email);
                await admin.auth().updateUser(userRecord.uid, {
                    password: finalPassword,
                    displayName: name
                });
            } else {
                throw authError;
            }
        }

        // 4. Set Claims
        await admin.auth().setCustomUserClaims(userRecord.uid, { role: role || 'employee', departmentId });

        // 5. Email Dispatch Handling
        let inviteStatus = 'pending';
        let emailError = null;

        if (send_email_now) {
            try {
                const roleTitle = (role === 'manager') ? 'Manager' : (role === 'hrms' ? 'HRMS Administrator' : (role === 'superadmin' ? 'Super Admin' : (role === 'hradmin' ? 'HR Admin' : 'Employee')));
                const portalPage = 'login.html';
                const appUrl = process.env.APP_URL || 'http://127.0.0.1:5500/kylrx-enterprise-suite-main';
                
                await sendEmail({
                    to: email,
                    subject: `Welcome to HRFlow - Your ${roleTitle} Account & Credentials`,
                    html: `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #1e293b;">
                            <div style="background: linear-gradient(135deg, #1e40af, #3b82f6); padding: 20px; border-radius: 12px; text-align: center; color: #ffffff; margin-bottom: 24px;">
                                <h1 style="margin: 0; font-size: 24px; font-weight: 700;">Kylrx HRFlow Enterprise</h1>
                                <p style="margin: 6px 0 0 0; opacity: 0.9; font-size: 14px;">${roleTitle} Access Credentials</p>
                            </div>

                            <p style="font-size: 16px;">Dear <strong>${name}</strong>,</p>
                            <p style="font-size: 15px; color: #334155;">Your account has been officially created in the Kylrx Enterprise Management Portal with <strong>${roleTitle}</strong> access privileges.</p>

                            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; margin: 20px 0;">
                                <p style="margin: 6px 0;"><strong>Application URL:</strong> <a href="${appUrl}/login.html" style="color: #2563eb; font-weight: 600;">${appUrl}/login.html</a></p>
                                <p style="margin: 6px 0;"><strong>Employee ID:</strong> <code>${employeeId}</code></p>
                                <p style="margin: 6px 0;"><strong>Official Email:</strong> ${email}</p>
                                <p style="margin: 6px 0;"><strong>Department:</strong> ${deptName} (${deptCode})</p>
                                <p style="margin: 6px 0;"><strong>Role:</strong> ${roleTitle}</p>
                                <p style="margin: 6px 0;"><strong>Temporary Password:</strong> <code style="background-color: #e2e8f0; color: #0f172a; padding: 4px 8px; border-radius: 6px; font-weight: bold; font-family: monospace;">${finalPassword}</code></p>
                            </div>

                            <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 12px 16px; margin-bottom: 24px; border-radius: 4px;">
                                <p style="margin: 0; font-size: 13px; color: #1e40af;">🔒 <strong>Security Note:</strong> You will be prompted to change this temporary password upon your first sign-in.</p>
                            </div>

                            <div style="text-align: center; margin: 24px 0;">
                                <a href="${appUrl}/login.html" style="background-color: #2563eb; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px; display: inline-block;">Access Login Portal</a>
                            </div>

                            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
                            <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">Automated notification generated by Kylrx AI HRMS Enterprise Suite • <a href="${appUrl}/login.html" style="color: #64748b;">${appUrl}/login.html</a></p>
                        </div>
                    `
                });
                inviteStatus = 'sent';
            } catch (err) {
                console.warn('[AdminController] Email dispatch warning:', err.message);
                emailError = err.message;
                inviteStatus = 'pending';
            }
        }

        // 6. Save to Firestore
        const employeeData = {
            uid: userRecord.uid,
            employeeId,
            name,
            email,
            phone: phone || '',
            address: req.body.address || '',
            tempPassword: finalPassword, // Storing for admin visibility
            departmentId: departmentId || '',
            departmentName: deptName,
            departmentCode: deptCode,
            role: role || "employee",
            salary: salary || '',
            bankDetails: bankDetails || {},
            joiningDate: joiningDate || new Date().toISOString(),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            status: "active",
            must_change_password: true,
            is_temporary_password: true,
            invite_status: inviteStatus
        };
        await db.collection('users').doc(userRecord.uid).set(employeeData);

        res.status(201).json({
            status: 'success',
            data: { 
                employeeId, 
                email, 
                tempPassword: finalPassword, 
                invite_status: inviteStatus,
                ...(emailError ? { email_warning: emailError } : {})
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /employees/:id/trigger-invite
 * Trigger email dispatch retroactively
 */
exports.triggerEmailInvite = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userDoc = await db.collection('users').doc(id).get();
        if (!userDoc.exists) return res.status(404).json({ success: false, message: 'User not found' });
        
        const data = userDoc.data();
        const role = data.role || 'employee';
        const roleTitle = (role === 'manager') ? 'Manager' : (role === 'hrms' ? 'HRMS Administrator' : (role === 'superadmin' ? 'Super Admin' : (role === 'hradmin' ? 'HR Admin' : 'Employee')));
        const portalPage = 'login.html';
        const appUrl = process.env.APP_URL || 'http://127.0.0.1:5500/kylrx-enterprise-suite-main';
        
        await sendEmail({
            to: data.email,
            subject: `Welcome to HRFlow - Your ${roleTitle} Account & Credentials`,
            html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff; color: #1e293b;">
                    <div style="background: linear-gradient(135deg, #1e40af, #3b82f6); padding: 20px; border-radius: 12px; text-align: center; color: #ffffff; margin-bottom: 24px;">
                        <h1 style="margin: 0; font-size: 24px; font-weight: 700;">Kylrx HRFlow Enterprise</h1>
                        <p style="margin: 6px 0 0 0; opacity: 0.9; font-size: 14px;">${roleTitle} Access Credentials</p>
                    </div>

                    <p style="font-size: 16px;">Dear <strong>${data.name}</strong>,</p>
                    <p style="font-size: 15px; color: #334155;">Here are your access credentials for the Kylrx Enterprise Management Portal.</p>

                    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; margin: 20px 0;">
                        <p style="margin: 6px 0;"><strong>Application URL:</strong> <a href="${appUrl}/login.html" style="color: #2563eb; font-weight: 600;">${appUrl}/login.html</a></p>
                        <p style="margin: 6px 0;"><strong>Employee ID:</strong> <code>${data.employeeId || id}</code></p>
                        <p style="margin: 6px 0;"><strong>Official Email:</strong> ${data.email}</p>
                        <p style="margin: 6px 0;"><strong>Role:</strong> ${roleTitle}</p>
                        <p style="margin: 6px 0;"><strong>Temporary Password:</strong> <code style="background-color: #e2e8f0; color: #0f172a; padding: 4px 8px; border-radius: 6px; font-weight: bold; font-family: monospace;">${data.tempPassword || data.password || 'TemporaryPass@2026!'}</code></p>
                    </div>

                    <div style="text-align: center; margin: 24px 0;">
                        <a href="${appUrl}/login.html" style="background-color: #2563eb; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 15px; display: inline-block;">Access Login Portal</a>
                    </div>

                    <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
                    <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">Automated notification generated by Kylrx AI HRMS Enterprise Suite • <a href="${appUrl}/login.html" style="color: #64748b;">${appUrl}/login.html</a></p>
                </div>
            `
        });

        await db.collection('users').doc(id).update({
            invite_status: 'sent',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ status: 'success', message: 'Email dispatched successfully' });
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

/**
 * GET /analytics
 * Get aggregated workforce statistics
 */
exports.getAnalytics = async (req, res, next) => {
    try {
        const [empSnap, deptSnap] = await Promise.all([
            db.collection('users').get(),
            db.collection('departments').get()
        ]);

        const employees = empSnap.docs.map(doc => doc.data()).filter(u => (u.role || '').toLowerCase() !== 'admin');
        const departments = deptSnap.docs.map(doc => doc.data());

        // Calculate Stats
        const totalWorkforce = employees.length;
        const totalSalary = employees.reduce((acc, curr) => acc + (Number(curr.salary) || 0), 0);
        const avgSalary = totalWorkforce > 0 ? totalSalary / totalWorkforce : 0;

        // Department Distribution
        const deptCounts = {};
        departments.forEach(d => {
            const count = employees.filter(e => e.departmentId === d.departmentId).length;
            deptCounts[d.departmentName] = count;
        });

        // Salary by Department
        const deptSalaries = {};
        departments.forEach(d => {
            const empsInDept = employees.filter(e => e.departmentId === d.departmentId);
            const avg = empsInDept.length > 0 ? empsInDept.reduce((acc, curr) => acc + (Number(curr.salary) || 0), 0) / empsInDept.length : 0;
            deptSalaries[d.departmentName] = avg;
        });

        res.json({
            status: 'success',
            data: {
                stats: {
                    totalWorkforce,
                    avgSalary: Math.round(avgSalary),
                    growthRate: "+12.5%", // Mocked for now
                    retentionRate: "94.2%" // Mocked for now
                },
                charts: {
                    departmentDistribution: deptCounts,
                    salaryByDepartment: deptSalaries,
                    performance: [85, 90, 78, 82, 75, 88], // Mocked
                    hiringSources: [12, 19, 7, 5, 3] // Mocked
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * POST /sync-database
 * Synchronize and initialize core database collections
 */
exports.syncDatabase = async (req, res, next) => {
    try {
        logger.info('Database synchronization initiated by admin');
        
        // 1. Initialize Departments if empty
        const deptSnap = await db.collection('departments').get();
        if (deptSnap.empty) {
            const initialDepts = [
                { departmentId: 'DEP001', departmentName: 'Engineering', departmentCode: 'ENG', createdAt: admin.firestore.FieldValue.serverTimestamp() },
                { departmentId: 'DEP002', departmentName: 'Marketing', departmentCode: 'MKT', createdAt: admin.firestore.FieldValue.serverTimestamp() },
                { departmentId: 'DEP003', departmentName: 'Finance', departmentCode: 'FIN', createdAt: admin.firestore.FieldValue.serverTimestamp() },
                { departmentId: 'DEP004', departmentName: 'Human Resources', departmentCode: 'HR', createdAt: admin.firestore.FieldValue.serverTimestamp() }
            ];
            
            const batch = db.batch();
            initialDepts.forEach(d => {
                const ref = db.collection('departments').doc(d.departmentId);
                batch.set(ref, d);
            });
            await batch.commit();
        }

        // 2. Initialize Finance Metrics if empty
        const finSnap = await db.collection('financeMetrics').get();
        if (finSnap.empty) {
            const metrics = [
                { departmentId: 'engineering', payrollTotal: 450000, expenseTotal: 25000, revenue: 0, budgetLimit: 500000 },
                { departmentId: 'marketing', payrollTotal: 280000, expenseTotal: 150000, revenue: 800000, budgetLimit: 300000 },
                { departmentId: 'sales', payrollTotal: 320000, expenseTotal: 45000, revenue: 1200000, budgetLimit: 400000 }
            ];
            const batch = db.batch();
            metrics.forEach(m => {
                const ref = db.collection('financeMetrics').doc(m.departmentId);
                batch.set(ref, m);
            });
            await batch.commit();
        }

        // 3. Log System Event
        await db.collection('alertEvents').add({
            type: 'system',
            severity: 'info',
            message: 'Enterprise Database Synchronized via Backend API',
            departmentId: 'system',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({
            status: 'success',
            message: 'Enterprise database synchronized successfully',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        next(error);
    }
};

// ===============================
// Bank Transfer Flow for Admin
// ===============================
/**
 * POST /admin/bank/transfer
 * Handles bank transfer submission by admin.
 * Expected payload: { employeeId, bankName, accountNum, ifsc, amount }
 */
exports.transferBank = async (req, res, next) => {
    try {
        const { employeeId, bankName, accountNum, ifsc, amount, emailMessage } = req.body;
        if (!employeeId || !bankName || !accountNum || !ifsc || !amount) {
            return res.status(400).json({ success: false, error: 'Missing required bank details.' });
        }

        // Securely write bank verification details to Firestore via Admin SDK
        const verificationRef = db.collection('bank_verifications').doc(employeeId);
        await verificationRef.set({
            bankName,
            accountNum,
            routingCode: ifsc, // IFSC serves as the routingCode in Indian banking
            ifsc: ifsc,
            amount: Number(amount),
            employeeId,
            emailMessage: emailMessage || '',
            status: 'Under Review',
            submittedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // Add transaction entry to Audit Logs
        await db.collection('audit_logs').add({
            action: 'BANK_SUBMISSION',
            employeeId,
            performedBy: req.user.id || 'admin',
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            details: `Bank transfer of ₹${amount} submitted for review by ${req.user.name || 'Admin'}.${emailMessage ? ' Notification message drafted.' : ''}`
        });

        // Add real-time Admin Notification
        await db.collection('notifications').add({
            target: 'admin',
            message: `New bank transfer of ₹${amount} pending review for employee ${employeeId}.`,
            priority: 'high',
            read: false,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({ success: true, message: 'Bank transfer details submitted for verification.' });
    } catch (err) {
        console.error('[ADMIN] Bank Transfer error:', err);
        next(err);
    }
};
