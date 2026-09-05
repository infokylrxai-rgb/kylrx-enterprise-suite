/**
 * ============================================================================
 * KYLRX AI ENTERPRISE HRMS - STATUTORY COMPLIANCE GENERATORS
 * ============================================================================
 * Module: Official Portal Generators for:
 *  1. ESIC Monthly Return CSV (.csv)
 *  2. NSDL CRA Subscriber Contribution File (.txt SCF format with Caret ^ delimiter)
 *  3. Statutory Gratuity Provisioning Ledger (4.81% basic accrual & Form I Notice)
 *
 * @version 2.4.0
 * @author Kylrx AI Lead Backend Architecture Team
 */

import crypto from 'node:crypto';

/**
 * 1. ESIC MONTHLY RETURN CSV GENERATOR
 * Format specified by ESIC Portal:
 * IP Number, IP Name, No. of Days Worked, Total Monthly Wages, Reason Code for Zero Working Days, Last Working Day
 */
export function generateEsicMonthlyCsv({
  employerCode = '31000123450000999',
  wageMonth = '08/2026',
  records = [],
}) {
  const headers = [
    'IP Number',
    'IP Name',
    'No of Days for which wages paid',
    'Total Monthly Wages',
    'Reason Code for Zero Working Days',
    'Last Working Day',
  ];

  let totalIpCount = 0;
  let totalWages = 0;
  let totalEeDeduction = 0;
  let totalErContribution = 0;

  const rows = [];

  for (const rec of records) {
    // Only employees covered under ESIC
    const gross = Number(rec.gross_earnings || rec.gross_wages || rec.wages || 0);
    const ipNo = String(rec.esic_ip_number || rec.ip_number || '').trim();

    if (!ipNo) continue; // Unlinked/invalid skipped or handled via exception

    totalIpCount++;
    totalWages += gross;

    const eeShare = Math.round(gross * 0.0075);
    const erShare = Math.round(gross * 0.0325);
    totalEeDeduction += eeShare;
    totalErContribution += erShare;

    const daysWorked = rec.days_worked !== undefined ? rec.days_worked : (rec.payable_days || 30);
    const zeroReason = daysWorked === 0 ? (rec.zero_days_reason_code || '1') : '';
    const lastWorkingDay = rec.last_working_day || '';

    // Sanitized Name (no commas or quotes)
    const ipName = String(rec.employee_name || rec.name || '').replace(/[,"]/g, '').trim();

    rows.push([
      ipNo,
      `"${ipName}"`,
      daysWorked,
      gross.toFixed(2),
      zeroReason,
      lastWorkingDay,
    ].join(','));
  }

  const csvContent = [headers.join(','), ...rows].join('\r\n');
  const checksum = crypto.createHash('sha256').update(csvContent, 'utf8').digest('hex');

  return {
    file_type: 'ESIC_CSV',
    file_name: `ESIC_RETURN_${employerCode}_${wageMonth.replace('/', '')}.csv`,
    content: csvContent,
    checksum_sha256: checksum,
    summary: {
      employer_code: employerCode,
      wage_month: wageMonth,
      total_covered_ips: totalIpCount,
      total_statutory_wages: Math.round(totalWages * 100) / 100,
      employee_deduction_0_75: totalEeDeduction,
      employer_contribution_3_25: totalErContribution,
      total_challan_liability: totalEeDeduction + totalErContribution,
    },
  };
}

/**
 * 2. NSDL CRA SUBSCRIBER CONTRIBUTION FILE (SCF) GENERATOR
 * Standard NSDL / CRA format for Corporate NPS:
 * Caret (^) separated records with FH (File Header), BH (Batch Header), SD (Subscriber Detail), and FT (File Trailer).
 */
export function generateNsdlCraScf({
  corporateRegistrationNumber = 'CHO12345',
  paoOrPopSpCode = 'POP00987',
  monthYear = '082026', // MMYYYY
  records = [],
}) {
  const lineRows = [];
  const generatedDate = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD

  // Record 1: File Header (FH)
  // Format: FH^Record_Type^File_Type^Corporate_Reg_No^File_Ref_No^Date^Time
  const fileRefNo = `SCF${Date.now().toString().slice(-6)}`;
  lineRows.push(`FH^01^SCF^${corporateRegistrationNumber}^${fileRefNo}^${generatedDate}^1200`);

  // Compute Totals
  let subscriberCount = 0;
  let totalEmployerContrib = 0;
  let totalEmployeeContrib = 0;
  const sdRecords = [];

  for (const [idx, rec] of records.entries()) {
    const pran = String(rec.pran || rec.nps_pran || '').trim();
    if (!pran || !/^\d{12}$/.test(pran)) continue;

    subscriberCount++;
    const erShare = Number(rec.employer_nps_share || rec.er_contribution || 0);
    const eeShare = Number(rec.employee_nps_share || rec.ee_contribution || 0);
    const totalLineContrib = erShare + eeShare;

    totalEmployerContrib += erShare;
    totalEmployeeContrib += eeShare;

    const empName = String(rec.employee_name || rec.name || '').replace(/\^/g, '').trim();

    // Record: Subscriber Detail (SD)
    // Format: SD^Line_No^PRAN^Employee_Name^Employer_Share^Employee_Share^Total_Contribution^MonthYear
    sdRecords.push(
      `SD^${idx + 1}^${pran}^${empName}^${erShare.toFixed(2)}^${eeShare.toFixed(2)}^${totalLineContrib.toFixed(2)}^${monthYear}`
    );
  }

  const grandTotal = totalEmployerContrib + totalEmployeeContrib;

  // Record 2: Batch Header (BH)
  // Format: BH^02^Batch_No^PAO_Code^Total_Subscribers^Total_Amount^MonthYear
  lineRows.push(`BH^02^001^${paoOrPopSpCode}^${subscriberCount}^${grandTotal.toFixed(2)}^${monthYear}`);

  // Add Subscriber Lines
  lineRows.push(...sdRecords);

  // Record 3: File Trailer (FT)
  // Format: FT^03^Total_Batches^Total_Subscribers^Total_Grand_Amount
  lineRows.push(`FT^03^1^${subscriberCount}^${grandTotal.toFixed(2)}`);

  const fileContent = lineRows.join('\r\n');
  const checksum = crypto.createHash('sha256').update(fileContent, 'utf8').digest('hex');

  return {
    file_type: 'NSDL_SCF_TXT',
    file_name: `NSDL_CRA_SCF_${corporateRegistrationNumber}_${monthYear}.txt`,
    content: fileContent,
    checksum_sha256: checksum,
    summary: {
      corporate_reg_no: corporateRegistrationNumber,
      month_year: monthYear,
      total_subscribers: subscriberCount,
      total_employer_share_80ccd2: Math.round(totalEmployerContrib * 100) / 100,
      total_employee_share_80ccd1b: Math.round(totalEmployeeContrib * 100) / 100,
      total_nps_remittance: Math.round(grandTotal * 100) / 100,
    },
  };
}

/**
 * 3. STATUTORY GRATUITY PROVISIONING & VESTING ENGINE
 * Payment of Gratuity Act, 1972:
 *  - Formula: (15 * Last Drawn Basic * Completed Years) / 26
 *  - Cap: ₹20,00,000 tax-free statutory limit
 *  - Monthly Internal Corporate Accrual: 4.81% of Basic wages
 */
export function computeGratuityLedger({
  organizationId = 'KYLRX-ORG-01',
  periodMonth = '2026-08',
  employees = [],
}) {
  let totalActiveEmployees = 0;
  let totalMonthlyBasic = 0;
  let totalMonthlyAccrual = 0;
  let totalVestedCumulativeLiability = 0;

  const ledgerEntries = [];

  for (const emp of employees) {
    const basicPay = Number(emp.basic_salary || emp.basic_wage || 0);
    if (basicPay <= 0) continue;

    totalActiveEmployees++;
    totalMonthlyBasic += basicPay;

    // Monthly corporate provision: 4.81% of Basic
    const monthlyProvision = Math.round(basicPay * 0.0481 * 100) / 100;
    totalMonthlyAccrual += monthlyProvision;

    // Evaluate Tenure & Continuous Service
    const doj = emp.date_of_joining ? new Date(emp.date_of_joining) : new Date();
    const asOfDate = new Date();
    const serviceYearsRaw = (asOfDate - doj) / (1000 * 60 * 60 * 24 * 365.25);
    
    // 4 years 240 days rule (>= 4.657 years) = VESTED
    const isVested = Boolean(serviceYearsRaw >= 4.657 || emp.is_deceased || emp.is_disabled);
    const completedYears = Math.round(serviceYearsRaw);

    // Actuarial / Statutory Liability if exiting today
    const rawGratuity = (15 * basicPay * completedYears) / 26;
    const statutoryPayable = Math.min(rawGratuity, 2000000);
    const taxableExcess = Math.max(0, rawGratuity - 2000000);

    if (isVested) {
      totalVestedCumulativeLiability += statutoryPayable;
    }

    ledgerEntries.push({
      employee_id: emp.employee_id,
      employee_name: emp.employee_name || emp.name,
      basic_pay: basicPay,
      monthly_provision_debit: monthlyProvision,
      service_years: Math.round(serviceYearsRaw * 10) / 10,
      is_vested: isVested,
      cumulative_statutory_liability: Math.round(statutoryPayable * 100) / 100,
      taxable_excess: Math.round(taxableExcess * 100) / 100,
    });
  }

  return {
    organization_id: organizationId,
    period_month: periodMonth,
    summary: {
      total_headcount: totalActiveEmployees,
      total_basic_payroll: Math.round(totalMonthlyBasic * 100) / 100,
      monthly_gratuity_provision_expense: Math.round(totalMonthlyAccrual * 100) / 100,
      total_vested_balance_sheet_liability: Math.round(totalVestedCumulativeLiability * 100) / 100,
      statutory_cap_applied: 2000000,
    },
    journal_entry: {
      debit_account: 'GL-6100 - Gratuity Expense (P&L)',
      debit_amount: Math.round(totalMonthlyAccrual * 100) / 100,
      credit_account: 'GL-2200 - Provision for Gratuity (Balance Sheet)',
      credit_amount: Math.round(totalMonthlyAccrual * 100) / 100,
    },
    ledger_entries: ledgerEntries,
  };
}
