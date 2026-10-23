import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as xlsx from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load npsDetailsParser (UMD module)
const parserPath = path.join(rootDir, 'npsDetailsParser.js');
const parserContent = fs.readFileSync(parserPath, 'utf8');
const parserModule = { exports: {} };
const parserFn = new Function('module', 'exports', 'require', parserContent);
parserFn(parserModule, parserModule.exports, () => ({}));
const npsParser = parserModule.exports;

// Load npsDetailsService (UMD module)
const servicePath = path.join(rootDir, 'npsDetailsService.js');
const serviceContent = fs.readFileSync(servicePath, 'utf8');
const serviceModule = { exports: {} };
const serviceFn = new Function('module', 'exports', 'require', serviceContent);
serviceFn(serviceModule, serviceModule.exports, () => ({}));
const npsService = serviceModule.exports;

// Load npsProfileUIController (UMD module)
const uiPath = path.join(rootDir, 'npsProfileUIController.js');
const uiContent = fs.readFileSync(uiPath, 'utf8');
const uiModule = { exports: {} };
const uiFn = new Function('module', 'exports', 'require', uiContent);
uiFn(uiModule, uiModule.exports, (dep) => {
    if (dep.includes('npsDetailsService')) return npsService;
    return {};
});
const npsUi = uiModule.exports;

