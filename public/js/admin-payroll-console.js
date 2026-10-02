/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - ADMIN PAYROLL CONSOLE CLIENT
 * ============================================================================
 * Strictly Adhering to PRD Section 4:
 * Decoupled UI actions for "Generate Documents" vs "Initiate Disbursement".
 *
 * Integrated with:
 *  - feedbackService.js (Toasts, Skeletons, Inline Errors, Progress Bar)
 *  - /api/payroll/documents/* (Document generation, Excel/PDF exports)
 *  - /api/payroll/disburse/* (Decentro Fabric Staging, 4-Eyes Maker-Checker)
 * ============================================================================
 */

class AdminPayrollConsole {
  constructor() {
    this.currentPeriod = 'September 2026';
    this.currentUser = { id: 'ADM_SUPER_001', name: 'Super Admin', role: 'admin' };
    this.activeBatchId = null;
    this.payrollRecords = [];

    this.init();
  }

  init() {
    console.log('[PAYROLL_CONSOLE] Initializing decoupled Admin Payroll Console...');
    this.bindEvents();
  }

  bindEvents() {
    // 1. Generate Documents Action
    const genDocBtn = document.getElementById('btnGenerateDocuments');
    if (genDocBtn) {
      genDocBtn.addEventListener('click', () => this.handleGenerateDocuments());
    }

    // 2. Initiate Disbursement Action
    const disburseBtn = document.getElementById('btnInitiateDisbursement');
    if (disburseBtn) {
      disburseBtn.addEventListener('click', () => this.handleInitiateDisbursement());
    }

    // 3. Export Excel Action
    const exportExcelBtn = document.getElementById('btnExportRegisterExcel');
    if (exportExcelBtn) {
      exportExcelBtn.addEventListener('click', () => this.handleExportExcel());
    }

    // 4. Export PDF Action
    const exportPdfBtn = document.getElementById('btnExportRegisterPdf');
    if (exportPdfBtn) {
      exportPdfBtn.addEventListener('click', () => this.handleExportPdf());
    }
  }

  /**
   * ACTION 1: Generate Payroll Documents
   * Completely independent of banking and payout disbursement.
   */
  async handleGenerateDocuments() {
    const period = this.currentPeriod;
    this.notify('info', `Generating monthly payslips and tax vouchers for ${period}...`);

    if (window.feedbackService) {
      window.feedbackService.showProgressBar();
      window.feedbackService.showLoadingSkeleton('#disbTableBody', 'table', { rows: 5, columns: 8 });
    }

    try {
      const response = await fetch('/api/payroll/documents/generate-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period,
          adminId: this.currentUser.id
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate payroll documents.');
      }

      this.notify('success', `Generated ${data.count} documents successfully. Documents vaulted and encrypted.`);
      this.refreshLedgerTable();
    } catch (err) {
      console.error('[PAYROLL_CONSOLE] Document generation error:', err);
      this.notify('error', `Document generation failed: ${err.message}`);
    } finally {
      if (window.feedbackService) {
        window.feedbackService.hideProgressBar();
      }
    }
  }

  /**
   * ACTION 2: Initiate Decentro Fabric Disbursement Batch
   * Requires 4-Eyes Maker-Checker authorization prior to bank dispatch.
   */
  async handleInitiateDisbursement() {
    const period = this.currentPeriod;
    const makerId = this.currentUser.id;

    this.notify('info', 'Creating Decentro Fabric payout batch...');

    try {
      const response = await fetch('/api/payroll/disburse/create-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period,
          makerId,
          payoutChannel: 'IMPS',
          employees: this.payrollRecords.length > 0 ? this.payrollRecords : undefined
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to create payout batch.');
      }

      this.activeBatchId = data.batch.batchId;
      this.notify('warning', `Batch ${this.activeBatchId} created! Status: PENDING_APPROVAL. 4-Eyes Checker required.`);
      
      // Open 4-Eyes Authorization Modal
      this.showMakerCheckerModal(data.batch);
    } catch (err) {
      console.error('[PAYROLL_CONSOLE] Disbursement initiation error:', err);
      this.notify('error', `Disbursement creation failed: ${err.message}`);
    }
  }

