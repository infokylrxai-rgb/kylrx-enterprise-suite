/**
 * Kylrx.ai - Employee Profile & Official Documents Service (PRD Section 13)
 * Implements comprehensive job information, managerial hierarchy resolution,
 * statutory compliance data (PF & ESI), and official document storage repository.
 */

class EmployeeProfileService {
    constructor() {
        this.documentTypes = [
            { code: 'OFFER_LETTER', name: 'Signed Offer Letter', mandatory: true },
            { code: 'SIGNED_NDA', name: 'Non-Disclosure Agreement (NDA)', mandatory: true },
            { code: 'AADHAAR_CARD', name: 'Aadhaar Card (Identity Proof)', mandatory: true },
            { code: 'PAN_CARD', name: 'PAN Card (Tax Identification)', mandatory: true },
            { code: 'BANK_PROOF', name: 'Bank Passbook / Cancelled Cheque', mandatory: true },
            { code: 'EDUCATION_CERTIFICATE', name: 'Highest Degree Certificate', mandatory: false },
            { code: 'EXPERIENCE_LETTER', name: 'Previous Experience / Relieving Letter', mandatory: false },
            { code: 'OTHER', name: 'Other Official Document', mandatory: false }
        ];

        this.standardDesignations = [
            { code: 'DES-SE', name: 'Software Engineer', dept: 'ENG' },
            { code: 'DES-SSE', name: 'Senior Software Engineer', dept: 'ENG' },
            { code: 'DES-EM', name: 'Engineering Manager', dept: 'ENG' },
            { code: 'DES-HRO', name: 'HR Operations Specialist', dept: 'HR' },
            { code: 'DES-FIN', name: 'Financial Analyst', dept: 'FIN' },
            { code: 'DES-DIR', name: 'Director / VP', dept: 'EXEC' },
            { code: 'DES-STF', name: 'General Staff', dept: 'GEN' }
        ];

        this.standardLocations = [
            { code: 'LOC-BLR', name: 'Bangalore Tech Park (HQ)', isHq: true },
            { code: 'LOC-MUM', name: 'Mumbai Commercial Hub', isHq: false },
            { code: 'LOC-DEL', name: 'Delhi NCR Hub', isHq: false },
            { code: 'LOC-HYD', name: 'Hyderabad Tech Center', isHq: false }
        ];

        this.standardShifts = [
            { code: 'SHIFT-GEN', name: 'General Shift (09:00 - 18:00)', hours: 9 },
            { code: 'SHIFT-MOR', name: 'Morning Shift (06:00 - 15:00)', hours: 9 },
            { code: 'SHIFT-EVE', name: 'Evening Shift (14:00 - 23:00)', hours: 9 },
            { code: 'SHIFT-NIT', name: 'Night Shift (22:00 - 07:00)', hours: 9 }
        ];
    }

    /**
     * Normalize Job Details strictly according to PRD §13 and Templates.xlsx
     */
    normalizeJobDetails(data = {}) {
        const raw = data.jobDetails || data;
        const doj = raw.dateOfJoining || raw.joiningDate || raw['Date_of_Joining'] || new Date().toISOString().split('T')[0];

        // Default probation end date to 90 days or 6 months if not specified
        let probation = raw.probationEndDate || raw['Probation_End_Date'] || '';
        if (!probation && doj) {
            const dojDate = new Date(doj);
            if (!isNaN(dojDate.getTime())) {
                dojDate.setMonth(dojDate.getMonth() + 6);
                probation = dojDate.toISOString().split('T')[0];
            }
        }

        return {
            designationCode: raw.designationCode || raw.designation || raw['Designation_Code'] || 'DES-SE',
            departmentCode: raw.departmentCode || raw.departmentId || raw['Department_Code'] || 'ENG',
            subDepartmentCode: raw.subDepartmentCode || raw['Sub-Department_Code'] || 'ENG-BACKEND',
            businessUnitCode: raw.businessUnitCode || raw['Business_Unit_Code'] || 'BU-TECH',
            costCenterCode: raw.costCenterCode || raw['Cost_Center_Code'] || 'CC-ENG-101',
            locationCode: raw.locationCode || raw['Location_Code'] || 'LOC-BLR',
            shiftCode: raw.shiftCode || raw['Shift_Code'] || 'SHIFT-GEN',
            workMode: raw.workMode || raw['Work_Mode'] || 'Hybrid',
            employmentCategory: raw.employmentCategory || raw.employmentCategoryCode || raw.employeeType || raw['Employment_Category_Code'] || raw['Employment_Type'] || 'FULL_TIME',
            employmentCategoryCode: raw.employmentCategoryCode || raw.employmentCategory || raw.employeeType || 'FULL_TIME',
            dateOfJoining: doj,
            probationEndDate: probation,
            noticePeriodDays: Number(raw.noticePeriodDays || raw['Notice_Period_Days'] || 60),
            annualSalary: Number(raw.annualSalary || raw.salary || 0)
        };
    }

