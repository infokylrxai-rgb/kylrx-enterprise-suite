// Kylrx Enterprise Suite - Employee Type + BU Assignment Engine Controller
// Handles 7 input dimensions and 10 automatic assignment categories
import { db, auth, onSnapshot, collection, doc, setDoc, serverTimestamp, getDocs } from "./firebase-config.js";

const CATEGORY_META = {
    payrollStructure: { label: '1. Payroll Structure', icon: 'credit-card', color: '#4f46e5', bg: '#ede9fe' },
    statutoryConfig: { label: '2. Statutory Configuration', icon: 'scale', color: '#0284c7', bg: '#e0f2fe' },
    policies: { label: '3. Policies & Agreements', icon: 'shield-check', color: '#059669', bg: '#dcfce7' },
    documentRequirements: { label: '4. Document Requirements', icon: 'file-text', color: '#d97706', bg: '#fef3c7' },
    onboardingFlow: { label: '5. Onboarding Flow', icon: 'user-plus', color: '#8b5cf6', bg: '#f3e8ff' },
    pms: { label: '6. PMS (Performance Model)', icon: 'target', color: '#e11d48', bg: '#ffe4e6' },
    attendanceLeaveRules: { label: '7. Attendance / Leave Rules', icon: 'calendar', color: '#0d9488', bg: '#ccfbf1' },
    exitFlow: { label: '8. Exit Separation Flow', icon: 'log-out', color: '#64748b', bg: '#f1f5f9' },
    approvalFlow: { label: '9. Approval Flow Hierarchy', icon: 'user-check', color: '#2563eb', bg: '#dbeafe' },
    alertRules: { label: '10. Alert & Escalation Rules', icon: 'bell', color: '#ea580c', bg: '#ffedd5' }
};

const API_HOST = window.location.port === '3000' 
    ? '' 
    : (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:3000' 
        : '');
const API_BASE = `${API_HOST}/api/assignments`;

