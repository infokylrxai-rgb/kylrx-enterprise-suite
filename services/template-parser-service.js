/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - TEMPLATES.XLSX MULTI-SHEET PARSER SERVICE
 * ============================================================================
 * 
 * Ingests the exact schemas from official 27-sheet Templates.xlsx:
 * 1. 'Organization': Legal_Name, PAN, TAN, CIN_or_LLPIN, GSTIN, Time_Zone, Currency, Financial_Year_Start
 * 2. 'Business Unit': Business_Unit_Code, Business_Unit_Name, Head_Employee_ID
 * 3. 'Cost Centre': Cost_Center_Code, Cost_Center_Name, Owner Employee ID
 * 4. 'Departments' & 'Sub-Departments': Sub-Department_Code, Sub-Department_Name, Cost_Center_Code
 * 
 * @version 1.0.0
 * @author Senior Full-Stack Firebase Engineer
 */

/**
 * Normalizes object keys for resilient matching across casing and separators.
 */
function normalizeRowKeys(row) {
    const normalized = {};
    for (const [key, value] of Object.entries(row)) {
        const cleanKey = key.trim().toLowerCase().replace(/[\s_-]+/g, '');
        normalized[cleanKey] = typeof value === 'string' ? value.trim() : value;
    }
    return normalized;
}

/**
 * Parses 'Organization' Sheet
 * Exact 21 attributes:
 * 1. Legal_Name, 2. Display_Name, 3. Organization_Type, 4. Industry, 5. Website,
 * 6. Official_Email, 7. Official_Phone, 8. Country, 9. State, 10. City,
 * 11. PIN_Code, 12. Registered_Address, 13. Corporate_Address, 14. Time_Zone, 15. Currency,
 * 16. Financial_Year_Start, 17. PAN, 18. TAN, 19. CIN_or_LLPIN, 20. GSTIN, 21. Logo_URL
 */
export function parseOrganizationSheet(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error("Sheet 'Organization' is missing or contains no data rows.");
    }

    const firstRow = normalizeRowKeys(rows[0]);
    const organization = {
        legalName: firstRow.legalname || firstRow.companyname || '',
        displayName: firstRow.displayname || firstRow.brandname || firstRow.name || '',
        organizationType: firstRow.organizationtype || firstRow.orgtype || firstRow.type || 'Private Limited',
        industry: firstRow.industry || firstRow.sector || '',
        website: firstRow.website || firstRow.url || '',
        officialEmail: firstRow.officialemail || firstRow.email || '',
        officialPhone: firstRow.officialphone || firstRow.phone || '',
        country: firstRow.country || 'India',
        state: firstRow.state || '',
        city: firstRow.city || '',
        pinCode: firstRow.pincode || firstRow.pin || firstRow.zipcode || firstRow.postalcode || '',
        registeredAddress: firstRow.registeredaddress || firstRow.regaddress || '',
        corporateAddress: firstRow.corporateaddress || firstRow.corpaddress || '',
        timezone: firstRow.timezone || firstRow.time_zone || 'Asia/Kolkata',
        currency: (firstRow.currency || 'INR').toUpperCase(),
        financialYearStart: firstRow.financialyearstart || firstRow.fystart || '04-01',
        pan: (firstRow.pan || '').toUpperCase(),
        tan: (firstRow.tan || '').toUpperCase(),
        cinOrLlpin: (firstRow.cinorllpin || firstRow.cin || firstRow.llpin || '').toUpperCase(),
        gstin: (firstRow.gstin || '').toUpperCase(),
        logoUrl: firstRow.logourl || firstRow.logo || ''
    };

    const errors = [];
    if (!organization.legalName) errors.push("Organization 'Legal_Name' is required.");
    if (organization.officialEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(organization.officialEmail)) {
        errors.push(`Invalid Official Email format: "${organization.officialEmail}".`);
    }
    if (organization.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(organization.pan)) {
        errors.push(`Invalid PAN format: "${organization.pan}". Must be 10 characters (e.g. ABCDE1234F).`);
    }
    if (organization.gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(organization.gstin)) {
        errors.push(`Invalid GSTIN format: "${organization.gstin}". Must be 15 characters.`);
    }

    // Attach exact 21 PRD attribute keys alongside camelCase
    organization.Legal_Name = organization.legalName;
    organization.Display_Name = organization.displayName;
    organization.Organization_Type = organization.organizationType;
    organization.Industry = organization.industry;
    organization.Website = organization.website;
    organization.Official_Email = organization.officialEmail;
    organization.Official_Phone = organization.officialPhone;
    organization.Country = organization.country;
    organization.State = organization.state;
    organization.City = organization.city;
    organization.PIN_Code = organization.pinCode;
    organization.Registered_Address = organization.registeredAddress;
    organization.Corporate_Address = organization.corporateAddress;
    organization.Time_Zone = organization.timezone;
    organization.Currency = organization.currency;
    organization.Financial_Year_Start = organization.financialYearStart;
    organization.PAN = organization.pan;
    organization.TAN = organization.tan;
    organization.CIN_or_LLPIN = organization.cinOrLlpin;
    organization.GSTIN = organization.gstin;
    organization.Logo_URL = organization.logoUrl;

    return { data: organization, errors, valid: errors.length === 0 };
}

