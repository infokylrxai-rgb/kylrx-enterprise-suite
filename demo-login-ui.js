/**
 * Demo sign-in UI (the 1-click demo bar, the "Demo Roles" button and the demo roles modal).
 * Loaded by demo-login.js ONLY when GET /api/public-config says demo mode is on, so a normal install
 * ships no demo markup in its pages. It contains no accounts and no passwords: each choice asks the server
 * (POST /api/auth/demo-login { role }) for a session in the demo organization.
 */
export const DEMO_BAR_HTML = `          <!-- One-Click Role Credentials Bar -->
          <div style="margin-bottom: 1.25rem; background: #f8fafc; border: 1.5px dashed #cbd5e1; border-radius: 14px; padding: 12px 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-size: 0.72rem; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px;">⚡ 1-Click Demo Login:</span>
              <span style="font-size: 0.7rem; color: #059669; font-weight: 700;">● Ready</span>
            </div>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px;">
              <button type="button" id="btnQuickSuperAdmin" style="padding: 8px 4px; background: #eff6ff; border: 1.5px solid #93c5fd; color: #1d4ed8; border-radius: 10px; font-size: 0.72rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: 0.2s;" onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'">
                <i data-lucide="shield" style="width:13px; height:13px;"></i> Admin
              </button>
              <button type="button" id="btnQuickHrAdmin" style="padding: 8px 4px; background: #ecfdf5; border: 1.5px solid #86efac; color: #065f46; border-radius: 10px; font-size: 0.72rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: 0.2s;" onmouseover="this.style.background='#d1fae5'" onmouseout="this.style.background='#ecfdf5'">
                <i data-lucide="users" style="width:13px; height:13px;"></i> HRMS
              </button>
              <button type="button" id="btnQuickManager" style="padding: 8px 4px; background: #fdf4ff; border: 1.5px solid #d8b4fe; color: #7e22ce; border-radius: 10px; font-size: 0.72rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: 0.2s;" onmouseover="this.style.background='#fae8ff'" onmouseout="this.style.background='#fdf4ff'">
                <i data-lucide="briefcase" style="width:13px; height:13px;"></i> Manager
              </button>
              <button type="button" id="btnQuickEmployee" style="padding: 8px 4px; background: #fff7ed; border: 1.5px solid #fed7aa; color: #c2410c; border-radius: 10px; font-size: 0.72rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: 0.2s;" onmouseover="this.style.background='#ffedd5'" onmouseout="this.style.background='#fff7ed'">
                <i data-lucide="user" style="width:13px; height:13px;"></i> Employee
              </button>
            </div>
          </div>
`;

export const DEMO_ROLES_BUTTON_HTML = `            <button type="button" id="credentialsBtn" class="btn-social" title="Quick Role Login">
              <i data-lucide="key" style="color: var(--primary);"></i>
              <span>Demo Roles</span>
            </button>`;