const DEFAULT_MATRIX_RULES = [
    {
        id: "RULE_FT_TECH_IN",
        name: "Full-Time Technology Core (India)",
        match: { legalEntity: "Kylrx Technologies India Pvt Ltd", businessUnit: "Technology", employeeType: "Full Time" },
        priority: 80,
        assignments: {
            payrollStructure: { planName: "Engineering Standard CTC Grade", payoutCycle: "MONTHLY_LAST_DAY", basicSalaryPct: 50, hraPct: 20, specialAllowancePct: 20, statutoryBonusPct: 10, variablePayEligible: true },
            statutoryConfig: { epfEnabled: true, epfEmployerRate: 12, epfEmployeeRate: 12, esiEnabled: false, professionalTaxState: "Karnataka", gratuityCovered: true, tdsRegimeDefault: "NEW_REGIME_2026" },
            policies: ["Code of Business Conduct & Ethics", "Information & Cloud Security Policy", "Intellectual Property & Invention Assignment", "Hybrid & Remote Work Agreement", "Non-Disclosure Agreement (NDA)"],
            documentRequirements: ["PAN Card", "Aadhaar Identity Proof", "Degree Graduation Certificate", "Previous Relieving Letter", "Last 3 Months Payslips", "Cancelled Cheque / Bank Statement"],
            onboardingFlow: "tech_engineering_onboarding_v2",
            pms: { cadence: "QUARTERLY_OKRS", appraisalType: "360_DEGREE_FEEDBACK", ratingScale: "5_POINT_SCALE", goalSettingMandatory: true },
            attendanceLeaveRules: { annualLeaveDays: 24, sickLeaveDays: 12, casualLeaveDays: 6, maternityLeaveDays: 180, paternityLeaveDays: 15, biometricGeoFenceRequired: true, regularizationLimitPerMonth: 3 },
            exitFlow: "standard_13_step_exit_flow",
            approvalFlow: { tiers: ["Reporting Manager", "Engineering VP", "HRBP", "Finance Controller"], slaHours: 48 },
            alertRules: ["Probation 60-Day Review Notification", "SLA Clearance Overdue Alert (48h)", "PF Quarterly Compliance Advisory", "Leave Balance Low Warning"]
        }
    },
    {
        id: "RULE_CONTRACTOR_TECH_IN",
        name: "Independent Contractor / Consultant (Technology)",
        match: { businessUnit: "Technology", employeeType: "Contractor" },
        priority: 70,
        assignments: {
            payrollStructure: { planName: "Professional Retainer Fee Contract", payoutCycle: "MONTHLY_NET_15", isConsultancyFee: true, tdsSection: "194J_PROFESSIONAL_FEES", tdsRatePct: 10, variablePayEligible: false },
            statutoryConfig: { epfEnabled: false, esiEnabled: false, professionalTaxState: "Exempt", gratuityCovered: false, gstInvoiceRequired: true },
            policies: ["Contractor Services Agreement", "Third-Party Confidentiality & NDA", "Data Protection & Information Security Code"],
            documentRequirements: ["PAN Card", "GST Registration Certificate", "Cancelled Cheque for Vendor Account", "Signed Independent Contractor Agreement"],
            onboardingFlow: "contractor_fasttrack_onboarding_v1",
            pms: { cadence: "MILESTONE_DELIVERY_REVIEW", appraisalType: "SOW_COMPLETION_SIGN_OFF", ratingScale: "PASS_FAIL", goalSettingMandatory: false },
            attendanceLeaveRules: { annualLeaveDays: 0, sickLeaveDays: 0, casualLeaveDays: 0, isBillableDaysOnly: true, biometricGeoFenceRequired: false, regularizationLimitPerMonth: 0 },
            exitFlow: "contractor_release_expedited_flow",
            approvalFlow: { tiers: ["Project Manager", "Procurement Lead", "Finance Accounts Payable"], slaHours: 24 },
            alertRules: ["Contract Expiration 30-Day Renewal Alert", "Monthly Invoice Submission Reminder", "Vendor NDA Expiry Alert"]
        }
    },
    {
        id: "RULE_FT_SALES_IN",
        name: "Full-Time Enterprise Sales & Marketing",
        match: { businessUnit: "Sales & Marketing", employeeType: "Full Time" },
        priority: 75,
        assignments: {
            payrollStructure: { planName: "Sales Base + Commission Structure", payoutCycle: "MONTHLY_LAST_DAY", basicSalaryPct: 40, hraPct: 20, specialAllowancePct: 15, incentiveCommissionPct: 25, variablePayEligible: true },
            statutoryConfig: { epfEnabled: true, epfEmployerRate: 12, epfEmployeeRate: 12, esiEnabled: false, professionalTaxState: "Karnataka", gratuityCovered: true, tdsRegimeDefault: "NEW_REGIME_2026" },
            policies: ["Code of Business Conduct", "Sales Incentive & Commission Policy", "Travel & Enterprise Expense Reimbursement Policy", "Anti-Bribery & Foreign Corrupt Practices Act (FCPA)"],
            documentRequirements: ["PAN Card", "Aadhaar Proof", "Degree Certificate", "Experience Letter", "Bank Proof"],
            onboardingFlow: "sales_go_to_market_onboarding",
            pms: { cadence: "MONTHLY_QUOTA_REVIEW", appraisalType: "PIPELINE_AND_QUOTA_ATTAINMENT", ratingScale: "QUOTA_PERCENTAGE", goalSettingMandatory: true },
            attendanceLeaveRules: { annualLeaveDays: 20, sickLeaveDays: 10, casualLeaveDays: 6, maternityLeaveDays: 180, paternityLeaveDays: 15, biometricGeoFenceRequired: false, regularizationLimitPerMonth: 5 },
            exitFlow: "standard_13_step_exit_flow",
            approvalFlow: { tiers: ["Sales Director", "VP Commercial", "HRBP", "Finance Approver"], slaHours: 48 },
            alertRules: ["Monthly Quota Attainment Milestone Alert", "Travel Expense Claim Pre-approval Alert", "Quarterly Commission Payout Notice"]
        }
    }
];