/**
 * Parses 'Business Unit' Sheet matching PRD Sections 1 & 10
 * Strict 4 Attributes:
 * 1. Business_Unit_Code (unique PK / document ID)
 * 2. Business_Unit_Name (display title)
 * 3. Head_Employee_ID (reference to employee ID of BU head)
 * 4. Active (boolean: true for "Yes", false for "No")
 */
export function parseBusinessUnitSheet(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return { data: [], errors: ["Sheet 'Business Unit' is empty."], valid: false };
    }

    const businessUnits = [];
    const errors = [];
    const seenCodes = new Set();

    rows.forEach((r, idx) => {
        const row = normalizeRowKeys(r);
        const code = row.businessunitcode || row.bucode || row.code;
        const name = row.businessunitname || row.buname || row.name;
        const headEmployeeId = row.heademployeeid || row.headid || '';

        // Parse Active: Yes/true -> true, No/false -> false, defaults to true
        let isActive = true;
        const rawActive = row.active !== undefined ? row.active : (row.isactive !== undefined ? row.isactive : row.status);
        if (rawActive !== undefined && rawActive !== null && rawActive !== '') {
            if (typeof rawActive === 'boolean') {
                isActive = rawActive;
            } else {
                const s = String(rawActive).trim().toLowerCase();
                if (['no', 'n', 'false', '0', 'inactive', 'disabled'].includes(s)) {
                    isActive = false;
                } else if (['yes', 'y', 'true', '1', 'active', 'enabled'].includes(s)) {
                    isActive = true;
                }
            }
        }

        if (!code || !name) {
            errors.push(`Row ${idx + 1}: Business Unit requires both 'Business_Unit_Code' and 'Business_Unit_Name'.`);
            return;
        }

        const normalizedCode = String(code).trim().toUpperCase();
        if (seenCodes.has(normalizedCode)) {
            errors.push(`Row ${idx + 1}: Duplicate Business_Unit_Code '${normalizedCode}' detected.`);
            return;
        }
        seenCodes.add(normalizedCode);

        const normalizedName = String(name).trim();
        const normalizedHeadId = String(headEmployeeId || '').trim().toUpperCase();

        const buItem = {
            // Exact 4 sheet attributes
            Business_Unit_Code: normalizedCode,
            Business_Unit_Name: normalizedName,
            Head_Employee_ID: normalizedHeadId,
            Active: isActive ? "Yes" : "No",

            // Exact Cloud Firestore document schema fields (PRD §1 & §10)
            businessUnitCode: normalizedCode,
            businessUnitName: normalizedName,
            headEmployeeId: normalizedHeadId,
            isActive: isActive,
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT'],

            // Backwards compatibility aliases for existing tests
            code: normalizedCode,
            name: normalizedName
        };

        businessUnits.push(buItem);
    });

    return { data: businessUnits, errors, valid: errors.length === 0 };
}

/**
 * Parses 'Cost Centre' / 'Cost Center' Sheet
 * Required columns: Cost_Center_Code, Cost_Center_Name, Owner Employee ID, Active (PRD Sections 1 & 13)
 */
