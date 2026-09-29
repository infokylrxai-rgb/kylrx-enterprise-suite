import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('PRD Section 13: Employee Job Details and Official Documents Subsystem', () => {

    describe('1. Employee Profile Service & Schema Normalization', async () => {
        const serviceModule = await import('../services/employee-profile-service.js');
        const exported = serviceModule.default || serviceModule;
        const service = typeof exported === 'function' ? new exported() : (exported.normalizeJobDetails ? exported : new exported.EmployeeProfileService());

        test('Normalizes complete job information according to PRD §13 & Templates.xlsx', () => {
            const rawInput = {
                Designation_Code: 'SR_DEV',
                Department_Code: 'ENG',
                'Sub-Department_Code': 'ENG_BACKEND',
                Business_Unit_Code: 'BU_TECH',
                Cost_Center_Code: 'CC_DEV',
                Location_Code: 'LOC_BLR',
                Shift_Code: 'SHIFT_GEN',
                Work_Mode: 'Hybrid',
                Employment_Category_Code: 'FULL_TIME',
                Date_of_Joining: '2026-01-15',
                Probation_End_Date: '2026-07-15',
                Notice_Period_Days: 60,
                annualSalary: 1800000
            };

            const job = service.normalizeJobDetails(rawInput);

            assert.equal(job.designationCode, 'SR_DEV');
            assert.equal(job.departmentCode, 'ENG');
            assert.equal(job.subDepartmentCode, 'ENG_BACKEND');
            assert.equal(job.businessUnitCode, 'BU_TECH');
            assert.equal(job.costCenterCode, 'CC_DEV');
            assert.equal(job.locationCode, 'LOC_BLR');
            assert.equal(job.shiftCode, 'SHIFT_GEN');
            assert.equal(job.workMode, 'Hybrid');
            assert.equal(job.employmentCategory, 'FULL_TIME');
            assert.equal(job.dateOfJoining, '2026-01-15');
            assert.equal(job.probationEndDate, '2026-07-15');
            assert.equal(job.noticePeriodDays, 60);
            assert.equal(job.annualSalary, 1800000);
        });

        test('Normalizes managerial hierarchy and dynamically resolves manager names', () => {
            const mockEmployees = [
                {
                    employeeId: 'EMP0003',
                    fullName: 'Sarah Connor',
                    designation: 'DES-EM',
                    department: 'ENG'
                },
                {
                    employeeId: 'EMP0001',
                    fullName: 'John Connor',
                    designation: 'DES-DIR',
                    department: 'EXEC'
                }
            ];

            const rawInput = {
                Reporting_Manager_ID: 'EMP0003',
                Secondary_Manager_ID: 'EMP0001'
            };

            const managers = service.normalizeManagers(rawInput, mockEmployees);

            assert.equal(managers.l1ManagerId, 'EMP0003');
            assert.equal(managers.l2ManagerId, 'EMP0001');
            assert.equal(managers.l1ManagerName, 'Sarah Connor (DES-EM)');
            assert.equal(managers.l2ManagerName, 'John Connor (DES-DIR)');
        });

        test('Normalizes official statutory compliance identifiers (PF, ESI, PAN, Aadhaar Last 4)', () => {
            const rawStatutory = {
                UAN: '100904829102',
                pfMemberId: 'KN/BNG/0012345/000/00012',
                epfoEstablishmentId: 'KN/BNG/0012345',
                ESIC_IP: '3100482910',
                esicEmployerCode: '31001234560000001',
                dispensaryBranch: 'Indiranagar Branch',
                PAN: 'abcde1234f',
                aadhaarLast4: '123456789021' // Expect last 4 digits
            };

            const statutory = service.normalizeStatutory(rawStatutory);

            assert.equal(statutory.uan, '100904829102');
            assert.equal(statutory.pfMemberId, 'KN/BNG/0012345/000/00012');
            assert.equal(statutory.epfoEstablishmentId, 'KN/BNG/0012345');
            assert.equal(statutory.esicIpNumber, '3100482910');
            assert.equal(statutory.esicEmployerCode, '31001234560000001');
            assert.equal(statutory.dispensaryBranch, 'Indiranagar Branch');
            assert.equal(statutory.pan, 'ABCDE1234F'); // Uppercased
            assert.equal(statutory.aadhaarLast4, '9021'); // Last 4 digits only
        });

        test('Normalizes documents metadata and validates document types', () => {
            const rawDocs = [
                {
                    docId: 'doc_offer_01',
                    docType: 'OFFER_LETTER',
                    fileName: 'Signed_Offer_Letter.pdf',
                    storagePath: 'employees/EMP0012/documents/Signed_Offer_Letter.pdf',
                    downloadUrl: 'https://firebasestorage.googleapis.com/...',
                    fileSize: 1048576,
                    mimeType: 'application/pdf'
                }
            ];

            const docs = service.normalizeDocuments(rawDocs);

            assert.equal(docs.length, 1);
            assert.equal(docs[0].docId, 'doc_offer_01');
            assert.equal(docs[0].docType, 'OFFER_LETTER');
            assert.equal(docs[0].fileName, 'Signed_Offer_Letter.pdf');
            assert.equal(docs[0].storagePath, 'employees/EMP0012/documents/Signed_Offer_Letter.pdf');
            assert.ok(docs[0].uploadedAt);
        });

        test('Builds complete composite employee profile schema for employees/{employeeId}', () => {
            const rawData = {
                employeeId: 'EMP0012',
                name: 'Alex Mercer',
                email: 'alex.mercer@kylrx.ai',
                jobDetails: {
                    designationCode: 'SR_DEV',
                    departmentCode: 'ENG',
                    subDepartmentCode: 'ENG_BACKEND',
                    businessUnitCode: 'BU_TECH',
                    costCenterCode: 'CC_DEV',
                    workMode: 'Hybrid',
                    dateOfJoining: '2026-01-15',
                    employmentCategory: 'FULL_TIME',
                    probationEndDate: '2026-07-15',
                    noticePeriodDays: 60
                },
                managers: {
                    l1ManagerId: 'EMP0003',
                    l2ManagerId: 'EMP0001'
                },
                statutory: {
                    uan: '100904829102',
                    pfMemberId: 'KN/BNG/0012345/000/00012',
                    esicIpNumber: '3100482910',
                    pan: 'ABCDE1234F',
                    aadhaarLast4: '9021'
                },
                documents: [
                    {
                        docId: 'doc_offer_01',
                        docType: 'OFFER_LETTER',
                        fileName: 'Signed_Offer_Letter.pdf',
                        storagePath: 'employees/EMP0012/documents/Signed_Offer_Letter.pdf',
                        downloadUrl: 'https://firebasestorage.googleapis.com/...'
                    }
                ]
            };

            const profile = service.formatEmployeeProfile('EMP0012', rawData);

            assert.equal(profile.employeeId, 'EMP0012');
            assert.ok(profile.jobDetails);
            assert.equal(profile.jobDetails.designationCode, 'SR_DEV');
            assert.ok(profile.managers);
            assert.equal(profile.managers.l1ManagerId, 'EMP0003');
            assert.ok(profile.statutory);
            assert.equal(profile.statutory.uan, '100904829102');
            assert.ok(Array.isArray(profile.documents));
            assert.equal(profile.documents.length, 1);
            assert.equal(profile.documents[0].docType, 'OFFER_LETTER');
        });
    });

    describe('2. Firebase Storage & Firestore Security Rules', () => {
        test('storage.rules contains employee document storage rules with path employees/{employeeId}/documents/{fileName}', () => {
            const storageRules = fs.readFileSync(path.join(rootDir, 'storage.rules'), 'utf-8');
            assert.match(storageRules, /match\s+\/employees\/\{employeeId\}\/documents\/\{fileName\}/);
            assert.match(storageRules, /ownsEmployeeRecord\(employeeId\)/);
            assert.match(storageRules, /isStaff\(\)/);
        });

        test('firestore.rules protects employees collection and official documents', () => {
            const firestoreRules = fs.readFileSync(path.join(rootDir, 'firestore.rules'), 'utf-8');
            assert.match(firestoreRules, /match\s+\/employees\/\{employeeId\}/);
            assert.match(firestoreRules, /match\s+\/documents\/\{docId\}/);
        });
    });

    describe('3. Employee Profile Tabbed UI in admin-dashboard.html', () => {
        const dashboardHtml = fs.readFileSync(path.join(rootDir, 'admin-dashboard.html'), 'utf-8');

        test('Contains 4 structured tabs in #empModal for PRD Section 13', () => {
            assert.match(dashboardHtml, /id="emp-tab-btn-job"/);
            assert.match(dashboardHtml, /id="emp-tab-btn-managers"/);
            assert.match(dashboardHtml, /id="emp-tab-btn-statutory"/);
            assert.match(dashboardHtml, /id="emp-tab-btn-documents"/);
            assert.match(dashboardHtml, /id="empDocsCountBadge"/);
        });

        test('Contains corresponding 4 tab content panels', () => {
            assert.match(dashboardHtml, /id="emp-tab-content-job"/);
            assert.match(dashboardHtml, /id="emp-tab-content-managers"/);
            assert.match(dashboardHtml, /id="emp-tab-content-statutory"/);
            assert.match(dashboardHtml, /id="emp-tab-content-documents"/);
        });

        test('Job Details tab contains comprehensive job fields according to Templates.xlsx schema', () => {
            assert.match(dashboardHtml, /id="deptSelect"/);
            assert.match(dashboardHtml, /id="subDeptSelect"/);
            assert.match(dashboardHtml, /id="designationSelect"/);
            assert.match(dashboardHtml, /id="buSelect"/);
            assert.match(dashboardHtml, /id="costCenterCodeSelect"/);
            assert.match(dashboardHtml, /id="locationCodeSelect"/);
            assert.match(dashboardHtml, /id="shiftCodeSelect"/);
            assert.match(dashboardHtml, /id="workModeSelect"/);
            assert.match(dashboardHtml, /id="employeeTypeSelect"/);
            assert.match(dashboardHtml, /id="empJoiningDate"/);
            assert.match(dashboardHtml, /id="empProbationEndDate"/);
            assert.match(dashboardHtml, /id="empNoticePeriodDays"/);
        });

        test('Reporting Managers tab contains L1 and L2 managerial hierarchy linkages and dynamic badges', () => {
            assert.match(dashboardHtml, /id="l1ManagerSelect"/);
            assert.match(dashboardHtml, /id="l2ManagerSelect"/);
            assert.match(dashboardHtml, /id="l1ManagerBadgeInfo"/);
            assert.match(dashboardHtml, /id="l2ManagerBadgeInfo"/);
        });

        test('Statutory tab contains PF (UAN, Member ID, EPFO Est ID), ESI (IP, Employer Code, Dispensary), PAN, Aadhaar', () => {
            assert.match(dashboardHtml, /id="uanInput"/);
            assert.match(dashboardHtml, /id="pfMemberIdInput"/);
            assert.match(dashboardHtml, /id="epfoEstablishmentIdInput"/);
            assert.match(dashboardHtml, /id="esicIpInput"/);
            assert.match(dashboardHtml, /id="esicEmployerCodeInput"/);
            assert.match(dashboardHtml, /id="dispensaryBranchInput"/);
            assert.match(dashboardHtml, /id="panInput"/);
            assert.match(dashboardHtml, /id="aadhaarLast4Input"/);
        });

        test('Official Documents tab contains upload zone, category selector, and documents list container', () => {
            assert.match(dashboardHtml, /id="empDocTypeSelect"/);
            assert.match(dashboardHtml, /id="empDocFileInput"/);
            assert.match(dashboardHtml, /id="btnUploadEmpDoc"/);
            assert.match(dashboardHtml, /id="empDocProgressContainer"/);
            assert.match(dashboardHtml, /id="empDocProgressBar"/);
            assert.match(dashboardHtml, /id="empDocsListContainer"/);
        });

        test('Contains Document Preview Modal and EmployeeProfileController script reference', () => {
            assert.match(dashboardHtml, /id="docPreviewModal"/);
            assert.match(dashboardHtml, /id="docPreviewContent"/);
            assert.match(dashboardHtml, /id="btnDocPreviewDownload"/);
            assert.match(dashboardHtml, /<script src="employee-profile-controller\.js"><\/script>/);
        });
    });

    describe('4. ES6 Employee Profile Controller (employee-profile-controller.js)', () => {
        const controllerCode = fs.readFileSync(path.join(rootDir, 'employee-profile-controller.js'), 'utf-8');

        test('Defines all required controller methods', () => {
            assert.match(controllerCode, /function switchTab/);
            assert.match(controllerCode, /function openProfileModal/);
            assert.match(controllerCode, /function resetProfileModal/);
            assert.match(controllerCode, /function getCurrentDocuments/);
            assert.match(controllerCode, /function handleFileSelection/);
            assert.match(controllerCode, /function uploadDocument/);
            assert.match(controllerCode, /function previewDocument/);
            assert.match(controllerCode, /function downloadDocument/);
            assert.match(controllerCode, /function deleteDocument/);
            assert.match(controllerCode, /function updateManagerBadges/);
            assert.match(controllerCode, /function renderDocumentsTable/);
        });

        test('Validates file mime-types (PDF, JPEG, PNG) and enforces 10MB size limit', () => {
            assert.match(controllerCode, /MAX_FILE_SIZE_BYTES\s*=\s*10\s*\*\s*1024\s*\*\s*1024/);
            assert.match(controllerCode, /ALLOWED_MIME_TYPES/);
            assert.match(controllerCode, /application\/pdf/);
            assert.match(controllerCode, /image\/jpeg/);
            assert.match(controllerCode, /image\/png/);
        });

        test('Integrates with Firebase Cloud Storage uploadBytesResumable and Firestore persistence', () => {
            assert.match(controllerCode, /uploadBytesResumable/);
            assert.match(controllerCode, /getDownloadURL/);
            assert.match(controllerCode, /storagePath/);
            assert.match(controllerCode, /employees\/\$\{employeeId\}\/documents/);
        });
    });

    describe('5. REST API Routes and Controllers', () => {
        const routesCode = fs.readFileSync(path.join(rootDir, 'routes', 'admin.js'), 'utf-8');
        const adminControllerCode = fs.readFileSync(path.join(rootDir, 'controllers', 'adminController.js'), 'utf-8');

        test('admin routes declare profile and document endpoints', () => {
            assert.match(routesCode, /router\.get\("\/employees\/:id\/profile",\s*adminController\.getEmployeeProfile\)/);
            assert.match(routesCode, /router\.put\("\/employees\/:id\/profile",\s*adminController\.updateEmployeeProfile\)/);
            assert.match(routesCode, /router\.post\("\/employees\/:id\/documents",\s*adminController\.uploadEmployeeDocument\)/);
            assert.match(routesCode, /router\.delete\("\/employees\/:id\/documents\/:docId",\s*adminController\.deleteEmployeeDocument\)/);
        });

        test('adminController implements getEmployeeProfile, updateEmployeeProfile, uploadEmployeeDocument, and deleteEmployeeDocument', () => {
            assert.match(adminControllerCode, /exports\.getEmployeeProfile\s*=/);
            assert.match(adminControllerCode, /exports\.updateEmployeeProfile\s*=/);
            assert.match(adminControllerCode, /exports\.uploadEmployeeDocument\s*=/);
            assert.match(adminControllerCode, /exports\.deleteEmployeeDocument\s*=/);
        });
    });

    describe('6. Integration with admin-app.js', () => {
        const adminAppCode = fs.readFileSync(path.join(rootDir, 'admin-app.js'), 'utf-8');

        test('openEditModal connects to window.EmployeeProfileController.openProfileModal', () => {
            assert.match(adminAppCode, /window\.EmployeeProfileController\.openProfileModal\(id\)/);
        });

        test('empForm submit handler saves structured jobDetails, managers, statutory, and documents', () => {
            assert.match(adminAppCode, /jobDetails:\s*\{/);
            assert.match(adminAppCode, /managers:\s*\{/);
            assert.match(adminAppCode, /statutory:\s*\{/);
            assert.match(adminAppCode, /documents:\s*currentDocs/);
            assert.match(adminAppCode, /costCenterCode:\s*costCenterCode/);
            assert.match(adminAppCode, /locationCode:\s*data\.locationCode/);
            assert.match(adminAppCode, /shiftCode:\s*data\.shiftCode/);
            assert.match(adminAppCode, /workMode:\s*data\.workMode/);
        });

        test('New personnel creation triggers resetProfileModal', () => {
            assert.match(adminAppCode, /window\.EmployeeProfileController\.resetProfileModal\(\)/);
        });
    });
});