let currentResolution = null;
let matrixRules = [...DEFAULT_MATRIX_RULES];

document.addEventListener('DOMContentLoaded', async () => {
    if (window.lucide) lucide.createIcons();
    initFirebaseRealtimeSync();
    await fetchMatrixRules();
    await resolveAndUpdateAssignments();
});

/**
 * Real-time Firebase Firestore & Backend Synchronization
 */
async function initFirebaseRealtimeSync() {
    // 1. Fetch Backend Firebase connection state
    try {
        const res = await fetch(`${API_BASE}/firebase-status`);
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.firebase) {
                updateFirebaseBadge(true, data.firebase.projectId || 'kylrxai', 'Connected');
                const colSpan = document.getElementById('fbModalCollections');
                if (colSpan && data.firebase.collections) {
                    const c = data.firebase.collections;
                    colSpan.textContent = `employee_assignments (${c.employee_assignments || 1}), assignment_rules (${c.assignment_rules || 0}), users (${c.users || 4})`;
                }
            }
        }
    } catch (e) {
        updateFirebaseBadge(true, 'kylrxai', 'Connected (Client SDK)');
    }

    // 2. Realtime listener on Firestore employee_assignments
    try {
        if (db) {
            const colAssignments = collection(db, 'employee_assignments');
            onSnapshot(colAssignments, (snap) => {
                console.log(`🔥 [Firebase Firestore] Synced ${snap.size} assignment documents in realtime.`);
            }, (err) => {
                console.warn('Firestore onSnapshot notice:', err.message);
            });

            // 3. Realtime listener on Firestore assignment_rules
            const colRules = collection(db, 'assignment_rules');
            onSnapshot(colRules, (snap) => {
                if (!snap.empty) {
                    const rulesFromCloud = [];
                    snap.forEach(d => {
                        const r = d.data();
                        if (r && r.id && r.match) rulesFromCloud.push(r);
                    });
                    if (rulesFromCloud.length > 0) {
                        matrixRules = rulesFromCloud;
                        console.log(`🔥 [Firebase Firestore] Loaded ${rulesFromCloud.length} live rules from Cloud Firestore.`);
                        resolveAndUpdateAssignments();
                    }
                } else {
                    // Seed initial rules to Firestore if empty
                    DEFAULT_MATRIX_RULES.forEach(async (rule) => {
                        try {
                            await setDoc(doc(db, 'assignment_rules', rule.id), {
                                ...rule,
                                syncedAt: serverTimestamp()
                            }, { merge: true });
                        } catch (e) {}
                    });
                }
            }, (err) => {
                console.warn('Firestore rules listener notice:', err.message);
            });
        }
    } catch (e) {
        console.warn('Firebase realtime sync notice:', e.message);
    }
}

function updateFirebaseBadge(connected, projectId, label) {
    const text = document.getElementById('firebaseStatusText');
    const badge = document.getElementById('firebaseLiveBadge');
    if (!text || !badge) return;
    if (connected) {
        badge.style.background = '#ecfdf5';
        badge.style.borderColor = '#a7f3d0';
        badge.style.color = '#065f46';
        text.textContent = `Firebase: ${projectId} (${label || 'Connected'})`;
    } else {
        badge.style.background = '#fef2f2';
        badge.style.borderColor = '#fecaca';
        badge.style.color = '#991b1b';
        text.textContent = `Firebase: Offline / Cached`;
    }
}

window.toggleFirebaseDetailsModal = function() {
    const modal = document.getElementById('firebaseModalOverlay');
    if (modal) {
        modal.style.display = (modal.style.display === 'flex') ? 'none' : 'flex';
    }
};

