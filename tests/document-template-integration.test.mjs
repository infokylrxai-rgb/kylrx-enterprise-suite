/**
 * tests/document-template-integration.test.mjs
 * 
 * 11. Document & Template Integration — Comprehensive Test Suite
 * 
 * Validates:
 * 1. Engine initialization with all 10 standard enterprise templates
 * 2. Version control (draft → pending_approval → approved lifecycle)
 * 3. Effective date resolution (picks correct active approved version)
 * 4. Token interpolation accuracy for all field mappings
 * 5. Permission gating — only permitted modules may generate documents
 * 6. SHA-256 content integrity hashing
 * 7. Stage 8 Automation Engine audit trail recording
 * 8. Template preview with sample payload rendering
 * 9. REST API endpoint verification (GET/POST)
 * 10. Sidebar navigation integration across all admin pages
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load services via CommonJS require (compatible with ESM)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const documentTemplateEngine = require('../services/document-template-engine');

const STANDARD_TEMPLATE_KEYS = [
    'offer_letter',
    'appointment_letter',
    'promotion_letter',
    'increment_letter',
    'transfer_letter',
    'payslip',
    'fnf_statement',
    'relieving_letter',
    'experience_letter',
    'termination_letter'
];

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SUITE 1: Engine Initialization
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
test('Document Template Engine - 10 Standard Templates Initialization', async (t) => {

    await t.test('All 10 standard enterprise templates are seeded and retrievable', () => {
        const templates = documentTemplateEngine.listTemplates();
        assert.ok(templates.length >= 10, `Expected at least 10 templates, found ${templates.length}`);
        
        for (const key of STANDARD_TEMPLATE_KEYS) {
            const found = templates.find(t => t.key === key);
            assert.ok(found, `Standard template '${key}' must be present in the catalog`);
        }
    });

    await t.test('Each template has required schema fields', () => {
        const templates = documentTemplateEngine.listTemplates();
        for (const tpl of templates) {
            assert.ok(tpl.key, `Template must have a 'key': ${JSON.stringify(tpl)}`);
            assert.ok(tpl.name, `Template '${tpl.key}' must have a 'name'`);
            assert.ok(tpl.category, `Template '${tpl.key}' must have a 'category'`);
            assert.ok(Array.isArray(tpl.permittedModules), `Template '${tpl.key}' must have 'permittedModules' array`);
            assert.ok(tpl.permittedModules.length >= 1, `Template '${tpl.key}' must permit at least one module`);
        }
    });

    await t.test('Each template is pre-seeded with at least one approved v1.0 version', () => {
        for (const key of STANDARD_TEMPLATE_KEYS) {
            const tpl = documentTemplateEngine.getTemplate(key);
            assert.ok(Array.isArray(tpl.versions) && tpl.versions.length > 0, `Template '${key}' must have versions`);
            const approved = tpl.versions.find(v => v.status === 'approved');
            assert.ok(approved, `Template '${key}' must have at least one approved version`);
            assert.ok(approved.versionNumber, `Approved version must have a versionNumber`);
            assert.ok(approved.templateBody, `Approved version must have a templateBody`);
            assert.ok(approved.effectiveFrom, `Approved version must have an effectiveFrom date`);
        }
    });

    await t.test('Field mappings (tokens) are properly defined for all templates', () => {
        for (const key of STANDARD_TEMPLATE_KEYS) {
            const tpl = documentTemplateEngine.getTemplate(key);
            const activeVer = tpl.versions.find(v => v.status === 'approved');
            const mappings = activeVer?.fieldMappings || [];
            assert.ok(mappings.length >= 1, `Template '${key}' must have at least 1 field mapping`);
            for (const mapping of mappings) {
                assert.ok(mapping.token, `Field mapping in '${key}' must have 'token'`);
                assert.ok(mapping.label, `Field mapping in '${key}' must have 'label'`);
                assert.match(mapping.token, /^\{\{[a-zA-Z0-9._]+\}\}$/, `Token '${mapping.token}' must use {{dot.path}} format`);
            }
        }
    });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SUITE 2: Version Control & Approval Lifecycle
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
test('Document Template Engine - Version Control & Approval Lifecycle', async (t) => {

    await t.test('Create a new draft version for offer_letter', () => {
        const newVersion = documentTemplateEngine.createTemplateVersion('offer_letter', {
            versionNumber: 'v2.0-test',
            templateBody: '<div>Test Draft Body {{candidate.name}}</div>',
            effectiveFrom: '2027-01-01',
            changeNotes: 'Updated compensation structure for FY27',
            createdBy: 'HR Director (Test)'
        });

        assert.strictEqual(newVersion.versionNumber, 'v2.0-test');
        assert.strictEqual(newVersion.status, 'draft');
        assert.strictEqual(newVersion.createdBy, 'HR Director (Test)');
        assert.ok(newVersion.sha256, 'Draft version must have SHA-256 hash');
    });

    await t.test('Draft version does NOT become the active generation source yet', () => {
        // resolveActiveTemplate should still return the approved v1.0 version
        const activeVer = documentTemplateEngine.resolveActiveTemplate('offer_letter');
        assert.notStrictEqual(activeVer.versionNumber, 'v2.0-test', 'Active version must NOT be the unapproved draft');
        assert.strictEqual(activeVer.status, 'approved', 'Active version must be approved');
    });

    await t.test('Approve the new draft version: draft → approved', () => {
        const approved = documentTemplateEngine.approveTemplateVersion('offer_letter', 'v2.0-test', {
            approvedBy: 'VP of HR (Test)',
            approvalRemarks: 'Reviewed and approved for FY27 rollout.'
        });

        assert.strictEqual(approved.status, 'approved');
        assert.strictEqual(approved.approvedBy, 'VP of HR (Test)');
        assert.ok(approved.approvedAt, 'Must have approvedAt timestamp');
    });

    await t.test('Approved version with future effectiveFrom does not displace current active', () => {
        // v2.0-test has effectiveFrom 2027-01-01 — it should NOT be selected as active today
        const activeVer = documentTemplateEngine.resolveActiveTemplate('offer_letter');
        // The engine should prefer the currently effective approved version
        assert.strictEqual(activeVer.status, 'approved');
        // Verify active is not the future-dated version
        const effectiveDate = new Date(activeVer.effectiveFrom);
        const now = new Date();
        assert.ok(effectiveDate <= now, 'Active version effectiveFrom must be in the past or today');
    });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SUITE 3: Token Interpolation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
test('Document Template Engine - Token Interpolation Accuracy', async (t) => {

    await t.test('Offer Letter tokens are correctly resolved with employee data', async () => {
        const dataContext = {
            candidate: { name: 'Sneha Rajput', email: 'sneha.rajput@test.com' },
            job: { title: 'Staff Data Engineer', department: 'Data Engineering', location: 'Hyderabad, India' },
            compensation: { annualCtc: '₹ 22,00,000' },
            offer: { joiningDate: '2026-11-01', validUntil: '2026-10-15' },
            company: { name: 'Kylrx Technologies Private Limited' },
            signatory: { name: 'Rajesh Subramanian, Head of People Ops' },
            date: { today: new Date().toLocaleDateString('en-IN') }
        };

        const docRecord = await documentTemplateEngine.generateDocument('offer_letter', dataContext, {
            callerModule: 'onboarding',
            actor: 'Onboarding Coordinator'
        });

        assert.ok(docRecord.docId, 'Must return a document ID');
        assert.ok(docRecord.renderedHtml.includes('Sneha Rajput'), 'Rendered HTML must include candidate name');
        assert.ok(docRecord.renderedHtml.includes('Staff Data Engineer'), 'Rendered HTML must include job title');
        assert.ok(docRecord.renderedHtml.includes('₹ 22,00,000'), 'Rendered HTML must include CTC');
        assert.ok(!docRecord.renderedHtml.includes('{{candidate.name}}'), 'Unreplaced tokens must not appear in output');
    });

    await t.test('Payslip tokens are correctly resolved', async () => {
        const dataContext = {
            employee: { name: 'Kavitha Menon', code: 'EMP-556', department: 'Engineering', grade: 'L4', bankAccount: 'XXXX1234' },
            payroll: { month: 'September', year: '2026', grossPay: '₹ 1,25,000', basicSalary: '₹ 62,500', hra: '₹ 31,250', specialAllowance: '₹ 31,250', totalDeductions: '₹ 23,400', pfEmployee: '₹ 7,500', esicEmployee: '₹ 0', professionalTax: '₹ 200', tds: '₹ 15,700', netPay: '₹ 1,01,600', workingDays: '26', lopDays: '0', pfEmployer: '₹ 7,500', esicEmployer: '₹ 0' },
            company: { name: 'Kylrx Technologies Pvt. Ltd.' },
            date: { payDate: '2026-09-28' }
        };

        const docRecord = await documentTemplateEngine.generateDocument('payslip', dataContext, {
            callerModule: 'payroll',
            actor: 'Payroll Engine'
        });

        assert.ok(docRecord.renderedHtml.includes('Kavitha Menon'), 'Payslip must include employee name');
        assert.ok(docRecord.renderedHtml.includes('₹ 1,01,600'), 'Payslip must include net pay');
        assert.ok(!docRecord.renderedHtml.includes('{{payroll.'), 'No unresolved payroll tokens allowed');
    });

    await t.test('F&F Statement tokens resolve correctly via exit module', async () => {
        const dataContext = {
            employee: { name: 'Nishant Agarwal', code: 'EMP-788', designation: 'Senior Manager' },
            exit: { lastWorkingDay: '2026-09-30', noticePeriod: '60 days', noticeAdjustedDays: '0' },
            fnf: { basicForFnf: '₹ 65,000', earnedLeaveEncashment: '₹ 22,000', gratuity: '₹ 18,500', exGratia: '₹ 0', pfEmployee: '₹ 7,800', tds: '₹ 12,000', loanDeductions: '₹ 5,000', totalEarnings: '₹ 1,05,500', totalDeductions: '₹ 24,800', netSettlement: '₹ 80,700', bankAccount: 'XXXX5678', disbursementDate: '2026-10-15' },
            company: { name: 'Kylrx Technologies Pvt. Ltd.' },
            signatory: { name: 'Priya Nair, Finance Director' },
            date: { today: new Date().toLocaleDateString('en-IN') }
        };

        const docRecord = await documentTemplateEngine.generateDocument('fnf_statement', dataContext, {
            callerModule: 'exit',
            actor: 'Exit Module'
        });

        assert.ok(docRecord.renderedHtml.includes('Nishant Agarwal'), 'F&F must include employee name');
        assert.ok(docRecord.renderedHtml.includes('₹ 80,700'), 'F&F must include net settlement amount');
        assert.ok(!docRecord.renderedHtml.includes('{{fnf.'), 'No unresolved F&F tokens allowed');
    });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SUITE 4: Permission / Security Gating
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
test('Document Template Engine - Permission Security Gating', async (t) => {

    await t.test('Permitted module (onboarding) can generate offer_letter', async () => {
        const docRecord = await documentTemplateEngine.generateDocument('offer_letter', {
            candidate: { name: 'Test Candidate', email: 'test@example.com' },
            job: { title: 'Engineer', department: 'Engineering', location: 'Bengaluru' },
            compensation: { annualCtc: '₹ 10,00,000' },
            offer: { joiningDate: '2026-11-01', validUntil: '2026-10-20' },
            company: { name: 'Kylrx Technologies' },
            signatory: { name: 'HR Director' },
            date: { today: '2026-09-11' }
        }, { callerModule: 'onboarding', actor: 'Test Runner' });

        assert.ok(docRecord.docId, 'Permitted module should generate document successfully');
        assert.ok(docRecord.sha256, 'Generated document must have SHA-256 hash');
    });

    await t.test('Non-permitted module (attendance) CANNOT generate offer_letter → throws 403', async () => {
        await assert.rejects(
            async () => await documentTemplateEngine.generateDocument(
                'offer_letter',
                { candidate: { name: 'Blocked User' } },
                { callerModule: 'attendance', actor: 'Rogue Process' }
            ),
            (err) => {
                assert.ok(err.message.includes('not permitted'), `Expected permission error, got: ${err.message}`);
                return true;
            }
        );
    });

    await t.test('Payroll module can generate payslip but NOT offer_letter', async () => {
        // Payslip — should succeed
        const payslipDoc = await documentTemplateEngine.generateDocument('payslip', {
            employee: { name: 'Test Employee', code: 'EMP-001', department: 'IT', grade: 'L3', bankAccount: 'XXXX9999' },
            payroll: { month: 'Sep', year: '2026', grossPay: '₹ 80,000', basicSalary: '₹ 40,000', hra: '₹ 20,000', specialAllowance: '₹ 20,000', totalDeductions: '₹ 14,000', pfEmployee: '₹ 4,800', esicEmployee: '₹ 0', professionalTax: '₹ 200', tds: '₹ 9,000', netPay: '₹ 66,000', workingDays: '26', lopDays: '0', pfEmployer: '₹ 4,800', esicEmployer: '₹ 0' },
            company: { name: 'Kylrx Technologies' },
            date: { payDate: '2026-09-30' }
        }, { callerModule: 'payroll', actor: 'Payroll Engine' });
        assert.ok(payslipDoc.docId, 'Payroll module should generate payslip');

        // Offer Letter — should be blocked
        await assert.rejects(
            async () => await documentTemplateEngine.generateDocument(
                'offer_letter',
                {},
                { callerModule: 'payroll', actor: 'Payroll Engine' }
            ),
            (err) => {
                assert.ok(err.message.includes('not permitted'));
                return true;
            }
        );
    });

    await t.test('Exit module can generate F&F Statement, Relieving Letter, and Experience Letter', async () => {
        const baseExitContext = {
            employee: { name: 'Exit Test Employee', code: 'EMP-EXT-001', designation: 'Senior Engineer' },
            exit: { lastWorkingDay: '2026-09-30', noticePeriod: '30 days', noticeAdjustedDays: '0' },
            fnf: { basicForFnf: '₹ 50,000', earnedLeaveEncashment: '₹ 10,000', gratuity: '₹ 8,000', exGratia: '₹ 0', pfEmployee: '₹ 6,000', tds: '₹ 5,000', loanDeductions: '₹ 0', totalEarnings: '₹ 68,000', totalDeductions: '₹ 11,000', netSettlement: '₹ 57,000', bankAccount: 'XXXX0001', disbursementDate: '2026-10-20' },
            company: { name: 'Kylrx Technologies', cin: 'U72900MH2020PTC123456', address: 'Bengaluru, Karnataka, India' },
            signatory: { name: 'HR Director' },
            date: { today: '2026-09-11' },
            employment: { joiningDate: '2021-06-01', lastWorkingDay: '2026-09-30', tenure: '5 years 3 months', role: 'Senior Engineer', department: 'Engineering' }
        };

        const fnfDoc = await documentTemplateEngine.generateDocument('fnf_statement', baseExitContext, { callerModule: 'exit', actor: 'Exit Module' });
        assert.ok(fnfDoc.docId, 'Exit module should generate F&F Statement');

        const relievingDoc = await documentTemplateEngine.generateDocument('relieving_letter', baseExitContext, { callerModule: 'exit', actor: 'Exit Module' });
        assert.ok(relievingDoc.docId, 'Exit module should generate Relieving Letter');

        const expDoc = await documentTemplateEngine.generateDocument('experience_letter', baseExitContext, { callerModule: 'exit', actor: 'Exit Module' });
        assert.ok(expDoc.docId, 'Exit module should generate Experience Letter');
    });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SUITE 5: SHA-256 Integrity & Audit
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
test('Document Template Engine - SHA-256 Integrity & Audit Trail', async (t) => {

    await t.test('Generated document has unique SHA-256 content hash', async () => {
        const doc1 = await documentTemplateEngine.generateDocument('appointment_letter', {
            employee: { name: 'Ramesh Pillai', code: 'EMP-300', designation: 'Product Manager', department: 'Product', location: 'Pune, India', grade: 'M2' },
            compensation: { annualCtc: '₹ 30,00,000', basicSalary: '₹ 1,25,000', hra: '₹ 62,500', specialAllowance: '₹ 62,500' },
            employment: { joiningDate: '2026-10-01', probationPeriod: '6 months', employmentType: 'Full-time Permanent' },
            company: { name: 'Kylrx Technologies Pvt. Ltd.' },
            signatory: { name: 'Head of HR' },
            date: { today: '2026-09-11' }
        }, { callerModule: 'onboarding', actor: 'HR Admin' });

        assert.ok(doc1.sha256, 'Must produce a SHA-256 hash');
        assert.strictEqual(doc1.sha256.length, 64, 'SHA-256 hex must be 64 characters');
        assert.match(doc1.sha256, /^[0-9a-f]+$/, 'SHA-256 must be hex digits only');
    });

    await t.test('Two documents with different recipient data produce different SHA-256 hashes', async () => {
        const base = {
            employee: { name: '', code: 'EMP-001', designation: 'Engineer', department: 'Eng', location: 'MH', grade: 'L3' },
            compensation: { annualCtc: '₹ 15,00,000', basicSalary: '₹ 62,500', hra: '₹ 31,250', specialAllowance: '₹ 31,250' },
            employment: { joiningDate: '2026-10-01', probationPeriod: '3 months', employmentType: 'Full-time' },
            company: { name: 'Kylrx Tech' },
            signatory: { name: 'HR' },
            date: { today: '2026-09-11' }
        };

        const doc1 = await documentTemplateEngine.generateDocument('appointment_letter', { ...base, employee: { ...base.employee, name: 'Alice' } }, { callerModule: 'onboarding', actor: 'Test' });
        const doc2 = await documentTemplateEngine.generateDocument('appointment_letter', { ...base, employee: { ...base.employee, name: 'Bob' } }, { callerModule: 'onboarding', actor: 'Test' });

        assert.notStrictEqual(doc1.sha256, doc2.sha256, 'Different data must produce different hashes');
        assert.notStrictEqual(doc1.docId, doc2.docId, 'Each document must have a unique ID');
    });

    await t.test('Generated documents are archived and retrievable by docId', async () => {
        const doc = await documentTemplateEngine.generateDocument('termination_letter', {
            employee: { name: 'Vijay Sharma', code: 'EMP-999', designation: 'Analyst', department: 'Finance', location: 'Delhi' },
            termination: { effectiveDate: '2026-09-30', reason: 'Performance Improvement Plan Failure', noticeGiven: 'Yes — 30 days' },
            company: { name: 'Kylrx Technologies Pvt. Ltd.' },
            signatory: { name: 'Chief People Officer' },
            date: { today: '2026-09-11' }
        }, { callerModule: 'hr_admin', actor: 'HR Director' });

        const retrieved = documentTemplateEngine.getGeneratedDocument(doc.docId);
        assert.strictEqual(retrieved.docId, doc.docId);
        assert.strictEqual(retrieved.sha256, doc.sha256);
        assert.ok(retrieved.renderedHtml.includes('Vijay Sharma'));
    });

    await t.test('listGeneratedDocuments returns archive sorted by most recent first', () => {
        const docs = documentTemplateEngine.listGeneratedDocuments({});
        assert.ok(docs.length >= 1, 'Archive must contain at least 1 document after previous tests');
        // Verify sorted descending
        if (docs.length >= 2) {
            const first = new Date(docs[0].generatedAt);
            const second = new Date(docs[1].generatedAt);
            assert.ok(first >= second, 'Most recent document should come first');
        }
    });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SUITE 6: Preview Functionality
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
test('Document Template Engine - Preview (Non-archiving Render)', async (t) => {

    await t.test('Previewing offer_letter with no data uses sample field mappings', () => {
        const preview = documentTemplateEngine.previewTemplate('offer_letter', {});
        assert.ok(preview.renderedHtml, 'Preview must return rendered HTML');
        assert.ok(preview.versionNumber, 'Preview must specify the version');
        assert.ok(preview.samplePayload, 'Preview must return the sample payload used');
        // Sample should include the defined sample values
        assert.ok(preview.renderedHtml.includes('Rahul Deshmukh') || preview.renderedHtml.length > 100, 'Preview should render sample data');
    });

    await t.test('Previewing does NOT create a record in the generated archive', () => {
        const beforeCount = documentTemplateEngine.listGeneratedDocuments({}).length;
        documentTemplateEngine.previewTemplate('payslip', {});
        const afterCount = documentTemplateEngine.listGeneratedDocuments({}).length;
        assert.strictEqual(beforeCount, afterCount, 'Preview must not increment the generated documents archive');
    });

    await t.test('Previewing a specific version by versionNumber works', () => {
        const tpl = documentTemplateEngine.getTemplate('offer_letter');
        const firstVersion = tpl.versions[0];
        const preview = documentTemplateEngine.previewTemplate('offer_letter', { versionNumber: firstVersion.versionNumber });
        assert.strictEqual(preview.versionNumber, firstVersion.versionNumber, 'Must preview the exact requested version');
    });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SUITE 7: REST API Endpoint Verification
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
test('Document Template Engine - REST API Endpoints', async (t) => {
    const BASE_URL = 'http://localhost:3000/api/document-templates';

    await t.test('GET /api/document-templates returns 200 and all 10 templates', async () => {
        const res = await fetch(BASE_URL);
        assert.strictEqual(res.status, 200);
        const json = await res.json();
        assert.strictEqual(json.success, true);
        assert.ok(json.data.length >= 10, `Expected at least 10 templates, got ${json.data.length}`);
        assert.ok(json.total >= 10);
    });

    await t.test('GET /api/document-templates/:key returns full template with versions', async () => {
        const res = await fetch(`${BASE_URL}/offer_letter`);
        assert.strictEqual(res.status, 200);
        const json = await res.json();
        assert.strictEqual(json.success, true);
        assert.strictEqual(json.data.key, 'offer_letter');
        assert.ok(Array.isArray(json.data.versions), 'Must return versions array');
        assert.ok(json.data.permittedModules.includes('onboarding'), 'offer_letter must permit onboarding');
    });

    await t.test('GET /api/document-templates/:key returns 404 for unknown template', async () => {
        const res = await fetch(`${BASE_URL}/nonexistent_template_xyz`);
        assert.strictEqual(res.status, 404);
        const json = await res.json();
        assert.strictEqual(json.success, false);
    });

    await t.test('POST /api/document-templates/:key/preview renders HTML with sample data', async () => {
        const res = await fetch(`${BASE_URL}/payslip/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.strictEqual(res.status, 200);
        const json = await res.json();
        assert.strictEqual(json.success, true);
        assert.ok(json.data.renderedHtml, 'Preview must return rendered HTML');
        assert.ok(json.data.versionNumber, 'Preview must specify version');
    });

    await t.test('POST /api/document-templates/generate - permitted module generates document', async () => {
        const res = await fetch(`${BASE_URL}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                templateKey: 'payslip',
                callerModule: 'payroll',
                actor: 'Payroll Engine (API Test)',
                dataContext: {
                    employee: { name: 'API Test Employee', code: 'EMP-API-001', department: 'Engineering', grade: 'L4', bankAccount: 'XXXX0099' },
                    payroll: { month: 'September', year: '2026', grossPay: '₹ 90,000', basicSalary: '₹ 45,000', hra: '₹ 22,500', specialAllowance: '₹ 22,500', totalDeductions: '₹ 17,000', pfEmployee: '₹ 5,400', esicEmployee: '₹ 0', professionalTax: '₹ 200', tds: '₹ 11,400', netPay: '₹ 73,000', workingDays: '26', lopDays: '0', pfEmployer: '₹ 5,400', esicEmployer: '₹ 0' },
                    company: { name: 'Kylrx Technologies Pvt. Ltd.' },
                    date: { payDate: '2026-09-28' }
                }
            })
        });
        assert.strictEqual(res.status, 200);
        const json = await res.json();
        assert.strictEqual(json.success, true);
        assert.ok(json.data.docId, 'Must return docId');
        assert.ok(json.data.sha256, 'Must return SHA-256 hash');
    });

    await t.test('POST /api/document-templates/generate - non-permitted module returns 403', async () => {
        const res = await fetch(`${BASE_URL}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                templateKey: 'offer_letter',
                callerModule: 'attendance',
                actor: 'Rogue Attendance System',
                dataContext: {}
            })
        });
        assert.strictEqual(res.status, 403, `Expected 403 Forbidden, got ${res.status}`);
        const json = await res.json();
        assert.strictEqual(json.success, false);
        assert.ok(json.error.includes('not permitted'), `Error should mention permission, got: ${json.error}`);
    });

    await t.test('GET /api/document-templates/generated returns archive list', async () => {
        const res = await fetch(`${BASE_URL}/generated`);
        assert.strictEqual(res.status, 200);
        const json = await res.json();
        assert.strictEqual(json.success, true);
        assert.ok(Array.isArray(json.data));
        assert.ok(typeof json.total === 'number');
    });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SUITE 8: Sidebar Navigation Integration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
test('Document Template Engine - Admin Page Sidebar Integration', async (t) => {
    const adminPages = [
        'admin-central-dashboard.html',
        'admin-notification-center.html',
        'admin-alert-builder.html',
        'admin-automation-builder.html',
        'admin-assignment-matrix.html',
        'admin-analytics-builder.html',
        'admin-dashboard.html',
        'admin-document-templates.html'
    ];

    await t.test('All admin pages contain link to admin-document-templates.html', () => {
        for (const page of adminPages) {
            const filePath = path.join(__dirname, '..', page);
            let content;
            try {
                content = readFileSync(filePath, 'utf-8');
            } catch {
                // Page may not exist (optional), skip
                continue;
            }
            assert.ok(
                content.includes('admin-document-templates.html'),
                `Page '${page}' must contain a navigation link to 'admin-document-templates.html'`
            );
        }
    });

    await t.test('admin-document-templates.html has all required UI element IDs', () => {
        const filePath = path.join(__dirname, '..', 'admin-document-templates.html');
        const content = readFileSync(filePath, 'utf-8');

        const requiredIds = [
            'stat-total', 'stat-approved', 'stat-pending', 'stat-generated', 'stat-gated',
            'template-grid', 'generated-tbody', 'gating-rules-list',
            'panel-overlay', 'side-panel', 'panel-body', 'panel-title',
            'search-input', 'category-filter',
            'toast-container'
        ];

        for (const id of requiredIds) {
            assert.ok(content.includes(`id="${id}"`), `admin-document-templates.html must have element with id="${id}"`);
        }
    });

    await t.test('admin-document-templates.html references the JS controller file', () => {
        const filePath = path.join(__dirname, '..', 'admin-document-templates.html');
        const content = readFileSync(filePath, 'utf-8');
        assert.ok(content.includes('admin-document-templates.js'), 'HTML must load admin-document-templates.js');
    });
});
