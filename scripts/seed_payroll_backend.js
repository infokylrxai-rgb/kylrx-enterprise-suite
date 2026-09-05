const { db } = require('../config/firebase');

async function seedPayrollBackend() {
    console.log("==================================================");
    console.log("🔥 SEEDING KYLRX AI PAYROLL DISBURSEMENT FIREBASE");
    console.log("==================================================");

    try {
        // 1. Seed Monthly Payroll Run Summary
        const runRef = db.collection('payroll_runs').doc('PR-2026-08');
        await runRef.set({
            payroll_run_id: 'PR-2026-08',
            cycle_month: 'September 2026',
            status: 'APPROVED',
            gross_payroll: 6000000,
            employee_deductions: 600000,
            net_salary: 5400000,
            employer_contributions: 700000,
            employee_count: 125,
            calculated_at: new Date().toISOString(),
            approved_by: 'Nandan.B',
            approved_at: new Date().toISOString()
        }, { merge: true });
        console.log("✅ 1. Seeded payroll_runs/PR-2026-08 (Gross: ₹60,00,000, Net: ₹54,00,000)");

        // 2. Seed Payment Batches
        const batches = [
            {
                id: 'Salary_Disbursement',
                name: 'Salary Disbursement',
                type: 'SALARY',
                amount: '₹54,00,000',
                numeric_amount: 5400000,
                employee_count: 125,
                status: 'APPROVED',
                stage_number: 4,
                payment_date: '30 Sep 2026',
                period: 'September 2026'
            },
            {
                id: 'PF',
                name: 'PF',
                type: 'PF',
                amount: '₹2,40,000',
                numeric_amount: 240000,
                employee_count: 125,
                status: 'VALIDATED',
                stage_number: 2,
                payment_date: '15 Oct 2026',
                period: 'September 2026'
            },
            {
                id: 'ESI',
                name: 'ESI',
                type: 'ESIC',
                amount: '₹95,000',
                numeric_amount: 95000,
                employee_count: 68,
                status: 'AWAITING_APPROVAL',
                stage_number: 3,
                payment_date: '15 Oct 2026',
                period: 'September 2026'
            },
            {
                id: 'Professional_Tax',
                name: 'Professional Tax',
                type: 'PT',
                amount: '₹25,000',
                numeric_amount: 25000,
                employee_count: 125,
                status: 'DRAFT',
                stage_number: 1,
                payment_date: '20 Oct 2026',
                period: 'September 2026'
            },
            {
                id: 'TDS',
                name: 'TDS',
                type: 'TDS',
                amount: '₹2,40,000',
                numeric_amount: 240000,
                employee_count: 42,
                status: 'DRAFT',
                stage_number: 1,
                payment_date: '07 Oct 2026',
                period: 'September 2026'
            }
        ];

        for (const b of batches) {
            await db.collection('payroll_disbursement_batches').doc(b.id).set({
                ...b,
                updated_at: new Date().toISOString()
            }, { merge: true });
        }
        console.log(`✅ 2. Seeded ${batches.length} disbursement batches to payroll_disbursement_batches`);

        // 3. Seed 8-Point Validation Issues
        const issues = [
            {
                id: 'EMP021',
                issueId: 'ISS-001',
                code: 'GATE_04_IFSC_REGEX',
                empId: 'EMP021',
                empName: 'Ramesh Kumar',
                field: 'ifsc_code',
                fieldLabel: 'banking.ifsc_code',
                severity: 'BLOCKING',
                currentValue: 'SBIN000123',
                suggestedFix: 'Enter valid 11-char IFSC (e.g. SBIN0001234)',
                resolved: false,
                created_at: new Date().toISOString()
            },
            {
                id: 'EMP037',
                issueId: 'ISS-002',
                code: 'GATE_03_ACCOUNT_FORMAT',
                empId: 'EMP037',
                empName: 'Priya Sharma',
                field: 'account_number',
                fieldLabel: 'banking.account_number',
                severity: 'BLOCKING',
                currentValue: '12345',
                suggestedFix: 'Must be 9-18 digits (e.g. 5010049281928)',
                resolved: false,
                created_at: new Date().toISOString()
            },
            {
                id: 'EMP052',
                issueId: 'ISS-003',
                code: 'GATE_06_POSITIVE_PAY',
                empId: 'EMP052',
                empName: 'Sunil Rao',
                field: 'net_payable_amount',
                fieldLabel: 'net_payable_amount',
                severity: 'BLOCKING',
                currentValue: '-500',
                suggestedFix: 'Must be > 0 (e.g. 38000)',
                resolved: false,
                created_at: new Date().toISOString()
            }
        ];

        for (const iss of issues) {
            await db.collection('payroll_validation_issues').doc(iss.id).set(iss, { merge: true });
        }
        console.log(`✅ 3. Seeded ${issues.length} active validation issues to payroll_validation_issues`);

        // 4. Seed sample employee bank directory records in employees collection
        const employees = [
            { employeeId: 'EMP001', name: 'Abhishek Rai', role: 'employee', salary: 50000, deductions: 4800, accountNumber: '501002341234', ifsc: 'SBIN0001234', bankName: 'State Bank of India', status: 'active' },
            { employeeId: 'EMP002', name: 'Rohit Kumar', role: 'employee', salary: 40000, deductions: 3500, accountNumber: '002301565678', ifsc: 'HDFC0001234', bankName: 'HDFC Bank', status: 'active' },
            { employeeId: 'EMP003', name: 'Sneha Sharma', role: 'employee', salary: 45000, deductions: 4000, accountNumber: '620199281290', ifsc: 'ICIC0001234', bankName: 'ICICI Bank', status: 'active' }
        ];

        for (const emp of employees) {
            await db.collection('employees').doc(emp.employeeId).set(emp, { merge: true });
        }
        console.log(`✅ 4. Seeded ${employees.length} personnel records into employees collection`);

        console.log("==================================================");
        console.log("🎉 FIREBASE BACKEND SUCCESSFULLY SEEDED & READY!");
        console.log("==================================================");
        process.exit(0);
    } catch (error) {
        console.error("❌ Seeding failed:", error);
        process.exit(1);
    }
}

seedPayrollBackend();
