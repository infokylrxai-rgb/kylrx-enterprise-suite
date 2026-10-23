import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load gratuityDetailsParser (UMD module)
const parserPath = path.join(rootDir, 'gratuityDetailsParser.js');
const parserContent = fs.readFileSync(parserPath, 'utf8');
const parserModule = { exports: {} };
const parserFn = new Function('module', 'exports', 'require', parserContent);
parserFn(parserModule, parserModule.exports, () => ({}));
const gratuityParser = parserModule.exports;

// Load gratuityDetailsService (UMD module)
const servicePath = path.join(rootDir, 'gratuityDetailsService.js');
const serviceContent = fs.readFileSync(servicePath, 'utf8');
const serviceModule = { exports: {} };
const serviceFn = new Function('module', 'exports', 'require', serviceContent);
serviceFn(serviceModule, serviceModule.exports, () => ({}));
const gratuityService = serviceModule.exports;

// Load gratuityProfileUIController (UMD module)
const uiPath = path.join(rootDir, 'gratuityProfileUIController.js');
const uiContent = fs.readFileSync(uiPath, 'utf8');
const uiModule = { exports: {} };
const uiFn = new Function('module', 'exports', 'require', uiContent);
uiFn(uiModule, uiModule.exports, (dep) => {
    if (dep.includes('gratuityDetailsService')) return gratuityService;
    return {};
});
const gratuityUi = uiModule.exports;

