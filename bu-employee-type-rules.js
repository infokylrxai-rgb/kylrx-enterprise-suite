/**
 * Kylrx.ai - Business Unit by Employee Type Rules Engine (PRD Section 10)
 * Client-side Controller & Form Gating Script
 * Handles real-time filtering, Firestore sync, and Admin configuration UI.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxBuRules = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const CANONICAL_EMPLOYEE_TYPES = [
        {
            code: 'FULL_TIME',
            name: 'Full-Time Regular',
            categoryCode: 'CAT_FT',
            employmentType: 'Full-Time',
            workerType: 'Permanent',
            badgeClass: 'badge-fulltime'
        },
        {
            code: 'CONTRACTOR',
            name: 'Contractor / TVC',
            categoryCode: 'CAT_CON',
            employmentType: 'Contract',
            workerType: 'Contingent',
            badgeClass: 'badge-contractor'
        },
        {
            code: 'INTERN',
            name: 'Intern / Apprentice',
            categoryCode: 'CAT_INT',
            employmentType: 'Internship',
            workerType: 'Trainee',
            badgeClass: 'badge-intern'
        },
        {
            code: 'CONSULTANT',
            name: 'Consultant / Specialist',
            categoryCode: 'CAT_CNS',
            employmentType: 'Consulting',
            workerType: 'Professional',
            badgeClass: 'badge-consultant'
        },
        {
            code: 'EXECUTIVE',
            name: 'Executive Leadership',
            categoryCode: 'CAT_EXE',
            employmentType: 'Full-Time',
            workerType: 'Officer',
            badgeClass: 'badge-executive'
        }
    ];

    const DEFAULT_BU_RULES = [
        {
            ruleId: 'rule_bu_eng',
            businessUnitCode: 'BU_ENG',
            businessUnitName: 'Core Engineering & Technology',
            allowedEmployeeTypes: ['FULL_TIME', 'INTERN', 'CONTRACTOR'],
            headEmployeeId: 'EMP0001',
            isActive: true
        },
        {
            ruleId: 'rule_bu_tech',
            businessUnitCode: 'BU-TECH',
            businessUnitName: 'Technology & Product Engineering',
            allowedEmployeeTypes: ['FULL_TIME', 'INTERN', 'CONTRACTOR'],
            headEmployeeId: 'EMP0001',
            isActive: true
        },
        {
            ruleId: 'rule_bu_ops',
            businessUnitCode: 'BU-OPS',
            businessUnitName: 'Global Operations & Customer Success',
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACTOR'],
            headEmployeeId: 'EMP0002',
            isActive: true
        },
        {
            ruleId: 'rule_bu_corp',
            businessUnitCode: 'BU-CORP',
            businessUnitName: 'Corporate Finance & HR',
            allowedEmployeeTypes: ['FULL_TIME', 'CONSULTANT'],
            headEmployeeId: 'EMP0003',
            isActive: true
        },
        {
            ruleId: 'rule_bu_exec',
            businessUnitCode: 'BU-EXEC',
            businessUnitName: 'Executive Leadership & Strategy',
            allowedEmployeeTypes: ['EXECUTIVE', 'FULL_TIME'],
            headEmployeeId: 'EMP0004',
            isActive: true
        },
        {
            ruleId: 'rule_bu_sales',
            businessUnitCode: 'BU-SALES',
            businessUnitName: 'Enterprise Sales & Partnerships',
            allowedEmployeeTypes: ['FULL_TIME', 'CONTRACTOR', 'CONSULTANT'],
            headEmployeeId: 'EMP0005',
            isActive: true
        }
    ];

    // In-memory cache of rules
    let currentRules = new Map();
    let isInitialized = false;

    function initDefaultRules() {
        if (currentRules.size === 0) {
            DEFAULT_BU_RULES.forEach(r => {
                currentRules.set(r.businessUnitCode, { ...r });
            });
        }
    }
    initDefaultRules();

    /**
     * Fetch rules from Cloud Firestore (bu_employee_type_rules collection)
     */
    async function loadRulesFromFirestore() {
        try {
            const fb = await import('./firebase-config.js');
            if (fb && fb.db && fb.collection && fb.getDocs) {
                const querySnapshot = await fb.getDocs(fb.collection(fb.db, 'bu_employee_type_rules'));
                if (!querySnapshot.empty) {
                    currentRules.clear();
                    querySnapshot.forEach(docSnap => {
                        const data = docSnap.data();
                        const buCode = (data.businessUnitCode || docSnap.id).toUpperCase();
                        currentRules.set(buCode, {
                            ruleId: docSnap.id,
                            businessUnitCode: buCode,
                            businessUnitName: data.businessUnitName || buCode,
                            allowedEmployeeTypes: Array.isArray(data.allowedEmployeeTypes) ? data.allowedEmployeeTypes : [],
                            headEmployeeId: data.headEmployeeId || '',
                            isActive: data.isActive !== false,
                            updatedAt: data.updatedAt || null
                        });
                    });
                    console.log(`[BURules] Loaded ${currentRules.size} rules from Cloud Firestore.`);
                }
            }
        } catch (err) {
            console.warn('[BURules] Firestore load notice (using resilient defaults):', err.message);
        }

        // Also attempt loading from local backend API
        try {
            const token = localStorage.getItem('authToken') || 
                          localStorage.getItem('hr_access_token') || 
                          localStorage.getItem('access_token') || 
                          localStorage.getItem('token') || 
                          'demo-static-token';
            const res = await fetch('http://localhost:3000/api/admin/bu-rules', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            if (res.ok) {
                const json = await res.json();
                if (json.success && Array.isArray(json.rules) && json.rules.length > 0) {
                    json.rules.forEach(r => {
                        currentRules.set(r.businessUnitCode.toUpperCase(), r);
                    });
                }
            }
        } catch (_) {}

        isInitialized = true;
        dispatchRulesUpdatedEvent();
        return Array.from(currentRules.values());
    }

    function dispatchRulesUpdatedEvent() {
        if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('buRulesUpdated', {
                detail: { rules: Array.from(currentRules.values()) }
            }));
        }
    }

    /**
     * Get all currently configured rules
     */
    function getAllRules() {
        return Array.from(currentRules.values());
    }

    /**
     * Get all supported canonical employee types
     */
    function getEmployeeTypes() {
        return [...CANONICAL_EMPLOYEE_TYPES];
    }

    /**
     * Returns list of business units allowed for a selected employee type
     */
    function getAllowedBusinessUnits(employeeType) {
        if (!employeeType) {
            return getAllRules().filter(r => r.isActive !== false);
        }
        const normalized = employeeType.trim().toUpperCase();
        return getAllRules().filter(r => {
            if (r.isActive === false) return false;
            const allowed = (r.allowedEmployeeTypes || []).map(t => t.toUpperCase());
            return allowed.includes(normalized);
        });
    }

    /**
     * Check if a combination is valid
     */
    function isCombinationValid(buCode, employeeType) {
        if (!buCode || !employeeType) {
            return { valid: false, error: 'Both Business Unit and Employee Type are required.' };
        }
        const normalizedBU = buCode.trim().toUpperCase();
        const normalizedType = employeeType.trim().toUpperCase();

        const rule = currentRules.get(normalizedBU);
        if (!rule) {
            return {
                valid: false,
                error: `Business Unit '${buCode}' is not mapped in organizational rules.`
            };
        }

        if (rule.isActive === false) {
            return {
                valid: false,
                error: `Business Unit '${rule.businessUnitName}' (${buCode}) is deactivated.`
            };
        }

        const allowed = (rule.allowedEmployeeTypes || []).map(t => t.toUpperCase());
        if (!allowed.includes(normalizedType)) {
            const allowedLabels = allowed.map(t => {
                const found = CANONICAL_EMPLOYEE_TYPES.find(c => c.code === t);
                return found ? found.name : t;
            }).join(', ');

            return {
                valid: false,
                error: `Business Unit '${rule.businessUnitName}' (${buCode}) does not permit '${employeeType}'. Allowed employee types: ${allowedLabels || 'None'}.`
            };
        }

        return { valid: true };
    }

    /**
     * Save a Business Unit Rule to Cloud Firestore and local store
     */
    async function saveRule(ruleData, actor = 'Super Admin') {
        const buCode = (ruleData.businessUnitCode || '').trim().toUpperCase();
        if (!buCode) throw new Error('Business Unit Code is required.');

        const ruleId = ruleData.ruleId || `rule_${buCode.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
        const allowedTypes = Array.isArray(ruleData.allowedEmployeeTypes)
            ? ruleData.allowedEmployeeTypes.map(t => t.trim().toUpperCase())
            : ['FULL_TIME'];

        const existing = currentRules.get(buCode) || {};
        const record = {
            ruleId,
            businessUnitCode: buCode,
            businessUnitName: ruleData.businessUnitName || existing.businessUnitName || buCode,
            allowedEmployeeTypes: allowedTypes,
            headEmployeeId: ruleData.headEmployeeId || existing.headEmployeeId || '',
            isActive: ruleData.isActive !== false,
            updatedAt: new Date().toISOString(),
            updatedBy: actor
        };

        // 1. Write to Cloud Firestore collection: bu_employee_type_rules/{ruleId}
        try {
            const fb = await import('./firebase-config.js');
            if (fb && fb.db && fb.doc && fb.setDoc) {
                const docRef = fb.doc(fb.db, 'bu_employee_type_rules', ruleId);
                await fb.setDoc(docRef, {
                    ...record,
                    updatedAt: fb.serverTimestamp ? fb.serverTimestamp() : new Date().toISOString()
                }, { merge: true });
                console.log(`[BURules] Saved to Cloud Firestore bu_employee_type_rules/${ruleId}`);
            }
        } catch (err) {
            console.warn('[BURules] Firestore write notice:', err.message);
        }

        // 2. Also save to backend API
        try {
            const token = localStorage.getItem('authToken') || 
                          localStorage.getItem('hr_access_token') || 
                          localStorage.getItem('access_token') || 
                          localStorage.getItem('token') || 
                          'demo-static-token';
            await fetch('http://localhost:3000/api/admin/bu-rules', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(record)
            });
        } catch (_) {}

        // 3. Update memory
        currentRules.set(buCode, record);
        dispatchRulesUpdatedEvent();
        return record;
    }

    /**
     * Real-time Client-side Form Binding Script
     * Connects an Employee Type `<select>` with a Business Unit `<select>`
     * Enforces real-time filtering, hides invalid options, and shows gentle inline notice if cleared.
     */
    function bindEmployeeTypeAndBuGating(empTypeSelect, buSelect, options = {}) {
        if (!empTypeSelect || !buSelect) return;

        const noticeContainerId = options.noticeContainerId || 'buMismatchNotice';
        let noticeEl = document.getElementById(noticeContainerId);

        // Ensure inline notice element exists
        if (!noticeEl) {
            noticeEl = document.createElement('div');
            noticeEl.id = noticeContainerId;
            noticeEl.style.display = 'none';
            noticeEl.style.marginTop = '6px';
            noticeEl.style.padding = '8px 12px';
            noticeEl.style.borderRadius = '8px';
            noticeEl.style.backgroundColor = '#fef2f2';
            noticeEl.style.color = '#991b1b';
            noticeEl.style.border = '1px solid #fecaca';
            noticeEl.style.fontSize = '0.78rem';
            noticeEl.style.lineHeight = '1.35';
            noticeEl.style.transition = 'opacity 0.3s ease';

            if (buSelect.parentNode) {
                buSelect.parentNode.appendChild(noticeEl);
            }
        }

        function showGentleNotice(message) {
            if (!noticeEl) return;
            noticeEl.innerHTML = `<i class="fas fa-info-circle" style="margin-right: 4px;"></i> ${message}`;
            noticeEl.style.display = 'block';
            noticeEl.style.opacity = '1';

            // Auto-hide after 5 seconds
            setTimeout(() => {
                if (noticeEl) {
                    noticeEl.style.opacity = '0';
                    setTimeout(() => { if (noticeEl) noticeEl.style.display = 'none'; }, 300);
                }
            }, 5000);
        }

        function filterBuDropdown() {
            const selectedType = (empTypeSelect.value || '').trim().toUpperCase();
            const currentSelectedBU = (buSelect.value || '').trim().toUpperCase();

            const allowedBUs = getAllowedBusinessUnits(selectedType);
            const allowedCodes = allowedBUs.map(b => b.businessUnitCode.toUpperCase());

            let previousValueStillAllowed = false;

            // Preserve the first placeholder option if it exists
            const placeholderOption = buSelect.options[0] && buSelect.options[0].value === '' 
                ? buSelect.options[0].outerHTML 
                : '<option value="">-- Select Eligible Business Unit --</option>';

            buSelect.innerHTML = placeholderOption;

            allowedBUs.forEach(bu => {
                const opt = document.createElement('option');
                opt.value = bu.businessUnitCode;
                opt.textContent = `${bu.businessUnitCode} - ${bu.businessUnitName}`;
                if (bu.businessUnitCode.toUpperCase() === currentSelectedBU) {
                    opt.selected = true;
                    previousValueStillAllowed = true;
                }
                buSelect.appendChild(opt);
            });

            // If the user previously had a selection that is no longer permitted, auto-clear
            if (currentSelectedBU && !previousValueStillAllowed) {
                buSelect.value = '';
                const typeLabel = (CANONICAL_EMPLOYEE_TYPES.find(t => t.code === selectedType)?.name) || selectedType;
                showGentleNotice(`Previous Business Unit <strong>(${currentSelectedBU})</strong> was cleared as it is not eligible for <strong>${typeLabel}</strong>.`);
            }

            // Enable or disable based on allowed list
            if (allowedBUs.length === 0) {
                buSelect.disabled = true;
                showGentleNotice(`No Business Units are configured for the selected Employee Type.`);
            } else {
                buSelect.disabled = false;
            }
        }

        // Attach listener
        empTypeSelect.addEventListener('change', filterBuDropdown);

        // Also listen to global rules updates
        window.addEventListener('buRulesUpdated', filterBuDropdown);

        // Run initial filtering
        filterBuDropdown();

        return {
            refresh: filterBuDropdown,
            validate: () => isCombinationValid(buSelect.value, empTypeSelect.value)
        };
    }

    /**
     * UI Rendering for Super Admin Configuration Console
     */
    function renderAdminRulesTable(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const rules = getAllRules();
        const types = getEmployeeTypes();

        let tableHtml = `
            <div class="bu-rules-table-wrapper" style="overflow-x: auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
                    <thead>
                        <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0; color: #475569;">
                            <th style="padding: 14px 16px; font-weight: 800; width: 140px;">BU Code</th>
                            <th style="padding: 14px 16px; font-weight: 800;">Business Unit Name</th>
                            <th style="padding: 14px 16px; font-weight: 800;">Allowed Employee Types (PRD §10)</th>
                            <th style="padding: 14px 16px; font-weight: 800; width: 90px; text-align: center;">Status</th>
                            <th style="padding: 14px 16px; font-weight: 800; width: 110px; text-align: center;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        rules.forEach(rule => {
            const allowed = (rule.allowedEmployeeTypes || []).map(t => t.toUpperCase());

            const pillsHtml = types.map(t => {
                const isChecked = allowed.includes(t.code);
                return `
                    <label class="bu-type-pill ${isChecked ? 'active' : ''}" style="
                        display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 700; cursor: pointer; user-select: none; transition: all 0.15s ease;
                        background: ${isChecked ? '#dbeafe' : '#f1f5f9'};
                        color: ${isChecked ? '#1d4ed8' : '#64748b'};
                        border: 1px solid ${isChecked ? '#93c5fd' : '#cbd5e1'};
                    ">
                        <input type="checkbox" style="display:none;" 
                            data-bu="${rule.businessUnitCode}" 
                            data-type="${t.code}" 
                            ${isChecked ? 'checked' : ''} 
                            onchange="window.KylrxBuRules.handleTypeToggle('${rule.businessUnitCode}', '${t.code}', this.checked)"
                        />
                        <span>${t.name}</span>
                        <i class="fas ${isChecked ? 'fa-check-circle' : 'fa-circle'}" style="font-size: 10px;"></i>
                    </label>
                `;
            }).join(' ');

            tableHtml += `
                <tr id="row_bu_${rule.businessUnitCode}" style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;">
                    <td style="padding: 12px 16px; font-family: monospace; font-weight: 700; color: #2563eb;">
                        ${rule.businessUnitCode}
                    </td>
                    <td style="padding: 12px 16px; font-weight: 600; color: #0f172a;">
                        ${rule.businessUnitName}
                    </td>
                    <td style="padding: 12px 16px;">
                        <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                            ${pillsHtml}
                        </div>
                    </td>
                    <td style="padding: 12px 16px; text-align: center;">
                        <span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 0.7rem; font-weight: 700; background: ${rule.isActive ? '#dcfce7' : '#fee2e2'}; color: ${rule.isActive ? '#166534' : '#991b1b'};">
                            ${rule.isActive ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td style="padding: 12px 16px; text-align: center;">
                        <button type="button" class="btn btn-primary" style="padding: 6px 12px; font-size: 0.75rem; border-radius: 8px;" onclick="window.KylrxBuRules.saveSingleRule('${rule.businessUnitCode}')">
                            <i class="fas fa-save"></i> Save
                        </button>
                    </td>
                </tr>
            `;
        });

        tableHtml += `
                    </tbody>
                </table>
            </div>
        `;

        container.innerHTML = tableHtml;
    }

    function handleTypeToggle(buCode, empTypeCode, isChecked) {
        const rule = currentRules.get(buCode.toUpperCase());
        if (!rule) return;

        let allowed = (rule.allowedEmployeeTypes || []).map(t => t.toUpperCase());
        if (isChecked) {
            if (!allowed.includes(empTypeCode)) allowed.push(empTypeCode);
        } else {
            allowed = allowed.filter(t => t !== empTypeCode);
        }
        rule.allowedEmployeeTypes = allowed;

        // Visual pill toggle
        const pill = document.querySelector(`input[data-bu="${buCode}"][data-type="${empTypeCode}"]`)?.closest('.bu-type-pill');
        if (pill) {
            if (isChecked) {
                pill.classList.add('active');
                pill.style.background = '#dbeafe';
                pill.style.color = '#1d4ed8';
                pill.style.borderColor = '#93c5fd';
                const icon = pill.querySelector('i');
                if (icon) icon.className = 'fas fa-check-circle';
            } else {
                pill.classList.remove('active');
                pill.style.background = '#f1f5f9';
                pill.style.color = '#64748b';
                pill.style.borderColor = '#cbd5e1';
                const icon = pill.querySelector('i');
                if (icon) icon.className = 'fas fa-circle';
            }
        }
    }

    async function saveSingleRule(buCode) {
        const rule = currentRules.get(buCode.toUpperCase());
        if (!rule) return;

        try {
            await saveRule(rule);
            if (typeof window.showToast === 'function') {
                window.showToast(`Rules saved for ${rule.businessUnitName} (${buCode})`, 'success');
            } else {
                alert(`Saved rules for ${rule.businessUnitName}`);
            }
        } catch (err) {
            alert(`Failed to save: ${err.message}`);
        }
    }

    async function saveAllRules() {
        const rules = getAllRules();
        let count = 0;
        for (const r of rules) {
            await saveRule(r);
            count++;
        }
        if (typeof window.showToast === 'function') {
            window.showToast(`All ${count} Business Unit rules saved to Cloud Firestore!`, 'success');
        } else {
            alert(`All ${count} Business Unit rules saved!`);
        }
    }

    // Auto-load rules on initialization
    if (typeof window !== 'undefined') {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            loadRulesFromFirestore();
        } else {
            document.addEventListener('DOMContentLoaded', loadRulesFromFirestore);
        }
    }

    return {
        CANONICAL_EMPLOYEE_TYPES,
        DEFAULT_BU_RULES,
        loadRulesFromFirestore,
        getAllRules,
        getEmployeeTypes,
        getAllowedBusinessUnits,
        isCombinationValid,
        saveRule,
        bindEmployeeTypeAndBuGating,
        renderAdminRulesTable,
        handleTypeToggle,
        saveSingleRule,
        saveAllRules
    };
}));
