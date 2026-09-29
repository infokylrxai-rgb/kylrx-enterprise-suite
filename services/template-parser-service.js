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
 * Parses 'Business Unit' Sheet
 * Required columns: Business_Unit_Code, Business_Unit_Name, Head_Employee_ID
 */
export function parseBusinessUnitSheet(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return { data: [], errors: ["Sheet 'Business Unit' is empty."] };
    }

    const businessUnits = [];
    const errors = [];

    rows.forEach((r, idx) => {
        const row = normalizeRowKeys(r);
        const code = row.businessunitcode || row.bucode || row.code;
        const name = row.businessunitname || row.buname || row.name;
        const headEmployeeId = row.heademployeeid || row.headid || '';

        if (!code || !name) {
            errors.push(`Row ${idx + 1}: Business Unit requires both 'Business_Unit_Code' and 'Business_Unit_Name'.`);
            return;
        }

        businessUnits.push({
            code: String(code).toUpperCase(),
            name: String(name),
            headEmployeeId: String(headEmployeeId || '')
        });
    });

    return { data: businessUnits, errors, valid: errors.length === 0 };
}

/**
 * Parses 'Cost Centre' Sheet
 * Required columns: Cost_Center_Code, Cost_Center_Name, Owner Employee ID
 */
export function parseCostCentreSheet(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return { data: [], errors: ["Sheet 'Cost Centre' is empty."] };
    }

    const costCentres = [];
    const errors = [];

    rows.forEach((r, idx) => {
        const row = normalizeRowKeys(r);
        const code = row.costcentercode || row.cccode || row.code;
        const name = row.costcentername || row.ccname || row.name;
        const ownerEmployeeId = row.owneremployeeid || row.ownerid || row.owner || '';

        if (!code || !name) {
            errors.push(`Row ${idx + 1}: Cost Centre requires both 'Cost_Center_Code' and 'Cost_Center_Name'.`);
            return;
        }

        costCentres.push({
            code: String(code).toUpperCase(),
            name: String(name),
            ownerEmployeeId: String(ownerEmployeeId || '')
        });
    });

    return { data: costCentres, errors, valid: errors.length === 0 };
}

/**
 * Parses 'Departments' and 'Sub-Departments' Sheets
 * Required columns: Sub-Department_Code, Sub-Department_Name, Cost_Center_Code
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

        if (code && name) {
            departments.push({
                code: String(code).toUpperCase(),
                name: String(name),
                costCenterCode: String(costCenterCode).toUpperCase()
            });
        }
    });

    // Parse Sub-Departments
    subDeptRows.forEach((r, idx) => {
        const row = normalizeRowKeys(r);
        const code = row.subdepartmentcode || row.subdeptcode || row.code;
        const name = row.subdepartmentname || row.subdeptname || row.name;
        const costCenterCode = row.costcentercode || row.cccode || '';

        if (!code || !name) {
            errors.push(`Sub-Department Row ${idx + 1}: Requires 'Sub-Department_Code' and 'Sub-Department_Name'.`);
            return;
        }

        subDepartments.push({
            code: String(code).toUpperCase(),
            name: String(name),
            costCenterCode: String(costCenterCode).toUpperCase()
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
    const ccRows = getSheetRows('Cost Centre');
    const deptRows = getSheetRows('Departments');
    const subDeptRows = getSheetRows('Sub-Departments');
    const empRows = getSheetRows('Employees_Master') || getSheetRows('Employees') || getSheetRows('OnboardingTemplate');

    const orgResult = orgRows.length > 0 ? parseOrganizationSheet(orgRows) : null;
    const buResult = buRows.length > 0 ? parseBusinessUnitSheet(buRows) : { data: [], errors: [] };
    const ccResult = ccRows.length > 0 ? parseCostCentreSheet(ccRows) : { data: [], errors: [] };
    const deptResult = (deptRows.length > 0 || subDeptRows.length > 0) 
        ? parseDepartmentsAndSubDepartments(deptRows, subDeptRows) 
        : { departments: [], subDepartments: [], errors: [] };

    return {
        isOfficialTemplatesWorkbook: !!(orgResult || buResult.data.length > 0 || ccResult.data.length > 0),
        organization: orgResult?.data || null,
        businessUnits: buResult.data,
        costCentres: ccResult.data,
        departments: deptResult.departments,
        subDepartments: deptResult.subDepartments,
        employees: empRows,
        errors: [
            ...(orgResult?.errors || []),
            ...buResult.errors,
            ...ccResult.errors,
            ...deptResult.errors
        ]
    };
}