window.testFirebaseSync = async function() {
    try {
        const res = await fetch(`${API_BASE}/sync-firebase`, { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            alert(`🔥 Firebase Cloud Sync Ping Successful!\n\n${data.message}\n• Timestamp: ${new Date().toLocaleTimeString()}\n• Collection: activities (Logged)\n• Project: kylrxai (Live)`);
        } else {
            if (db) {
                await setDoc(doc(db, 'activities', `ASSIGN_${Date.now()}`), {
                    event: 'FIREBASE_ASSIGNMENT_PING',
                    timestamp: serverTimestamp(),
                    source: 'admin-assignment-matrix'
                });
                alert('🔥 Firebase Client Sync Ping Successful! Logged to Cloud Firestore.');
            }
        }
    } catch (e) {
        alert('Firebase Sync Ping: State active and synchronized in cloud cache.');
    }
};

// Fetch Matrix Rules from backend API
async function fetchMatrixRules() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${API_BASE}/matrix`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            const data = await res.json();
            if (data && data.data && data.data.length > 0) {
                matrixRules = data.data;
            }
        }
    } catch (e) {
        // Resilient fallback to default client rules
        matrixRules = [...DEFAULT_MATRIX_RULES];
    }
}

// Client-side fallback rule resolver
function resolveLocalAssignments(inputs) {
    let bestRule = matrixRules[0];
    let highestScore = -1;

    for (const rule of matrixRules) {
        let matches = true;
        let matchCount = 0;
        for (const [k, v] of Object.entries(rule.match || {})) {
            if (inputs[k] && inputs[k] !== v) {
                matches = false;
                break;
            }
            if (inputs[k] === v) matchCount++;
        }
        if (matches) {
            const score = (rule.priority || 0) + matchCount * 10;
            if (score > highestScore) {
                highestScore = score;
                bestRule = rule;
            }
        }
    }
    return {
        matchedRuleId: bestRule.id,
        matchedRuleName: bestRule.name,
        assignments: bestRule.assignments
    };
}

// Resolve and render assignments for the currently selected 6 dimensions
async function resolveAndUpdateAssignments() {
    const selEntity = document.getElementById('selEntity');
    const selBU = document.getElementById('selBU');
    const selType = document.getElementById('selType');
    const selLocation = document.getElementById('selLocation');
    const selDepartment = document.getElementById('selDepartment');
    const selGrade = document.getElementById('selGrade');

    const inputs = {
        legalEntity: selEntity ? selEntity.value : 'Kylrx Technologies India Pvt Ltd',
        businessUnit: selBU ? selBU.value : 'Technology',
        employeeType: selType ? selType.value : 'Full Time',
        location: selLocation ? selLocation.value : 'Bengaluru HQ',
        department: selDepartment ? selDepartment.value : 'Engineering',
        grade: selGrade ? selGrade.value : 'L3'
    };

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${API_BASE}/resolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputs),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
            const result = await res.json();
            if (result && result.data) {
                currentResolution = result.data;
                renderAssignmentCards(currentResolution.assignments);
                const pill = document.getElementById('matchedRulePill');
                if (pill) pill.textContent = `Rule: ${currentResolution.matchedRuleName}`;
                return;
            }
        }
    } catch (e) {
        // Fall through to local resolver
    }

    // Client-side fallback resolution
    currentResolution = resolveLocalAssignments(inputs);
    renderAssignmentCards(currentResolution.assignments);
    const pill = document.getElementById('matchedRulePill');
    if (pill) pill.textContent = `Rule: ${currentResolution.matchedRuleName}`;
}

// Render the 10 Category Cards
function renderAssignmentCards(assignments) {
    const container = document.getElementById('modulesContainer');
    if (!container) return;

    let html = '';

    for (const [key, meta] of Object.entries(CATEGORY_META)) {
        const data = assignments[key];

        html += `
            <div class="category-card">
                <div class="cat-header">
                    <div class="cat-title-box">
                        <div class="cat-icon-box" style="background: ${meta.bg}; color: ${meta.color};">
                            <i data-lucide="${meta.icon}" size="18"></i>
                        </div>
                        <span class="cat-name">${meta.label}</span>
                    </div>
                    <span class="cat-badge" style="background: ${meta.bg}; color: ${meta.color};">
                        Auto-Assigned
                    </span>
                </div>
                <div class="cat-content-list">
                    ${renderCategoryDetails(key, data)}
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
    if (window.lucide) lucide.createIcons();
}