    /**
     * Resolve Manager Hierarchy & Names dynamically from IDs
     */
    normalizeManagers(data = {}, allEmployees = []) {
        const raw = data.managers || data;
        const l1Id = raw.l1ManagerId || raw.reportingManagerId || raw.reportingManager || raw['Reporting_Manager_ID'] || '';
        const l2Id = raw.l2ManagerId || raw.secondaryManagerId || raw.secondaryManager || raw['Secondary_Manager_ID'] || '';

        const resolveName = (managerId) => {
            if (!managerId) return 'Not Assigned';
            if (managerId === 'Self' || managerId === 'SELF') return 'Self (Top Level)';
            const match = allEmployees.find(e => 
                e.employeeId === managerId || e.id === managerId || e.uid === managerId
            );
            if (match) {
                const designation = match.jobDetails?.designationCode || match.designation || match.role || '';
                return designation ? `${match.name || match.fullName} (${designation})` : (match.name || match.fullName);
            }
            return managerId;
        };

        return {
            l1ManagerId: l1Id,
            l1ManagerName: resolveName(l1Id),
            reportingManagerId: l1Id,
            l2ManagerId: l2Id,
            l2ManagerName: resolveName(l2Id),
            secondaryManagerId: l2Id
        };
    }

    /**
     * Normalize Statutory (PF, ESI, Tax, Identity) details
     */
    normalizeStatutory(data = {}) {
        const raw = data.statutory || data;
        return {
            uan: String(raw.uan || raw['UAN'] || '').trim(),
            pfMemberId: String(raw.pfMemberId || raw['PF_Member_ID'] || (raw.uan ? `KN/BNG/0012345/000/${String(raw.uan).slice(-5)}` : '')).trim(),
            epfoEstablishmentId: String(raw.epfoEstablishmentId || raw['EPFO_Establishment_ID'] || 'KN/BNG/0012345').trim(),
            esicIpNumber: String(raw.esicIpNumber || raw.esicIp || raw['ESIC_IP'] || '').trim(),
            esicEmployerCode: String(raw.esicEmployerCode || raw['ESIC_Employer_Code'] || '31001234560000001').trim(),
            dispensaryBranch: String(raw.dispensaryBranch || raw['Dispensary_Branch'] || 'Indiranagar Branch').trim(),
            pan: String(raw.pan || raw['PAN'] || '').toUpperCase().trim(),
            aadhaarLast4: String(raw.aadhaarLast4 || raw['Aadhaar_Last_4'] || '').trim().slice(-4)
        };
    }