test('PRD Sections 1, 4, 11 & 13: National Pension System (NPS) Statutory Master Module', async (t) => {

    await t.test('1. Exact Schema & Field Mapping (Strict 22 Attributes)', async (st) => {
        await st.test('Schema defines all 22 required columns matching Templates.xlsx and PRD', () => {
            const attrs = npsParser.NPS_DETAILS_ATTRIBUTES;
            assert.equal(attrs.length, 22, 'Strictly 22 attributes must be defined');

            const expected22Keys = [
                'Employee ID',
                'Organization ID',
                'NPS Applicable',
                'PRAN',
                'NPS Account Status',
                'NPS Model',
                'CRA / Recordkeeping Agency',
                'POP / Intermediary',
                'Tier I Active',
                'Tier II Active',
                'Date of NPS Joining',
                'Date of NPS Exit',
                'Employee Contribution %',
                'Employee Contribution Amount',
                'Employer Contribution %',
                'Employer Contribution Amount',
                'Total Contribution YTD',
                'Nominee Details Status',
                'KYC Status',
                'PAN KYC',
                'Aadhaar KYC',
                'Bank KYC'
            ];

            const actualKeys = attrs.map(a => a.key);
            assert.deepEqual(actualKeys, expected22Keys, 'Attribute keys must match exact 22 column names');

            // Verify key definitions
            assert.equal(attrs.find(a => a.key === 'Employee ID').required, true);
            assert.equal(attrs.find(a => a.key === 'Organization ID').required, true);
            assert.equal(attrs.find(a => a.key === 'NPS Applicable').required, true);
            assert.equal(attrs.find(a => a.key === 'PRAN').required, true);
            assert.equal(attrs.find(a => a.key === 'NPS Account Status').required, true);
            assert.equal(attrs.find(a => a.key === 'NPS Model').required, true);
            assert.equal(attrs.find(a => a.key === 'CRA / Recordkeeping Agency').required, true);
            assert.equal(attrs.find(a => a.key === 'Tier I Active').required, true);
            assert.equal(attrs.find(a => a.key === 'Tier II Active').required, true);
            assert.equal(attrs.find(a => a.key === 'Date of NPS Joining').required, true);
            assert.equal(attrs.find(a => a.key === 'Nominee Details Status').required, true);
            assert.equal(attrs.find(a => a.key === 'KYC Status').required, true);
            assert.equal(attrs.find(a => a.key === 'PAN KYC').required, true);
            assert.equal(attrs.find(a => a.key === 'Aadhaar KYC').required, true);
            assert.equal(attrs.find(a => a.key === 'Bank KYC').required, true);
        });

        await st.test('Canonical Enums are properly configured and exposed', () => {
            const enums = npsParser.ENUMS;
            assert.ok(enums, 'ENUMS dictionary must be exposed');
            assert.deepEqual(enums.npsAccountStatus, ["ACTIVE", "INACTIVE", "FROZEN", "SUSPENDED"]);
            assert.deepEqual(enums.npsModel, ["Corporate Model", "All Citizen Model", "Government"]);
            assert.deepEqual(enums.craAgency, ["Protean (NSDL)", "KFintech", "CAMS", "Other"]);
            assert.deepEqual(enums.nomineeStatus, ["SUBMITTED", "VERIFIED", "PENDING", "NOT_SUBMITTED"]);
            assert.deepEqual(enums.kycStatus, ["VERIFIED", "PENDING", "REJECTED"]);
            assert.deepEqual(enums.panKyc, ["VERIFIED", "PENDING", "NOT_SEEDED"]);
            assert.deepEqual(enums.aadhaarKyc, ["VERIFIED", "PENDING", "NOT_SEEDED"]);
            assert.deepEqual(enums.bankKyc, ["VERIFIED", "PENDING", "FAILED"]);
        });
    });

    await t.test('2. Ingestion & Validation Pipeline (PRD Section 1)', async (st) => {
        await st.test('Validates a complete and correct active corporate NPS subscriber record', () => {
            const record = {
                'Employee ID': 'EMP0001',
                'Organization ID': 'ORG_KYLRX_01',
                'NPS Applicable': 'Yes',
                'PRAN': '110023456789',
                'NPS Account Status': 'ACTIVE',
                'NPS Model': 'Corporate Model',
                'CRA / Recordkeeping Agency': 'Protean (NSDL)',
                'POP / Intermediary': 'HDFC Pension Management Co.',
                'Tier I Active': 'Yes',
                'Tier II Active': 'No',
                'Date of NPS Joining': '2026-01-15',
                'Date of NPS Exit': '',
                'Employee Contribution %': 10.0,
                'Employee Contribution Amount': '',
                'Employer Contribution %': 10.0,
                'Employer Contribution Amount': '',
                'Total Contribution YTD': 90000.00,
                'Nominee Details Status': 'VERIFIED',
                'KYC Status': 'VERIFIED',
                'PAN KYC': 'VERIFIED',
                'Aadhaar KYC': 'VERIFIED',
                'Bank KYC': 'VERIFIED'
            };

            const result = npsParser.validateRecord(record, { orgId: 'ORG_KYLRX_01' });
            assert.equal(result.valid, true, 'Record should be valid');
            assert.equal(result.errors.length, 0, 'Should have 0 errors');
        });

        await st.test('PRAN Format Validation: strictly 12 digits required when NPS Applicable is true', () => {
            const baseRecord = {
                'Employee ID': 'EMP0001',
                'Organization ID': 'ORG_KYLRX_01',
                'NPS Applicable': 'Yes',
                'NPS Account Status': 'ACTIVE',
                'NPS Model': 'Corporate Model',
                'CRA / Recordkeeping Agency': 'Protean (NSDL)',
                'Tier I Active': 'Yes',
                'Date of NPS Joining': '2026-01-15',
                'Employee Contribution %': 10.0,
                'Employer Contribution %': 10.0
            };

            // Missing PRAN
            const missingPran = npsParser.validateRecord({ ...baseRecord, 'PRAN': '' });
            assert.equal(missingPran.valid, false);
            assert.ok(missingPran.errors.some(e => e.includes('Missing mandatory 12-digit PRAN')));

            // 11 digits (too short)
            const shortPran = npsParser.validateRecord({ ...baseRecord, 'PRAN': '11002345678' });
            assert.equal(shortPran.valid, false);
            assert.ok(shortPran.errors.some(e => e.includes('PRAN must be strictly a 12-digit numeric identifier')));

            // Non-numeric characters
            const alphaPran = npsParser.validateRecord({ ...baseRecord, 'PRAN': '11002345678A' });
            assert.equal(alphaPran.valid, false);
            assert.ok(alphaPran.errors.some(e => e.includes('PRAN must be strictly a 12-digit numeric identifier')));

            // Valid 12 digits
            const validPran = npsParser.validateRecord({ ...baseRecord, 'PRAN': '110023456789' });
            assert.equal(validPran.valid, true);
        });

        await st.test('Foreign Key and Tenant Scoping Validation', () => {
            const record = {
                'Employee ID': 'EMP9999',
                'Organization ID': 'ORG_WRONG',
                'NPS Applicable': 'No'
            };

            const existingEmployeeIds = new Set(['EMP0001', 'EMP0002']);
            const result = npsParser.validateRecord(record, {
                existingEmployeeIds,
                orgId: 'ORG_KYLRX_01'
            });

            assert.equal(result.valid, false);
            assert.ok(result.errors.some(e => e.includes("Foreign key validation failed")));
            assert.ok(result.errors.some(e => e.includes("does not match current tenant context")));
        });

        await st.test('Contribution Mutex Validation: requires either % or Amount when active', () => {
            const baseRecord = {
                'Employee ID': 'EMP0001',
                'Organization ID': 'ORG_KYLRX_01',
                'NPS Applicable': 'Yes',
                'PRAN': '110023456789',
                'Date of NPS Joining': '2026-01-15',
                'Tier I Active': 'Yes'
            };

            // Both empty for Employee
            const res1 = npsParser.validateRecord({
                ...baseRecord,
                'Employee Contribution %': '',
                'Employee Contribution Amount': '',
                'Employer Contribution %': 10.0,
                'Employer Contribution Amount': ''
            });
            assert.equal(res1.valid, false);
            assert.ok(res1.errors.some(e => e.includes("Either 'Employee Contribution %' or 'Employee Contribution Amount' must be provided")));

            // Both empty for Employer
            const res2 = npsParser.validateRecord({
                ...baseRecord,
                'Employee Contribution %': 10.0,
                'Employee Contribution Amount': '',
                'Employer Contribution %': '',
                'Employer Contribution Amount': ''
            });
            assert.equal(res2.valid, false);
            assert.ok(res2.errors.some(e => e.includes("Either 'Employer Contribution %' or 'Employer Contribution Amount' must be provided")));

            // Percentage out of range (> 100)
            const res3 = npsParser.validateRecord({
                ...baseRecord,
                'Employee Contribution %': 105.0,
                'Employer Contribution %': 10.0
            });
            assert.equal(res3.valid, false);
            assert.ok(res3.errors.some(e => e.includes("Percentage must be a valid number between 0 and 100")));

            // Negative amount
            const res4 = npsParser.validateRecord({
                ...baseRecord,
                'Employee Contribution Amount': -500,
                'Employer Contribution Amount': 5000
            });
            assert.equal(res4.valid, false);
            assert.ok(res4.errors.some(e => e.includes("Amount cannot be negative")));
        });

        await st.test('Header Truncation Resilience: handles truncated columns from legacy templates', () => {
            const truncatedRow = {
                'Employee ID': 'EMP0001',
                'Organization ID': 'ORG_KYLRX_01',
                'NPS Applicable': 'Yes',
                'PRAN': '110023456789',
                'NPS Account Status': 'ACTIVE',
                'NPS Model': 'Corporate Model',
                'CRA / Recordkeeping Agenc': 'Protean (NSDL)',
                'POP / Intermediar': 'HDFC Pension Management Co.',
                'Tier I Active': 'Yes',
                'Tier II Active': 'No',
                'Date of NPS Joining': '2026-01-15',
                'Date of NPS Exit': '',
                'Employee Contribution Amour': 4500.00,
                'Employer Contribution Amoun': 4500.00,
                'Total Contribution YTD': 45000.00,
                'Nominee Details Status': 'VERIFIED',
                'KYC Status': 'VERIFIED',
                'PAN KYC': 'VERIFIED',
                'Aadhaar KYC': 'VERIFIED',
                'Bank KYC': 'VERIFIED'
            };

            const parseRes = npsParser.parseSheetRows([truncatedRow], { orgId: 'ORG_KYLRX_01' });
            assert.equal(parseRes.errors.length, 0, 'Truncated headers must parse without errors');
            assert.equal(parseRes.records.length, 1);

            const doc = parseRes.firestoreDocs[0];
            assert.equal(doc.craAgency, 'Protean (NSDL)');
            assert.equal(doc.popIntermediary, 'HDFC Pension Management Co.');
            assert.equal(doc.contributions.employeeAmount, 4500.00);
            assert.equal(doc.contributions.employerAmount, 4500.00);
        });

        await st.test('Date sequence integrity: exit date cannot precede joining date', () => {
            const record = {
                'Employee ID': 'EMP0001',
                'Organization ID': 'ORG_KYLRX_01',
                'NPS Applicable': 'Yes',
                'PRAN': '110023456789',
                'Date of NPS Joining': '2026-06-01',
                'Date of NPS Exit': '2026-01-01',
                'Employee Contribution %': 10.0,
                'Employer Contribution %': 10.0
            };

            const res = npsParser.validateRecord(record);
            assert.equal(res.valid, false);
            assert.ok(res.errors.some(e => e.includes("cannot precede 'Date of NPS Joining'")));
        });
    });

    await t.test('3. Dynamic Statutory Payroll Deduction Engine (PRD Sections 4 & 11)', async (st) => {
        await st.test('Computes percentage-based deduction on (Basic + DA) and Section 80CCD reliefs', () => {
            const profile = {
                employeeId: 'EMP0001',
                pran: '110023456789',
                isNpsApplicable: true,
                tier1Active: true,
                tier2Active: false,
                contributions: {
                    employeePercentage: 10.0,
                    employerPercentage: 10.0,
                    totalContributionYtd: 90000.00
                }
            };

            // Basic: 50,000, DA: 10,000 -> Wage base: 60,000
            const wages = { basicPay: 50000, daPay: 10000 };
            const calcOld = npsService.calculateNpsDeduction(profile, wages, { taxRegime: 'OLD' });

            assert.equal(calcOld.wageBase, 60000);
            assert.equal(calcOld.employeeTier1Amount, 6000); // 10% of 60,000
            assert.equal(calcOld.employerTier1Amount, 6000); // 10% of 60,000
            assert.equal(calcOld.deductionFromNetPay, 6000);
            assert.equal(calcOld.totalMonthlyContribution, 12000);
            assert.equal(calcOld.taxRelief.section80CCD1, 6000);
            assert.equal(calcOld.taxRelief.section80CCD1B, 4166.67);
            assert.equal(calcOld.taxRelief.section80CCD2, 6000);
            assert.equal(calcOld.priorYtd, 90000);
            assert.equal(calcOld.updatedYtd, 102000);

            // New Tax Regime: Only 80CCD(2) employer exemption applies
            const calcNew = npsService.calculateNpsDeduction(profile, wages, { taxRegime: 'NEW' });
            assert.equal(calcNew.taxRelief.section80CCD1, 0);
            assert.equal(calcNew.taxRelief.section80CCD1B, 0);
            assert.equal(calcNew.taxRelief.section80CCD2, 6000);
            assert.equal(calcNew.taxRelief.eligibleTaxExemption, 6000);
        });

        await st.test('Computes fixed amount deduction directly and supports Tier 2 voluntary contribution', () => {
            const profile = {
                employeeId: 'EMP0004',
                pran: '110055443322',
                isNpsApplicable: true,
                tier1Active: true,
                tier2Active: true,
                contributions: {
                    employeePercentage: null,
                    employeeAmount: 5000.00,
                    employerPercentage: null,
                    employerAmount: 5000.00,
                    totalContributionYtd: 45000.00
                }
            };

            const calc = npsService.calculateNpsDeduction(profile, 60000, { tier2Amount: 2000, taxRegime: 'OLD' });
            assert.equal(calc.employeeTier1Amount, 5000.00);
            assert.equal(calc.employerTier1Amount, 5000.00);
            assert.equal(calc.employeeTier2Amount, 2000.00);
            assert.equal(calc.deductionFromNetPay, 7000.00); // Tier 1 (5000) + Tier 2 (2000)
            assert.equal(calc.totalMonthlyContribution, 12000.00);
            assert.equal(calc.updatedYtd, 57000.00);
        });

        await st.test('Applies Government Model 14% Employer contribution exemption cap', () => {
            const govtProfile = {
                employeeId: 'EMP0005',
                pran: '110099887766',
                isNpsApplicable: true,
                npsModel: 'Government',
                tier1Active: true,
                contributions: {
                    employeePercentage: 10.0,
                    employerPercentage: 14.0,
                    totalContributionYtd: 0
                }
            };

            const calcGovt = npsService.calculateNpsDeduction(govtProfile, 100000, { sector: 'GOVERNMENT', taxRegime: 'NEW' });
            assert.equal(calcGovt.isGovernment, true);
            assert.equal(calcGovt.employeeTier1Amount, 10000);
            assert.equal(calcGovt.employerTier1Amount, 14000); // 14% for govt
            assert.equal(calcGovt.taxRelief.section80CCD2, 14000);
        });

        await st.test('Generates standard NSDL / Protean SCF hash-delimited contribution row', () => {
            const profile = {
                pran: '110023456789',
                tier1Active: true,
                tier2Active: false
            };

            const calcResult = {
                employeeTier1Amount: 6000.00,
                employerTier1Amount: 6000.00,
                employeeTier2Amount: 0.00
            };

            const row = npsService.generateCraReturnRow(profile, calcResult, '2026-03');
            const expectedFormat = '110023456789#6000.00#6000.00#0.00#2026-03';
            assert.equal(row, expectedFormat, 'SCF row must match PRAN#EE_T1#ER_T1#EE_T2#Period format');
        });

        await st.test('Generates complete CRA Subscriber Contribution File (SCF) payload batch', () => {
            const subscribers = [
                {
                    pran: '110023456789',
                    employeeTier1Amount: 6000.00,
                    employerTier1Amount: 6000.00,
                    employeeTier2Amount: 0.00,
                    craAgency: 'Protean (NSDL)'
                },
                {
                    pran: '110098765432',
                    employeeTier1Amount: 4000.00,
                    employerTier1Amount: 4000.00,
                    employeeTier2Amount: 1000.00,
                    craAgency: 'KFintech'
                }
            ];

            const batch = npsService.generateCraReturnFile(subscribers, { period: '2026-10', craAgency: 'Protean (NSDL)' });
            assert.equal(batch.rowCount, 2);
            assert.equal(batch.totalEmployeeTier1, 10000.00);
            assert.equal(batch.totalEmployerTier1, 10000.00);
            assert.equal(batch.totalEmployeeTier2, 1000.00);
            assert.equal(batch.totalContribution, 21000.00);
            assert.equal(batch.rows.length, 2);
            assert.equal(batch.rows[0], '110023456789#6000.00#6000.00#0.00#2026-10');
            assert.equal(batch.rows[1], '110098765432#4000.00#4000.00#1000.00#2026-10');

            // Test CSV Return export
            const csvExport = npsService.exportCraReturnCsv(subscribers, { period: '2026-10', craAgency: 'Protean (NSDL)' });
            assert.ok(csvExport.filename.endsWith('.csv'));
            assert.ok(csvExport.content.includes('PRAN#Employee_Tier1_Amount#Employer_Tier1_Amount#Employee_Tier2_Amount#Contribution_Period'));
            assert.ok(csvExport.content.includes('110023456789#6000.00#6000.00#0.00#2026-10'));

            // Test Excel Return export
            const xlsxExport = npsService.exportCraReturnExcel(subscribers, { period: '2026-10', craAgency: 'Protean (NSDL)' });
            assert.ok(xlsxExport.filename.endsWith('.xlsx'));
            assert.equal(xlsxExport.dataRows.length, 3);
            assert.deepEqual(xlsxExport.dataRows[0], ['PRAN', 'Employee Tier 1 Amount', 'Employer Tier 1 Amount', 'Employee Tier 2 Amount', 'Contribution Period']);
            assert.equal(xlsxExport.dataRows[1][0], '110023456789');
            assert.equal(xlsxExport.dataRows[1][1], 6000.00);
        });
    });

    await t.test('4. Admin UI & Employee Profile Drawer (PRD Section 13)', async (st) => {
        await st.test('Renders complete NPS & Voluntary Pension status card HTML with PRAN, CRA, and KYC pills', () => {
            const profile = {
                employeeId: 'EMP0001',
                pran: '110023456789',
                isNpsApplicable: true,
                npsAccountStatus: 'ACTIVE',
                npsModel: 'Corporate Model',
                craAgency: 'Protean (NSDL)',
                popIntermediary: 'HDFC Pension Management Co.',
                tier1Active: true,
                tier2Active: false,
                contributions: {
                    employeePercentage: 10.0,
                    employerPercentage: 10.0,
                    totalContributionYtd: 90000.00
                },
                nomineeStatus: 'VERIFIED',
                kyc: {
                    overallStatus: 'VERIFIED',
                    panKyc: 'VERIFIED',
                    aadhaarKyc: 'VERIFIED',
                    bankKyc: 'VERIFIED'
                }
            };

            const html = npsUi.renderCardHtml(profile, { basicSalary: 50000, daSalary: 10000 });
            assert.ok(html.includes('110023456789'), 'Card must display PRAN');
            assert.ok(html.includes('Protean (NSDL)'), 'Card must display CRA agency');
            assert.ok(html.includes('Corporate Model'), 'Card must display NPS model');
            assert.ok(html.includes('PAN KYC'), 'Card must display PAN KYC status pill');
            assert.ok(html.includes('Aadhaar KYC'), 'Card must display Aadhaar KYC status pill');
            assert.ok(html.includes('Bank KYC'), 'Card must display Bank KYC status pill');
            assert.ok(html.includes('Section 80CCD'), 'Card must display Section 80CCD tax relief calculator');
            assert.ok(html.includes('Old vs New Regime Projection'), 'Card must display Old vs New Regime projection');
        });

        await st.test('mountNpsCard mounts safely into DOM container without throwing', async () => {
            const mockContainer = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
            const originalDoc = global.document;

            global.document = {
                getElementById: (id) => id === 'testContainer' ? mockContainer : null
            };

            await npsUi.mountNpsCard('testContainer', 'EMP0001', {
                basicPay: 50000,
                daPay: 10000
            });

            assert.ok(mockContainer.innerHTML.includes('110023456789'), 'Container must have rendered NPS card HTML');
            global.document = originalDoc;
        });
    });

    await t.test('5. Cloud Firestore Persistence & Document Schema Structure', async (st) => {
        await st.test('toFirestoreDoc constructs canonical document schema under organizations/{orgId}/employee_nps_details/{employeeId}', () => {
            const record = {
                'Employee ID': 'EMP0001',
                'Organization ID': 'ORG_KYLRX_01',
                'NPS Applicable': 'Yes',
                'PRAN': '110023456789',
                'NPS Account Status': 'ACTIVE',
                'NPS Model': 'Corporate Model',
                'CRA / Recordkeeping Agency': 'Protean (NSDL)',
                'POP / Intermediary': 'HDFC Pension Management Co.',
                'Tier I Active': 'Yes',
                'Tier II Active': 'No',
                'Date of NPS Joining': '2026-01-15',
                'Date of NPS Exit': null,
                'Employee Contribution %': 10.0,
                'Employee Contribution Amount': null,
                'Employer Contribution %': 10.0,
                'Employer Contribution Amount': null,
                'Total Contribution YTD': 90000.00,
                'Nominee Details Status': 'VERIFIED',
                'KYC Status': 'VERIFIED',
                'PAN KYC': 'VERIFIED',
                'Aadhaar KYC': 'VERIFIED',
                'Bank KYC': 'VERIFIED'
            };

            const doc = npsParser.toFirestoreDoc(record);
            assert.equal(doc.employeeId, 'EMP0001');
            assert.equal(doc.organizationId, 'ORG_KYLRX_01');
            assert.equal(doc.isNpsApplicable, true);
            assert.equal(doc.pran, '110023456789');
            assert.equal(doc.npsAccountStatus, 'ACTIVE');
            assert.equal(doc.npsModel, 'Corporate Model');
            assert.equal(doc.craAgency, 'Protean (NSDL)');
            assert.equal(doc.popIntermediary, 'HDFC Pension Management Co.');
            assert.equal(doc.tier1Active, true);
            assert.equal(doc.tier2Active, false);
            assert.equal(doc.dateOfNpsJoining, '2026-01-15');
            assert.equal(doc.dateOfNpsExit, null);
            assert.equal(doc.contributions.employeePercentage, 10.0);
            assert.equal(doc.contributions.employeeAmount, null);
            assert.equal(doc.contributions.employerPercentage, 10.0);
            assert.equal(doc.contributions.employerAmount, null);
            assert.equal(doc.contributions.totalContributionYtd, 90000.00);
            assert.equal(doc.nomineeStatus, 'VERIFIED');
            assert.equal(doc.kyc.overallStatus, 'VERIFIED');
            assert.equal(doc.kyc.panKyc, 'VERIFIED');
            assert.equal(doc.kyc.aadhaarKyc, 'VERIFIED');
            assert.equal(doc.kyc.bankKyc, 'VERIFIED');
            assert.ok(doc.createdAt);
            assert.ok(doc.updatedAt);
        });

        await st.test('In-memory and CRUD service stores and retrieves NPS profiles', async () => {
            const orgId = 'ORG_KYLRX_01';
            const empId = 'EMP_TEST_NPS';
            const payload = {
                employeeId: empId,
                organizationId: orgId,
                isNpsApplicable: true,
                pran: '110099887766',
                npsAccountStatus: 'ACTIVE',
                contributions: {
                    employeePercentage: 10.0,
                    employerPercentage: 10.0,
                    totalContributionYtd: 12000.00
                }
            };

            await npsService.saveEmployeeNpsDetails(orgId, empId, payload);
            const retrieved = await npsService.getEmployeeNpsDetails(orgId, empId);
            assert.ok(retrieved, 'Should retrieve stored NPS record');
            assert.equal(retrieved.pran, '110099887766');
            assert.equal(retrieved.contributions.totalContributionYtd, 12000.00);

            const allDocs = await npsService.listAllNpsDetails(orgId);
            assert.ok(allDocs.some(d => d.employeeId === empId));
        });
    });

    await t.test('6. Excel Workbook & Template Integrity (Templates.xlsx)', async (st) => {
        await st.test("Templates.xlsx contains 'NPS Details' sheet matching all 22 canonical columns", () => {
            const workbookPath = path.join(rootDir, 'Templates.xlsx');
            assert.ok(fs.existsSync(workbookPath), 'Templates.xlsx must exist');

            const buffer = fs.readFileSync(workbookPath);
            const wb = xlsx.read(buffer, { type: 'buffer' });

            const hasNpsDetails = wb.SheetNames.includes('NPS Details');
            assert.ok(hasNpsDetails, "'NPS Details' sheet must exist in Templates.xlsx");

            const sheet = wb.Sheets['NPS Details'];
            const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
            assert.ok(rows.length > 0, "'NPS Details' sheet must not be empty");

            const headers = rows[0].map(h => String(h).trim());
            const expected22Cols = [
                'Employee ID',
                'Organization ID',
                'NPS Applicable',
                'PRAN',
                'NPS Account Status',
                'NPS Model',
                'CRA / Recordkeeping Agency',
                'POP / Intermediary',
                'Tier I Active',
                'Tier II Active',
                'Date of NPS Joining',
                'Date of NPS Exit',
                'Employee Contribution %',
                'Employee Contribution Amount',
                'Employer Contribution %',
                'Employer Contribution Amount',
                'Total Contribution YTD',
                'Nominee Details Status',
                'KYC Status',
                'PAN KYC',
                'Aadhaar KYC',
                'Bank KYC'
            ];

            assert.deepEqual(headers, expected22Cols, "Headers in 'NPS Details' sheet must match all 22 canonical columns");
        });

        await st.test("assets/Templates.xlsx contains 'NPS Details' and 'NPS Master' sheets", () => {
            const assetPath = path.join(rootDir, 'assets', 'Templates.xlsx');
            assert.ok(fs.existsSync(assetPath), 'assets/Templates.xlsx must exist');

            const buffer = fs.readFileSync(assetPath);
            const wb = xlsx.read(buffer, { type: 'buffer' });
            assert.ok(wb.SheetNames.includes('NPS Details'), "'NPS Details' must exist in assets/Templates.xlsx");
            assert.ok(wb.SheetNames.includes('NPS Master'), "'NPS Master' must exist in assets/Templates.xlsx");
        });

        await st.test("admin-onboarding-upload.html has NPS console tabs, preview and table container", () => {
            const htmlPath = path.join(rootDir, 'admin-onboarding-upload.html');
            const html = fs.readFileSync(htmlPath, 'utf8');

            assert.ok(html.includes('id="tabNpsMaster"'), 'Must have #tabNpsMaster');
            assert.ok(html.includes('id="npsMasterManagementView"'), 'Must have #npsMasterManagementView');
            assert.ok(html.includes('id="npsMasterParseResultsContainer"'), 'Must have #npsMasterParseResultsContainer');
            assert.ok(html.includes('id="parsedNpsMasterTableBody"'), 'Must have #parsedNpsMasterTableBody');
            assert.ok(html.includes('id="btnConfirmNpsMasterIngest"'), 'Must have #btnConfirmNpsMasterIngest');
            assert.ok(html.includes('id="onboardingNpsMasterTableContainer"'), 'Must have #onboardingNpsMasterTableContainer');
            assert.ok(html.includes('src="npsDetailsParser.js"'), 'Must import npsDetailsParser.js');
            assert.ok(html.includes('src="npsDetailsService.js"'), 'Must import npsDetailsService.js');
            assert.ok(html.includes('src="npsProfileUIController.js"'), 'Must import npsProfileUIController.js');
        });

        await st.test("admin-dashboard.html has NPS statutory drawer container and script imports", () => {
            const htmlPath = path.join(rootDir, 'admin-dashboard.html');
            const html = fs.readFileSync(htmlPath, 'utf8');

            assert.ok(html.includes('id="npsStatutoryDrawerContainer"'), 'Must have #npsStatutoryDrawerContainer');
            assert.ok(html.includes('src="npsDetailsParser.js"'), 'Must import npsDetailsParser.js');
            assert.ok(html.includes('src="npsDetailsService.js"'), 'Must import npsDetailsService.js');
            assert.ok(html.includes('src="npsProfileUIController.js"'), 'Must import npsProfileUIController.js');
        });

        await st.test("employee-profile-controller.js mounts NPS card via KylrxNpsProfileUIController", () => {
            const controllerPath = path.join(rootDir, 'employee-profile-controller.js');
            const code = fs.readFileSync(controllerPath, 'utf8');

            assert.ok(code.includes('KylrxNpsProfileUIController.mountNpsCard'), 'Must mount NPS card in employee-profile-controller.js');
            assert.ok(code.includes('npsStatutoryDrawerContainer'), 'Must target npsStatutoryDrawerContainer');
        });

        await st.test("Service proxy mirrors exist in services/ directory", () => {
            const parserProxy = path.join(rootDir, 'services', 'nps-details-parser.js');
            const serviceProxy = path.join(rootDir, 'services', 'nps-details-service.js');
            const uiProxy = path.join(rootDir, 'services', 'nps-profile-ui-controller.js');
            assert.ok(fs.existsSync(parserProxy), 'services/nps-details-parser.js must exist');
            assert.ok(fs.existsSync(serviceProxy), 'services/nps-details-service.js must exist');
            assert.ok(fs.existsSync(uiProxy), 'services/nps-profile-ui-controller.js must exist');
        });
    });
});
