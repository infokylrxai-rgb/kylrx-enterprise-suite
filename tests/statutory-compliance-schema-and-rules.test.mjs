/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - STATUTORY COMPLIANCE TEST SUITE
 * ============================================================================
 * 
 * Verifies Statutory Compliance schema ingestion, rule parser, dynamic
 * deduction/contribution computation engine, regional PT slabs, deadline alert
 * reminders, and Firestore document schema matching PRD Sections 1, 4, 11, & 13
 * and the 'Statuatory Compliance' sheet from Templates.xlsx.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as xlsxNamespace from 'xlsx';
const xlsx = xlsxNamespace.default || xlsxNamespace;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load StatutoryComplianceParser (UMD module)
const parserPath = path.join(rootDir, 'statutoryComplianceParser.js');
const parserContent = fs.readFileSync(parserPath, 'utf8');
const parserModule = { exports: {} };
const parserFn = new Function('module', 'exports', 'require', parserContent);
parserFn(parserModule, parserModule.exports, (mod) => {
    if (mod === 'xlsx') return xlsx;
    return {};
});
const StatutoryParser = parserModule.exports;

// Load StatutoryComplianceService (UMD module)
const servicePath = path.join(rootDir, 'statutoryComplianceService.js');
const serviceContent = fs.readFileSync(servicePath, 'utf8');
const serviceModule = { exports: {} };
const serviceFn = new Function('module', 'exports', 'require', serviceContent);
serviceFn(serviceModule, serviceModule.exports, () => ({}));
const StatutoryService = serviceModule.exports;

// Load AlertTriggerRegistryService
import alertRegistryService from '../services/alert-trigger-registry-service.js';