export const DEMO_MODAL_HTML = `  <!-- Demo Roles Selector Modal -->
  <div id="demoRolesModal" style="position:fixed; inset:0; background:rgba(15,23,42,0.5); backdrop-filter:blur(8px); display:none; align-items:center; justify-content:center; z-index:9999; padding:1.5rem;">
    <div style="background:white; padding:2rem; border-radius:24px; width:100%; max-width:440px; text-align:left; border:1px solid #dbeafe; box-shadow:0 25px 50px -12px rgba(0,0,0,0.25); position:relative;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:36px; height:36px; border-radius:10px; background:#eff6ff; color:#2563eb; display:flex; align-items:center; justify-content:center;">
            <i data-lucide="shield-check" style="width:20px; height:20px;"></i>
          </div>
          <h3 style="margin:0; font-size:1.25rem; font-weight:800; color:#0f172a;">Quick Role Access</h3>
        </div>
        <button id="closeDemoRolesBtn" style="background:transparent; border:none; color:#64748b; font-size:1.2rem; cursor:pointer; padding:4px;">✕</button>
      </div>
      <p style="color:#64748b; font-size:0.85rem; margin-bottom:1.5rem; line-height:1.5;">Choose a verified role credential to test workspace permissions and dashboards instantly:</p>

      <div style="display:flex; flex-direction:column; gap:12px;">
        <!-- Super Admin Card -->
        <div id="selectSuperAdmin" style="border:1.5px solid #e2e8f0; border-radius:14px; padding:14px; cursor:pointer; transition:0.2s; background:#f8fafc;" onmouseover="this.style.borderColor='#2563eb'; this.style.background='#eff6ff';" onmouseout="this.style.borderColor='#e2e8f0'; this.style.background='#f8fafc';">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <span style="font-weight:700; font-size:0.95rem; color:#0f172a;">Super Admin</span>
            <span style="font-size:0.7rem; font-weight:700; background:#dbeafe; color:#1d4ed8; padding:2px 8px; border-radius:20px;">Full Access</span>
          </div>
          <div style="font-size:0.8rem; color:#64748b;">Signs in to the <strong style="color:#1e293b;">demo organization</strong></div>
          <div style="font-size:0.75rem; color:#94a3b8; margin-top:2px;">Routes to Admin Executive Dashboard</div>
        </div>

        <!-- HR Admin Card -->
        <div id="selectHrAdmin" style="border:1.5px solid #e2e8f0; border-radius:14px; padding:14px; cursor:pointer; transition:0.2s; background:#f8fafc;" onmouseover="this.style.borderColor='#059669'; this.style.background='#ecfdf5';" onmouseout="this.style.borderColor='#e2e8f0'; this.style.background='#f8fafc';">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <span style="font-weight:700; font-size:0.95rem; color:#0f172a;">HR Admin</span>
            <span style="font-size:0.7rem; font-weight:700; background:#d1fae5; color:#065f46; padding:2px 8px; border-radius:20px;">HRMS Console</span>
          </div>
          <div style="font-size:0.8rem; color:#64748b;">Signs in to the <strong style="color:#1e293b;">demo organization</strong></div>
          <div style="font-size:0.75rem; color:#94a3b8; margin-top:2px;">Routes to HRMS Management Dashboard</div>
        </div>

        <!-- Manager Card -->
        <div id="selectManager" style="border:1.5px solid #e2e8f0; border-radius:14px; padding:14px; cursor:pointer; transition:0.2s; background:#f8fafc;" onmouseover="this.style.borderColor='#a855f7'; this.style.background='#faf5ff';" onmouseout="this.style.borderColor='#e2e8f0'; this.style.background='#f8fafc';">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <span style="font-weight:700; font-size:0.95rem; color:#0f172a;">Manager (Cybersecurity)</span>
            <span style="font-size:0.7rem; font-weight:700; background:#f3e8ff; color:#7e22ce; padding:2px 8px; border-radius:20px;">Command Center</span>
          </div>
          <div style="font-size:0.8rem; color:#64748b;">Signs in to the <strong style="color:#1e293b;">demo organization</strong></div>
          <div style="font-size:0.75rem; color:#94a3b8; margin-top:2px;">Routes to Manager Command Center</div>
        </div>

        <!-- Employee Card -->
        <div id="selectEmployee" style="border:1.5px solid #e2e8f0; border-radius:14px; padding:14px; cursor:pointer; transition:0.2s; background:#f8fafc;" onmouseover="this.style.borderColor='#f97316'; this.style.background='#fff7ed';" onmouseout="this.style.borderColor='#e2e8f0'; this.style.background='#f8fafc';">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <span style="font-weight:700; font-size:0.95rem; color:#0f172a;">Employee (Engineering)</span>
            <span style="font-size:0.7rem; font-weight:700; background:#ffedd5; color:#c2410c; padding:2px 8px; border-radius:20px;">Self-Service</span>
          </div>
          <div style="font-size:0.8rem; color:#64748b;">Signs in to the <strong style="color:#1e293b;">demo organization</strong></div>
          <div style="font-size:0.75rem; color:#94a3b8; margin-top:2px;">Routes to Employee Self-Service Portal</div>
        </div>
      </div>

      <div style="margin-top:1.5rem; padding-top:1rem; border-top:1px solid #e2e8f0; font-size:0.78rem; color:#94a3b8; text-align:center;">
        Or register a new account on the <a href="signup.html" style="color:#2563eb; font-weight:600; text-decoration:none;">Sign Up Page</a>
      </div>
    </div>
  </div>`;
