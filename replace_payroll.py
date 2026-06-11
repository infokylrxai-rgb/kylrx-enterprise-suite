import re

with open('hrms-dashboard.html', encoding='utf-8') as f:
    content = f.read()

# ── 1. REPLACE PAYROLL SECTION ────────────────────────────────────────────────
start_marker = '<!-- Payroll & Document Studio -->'
end_marker = '<!-- Employee Lifecycle'
si = content.find(start_marker)
ei = content.find(end_marker)
print(f'Payroll section: {si} -> {ei}')

new_payroll = '''<!-- Pay Slip Generator -->
            <div class="premium-panel" id="payroll" style="margin-bottom: 2.5rem;">
                <div class="panel-header">
                    <div class="panel-title">
                        <div class="stat-icon-box" style="background: #fdf2f2; color: #ef4444;">
                            <i data-lucide="file-check"></i>
                        </div>
                        <h2>Pay Slip Generator</h2>
                    </div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <span style="background:#ecfdf5; color:#10b981; font-size:0.7rem; font-weight:800; padding:3px 10px; border-radius:100px; border:1px solid #d1fae5;">&#9679; Live Sync</span>
                        <button onclick="exportBankTransferCSV()" style="background:#1e40af; color:white; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px;">
                            <i data-lucide="landmark" style="width:13px;height:13px;"></i> Bank Transfer Export
                        </button>
                        <button onclick="openPayslipModal()" style="background:var(--primary); color:white; border:none; padding:7px 14px; border-radius:8px; font-size:0.75rem; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:6px;">
                            <i data-lucide="file-down" style="width:13px;height:13px;"></i> Generate Pay Slips
                        </button>
                    </div>
                </div>
                <div style="background:#f8fafc; border:1px solid var(--border); border-radius:16px; padding:1.5rem; margin-bottom:1rem;">
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr auto; gap:1rem; align-items:end;">
                        <div>
                            <label style="font-size:0.72rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Month</label>
                            <select id="payslipMonth" style="width:100%; padding:9px 12px; border:1px solid var(--border); border-radius:10px; font-size:0.85rem; outline:none; font-family:inherit; background:white;">
                                <option value="01">January</option><option value="02">February</option><option value="03">March</option>
                                <option value="04">April</option><option value="05">May</option><option value="06" selected>June</option>
                                <option value="07">July</option><option value="08">August</option><option value="09">September</option>
                                <option value="10">October</option><option value="11">November</option><option value="12">December</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size:0.72rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Year</label>
                            <select id="payslipYear" style="width:100%; padding:9px 12px; border:1px solid var(--border); border-radius:10px; font-size:0.85rem; outline:none; font-family:inherit; background:white;">
                                <option value="2024">2024</option><option value="2025">2025</option><option value="2026" selected>2026</option>
                            </select>
                        </div>
                        <div>
                            <label style="font-size:0.72rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:6px;">Department</label>
                            <select id="payslipDept" style="width:100%; padding:9px 12px; border:1px solid var(--border); border-radius:10px; font-size:0.85rem; outline:none; font-family:inherit; background:white;">
                                <option value="all">All Departments</option>
                            </select>
                        </div>
                        <button onclick="loadPayslipPreview()" style="background:#0f172a; color:white; border:none; padding:9px 16px; border-radius:10px; font-size:0.8rem; font-weight:700; cursor:pointer; white-space:nowrap; display:flex; align-items:center; gap:6px;">
                            <i data-lucide="search" style="width:14px;height:14px;"></i> Load Employees
                        </button>
                    </div>
                </div>
                <div style="background:white; border:1px solid var(--border); border-radius:16px; overflow:hidden;">
                    <table style="width:100%; border-collapse:collapse; font-size:0.82rem;">
                        <thead>
                            <tr style="background:#f8fafc; border-bottom:1px solid var(--border); font-size:0.7rem; color:var(--text-muted); text-transform:uppercase;">
                                <th style="padding:12px 16px; font-weight:800; text-align:left;">Employee</th>
                                <th style="padding:12px 16px; font-weight:800; text-align:left;">Code</th>
                                <th style="padding:12px 16px; font-weight:800; text-align:right;">Basic</th>
                                <th style="padding:12px 16px; font-weight:800; text-align:right;">Incentives</th>
                                <th style="padding:12px 16px; font-weight:800; text-align:right;">Deductions</th>
                                <th style="padding:12px 16px; font-weight:800; text-align:right;">Net Pay</th>
                                <th style="padding:12px 16px; font-weight:800; text-align:center;">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="payslipTableBody">
                            <tr><td colspan="7" style="text-align:center; padding:2.5rem; color:var(--text-muted); font-size:0.82rem;">Select filters and click Load Employees to generate pay slips</td></tr>
                        </tbody>
                    </table>
                </div>
                <div style="display:flex; gap:10px; margin-top:1rem; flex-wrap:wrap;">
                    <div style="display:flex; gap:6px; align-items:center; background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:8px 14px; font-size:0.78rem; color:#166534; font-weight:600;">
                        <i data-lucide="users" style="width:14px;height:14px;"></i>
                        <span id="payslipCount">0 employees loaded</span>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center; background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:8px 14px; font-size:0.78rem; color:#1e40af; font-weight:600;">
                        <i data-lucide="indian-rupee" style="width:14px;height:14px;"></i>
                        <span id="payslipTotalNet">Total Net: &#8377;0</span>
                    </div>
                </div>
            </div>
            '''

if si > 0 and ei > si:
    content = content[:si] + new_payroll + content[ei:]
    print('Payroll section replaced successfully.')
else:
    print('ERROR: Could not find payroll section bounds!')

with open('hrms-dashboard.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('File written successfully.')