  /**
   * Displays 4-Eyes Maker-Checker Authorization Modal
   */
  showMakerCheckerModal(batch) {
    let modal = document.getElementById('makerCheckerModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'makerCheckerModal';
      modal.style.cssText = `
        position: fixed; inset: 0; background: rgba(15,23,42,0.6);
        backdrop-filter: blur(4px); display: flex; align-items: center;
        justify-content: center; z-index: 9999;
      `;
      document.body.appendChild(modal);
    }

    modal.innerHTML = `
      <div style="background: white; border-radius: 20px; padding: 2rem; width: 90%; max-width: 480px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 1rem;">
          <div style="width: 44px; height: 44px; border-radius: 12px; background: #eff6ff; color: #2563eb; display: flex; align-items: center; justify-content: center; font-weight: 800;">
            4E
          </div>
          <div>
            <h3 style="font-size: 1.15rem; font-weight: 800; color: #1e293b; margin: 0;">4-Eyes Disbursement Approval</h3>
            <p style="font-size: 0.8rem; color: #64748b; margin: 0;">Decentro Fabric Gateway Staging</p>
          </div>
        </div>

        <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem; margin-bottom: 1.25rem; font-size: 0.85rem;">
          <div><strong>Batch ID:</strong> ${batch.batchId}</div>
          <div><strong>Maker ID:</strong> ${batch.maker?.makerId} (Initiator)</div>
          <div><strong>Total Records:</strong> ${batch.summary?.totalRecords || 0}</div>
          <div><strong>Total Payout:</strong> ₹${(batch.summary?.totalAmount || 0).toLocaleString('en-IN')}</div>
          <div><strong>Channel:</strong> ${batch.payoutChannel}</div>
        </div>

        <div style="margin-bottom: 1.25rem;">
          <label style="display: block; font-size: 0.8rem; font-weight: 700; margin-bottom: 6px; color: #475569;">
            Checker Admin ID (Must differ from Maker: ${batch.maker?.makerId})
          </label>
          <input type="text" id="checkerIdInput" value="ADM_CHECKER_002" style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 0.9rem;" />
        </div>

        <div style="display: flex; gap: 10px; justify-content: flex-end;">
          <button id="btnCancelApproval" style="padding: 10px 18px; border-radius: 8px; border: 1px solid #cbd5e1; background: white; font-weight: 600; cursor: pointer;">Cancel</button>
          <button id="btnApproveAndExecute" style="padding: 10px 18px; border-radius: 8px; border: none; background: #10b981; color: white; font-weight: 700; cursor: pointer;">Approve & Disburse</button>
        </div>
      </div>
    `;

    modal.style.display = 'flex';

    document.getElementById('btnCancelApproval').onclick = () => {
      modal.style.display = 'none';
    };

    document.getElementById('btnApproveAndExecute').onclick = async () => {
      const checkerId = document.getElementById('checkerIdInput').value.trim();
      modal.style.display = 'none';
      await this.approveAndExecuteBatch(batch.batchId, checkerId);
    };
  }

  /**
   * Authorizes and Dispatches Batch to Decentro Fabric
   */
  async approveAndExecuteBatch(batchId, checkerId) {
    this.notify('info', `Authorizing batch with Checker: ${checkerId}...`);

    try {
      // Step 1: 4-Eyes Approval
      const approveRes = await fetch(`/api/payroll/disburse/batch/${batchId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkerId })
      });

      const approveData = await approveRes.json();
      if (!approveRes.ok || !approveData.success) {
        throw new Error(approveData.message || approveData.error || 'Checker approval failed.');
      }

      this.notify('success', `Batch approved by ${checkerId}. Disptaching to Decentro Fabric...`);

      // Step 2: Trigger Decentro Payout
      const execRes = await fetch(`/api/payroll/disburse/batch/${batchId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const execData = await execRes.json();
      if (!execRes.ok || !execData.success) {
        throw new Error(execData.error || 'Decentro payout dispatch failed.');
      }

      this.notify('success', `Dispatched ${execData.totalDispatched} transfers via Decentro Fabric. Status: ${execData.status}`);
      this.refreshLedgerTable();
    } catch (err) {
      console.error('[PAYROLL_CONSOLE] Approval/Execution error:', err);
      this.notify('error', err.message);
    }
  }

  /**
   * ACTION 3: Export Customer-Templated Excel Register
   */
  async handleExportExcel() {
    this.notify('info', 'Generating customer-templated Excel register (.xlsx)...');
    try {
      const res = await fetch('/api/payroll/documents/export-register-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period: this.currentPeriod,
          records: this.payrollRecords
        })
      });

      if (!res.ok) throw new Error('Excel generation failed on server.');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Monthly_Payroll_Register_${this.currentPeriod.replace(/\s+/g, '_')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      this.notify('success', 'Payroll Register Excel downloaded successfully.');
    } catch (err) {
      this.notify('error', `Excel export failed: ${err.message}`);
    }
  }

  /**
   * ACTION 4: Export Customer-Templated PDF Document
   */
  async handleExportPdf(employeeDoc) {
    this.notify('info', 'Generating official payslip PDF (.pdf)...');
    try {
      const docPayload = employeeDoc || {
        employeeCode: 'EMP0001',
        employeeName: 'Prakash Padukone',
        department: 'Operations',
        period: this.currentPeriod,
        financials: {
          periodDays: 30,
          lopDays: 0,
          paidDays: 30,
          earnings: { basic: 22500, hra: 11250, specialAllowance: 16250, grossEarnings: 50000 },
          deductions: { providentFund: 1800, esic: 0, professionalTax: 200, tds: 833, totalDeductions: 2833 },
          netPayable: 47167
        }
      };

      const res = await fetch('/api/payroll/documents/export-register-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeDoc: docPayload })
      });

      if (!res.ok) throw new Error('PDF generation failed on server.');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Payslip_${docPayload.employeeCode}_${this.currentPeriod.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      this.notify('success', 'Payslip PDF downloaded successfully.');
    } catch (err) {
      this.notify('error', `PDF export failed: ${err.message}`);
    }
  }

  /**
   * Helper: Shows non-blocking toasts via feedbackService.js or fallback
   */
  notify(type, message) {
    if (window.feedbackService && typeof window.feedbackService[type] === 'function') {
      window.feedbackService[type](message);
    } else if (typeof window.showToast === 'function') {
      window.showToast(message, type === 'error');
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  }

  refreshLedgerTable() {
    console.log('[PAYROLL_CONSOLE] Refreshing ledger table...');
  }
}

// Attach to window
if (typeof window !== 'undefined') {
  window.AdminPayrollConsole = AdminPayrollConsole;
  window.adminPayrollConsole = new AdminPayrollConsole();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AdminPayrollConsole };
}
