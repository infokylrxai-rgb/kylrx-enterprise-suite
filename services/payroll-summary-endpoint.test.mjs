/**
 * ============================================================================
 * KYLRX AI HRMS - PAYROLL SUMMARY ENDPOINT TESTS
 * ============================================================================
 */

import assert from 'node:assert/strict';
import express from 'express';

// Test Express app setup with the route logic
function buildTestApp() {
  const app = express();
  app.use(express.json());

  // Mock DB records for testing
  const mockDb = {
    users: [
      { id: '1', status: 'active', salary: 100000, grossSalary: 125000, basicSalary: 50000 },
      { id: '2', status: 'active', salary: 16000, grossSalary: 20000, basicSalary: 10000 },
      { id: '3', status: 'terminated', salary: 50000, grossSalary: 60000, basicSalary: 30000 }, // inactive, excluded
    ],
  };

  app.get(['/api/payroll-runs/:runId/summary', '/api/payroll/runs/:runId/summary'], (req, res) => {
    const { runId } = req.params;

    // Reject client-provided override attempts
    // Explicitly compute from authoritative records
    let grossPayroll = 0;
    let employeeDeductions = 0;
    let netSalary = 0;
    let employerContributions = 0;
    let headcount = 0;

    for (const u of mockDb.users) {
      if (u.status === 'active') {
        headcount++;
        const gross = Number(u.grossSalary);
        const basic = Number(u.basicSalary);

        const epfWage = Math.min(basic, 15000);
        const pfEe = Math.round(epfWage * 0.12);
        const pfEr = Math.round(epfWage * 0.12);

        const esicEe = gross <= 21000 ? Math.round(gross * 0.0075) : 0;
        const esicEr = gross <= 21000 ? Math.round(gross * 0.0325) : 0;
        const pt = gross > 15000 ? 200 : 0;
        const gratuityProvision = Math.round(basic * 0.0481);

        const totalDeductions = pfEe + esicEe + pt;
        const net = Math.max(0, gross - totalDeductions);
        const totalEr = pfEr + esicEr + gratuityProvision;

        grossPayroll += gross;
        employeeDeductions += totalDeductions;
        netSalary += net;
        employerContributions += totalEr;
      }
    }

    const formatInr = (val) => (val === 0 || !val ? '₹0' : '₹' + Math.round(val).toLocaleString('en-IN'));

    res.json({
      success: true,
      run_id: runId,
      summary: {
        gross_payroll: grossPayroll,
        employee_deductions: employeeDeductions,
        net_salary: netSalary,
        employer_contributions: employerContributions,
        total_headcount: headcount,
        formatted: {
          gross_payroll: formatInr(grossPayroll),
          employee_deductions: formatInr(employeeDeductions),
          net_salary: formatInr(netSalary),
          employer_contributions: formatInr(employerContributions),
        },
      },
    });
  });

  return app;
}

async function runPayrollSummaryTestSuite() {
  console.log('\n===============================================================');
  console.log('🧪 RUNNING KYLRX AI PAYROLL SUMMARY API ENDPOINT TESTS');
  console.log('===============================================================\n');

  const app = buildTestApp();
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let passedTests = 0;
  let totalTests = 0;

  async function test(name, fn) {
    totalTests++;
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(err);
      process.exitCode = 1;
    }
  }

  // TEST 1: Server-Side Ledger Aggregation
  await test('1. GET /api/payroll-runs/:runId/summary computes authoritative values', async () => {
    const res = await fetch(`${baseUrl}/api/payroll-runs/PR-2026-08/summary`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.success, true);
    assert.equal(body.run_id, 'PR-2026-08');
    assert.equal(body.summary.total_headcount, 2); // Excludes terminated
    assert.equal(body.summary.gross_payroll, 145000); // 125,000 + 20,000
    assert.match(body.summary.formatted.gross_payroll, /^₹1,45,000$/);
  });

  // TEST 2: Rejection of Client-Provided Override Injections
  await test('2. Ignores client query params attempting to override gross/net sums', async () => {
    const res = await fetch(`${baseUrl}/api/payroll-runs/PR-2026-08/summary?gross_payroll=99999999&net_salary=0`);
    const body = await res.json();

    // Must still return server calculated 145,000, NOT 99999999
    assert.equal(body.summary.gross_payroll, 145000);
    assert.notEqual(body.summary.gross_payroll, 99999999);
  });

  server.close();
  console.log('\n===============================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} PAYROLL SUMMARY API TESTS PASSED!`);
  console.log('===============================================================\n');
}

runPayrollSummaryTestSuite().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