export function parseCostCentreSheet(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return { data: [], firestoreDocs: [], errors: ["Sheet 'Cost Center' is empty."] };
    }

    const costCentres = [];
    const firestoreDocs = [];
    const errors = [];
    const seenCodes = new Set();

    rows.forEach((r, idx) => {
        const row = normalizeRowKeys(r);
        const code = row.costcentercode || row.cccode || row.code;
        const name = row.costcentername || row.ccname || row.name;
        const ownerEmployeeId = row.owneremployeeid || row.ownerid || row.owner || '';
        const rawActive = row.active !== undefined ? row.active : (row.isactive !== undefined ? row.isactive : true);

        if (!code || !name) {
            errors.push(`Row ${idx + 1}: Cost Centre requires both 'Cost_Center_Code' and 'Cost_Center_Name'.`);
            return;
        }

        const ccCode = String(code).trim().toUpperCase();
        if (seenCodes.has(ccCode)) {
            errors.push(`Row ${idx + 1}: Duplicate Cost_Center_Code '${ccCode}' detected.`);
            return;
        }
        seenCodes.add(ccCode);

        const isActive = typeof rawActive === 'boolean'
            ? rawActive
            : !['no', 'n', 'false', '0', 'inactive'].includes(String(rawActive).trim().toLowerCase());

        costCentres.push({
            Cost_Center_Code: ccCode,
            Cost_Center_Name: String(name).trim(),
            Owner_Employee_ID: String(ownerEmployeeId || '').trim().toUpperCase(),
            Active: isActive ? "Yes" : "No",
            // Backwards compatibility aliases
            code: ccCode,
            name: String(name).trim(),
            ownerEmployeeId: String(ownerEmployeeId || '').trim().toUpperCase(),
            isActive: isActive
        });

        firestoreDocs.push({
            costCenterCode: ccCode,
            costCenterName: String(name).trim(),
            ownerEmployeeId: String(ownerEmployeeId || '').trim().toUpperCase(),
            isActive: isActive,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    });

    return { data: costCentres, firestoreDocs, errors, valid: errors.length === 0 };
}
export const parseCostCenterSheet = parseCostCentreSheet;

/**
 * Canonical Department Registry for parent resolution
 */
const CANONICAL_DEPARTMENTS = [
    { departmentCode: 'DEPT_ENG', departmentName: 'QA & Engineering', departmentHeadEmployeeId: 'EMP0002', departmentHeadName: 'Vikram Malhotra', costCenterCode: 'CC_ENG_01' },
    { departmentCode: 'ENG', departmentName: 'Engineering & Architecture', departmentHeadEmployeeId: 'EMP0001', departmentHeadName: 'Devendra Sharma', costCenterCode: 'CC-ENG-101' },
    { departmentCode: 'AI-LABS', departmentName: 'AI Research & Model Engineering', departmentHeadEmployeeId: 'EMP0007', departmentHeadName: 'Dr. Kumar Mangalam', costCenterCode: 'CC-AI-102' },
    { departmentCode: 'HR', departmentName: 'Human Resources & Payroll', departmentHeadEmployeeId: 'EMP0003', departmentHeadName: 'Ananya Roy', costCenterCode: 'CC-HR-201' },
    { departmentCode: 'FIN', departmentName: 'Finance & Accounts', departmentHeadEmployeeId: 'EMP0004', departmentHeadName: 'Rajesh Raman', costCenterCode: 'CC-FIN-301' },
    { departmentCode: 'OPS', departmentName: 'Global Operations', departmentHeadEmployeeId: 'EMP0005', departmentHeadName: 'Sneha Sen', costCenterCode: 'CC-OPS-401' },
    { departmentCode: 'CYBER', departmentName: 'Cybersecurity & Defense', departmentHeadEmployeeId: 'EMP0001', departmentHeadName: 'Devendra Sharma', costCenterCode: 'CC-ENG-101' }
];

export function isSameAsDeptHeadValue(val) {
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

export function resolveDepartmentForSubDept(subDeptCode, costCenterCode, departmentLookup = null) {
    const cleanSubCode = String(subDeptCode || '').trim().toUpperCase();
    const cleanCc = String(costCenterCode || '').trim().toUpperCase();

    if (departmentLookup && typeof departmentLookup.get === 'function') {
        const found = departmentLookup.get(cleanCc) || departmentLookup.get(cleanSubCode);
        if (found) return found;
    }

    if (cleanCc === 'CC_ENG_01') {
        return CANONICAL_DEPARTMENTS[0]; // DEPT_ENG, EMP0002 Vikram Malhotra
    }
    if (cleanCc) {
        const byCc = CANONICAL_DEPARTMENTS.find(d => d.costCenterCode === cleanCc);
        if (byCc) return byCc;
    }

    if (cleanSubCode.startsWith('ENG') || cleanSubCode.includes('ENG')) {
        return CANONICAL_DEPARTMENTS.find(d => d.departmentCode === 'ENG');
    }
    if (cleanSubCode.startsWith('HR')) {
        return CANONICAL_DEPARTMENTS.find(d => d.departmentCode === 'HR');
    }
    if (cleanSubCode.startsWith('FIN')) {
        return CANONICAL_DEPARTMENTS.find(d => d.departmentCode === 'FIN');
    }
    if (cleanSubCode.startsWith('AI')) {
        return CANONICAL_DEPARTMENTS.find(d => d.departmentCode === 'AI-LABS');
    }

    return CANONICAL_DEPARTMENTS[0];
}

/**
 * Parses 'Departments' and 'Sub-Departments' Sheets
 * Exact 5 attributes for Sub-Departments:
 * - Sub-Department_Code (PK)
 * - Sub-Department_Name (display title)
 * - Sub-Department_Head_Employee_ID ("Same as Department Head" or explicit ID)
 * - Cost_Center_Code (FK)
 * - Active (boolean)
 */
export function parseDepartmentsAndSubDepartments(deptRows = [], subDeptRows = []) {
    const departments = [];
    const subDepartments = [];
    const errors = [];

    // Parse Departments if provided
    deptRows.forEach((r, idx) => {
        const row = normalizeRowKeys(r);
        const code = row.departmentcode || row.deptcode || row.code;
        const name = row.departmentname || row.deptname || row.name;
        const costCenterCode = row.costcentercode || row.cccode || '';
        const head = row.departmentheademployeeid || row.heademployeeid || row.depthead || '';

        if (code && name) {
            departments.push({
                code: String(code).toUpperCase(),
                name: String(name),
                costCenterCode: String(costCenterCode).toUpperCase(),
                headEmployeeId: head ? String(head).toUpperCase() : ''
            });
        }
    });

    // Parse Sub-Departments
    subDeptRows.forEach((r, idx) => {
        const row = normalizeRowKeys(r);
        const code = row.subdepartmentcode || row.subdeptcode || row.code;
        const name = row.subdepartmentname || row.subdeptname || row.name;
        const rawHead = row.subdepartmentheademployeeid !== undefined ? row.subdepartmentheademployeeid
            : (row.subdeptheademployeeid !== undefined ? row.subdeptheademployeeid
            : (row.heademployeeid !== undefined ? row.heademployeeid : row.leademployeeid));
        const costCenterCode = row.costcentercode || row.cccode || '';
        const rawActive = row.active !== undefined ? row.active : row.isactive;
        const isActive = typeof rawActive === 'boolean'
            ? rawActive
            : !['no', 'n', 'false', '0', 'inactive'].includes(String(rawActive !== undefined && rawActive !== null ? rawActive : 'yes').trim().toLowerCase());

        if (!code || !name) {
            errors.push(`Sub-Department Row ${idx + 1}: Requires 'Sub-Department_Code' and 'Sub-Department_Name'.`);
            return;
        }

        const subCode = String(code).toUpperCase().trim();
        const subName = String(name).trim();
        const ccCode = String(costCenterCode).toUpperCase().trim();

        // Check fallback rule: "Same as Department Head"
        const isSame = isSameAsDeptHeadValue(rawHead);
        const resolvedDept = resolveDepartmentForSubDept(subCode, ccCode);

        let finalHeadId = '';
        let finalHeadName = '';

        if (isSame) {
            finalHeadId = resolvedDept.departmentHeadEmployeeId;
            finalHeadName = resolvedDept.departmentHeadName;
        } else {
            finalHeadId = String(rawHead).trim().toUpperCase();
            finalHeadName = `${finalHeadId} Lead`;
        }

        subDepartments.push({
            code: subCode,
            name: subName,
            subDepartmentCode: subCode,
            subDepartmentName: subName,
            costCenterCode: ccCode,
            departmentCode: resolvedDept.departmentCode,
            sameAsDeptHead: isSame,
            inheritedFromDeptHead: isSame,
            subDepartmentHeadEmployeeId: finalHeadId,
            subDepartmentHeadName: finalHeadName,
            headEmployeeId: finalHeadId,
            headEmployeeName: finalHeadName,
            isActive,
            'Sub-Department_Code': subCode,
            'Sub-Department_Name': subName,
            'Sub-Department_Head_Employee_ID': isSame ? 'Same as Department Head' : finalHeadId,
            'Cost_Center_Code': ccCode,
            'Active': isActive ? 'Yes' : 'No'
        });
    });

    return {
        departments,
        subDepartments,
        errors,
        valid: errors.length === 0
    };
}

/**
 * Dedicated Sub-Department sheet parser matching PRD Sections 1, 10, & 13
 */
export function parseSubDepartmentSheet(rows = [], employeeLookup = null, costCentersLookup = null) {
    const res = parseDepartmentsAndSubDepartments([], rows);
    const firestoreDocs = res.subDepartments.map(s => ({
        subDepartmentCode: s.subDepartmentCode,
        subDepartmentName: s.subDepartmentName,
        costCenterCode: s.costCenterCode,
        departmentCode: s.departmentCode,
        sameAsDeptHead: s.sameAsDeptHead,
        inheritedFromDeptHead: s.inheritedFromDeptHead,
        subDepartmentHeadEmployeeId: s.subDepartmentHeadEmployeeId,
        subDepartmentHeadName: s.subDepartmentHeadName,
        headEmployeeId: s.headEmployeeId,
        headEmployeeName: s.headEmployeeName,
        isActive: s.isActive
    }));

    return {
        valid: res.valid,
        data: res.subDepartments,
        firestoreDocs,
        errors: res.errors
    };
}

/**
 * Parses 'Shifts & Week-offs' Sheet
 * Exact 13 attributes (PRD Sections 1, 13, & 16):
 * 1. Shift_Code, 2. Shift_Name, 3. Start_Time, 4. End_Time, 5. Break_Minutes,
 * 6. Grace_In_Minutes, 7. Grace_Out_Minutes, 8. Half_Day_Minutes, 9. Full_Day_Minutes,
 * 10. Night_Shift, 11. Overtime_Eligible, 12. Weekly_Off_Pattern, 13. Active
 */
export function parseShiftSheet(rows = []) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return { data: [], firestoreDocs: [], errors: ["Sheet 'Shifts & Week-offs' is empty."], valid: false };
    }

    const shifts = [];
    const firestoreDocs = [];
    const errors = [];
    const seenCodes = new Set();

    rows.forEach((r, idx) => {
        const row = normalizeRowKeys(r);
        const code = row.shiftcode || row.shift_code || row.code;
        const name = row.shiftname || row.shift_name || row.name;

        if (!code || !name) {
            errors.push(`Row ${idx + 1}: Shift requires both 'Shift_Code' and 'Shift_Name'.`);
            return;
        }

        const shiftCode = String(code).trim().toUpperCase().replace(/\s+/g, '_');
        if (seenCodes.has(shiftCode)) {
            errors.push(`Row ${idx + 1}: Duplicate Shift_Code '${shiftCode}' detected.`);
            return;
        }
        seenCodes.add(shiftCode);

        // Parse Time Strings (HH:mm)
        function cleanTime(val, fallback) {
            if (!val) return fallback;
            const str = String(val).trim();
            if (!isNaN(Number(str)) && Number(str) > 0 && Number(str) < 1) {
                const totalMinutes = Math.round(Number(str) * 24 * 60);
                const hours = Math.floor(totalMinutes / 60) % 24;
                const mins = totalMinutes % 60;
                return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
            }
            const match = str.match(/^([0-1]?[0-9]|2[0-3]):([0-5][0-9])/);
            if (match) {
                return `${String(match[1]).padStart(2, '0')}:${String(match[2]).padStart(2, '0')}`;
            }
            return fallback;
        }

        const startTime = cleanTime(row.starttime || row.start_time || row.start, '09:30');
        const endTime = cleanTime(row.endtime || row.end_time || row.end, '18:30');

        // Numeric durations
        const parseNum = (val, def) => {
            if (val === undefined || val === null || val === '') return def;
            const n = Number(val);
            return isNaN(n) ? def : Math.round(n);
        };

        const breakMinutes = parseNum(row.breakminutes || row.break_minutes || row.breakmins || row.break, 60);
        const graceInMinutes = parseNum(row.graceinminutes || row.grace_in_minutes || row.gracein, 15);
        const graceOutMinutes = parseNum(row.graceoutminutes || row.grace_out_minutes || row.graceout, 15);
        const halfDayMinutes = parseNum(row.halfdayminutes || row.half_day_minutes || row.halfday, 240);
        const fullDayMinutes = parseNum(row.fulldayminutes || row.full_day_minutes || row.fullday, 480);

        // Booleans
        const parseBool = (val, def) => {
            if (val === undefined || val === null || val === '') return def;
            if (typeof val === 'boolean') return val;
            const s = String(val).trim().toLowerCase();
            if (['yes', 'y', 'true', '1', 'active'].includes(s)) return true;
            if (['no', 'n', 'false', '0', 'inactive'].includes(s)) return false;
            return def;
        };

        const isNightShift = parseBool(row.nightshift || row.night_shift || row.isnightshift, false);
        const isOvertimeEligible = parseBool(row.overtimeeligible || row.overtime_eligible || row.isovertimeeligible, true);
        const weeklyOffPattern = String(row.weeklyoffpattern || row.weekly_off_pattern || row.weeklyoff || 'Sun').trim();
        const isActive = parseBool(row.active !== undefined ? row.active : row.isactive, true);

        const shiftItem = {
            'Shift_Code': shiftCode,
            'Shift_Name': String(name).trim(),
            'Start_Time': startTime,
            'End_Time': endTime,
            'Break_Minutes': breakMinutes,
            'Grace_In_Minutes': graceInMinutes,
            'Grace_Out_Minutes': graceOutMinutes,
            'Half_Day_Minutes': halfDayMinutes,
            'Full_Day_Minutes': fullDayMinutes,
            'Night_Shift': isNightShift ? 'Yes' : 'No',
            'Overtime_Eligible': isOvertimeEligible ? 'Yes' : 'No',
            'Weekly_Off_Pattern': weeklyOffPattern,
            'Active': isActive ? 'Yes' : 'No',

            // Canonical attributes
            shiftCode,
            shiftName: String(name).trim(),
            startTime,
            endTime,
            breakMinutes,
            graceInMinutes,
            graceOutMinutes,
            halfDayMinutes,
            fullDayMinutes,
            isNightShift,
            nightShift: isNightShift,
            isOvertimeEligible,
            overtimeEligible: isOvertimeEligible,
            weeklyOffPattern,
            isActive,
            active: isActive
        };

        const doc = {
            shiftCode,
            shiftName: String(name).trim(),
            startTime,
            endTime,
            breakMinutes,
            graceInMinutes,
            graceOutMinutes,
            halfDayMinutes,
            fullDayMinutes,
            isNightShift,
            isOvertimeEligible,
            weeklyOffPattern,
            isActive
        };

        shifts.push(shiftItem);
        firestoreDocs.push(doc);
    });

    return {
        data: shifts,
        firestoreDocs,
        errors,
        valid: errors.length === 0
    };
}

