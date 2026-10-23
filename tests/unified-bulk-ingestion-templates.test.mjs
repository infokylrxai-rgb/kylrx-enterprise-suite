/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - UNIFIED BULK INGESTION TEMPLATES TEST SUITE
 * ============================================================================
 * 
 * Comprehensive Unit & Integration Tests matching PRD Sections 1, 3, 4, 11, & 13:
 * 1. Unified Template 1: 'Employee Job & Roster Updates' (jobRosterParser.js)
 * 2. Unified Template 2: 'Employee Financial & Statutory IDs' (employeeFinanceParser.js)
 * 3. Unified Template 3: 'Organization Compliance Registrations' (orgComplianceParser.js)
 * 4. Consolidated Service Pipeline: (unifiedIngestionService.js)
 *    - Atomic writes across collections
 *    - Historical versioning in organizations/{orgId}/employee_job_history/{employeeId}/records
 *    - Sub-collection routing for Bank, EPFO, ESIC, NPS
 *    - Decentro Penny Drop automated triggers
 *    - Master compliance storage & default auto-propagation
 * 5. UI Integration & DOM Contracts in admin-onboarding-upload.html
 * 
 * @version 2.0.0
 * @author Principal Full-Stack & Enterprise Systems Architect
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper to load UMD modules cleanly
function loadUmdModule(fileName) {
    let filePath = path.join(rootDir, fileName);
    if (!fs.existsSync(filePath)) {
        filePath = path.join(rootDir, 'services', fileName);
    }
    if (!fs.existsSync(filePath)) {
        const kebab = fileName.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
        filePath = path.join(rootDir, 'services', kebab);
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const mod = { exports: {} };
    const fn = new Function('module', 'exports', 'require', content);
    fn(mod, mod.exports, require);
    return mod.exports;
}

// Load our modules
const jobRosterParser = loadUmdModule('jobRosterParser.js');
const employeeFinanceParser = loadUmdModule('employeeFinanceParser.js');
const orgComplianceParser = loadUmdModule('orgComplianceParser.js');
const unifiedIngestionService = loadUmdModule('unifiedIngestionService.js');

describe('🚀 Kylrx.ai Enterprise HRMS - Unified Bulk Ingestion Architecture Test Suite', () => {

    // =========================================================================
    // 1. UNIFIED TEMPLATE 1: EMPLOYEE JOB & ROSTER UPDATES PARSER
    // =========================================================================
    describe('1. Unified Template 1: Employee Job & Roster Updates (PRD §§ 1 & 3)', () => {
        it('1.1 Should validate and normalize valid Job & Roster records with exact 11 header fields', () => {
            const rawRows = [
                {
                    'Employee_ID': 'EMP0001',
                    'Organization_ID': 'ORG_KYLRX_CORP',
                    'Effective_Date': '2026-04-01',
                    'Department_Code': 'DEP_ENG',
                    'Designation_Title': 'Staff Software Architect',
                    'Annual_CTC': '3600000',
                    'Shift_Roster_Code': 'SHIFT_GEN_9_6',
                    'Week_Off_Pattern': 'SAT_SUN_FIXED',
                    'Custom_Week_Off_Days': 'Saturday,Sunday',
                    'Reason_For_Update': 'Annual Promotion & Band Upgrade',
                    'Active': 'Yes'
                },
                {
                    'Employee_ID': 'EMP0002',
                    'Organization_ID': 'ORG_KYLRX_CORP',
                    'Effective_Date': '2026-04-01',
                    'Department_Code': 'DEP_FIN',
                    'Designation_Title': 'Senior Financial Analyst',
                    'Annual_CTC': '1800000',
                    'Shift_Roster_Code': 'SHIFT_ROT_NIGHT',
                    'Week_Off_Pattern': 'ROTATIONAL_5_DAY',
                    'Custom_Week_Off_Days': 'Monday,Tuesday',
                    'Reason_For_Update': 'Shift Rotation',
                    'Active': 'Yes'
                }
            ];

            const result = jobRosterParser.parseArray(rawRows);
            assert.strictEqual(result.success, true, 'Parsing should succeed for valid records');
            assert.strictEqual(result.count, 2);
            assert.strictEqual(result.validCount, 2);
            assert.strictEqual(result.invalidCount, 0);

            const rec1 = result.validRows[0];
            assert.strictEqual(rec1.Employee_ID, 'EMP0001');
            assert.strictEqual(rec1.Department_Code, 'DEP_ENG');
            assert.strictEqual(rec1.Designation_Title, 'Staff Software Architect');
            assert.strictEqual(rec1.Annual_CTC, 3600000);
            assert.strictEqual(rec1.Week_Off_Pattern, 'SAT_SUN_FIXED');
            assert.strictEqual(rec1.Active, true);
        });

        it('1.2 Should normalize case-insensitive synonym variations in Job & Roster headers', () => {
            const messyRows = [
                {
                    'emp_id': 'EMP0010',
                    'tenant_id': 'ORG_KYLRX_CORP',
                    'start_date': '2026-05-01',
                    'dept': 'DEP_HR',
                    'role': 'HR Operations Specialist',
                    'ctc': '₹ 12,00,000',
                    'shift': 'SHIFT_MORNING',
                    'weekly_off': 'Sunday Only',
                    'remarks': 'Annual Increment',
                    'status': 'Active'
                }
            ];

            const result = jobRosterParser.parseArray(messyRows);
            assert.strictEqual(result.success, true);
            const rec = result.validRows[0];
            assert.strictEqual(rec.Employee_ID, 'EMP0010');
            assert.strictEqual(rec.Department_Code, 'DEP_HR');
            assert.strictEqual(rec.Designation_Title, 'HR Operations Specialist');
            assert.strictEqual(rec.Annual_CTC, 1200000);
            assert.strictEqual(rec.Week_Off_Pattern, 'SUN_ONLY');
            assert.strictEqual(rec.Active, true);
        });

        it('1.3 Should reject rows with missing mandatory fields or invalid CTC numbers', () => {
            const invalidRows = [
                {
                    'Employee_ID': '', // Missing
                    'Department_Code': 'DEP_ENG',
                    'Designation_Title': 'Engineer',
                    'Annual_CTC': '500000'
                },
                {
                    'Employee_ID': 'EMP0020',
                    'Department_Code': 'DEP_OPS',
                    'Designation_Title': 'Ops Lead',
                    'Annual_CTC': 'INVALID_CTC_AMOUNT' // Invalid number
                },
                {
                    'Employee_ID': 'EMP0021',
                    'Department_Code': 'DEP_OPS',
                    'Designation_Title': 'Support Specialist',
                    'Annual_CTC': '600000',
                    'Week_Off_Pattern': 'CUSTOM_WEEK_OFF',
                    'Custom_Week_Off_Days': '' // Missing custom days for custom pattern
                }
            ];

            const result = jobRosterParser.parseArray(invalidRows);
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.invalidCount, 3);
            assert.strictEqual(result.validCount, 0);
            assert.ok(result.errors.length >= 3);
        });

        it('1.4 Should generate valid sample CSV template for Job & Roster', () => {
            const csv = jobRosterParser.generateTemplateCSV();
            assert.ok(csv.includes('Employee_ID'));
            assert.ok(csv.includes('Annual_CTC'));
            assert.ok(csv.includes('Shift_Roster_Code'));
            assert.ok(csv.includes('Week_Off_Pattern'));
        });
    });

    // =========================================================================
    // 2. UNIFIED TEMPLATE 2: EMPLOYEE FINANCIAL & STATUTORY IDS PARSER
    // =========================================================================
    describe('2. Unified Template 2: Employee Financial & Statutory IDs (PRD §§ 1, 4, 11 & 13)', () => {
        it('2.1 Should validate IFSC, PAN, UAN, and ESIC codes with strict regex validation', () => {
            const validRows = [
                {
                    'Employee_ID': 'EMP0001',
                    'Organization_ID': 'ORG_KYLRX_CORP',
                    'Bank_Account_Number': '123456789012',
                    'Bank_IFSC_Code': 'HDFC0000060',
                    'Bank_Name': 'HDFC Bank',
                    'Account_Holder_Name': 'Arun Kumar',
                    'UAN': '100123456789',
                    'ESIC_IP_Number': '1122334455',
                    'PAN_Number': 'ABCDE1234F',
                    'PRAN': '123456789012',
                    'Primary_Disbursement_Method': 'BANK_TRANSFER',
                    'Verification_Status': 'PENDING_VERIFICATION'
                }
            ];

            const result = employeeFinanceParser.parseArray(validRows);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.validCount, 1);
            const rec = result.validRows[0];
            assert.strictEqual(rec.Bank_IFSC_Code, 'HDFC0000060');
            assert.strictEqual(rec.PAN_Number, 'ABCDE1234F');
            assert.strictEqual(rec.UAN, '100123456789');
            assert.strictEqual(rec.ESIC_IP_Number, '1122334455');
            assert.strictEqual(rec.PRAN, '123456789012');
            assert.strictEqual(rec.Requires_Penny_Drop, true, 'Pending verification should flag Decentro Penny Drop');
            assert.strictEqual(rec.Masked_Account_Number, '••••••••9012');
            assert.strictEqual(rec.Masked_PAN, 'ABCDE••••F');
        });

        it('2.2 Should detect and flag invalid IFSC, invalid PAN, and invalid UAN', () => {
            const badRows = [
                {
                    'Employee_ID': 'EMP0001',
                    'Bank_Account_Number': '123456789',
                    'Bank_IFSC_Code': 'INVALID_IFSC', // Invalid
                    'Bank_Name': 'HDFC Bank',
                    'Account_Holder_Name': 'Arun Kumar',
                    'PAN_Number': 'INVALID_PAN', // Invalid
                    'UAN': '12345' // Non-12 digits
                }
            ];

            const result = employeeFinanceParser.parseArray(badRows);
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.invalidCount, 1);
            const rec = result.invalidRows[0];
            assert.ok(rec.errors.some(e => e.includes('Bank_IFSC_Code')));
            assert.ok(rec.errors.some(e => e.includes('PAN_Number')));
            assert.ok(rec.errors.some(e => e.includes('UAN')));
        });

        it('2.3 Should correctly identify and count pending Decentro Penny Drop verification requests', () => {
            const mixedRows = [
                {
                    'Employee_ID': 'EMP0001',
                    'Bank_Account_Number': '123456789012',
                    'Bank_IFSC_Code': 'HDFC0000060',
                    'Bank_Name': 'HDFC Bank',
                    'Account_Holder_Name': 'Arun Kumar',
                    'PAN_Number': 'ABCDE1234F',
                    'Verification_Status': 'PENDING_VERIFICATION'
                },
                {
                    'Employee_ID': 'EMP0002',
                    'Bank_Account_Number': '987654321098',
                    'Bank_IFSC_Code': 'ICIC0000024',
                    'Bank_Name': 'ICICI Bank',
                    'Account_Holder_Name': 'Priya Sharma',
                    'PAN_Number': 'XYZPK5678M',
                    'Verification_Status': 'VERIFIED'
                }
            ];

            const result = employeeFinanceParser.parseArray(mixedRows);
            assert.strictEqual(result.validCount, 2);
            assert.strictEqual(result.pendingPennyDropCount, 1);
        });
    });

    // =========================================================================
    // 3. UNIFIED TEMPLATE 3: ORGANIZATION COMPLIANCE REGISTRATIONS PARSER
    // =========================================================================
    describe('3. Unified Template 3: Organization Compliance Registrations (PRD §§ 1, 4 & 11)', () => {
        it('3.1 Should validate 17-digit ESIC, EPFO, Signatory PAN, and parse delimiter State PTRC/LWF mappings', () => {
            const rawRows = [
                {
                    'Organization_ID': 'ORG_KYLRX_CORP',
                    'Legal_Entity_Name': 'Kylrx Technologies Private Limited',
                    'EPFO_Establishment_Code': 'KN/BNG/0012345/000',
                    'ESIC_Employer_Code': '53000123456780001',
                    'State_PT_Registrations': 'KA:PTRC12345|MH:PTRC67890|TN:PTRC11223',
                    'State_LWF_Registrations': 'KA:LWF/KA/2026/01|MH:LWF/MH/2026/02',
                    'NPS_Corporate_Head_Office_ID': 'CHO1098765',
                    'NPS_POP_SP_Registration_No': 'POP987654321',
                    'Authorized_Signatory_PAN': 'AAACK1234F',
                    'Effective_From': '2026-01-01',
                    'Active': 'Yes'
                }
            ];

            const result = orgComplianceParser.parseArray(rawRows);
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.validCount, 1);

            const rec = result.validRows[0];
            assert.strictEqual(rec.Organization_ID, 'ORG_KYLRX_CORP');
            assert.strictEqual(rec.ESIC_Employer_Code, '53000123456780001');
            assert.strictEqual(rec.Authorized_Signatory_PAN, 'AAACK1234F');
            assert.strictEqual(rec.State_PT_Map['KA'], 'PTRC12345');
            assert.strictEqual(rec.State_PT_Map['MH'], 'PTRC67890');
            assert.strictEqual(rec.State_PT_Map['TN'], 'PTRC11223');
            assert.strictEqual(rec.State_LWF_Map['KA'], 'LWF/KA/2026/01');
        });

        it('3.2 Should parse JSON string format for State PTRC and LWF registrations', () => {
            const jsonStateRow = [
                {
                    'Organization_ID': 'ORG_KYLRX_CORP',
                    'Legal_Entity_Name': 'Kylrx AI Inc',
                    'EPFO_Establishment_Code': 'KN/BNG/0012345/000',
                    'ESIC_Employer_Code': '53000123456780001',
                    'State_PT_Registrations': JSON.stringify([
                        { state: 'KA', ptrc: 'KA_PTRC_999' },
                        { state: 'DL', ptrc: 'DL_PTRC_888' }
                    ]),
                    'Authorized_Signatory_PAN': 'AAACK1234F',
                    'Active': true
                }
            ];

            const result = orgComplianceParser.parseArray(jsonStateRow);
            assert.strictEqual(result.success, true);
            const rec = result.validRows[0];
            assert.strictEqual(rec.State_PT_Map['KA'], 'KA_PTRC_999');
            assert.strictEqual(rec.State_PT_Map['DL'], 'DL_PTRC_888');
        });

        it('3.3 Should reject rows with invalid ESIC Employer Code (not 17 digits) or invalid Signatory PAN', () => {
            const badRows = [
                {
                    'Organization_ID': 'ORG_KYLRX_CORP',
                    'Legal_Entity_Name': 'Kylrx Technologies',
                    'EPFO_Establishment_Code': 'KN/BNG/0012345/000',
                    'ESIC_Employer_Code': '12345', // Too short (must be 17 digits)
                    'Authorized_Signatory_PAN': 'BAD_PAN' // Invalid PAN
                }
            ];

            const result = orgComplianceParser.parseArray(badRows);
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.invalidCount, 1);
            const rec = result.invalidRows[0];
            assert.ok(rec.errors.some(e => e.includes('ESIC_Employer_Code')));
            assert.ok(rec.errors.some(e => e.includes('Authorized_Signatory_PAN')));
        });
    });

    // =========================================================================
    // 4. CONSOLIDATED SERVICE MODULE & DISPATCH PIPELINE
    // =========================================================================
    describe('4. Consolidated Service Pipeline (unifiedIngestionService.js)', () => {
        it('4.1 Should compute standard salary breakdowns and generate atomic payloads with historical versioning', async () => {
            const records = [
                {
                    Employee_ID: 'EMP0001',
                    Organization_ID: 'ORG_KYLRX_CORP',
                    Effective_Date: '2026-04-01',
                    Department_Code: 'DEP_ENG',
                    Designation_Title: 'Lead Architect',
                    Annual_CTC: 2400000,
                    Shift_Roster_Code: 'SHIFT_GEN_9_6',
                    Week_Off_Pattern: 'SAT_SUN_FIXED',
                    Custom_Week_Off_Days: 'Saturday,Sunday',
                    Reason_For_Update: 'Annual Increment',
                    Active: true
                }
            ];

            const result = await unifiedIngestionService.ingestJobRosterBatch(records, { dryRun: true });
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.successCount, 1);

            const rec = result.records[0];
            assert.strictEqual(rec.employeeId, 'EMP0001');
            assert.strictEqual(rec.salaryPayload.monthlyGross, 200000);
            assert.strictEqual(rec.salaryPayload.basic, 100000); // 50% Basic
            assert.strictEqual(rec.salaryPayload.hra, 40000); // 40% of Basic
            assert.strictEqual(rec.salaryPayload.specialAllowance, 60000); // Remainder

            // Verify historical versioning snapshot
            assert.strictEqual(result.historySnapshots.length, 1);
            const hist = result.historySnapshots[0];
            assert.strictEqual(hist.employeeId, 'EMP0001');
            assert.strictEqual(hist.reasonForUpdate, 'Annual Increment');
            assert.strictEqual(hist.annualCtc, 2400000);
            assert.ok(hist.recordId.startsWith('JOB_HIST'));
        });

        it('4.2 Should disburse financial data across target sub-collections and trigger Decentro Penny Drop', async () => {
            const finRecords = [
                {
                    Employee_ID: 'EMP0001',
                    Organization_ID: 'ORG_KYLRX_CORP',
                    Bank_Account_Number: '987654321012',
                    Bank_IFSC_Code: 'HDFC0000060',
                    Bank_Name: 'HDFC Bank',
                    Account_Holder_Name: 'Arun Kumar',
                    UAN: '100123456789',
                    ESIC_IP_Number: '1122334455',
                    PAN_Number: 'ABCDE1234F',
                    PRAN: '123456789012',
                    Primary_Disbursement_Method: 'BANK_TRANSFER',
                    Verification_Status: 'PENDING_VERIFICATION',
                    Requires_Penny_Drop: true
                }
            ];

            const result = await unifiedIngestionService.ingestEmployeeFinanceBatch(finRecords, { dryRun: true });
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.successCount, 1);
            assert.strictEqual(result.pennyDropTriggerCount, 1);

            const rec = result.records[0];
            // Bank sub-collection payload
            assert.strictEqual(rec.bankPayload.bankAccountNumber, '987654321012');
            assert.strictEqual(rec.bankPayload.bankIfscCode, 'HDFC0000060');
            // EPFO sub-collection payload
            assert.strictEqual(rec.pfPayload.uan, '100123456789');
            assert.strictEqual(rec.pfPayload.pfEnrolled, true);
            // ESIC sub-collection payload
            assert.strictEqual(rec.esicPayload.esicIpNumber, '1122334455');
            assert.strictEqual(rec.esicPayload.esicEnrolled, true);
            // NPS sub-collection payload
            assert.strictEqual(rec.npsPayload.pran, '123456789012');
            assert.strictEqual(rec.npsPayload.npsEnrolled, true);

            // Penny Drop transaction
            assert.strictEqual(rec.pennyDropTriggered, true);
            assert.ok(rec.pennyDropDetails.transactionRefId.startsWith('DEC_PD_'));
            assert.strictEqual(rec.pennyDropDetails.provider, 'DECENTRO');
        });

        it('4.3 Should store master statutory profile and prepare auto-propagation defaults', async () => {
            const orgRecords = [
                {
                    Organization_ID: 'ORG_KYLRX_CORP',
                    Legal_Entity_Name: 'Kylrx Technologies Private Limited',
                    EPFO_Establishment_Code: 'KN/BNG/0012345/000',
                    ESIC_Employer_Code: '53000123456780001',
                    State_PT_Registrations: 'KA:PTRC12345|MH:PTRC67890',
                    State_PT_Map: { KA: 'PTRC12345', MH: 'PTRC67890' },
                    State_LWF_Registrations: 'KA:LWF/KA/2026/01',
                    State_LWF_Map: { KA: 'LWF/KA/2026/01' },
                    Authorized_Signatory_PAN: 'AAACK1234F',
                    Effective_From: '2026-01-01',
                    Active: true
                }
            ];

            const result = await unifiedIngestionService.ingestOrgComplianceBatch(orgRecords, { dryRun: true });
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.successCount, 1);

            const rec = result.records[0];
            assert.strictEqual(rec.statutoryMasterPayload.orgId, 'ORG_KYLRX_CORP');
            assert.strictEqual(rec.statutoryMasterPayload.epfoEstablishmentCode, 'KN/BNG/0012345/000');
            assert.strictEqual(rec.statutoryDefaultsPayload.defaultPfEstablishmentCode, 'KN/BNG/0012345/000');
            assert.strictEqual(rec.statutoryDefaultsPayload.autoPropagated, true);
        });
    });

    // =========================================================================
    // 5. UI DOM & SCRIPT INTEGRATION CONTRACTS
    // =========================================================================
    describe('5. UI Architecture & View Integration in admin-onboarding-upload.html', () => {
        it('5.1 Should verify that admin-onboarding-upload.html contains all 3 Unified Tab buttons and View Containers', () => {
            const htmlPath = path.join(rootDir, 'admin-onboarding-upload.html');
            const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

            // Tab buttons
            assert.ok(htmlContent.includes('id="tabUnifiedJobRoster"'), 'Must have tabUnifiedJobRoster button');
            assert.ok(htmlContent.includes('id="tabUnifiedEmployeeFinance"'), 'Must have tabUnifiedEmployeeFinance button');
            assert.ok(htmlContent.includes('id="tabUnifiedOrgCompliance"'), 'Must have tabUnifiedOrgCompliance button');

            // View containers
            assert.ok(htmlContent.includes('id="unifiedJobRosterView"'), 'Must have unifiedJobRosterView container');
            assert.ok(htmlContent.includes('id="unifiedEmployeeFinanceView"'), 'Must have unifiedEmployeeFinanceView container');
            assert.ok(htmlContent.includes('id="unifiedOrgComplianceView"'), 'Must have unifiedOrgComplianceView container');

            assert.ok(htmlContent.includes('src="jobRosterParser.js"'), 'Must load jobRosterParser.js');
            assert.ok(htmlContent.includes('src="employeeFinanceParser.js"') || htmlContent.includes('src="services/employee-finance-parser.js"'), 'Must load employeeFinanceParser.js');
            assert.ok(htmlContent.includes('src="orgComplianceParser.js"'), 'Must load orgComplianceParser.js');
            assert.ok(htmlContent.includes('src="unifiedIngestionService.js"'), 'Must load unifiedIngestionService.js');
            assert.ok(htmlContent.includes('src="unifiedIngestionUIController.js"'), 'Must load unifiedIngestionUIController.js');
        });
    });
});