test('PRD Sections 1, 4, 11 & 13: Gratuity Statutory Master Module (Payment of Gratuity Act, 1972)', async (t) => {

    await t.test('1. Exact Schema & Field Mapping (Strict 18 Attributes)', async (st) => {
        await st.test('Schema defines all 18 required columns matching Templates.xlsx and PRD', () => {
            const attrs = gratuityParser.GRATUITY_DETAILS_ATTRIBUTES;
            assert.equal(attrs.length, 18, 'Strictly 18 attributes must be defined');

            const expected18Keys = [
                'Employee ID',
                'Organization ID',
                'Gratuity Applicable',
                'Date of Joining',
                'Date of Exit',
                'Continuous Service (Years)',
                'Gratuity Eligibility Status',
                'Last Drawn Basic',
                'Last Drawn DA',
                'Last Drawn Wages / Eligible Salary',
                'Completed Years for Gratuity',
                'Accrued Gratuity Amount',
                'Gratuity Calculation Basis',
                'Scheme / Policy Name',
                'Nominee Details Status',
                'Payment Status',
                'Payment Date',
                'Payment Reference'
            ];

            const actualKeys = attrs.map(a => a.key);
            assert.deepEqual(actualKeys, expected18Keys, 'Attribute keys must match exact 18 column names');

            // Verify key definitions
            assert.equal(attrs.find(a => a.key === 'Employee ID').required, true);
            assert.equal(attrs.find(a => a.key === 'Organization ID').required, true);
            assert.equal(attrs.find(a => a.key === 'Gratuity Applicable').required, true);
            assert.equal(attrs.find(a => a.key === 'Date of Joining').required, true);
            assert.equal(attrs.find(a => a.key === 'Last Drawn Basic').required, true);
            assert.equal(attrs.find(a => a.key === 'Gratuity Eligibility Status').required, true);
        });

        await st.test('Canonical Enums are properly configured and exposed', () => {
            const enums = gratuityParser.ENUMS;
            assert.deepEqual(enums.eligibilityStatus, ['ELIGIBLE', 'NOT_ELIGIBLE', 'VESTED', 'EXEMPTED']);
            assert.deepEqual(enums.calculationBasis, ['15/26 Formula', '30/26 Formula', 'Trust Rule', 'Custom']);
            assert.deepEqual(enums.nomineeStatus, ['SUBMITTED', 'VERIFIED', 'PENDING', 'NOT_SUBMITTED']);
            assert.deepEqual(enums.paymentStatus, ['ACCRUING', 'PENDING_SETTLEMENT', 'APPROVED', 'DISBURSED', 'FORFEITED']);
        });
    });

    await t.test('2. Ingestion & Validation Pipeline (PRD Section 1)', async (st) => {
        await st.test('Validates a complete and correct active Gratuity record', () => {
            const row = {
                'Employee ID': 'EMP0001',
                'Organization ID': 'ORG_KYLRX_01',
                'Gratuity Applicable': 'Yes',
                'Date of Joining': '2020-01-15',
                'Date of Exit': '',
                'Continuous Service (Years)': 6.7,
                'Gratuity Eligibility Status': 'VESTED',
                'Last Drawn Basic': 60000.00,
                'Last Drawn DA': 0.00,
                'Last Drawn Wages / Eligible Salary': 60000.00,
                'Completed Years for Gratuity': 7,
                'Accrued Gratuity Amount': 242307.69,
                'Gratuity Calculation Basis': '15/26 Formula',
                'Scheme / Policy Name': 'LIC Group Gratuity Cash Accumulation',
                'Nominee Details Status': 'VERIFIED',
                'Payment Status': 'ACCRUING',
                'Payment Date': '',
                'Payment Reference': ''
            };

            const record = gratuityParser.parseRecord(row, 2, 'ORG_KYLRX_01');
            assert.equal(record.employeeId, 'EMP0001');
            assert.equal(record.isGratuityApplicable, true);
            assert.equal(record.dateOfJoining, '2020-01-15');
            assert.equal(record.continuousServiceYears, 6.7);
            assert.equal(record.completedYearsForGratuity, 7);
            assert.equal(record.lastDrawnBasic, 60000);
            assert.equal(record.lastDrawnEligibleSalary, 60000);
            assert.equal(record.accruedGratuityAmount, 242307.69);
            assert.equal(record.eligibilityStatus, 'VESTED');
            assert.equal(record.paymentStatus, 'ACCRUING');

            const val = gratuityParser.validateRecord(record, 2, {
                existingEmployeeIds: new Set(['EMP0001']),
                expectedOrgId: 'ORG_KYLRX_01'
            });

            assert.equal(val.valid, true);
            assert.equal(val.errors.length, 0);
        });

        await st.test('Header Truncation Resilience: handles truncated columns from Excel templates', () => {
            const truncatedRow = {
                'emp_id': 'EMP0002',
                'org_id': 'ORG_KYLRX_01',
                'gratuity applicable': 'Yes',
                'date of joining': '2023-08-01',
                'continuous service (years': 3.2,
                'last drawn wages / eligible sala': 50000,
                'completed years for gratui': 3,
                'accrued gratuity amoun': 86538.46,
                'gratuity calculation basi': '15/26 Formula',
                'nominee status': 'SUBMITTED',
                'payment status': 'ACCRUING'
            };

            const record = gratuityParser.parseRecord(truncatedRow, 3, 'ORG_KYLRX_01');
            assert.equal(record.employeeId, 'EMP0002');
            assert.equal(record.continuousServiceYears, 3.2);
            assert.equal(record.completedYearsForGratuity, 3);
            assert.equal(record.lastDrawnEligibleSalary, 50000);
            assert.equal(record.accruedGratuityAmount, 86538.46);
            assert.equal(record.calculationBasis, '15/26 Formula');
            assert.equal(record.nomineeStatus, 'SUBMITTED');
        });

        await st.test('Date Sequence Integrity: Exit date cannot precede Joining date', () => {
            const invalidDateRow = {
                'Employee ID': 'EMP0003',
                'Organization ID': 'ORG_KYLRX_01',
                'Gratuity Applicable': 'Yes',
                'Date of Joining': '2023-01-01',
                'Date of Exit': '2022-01-01',
                'Last Drawn Basic': 40000
            };

            const record = gratuityParser.parseRecord(invalidDateRow, 4, 'ORG_KYLRX_01');
            const val = gratuityParser.validateRecord(record, 4);
            assert.equal(val.valid, false);
            assert.ok(val.errors.some(e => e.includes('cannot precede Date of Joining')));
        });

        await st.test('Numeric and Boolean Normalization', () => {
            assert.equal(gratuityParser.parseBoolean('Yes'), true);
            assert.equal(gratuityParser.parseBoolean('True'), true);
            assert.equal(gratuityParser.parseBoolean('No'), false);
            assert.equal(gratuityParser.parseBoolean('False'), false);
            assert.equal(gratuityParser.parseNumber('₹60,000.00'), 60000);
            assert.equal(gratuityParser.parseNumber('invalid', 0), 0);
        });

        await st.test('Deduplication and batch parsing with SheetJS rows', () => {
            const batchRows = [
                {
                    'Employee ID': 'EMP0001',
                    'Gratuity Applicable': 'Yes',
                    'Date of Joining': '2020-01-15',
                    'Last Drawn Basic': 60000
                },
                {
                    'Employee ID': 'EMP0001', // duplicate
                    'Gratuity Applicable': 'Yes',
                    'Date of Joining': '2020-01-15',
                    'Last Drawn Basic': 60000
                }
            ];

            const parsed = gratuityParser.parseSheetRows(batchRows, { orgId: 'ORG_KYLRX_01' });
            assert.equal(parsed.records.length, 1, 'Duplicate row must be rejected');
            assert.equal(parsed.duplicates.length, 1);
            assert.ok(parsed.errors.some(e => e.includes('Duplicate Employee ID')));
        });
    });

    await t.test('3. Dynamic Statutory Gratuity Valuation Engine (Payment of Gratuity Act, 1972 & PRD Section 4)', async (st) => {
        await st.test('Service Tenure & >6 Months Rounding Rule', () => {
            // Case 1: 5 years 7 months -> rounded up to 6 years
            const tenure1 = gratuityService.calculateTenure('2020-01-01', '2025-08-15');
            assert.equal(tenure1.completedYears, 6, 'Tenure of 5 yrs 7.5 mos must round UP to 6 years');

            // Case 2: 5 years 3 months -> rounded down to 5 years
            const tenure2 = gratuityService.calculateTenure('2020-01-01', '2025-04-01');
            assert.equal(tenure2.completedYears, 5, 'Tenure of 5 yrs 3 mos must round DOWN to 5 years');
        });

        await st.test('5-Year Vesting Threshold with Automatic Death/Disablement Bypass', () => {
            // Under 5 years - Resignation -> NOT_ELIGIBLE / Not Vested
            const unvested = gratuityService.calculateGratuity({
                lastDrawnBasic: 50000,
                lastDrawnDa: 0,
                dateOfJoining: '2023-01-01',
                dateOfExit: '2025-01-01',
                completedYears: 2,
                exitReason: 'RESIGNATION'
            });
            assert.equal(unvested.isVested, false);
            assert.equal(unvested.payableGratuityAmount, 0);

            // Under 5 years - Death -> Automatically Vested & Payable
            const deathBypass = gratuityService.calculateGratuity({
                lastDrawnBasic: 50000,
                lastDrawnDa: 0,
                dateOfJoining: '2023-01-01',
                dateOfExit: '2025-01-01',
                completedYears: 2,
                exitReason: 'DEATH'
            });
            assert.equal(deathBypass.isVested, true);
            assert.equal(deathBypass.isBypass, true);
            assert.ok(deathBypass.payableGratuityAmount > 0);
            assert.equal(deathBypass.payableGratuityAmount, Math.round(((15 * 50000 * 2) / 26) * 100) / 100);
        });

        await st.test('Standard 15/26 Formula & Blueprint Test Vector Precision', () => {
            // Test vector: Eligible Salary = 25000, 6 completed years
            // (15 * 25000 * 6) / 26 = 86538.46
            const calc = gratuityService.calculateGratuity({
                lastDrawnBasic: 25000,
                lastDrawnDa: 0,
                completedYears: 6
            });
            const expected = Math.round(((15 * 25000 * 6) / 26) * 100) / 100;
            assert.equal(calc.rawGratuityAmount, expected);
            assert.equal(calc.rawGratuityAmount, 86538.46);
        });

        await st.test('Statutory Tax-Free Ceiling Enforcement (INR 20,00,000 under Section 10(10))', () => {
            // High earner: Basic = 3,00,000, Completed Years = 25
            // Raw Gratuity = (15 * 300000 * 25) / 26 = 43,26,923.08
            const highEarner = gratuityService.calculateGratuity({
                lastDrawnBasic: 300000,
                lastDrawnDa: 0,
                completedYears: 25
            });

            assert.equal(highEarner.rawGratuityAmount, 4326923.08);
            assert.equal(highEarner.statutoryCeiling, 2000000.00);
            assert.equal(highEarner.taxExemptAmount, 2000000.00);
            assert.equal(highEarner.taxableExcessAmount, 2326923.08);
        });

        await st.test('Monthly Balance Sheet Accrual Reserve Calculation', () => {
            // Basic = 60000. Monthly liability reserve = (15 * 60000) / (26 * 12) = 2884.62
            const res = gratuityService.calculateGratuity({
                lastDrawnBasic: 60000,
                lastDrawnDa: 0,
                completedYears: 5
            });
            assert.equal(res.monthlyAccrualReserve, 2884.62);
        });

        await st.test('Generates Statutory Form I Notice of Gratuity Claim HTML', () => {
            const htmlNotice = gratuityService.generateFormINotice(
                {
                    employeeId: 'EMP0003',
                    dateOfJoining: '2020-06-01',
                    dateOfExit: '2026-03-31',
                    continuousServiceYears: 5.8,
                    completedYearsForGratuity: 6,
                    eligibleSalary: 75000,
                    accruedGratuityAmount: 259615.38
                },
                { fullName: 'Ananya Sharma' },
                { companyName: 'KYLRX AI TECHNOLOGIES PVT. LTD.' }
            );

            assert.ok(htmlNotice.includes("FORM 'I'"), "Must contain Form I title");
            assert.ok(htmlNotice.includes("Payment of Gratuity Act, 1972"), "Must cite Statutory Act");
            assert.ok(htmlNotice.includes("Ananya Sharma"), "Must include employee name");
            assert.ok(htmlNotice.includes("EMP0003"), "Must include employee ID");
            assert.ok(htmlNotice.includes("2,59,615.38") || htmlNotice.includes("259,615.38"), "Must format payout claim amount");
            assert.ok(htmlNotice.includes("Decentro Fabric Core Banking"), "Must mention Decentro payout transfer");
        });
    });

    await t.test('4. Decentro Fabric Settlement Integration & Admin UI (PRD Sections 4 & 13)', async (st) => {
        await st.test('Executes Decentro Fabric payout settlement handshake, returns UTR, and transitions to DISBURSED', async () => {
            const settlementResult = await gratuityService.initiateDecentroGratuitySettlement(
                'ORG_KYLRX_01',
                'EMP0003',
                {
                    accruedGratuityAmount: 259615.38
                },
                {
                    accountNumber: '987654321012',
                    ifsc: 'HDFC0000053',
                    name: 'Ananya Sharma'
                }
            );

            assert.equal(settlementResult.success, true);
            assert.equal(settlementResult.status, 'DISBURSED');
            assert.ok(settlementResult.paymentReference.startsWith('UTR_DEC_'), 'Must produce Decentro UTR');
            assert.ok(settlementResult.decentroDisbursementId.startsWith('DEC_FAB_GRAT_'), 'Must produce Decentro disbursement ID');
            assert.equal(settlementResult.disbursedAmount, 259615.38);

            // Check ledger update
            const updated = await gratuityService.getGratuityDetails('ORG_KYLRX_01', 'EMP0003');
            assert.equal(updated.settlement.paymentStatus, 'DISBURSED');
            assert.equal(updated.settlement.paymentReference, settlementResult.paymentReference);
            assert.equal(updated.settlement.decentroDisbursementId, settlementResult.decentroDisbursementId);
        });

        await st.test('Renders Gratuity & Long-Term Benefits Card HTML with eligibility badge, formula, and Form F pill', () => {
            const cardHtml = gratuityUi.renderCardHtml(
                {
                    employeeId: 'EMP0001',
                    isGratuityApplicable: true,
                    dateOfJoining: '2020-01-15',
                    continuousServiceYears: 6.7,
                    completedYearsForGratuity: 7,
                    eligibilityStatus: 'VESTED',
                    wages: { lastDrawnBasic: 60000, lastDrawnDa: 0, eligibleSalary: 60000 },
                    accruedGratuityAmount: 242307.69,
                    calculationBasis: '15/26 Formula',
                    schemePolicyName: 'LIC Group Gratuity Cash Accumulation',
                    nomineeStatus: 'VERIFIED',
                    settlement: { paymentStatus: 'ACCRUING' }
                },
                { fullName: 'Rajesh Kumar' }
            );

            assert.ok(cardHtml.includes('Gratuity &amp; Long-Term Benefits'), 'Card title must exist');
            assert.ok(cardHtml.includes('VESTED'), 'Eligibility badge must exist');
            assert.ok(cardHtml.includes('15/26 Formula'), 'Formula breakdown must exist');
            assert.ok(cardHtml.includes('Form F: Verified'), 'Form F nominee status must exist');
            assert.ok(cardHtml.includes('₹2,42,307.69') || cardHtml.includes('242,307.69'), 'Accrued liability must be formatted');
        });
    });

    await t.test('5. Cloud Firestore Persistence & Document Schema Structure', async (st) => {
        await st.test('toFirestoreDoc constructs canonical document schema under organizations/{orgId}/employee_gratuity_details/{employeeId}', () => {
            const doc = gratuityParser.toFirestoreDoc({
                employeeId: 'EMP0001',
                organizationId: 'ORG_KYLRX_01',
                isGratuityApplicable: true,
                dateOfJoining: '2020-01-15',
                dateOfExit: null,
                continuousServiceYears: 6.7,
                eligibilityStatus: 'VESTED',
                lastDrawnBasic: 60000.00,
                lastDrawnDa: 0.00,
                lastDrawnEligibleSalary: 60000.00,
                completedYearsForGratuity: 7,
                accruedGratuityAmount: 242307.69,
                calculationBasis: '15/26 Formula',
                schemePolicyName: 'LIC Group Gratuity Cash Accumulation',
                nomineeStatus: 'VERIFIED',
                paymentStatus: 'ACCRUING',
                paymentDate: null,
                paymentReference: null
            });

            assert.equal(doc.employeeId, 'EMP0001');
            assert.equal(doc.organizationId, 'ORG_KYLRX_01');
            assert.equal(doc.isGratuityApplicable, true);
            assert.equal(doc.dateOfJoining, '2020-01-15');
            assert.equal(doc.dateOfExit, null);
            assert.equal(doc.continuousServiceYears, 6.7);
            assert.equal(doc.eligibilityStatus, 'VESTED');
            assert.deepEqual(doc.wages, {
                lastDrawnBasic: 60000.00,
                lastDrawnDa: 0.00,
                eligibleSalary: 60000.00
            });
            assert.equal(doc.completedYearsForGratuity, 7);
            assert.equal(doc.accruedGratuityAmount, 242307.69);
            assert.equal(doc.calculationBasis, '15/26 Formula');
            assert.equal(doc.schemePolicyName, 'LIC Group Gratuity Cash Accumulation');
            assert.equal(doc.nomineeStatus, 'VERIFIED');
            assert.deepEqual(doc.settlement, {
                paymentStatus: 'ACCRUING',
                paymentDate: null,
                paymentReference: null,
                decentroDisbursementId: null
            });
        });

        await st.test('In-memory and CRUD service stores, retrieves, lists and generates ledger export', async () => {
            const list = await gratuityService.listAllGratuityDetails('ORG_KYLRX_01');
            assert.ok(list.length >= 4, 'Must have seeded profiles');

            const ledgerExport = gratuityService.generateGratuityLedgerExport(list, 'ORG_KYLRX_01');
            assert.ok(ledgerExport.includes('Employee_ID#Date_Of_Joining'), 'Ledger header must match');
            assert.ok(ledgerExport.includes('EMP0001'), 'Must include EMP0001 in ledger');
        });
    });

    await t.test('6. Excel Workbook & Template Integrity (Templates.xlsx)', async (st) => {
        await st.test("Templates.xlsx contains 'Gratuity Details' sheet matching all 18 canonical columns", () => {
            const wbPath = path.join(rootDir, 'Templates.xlsx');
            assert.ok(fs.existsSync(wbPath), 'Templates.xlsx must exist');

            const buffer = fs.readFileSync(wbPath);
            const wb = xlsx.read(buffer, { type: 'buffer' });
            assert.ok(wb.SheetNames.includes('Gratuity Details') || wb.SheetNames.includes('Gratuity Master'), "Must have 'Gratuity Details' sheet");

            const sheetName = wb.SheetNames.find(s => s === 'Gratuity Details' || s === 'Gratuity Master');
            const data = xlsx.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1 });
            const headers = data[0];

            const expected18 = [
                'Employee ID',
                'Organization ID',
                'Gratuity Applicable',
                'Date of Joining',
                'Date of Exit',
                'Continuous Service (Years)',
                'Gratuity Eligibility Status',
                'Last Drawn Basic',
                'Last Drawn DA',
                'Last Drawn Wages / Eligible Salary',
                'Completed Years for Gratuity',
                'Accrued Gratuity Amount',
                'Gratuity Calculation Basis',
                'Scheme / Policy Name',
                'Nominee Details Status',
                'Payment Status',
                'Payment Date',
                'Payment Reference'
            ];

            assert.deepEqual(headers, expected18, 'Templates.xlsx Gratuity Details sheet headers must strictly match 18 canonical attributes');
        });

        await st.test('admin-onboarding-upload.html has Gratuity console tabs, preview and table container', () => {
            const html = fs.readFileSync(path.join(rootDir, 'admin-onboarding-upload.html'), 'utf8');
            assert.ok(html.includes('id="tabGratuityMaster"'), 'Must have #tabGratuityMaster');
            assert.ok(html.includes('id="gratuityMasterParseResultsContainer"'), 'Must have #gratuityMasterParseResultsContainer');
            assert.ok(html.includes('id="parsedGratuityMasterTableBody"'), 'Must have #parsedGratuityMasterTableBody');
            assert.ok(html.includes('id="onboardingGratuityMasterTableContainer"'), 'Must have #onboardingGratuityMasterTableContainer');
        });

        await st.test('admin-dashboard.html has Gratuity statutory drawer container and script imports', () => {
            const html = fs.readFileSync(path.join(rootDir, 'admin-dashboard.html'), 'utf8');
            assert.ok(html.includes('id="gratuityStatutoryDrawerContainer"'), 'Must have #gratuityStatutoryDrawerContainer');
            assert.ok(html.includes('src="gratuityDetailsParser.js"'), 'Must import gratuityDetailsParser.js');
            assert.ok(html.includes('src="gratuityDetailsService.js"'), 'Must import gratuityDetailsService.js');
            assert.ok(html.includes('src="gratuityProfileUIController.js"'), 'Must import gratuityProfileUIController.js');
        });

        await st.test('employee-profile-controller.js mounts Gratuity card via KylrxGratuityProfileUIController', () => {
            const code = fs.readFileSync(path.join(rootDir, 'employee-profile-controller.js'), 'utf8');
            assert.ok(code.includes('KylrxGratuityProfileUIController'), 'Must reference KylrxGratuityProfileUIController');
            assert.ok(code.includes('gratuityStatutoryDrawerContainer'), 'Must target gratuityStatutoryDrawerContainer');
        });

        await st.test('Service proxy mirrors exist in services/ directory', () => {
            assert.ok(fs.existsSync(path.join(rootDir, 'services', 'gratuity-details-parser.js')), 'services/gratuity-details-parser.js must exist');
            assert.ok(fs.existsSync(path.join(rootDir, 'services', 'gratuity-details-service.js')), 'services/gratuity-details-service.js must exist');
            assert.ok(fs.existsSync(path.join(rootDir, 'services', 'gratuity-profile-ui-controller.js')), 'services/gratuity-profile-ui-controller.js must exist');
        });
    });
});
