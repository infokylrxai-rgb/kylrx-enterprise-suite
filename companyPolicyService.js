/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - COMPANY POLICY & COMPLIANCE SERVICE
 * ============================================================================
 * Strict Separation of Concerns (PRD Sections 1, 10, 13, 17, & 18):
 * Manages organization-wide policy definitions, targeting scope resolution,
 * digital signature recording with immutable audit metadata, and
 * turnaround SLA / overdue escalation tracking.
 *
 * Cloud Firestore Paths:
 *  - Master Policies:
 *    `organizations/{orgId}/policies/{policyCode}`
 *  - Digital Signatures:
 *    `organizations/{orgId}/policy_acknowledgements/{employeeId}_{policyCode}_{version}`
 * ============================================================================
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxCompanyPolicyService = factory();
        root.companyPolicyService = root.KylrxCompanyPolicyService;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Optional Firebase references (Browser or Node.js Admin)
    let firebaseDb = null;
    let serverTimestampFn = () => new Date().toISOString();

    try {
        if (typeof window !== 'undefined' && window.firebase && window.firebase.firestore) {
            firebaseDb = window.firebase.firestore();
            if (window.firebase.firestore.FieldValue) {
                serverTimestampFn = () => window.firebase.firestore.FieldValue.serverTimestamp();
            }
        }
    } catch (e) {
        // Standalone or browser test mode
    }

    // Node.js environment fallback
    if (!firebaseDb && typeof require === 'function') {
        try {
            const fbConfig = require('./config/firebase');
            if (fbConfig && fbConfig.db) {
                firebaseDb = fbConfig.db;
                if (fbConfig.admin && fbConfig.admin.firestore && fbConfig.admin.firestore.FieldValue) {
                    serverTimestampFn = () => fbConfig.admin.firestore.FieldValue.serverTimestamp();
                }
            }
        } catch (e) {
            // Safe fallback
        }
    }

    /**
     * In-Memory Ledger for low-latency client caching & offline execution
     */
    const _policyLedger = new Map(); // key: `${orgId}::${policyCode}`
    const _ackLedger = new Map();    // key: `${orgId}::${employeeId}_${policyCode}_${version}`

    /**
     * Helper to resolve arguments whether (arg1, orgId) or (orgId, arg1)
     */
    function resolveOrgAndItem(arg1, arg2, defaultOrg = 'org_kylrx_default') {
        if (typeof arg1 === 'string' && typeof arg2 === 'object' && arg2 !== null) {
            return { orgId: arg1, item: arg2 };
        }
        if (typeof arg1 === 'object' && arg1 !== null && typeof arg2 === 'string') {
            return { orgId: arg2, item: arg1 };
        }
        if (typeof arg1 === 'string' && (typeof arg2 === 'string' || arg2 === undefined)) {
            // e.g. getPolicy(policyCode, orgId) or (orgId, policyCode)
            if (arg2) {
                // If arg1 looks like an org prefix or arg2 does
                if (arg1.startsWith('org_') && !arg2.startsWith('org_')) {
                    return { orgId: arg1, id: arg2 };
                }
                return { orgId: arg2, id: arg1 };
            }
            return { orgId: defaultOrg, id: arg1 };
        }
        return { orgId: defaultOrg, item: arg1 || {} };
    }

    /**
     * Set external custom DB instance (useful for unit tests or mocks)
     */
    function setFirestoreDb(customDb) {
        firebaseDb = customDb;
    }

    /**
     * Clear all in-memory ledgers (useful for tests)
     */
    function clearLedger() {
        _policyLedger.clear();
        _ackLedger.clear();
    }

    /**
     * Save / Upsert a single Policy Document
     * Cloud Firestore Path: organizations/{orgId}/policies/{policyCode}
     */
    async function savePolicy(arg1, arg2) {
        const { orgId, item } = resolveOrgAndItem(arg1, arg2);
        const policyCode = (item.policyCode || item.Policy_Code || item.code || item.id || '').trim().toUpperCase();

        if (!policyCode) {
            throw new Error("Missing mandatory 'policyCode' attribute for policy persistence.");
        }

        const normalizedPolicy = {
            id: policyCode,
            policyCode: policyCode,
            policyName: item.policyName || item.Policy_Name || item.name || policyCode,
            version: String(item.version || item.Version || '1.0').trim(),
            policyType: item.policyType || item.Policy_Type || 'Operational',
            effectiveFrom: item.effectiveFrom || item.Effective_From || new Date().toISOString().substring(0, 10),
            acknowledgementRequired: item.acknowledgementRequired !== undefined ? Boolean(item.acknowledgementRequired) : (item.Acknowledgement_Required === 'Yes' || item.Acknowledgement_Required === true),
            acknowledgementDueDays: Number(item.acknowledgementDueDays || item.Acknowledgement_Due_Days || 14),
            appliesToCategoryCode: String(item.appliesToCategoryCode || item.Applies_To_Category_Code || 'ALL').trim().toUpperCase(),
            appliesToLocationCode: String(item.appliesToLocationCode || item.Applies_To_Location_Code || 'ALL').trim().toUpperCase(),
            documentUrl: item.documentUrl || item.Document_URL_or_File_Name || item.document_url || '',
            isActive: item.isActive !== undefined ? Boolean(item.isActive) : (item.Active !== 'No' && item.Active !== false),
            updatedAt: new Date().toISOString()
        };

        // 1. Update in-memory ledger
        const ledgerKey = `${orgId}::${policyCode}`;
        const existing = _policyLedger.get(ledgerKey);
        normalizedPolicy.createdAt = (existing && existing.createdAt) ? existing.createdAt : new Date().toISOString();
        _policyLedger.set(ledgerKey, normalizedPolicy);

        // 2. Persist to Cloud Firestore if connected
        if (firebaseDb && typeof firebaseDb.collection === 'function') {
            try {
                const docRef = firebaseDb.collection('organizations').doc(orgId).collection('policies').doc(policyCode);
                await docRef.set({
                    ...normalizedPolicy,
                    createdAt: (existing && existing.createdAt) ? existing.createdAt : serverTimestampFn(),
                    updatedAt: serverTimestampFn()
                }, { merge: true });
            } catch (fsErr) {
                console.warn(`[POLICY_SERVICE] Firestore sync warning for ${policyCode}:`, fsErr.message);
            }
        }

        return normalizedPolicy;
    }

    /**
     * Retrieve a Policy by Code
     */
    async function getPolicy(arg1, arg2) {
        const { orgId, id: policyCode } = resolveOrgAndItem(arg1, arg2);
        if (!policyCode) return null;

        const ledgerKey = `${orgId}::${policyCode.toUpperCase()}`;
        const cached = _policyLedger.get(ledgerKey);
        if (cached) return cached;

        if (firebaseDb && typeof firebaseDb.collection === 'function') {
            try {
                const docRef = firebaseDb.collection('organizations').doc(orgId).collection('policies').doc(policyCode.toUpperCase());
                const snap = await docRef.get();
                if (snap && snap.exists) {
                    const data = snap.data();
                    _policyLedger.set(ledgerKey, data);
                    return data;
                }
            } catch (fsErr) {
                console.warn(`[POLICY_SERVICE] Firestore get warning for ${policyCode}:`, fsErr.message);
            }
        }

        return null;
    }

    /**
     * List all Policies for an Organization with optional filtering
     */
    async function listPolicies(filters = {}, orgId = 'org_kylrx_default') {
        if (typeof filters === 'string') {
            const tmp = filters;
            filters = orgId && typeof orgId === 'object' ? orgId : {};
            orgId = tmp;
        }

        let policies = [];

        // 1. Check in-memory ledger
        const prefix = `${orgId}::`;
        for (const [key, val] of _policyLedger.entries()) {
            if (key.startsWith(prefix)) {
                policies.push(val);
            }
        }

        // 2. Fetch from Cloud Firestore if empty or explicitly queried
        if (policies.length === 0 && firebaseDb && typeof firebaseDb.collection === 'function') {
            try {
                const colRef = firebaseDb.collection('organizations').doc(orgId).collection('policies');
                const snap = await colRef.get();
                if (snap && !snap.empty) {
                    policies = [];
                    snap.forEach(docSnap => {
                        const data = docSnap.data();
                        _policyLedger.set(`${orgId}::${docSnap.id}`, data);
                        policies.push(data);
                    });
                }
            } catch (fsErr) {
                console.warn('[POLICY_SERVICE] Firestore list warning:', fsErr.message);
            }
        }

        // Apply filters
        if (filters.policyType) {
            policies = policies.filter(p => p.policyType.toLowerCase() === filters.policyType.toLowerCase());
        }
        if (filters.categoryCode && filters.categoryCode !== 'ALL') {
            policies = policies.filter(p => p.appliesToCategoryCode === 'ALL' || p.appliesToCategoryCode === filters.categoryCode.toUpperCase());
        }
        if (filters.locationCode && filters.locationCode !== 'ALL') {
            policies = policies.filter(p => p.appliesToLocationCode === 'ALL' || p.appliesToLocationCode === filters.locationCode.toUpperCase());
        }
        if (filters.activeOnly !== false) {
            policies = policies.filter(p => p.isActive === true);
        }

        return policies;
    }

    /**
     * Delete / Retire a Policy
     */
    async function deletePolicy(arg1, arg2) {
        const { orgId, id: policyCode } = resolveOrgAndItem(arg1, arg2);
        if (!policyCode) return false;

        const ledgerKey = `${orgId}::${policyCode.toUpperCase()}`;
        _policyLedger.delete(ledgerKey);

        if (firebaseDb && typeof firebaseDb.collection === 'function') {
            try {
                const docRef = firebaseDb.collection('organizations').doc(orgId).collection('policies').doc(policyCode.toUpperCase());
                await docRef.delete();
            } catch (fsErr) {
                console.warn(`[POLICY_SERVICE] Firestore delete warning for ${policyCode}:`, fsErr.message);
            }
        }

        return true;
    }

    /**
     * Bulk Ingest Policies from Parsed Records
     */
    async function ingestPolicyRecords(records = [], orgId = 'org_kylrx_default') {
        const results = {
            total: records.length,
            successCount: 0,
            failureCount: 0,
            errors: []
        };

        for (const rec of records) {
            try {
                await savePolicy(rec, orgId);
                results.successCount++;
            } catch (err) {
                results.failureCount++;
                results.errors.push(`Policy ${rec.policyCode || rec.Policy_Code}: ${err.message}`);
            }
        }

        return results;
    }

    /**
     * SCOPE RESOLUTION ENGINE (PRD Sections 13 & 17)
     * Matches active policies against an employee profile based on:
     * - (Applies_To_Category_Code == "ALL" || Applies_To_Category_Code == employee.employmentCategoryCode)
     * - (Applies_To_Location_Code == "ALL" || Applies_To_Location_Code == employee.locationCode)
     * - Active == true
     */
    function resolveApplicablePolicies(employee = {}, policies = null, orgId = 'org_kylrx_default') {
        const candidatePolicies = policies || Array.from(_policyLedger.values());

        const empCategory = (
            employee.employmentCategoryCode ||
            employee.categoryCode ||
            employee.employmentType ||
            employee.employeeType ||
            employee.Category_Code ||
            ''
        ).trim().toUpperCase();

        const empLocation = (
            employee.locationCode ||
            employee.location ||
            employee.branchCode ||
            employee.Location_Code ||
            ''
        ).trim().toUpperCase();

        return candidatePolicies.filter(policy => {
            if (policy.isActive === false) return false;

            const targetCategory = (policy.appliesToCategoryCode || 'ALL').trim().toUpperCase();
            const categoryMatch = targetCategory === 'ALL' || (empCategory !== '' && targetCategory === empCategory);

            const targetLocation = (policy.appliesToLocationCode || 'ALL').trim().toUpperCase();
            const locationMatch = targetLocation === 'ALL' || (empLocation !== '' && targetLocation === empLocation);

            return categoryMatch && locationMatch;
        });
    }

    /**
     * OVERDUE POLICY TRACKER & DEADLINE CALCULATION (PRD Sections 11 & 18)
     * Computes the turnaround sign-off deadline:
     * dueDate = Math.max(policyEffectiveDate, employeeJoiningDate) + (Acknowledgement_Due_Days * 86400000)
     */
    function calculatePolicyDueDate(policy = {}, employee = {}) {
        const policyEffectiveMs = new Date(policy.effectiveFrom || '2026-01-01').getTime();
        const employeeJoiningMs = new Date(
            employee.dateOfJoining ||
            employee.joiningDate ||
            employee.doj ||
            employee.Date_of_Joining ||
            employee.createdAt ||
            policy.effectiveFrom ||
            '2026-01-01'
        ).getTime();

        const validEffective = !isNaN(policyEffectiveMs) ? policyEffectiveMs : Date.now();
        const validJoining = !isNaN(employeeJoiningMs) ? employeeJoiningMs : validEffective;
        const baseDateMs = Math.max(validEffective, validJoining);

        const dueDays = Number(policy.acknowledgementDueDays !== undefined ? policy.acknowledgementDueDays : 14);
        const dueMs = baseDateMs + (dueDays * 86400000);

        return new Date(dueMs);
    }

    /**
     * Compute Compliance Status for an individual policy and employee
     * Returns: 'COMPLIANT' | 'OVERDUE' | 'PENDING' | 'NOT_REQUIRED'
     */
    function computeComplianceStatus(policy = {}, employee = {}, acknowledgementRecord = null, currentDate = new Date()) {
        if (!policy.acknowledgementRequired) {
            return {
                status: 'NOT_REQUIRED',
                isCompliant: true,
                isOverdue: false,
                isPending: false,
                dueDate: null,
                acknowledgedAt: acknowledgementRecord ? acknowledgementRecord.acknowledgedAt : null
            };
        }

        if (acknowledgementRecord && (acknowledgementRecord.acknowledgedAt || acknowledgementRecord.status === 'acknowledged')) {
            return {
                status: 'COMPLIANT',
                isCompliant: true,
                isOverdue: false,
                isPending: false,
                dueDate: calculatePolicyDueDate(policy, employee),
                acknowledgedAt: acknowledgementRecord.acknowledgedAt
            };
        }

        const dueDate = calculatePolicyDueDate(policy, employee);
        const currTime = currentDate instanceof Date ? currentDate.getTime() : new Date(currentDate).getTime();
        const isOverdue = currTime > dueDate.getTime();

        return {
            status: isOverdue ? 'OVERDUE' : 'PENDING',
            isCompliant: false,
            isOverdue: isOverdue,
            isPending: !isOverdue,
            dueDate,
            daysOverdue: isOverdue ? Math.floor((currTime - dueDate.getTime()) / 86400000) : 0,
            daysRemaining: !isOverdue ? Math.ceil((dueDate.getTime() - currTime) / 86400000) : 0,
            acknowledgedAt: null
        };
    }

    /**
     * DIGITAL SIGN-OFF & AUDIT SIGNATURE CAPTURE (PRD Sections 13 & 17)
     * Captures immutable audit metadata:
     * {
     *   "policyCode": policyCode,
     *   "version": version,
     *   "employeeId": employeeId,
     *   "acknowledgedAt": serverTimestamp(),
     *   "ipAddress": clientIp,
     *   "userAgent": navigator.userAgent
     * }
     * Path: organizations/{orgId}/policy_acknowledgements/{employeeId}_{policyCode}_{version}
     */
    async function recordDigitalAcknowledgement(payload = {}, orgId = 'org_kylrx_default') {
        const policyCode = String(payload.policyCode || '').trim().toUpperCase();
        const version = String(payload.version || '1.0').trim();
        const employeeId = String(payload.employeeId || '').trim();

        if (!policyCode || !employeeId) {
            throw new Error("Both 'policyCode' and 'employeeId' are mandatory to record a digital signature.");
        }

        const ackDocId = `${employeeId}_${policyCode}_${version}`;
        const ipAddress = payload.ipAddress || payload.clientIp || '127.0.0.1';
        const userAgent = payload.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : 'Kylrx-Audit-Client/ES6');
        // Prefer caller-supplied timestamp (already computed at click-time) for consistency with hash
        const acknowledgedAt = payload.acknowledgedAt || new Date().toISOString();
        // Tamper-evident SHA-256 hash supplied by modal (null if SubtleCrypto unavailable)
        const auditIntegrityHash = payload.auditIntegrityHash || null;

        const auditRecord = {
            id: ackDocId,
            docId: ackDocId,
            policyCode,
            version,
            employeeId,
            employeeName: payload.employeeName || '',
            acknowledgedAt,
            ipAddress,
            userAgent,
            auditIntegrityHash,
            status: 'COMPLIANT',
            orgId
        };

        // 1. Store in memory
        const ledgerKey = `${orgId}::${ackDocId}`;
        _ackLedger.set(ledgerKey, auditRecord);

        // 2. Persist to Cloud Firestore
        if (firebaseDb && typeof firebaseDb.collection === 'function') {
            try {
                const docRef = firebaseDb.collection('organizations').doc(orgId).collection('policy_acknowledgements').doc(ackDocId);
                await docRef.set({
                    policyCode,
                    version,
                    employeeId,
                    employeeName: payload.employeeName || '',
                    acknowledgedAt: serverTimestampFn(),
                    ipAddress,
                    userAgent,
                    auditIntegrityHash,
                    status: 'COMPLIANT'
                }, { merge: true });
            } catch (fsErr) {
                console.warn(`[POLICY_SERVICE] Firestore ack sync warning for ${ackDocId}:`, fsErr.message);
            }
        }

        return {
            success: true,
            ackDocId,
            auditRecord
        };
    }

    /**
     * Retrieve Digital Acknowledgement for an Employee and Policy
     */
    async function getAcknowledgement(employeeId, policyCode, version = '1.0', orgId = 'org_kylrx_default') {
        const ackDocId = `${employeeId}_${policyCode.toUpperCase()}_${version}`;
        const ledgerKey = `${orgId}::${ackDocId}`;

        const cached = _ackLedger.get(ledgerKey);
        if (cached) return cached;

        if (firebaseDb && typeof firebaseDb.collection === 'function') {
            try {
                const docRef = firebaseDb.collection('organizations').doc(orgId).collection('policy_acknowledgements').doc(ackDocId);
                const snap = await docRef.get();
                if (snap && snap.exists) {
                    const data = snap.data();
                    _ackLedger.set(ledgerKey, data);
                    return data;
                }
            } catch (fsErr) {
                console.warn(`[POLICY_SERVICE] Firestore get ack warning:`, fsErr.message);
            }
        }

        return null;
    }

    /**
     * REAL-TIME COMPLIANCE PULSE & STATISTICAL AGGREGATION
     * Computes percentage of compliant vs pending vs overdue employees
     */
    function getCompliancePulse(policies = [], employees = [], acknowledgements = [], currentDate = new Date()) {
        const ackMap = new Map();
        if (Array.isArray(acknowledgements)) {
            acknowledgements.forEach(a => {
                const key = `${a.employeeId}_${a.policyCode}_${a.version || '1.0'}`;
                ackMap.set(key, a);
            });
        }

        let totalRequiredAssignments = 0;
        let totalCompliant = 0;
        let totalPending = 0;
        let totalOverdue = 0;
        const overdueRecords = [];
        const perPolicyStats = {};

        policies.forEach(policy => {
            if (!policy.isActive) return;
            const pCode = policy.policyCode;
            perPolicyStats[pCode] = {
                policyCode: pCode,
                policyName: policy.policyName,
                policyType: policy.policyType,
                version: policy.version,
                assignedCount: 0,
                compliantCount: 0,
                pendingCount: 0,
                overdueCount: 0,
                compliancePercentage: 100
            };
        });

        employees.forEach(emp => {
            const empId = emp.employeeId || emp.id;
            const applicable = resolveApplicablePolicies(emp, policies);

            applicable.forEach(policy => {
                if (!policy.acknowledgementRequired) return;

                const pCode = policy.policyCode;
                totalRequiredAssignments++;
                if (perPolicyStats[pCode]) perPolicyStats[pCode].assignedCount++;

                const ackKey = `${empId}_${pCode}_${policy.version || '1.0'}`;
                const ack = ackMap.get(ackKey) || _ackLedger.get(`org_kylrx_default::${ackKey}`);

                const compStatus = computeComplianceStatus(policy, emp, ack, currentDate);

                if (compStatus.isCompliant) {
                    totalCompliant++;
                    if (perPolicyStats[pCode]) perPolicyStats[pCode].compliantCount++;
                } else if (compStatus.isOverdue) {
                    totalOverdue++;
                    if (perPolicyStats[pCode]) perPolicyStats[pCode].overdueCount++;
                    overdueRecords.push({
                        employeeId: empId,
                        employeeName: emp.employeeName || emp.name || 'Staff Member',
                        department: emp.department || 'Operations',
                        reportingManagerId: emp.reportingManagerId || emp.managerId || '',
                        policyCode: pCode,
                        policyName: policy.policyName,
                        policyType: policy.policyType,
                        version: policy.version,
                        dueDate: compStatus.dueDate,
                        daysOverdue: compStatus.daysOverdue
                    });
                } else {
                    totalPending++;
                    if (perPolicyStats[pCode]) perPolicyStats[pCode].pendingCount++;
                }
            });
        });

        Object.values(perPolicyStats).forEach(stat => {
            stat.compliancePercentage = stat.assignedCount > 0
                ? Math.round((stat.compliantCount / stat.assignedCount) * 100)
                : 100;
        });

        const overallPercentage = totalRequiredAssignments > 0
            ? Math.round((totalCompliant / totalRequiredAssignments) * 100)
            : 100;

        return {
            totalRequiredAssignments,
            totalCompliant,
            totalPending,
            totalOverdue,
            compliancePercentage: overallPercentage,
            perPolicyStats,
            overdueRecords
        };
    }

    /**
     * ALERT GENERATOR FOR MANAGER & HR MONITORS (PRD Sections 11 & 18)
     */
    function generateOverdueAlertCards(overdueRecords = []) {
        return overdueRecords.map((item, idx) => ({
            alertId: `ALT-POL-OVD-${item.employeeId}-${item.policyCode}-${Date.now()}-${idx}`,
            eventKey: 'EVT_POLICY_ACKNOWLEDGEMENT_OVERDUE',
            title: `Compliance Escalation: ${item.policyName} Overdue`,
            message: `${item.employeeName} (${item.employeeId}) has not acknowledged "${item.policyName}" (v${item.version}). Signature was due on ${item.dueDate.toISOString().substring(0, 10)} (${item.daysOverdue} days overdue).`,
            severity: item.daysOverdue > 7 ? 'CRITICAL' : 'WARNING',
            category: 'Statutory Compliance',
            employeeId: item.employeeId,
            employeeName: item.employeeName,
            policyCode: item.policyCode,
            policyName: item.policyName,
            daysOverdue: item.daysOverdue,
            routing: {
                targetManagerId: item.reportingManagerId,
                targetDepartment: item.department,
                channels: ['in_app', 'email']
            },
            actionRequired: 'Follow up with employee or issue administrative reminder.',
            createdAt: new Date().toISOString()
        }));
    }

    return {
        savePolicy,
        getPolicy,
        listPolicies,
        deletePolicy,
        ingestPolicyRecords,
        resolveApplicablePolicies,
        calculatePolicyDueDate,
        computeComplianceStatus,
        recordDigitalAcknowledgement,
        getAcknowledgement,
        getCompliancePulse,
        generateOverdueAlertCards,
        setFirestoreDb,
        clearLedger
    };
}));