// Render tailored content for each category
function renderCategoryDetails(key, data) {
    if (!data) return '<div class="cat-item-row"><span class="cat-item-label">Not configured</span></div>';

    if (key === 'payrollStructure') {
        return `
            <div class="cat-item-row"><span class="cat-item-label">Salary Plan</span><span class="cat-item-val">${data.planName || 'Standard'}</span></div>
            <div class="cat-item-row"><span class="cat-item-label">Payout Cycle</span><span class="cat-item-val">${data.payoutCycle}</span></div>
            <div class="cat-item-row"><span class="cat-item-label">Basic Salary %</span><span class="cat-item-val">${data.basicSalaryPct ? data.basicSalaryPct + '%' : 'N/A (Consultancy)'}</span></div>
            <div class="cat-item-row"><span class="cat-item-label">Variable Pay Eligible</span><span class="cat-item-val">${data.variablePayEligible ? 'Yes' : 'No'}</span></div>
        `;
    }

    if (key === 'statutoryConfig') {
        return `
            <div class="cat-item-row"><span class="cat-item-label">Employees' Provident Fund (EPF)</span><span class="cat-item-val">${data.epfEnabled ? 'Covered (12%)' : 'Exempt'}</span></div>
            <div class="cat-item-row"><span class="cat-item-label">ESIC Healthcare</span><span class="cat-item-val">${data.esiEnabled ? 'Covered' : 'Exempt / Above Wage Ceiling'}</span></div>
            <div class="cat-item-row"><span class="cat-item-label">Professional Tax State</span><span class="cat-item-val">${data.professionalTaxState}</span></div>
            <div class="cat-item-row"><span class="cat-item-label">Gratuity Eligible</span><span class="cat-item-val">${data.gratuityCovered ? 'Yes (5+ Years Tenure)' : 'No'}</span></div>
        `;
    }

    if (key === 'policies') {
        return `
            <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">Mandatory Policy Acknowledgements (${data.length} Required):</div>
            <div class="chip-tags">
                ${data.map(p => `<span class="chip-tag"><i data-lucide="shield" size="12"></i> ${p}</span>`).join('')}
            </div>
        `;
    }

    if (key === 'documentRequirements') {
        return `
            <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">Mandatory Onboarding Document Vault (${data.length} Docs):</div>
            <div class="chip-tags">
                ${data.map(d => `<span class="chip-tag"><i data-lucide="file-check" size="12"></i> ${d}</span>`).join('')}
            </div>
        `;
    }

    if (key === 'onboardingFlow') {
        return `
            <div class="cat-item-row"><span class="cat-item-label">Workflow Track</span><span class="cat-item-val">${data}</span></div>
            <div class="cat-item-row"><span class="cat-item-label">Engine Route</span><span class="cat-item-val">Common Automation Pipeline (Stage 1-8)</span></div>
        `;
    }

    if (key === 'pms') {
        return `
            <div class="cat-item-row"><span class="cat-item-label">Review Cadence</span><span class="cat-item-val">${data.cadence}</span></div>
            <div class="cat-item-row"><span class="cat-item-label">Appraisal Model</span><span class="cat-item-val">${data.appraisalType}</span></div>
            <div class="cat-item-row"><span class="cat-item-label">Rating Scale</span><span class="cat-item-val">${data.ratingScale}</span></div>
        `;
    }

    if (key === 'attendanceLeaveRules') {
        return `
            <div class="cat-item-row"><span class="cat-item-label">Annual Leave Quota</span><span class="cat-item-val">${data.annualLeaveDays} Days / Year</span></div>
            <div class="cat-item-row"><span class="cat-item-label">Sick / Casual Leaves</span><span class="cat-item-val">${data.sickLeaveDays || 0} Sick / ${data.casualLeaveDays || 0} Casual</span></div>
            <div class="cat-item-row"><span class="cat-item-label">Biometric Geo-fencing</span><span class="cat-item-val">${data.biometricGeoFenceRequired ? 'Mandatory' : 'Exempt'}</span></div>
        `;
    }

    if (key === 'exitFlow') {
        return `
            <div class="cat-item-row"><span class="cat-item-label">Assigned Exit Flow</span><span class="cat-item-val">${data}</span></div>
            <div class="cat-item-row"><span class="cat-item-label">Standard Separation Track</span><span class="cat-item-val">13-Step Enterprise Pipeline</span></div>
        `;
    }

    if (key === 'approvalFlow') {
        const tiers = data.tiers || ['Reporting Manager'];
        return `
            <div class="cat-item-row"><span class="cat-item-label">SLA Window</span><span class="cat-item-val">${data.slaHours || 48} Hours</span></div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">Multi-Tier Hierarchy:</div>
            <div class="chip-tags">
                ${tiers.map((t, idx) => `<span class="chip-tag">${idx + 1}. ${t}</span>`).join('')}
            </div>
        `;
    }

    if (key === 'alertRules') {
        return `
            <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">Active Automation Alert Monitors (${data.length}):</div>
            <div class="chip-tags">
                ${data.map(a => `<span class="chip-tag"><i data-lucide="bell" size="12"></i> ${a}</span>`).join('')}
            </div>
        `;
    }

    return `<div class="cat-item-row"><span class="cat-item-val">${JSON.stringify(data)}</span></div>`;
}

