/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - SUB-DEPARTMENT SERVICE & CASCADING HIERARCHY
 * ============================================================================
 * 
 * Manages Sub-Department schema, Firestore CRUD persistence, and cascading
 * dropdown listeners matching PRD Sections 1, 10, & 13:
 * 
 * 1. Cloud Firestore Data Architecture:
 *    - Path: organizations/{orgId}/sub_departments/{subDepartmentCode}
 *    - Document Schema:
 *      {
 *        "subDepartmentCode": "SUB_ENG_API",
 *        "subDepartmentName": "Platform & API Services",
 *        "headEmployeeId": "EMP0007",
 *        "headEmployeeName": "Aditya Rao",
 *        "costCenterCode": "CC_ENG_DEV",
 *        "isActive": true,
 *        "createdAt": "serverTimestamp()",
 *        "updatedAt": "serverTimestamp()"
 *      }
 * 
 * 2. Cascading Hierarchy Integration (PRD Sections 10 & 13):
 *    - Filters and renders active Sub-Departments ('Active' == 'Yes') when Department
 *      or Cost Center is selected.
 *    - Automatically links / sets Cost_Center_Code when Sub-Department is chosen.
 * 
 * 3. Administrative Management & Autocomplete:
 *    - Head Lead selection via active employee directory.
 *    - Cost Center foreign key selection via active Cost Centers.
 *    - In-memory cache for ultra-fast UI rendering & offline resilience.
 * 
 * @version 2.0.0
 * @author Senior Frontend & Firebase Developer
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxSubDepartmentService = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // Default enterprise Sub-Departments seeded with active status and linked Cost Centers
    const DEFAULT_SUB_DEPARTMENTS = [
        {
            subDepartmentCode: 'SUB_QA_AUTO',
            subDepartmentName: 'QA & Automation',
            costCenterCode: 'CC_ENG_01',
            departmentCode: 'DEPT_ENG',
            sameAsDeptHead: true,
            inheritedFromDeptHead: true,
            subDepartmentHeadEmployeeId: 'EMP0002',
            subDepartmentHeadName: 'Vikram Malhotra',
            headEmployeeId: 'EMP0002',
            headEmployeeName: 'Vikram Malhotra',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'ENG-FRONTEND',
            subDepartmentName: 'Frontend Platform & UI',
            headEmployeeId: 'EMP0006',
            headEmployeeName: 'Rohit Verma',
            costCenterCode: 'CC-ENG-101',
            departmentCode: 'ENG',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'ENG-BACKEND',
            subDepartmentName: 'Cloud Architecture & APIs',
            headEmployeeId: 'EMP0001',
            headEmployeeName: 'Devendra Sharma',
            costCenterCode: 'CC-ENG-101',
            departmentCode: 'ENG',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'ENG-QA',
            subDepartmentName: 'Quality Assurance & Testing',
            headEmployeeId: 'EMP0006',
            headEmployeeName: 'Rohit Verma',
            costCenterCode: 'CC-ENG-101',
            departmentCode: 'ENG',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'ENG-DEVOPS',
            subDepartmentName: 'DevOps & SRE Systems',
            headEmployeeId: 'EMP0001',
            headEmployeeName: 'Devendra Sharma',
            costCenterCode: 'CC-ENG-101',
            departmentCode: 'ENG',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'AI-MODELS',
            subDepartmentName: 'Foundation Models & Training',
            headEmployeeId: 'EMP0007',
            headEmployeeName: 'Dr. Kumar Mangalam',
            costCenterCode: 'CC-AI-102',
            departmentCode: 'AI-LABS',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'AI-ENG',
            subDepartmentName: 'MLOps & Inference Infrastructure',
            headEmployeeId: 'EMP0007',
            headEmployeeName: 'Dr. Kumar Mangalam',
            costCenterCode: 'CC-AI-102',
            departmentCode: 'AI-LABS',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'AI-RESEARCH',
            subDepartmentName: 'Generative AI & Agentic Systems',
            headEmployeeId: 'EMP0007',
            headEmployeeName: 'Dr. Kumar Mangalam',
            costCenterCode: 'CC-AI-102',
            departmentCode: 'AI-LABS',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'HR-COMPLIANCE',
            subDepartmentName: 'Statutory Compliance & ECR',
            headEmployeeId: 'EMP0003',
            headEmployeeName: 'Ananya Roy',
            costCenterCode: 'CC-HR-201',
            departmentCode: 'HR',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'HR-OPS',
            subDepartmentName: 'People Operations & Talent Acquisition',
            headEmployeeId: 'EMP0003',
            headEmployeeName: 'Ananya Roy',
            costCenterCode: 'CC-HR-201',
            departmentCode: 'HR',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'HR-PAYROLL',
            subDepartmentName: 'Compensation, Benefits & Payroll',
            headEmployeeId: 'EMP0003',
            headEmployeeName: 'Ananya Roy',
            costCenterCode: 'CC-HR-201',
            departmentCode: 'HR',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'FIN-PAYROLL',
            subDepartmentName: 'Payroll Disbursement & Banking',
            headEmployeeId: 'EMP0004',
            headEmployeeName: 'Rajesh Raman',
            costCenterCode: 'CC-FIN-301',
            departmentCode: 'FIN',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'FIN-TAX',
            subDepartmentName: 'Treasury, Audit & Tax Compliance',
            headEmployeeId: 'EMP0004',
            headEmployeeName: 'Rajesh Raman',
            costCenterCode: 'CC-FIN-301',
            departmentCode: 'FIN',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'FIN-ACCOUNTS',
            subDepartmentName: 'General Ledger & Financial Control',
            headEmployeeId: 'EMP0004',
            headEmployeeName: 'Rajesh Raman',
            costCenterCode: 'CC-FIN-301',
            departmentCode: 'FIN',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'CYBER-SEC',
            subDepartmentName: 'SOC, Threat Detection & Compliance',
            headEmployeeId: 'EMP0001',
            headEmployeeName: 'Devendra Sharma',
            costCenterCode: 'CC-ENG-101',
            departmentCode: 'CYBER',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'CYBER-IAM',
            subDepartmentName: 'Identity Governance & Access Mgmt',
            headEmployeeId: 'EMP0001',
            headEmployeeName: 'Devendra Sharma',
            costCenterCode: 'CC-ENG-101',
            departmentCode: 'CYBER',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'HRMS-CORE',
            subDepartmentName: 'HRMS Core Architecture & Security',
            headEmployeeId: 'EMP0001',
            headEmployeeName: 'Devendra Sharma',
            costCenterCode: 'CC-ENG-101',
            departmentCode: 'HRMS',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'OPS-SUPPORT',
            subDepartmentName: 'Enterprise Client Operations',
            headEmployeeId: 'EMP0005',
            headEmployeeName: 'Sneha Sen',
            costCenterCode: 'CC-OPS-401',
            departmentCode: 'OPS',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            subDepartmentCode: 'SUB_ENG_API',
            subDepartmentName: 'Platform & API Services',
            headEmployeeId: 'EMP0007',
            headEmployeeName: 'Aditya Rao',
            costCenterCode: 'CC_ENG_DEV',
            departmentCode: 'ENG',
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        }
    ];

    // Seeded active employees for Sub-Department Head selection
    const ACTIVE_EMPLOYEES_MASTER = [
        { employeeId: 'EMP0001', fullName: 'Devendra Sharma', email: 'devendra@kylrx.ai', designation: 'Chief Technology Officer (CTO)', department: 'Engineering', active: true },
        { employeeId: 'EMP0002', fullName: 'Vikram Malhotra', email: 'vikram@kylrx.ai', designation: 'Chief Executive Officer (CEO)', department: 'Executive', active: true },
        { employeeId: 'EMP0003', fullName: 'Ananya Roy', email: 'ananya@kylrx.ai', designation: 'Chief People Officer (CPO)', department: 'Human Resources', active: true },
        { employeeId: 'EMP0004', fullName: 'Rajesh Raman', email: 'rajesh@kylrx.ai', designation: 'Chief Financial Officer (CFO)', department: 'Finance', active: true },
        { employeeId: 'EMP0005', fullName: 'Sneha Sen', email: 'sneha@kylrx.ai', designation: 'EVP Global Operations', department: 'Operations', active: true },
        { employeeId: 'EMP0006', fullName: 'Rohit Verma', email: 'rohit@kylrx.ai', designation: 'Director of Product Engineering', department: 'Engineering', active: true },
        { employeeId: 'EMP0007', fullName: 'Aditya Rao', email: 'aditya@kylrx.ai', designation: 'Lead Platform Architect', department: 'Engineering', active: true }
    ];

    // Canonical Department Registry with designated Department Heads (PRD §§1, 10, & 13)
    const DEFAULT_DEPARTMENTS = [
        {
            departmentCode: 'DEPT_ENG',
            departmentName: 'QA & Engineering',
            departmentHeadEmployeeId: 'EMP0002',
            departmentHeadName: 'Vikram Malhotra',
            costCenterCode: 'CC_ENG_01'
        },
        {
            departmentCode: 'ENG',
            departmentName: 'Engineering & Architecture',
            departmentHeadEmployeeId: 'EMP0001',
            departmentHeadName: 'Devendra Sharma',
            costCenterCode: 'CC-ENG-101'
        },
        {
            departmentCode: 'AI-LABS',
            departmentName: 'AI Research & Model Engineering',
            departmentHeadEmployeeId: 'EMP0007',
            departmentHeadName: 'Dr. Kumar Mangalam',
            costCenterCode: 'CC-AI-102'
        },
        {
            departmentCode: 'HR',
            departmentName: 'Human Resources & Payroll',
            departmentHeadEmployeeId: 'EMP0003',
            departmentHeadName: 'Ananya Roy',
            costCenterCode: 'CC-HR-201'
        },
        {
            departmentCode: 'FIN',
            departmentName: 'Finance & Accounts',
            departmentHeadEmployeeId: 'EMP0004',
            departmentHeadName: 'Rajesh Raman',
            costCenterCode: 'CC-FIN-301'
        },
        {
            departmentCode: 'OPS',
            departmentName: 'Global Operations',
            departmentHeadEmployeeId: 'EMP0005',
            departmentHeadName: 'Sneha Sen',
            costCenterCode: 'CC-OPS-401'
        },
        {
            departmentCode: 'CYBER',
            departmentName: 'Cybersecurity & Defense',
            departmentHeadEmployeeId: 'EMP0001',
            departmentHeadName: 'Devendra Sharma',
            costCenterCode: 'CC-ENG-101'
        }
    ];

    /**
     * Checks if a Sub-Department head employee field indicates "Same as Department Head"
     */
    function isSameAsDeptHeadValue(val) {
        if (val === undefined || val === null) return true;
        const clean = String(val).trim().toLowerCase();
        if (!clean) return true;
        return (
            clean === 'same as department head' ||
            clean === 'same as dept head' ||
            clean === 'same_as_department_head' ||
            clean === 'same as dept. head' ||
            clean === 'dept_head' ||
            clean === 'dept head' ||
            clean === 'inherit' ||
            clean === 'inherited' ||
            clean === 'same' ||
            clean === 'true'
        );
    }

    /**
     * Resolves the parent Department and its designated Department Head
     */
    function resolveDepartmentForSubDept(subDeptCode, costCenterCode, explicitDeptCode = null) {
        const cleanSubCode = String(subDeptCode || '').trim().toUpperCase();
        const cleanCc = String(costCenterCode || '').trim().toUpperCase();
        const cleanExplicit = explicitDeptCode ? String(explicitDeptCode).trim().toUpperCase() : '';

        if (cleanExplicit) {
            const found = DEFAULT_DEPARTMENTS.find(d => d.departmentCode === cleanExplicit);
            if (found) return found;
            return {
                departmentCode: cleanExplicit,
                departmentName: `${cleanExplicit} Department`,
                departmentHeadEmployeeId: 'EMP0002',
                departmentHeadName: 'Vikram Malhotra',
                costCenterCode: cleanCc || 'CC_ENG_01'
            };
        }

        if (cleanCc) {
            const byCc = DEFAULT_DEPARTMENTS.find(d => d.costCenterCode === cleanCc);
            if (byCc) return byCc;
            if (cleanCc === 'CC_ENG_DEV') {
                return {
                    departmentCode: 'ENG',
                    departmentName: 'Platform & Software Engineering',
                    departmentHeadEmployeeId: 'EMP0002',
                    departmentHeadName: 'Vikram Malhotra',
                    costCenterCode: cleanCc
                };
            }
        }

        if (cleanSubCode.startsWith('ENG') || cleanSubCode.includes('ENG')) {
            return DEFAULT_DEPARTMENTS.find(d => d.departmentCode === 'ENG');
        }
        if (cleanSubCode.startsWith('HR')) {
            return DEFAULT_DEPARTMENTS.find(d => d.departmentCode === 'HR');
        }
        if (cleanSubCode.startsWith('FIN')) {
            return DEFAULT_DEPARTMENTS.find(d => d.departmentCode === 'FIN');
        }
        if (cleanSubCode.startsWith('AI')) {
            return DEFAULT_DEPARTMENTS.find(d => d.departmentCode === 'AI-LABS');
        }

        return DEFAULT_DEPARTMENTS[0];
    }

    // In-memory store
    const subDepartmentsMap = new Map();
    const activeEmployeesMap = new Map();

    function initDefaults() {
        subDepartmentsMap.clear();
        DEFAULT_SUB_DEPARTMENTS.forEach(sub => {
            subDepartmentsMap.set(sub.subDepartmentCode.toUpperCase(), { ...sub });
        });

        activeEmployeesMap.clear();
        ACTIVE_EMPLOYEES_MASTER.forEach(emp => {
            activeEmployeesMap.set(emp.employeeId.toUpperCase(), { ...emp });
        });
    }
    initDefaults();

    /**
     * Resolves default organization ID
     */
    function getDefaultOrgId() {
        if (typeof window !== 'undefined' && window.state && window.state.orgId) {
            return window.state.orgId;
        }
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem('orgId') || 'org_kylrx';
        }
        return 'org_kylrx';
    }

    /**
     * Generates Cloud Firestore path for a Sub-Department document
     * Target: organizations/{orgId}/sub_departments/{subDepartmentCode}
     */
    function getFirestorePath(subDepartmentCode, orgId = getDefaultOrgId()) {
        const cleanCode = String(subDepartmentCode || '').trim().toUpperCase();
        return `organizations/${orgId}/sub_departments/${cleanCode}`;
    }

    /**
     * Resolves head employee name by ID
     */
    function getHeadDetailsById(employeeId) {
        if (!employeeId) return { name: '', designation: '' };
        const cleanId = String(employeeId).trim().toUpperCase();
        const found = activeEmployeesMap.get(cleanId);
        if (found) {
            return {
                name: found.fullName || found.name || '',
                designation: found.designation || ''
            };
        }
        return { name: '', designation: '' };
    }

    /**
     * Validates Sub-Department Code
     */
    function validateSubDepartmentCode(code) {
        if (!code || typeof code !== 'string') return false;
        return /^[A-Za-z0-9_-]{2,30}$/.test(code.trim());
    }

    /**
     * READ: Returns all Sub-Departments in cache
     */
    function getAllSubDepartments() {
        return Array.from(subDepartmentsMap.values());
    }

    /**
     * READ: Returns only active Sub-Departments ('Active' == 'Yes' / isActive === true)
     */
    function getActiveSubDepartments() {
        return Array.from(subDepartmentsMap.values()).filter(s => s.isActive === true);
    }

    /**
     * READ: Returns single Sub-Department by Code
     */
    function getSubDepartment(subDepartmentCode) {
        if (!subDepartmentCode) return null;
        return subDepartmentsMap.get(String(subDepartmentCode).trim().toUpperCase()) || null;
    }

    /**
     * CASCADING FILTER: Filters Sub-Departments by Department and/or Cost Center
     * PRD Sections 10 & 13
     */
    function filterSubDepartments({ departmentCode = '', costCenterCode = '', activeOnly = true, subDepartments = null } = {}) {
        let list = Array.isArray(subDepartments)
            ? (activeOnly ? subDepartments.filter(s => s.isActive !== false && s.Active !== 'No') : [...subDepartments])
            : (activeOnly ? getActiveSubDepartments() : getAllSubDepartments());

        const cleanDept = departmentCode ? String(departmentCode).trim().toUpperCase() : '';
        const cleanCc = costCenterCode ? String(costCenterCode).trim().toUpperCase() : '';

        if (cleanDept) {
            list = list.filter(sub => {
                const subDeptCode = (sub.departmentCode || '').toUpperCase();
                const subCode = (sub.subDepartmentCode || sub['Sub-Department_Code'] || sub.code || '').toUpperCase();
                // Match explicit departmentCode or prefix convention (e.g. ENG-FRONTEND matches ENG)
                const matchesDeptCode = Boolean(subDeptCode) && (
                    subDeptCode === cleanDept ||
                    subDeptCode.includes(cleanDept) ||
                    cleanDept.includes(subDeptCode)
                );
                const matchesCodePrefix = subCode.startsWith(cleanDept + '-') ||
                                          subCode.startsWith(cleanDept + '_') ||
                                          subCode === cleanDept;
                return matchesDeptCode || matchesCodePrefix;
            });
        }

        if (cleanCc) {
            list = list.filter(sub => {
                const subCc = (sub.costCenterCode || sub['Cost_Center_Code'] || '').toUpperCase();
                return subCc === cleanCc;
            });
        }

        return list;
    }

    /**
     * CREATE: Adds a new Sub-Department and persists to Cloud Firestore
     */
    async function createSubDepartment(subDeptData, orgId = getDefaultOrgId()) {
        const rawCode = subDeptData.subDepartmentCode || subDeptData['Sub-Department_Code'] || subDeptData.code;
        const rawName = subDeptData.subDepartmentName || subDeptData['Sub-Department_Name'] || subDeptData.name;
        const rawHead = subDeptData.subDepartmentHeadEmployeeId || subDeptData.headEmployeeId || subDeptData['Sub-Department_Head_Employee_ID'] || subDeptData.headId;
        const rawCc = subDeptData.costCenterCode || subDeptData['Cost_Center_Code'] || subDeptData.ccCode;
        const rawActive = subDeptData.isActive !== undefined ? subDeptData.isActive : subDeptData.Active;

        if (!rawCode) throw new Error("Sub-Department Code ('Sub-Department_Code') is required.");
        if (!rawName) throw new Error("Sub-Department Name ('Sub-Department_Name') is required.");
        if (!rawCc) throw new Error("Cost Center Code ('Cost_Center_Code') is required.");

        const cleanCode = String(rawCode).trim().toUpperCase().replace(/\s+/g, '_');
        const cleanName = String(rawName).trim();
        const cleanCc = String(rawCc).trim().toUpperCase().replace(/\s+/g, '_');

        let isActive = true;
        if (typeof rawActive === 'boolean') {
            isActive = rawActive;
        } else if (rawActive !== undefined && rawActive !== null) {
            const str = String(rawActive).trim().toLowerCase();
            isActive = (str === 'yes' || str === 'true' || str === 'y' || str === '1');
        }

        // Inheritance evaluation: "Same as Department Head"
        const isExplicitFlag = subDeptData.sameAsDeptHead !== undefined ? Boolean(subDeptData.sameAsDeptHead)
            : (subDeptData.inheritedFromDeptHead !== undefined ? Boolean(subDeptData.inheritedFromDeptHead) : null);

        const isSame = isExplicitFlag !== null
            ? isExplicitFlag
            : isSameAsDeptHeadValue(rawHead);

        // Resolve parent Department
        const resolvedDept = resolveDepartmentForSubDept(cleanCode, cleanCc, subDeptData.departmentCode);
        const departmentCode = subDeptData.departmentCode || resolvedDept.departmentCode;

        let finalHeadId = '';
        let finalHeadName = '';

        if (isSame) {
            finalHeadId = resolvedDept.departmentHeadEmployeeId;
            finalHeadName = resolvedDept.departmentHeadName;
        } else {
            finalHeadId = rawHead ? String(rawHead).trim().toUpperCase() : '';
            const headDetails = getHeadDetailsById(finalHeadId);
            finalHeadName = subDeptData.subDepartmentHeadName || subDeptData.headEmployeeName || headDetails.name || (finalHeadId ? `${finalHeadId} Lead` : '');
        }

        const nowIso = new Date().toISOString();
        const subDeptRecord = {
            subDepartmentCode: cleanCode,
            subDepartmentName: cleanName,
            costCenterCode: cleanCc,
            departmentCode,
            sameAsDeptHead: isSame,
            inheritedFromDeptHead: isSame,
            subDepartmentHeadEmployeeId: finalHeadId,
            subDepartmentHeadName: finalHeadName,
            headEmployeeId: finalHeadId,
            headEmployeeName: finalHeadName,
            isActive,
            createdAt: subDeptData.createdAt || nowIso,
            updatedAt: nowIso
        };

        // Persist to Cloud Firestore
        try {
            const fb = await import('./firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.setDoc) {
                const docRef = fb.doc(fb.db, 'organizations', orgId, 'sub_departments', cleanCode);
                const firestorePayload = {
                    subDepartmentCode: cleanCode,
                    subDepartmentName: cleanName,
                    costCenterCode: cleanCc,
                    departmentCode,
                    sameAsDeptHead: isSame,
                    inheritedFromDeptHead: isSame,
                    subDepartmentHeadEmployeeId: finalHeadId,
                    subDepartmentHeadName: finalHeadName,
                    headEmployeeId: finalHeadId,
                    headEmployeeName: finalHeadName,
                    isActive,
                    createdAt: fb.serverTimestamp ? fb.serverTimestamp() : nowIso,
                    updatedAt: fb.serverTimestamp ? fb.serverTimestamp() : nowIso
                };
                await fb.setDoc(docRef, firestorePayload, { merge: true });
            }
        } catch (err) {
            console.warn('[SubDepartmentService] Firestore setDoc notice:', err.message);
        }

        subDepartmentsMap.set(cleanCode, subDeptRecord);
        dispatchUpdateEvents();
        return subDeptRecord;
    }

    /**
     * UPDATE: Modifies an existing Sub-Department
     */
    async function updateSubDepartment(subDepartmentCode, updates, orgId = getDefaultOrgId()) {
        const cleanCode = String(subDepartmentCode).trim().toUpperCase();
        const existing = subDepartmentsMap.get(cleanCode);

        if (!existing) {
            throw new Error(`Sub-Department with code '${cleanCode}' does not exist.`);
        }

        const rawCc = updates.costCenterCode || updates['Cost_Center_Code'] || existing.costCenterCode;
        const cleanCc = String(rawCc).trim().toUpperCase().replace(/\s+/g, '_');
        const deptCode = updates.departmentCode || existing.departmentCode;

        // Determine if same as dept head
        const rawHead = updates.subDepartmentHeadEmployeeId || updates.headEmployeeId || updates['Sub-Department_Head_Employee_ID'];
        const isExplicitFlag = updates.sameAsDeptHead !== undefined ? Boolean(updates.sameAsDeptHead)
            : (updates.inheritedFromDeptHead !== undefined ? Boolean(updates.inheritedFromDeptHead) : null);

        let isSame = existing.sameAsDeptHead;
        if (isExplicitFlag !== null) {
            isSame = isExplicitFlag;
        } else if (rawHead !== undefined) {
            isSame = isSameAsDeptHeadValue(rawHead);
        }

        const resolvedDept = resolveDepartmentForSubDept(cleanCode, cleanCc, deptCode);
        const finalDeptCode = deptCode || resolvedDept.departmentCode;

        let finalHeadId = existing.subDepartmentHeadEmployeeId || existing.headEmployeeId;
        let finalHeadName = existing.subDepartmentHeadName || existing.headEmployeeName;

        if (isSame) {
            finalHeadId = resolvedDept.departmentHeadEmployeeId;
            finalHeadName = resolvedDept.departmentHeadName;
        } else if (rawHead !== undefined) {
            finalHeadId = String(rawHead).trim().toUpperCase();
            const headDetails = getHeadDetailsById(finalHeadId);
            finalHeadName = updates.subDepartmentHeadName || updates.headEmployeeName || headDetails.name || (finalHeadId ? `${finalHeadId} Lead` : '');
        }

        const nowIso = new Date().toISOString();
        const updatedRecord = {
            ...existing,
            ...updates,
            subDepartmentCode: cleanCode, // PK immutable
            costCenterCode: cleanCc,
            departmentCode: finalDeptCode,
            sameAsDeptHead: isSame,
            inheritedFromDeptHead: isSame,
            subDepartmentHeadEmployeeId: finalHeadId,
            subDepartmentHeadName: finalHeadName,
            headEmployeeId: finalHeadId,
            headEmployeeName: finalHeadName,
            updatedAt: nowIso
        };

        // Cloud Firestore update
        try {
            const fb = await import('./firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.setDoc) {
                const docRef = fb.doc(fb.db, 'organizations', orgId, 'sub_departments', cleanCode);
                const firestoreUpdates = {
                    ...updatedRecord,
                    updatedAt: fb.serverTimestamp ? fb.serverTimestamp() : nowIso
                };
                await fb.setDoc(docRef, firestoreUpdates, { merge: true });
            }
        } catch (err) {
            console.warn('[SubDepartmentService] Firestore update notice:', err.message);
        }

        subDepartmentsMap.set(cleanCode, updatedRecord);
        dispatchUpdateEvents();
        return updatedRecord;
    }

    /**
     * TOGGLE STATUS: Switches active between true/false
     */
    async function toggleSubDepartmentStatus(subDepartmentCode, orgId = getDefaultOrgId()) {
        const cleanCode = String(subDepartmentCode).trim().toUpperCase();
        const existing = subDepartmentsMap.get(cleanCode);

        if (!existing) {
            throw new Error(`Sub-Department '${cleanCode}' not found.`);
        }

        const newStatus = !existing.isActive;
        return await updateSubDepartment(cleanCode, { isActive: newStatus }, orgId);
    }

    /**
     * DELETE: Removes a Sub-Department
     */
    async function deleteSubDepartment(subDepartmentCode, orgId = getDefaultOrgId()) {
        const cleanCode = String(subDepartmentCode).trim().toUpperCase();

        try {
            const fb = await import('./firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.deleteDoc) {
                const docRef = fb.doc(fb.db, 'organizations', orgId, 'sub_departments', cleanCode);
                await fb.deleteDoc(docRef);
            }
        } catch (err) {
            console.warn('[SubDepartmentService] Firestore delete notice:', err.message);
        }

        subDepartmentsMap.delete(cleanCode);
        dispatchUpdateEvents();
        return true;
    }

    /**
     * Get Firestore Path for Sub-Department collection or document
     */
    function getFirestorePath(subDepartmentCode = '', orgId = getDefaultOrgId()) {
        const base = `organizations/${orgId}/sub_departments`;
        if (!subDepartmentCode) return base;
        return `${base}/${String(subDepartmentCode).trim().toUpperCase()}`;
    }

    function getSubDepartmentDocPath(subDepartmentCode, orgId = getDefaultOrgId()) {
        return getFirestorePath(subDepartmentCode, orgId);
    }

    /**
     * Get Cost Center Code associated with a Sub-Department (PRD Sections 10 & 13)
     */
    function getCostCenterForSubDepartment(subDepartmentCode, subDeptList = null) {
        if (!subDepartmentCode) return '';
        const clean = String(subDepartmentCode).trim().toUpperCase();
        if (Array.isArray(subDeptList)) {
            const found = subDeptList.find(s => (s.subDepartmentCode || s['Sub-Department_Code'] || s.code || '').toUpperCase() === clean);
            if (found) return found.costCenterCode || found['Cost_Center_Code'] || '';
        }
        const record = getSubDepartment(clean);
        return record ? (record.costCenterCode || record['Cost_Center_Code'] || '') : '';
    }

    /**
     * BULK IMPORT: Batch persists Sub-Departments
     */
    async function bulkImportSubDepartments(subDeptList, orgId = getDefaultOrgId()) {
        if (!Array.isArray(subDeptList) || subDeptList.length === 0) {
            throw new Error('No Sub-Department records provided for ingestion.');
        }

        const results = [];
        const errors = [];

        for (const item of subDeptList) {
            try {
                const saved = await createSubDepartment(item, orgId);
                results.push(saved);
            } catch (err) {
                errors.push({ item, error: err.message });
            }
        }

        return {
            success: errors.length === 0,
            count: results.length,
            ingestedCount: results.length,
            total: subDeptList.length,
            successCount: results.length,
            errorCount: errors.length,
            results,
            errors
        };
    }

    /**
     * DEPARTMENT HEAD PROPAGATION LISTENER:
     * When a Super Admin updates the Head of a parent Department in the Department registry,
     * triggers an atomic Firestore batch to update all child Sub-Departments with sameAsDeptHead: true / inheritedFromDeptHead: true.
     */
    async function propagateDepartmentHeadUpdate(departmentCode, newHeadEmployeeId, newHeadEmployeeName = '', orgId = getDefaultOrgId()) {
        const cleanDept = String(departmentCode || '').trim().toUpperCase();
        const cleanHeadId = String(newHeadEmployeeId || '').trim().toUpperCase();
        const headDetails = getHeadDetailsById(cleanHeadId);
        const cleanHeadName = newHeadEmployeeName || headDetails.name || `${cleanHeadId} Lead`;

        // Update in canonical DEFAULT_DEPARTMENTS if present
        const deptInMaster = DEFAULT_DEPARTMENTS.find(d => d.departmentCode === cleanDept);
        if (deptInMaster) {
            deptInMaster.departmentHeadEmployeeId = cleanHeadId;
            deptInMaster.departmentHeadName = cleanHeadName;
        }

        const matchingSubs = [];
        for (const [code, sub] of subDepartmentsMap.entries()) {
            const subDept = (sub.departmentCode || '').toUpperCase();
            const isInherited = sub.sameAsDeptHead === true || sub.inheritedFromDeptHead === true;

            const resolved = resolveDepartmentForSubDept(sub.subDepartmentCode, sub.costCenterCode, sub.departmentCode);
            const isChildOfDept = (subDept && subDept === cleanDept) || (resolved && resolved.departmentCode === cleanDept);

            if (isChildOfDept && isInherited) {
                const updated = {
                    ...sub,
                    subDepartmentHeadEmployeeId: cleanHeadId,
                    subDepartmentHeadName: cleanHeadName,
                    headEmployeeId: cleanHeadId,
                    headEmployeeName: cleanHeadName,
                    updatedAt: new Date().toISOString()
                };
                subDepartmentsMap.set(code, updated);
                matchingSubs.push(updated);
            }
        }

        // Atomic Cloud Firestore Batch Write
        try {
            const fb = await import('./firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.writeBatch && fb.doc) {
                const batch = fb.writeBatch(fb.db);
                matchingSubs.forEach(sub => {
                    const docRef = fb.doc(fb.db, 'organizations', orgId, 'sub_departments', sub.subDepartmentCode);
                    batch.update(docRef, {
                        subDepartmentHeadEmployeeId: cleanHeadId,
                        subDepartmentHeadName: cleanHeadName,
                        headEmployeeId: cleanHeadId,
                        headEmployeeName: cleanHeadName,
                        updatedAt: fb.serverTimestamp ? fb.serverTimestamp() : new Date().toISOString()
                    });
                });
                await batch.commit();
            }
        } catch (err) {
            console.warn('[SubDepartmentService] Batch propagation notice:', err.message);
        }

        dispatchUpdateEvents();
        return {
            departmentCode: cleanDept,
            newHeadEmployeeId: cleanHeadId,
            newHeadEmployeeName: cleanHeadName,
            updatedSubDepartmentsCount: matchingSubs.length,
            updatedSubDepartments: matchingSubs
        };
    }

    /**
     * DYNAMIC UI DROPDOWN BINDING (PRD Sections 10 & 13)
     * Populates a select element with active Sub-Departments
     */
    function populateSubDepartmentDropdown(selectElementOrId, options = {}) {
        const select = typeof selectElementOrId === 'string'
            ? document.getElementById(selectElementOrId)
            : selectElementOrId;

        if (!select) return null;

        const {
            departmentCode = '',
            costCenterCode = '',
            selectedCode = '',
            includePlaceholder = true,
            placeholderText = 'Select Sub-Department',
            activeOnly = true,
            onSelect = null
        } = options;

        const filteredList = filterSubDepartments({ departmentCode, costCenterCode, activeOnly });
        let html = '';

        if (includePlaceholder) {
            html += `<option value="">-- ${placeholderText} --</option>`;
        }

        filteredList.forEach(sub => {
            const isSelected = selectedCode && sub.subDepartmentCode.toUpperCase() === selectedCode.toUpperCase();
            const headBadge = sub.headEmployeeName ? ` (Lead: ${sub.headEmployeeName})` : '';
            html += `<option value="${sub.subDepartmentCode}" data-cost-center="${sub.costCenterCode || ''}" ${isSelected ? 'selected' : ''}>${sub.subDepartmentCode} - ${sub.subDepartmentName}${headBadge}</option>`;
        });

        select.innerHTML = html;
        select.disabled = filteredList.length === 0 && !includePlaceholder;

        if (selectedCode) {
            select.value = selectedCode;
        }

        if (onSelect && typeof onSelect === 'function') {
            select.onchange = (e) => {
                const chosen = getSubDepartment(e.target.value);
                onSelect(chosen, e);
            };
        }

        return filteredList;
    }

    /**
     * CASCADING HIERARCHY LISTENER (PRD Sections 10 & 13)
     * Binds Department, Cost Center, and Sub-Department selectors into a reactive hierarchy
     */
    function bindCascadingHierarchy({
        deptSelect,
        ccSelect,
        subDeptSelect,
        onSubDeptChange = null
    } = {}) {
        const deptEl = typeof deptSelect === 'string' ? document.getElementById(deptSelect) : deptSelect;
        const ccEl = typeof ccSelect === 'string' ? document.getElementById(ccSelect) : ccSelect;
        const subDeptEl = typeof subDeptSelect === 'string' ? document.getElementById(subDeptSelect) : subDeptSelect;

        if (!subDeptEl) return null;

        const updateCascade = () => {
            const chosenDept = deptEl ? deptEl.value : '';
            const chosenCc = ccEl ? ccEl.value : '';
            const currentSub = subDeptEl.value;

            populateSubDepartmentDropdown(subDeptEl, {
                departmentCode: chosenDept,
                costCenterCode: chosenCc,
                selectedCode: currentSub,
                includePlaceholder: true,
                placeholderText: chosenDept ? 'Select Sub-Department' : 'Select Department First'
            });

            if (deptEl && !chosenDept && !chosenCc) {
                subDeptEl.disabled = true;
            } else {
                subDeptEl.disabled = false;
            }
        };

        if (deptEl) {
            deptEl.addEventListener('change', updateCascade);
        }

        if (ccEl) {
            ccEl.addEventListener('change', updateCascade);
        }

        // Sub-Department change -> Auto-select linked Cost Center
        subDeptEl.addEventListener('change', (e) => {
            const subCode = e.target.value;
            if (!subCode) return;

            const sub = getSubDepartment(subCode);
            if (sub && sub.costCenterCode && ccEl) {
                ccEl.value = sub.costCenterCode;
            }

            if (onSubDeptChange && typeof onSubDeptChange === 'function') {
                onSubDeptChange(sub, e);
            }
        });

        // Initial setup
        updateCascade();

        return {
            refresh: updateCascade
        };
    }

    /**
     * Populates Sub-Department Head dropdown (Active Employees)
     */
    function populateHeadDropdown(selectElementOrId, selectedHeadId = '') {
        const select = typeof selectElementOrId === 'string'
            ? document.getElementById(selectElementOrId)
            : selectElementOrId;

        if (!select) return;

        const employees = Array.from(activeEmployeesMap.values());
        let html = '<option value="">-- Select Sub-Department Lead --</option>';

        employees.forEach(emp => {
            const isSelected = selectedHeadId && emp.employeeId.toUpperCase() === selectedHeadId.toUpperCase();
            html += `<option value="${emp.employeeId}" ${isSelected ? 'selected' : ''}>${emp.employeeId} - ${emp.fullName} (${emp.designation || 'Lead'})</option>`;
        });

        select.innerHTML = html;
    }

    /**
     * Populates Cost Center foreign key dropdown (Active Cost Centers)
     */
    function populateCostCenterSelect(selectElementOrId, selectedCcCode = '') {
        const select = typeof selectElementOrId === 'string'
            ? document.getElementById(selectElementOrId)
            : selectElementOrId;

        if (!select) return;

        let costCenters = [];
        if (typeof window !== 'undefined' && window.KylrxCostCenterService && typeof window.KylrxCostCenterService.getActiveCostCenters === 'function') {
            costCenters = window.KylrxCostCenterService.getActiveCostCenters();
        } else {
            // Default fallback
            costCenters = [
                { costCenterCode: 'CC_ENG_01', costCenterName: 'QA & Engineering Operations' },
                { costCenterCode: 'CC-ENG-101', costCenterName: 'Core Software Engineering' },
                { costCenterCode: 'CC_ENG_DEV', costCenterName: 'Software Engineering & R&D' },
                { costCenterCode: 'CC-AI-102', costCenterName: 'Artificial Intelligence R&D' },
                { costCenterCode: 'CC-HR-201', costCenterName: 'People Operations & HRMS' },
                { costCenterCode: 'CC-FIN-301', costCenterName: 'Treasury & Statutory Compliance' },
                { costCenterCode: 'CC-OPS-401', costCenterName: 'Global Operations & Support' }
            ];
        }

        let html = '<option value="">-- Select Linked Cost Center * --</option>';
        costCenters.forEach(cc => {
            const code = cc.costCenterCode || cc.code;
            const name = cc.costCenterName || cc.name;
            const isSelected = selectedCcCode && code.toUpperCase() === selectedCcCode.toUpperCase();
            html += `<option value="${code}" ${isSelected ? 'selected' : ''}>${code} - ${name}</option>`;
        });

        select.innerHTML = html;
    }

    /**
     * Event Dispatcher for reactive UI updates
     */
    function dispatchUpdateEvents() {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('sub-departments-updated', {
                detail: { count: subDepartmentsMap.size, timestamp: new Date().toISOString() }
            }));
        }
    }

    /**
     * ADMIN CONSOLE MODAL: Open Add/Edit Sub-Department Modal
     * Supports explicit "Same as Department Head" toggle and fallback resolution
     */
    function openSubDepartmentModal(subDepartmentCode = null) {
        if (typeof document === 'undefined') return;

        let modal = document.getElementById('subDeptModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'subDeptModal';
            modal.style.cssText = `
                position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5);
                backdrop-filter: blur(8px); display: none; align-items: center; justify-content: center;
                z-index: 99999; animation: fadeIn 0.2s ease;
            `;
            modal.innerHTML = `
                <div style="background: white; border-radius: 24px; padding: 2rem; width: 92%; max-width: 560px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.2); border: 1px solid #e2e8f0; max-height: 90vh; overflow-y: auto;">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 1rem; margin-bottom: 1.5rem;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 36px; height: 36px; border-radius: 10px; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center;">
                                <i data-lucide="layers" style="width: 20px; height: 20px;"></i>
                            </div>
                            <h2 style="font-size: 1.25rem; font-weight: 800; color: #0f172a; margin: 0;" id="subDeptModalTitle">New Sub-Department</h2>
                        </div>
                        <button type="button" id="btnCloseSubDeptModal" style="background: none; border: none; font-size: 1.5rem; color: #64748b; cursor: pointer; padding: 4px;">&times;</button>
                    </div>

                    <form id="subDeptForm">
                        <div style="margin-bottom: 1.25rem;">
                            <label style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">1. Sub-Department Code * (Primary Key)</label>
                            <input type="text" id="inputSubDeptCode" placeholder="e.g. SUB_QA_AUTO" style="width: 100%; padding: 10px 14px; border-radius: 12px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.9rem; margin-top: 6px; box-sizing: border-box;" required>
                            <span style="font-size: 0.72rem; color: #94a3b8; margin-top: 4px; display: block;">Immutable unique identifier (e.g. SUB_QA_AUTO, ENG-FRONTEND)</span>
                        </div>

                        <div style="margin-bottom: 1.25rem;">
                            <label style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">2. Sub-Department Name * (Display Title)</label>
                            <input type="text" id="inputSubDeptName" placeholder="e.g. QA & Automation" style="width: 100%; padding: 10px 14px; border-radius: 12px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.9rem; margin-top: 6px; box-sizing: border-box;" required>
                        </div>

                        <div style="margin-bottom: 1.25rem;">
                            <label style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">3. Linked Cost Center * (Cost_Center_Code Foreign Key)</label>
                            <select id="selectSubDeptCostCenter" style="width: 100%; padding: 10px 14px; border-radius: 12px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.9rem; margin-top: 6px; box-sizing: border-box;" required>
                                <!-- Populated dynamically -->
                            </select>
                            <span style="font-size: 0.72rem; color: #94a3b8; margin-top: 4px; display: block;">Determines departmental budget & organizational parent linkage</span>
                        </div>

                        <!-- Same as Department Head Fallback Control -->
                        <div style="margin-bottom: 1.25rem; background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 14px; padding: 14px;">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                                <label for="checkSameAsDeptHead" style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 0.85rem; font-weight: 700; color: #0f172a;">
                                    <input type="checkbox" id="checkSameAsDeptHead" style="width: 18px; height: 18px; accent-color: #2563eb; cursor: pointer;" checked>
                                    Same as Department Head (Inherit)
                                </label>
                                <span style="background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; font-size: 0.7rem; font-weight: 800; padding: 2px 8px; border-radius: 6px;">Automatic Fallback</span>
                            </div>
                            
                            <div id="resolvedDeptHeadDisplay" style="margin-top: 10px; background: white; border: 1px dashed #cbd5e1; border-radius: 10px; padding: 10px 12px; display: flex; align-items: center; gap: 8px;">
                                <span style="display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: #dcfce7; color: #15803d; font-size: 0.75rem; font-weight: 800;">✓</span>
                                <div style="font-size: 0.8rem; color: #334155;">
                                    Inherited Head: <strong id="resolvedHeadNameText">Vikram Malhotra</strong>
                                    <span style="font-family: monospace; background: #f1f5f9; padding: 2px 6px; border-radius: 4px; margin-left: 4px;" id="resolvedHeadIdText">EMP0002</span>
                                    <span style="color: #64748b; font-size: 0.75rem; display: block;" id="resolvedDeptNameText">Parent Dept: QA & Engineering (DEPT_ENG)</span>
                                </div>
                            </div>
                        </div>

                        <!-- Distinct Sub-Department Head Selection -->
                        <div style="margin-bottom: 1.25rem;" id="subDeptHeadSection">
                            <label style="font-size: 0.75rem; font-weight: 800; color: #64748b; text-transform: uppercase;">4. Sub-Department Head Lead (Employee ID)</label>
                            <select id="selectSubDeptHead" style="width: 100%; padding: 10px 14px; border-radius: 12px; border: 1.5px solid #cbd5e1; font-family: inherit; font-size: 0.9rem; margin-top: 6px; box-sizing: border-box;" disabled>
                                <!-- Populated dynamically -->
                            </select>
                            <span id="subDeptHeadHelpText" style="font-size: 0.72rem; color: #64748b; margin-top: 4px; display: block;">Inherited automatically from parent Department Head. Uncheck "Same as Department Head" above to assign a distinct lead.</span>
                        </div>

                        <div style="margin-bottom: 1.5rem; display: flex; align-items: center; gap: 10px; background: #f8fafc; padding: 12px 16px; border-radius: 12px; border: 1px solid #e2e8f0;">
                            <input type="checkbox" id="checkSubDeptActive" style="width: 18px; height: 18px; cursor: pointer;" checked>
                            <div>
                                <label for="checkSubDeptActive" style="font-size: 0.85rem; font-weight: 700; color: #0f172a; cursor: pointer;">Operational Status (Active)</label>
                                <p style="font-size: 0.72rem; color: #64748b; margin: 0;">When disabled, this Sub-Department will be hidden from employee assignment dropdowns</p>
                            </div>
                        </div>

                        <div style="display: flex; justify-content: flex-end; gap: 10px;">
                            <button type="button" id="btnCancelSubDeptModal" style="padding: 10px 18px; border-radius: 12px; border: 1px solid #cbd5e1; background: white; font-weight: 700; cursor: pointer;">Cancel</button>
                            <button type="submit" id="btnSaveSubDeptModal" style="padding: 10px 22px; border-radius: 12px; border: none; background: #2563eb; color: white; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                                <i data-lucide="check"></i> Save Sub-Department
                            </button>
                        </div>
                    </form>
                </div>
            `;
            document.body.appendChild(modal);

            document.getElementById('btnCloseSubDeptModal').onclick = () => modal.style.display = 'none';
            document.getElementById('btnCancelSubDeptModal').onclick = () => modal.style.display = 'none';

            // Reactive helper to update resolved head display
            const updateResolvedHeadDisplay = () => {
                const codeInput = document.getElementById('inputSubDeptCode');
                const ccSelect = document.getElementById('selectSubDeptCostCenter');
                const headSelect = document.getElementById('selectSubDeptHead');
                const sameCheck = document.getElementById('checkSameAsDeptHead');
                const displayBox = document.getElementById('resolvedDeptHeadDisplay');
                const nameText = document.getElementById('resolvedHeadNameText');
                const idText = document.getElementById('resolvedHeadIdText');
                const deptText = document.getElementById('resolvedDeptNameText');
                const helpText = document.getElementById('subDeptHeadHelpText');

                const resolved = resolveDepartmentForSubDept(codeInput?.value, ccSelect?.value);
                if (nameText) nameText.textContent = resolved.departmentHeadName;
                if (idText) idText.textContent = resolved.departmentHeadEmployeeId;
                if (deptText) deptText.textContent = `Parent Dept: ${resolved.departmentName} (${resolved.departmentCode})`;

                if (sameCheck && sameCheck.checked) {
                    if (headSelect) {
                        headSelect.disabled = true;
                        headSelect.value = resolved.departmentHeadEmployeeId;
                    }
                    if (displayBox) displayBox.style.display = 'flex';
                    if (helpText) helpText.textContent = 'Inherited automatically from parent Department Head. Uncheck "Same as Department Head" above to assign a distinct lead.';
                } else {
                    if (headSelect) headSelect.disabled = false;
                    if (displayBox) displayBox.style.display = 'none';
                    if (helpText) helpText.textContent = 'Assign a distinct lead for this Sub-Department.';
                }
            };

            document.getElementById('checkSameAsDeptHead').addEventListener('change', updateResolvedHeadDisplay);
            document.getElementById('selectSubDeptCostCenter').addEventListener('change', updateResolvedHeadDisplay);
            document.getElementById('inputSubDeptCode').addEventListener('input', () => {
                if (document.getElementById('checkSameAsDeptHead').checked) {
                    updateResolvedHeadDisplay();
                }
            });

            document.getElementById('subDeptForm').onsubmit = async (e) => {
                e.preventDefault();
                const codeInput = document.getElementById('inputSubDeptCode');
                const nameInput = document.getElementById('inputSubDeptName');
                const headSelect = document.getElementById('selectSubDeptHead');
                const ccSelect = document.getElementById('selectSubDeptCostCenter');
                const sameCheck = document.getElementById('checkSameAsDeptHead');
                const activeCheck = document.getElementById('checkSubDeptActive');

                const isEdit = codeInput.disabled;
                const isSame = sameCheck.checked;
                const resolved = resolveDepartmentForSubDept(codeInput.value.trim(), ccSelect.value);

                const payload = {
                    subDepartmentCode: codeInput.value.trim(),
                    subDepartmentName: nameInput.value.trim(),
                    costCenterCode: ccSelect.value,
                    departmentCode: resolved.departmentCode,
                    sameAsDeptHead: isSame,
                    inheritedFromDeptHead: isSame,
                    subDepartmentHeadEmployeeId: isSame ? resolved.departmentHeadEmployeeId : headSelect.value,
                    subDepartmentHeadName: isSame ? resolved.departmentHeadName : (headSelect.options[headSelect.selectedIndex]?.text?.split(' - ')[1]?.split(' (')[0] || ''),
                    headEmployeeId: isSame ? resolved.departmentHeadEmployeeId : headSelect.value,
                    headEmployeeName: isSame ? resolved.departmentHeadName : '',
                    isActive: activeCheck.checked
                };

                try {
                    if (isEdit) {
                        await updateSubDepartment(payload.subDepartmentCode, payload);
                    } else {
                        await createSubDepartment(payload);
                    }
                    modal.style.display = 'none';
                    if (typeof window.showCustomAlert === 'function') {
                        window.showCustomAlert("Success", `Sub-Department ${payload.subDepartmentCode} saved successfully.`, "success");
                    }
                    renderAdminConsole();
                } catch (err) {
                    alert("Error saving Sub-Department: " + err.message);
                }
            };
        }

        const titleEl = document.getElementById('subDeptModalTitle');
        const codeInput = document.getElementById('inputSubDeptCode');
        const nameInput = document.getElementById('inputSubDeptName');
        const headSelect = document.getElementById('selectSubDeptHead');
        const ccSelect = document.getElementById('selectSubDeptCostCenter');
        const sameCheck = document.getElementById('checkSameAsDeptHead');
        const activeCheck = document.getElementById('checkSubDeptActive');
        const displayBox = document.getElementById('resolvedDeptHeadDisplay');

        if (subDepartmentCode) {
            const sub = getSubDepartment(subDepartmentCode);
            if (sub) {
                titleEl.textContent = `Edit Sub-Department: ${sub.subDepartmentCode}`;
                codeInput.value = sub.subDepartmentCode;
                codeInput.disabled = true;
                nameInput.value = sub.subDepartmentName;
                populateCostCenterSelect(ccSelect, sub.costCenterCode);
                populateHeadDropdown(headSelect, sub.subDepartmentHeadEmployeeId || sub.headEmployeeId);
                
                const isInherited = sub.sameAsDeptHead === true || sub.inheritedFromDeptHead === true;
                sameCheck.checked = isInherited;
                headSelect.disabled = isInherited;
                activeCheck.checked = sub.isActive === true;

                const resolved = resolveDepartmentForSubDept(sub.subDepartmentCode, sub.costCenterCode, sub.departmentCode);
                document.getElementById('resolvedHeadNameText').textContent = resolved.departmentHeadName;
                document.getElementById('resolvedHeadIdText').textContent = resolved.departmentHeadEmployeeId;
                document.getElementById('resolvedDeptNameText').textContent = `Parent Dept: ${resolved.departmentName} (${resolved.departmentCode})`;
                displayBox.style.display = isInherited ? 'flex' : 'none';
            }
        } else {
            titleEl.textContent = 'New Sub-Department';
            codeInput.value = '';
            codeInput.disabled = false;
            nameInput.value = '';
            populateCostCenterSelect(ccSelect, 'CC_ENG_01');
            populateHeadDropdown(headSelect);
            sameCheck.checked = true;
            headSelect.disabled = true;
            activeCheck.checked = true;

            const resolved = resolveDepartmentForSubDept('', 'CC_ENG_01');
            document.getElementById('resolvedHeadNameText').textContent = resolved.departmentHeadName;
            document.getElementById('resolvedHeadIdText').textContent = resolved.departmentHeadEmployeeId;
            document.getElementById('resolvedDeptNameText').textContent = `Parent Dept: ${resolved.departmentName} (${resolved.departmentCode})`;
            displayBox.style.display = 'flex';
        }

        modal.style.display = 'flex';
        if (window.lucide) lucide.createIcons();
    }

    /**
     * ADMIN CONSOLE: Renders Sub-Departments console table in administration dashboard
     */
    function renderAdminConsole(containerId = 'onboardingSubDeptTableContainer') {
        if (typeof document === 'undefined') return;
        const container = document.getElementById(containerId);
        if (!container) return;

        const subDepts = getAllSubDepartments();
        const activeCount = subDepts.filter(s => s.isActive).length;
        const totalCount = subDepts.length;

        container.innerHTML = `
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 24px; padding: 2rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); margin-bottom: 2rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 1.25rem; margin-bottom: 1.5rem; flex-wrap: wrap; gap: 1rem;">
                    <div>
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <div style="width: 40px; height: 40px; border-radius: 12px; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center;">
                                <i data-lucide="layers" style="width: 22px; height: 22px;"></i>
                            </div>
                            <div>
                                <h2 style="font-size: 1.3rem; font-weight: 800; color: #0f172a; margin: 0;">Sub-Departments Management Console</h2>
                                <p style="font-size: 0.8rem; color: #64748b; margin: 2px 0 0 0;">
                                    PRD Sections 1, 10 & 13: Strict 5-attribute schema with "Same as Department Head" fallback inheritance
                                </p>
                            </div>
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button type="button" class="btn btn-outline" id="btnAdminAddSubDept" style="font-size: 0.85rem; border: 1.5px solid #e2e8f0; background: white; cursor: pointer; padding: 10px 16px; border-radius: 12px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;">
                            <i data-lucide="plus-circle" style="color: #2563eb;"></i> Add Sub-Department
                        </button>
                    </div>
                </div>

                <!-- Attributes Summary Cards -->
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 1.25rem 1.5rem; margin-bottom: 1.5rem; display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem;">
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">1. Code Attribute</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #0f172a; margin-top: 2px;">Sub-Department_Code (PK)</p>
                    </div>
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">2. Display Title</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #0f172a; margin-top: 2px;">Sub-Department_Name</p>
                    </div>
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">3. Head Lead ID</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #0f172a; margin-top: 2px;">Sub-Department_Head_Employee_ID</p>
                    </div>
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">4. Foreign Key</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #2563eb; margin-top: 2px;">Cost_Center_Code (FK)</p>
                    </div>
                    <div>
                        <span style="font-size: 0.7rem; font-weight: 800; color: #64748b; text-transform: uppercase;">5. Operational Status</span>
                        <p style="font-size: 0.82rem; font-weight: 700; color: #166534; margin-top: 2px;">Active (${activeCount}/${totalCount})</p>
                    </div>
                </div>

                <!-- Table Preview -->
                <div style="overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 16px;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
                        <thead>
                            <tr style="background: #f8fafc; border-bottom: 1.5px solid #e2e8f0;">
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">#</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Sub-Department Code</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Sub-Department Name</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Head Lead</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569;">Linked Cost Center</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569; text-align: center;">Status</th>
                                <th style="padding: 12px 16px; font-weight: 800; color: #475569; text-align: right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${subDepts.map((sub, idx) => {
                                const statusBadge = sub.isActive
                                    ? '<span style="background: #dcfce7; color: #15803d; padding: 4px 10px; border-radius: 100px; font-size: 0.75rem; font-weight: 800;">Active (Yes)</span>'
                                    : '<span style="background: #fee2e2; color: #b91c1c; padding: 4px 10px; border-radius: 100px; font-size: 0.75rem; font-weight: 800;">Inactive (No)</span>';

                                const isInherited = sub.sameAsDeptHead === true || sub.inheritedFromDeptHead === true;
                                const headTag = isInherited
                                    ? '<span style="background: #e0e7ff; color: #3730a3; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; margin-left: 6px;">Inherited</span>'
                                    : '<span style="background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; margin-left: 6px;">Distinct</span>';

                                return `
                                    <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='white'">
                                        <td style="padding: 12px 16px; color: #94a3b8; font-weight: 600;">${idx + 1}</td>
                                        <td style="padding: 12px 16px; font-weight: 800; color: #0f172a; font-family: monospace;">${sub.subDepartmentCode}</td>
                                        <td style="padding: 12px 16px; font-weight: 700; color: #334155;">${sub.subDepartmentName}</td>
                                        <td style="padding: 12px 16px;">
                                            <div style="font-weight: 700; color: #0f172a; display: flex; align-items: center;">
                                                ${sub.subDepartmentHeadName || sub.headEmployeeName || 'Not Assigned'}
                                                ${headTag}
                                            </div>
                                            <div style="font-size: 0.75rem; color: #64748b; font-family: monospace;">${sub.subDepartmentHeadEmployeeId || sub.headEmployeeId || ''}</div>
                                        </td>
                                        <td style="padding: 12px 16px;">
                                            <span style="background: #eff6ff; color: #1d4ed8; padding: 4px 8px; border-radius: 6px; font-family: monospace; font-size: 0.8rem; font-weight: 700;">${sub.costCenterCode}</span>
                                        </td>
                                        <td style="padding: 12px 16px; text-align: center;">${statusBadge}</td>
                                        <td style="padding: 12px 16px; text-align: right;">
                                            <div style="display: inline-flex; gap: 6px;">
                                                <button onclick="window.KylrxSubDepartmentService.openSubDepartmentModal('${sub.subDepartmentCode}')" style="padding: 6px 10px; border: 1px solid #cbd5e1; background: white; border-radius: 8px; font-size: 0.78rem; font-weight: 700; cursor: pointer;" title="Edit Sub-Department">Edit</button>
                                                <button onclick="window.KylrxSubDepartmentService.toggleSubDepartmentStatus('${sub.subDepartmentCode}').then(() => window.KylrxSubDepartmentService.renderAdminConsole())" style="padding: 6px 10px; border: 1px solid ${sub.isActive ? '#fecaca' : '#bbf7d0'}; background: ${sub.isActive ? '#fff1f2' : '#f0fdf4'}; color: ${sub.isActive ? '#991b1b' : '#166534'}; border-radius: 8px; font-size: 0.78rem; font-weight: 700; cursor: pointer;">${sub.isActive ? 'Deactivate' : 'Activate'}</button>
                                            </div>
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        document.getElementById('btnAdminAddSubDept')?.addEventListener('click', () => {
            openSubDepartmentModal();
        });

        if (window.lucide) lucide.createIcons();
    }

    return {
        DEFAULT_SUB_DEPARTMENTS,
        DEFAULT_DEPARTMENTS,
        isSameAsDeptHeadValue,
        resolveDepartmentForSubDept,
        getFirestorePath,
        getSubDepartmentDocPath,
        getCostCenterForSubDepartment,
        validateSubDepartmentCode,
        getAllSubDepartments,
        getActiveSubDepartments,
        getSubDepartment,
        filterSubDepartments,
        createSubDepartment,
        updateSubDepartment,
        propagateDepartmentHeadUpdate,
        toggleSubDepartmentStatus,
        deleteSubDepartment,
        bulkImportSubDepartments,
        populateSubDepartmentDropdown,
        bindCascadingHierarchy,
        populateHeadDropdown,
        populateCostCenterSelect,
        openSubDepartmentModal,
        renderAdminConsole
    };
}));