    /**
     * Normalize Documents Array
     */
    normalizeDocuments(docs = []) {
        if (!Array.isArray(docs)) return [];
        return docs.map(doc => ({
            docId: doc.docId || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            docType: doc.docType || doc.category || 'OTHER',
            fileName: doc.fileName || doc.name || 'document.pdf',
            storagePath: doc.storagePath || '',
            downloadUrl: doc.downloadUrl || doc.url || '',
            fileSize: Number(doc.fileSize || doc.size || 0),
            mimeType: doc.mimeType || 'application/pdf',
            uploadedAt: doc.uploadedAt || new Date().toISOString()
        }));
    }

    /**
     * Format Complete Employee Record to PRD §13 canonical schema
     */
    formatEmployeeProfile(idOrRaw = {}, rawOrAll = [], maybeAll = []) {
        let raw = idOrRaw;
        let allEmployees = Array.isArray(rawOrAll) ? rawOrAll : (Array.isArray(maybeAll) ? maybeAll : []);
        if (typeof idOrRaw === 'string') {
            raw = { ...(rawOrAll || {}), employeeId: idOrRaw };
        }
        const employeeId = raw.employeeId || raw.id || raw.uid || (typeof idOrRaw === 'string' ? idOrRaw : 'EMP0001');
        const jobDetails = this.normalizeJobDetails(raw);
        const managers = this.normalizeManagers(raw, allEmployees);
        const statutory = this.normalizeStatutory(raw);
        const documents = this.normalizeDocuments(raw.documents);

        return {
            employeeId,
            id: employeeId,
            uid: raw.uid || employeeId,
            name: raw.name || raw.fullName || 'Employee Name',
            fullName: raw.name || raw.fullName || 'Employee Name',
            email: raw.email || '',
            phone: raw.phone || '',
            address: raw.address || '',
            role: raw.role || 'employee',
            status: raw.status || 'Active',
            jobDetails,
            managers,
            statutory,
            documents,
            // Flat backward-compatible aliases for legacy forms & sheet sync
            designationCode: jobDetails.designationCode,
            'Designation_Code': jobDetails.designationCode,
            departmentCode: jobDetails.departmentCode,
            'Department_Code': jobDetails.departmentCode,
            subDepartmentCode: jobDetails.subDepartmentCode,
            'Sub-Department_Code': jobDetails.subDepartmentCode,
            businessUnitCode: jobDetails.businessUnitCode,
            'Business_Unit_Code': jobDetails.businessUnitCode,
            costCenterCode: jobDetails.costCenterCode,
            'Cost_Center_Code': jobDetails.costCenterCode,
            locationCode: jobDetails.locationCode,
            'Location_Code': jobDetails.locationCode,
            shiftCode: jobDetails.shiftCode,
            'Shift_Code': jobDetails.shiftCode,
            workMode: jobDetails.workMode,
            'Work_Mode': jobDetails.workMode,
            employmentCategoryCode: jobDetails.employmentCategoryCode,
            'Employment_Category_Code': jobDetails.employmentCategoryCode,
            reportingManagerId: managers.reportingManagerId,
            'Reporting_Manager_ID': managers.reportingManagerId,
            secondaryManagerId: managers.secondaryManagerId,
            'Secondary_Manager_ID': managers.secondaryManagerId,
            uan: statutory.uan,
            'UAN': statutory.uan,
            esicIp: statutory.esicIpNumber,
            'ESIC_IP': statutory.esicIpNumber,
            pan: statutory.pan,
            'PAN': statutory.pan,
            aadhaarLast4: statutory.aadhaarLast4,
            'Aadhaar_Last_4': statutory.aadhaarLast4,
            dateOfJoining: jobDetails.dateOfJoining,
            'Date_of_Joining': jobDetails.dateOfJoining,
            probationEndDate: jobDetails.probationEndDate,
            'Probation_End_Date': jobDetails.probationEndDate,
            noticePeriodDays: jobDetails.noticePeriodDays,
            'Notice_Period_Days': jobDetails.noticePeriodDays,
            updatedAt: new Date().toISOString()
        };
    }
}

const instance = new EmployeeProfileService();
instance.EmployeeProfileService = EmployeeProfileService;
module.exports = instance;