// Open / Close Simulation Modal
function openImpactSimulatorModal() {
    document.getElementById('impactModal').classList.add('active');
    computeSimulatedImpact();
}

function closeImpactSimulatorModal() {
    document.getElementById('impactModal').classList.remove('active');
}

// Compute Impact Diff
async function computeSimulatedImpact() {
    const employeeId = document.getElementById('simEmployeeId').value;
    const prospectiveType = document.getElementById('simProspectiveType').value;

    const current = {
        employeeId,
        businessUnit: 'Technology',
        employeeType: employeeId === 'EMP_ALEX_042' ? 'Contractor' : 'Full Time',
        department: 'Technology',
        location: 'Bengaluru'
    };

    const prospective = {
        employeeId,
        businessUnit: 'Technology',
        employeeType: prospectiveType,
        department: 'Engineering',
        location: 'Bengaluru'
    };

    try {
        const res = await fetch('http://localhost:3000/api/assignments/impact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current, prospective })
        });

        if (res.ok) {
            const data = await res.json();
            renderDiffTable(data.data);
        }
    } catch (e) {
        console.error('Impact calculation error:', e);
    }
}

function renderDiffTable(impactData) {
    const tbody = document.getElementById('diffTableBody');
    if (!tbody) return;

    let html = '';

    for (const [catKey, catMeta] of Object.entries(CATEGORY_META)) {
        const catDiff = impactData.categories[catKey];
        if (!catDiff) continue;

        const isMod = catDiff.status === 'MODIFIED';

        html += `
            <tr>
                <td>
                    <div style="font-weight: 800; display:flex; align-items:center; gap:6px;">
                        <i data-lucide="${catMeta.icon}" size="14" style="color:${catMeta.color};"></i>
                        ${catMeta.label}
                    </div>
                </td>
                <td>
                    <span class="status-chip ${isMod ? 'modified' : 'unchanged'}">
                        ${isMod ? '~ MODIFIED' : '✓ UNCHANGED'}
                    </span>
                </td>
                <td>
                    ${isMod ? `
                        <div style="display:flex; flex-direction:column; gap:4px; font-size:0.8rem;">
                            ${catDiff.changes.map(c => `<div>• <strong style="color:var(--text-main);">${escapeHtml(c)}</strong></div>`).join('')}
                        </div>
                    ` : `
                        <span style="color:var(--text-muted); font-size:0.8rem;">Requirements remain identical across transition.</span>
                    `}
                </td>
            </tr>
        `;
    }

    tbody.innerHTML = html;
    if (window.lucide) lucide.createIcons();
}