test('PRD Sections 1, 4, 11, & 13: Statutory Compliance Engine Suite', async (t) => {

    await t.test('1. Exact Schema & Field Mapping (All 11 Attributes)', async (st) => {
        assert.ok(StatutoryParser, 'KylrxStatutoryComplianceParser must be exported and available');
        const attrs = StatutoryParser.STATUTORY_COMPLIANCE_ATTRIBUTES;
        assert.equal(attrs.length, 11, 'Must define exactly 11 canonical attributes');

        const expectedKeys = [
            'Compliance_Code',
            'Compliance_Name',
            'Applicable',
            'Registration_Number',
            'State',
            'Effective_From',
            'Wage_Ceiling_or_Rule',
            'Employee_Contribution_Rate',
            'Employer_Contribution_Rate',
            'Due_Date_Day',
            'Active'
        ];

        const actualKeys = attrs.map(a => a.key);
        for (const key of expectedKeys) {
            assert.ok(actualKeys.includes(key), `Attribute catalog must contain '${key}'`);
        }

        // Test normalizer mapping row
        const rawRow = {
            'Compliance_Code': 'COMP_PF',
            'Compliance_Name': 'Employees Provident Fund',
            'Applicable': 'Yes',
            'Registration_Number': 'KN/BNG/0012345/000',
            'State': 'All India',
            'Effective_From': '2026-01-01',
            'Wage_Ceiling_or_Rule': '15000',
            'Employee_Contribution_Rate': '12%',
            'Employer_Contribution_Rate': '12%',
            'Due_Date_Day': 15,
            'Active': 'Yes'
        };

        const normalized = StatutoryParser.normalizeComplianceRow(rawRow, 0);
        assert.equal(normalized.Compliance_Code, 'COMP_PF');
        assert.equal(normalized.Compliance_Name, 'Employees Provident Fund');
        assert.equal(normalized.Applicable, true);
        assert.equal(normalized.Registration_Number, 'KN/BNG/0012345/000');
        assert.equal(normalized.State, 'All India');
        assert.equal(normalized.Effective_From, '2026-01-01');
        assert.equal(normalized.Wage_Ceiling_or_Rule, 15000);
        assert.equal(normalized.Employee_Contribution_Rate, 12.0);
        assert.equal(normalized.Employer_Contribution_Rate, 12.0);
        assert.equal(normalized.Due_Date_Day, 15);
        assert.equal(normalized.Active, true);
    });

    await t.test('2. Setup & Ingestion Support (PRD Section 1 - SheetJS, Validation & Consistency Rules)', async (st) => {
        // Date Sanitization tests
        assert.equal(StatutoryParser.sanitizeIsoDate('2026-01-01'), '2026-01-01');
        assert.equal(StatutoryParser.sanitizeIsoDate('01/01/2026'), '2026-01-01');
        assert.equal(StatutoryParser.sanitizeIsoDate(46297), '2026-10-02');

        // Boolean Sanitization tests
        assert.equal(StatutoryParser.sanitizeBoolean('Yes'), true);
        assert.equal(StatutoryParser.sanitizeBoolean('No'), false);
        assert.equal(StatutoryParser.sanitizeBoolean('Y'), true);
        assert.equal(StatutoryParser.sanitizeBoolean('N'), false);
        assert.equal(StatutoryParser.sanitizeBoolean(1), true);
        assert.equal(StatutoryParser.sanitizeBoolean(0), false);

        // Rate & Ceiling parser tests
        assert.equal(StatutoryParser.parseRateOrFormula('12%'), 12.0);
        assert.equal(StatutoryParser.parseRateOrFormula('0.75%'), 0.75);
        assert.equal(StatutoryParser.parseRateOrFormula(200), 200);
        assert.equal(StatutoryParser.parseWageCeiling('15,000'), 15000);
        assert.equal(StatutoryParser.parseWageCeiling('21000'), 21000);

        // Consistency Enforcement: if Applicable is true, require non-empty Registration_Number and Effective_From
        const inconsistentRows = [
            {
                'Compliance_Code': 'COMP_TEST_INVALID',
                'Compliance_Name': 'Invalid Policy Missing Reg',
                'Applicable': 'Yes',
                'Registration_Number': '', // Empty!
                'State': 'Karnataka',
                'Effective_From': '2026-01-01',
                'Wage_Ceiling_or_Rule': 15000,
                'Employee_Contribution_Rate': '12%',
                'Employer_Contribution_Rate': '12%',
                'Due_Date_Day': 15,
                'Active': 'Yes'
            }
        ];

        const invalidResult = StatutoryParser.parseStatutoryComplianceSheet(inconsistentRows);
        assert.equal(invalidResult.valid, false, 'Must fail when Applicable is Yes but Registration_Number is empty');
        assert.ok(invalidResult.errors.some(e => e.includes("'Registration_Number' must be specified")));

        // Deduplication: prevent duplicate Compliance_Code entries
        const duplicateRows = [
            {
                'Compliance_Code': 'COMP_PF',
                'Compliance_Name': 'EPF Entry 1',
                'Applicable': 'Yes',
                'Registration_Number': 'REG123',
                'State': 'All India',
                'Effective_From': '2026-01-01',
                'Wage_Ceiling_or_Rule': 15000,
                'Employee_Contribution_Rate': 12,
                'Employer_Contribution_Rate': 12,
                'Due_Date_Day': 15,
                'Active': 'Yes'
            },
            {
                'Compliance_Code': 'COMP_PF',
                'Compliance_Name': 'EPF Entry 2 (Duplicate)',
                'Applicable': 'Yes',
                'Registration_Number': 'REG123',
                'State': 'All India',
                'Effective_From': '2026-01-01',
                'Wage_Ceiling_or_Rule': 15000,
                'Employee_Contribution_Rate': 12,
                'Employer_Contribution_Rate': 12,
                'Due_Date_Day': 15,
                'Active': 'Yes'
            }
        ];

        const dedupeResult = StatutoryParser.parseStatutoryComplianceSheet(duplicateRows);
        assert.equal(dedupeResult.valid, false);
        assert.ok(dedupeResult.errors.some(e => e.includes('Duplicate \'Compliance_Code\' detected')));

        // Test Live Templates.xlsx file ingestion via SheetJS
        const templatesPath = path.join(rootDir, 'Templates.xlsx');
        assert.ok(fs.existsSync(templatesPath), 'Templates.xlsx must exist');
        const wb = xlsx.readFile(templatesPath);
        const parseResult = StatutoryParser.parseWorkbook(wb);
        assert.equal(parseResult.valid, true, `Ingestion of Templates.xlsx must have zero errors. Found: ${parseResult.errors.join(', ')}`);
        assert.ok(parseResult.records.length >= 6, 'Must parse at least 6 canonical Indian statutory policies');
        assert.ok(parseResult.firestoreDocs.length >= 6);
    });

    await t.test('3. CRUD Operations and In-Memory / Firestore Ledger Persistence', async (st) => {
        StatutoryService._resetLedger();
        const initialRules = StatutoryService.getAllComplianceRules('test_org');
        assert.equal(initialRules.length, 6, 'Should load 6 default policies (PF, ESI, PT KA, PT MH, LWF KA, Gratuity)');

        // Retrieve single rule
        const pfRule = StatutoryService.getComplianceRuleByCode('COMP_PF', 'test_org');
        assert.ok(pfRule, 'COMP_PF rule must exist');
        assert.equal(pfRule.wageCeiling, 15000);
        assert.equal(pfRule.dueDateDay, 15);

        // Update rule
        StatutoryService.updateComplianceRule('COMP_PF', { wageCeiling: 20000 }, 'test_org');
        const updatedPf = StatutoryService.getComplianceRuleByCode('COMP_PF', 'test_org');
        assert.equal(updatedPf.wageCeiling, 20000);

        // Toggle applicable
        StatutoryService.toggleComplianceApplicable('COMP_ESI', false, 'test_org');
        const toggledEsi = StatutoryService.getComplianceRuleByCode('COMP_ESI', 'test_org');
        assert.equal(toggledEsi.isApplicable, false);

        // Create new policy
        const newPolicy = {
            complianceCode: 'COMP_CUSTOM_TAX',
            complianceName: 'Custom State Municipal Cess',
            isApplicable: true,
            registrationNumber: 'MUNI-9988',
            state: 'Delhi',
            effectiveFrom: '2026-04-01',
            wageCeiling: 50000,
            employeeContributionRate: 1.0,
            employerContributionRate: 1.0,
            dueDateDay: 25,
            isActive: true
        };
        const createResult = StatutoryService.createComplianceRule(newPolicy, 'test_org');
        assert.equal(createResult.success, true);
        assert.ok(StatutoryService.getComplianceRuleByCode('COMP_CUSTOM_TAX', 'test_org'));

        // Delete policy
        const deleteResult = StatutoryService.deleteComplianceRule('COMP_CUSTOM_TAX', 'test_org');
        assert.equal(deleteResult.success, true);
        assert.equal(StatutoryService.getComplianceRuleByCode('COMP_CUSTOM_TAX', 'test_org'), null);
    });

    await t.test('4. Dynamic Payroll Calculation Integration (PRD Section 4)', async (st) => {
        StatutoryService._resetLedger();

        // Case A: High Earner (Executive in Karnataka)
        // Gross = 100,000, Basic = 50,000 (PF wage ceiling 15,000 applies)
        const empExec = {
            employeeId: 'EMP0001',
            name: 'Super Admin',
            state: 'Karnataka',
            pfApplicable: true,
            esicApplicable: true,
            ptApplicable: true
        };
        const compExec = {
            grossSalary: 100000,
            basic: 50000
        };

        const calcExec = StatutoryService.calculateStatutoryDeductions(empExec, compExec, { month: 10, year: 2026 }, 'test_org');

        // PF: Capped at 15,000 basic -> EE PF = 15,000 * 12% = 1,800
        assert.equal(calcExec.employeeDeductions.pf, 1800, 'Employee PF should be capped at 1,800 for 15k statutory ceiling');
        // Employer Split: EPS = 1,250 (8.33% of 15k), ER EPF = 550 (remainder of 1,800)
        assert.equal(calcExec.employerContributions.pfEps, 1250, 'Employer EPS must be capped at 1,250');
        assert.equal(calcExec.employerContributions.pfEpf, 550, 'Employer EPF must be 550');
        assert.equal(calcExec.employerContributions.pfTotal, 1800, 'Total Employer PF must match Employee PF (1,800)');

        // ESI: Gross 100,000 > 21,000 ceiling -> Exempt (0)
        assert.equal(calcExec.employeeDeductions.esic, 0, 'ESI must be 0 for gross > 21,000');
        assert.equal(calcExec.employerContributions.esic, 0);

        // PT: Karnataka gross >= 25,000 -> 200 INR
        assert.equal(calcExec.employeeDeductions.pt, 200, 'Karnataka PT must be 200 for gross >= 25,000');

        // Gratuity provision: ~4.81% of Basic (50,000 * 0.0481 = 2,405)
        assert.ok(calcExec.employerContributions.gratuity > 0, 'Employer gratuity provision must be calculated');

        // Total Employee Deductions = 1,800 (PF) + 0 (ESI) + 200 (PT) = 2,000
        assert.equal(calcExec.employeeDeductions.total, 2000);
        assert.equal(calcExec.netTakeHomeImpact, -2000);

        // Case B: Low Earner Eligible for ESI (Manufacturing / Junior Tech in Maharashtra)
        // Gross = 18,000, Basic = 9,000
        const empJunior = {
            employeeId: 'EMP0099',
            name: 'Vikram Joshi',
            state: 'Maharashtra',
            pfApplicable: true,
            esicApplicable: true,
            ptApplicable: true
        };
        const compJunior = {
            grossSalary: 18000,
            basic: 9000
        };

        const calcJunior = StatutoryService.calculateStatutoryDeductions(empJunior, compJunior, { month: 10, year: 2026 }, 'test_org');

        // PF: Basic 9,000 < 15,000 -> EE PF = 9,000 * 12% = 1,080
        assert.equal(calcJunior.employeeDeductions.pf, 1080);

        // ESI: Gross 18,000 <= 21,000 ceiling -> Eligible!
        // EE ESI = Math.ceil(18,000 * 0.75%) = 135 INR
        // ER ESI = Math.ceil(18,000 * 3.25%) = 585 INR
        assert.equal(calcJunior.employeeDeductions.esic, 135, 'ESI Employee deduction should be 135 (0.75% of 18,000)');
        assert.equal(calcJunior.employerContributions.esic, 585, 'ESI Employer contribution should be 585 (3.25% of 18,000)');

        // PT: Maharashtra gross 18,000 > 10,000 in October -> 200 INR
        assert.equal(calcJunior.employeeDeductions.pt, 200);

        // Case C: Maharashtra February Higher PT Slab (300 INR)
        const calcJuniorFeb = StatutoryService.calculateStatutoryDeductions(empJunior, compJunior, { month: 2, year: 2026 }, 'test_org');
        assert.equal(calcJuniorFeb.employeeDeductions.pt, 300, 'Maharashtra PT in February must be 300 INR');
    });

    await t.test('5. Alert Monitor & Compliance Deadlines (PRD Section 11)', async (st) => {
        StatutoryService._resetLedger();

        // Test 5-day warning (Evaluated on 10th for 15th due date)
        const date10th = new Date('2026-10-10T12:00:00.000Z');
        const alertCheck10 = StatutoryService.evaluateComplianceDeadlines(date10th, 'test_org');
        assert.ok(alertCheck10.activeAlertCount >= 2, 'Should fire 5-day warnings for PF and ESI (due on 15th)');

        const pfAlert10 = alertCheck10.alerts.find(a => a.complianceCode === 'COMP_PF');
        assert.ok(pfAlert10);
        assert.equal(pfAlert10.daysRemaining, 5);
        assert.equal(pfAlert10.status, 'REMINDER_5_DAYS');
        assert.equal(pfAlert10.severity, 'warning');
        assert.ok(pfAlert10.exportUrl.includes('/api/admin/statutory/export-ecr'));

        // Test 2-day urgent warning (Evaluated on 13th for 15th due date)
        const date13th = new Date('2026-10-13T12:00:00.000Z');
        const alertCheck13 = StatutoryService.evaluateComplianceDeadlines(date13th, 'test_org');
        const pfAlert13 = alertCheck13.alerts.find(a => a.complianceCode === 'COMP_PF');
        assert.equal(pfAlert13.daysRemaining, 2);
        assert.equal(pfAlert13.status, 'URGENT_2_DAYS');
        assert.equal(pfAlert13.severity, 'critical');

        // Verify EVT_STATUTORY_DEADLINE_APPROACHING registered in AlertTriggerRegistryService
        const trigger = alertRegistryService.getTriggerByKey('EVT_STATUTORY_DEADLINE_APPROACHING');
        assert.ok(trigger, 'EVT_STATUTORY_DEADLINE_APPROACHING must be registered in canonical alert trigger registry');
        assert.equal(trigger.module, 'statutory');
        assert.equal(trigger.severity, 'critical');
    });

    await t.test('6. Data Architecture & Cloud Firestore Document Schema (PRD § 5)', async (st) => {
        const record = {
            Compliance_Code: "COMP_PF",
            Compliance_Name: "Employees Provident Fund",
            Applicable: true,
            Registration_Number: "KN/BNG/0012345/000",
            State: "All India",
            Effective_From: "2026-01-01",
            Wage_Ceiling_or_Rule: 15000,
            Employee_Contribution_Rate: 12.0,
            Employer_Contribution_Rate: 12.0,
            Due_Date_Day: 15,
            Active: true
        };

        const doc = StatutoryParser.toFirestoreDocument(record, 'org_test');
        assert.equal(doc.complianceCode, "COMP_PF");
        assert.equal(doc.complianceName, "Employees Provident Fund");
        assert.equal(doc.isApplicable, true);
        assert.equal(doc.registrationNumber, "KN/BNG/0012345/000");
        assert.equal(doc.state, "All India");
        assert.equal(doc.effectiveFrom, "2026-01-01");
        assert.equal(doc.wageCeiling, 15000);
        assert.equal(doc.employeeContributionRate, 12.0);
        assert.equal(doc.employerContributionRate, 12.0);
        assert.equal(doc.dueDateDay, 15);
        assert.equal(doc.isActive, true);
        assert.equal(doc.orgId, 'org_test');
    });

    await t.test('7. HTML & DOM Wiring Verification', async (st) => {
        // Verify admin-settings.html
        const settingsHtml = fs.readFileSync(path.join(rootDir, 'admin-settings.html'), 'utf8');
        assert.ok(settingsHtml.includes('data-tab="statutory_rules"'), 'admin-settings.html must have statutory_rules nav tab');
        assert.ok(settingsHtml.includes('id="statutory_rules"'), 'admin-settings.html must have statutory_rules tab content');
        assert.ok(settingsHtml.includes('id="settingsStatutoryRulesContainer"'), 'admin-settings.html must have settingsStatutoryRulesContainer');
        assert.ok(settingsHtml.includes('statutoryComplianceService.js'), 'admin-settings.html must import statutoryComplianceService.js');

        // Verify admin-onboarding-upload.html
        const uploadHtml = fs.readFileSync(path.join(rootDir, 'admin-onboarding-upload.html'), 'utf8');
        assert.ok(uploadHtml.includes('id="tabStatutoryCompliance"'), 'admin-onboarding-upload.html must have tabStatutoryCompliance');
        assert.ok(uploadHtml.includes('id="statutoryComplianceParseResultsContainer"'), 'admin-onboarding-upload.html must have statutoryComplianceParseResultsContainer');
        assert.ok(uploadHtml.includes('id="statutoryComplianceManagementView"'), 'admin-onboarding-upload.html must have statutoryComplianceManagementView');
        assert.ok(uploadHtml.includes('statutoryComplianceParser.js'), 'admin-onboarding-upload.html must import statutoryComplianceParser.js');
    });

});