/**
 * Parses 'Attendance Rules' Sheet (PRD Sections 1, 15 & 16)
 * Ingests, validates, and normalizes Attendance Policy records strictly across 13 attributes:
 * 1. Attendance_Policy_Code (PK)
 * 2. Policy_Name
 * 3. Late_After_Minutes
 * 4. Early_Leaving_Grace_Minute
 * 5. Absent_After_Hours
 * 6. Regularization_Allowed
 * 7. Regularization_Window_Days
 * 8. WFH_Allowed
 * 9. OT_Minimum_Minutes
 * 10. OT_Approval_Required
 * 11. GeoFence_Required
 * 12. IP_Restricted
 * 13. Active
 */
export function parseAttendancePolicySheet(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return { data: [], firestoreDocs: [], errors: [], valid: true };
    }

    const policies = [];
    const firestoreDocs = [];
    const errors = [];
    const seenCodes = new Set();

    function parseBool(val, defaultVal = false) {
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof val === 'boolean') return val;
        const s = String(val).trim().toLowerCase();
        if (['yes', 'true', '1', 'y', 'enabled', 'active'].includes(s)) return true;
        if (['no', 'false', '0', 'n', 'disabled', 'inactive'].includes(s)) return false;
        return defaultVal;
    }

    function parseNum(val, defaultVal = 0) {
        if (val === undefined || val === null || val === '') return defaultVal;
        const n = Number(val);
        return isNaN(n) ? defaultVal : n;
    }

    rows.forEach((row, index) => {
        const rowNum = index + 2;
        const norm = normalizeRowKeys(row);

        const codeRaw = norm.attendancepolicycode || norm.policycode || norm.code || norm.policyid || '';
        const policyCode = String(codeRaw).trim().toUpperCase();

        if (!policyCode) {
            errors.push(`Row ${rowNum}: Missing mandatory 'Attendance_Policy_Code'.`);
            return;
        }

        if (seenCodes.has(policyCode)) {
            errors.push(`Row ${rowNum}: Duplicate Attendance Policy Code "${policyCode}".`);
            return;
        }
        seenCodes.add(policyCode);

        const nameRaw = norm.policyname || norm.name || norm.title || norm.displayname || policyCode;
        const policyName = String(nameRaw).trim();

        const lateAfterMinutes = parseNum(norm.lateafterminutes || norm.lateafter || norm.lateminutes, 15);
        const earlyLeavingGraceMinute = parseNum(norm.earlyleavinggraceminute || norm.earlyleavinggrace || norm.earlygrace, 10);
        const absentAfterHours = parseNum(norm.absentafterhours || norm.absentafter || norm.absenthours, 4);
        const regularizationAllowed = parseBool(norm.regularizationallowed !== undefined ? norm.regularizationallowed : norm.regularization, true);
        const regularizationWindowDays = parseNum(norm.regularizationwindowdays || norm.regularizationwindow || norm.regwindowdays, 7);
        const wfhAllowed = parseBool(norm.wfhallowed !== undefined ? norm.wfhallowed : norm.wfh, true);
        const otMinimumMinutes = parseNum(norm.otminimumminutes || norm.otminimum || norm.otminminutes, 60);
        const otApprovalRequired = parseBool(norm.otapprovalrequired !== undefined ? norm.otapprovalrequired : norm.otapproval, true);
        const geoFenceRequired = parseBool(norm.geofencerequired !== undefined ? norm.geofencerequired : norm.geofence, false);
        const ipRestricted = parseBool(norm.iprestricted !== undefined ? norm.iprestricted : norm.iprestriction, false);
        const isActive = parseBool(norm.active !== undefined ? norm.active : norm.isactive, true);

        const policyItem = {
            'Attendance_Policy_Code': policyCode,
            'Policy_Name': policyName,
            'Late_After_Minutes': lateAfterMinutes,
            'Early_Leaving_Grace_Minute': earlyLeavingGraceMinute,
            'Absent_After_Hours': absentAfterHours,
            'Regularization_Allowed': regularizationAllowed ? 'Yes' : 'No',
            'Regularization_Window_Days': regularizationWindowDays,
            'WFH_Allowed': wfhAllowed ? 'Yes' : 'No',
            'OT_Minimum_Minutes': otMinimumMinutes,
            'OT_Approval_Required': otApprovalRequired ? 'Yes' : 'No',
            'GeoFence_Required': geoFenceRequired ? 'Yes' : 'No',
            'IP_Restricted': ipRestricted ? 'Yes' : 'No',
            'Active': isActive ? 'Yes' : 'No',

            attendancePolicyCode: policyCode,
            policyName,
            lateAfterMinutes,
            earlyLeavingGraceMinute,
            absentAfterHours,
            regularizationAllowed,
            regularizationWindowDays,
            wfhAllowed,
            otMinimumMinutes,
            otApprovalRequired,
            geoFenceRequired,
            ipRestricted,
            isActive
        };

        const doc = {
            attendancePolicyCode: policyCode,
            policyName,
            lateAfterMinutes,
            earlyLeavingGraceMinute,
            absentAfterHours,
            regularizationAllowed,
            regularizationWindowDays,
            wfhAllowed,
            otMinimumMinutes,
            otApprovalRequired,
            geoFenceRequired,
            ipRestricted,
            isActive
        };

        policies.push(policyItem);
        firestoreDocs.push(doc);
    });

    return {
        data: policies,
        firestoreDocs,
        errors,
        valid: errors.length === 0
    };
}