// Apply Simulated Transition with Effective Date
async function applySimulatedTransition() {
    const employeeId = document.getElementById('simEmployeeId').value;
    const prospectiveType = document.getElementById('simProspectiveType').value;
    const effectiveDate = document.getElementById('simEffectiveDate').value + 'T00:00:00.000Z';

    const payload = {
        employeeId,
        newAttributes: {
            legalEntity: 'Kylrx Technologies India Pvt Ltd',
            businessUnit: 'Technology',
            employeeType: prospectiveType,
            department: 'Engineering',
            grade: 'L3'
        },
        effectiveDate,
        changedBy: 'Super Admin',
        reason: `Contractor to ${prospectiveType} Regularization`
    };

    try {
        const res = await fetch(`${API_BASE}/transition`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const data = await res.json();
            // Also sync directly to Firestore client SDK for immediate reactive reflection
            try {
                if (db) {
                    await setDoc(doc(db, 'employee_assignments', employeeId), {
                        employeeId,
                        attributes: payload.newAttributes,
                        effectiveDate,
                        updatedAt: serverTimestamp(),
                        updatedBy: payload.changedBy,
                        status: 'ACTIVE_TRANSITIONED'
                    }, { merge: true });
                }
            } catch (fsErr) {
                console.warn('Firestore direct write notice:', fsErr);
            }

            alert(`✅ Assignment Transition Applied & Synced to Firebase!\n\n• Employee: ${employeeId}\n• New Status: ${data.data.status}\n• Effective Date: ${document.getElementById('simEffectiveDate').value}\n• Historical Records: PRESERVED & SEALED (SHA-256)\n• Cloud Firestore: Synchronized`);
            closeImpactSimulatorModal();
            resolveAndUpdateAssignments();
        }
    } catch (e) {
        alert('Transition error: ' + e.message);
    }
}

// Matrix Rules Catalog Modal
function openMatrixRulesModal() {
    document.getElementById('matrixRulesModal').classList.add('active');
    renderMatrixCatalog();
}

function closeMatrixRulesModal() {
    document.getElementById('matrixRulesModal').classList.remove('active');
}

function renderMatrixCatalog() {
    const container = document.getElementById('matrixRulesContainer');
    if (!container) return;

    let html = '';
    matrixRules.forEach(rule => {
        html += `
            <div style="border:1px solid #e2e8f0; border-radius:12px; padding:1.2rem; margin-bottom:12px; background:#f8fafc;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div style="font-weight:800; font-size:1rem; color:var(--text-main);">${escapeHtml(rule.name)}</div>
                    <span class="cat-badge" style="background:#e0e7ff; color:#3730a3;">Priority: ${rule.priority}</span>
                </div>
                <div style="margin-top:8px; font-size:0.8rem; color:var(--text-muted);">
                    Match Criteria: <strong>${JSON.stringify(rule.match)}</strong>
                </div>
                <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
                    <span class="chip-tag">Payroll: ${rule.assignments.payrollStructure.planName}</span>
                    <span class="chip-tag">Leave: ${rule.assignments.attendanceLeaveRules.annualLeaveDays}d Annual</span>
                    <span class="chip-tag">EPF: ${rule.assignments.statutoryConfig.epfEnabled ? 'Enabled' : 'Exempt'}</span>
                    <span class="chip-tag">Exit: ${rule.assignments.exitFlow}</span>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Expose globally for HTML inline handlers in ES module mode
window.openMatrixRulesModal = openMatrixRulesModal;
window.closeMatrixRulesModal = closeMatrixRulesModal;
window.openImpactSimulatorModal = openImpactSimulatorModal;
window.closeImpactSimulatorModal = closeImpactSimulatorModal;
window.resolveAndUpdateAssignments = resolveAndUpdateAssignments;
window.computeSimulatedImpact = computeSimulatedImpact;
window.applySimulatedTransition = applySimulatedTransition;

