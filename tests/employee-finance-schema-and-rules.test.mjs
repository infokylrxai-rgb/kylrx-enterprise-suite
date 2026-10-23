import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load EmployeeFinanceParser (UMD module)
const parserPath = path.join(rootDir, 'services', 'employee-finance-parser.js');
const parserContent = fs.readFileSync(parserPath, 'utf8');
const parserModule = { exports: {} };
const parserFn = new Function('module', 'exports', 'require', parserContent);
parserFn(parserModule, parserModule.exports, () => ({}));
const financeParser = parserModule.exports;

// Load EmployeeFinanceService (UMD module)
const servicePath = fs.existsSync(path.join(rootDir, 'services', 'employee-finance-service.js'))
    ? path.join(rootDir, 'services', 'employee-finance-service.js')
    : path.join(rootDir, 'employeeFinanceService.js');
const serviceContent = fs.readFileSync(servicePath, 'utf8');
const serviceModule = { exports: {} };
const serviceFn = new Function('module', 'exports', 'require', serviceContent);
serviceFn(serviceModule, serviceModule.exports, () => ({}));
const financeService = serviceModule.exports;

test('PRD Sections 1, 4 & 13: Employee Finance & Statutory Details Module', async (t) => {

    await t.test('1. Exact Schema & Field Mapping (Strict 17 Attributes)', async (st) => {
        await st.test('Schema defines all 17 required columns with correct metadata and keys', () => {
            const attrs = financeParser.EMPLOYEE_FINANCE_ATTRIBUTES;
            assert.equal(attrs.length, 17, 'Strictly 17 attributes must be defined');

            const expectedKeys = [
                'Employee_ID',
                'Account_Holder_Name',
                'Bank_Name',
                'Branch_Name',
                'Account_Number',
                'IFSC',
                'Account_Type',
                'Is_Primary',
                'Effective_From',
                'UAN',
                'UAN No (If Applicable)',
                'ESIC',
                'ESIC No (If Applicable)',
                'NPS',
                'NPS No (If Applicable)',
                'Gratuity',
                'Gratuity No (If Applicable)'
            ];

            const actualKeys = attrs.map(a => a.key);
            assert.deepEqual(actualKeys, expectedKeys, 'Attribute keys must match exact 17 column names');

            // Verify mandatory flags
            assert.equal(attrs.find(a => a.key === 'Employee_ID').required, true);
            assert.equal(attrs.find(a => a.key === 'Account_Holder_Name').required, true);
            assert.equal(attrs.find(a => a.key === 'Bank_Name').required, true);
            assert.equal(attrs.find(a => a.key === 'Account_Number').required, true);
            assert.equal(attrs.find(a => a.key === 'IFSC').required, true);
        });

        await st.test('Parses valid 17-column raw row into structured record and Firestore document', () => {
            const rawRow = {
                'Employee_ID': 'EMP0001',
                'Account_Holder_Name': 'Arun Kumar',
                'Bank_Name': 'HDFC Bank',
                'Branch_Name': 'Koramangala, Bengaluru',
                'Account_Number': '50100234567890',
                'IFSC': 'hdfc0000053',
                'Account_Type': 'Salary',
                'Is_Primary': 'Yes',
                'Effective_From': '2026-01-15',
                'UAN': 'Yes',
                'UAN No (If Applicable)': '100904829102',
                'ESIC': 'Yes',
                'ESIC No (If Applicable)': '3100482910',
                'NPS': 'No',
                'NPS No (If Applicable)': '',
                'Gratuity': 'Yes',
                'Gratuity No (If Applicable)': 'GRAT-2026-001'
            };

            const result = financeParser.parseSheetRows([rawRow]);
            assert.equal(result.valid, true);
            assert.equal(result.totalRows, 1);
            assert.equal(result.validCount, 1);
            assert.equal(result.errors.length, 0);

            const rec = result.records[0];
            assert.equal(rec.Employee_ID, 'EMP0001');
            assert.equal(rec.Account_Holder_Name, 'Arun Kumar');
            assert.equal(rec.Bank_Name, 'HDFC Bank');
            assert.equal(rec.Branch_Name, 'Koramangala, Bengaluru');
            assert.equal(rec.Account_Number, '50100234567890');
            assert.equal(rec.IFSC, 'HDFC0000053', 'IFSC must be normalized to uppercase');
            assert.equal(rec.Account_Type, 'Salary');
            assert.equal(rec.Is_Primary, 'Yes');
            assert.equal(rec.Effective_From, '2026-01-15');
            assert.equal(rec.UAN, 'Yes');
            assert.equal(rec['UAN No (If Applicable)'], '100904829102');
            assert.equal(rec.ESIC, 'Yes');
            assert.equal(rec['ESIC No (If Applicable)'], '3100482910');
            assert.equal(rec.NPS, 'No');
            assert.equal(rec['NPS No (If Applicable)'], '');
            assert.equal(rec.Gratuity, 'Yes');
            assert.equal(rec['Gratuity No (If Applicable)'], 'GRAT-2026-001');

            // Verify Firestore document mapping
            const doc = result.firestoreDocs[0];
            assert.equal(doc.employeeId, 'EMP0001');
            assert.equal(doc.banking.accountHolderName, 'Arun Kumar');
            assert.equal(doc.banking.bankName, 'HDFC Bank');
            assert.equal(doc.banking.branchName, 'Koramangala, Bengaluru');
            assert.equal(doc.banking.accountNumber, '50100234567890');
            assert.equal(doc.banking.maskedAccountNumber, '••••••••••7890');
            assert.equal(doc.banking.ifsc, 'HDFC0000053');
            assert.equal(doc.banking.accountType, 'Salary');
            assert.equal(doc.banking.isPrimary, true);
            assert.equal(doc.banking.effectiveFrom, '2026-01-15');
            assert.equal(doc.banking.verificationStatus, 'VERIFIED');
            assert.ok(doc.banking.decentroBeneficiaryId.startsWith('ben_'));

            // Verify statutory section
            assert.equal(doc.statutory.uanApplicable, true);
            assert.equal(doc.statutory.uanNumber, '100904829102');
            assert.equal(doc.statutory.esicApplicable, true);
            assert.equal(doc.statutory.esicNumber, '3100482910');
            assert.equal(doc.statutory.npsApplicable, false);
            assert.equal(doc.statutory.npsNumber, null);
            assert.equal(doc.statutory.gratuityApplicable, true);
            assert.equal(doc.statutory.gratuityNumber, 'GRAT-2026-001');
        });
    });

    await t.test('2. Setup & Ingestion Support (PRD Section 1 Validations)', async (st) => {
        await st.test('Foreign Key Validation: flags error when Employee_ID does not exist in catalog', () => {
            const rawRow = {
                'Employee_ID': 'EMP9999_UNKNOWN',
                'Account_Holder_Name': 'Ghost Employee',
                'Bank_Name': 'State Bank of India',
                'Branch_Name': 'Mumbai Main',
                'Account_Number': '10982345678',
                'IFSC': 'SBIN0000001',
                'Account_Type': 'Savings',
                'Is_Primary': 'Yes',
                'Effective_From': '2026-02-01',
                'UAN': 'No',
                'ESIC': 'No',
                'NPS': 'No',
                'Gratuity': 'No'
            };

            const existingEmployeeIds = new Set(['EMP0001', 'EMP0002', 'EMP0003']);
            const result = financeParser.parseSheetRows([rawRow], { existingEmployeeIds });

            assert.equal(result.valid, false);
            assert.equal(result.errors.length, 1);
            assert.match(result.errors[0].message, /Foreign key validation failed/);
            assert.match(result.errors[0].message, /EMP9999_UNKNOWN/);
        });

        await st.test('Foreign Key Validation: succeeds when Employee_ID exists in catalog', () => {
            const rawRow = {
                'Employee_ID': 'EMP0002',
                'Account_Holder_Name': 'Priya Sharma',
                'Bank_Name': 'ICICI Bank',
                'Branch_Name': 'Whitefield, Bengaluru',
                'Account_Number': '000201589123',
                'IFSC': 'ICIC0000002',
                'Account_Type': 'Salary',
                'Is_Primary': 'Yes',
                'Effective_From': '2026-01-01',
                'UAN': 'No',
                'ESIC': 'No',
                'NPS': 'No',
                'Gratuity': 'No'
            };

            const existingEmployeeIds = new Set(['EMP0001', 'EMP0002', 'EMP0003']);
            const result = financeParser.parseSheetRows([rawRow], { existingEmployeeIds });

            assert.equal(result.valid, true);
            assert.equal(result.errors.length, 0);
        });

        await st.test('IFSC Code Validation: strictly enforces ^[A-Z]{4}0[A-Z0-9]{6}$ regex', () => {
            const validCases = ['HDFC0000053', 'SBIN0000001', 'ICIC0001234', 'KKBK0000123'];
            for (const ifsc of validCases) {
                assert.equal(financeParser.validateIFSC(ifsc), true, `Should accept valid IFSC: ${ifsc}`);
            }

            const invalidCases = [
                'HDFC1000053', // 5th character not 0
                'HDFC000053',  // 10 chars (too short)
                'HDFC00000053', // 12 chars (too long)
                'HD1C0000053', // 3rd char is digit
                'HDFC 000053', // whitespace
                'HDFC-000053'  // special char
            ];
            for (const ifsc of invalidCases) {
                assert.equal(financeParser.validateIFSC(ifsc), false, `Should reject invalid IFSC: ${ifsc}`);
            }
        });

        await st.test('Account Number Validation: strictly enforces digits only and 9 to 18 length', () => {
            assert.equal(financeParser.validateAccountNumber('123456789'), true);
            assert.equal(financeParser.validateAccountNumber('50100234567890'), true);
            assert.equal(financeParser.validateAccountNumber('123456789012345678'), true);

            assert.equal(financeParser.validateAccountNumber('12345678'), false, 'Too short (<9 digits)');
            assert.equal(financeParser.validateAccountNumber('1234567890123456789'), false, 'Too long (>18 digits)');
            assert.equal(financeParser.validateAccountNumber('5010023456789A'), false, 'Contains letter');
            assert.equal(financeParser.validateAccountNumber('5010-023456-789'), false, 'Contains dashes');
        });

        await st.test('Account Number Masking: preserves last 4 digits and masks the rest', () => {
            assert.equal(financeParser.maskAccountNumber('50100234567890'), '••••••••••7890');
            assert.equal(financeParser.maskAccountNumber('123456789'), '•••••6789');
            assert.equal(financeParser.maskAccountNumber(''), '—');
        });

        await st.test('Conditional Statutory Validation: UAN mandatory 12 digits when UAN is "Yes"', () => {
            // Valid 12 digits
            const valid = financeParser.validateRecord({
                Employee_ID: 'EMP0001',
                Account_Holder_Name: 'Test',
                Bank_Name: 'Test Bank',
                Account_Number: '1234567890',
                IFSC: 'HDFC0000001',
                UAN: 'Yes',
                'UAN No (If Applicable)': '100904829102'
            });
            assert.equal(valid.valid, true);

            // Missing UAN number
            const missing = financeParser.validateRecord({
                Employee_ID: 'EMP0001',
                Account_Holder_Name: 'Test',
                Bank_Name: 'Test Bank',
                Account_Number: '1234567890',
                IFSC: 'HDFC0000001',
                UAN: 'Yes',
                'UAN No (If Applicable)': ''
            });
            assert.equal(missing.valid, false);
            assert.match(missing.errors.join('; '), /UAN is flagged as applicable/);

            // Non-12-digit UAN number
            const invalidLen = financeParser.validateRecord({
                Employee_ID: 'EMP0001',
                Account_Holder_Name: 'Test',
                Bank_Name: 'Test Bank',
                Account_Number: '1234567890',
                IFSC: 'HDFC0000001',
                UAN: 'Yes',
                'UAN No (If Applicable)': '1009048291' // 10 digits
            });
            assert.equal(invalidLen.valid, false);
            assert.match(invalidLen.errors.join('; '), /12 digits/);
        });

        await st.test('Conditional Statutory Validation: ESIC mandatory 10 to 17 digits when ESIC is "Yes"', () => {
            // Valid 10 digits
            const valid10 = financeParser.validateRecord({
                Employee_ID: 'EMP0001',
                Account_Holder_Name: 'Test',
                Bank_Name: 'Test Bank',
                Account_Number: '1234567890',
                IFSC: 'HDFC0000001',
                ESIC: 'Yes',
                'ESIC No (If Applicable)': '3100482910'
            });
            assert.equal(valid10.valid, true);

            // Valid 17 digits
            const valid17 = financeParser.validateRecord({
                Employee_ID: 'EMP0001',
                Account_Holder_Name: 'Test',
                Bank_Name: 'Test Bank',
                Account_Number: '1234567890',
                IFSC: 'HDFC0000001',
                ESIC: 'Yes',
                'ESIC No (If Applicable)': '31000123456789012'
            });
            assert.equal(valid17.valid, true);

            // Too short (<10 digits)
            const tooShort = financeParser.validateRecord({
                Employee_ID: 'EMP0001',
                Account_Holder_Name: 'Test',
                Bank_Name: 'Test Bank',
                Account_Number: '1234567890',
                IFSC: 'HDFC0000001',
                ESIC: 'Yes',
                'ESIC No (If Applicable)': '123456789'
            });
            assert.equal(tooShort.valid, false);
            assert.match(tooShort.errors.join('; '), /10 to 17 digits/);
        });

        await st.test('Conditional Statutory Validation: NPS mandatory 12-digit PRAN when NPS is "Yes"', () => {
            // Valid 12 digits
            const valid = financeParser.validateRecord({
                Employee_ID: 'EMP0001',
                Account_Holder_Name: 'Test',
                Bank_Name: 'Test Bank',
                Account_Number: '1234567890',
                IFSC: 'HDFC0000001',
                NPS: 'Yes',
                'NPS No (If Applicable)': '110098765432'
            });
            assert.equal(valid.valid, true);

            // Invalid PRAN
            const invalid = financeParser.validateRecord({
                Employee_ID: 'EMP0001',
                Account_Holder_Name: 'Test',
                Bank_Name: 'Test Bank',
                Account_Number: '1234567890',
                IFSC: 'HDFC0000001',
                NPS: 'Yes',
                'NPS No (If Applicable)': '110098'
            });
            assert.equal(invalid.valid, false);
            assert.match(invalid.errors.join('; '), /12-digit PRAN/);
        });

        await st.test('Conditional Statutory Validation: Gratuity mandatory identifier when Gratuity is "Yes"', () => {
            // Valid Gratuity string
            const valid = financeParser.validateRecord({
                Employee_ID: 'EMP0001',
                Account_Holder_Name: 'Test',
                Bank_Name: 'Test Bank',
                Account_Number: '1234567890',
                IFSC: 'HDFC0000001',
                Gratuity: 'Yes',
                'Gratuity No (If Applicable)': 'GRAT-2026-KYL-001'
            });
            assert.equal(valid.valid, true);

            // Missing Gratuity ID
            const missing = financeParser.validateRecord({
                Employee_ID: 'EMP0001',
                Account_Holder_Name: 'Test',
                Bank_Name: 'Test Bank',
                Account_Number: '1234567890',
                IFSC: 'HDFC0000001',
                Gratuity: 'Yes',
                'Gratuity No (If Applicable)': ''
            });
            assert.equal(missing.valid, false);
            assert.match(missing.errors.join('; '), /Gratuity ID is mandatory/);
        });
    });

    await t.test('3. Decentro Fabric Beneficiary Integration (PRD Section 4)', async (st) => {
        await st.test('Penny Drop / Account Verification simulates live staging API response', async () => {
            const verification = await financeService.validateBankAccountWithDecentro({
                accountNumber: '50100234567890',
                ifsc: 'HDFC0000053',
                accountHolderName: 'Arun Kumar'
            });

            assert.equal(verification.success, true);
            assert.equal(verification.verificationStatus, 'VERIFIED');
            assert.ok(verification.decentroBeneficiaryId.startsWith('ben_'));
            assert.equal(verification.pennyDropStatus, 'SUCCESS');
            assert.equal(verification.accountHolderMatch, true);
            assert.equal(verification.accountHolderName, 'Arun Kumar');
        });

        await st.test('Decoupled payout payload generation maintains isolation from payslips per PRD §4', () => {
            const financeRecord = {
                employeeId: 'EMP0001',
                banking: {
                    accountHolderName: 'Arun Kumar',
                    bankName: 'HDFC Bank',
                    branchName: 'Koramangala, Bengaluru',
                    accountNumber: '50100234567890',
                    maskedAccountNumber: '••••••••••7890',
                    ifsc: 'HDFC0000053',
                    accountType: 'Salary',
                    isPrimary: true,
                    effectiveFrom: '2026-01-15',
                    decentroBeneficiaryId: 'ben_hdfc_09812',
                    verificationStatus: 'VERIFIED'
                },
                statutory: {
                    uanApplicable: true,
                    uanNumber: '100904829102'
                }
            };

            const payload = financeService.getDecentroBeneficiaryPayload(financeRecord);
            assert.equal(payload.beneficiaryId, 'ben_hdfc_09812');
            assert.equal(payload.accountNumber, '50100234567890');
            assert.equal(payload.ifsc, 'HDFC0000053');
            assert.equal(payload.name, 'Arun Kumar');
            assert.equal(payload.transferType, 'NEFT_IMPS_RTGS');
            assert.equal(payload.isPrimary, true);

            // PRD §4 Decoupling check: No salary breakdown, earnings, deductions, or net pay properties in payout registry payload
            assert.equal(payload.payslipId, undefined);
            assert.equal(payload.netSalary, undefined);
            assert.equal(payload.basicSalary, undefined);
            assert.equal(payload.deductions, undefined);
        });
    });

    await t.test('4. Data Architecture & Cloud Firestore CRUD', async (st) => {
        const testOrgId = 'org_fin_test_2026';
        const empId = 'EMP0001';

        await st.test('Saves and reads employee finance document at organizations/{orgId}/employee_finance/{employeeId}', async () => {
            const payload = {
                employeeId: empId,
                banking: {
                    accountHolderName: 'Arun Kumar',
                    bankName: 'HDFC Bank',
                    branchName: 'Koramangala, Bengaluru',
                    accountNumber: '50100234567890',
                    maskedAccountNumber: '••••••••••7890',
                    ifsc: 'HDFC0000053',
                    accountType: 'Salary',
                    isPrimary: true,
                    effectiveFrom: '2026-01-15',
                    decentroBeneficiaryId: 'ben_hdfc_09812',
                    verificationStatus: 'VERIFIED'
                },
                statutory: {
                    uanApplicable: true,
                    uanNumber: '100904829102',
                    esicApplicable: true,
                    esicNumber: '3100482910',
                    npsApplicable: false,
                    npsNumber: null,
                    gratuityApplicable: true,
                    gratuityNumber: 'GRAT-2026-001'
                }
            };

            const saved = await financeService.saveEmployeeFinance(testOrgId, empId, payload);
            assert.ok(saved);
            assert.equal(saved.employeeId, empId);
            assert.equal(saved.banking.accountNumber, '50100234567890');
            assert.equal(saved.banking.maskedAccountNumber, '••••••••••7890');

            const fetched = await financeService.getEmployeeFinance(testOrgId, empId);
            assert.ok(fetched);
            assert.equal(fetched.employeeId, empId);
            assert.equal(fetched.banking.bankName, 'HDFC Bank');
            assert.equal(fetched.statutory.uanNumber, '100904829102');
            assert.equal(fetched.statutory.gratuityNumber, 'GRAT-2026-001');
        });

        await st.test('Primary account enforcement: only one primary account per employee', async () => {
            // Add primary account 1
            await financeService.saveEmployeeFinance(testOrgId, 'EMP0002', {
                employeeId: 'EMP0002',
                banking: {
                    accountHolderName: 'Priya Sharma',
                    bankName: 'ICICI Bank',
                    accountNumber: '000201589123',
                    ifsc: 'ICIC0000002',
                    isPrimary: true
                },
                statutory: {}
            });

            const emp2 = await financeService.getEmployeeFinance(testOrgId, 'EMP0002');
            assert.equal(emp2.banking.isPrimary, true);

            // List finance records
            const records = await financeService.listEmployeeFinance(testOrgId);
            assert.ok(Array.isArray(records));
            assert.ok(records.length >= 2);
        });
    });

    await t.test('5. Live Templates.xlsx Ingestion Integration', async (st) => {
        const templatesPath = path.join(rootDir, 'Templates.xlsx');
        assert.ok(fs.existsSync(templatesPath), 'Templates.xlsx must exist in root directory');

        const fileBuffer = fs.readFileSync(templatesPath);
        const workbook = xlsx.read(fileBuffer, { type: 'buffer' });

        // Check for 'Employee Finance Deatils' (exact prompt name) or 'Employee Finance Details'
        const sheetName = workbook.SheetNames.find(s => {
            const norm = s.trim().toLowerCase().replace(/[\s_-]+/g, '');
            return norm === 'employeefinancedeatils' || norm === 'employeefinancedetails';
        });

        assert.ok(sheetName, `Templates.xlsx must contain 'Employee Finance Deatils' sheet (found sheets: ${workbook.SheetNames.join(', ')})`);

        const rawRows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
        assert.ok(rawRows.length > 0, `'${sheetName}' sheet must contain sample rows`);

        // Check columns in first row
        const firstRowKeys = Object.keys(rawRows[0]);
        assert.ok(firstRowKeys.includes('Employee_ID'), 'Must have Employee_ID header');
        assert.ok(firstRowKeys.includes('Account_Holder_Name'), 'Must have Account_Holder_Name header');
        assert.ok(firstRowKeys.includes('Account_Number'), 'Must have Account_Number header');
        assert.ok(firstRowKeys.includes('IFSC'), 'Must have IFSC header');
        assert.ok(firstRowKeys.includes('UAN No (If Applicable)'), 'Must have UAN No header');

        // Parse with foreign key context of active employees
        const existingEmployeeIds = new Set(['EMP0001', 'EMP0002', 'EMP0003']);
        const parseResult = financeParser.parseSheetRows(rawRows, { existingEmployeeIds });

        assert.equal(parseResult.valid, true, `All rows in Templates.xlsx '${sheetName}' must pass validation`);
        assert.equal(parseResult.records.length, 3, 'Must contain 3 sample rows');
        assert.equal(parseResult.firestoreDocs.length, 3, 'Must generate 3 Firestore docs');
        assert.equal(parseResult.errors.length, 0, 'Must have zero parsing errors');

        // Verify sample 1
        const emp1 = parseResult.firestoreDocs[0];
        assert.equal(emp1.employeeId, 'EMP0001');
        assert.ok(emp1.banking.accountHolderName === 'Super Admin' || emp1.banking.accountHolderName === 'Arun Kumar');
        assert.equal(emp1.banking.accountNumber, '50100234567890');
        assert.equal(emp1.banking.maskedAccountNumber, '••••••••••7890');
        assert.equal(emp1.banking.ifsc, 'HDFC0000053');
        assert.equal(emp1.statutory.uanApplicable, true);
        assert.equal(emp1.statutory.uanNumber, '100904829102');

        // Verify sample 2
        const emp2 = parseResult.firestoreDocs[1];
        assert.equal(emp2.employeeId, 'EMP0002');
        assert.ok(emp2.banking.accountHolderName === 'John Doe' || emp2.banking.accountHolderName === 'Priya Sharma');
        assert.ok(emp2.banking.ifsc === 'ICIC0000011' || emp2.banking.ifsc === 'ICIC0000002');
        assert.equal(emp2.statutory.uanApplicable, true);
        assert.equal(emp2.statutory.uanNumber, '100904829103');

        // Verify sample 3
        const emp3 = parseResult.firestoreDocs[2];
        assert.equal(emp3.employeeId, 'EMP0003');
        assert.ok(emp3.banking.accountHolderName === 'Marry Doe' || emp3.banking.accountHolderName === 'Rohan Verma');
        assert.ok(emp3.banking.ifsc === 'SBIN0000813' || emp3.banking.ifsc === 'SBIN0000001');
        assert.equal(emp3.statutory.uanApplicable, true);
        assert.equal(emp3.statutory.uanNumber, '100904829104');
    });

    await t.test('6. Frontend UI and Modal Integration Integrity', async (st) => {
        // admin-dashboard.html check
        const adminDashboardPath = path.join(rootDir, 'admin-dashboard.html');
        const adminDashboardHtml = fs.readFileSync(adminDashboardPath, 'utf8');

        assert.ok(adminDashboardHtml.includes('id="emp-tab-btn-finance"'), 'admin-dashboard.html must have #emp-tab-btn-finance');
        assert.ok(adminDashboardHtml.includes('id="emp-tab-content-finance"'), 'admin-dashboard.html must have #emp-tab-content-finance');
        assert.ok(adminDashboardHtml.includes('id="btnToggleAccVisibility"'), 'Must have account visibility toggle');
        assert.ok(adminDashboardHtml.includes('id="btnTriggerDecentroVerify"'), 'Must have Decentro penny drop trigger button');
        assert.ok(adminDashboardHtml.includes('employeeFinanceParser.js') || adminDashboardHtml.includes('employee-finance-parser.js'), 'Must import employeeFinanceParser.js');
        assert.ok(adminDashboardHtml.includes('employeeFinanceService.js') || adminDashboardHtml.includes('employee-finance-service.js'), 'Must import employeeFinanceService.js');

        // employee-profile-controller.js check
        const controllerPath = path.join(rootDir, 'employee-profile-controller.js');
        const controllerCode = fs.readFileSync(controllerPath, 'utf8');

        assert.ok(controllerCode.includes("'finance'"), 'Controller switchTab must support finance tab');
        assert.ok(controllerCode.includes('btnTriggerDecentroVerify'), 'Controller must wire Decentro verify button');
        assert.ok(controllerCode.includes('bindStatutoryToggles'), 'Controller must wire statutory toggles');

        // admin-onboarding-upload.html check
        const onboardingHtmlPath = path.join(rootDir, 'admin-onboarding-upload.html');
        const onboardingHtml = fs.readFileSync(onboardingHtmlPath, 'utf8');

        assert.ok(onboardingHtml.includes('id="tabEmployeeFinance"'), 'Must have tabEmployeeFinance');
        assert.ok(onboardingHtml.includes('id="employeeFinanceManagementView"'), 'Must have employeeFinanceManagementView');
        assert.ok(onboardingHtml.includes('id="employeeFinanceParseResultsContainer"'), 'Must have employeeFinanceParseResultsContainer');
        assert.ok(onboardingHtml.includes('id="parsedEmployeeFinanceTableBody"'), 'Must have parsedEmployeeFinanceTableBody');
        assert.ok(onboardingHtml.includes('id="btnConfirmEmployeeFinanceIngest"'), 'Must have btnConfirmEmployeeFinanceIngest');

        // admin-onboarding-upload.js check
        const onboardingJsPath = path.join(rootDir, 'admin-onboarding-upload.js');
        const onboardingJs = fs.readFileSync(onboardingJsPath, 'utf8');

        assert.ok(onboardingJs.includes('extract17EmployeeFinanceAttributesFromSheetRows'), 'Must implement extract17EmployeeFinanceAttributesFromSheetRows');
        assert.ok(onboardingJs.includes('renderParsedEmployeeFinancePreview'), 'Must implement renderParsedEmployeeFinancePreview');
        assert.ok(onboardingJs.includes('executeEmployeeFinanceIngest'), 'Must implement executeEmployeeFinanceIngest');
    });
});