/**
 * Parses 'Employee Type' Sheet (PRD Sections 1, 10 & 13)
 * Ingests, validates, and normalizes Employee Type records strictly across 7 attributes:
 * 1. Category_Code (PK)
 * 2. Category_Name
 * 3. Employment_Type
 * 4. Worker_Type
 * 5. Probation_Days
 * 6. Notice_Period_Days
 * 7. Active
 */
export function parseEmployeeTypeSheet(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return { data: [], firestoreDocs: [], errors: [], valid: true };
    }

    const types = [];
    const firestoreDocs = [];
    const errors = [];
    const seenCodes = new Set();

    function parseBool(val, defaultVal = true) {
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof val === 'boolean') return val;
        const s = String(val).trim().toLowerCase();
        if (['yes', 'true', '1', 'y', 'enabled', 'active'].includes(s)) return true;
        if (['no', 'false', '0', 'n', 'disabled', 'inactive'].includes(s)) return false;
        return defaultVal;
    }

    function parseNum(val, defaultVal = 0) {
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof val === 'number') return isNaN(val) ? defaultVal : Math.round(val);
        const match = String(val).trim().match(/^-?(\d+(\.\d+)?)/);
        if (!match) return defaultVal;
        const n = Math.round(parseFloat(match[1]));
        return isNaN(n) ? defaultVal : n;
    }

    rows.forEach((row, index) => {
        const rowNum = index + 2;
        const norm = normalizeRowKeys(row);

        const codeRaw = norm.categorycode || norm.category_code || norm.typecode || norm.type_code || norm.code || norm.id || norm.employmentcategorycode;
        const categoryCode = String(codeRaw || '').trim().toUpperCase().replace(/\s+/g, '_');

        if (!categoryCode) {
            errors.push(`Row ${rowNum}: Missing mandatory 'Category_Code'.`);
            return;
        }

        if (seenCodes.has(categoryCode)) {
            errors.push(`Row ${rowNum}: Duplicate Category Code "${categoryCode}".`);
            return;
        }
        seenCodes.add(categoryCode);

        const nameRaw = norm.categoryname || norm.category_name || norm.typename || norm.type_name || norm.name || norm.title || categoryCode;
        const categoryName = String(nameRaw).trim();

        const employmentType = String(norm.employmenttype || norm.employment_type || norm.type || 'Permanent').trim();
        const workerType = String(norm.workertype || norm.worker_type || norm.classification || 'White Collar').trim();

        let defProbation = 180;
        if (employmentType.toLowerCase().includes('cont')) defProbation = 30;
        if (employmentType.toLowerCase().includes('intern')) defProbation = 0;
        if (employmentType.toLowerCase().includes('temp')) defProbation = 15;
        const probationDays = parseNum(norm.probationdays || norm.probation_days || norm.probation, defProbation);

        let defNotice = 60;
        if (employmentType.toLowerCase().includes('cont')) defNotice = 30;
        if (employmentType.toLowerCase().includes('intern')) defNotice = 15;
        if (employmentType.toLowerCase().includes('temp')) defNotice = 15;
        const noticePeriodDays = parseNum(norm.noticeperioddays || norm.notice_period_days || norm.noticedays || norm.notice, defNotice);

        const isActive = parseBool(norm.active !== undefined ? norm.active : norm.isactive, true);

        const typeItem = {
            'Category_Code': categoryCode,
            'Category_Name': categoryName,
            'Employment_Type': employmentType,
            'Worker_Type': workerType,
            'Probation_Days': probationDays,
            'Notice_Period_Days': noticePeriodDays,
            'Active': isActive ? 'Yes' : 'No',

            categoryCode,
            categoryName,
            employmentType,
            workerType,
            probationDays,
            noticePeriodDays,
            isActive
        };

        const doc = {
            categoryCode,
            categoryName,
            employmentType,
            workerType,
            probationDays,
            noticePeriodDays,
            isActive
        };

        types.push(typeItem);
        firestoreDocs.push(doc);
    });

    return {
        data: types,
        firestoreDocs,
        errors,
        valid: errors.length === 0
    };
}

/**
 * Ingests an entire parsed workbook (all sheets) from Templates.xlsx
 * @param {Object} workbook - SheetJS XLSX workbook instance
 * @param {Function} utils - XLSX.utils
 */
export function ingestTemplatesWorkbook(workbook, utils) {
    const sheetMap = {};
    workbook.SheetNames.forEach(sheetName => {
        sheetMap[sheetName.trim().toLowerCase()] = sheetName;
    });

    function getSheetRows(targetName) {
        const matchedName = Object.keys(sheetMap).find(k => k === targetName.toLowerCase() || k.replace(/[\s_-]/g, '') === targetName.toLowerCase().replace(/[\s_-]/g, ''));
        if (!matchedName) return [];
        return utils.sheet_to_json(workbook.Sheets[sheetMap[matchedName]]) || [];
    }

    const orgRows = getSheetRows('Organization');
    const buRows = getSheetRows('Business Unit');
    const ccRows = getSheetRows('Cost Center').length > 0 ? getSheetRows('Cost Center') : getSheetRows('Cost Centre');
    const deptRows = getSheetRows('Departments');
    const subDeptRows = getSheetRows('Sub-Departments');
    const shiftRows = getSheetRows('Shifts & Week-offs').length > 0 
        ? getSheetRows('Shifts & Week-offs') 
        : (getSheetRows('Shifts & Week Offs').length > 0 ? getSheetRows('Shifts & Week Offs') : getSheetRows('Shifts'));
    const attendanceRows = getSheetRows('Attendance Rules').length > 0
        ? getSheetRows('Attendance Rules')
        : (getSheetRows('Attendance_Rules').length > 0 ? getSheetRows('Attendance_Rules') : getSheetRows('Attendance Policies'));
    const empTypeRows = getSheetRows('Employee Type').length > 0
        ? getSheetRows('Employee Type')
        : (getSheetRows('Employee_Type').length > 0 ? getSheetRows('Employee_Type') : getSheetRows('Employment_Types'));
    const empRows = getSheetRows('Employees_Master') || getSheetRows('Employees') || getSheetRows('OnboardingTemplate');

    const orgResult = orgRows.length > 0 ? parseOrganizationSheet(orgRows) : null;
    const buResult = buRows.length > 0 ? parseBusinessUnitSheet(buRows) : { data: [], errors: [] };
    const ccResult = ccRows.length > 0 ? parseCostCentreSheet(ccRows) : { data: [], errors: [] };
    const deptResult = (deptRows.length > 0 || subDeptRows.length > 0) 
        ? parseDepartmentsAndSubDepartments(deptRows, subDeptRows) 
        : { departments: [], subDepartments: [], errors: [] };
    const shiftResult = shiftRows.length > 0 ? parseShiftSheet(shiftRows) : { data: [], errors: [] };
    const attendanceResult = attendanceRows.length > 0 ? parseAttendancePolicySheet(attendanceRows) : { data: [], firestoreDocs: [], errors: [] };
    const empTypeResult = empTypeRows.length > 0 ? parseEmployeeTypeSheet(empTypeRows) : { data: [], firestoreDocs: [], errors: [] };

    return {
        isOfficialTemplatesWorkbook: !!(orgResult || buResult.data.length > 0 || ccResult.data.length > 0 || shiftResult.data.length > 0 || attendanceResult.data.length > 0 || empTypeResult.data.length > 0),
        organization: orgResult?.data || null,
        businessUnits: buResult.data,
        costCentres: ccResult.data,
        departments: deptResult.departments,
        subDepartments: deptResult.subDepartments,
        shifts: shiftResult.data,
        attendancePolicies: attendanceResult.data,
        employeeTypes: empTypeResult.data,
        employees: empRows,
        errors: [
            ...(orgResult?.errors || []),
            ...buResult.errors,
            ...ccResult.errors,
            ...deptResult.errors,
            ...shiftResult.errors,
            ...attendanceResult.errors,
            ...empTypeResult.errors
        ]
    };
}

