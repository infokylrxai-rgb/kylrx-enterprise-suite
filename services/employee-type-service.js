/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - EMPLOYEE TYPE / CATEGORY SERVICE
 * ============================================================================
 * 
 * Manages Employee Types & Categories, Firestore persistence, dynamic tenure
 * calculation, and Business Unit rule interlocks matching PRD §§ 1, 10, & 13:
 * 
 * 1. Cloud Firestore Data Architecture:
 *    - Path: organizations/{orgId}/employee_types/{categoryCode}
 *    - Document Schema:
 *      {
 *        "categoryCode": "CAT_FT_REG",
 *        "categoryName": "Full-Time Regular",
 *        "employmentType": "Permanent",
 *        "workerType": "White Collar",
 *        "probationDays": 180,
 *        "noticePeriodDays": 60,
 *        "isActive": true,
 *        "createdAt": "serverTimestamp()",
 *        "updatedAt": "serverTimestamp()"
 *      }
 * 
 * 2. Dynamic Tenure & Date Auto-Calculation (PRD §13):
 *    - Automatically fetches mapped Probation_Days and Notice_Period_Days
 *    - If Joining_Date is provided, dynamically calculates:
 *      probationEndDate = new Date(joiningDate.getTime() + (probationDays * 24 * 60 * 60 * 1000))
 *    - Pre-populates the notice period duration
 * 
 * 3. Business Unit Rule Integration (PRD §10):
 *    - Filters allowed Business Units based on selected Employee Category
 *    - Auto-resets or flags invalid Business Unit selections if Category is changed
 * 
 * @version 1.0.0
 * @author Senior Full-Stack Firebase Architect
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.KylrxEmployeeTypeService = factory();
        root.KylrxEmployeeCategoryService = root.KylrxEmployeeTypeService;
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // Default Enterprise Employee Types
    const DEFAULT_EMPLOYEE_TYPES = [
        {
            categoryCode: 'CAT_FT_REG',
            categoryName: 'Full-Time Regular',
            employmentType: 'Permanent',
            workerType: 'White Collar',
            probationDays: 180,
            noticePeriodDays: 60,
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            categoryCode: 'CAT_FT_EXEC',
            categoryName: 'Executive Leadership',
            employmentType: 'Permanent',
            workerType: 'White Collar',
            probationDays: 90,
            noticePeriodDays: 90,
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            categoryCode: 'CAT_CON_TVC',
            categoryName: 'Contractor / TVC',
            employmentType: 'Contract',
            workerType: 'Off-Roll',
            probationDays: 30,
            noticePeriodDays: 30,
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            categoryCode: 'CAT_INT_GRAD',
            categoryName: 'Graduate Intern / Apprentice',
            employmentType: 'Intern',
            workerType: 'On-Roll',
            probationDays: 0,
            noticePeriodDays: 15,
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            categoryCode: 'CAT_TEMP_OPS',
            categoryName: 'Temporary & Seasonal Staff',
            employmentType: 'Temporary',
            workerType: 'Blue Collar',
            probationDays: 15,
            noticePeriodDays: 15,
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        },
        {
            categoryCode: 'CAT_PLANT_WKR',
            categoryName: 'Plant & Manufacturing Operative',
            employmentType: 'Permanent',
            workerType: 'Blue Collar',
            probationDays: 180,
            noticePeriodDays: 30,
            isActive: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
        }
    ];

    // In-memory cache for fast UI lookups and node testing environments
    let _typesCache = [...DEFAULT_EMPLOYEE_TYPES];

    /**
     * Resolves the current organization ID
     */
    function resolveOrgId(orgId) {
        if (orgId && typeof orgId === 'string' && orgId.trim() !== '') return orgId.trim();
        if (typeof window !== 'undefined') {
            if (window.currentOrgId) return window.currentOrgId;
            if (window.currentUser && window.currentUser.orgId) return window.currentUser.orgId;
            const stored = localStorage.getItem('kylrx_org_id') || localStorage.getItem('current_org_id');
            if (stored) return stored;
        }
        return 'org_default';
    }

    /**
     * Returns the strict Cloud Firestore path: organizations/{orgId}/employee_types/{categoryCode}
     */
    function getFirestorePath(orgId, categoryCode) {
        const resolvedOrg = resolveOrgId(orgId);
        const code = String(categoryCode || '').trim().toUpperCase().replace(/\s+/g, '_');
        return `organizations/${resolvedOrg}/employee_types/${code}`;
    }

    /**
     * Normalizes aliases (e.g. FULL_TIME -> CAT_FT_REG, CONTRACTOR -> CAT_CON_TVC)
     */
    function normalizeCategoryCode(code) {
        if (!code) return '';
        const upper = String(code).trim().toUpperCase().replace(/\s+/g, '_');
        const aliasMap = {
            'FULL_TIME': 'CAT_FT_REG',
            'CAT_FT': 'CAT_FT_REG',
            'PERMANENT': 'CAT_FT_REG',
            'EXECUTIVE': 'CAT_FT_EXEC',
            'CAT_EXE': 'CAT_FT_EXEC',
            'CONTRACTOR': 'CAT_CON_TVC',
            'CONTRACT': 'CAT_CON_TVC',
            'CAT_CON': 'CAT_CON_TVC',
            'INTERN': 'CAT_INT_GRAD',
            'CAT_INT': 'CAT_INT_GRAD',
            'APPRENTICE': 'CAT_INT_GRAD',
            'TEMPORARY': 'CAT_TEMP_OPS',
            'CAT_TEMP': 'CAT_TEMP_OPS',
            'PLANT': 'CAT_PLANT_WKR',
            'BLUE_COLLAR': 'CAT_PLANT_WKR'
        };
        return aliasMap[upper] || upper;
    }

    /**
     * Finds an employee category by code or synonym
     */
    function findTypeInCache(code) {
        if (!code) return null;
        const norm = normalizeCategoryCode(code);
        return _typesCache.find(t => t.categoryCode === norm || t.categoryCode === code.toUpperCase()) ||
               _typesCache.find(t => t.categoryName.toLowerCase() === String(code).toLowerCase());
    }

    /**
     * Dynamic Tenure & Date Auto-Calculation (PRD Section 13)
     * probationEndDate = new Date(joiningDate.getTime() + (probationDays * 24 * 60 * 60 * 1000))
     * 
     * @param {string|Date} joiningDate - Employee's joining date
     * @param {number} probationDays - Days of probation
     * @returns {Object} { date, isoDate, formattedDate, days }
     */
    function calculateProbationEndDate(joiningDate, probationDays) {
        if (!joiningDate) {
            return {
                valid: false,
                date: null,
                isoDate: '',
                formattedDate: '',
                days: Number(probationDays || 0),
                error: 'Joining Date is required to compute probation end date.'
            };
        }

        let jDate;
        if (joiningDate instanceof Date) {
            jDate = new Date(joiningDate.getTime());
        } else if (typeof joiningDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(joiningDate.trim())) {
            const [y, m, d] = joiningDate.trim().split('-').map(Number);
            jDate = new Date(y, m - 1, d);
        } else {
            jDate = new Date(joiningDate);
        }

        if (isNaN(jDate.getTime())) {
            return {
                valid: false,
                date: null,
                isoDate: '',
                formattedDate: '',
                days: Number(probationDays || 0),
                error: 'Invalid Joining Date supplied.'
            };
        }

        const days = Math.max(0, Number(probationDays !== undefined && probationDays !== null ? probationDays : 180));
        const endDateMs = jDate.getTime() + (days * 24 * 60 * 60 * 1000);
        const endDate = new Date(endDateMs);

        // Format to YYYY-MM-DD
        const year = endDate.getFullYear();
        const month = String(endDate.getMonth() + 1).padStart(2, '0');
        const day = String(endDate.getDate()).padStart(2, '0');
        const formattedDate = `${year}-${month}-${day}`;

        return {
            valid: true,
            date: endDate,
            isoDate: endDate.toISOString(),
            formattedDate,
            days
        };
    }

    /**
     * Resolves mapped probation and notice period days for a selected employee category
     */
    function getEmployeeTypeDetails(categoryCodeOrAlias) {
        const found = findTypeInCache(categoryCodeOrAlias);
        if (found) {
            return {
                found: true,
                categoryCode: found.categoryCode,
                categoryName: found.categoryName,
                employmentType: found.employmentType,
                workerType: found.workerType,
                probationDays: found.probationDays,
                noticePeriodDays: found.noticePeriodDays,
                isActive: found.isActive
            };
        }

        // Standard sensible fallbacks
        const norm = normalizeCategoryCode(categoryCodeOrAlias);
        return {
            found: false,
            categoryCode: norm || 'CAT_FT_REG',
            categoryName: 'Full-Time Regular',
            employmentType: 'Permanent',
            workerType: 'White Collar',
            probationDays: 180,
            noticePeriodDays: 60,
            isActive: true
        };
    }

    /**
     * Business Unit Rule Integration (PRD Section 10):
     * Filters a list of Business Units to show only units where this category is permitted.
     */
    function filterBusinessUnitsForEmployeeType(categoryCode, buList) {
        if (!Array.isArray(buList) || buList.length === 0) return [];
        if (!categoryCode) return buList;

        const norm = normalizeCategoryCode(categoryCode);
        const details = getEmployeeTypeDetails(categoryCode);
        const rawCode = String(categoryCode).toUpperCase();

        return buList.filter(bu => {
            if (bu.isActive === false || bu.active === false) return false;
            
            // Check allowedEmployeeTypes
            const allowed = bu.allowedEmployeeTypes || bu.allowed_employee_types || bu['Allowed Employee Types'];
            if (!allowed || !Array.isArray(allowed) || allowed.length === 0) {
                // If not configured, default permits all
                return true;
            }

            const allowedNorm = allowed.map(t => String(t).toUpperCase());
            return allowedNorm.includes(rawCode) ||
                   allowedNorm.includes(norm) ||
                   allowedNorm.includes('ALL') ||
                   allowedNorm.includes('*') ||
                   (norm === 'CAT_FT_REG' && (allowedNorm.includes('FULL_TIME') || allowedNorm.includes('CAT_FT') || allowedNorm.includes('PERMANENT'))) ||
                   (norm === 'CAT_FT_EXEC' && (allowedNorm.includes('EXECUTIVE') || allowedNorm.includes('CAT_EXE') || allowedNorm.includes('FULL_TIME'))) ||
                   (norm === 'CAT_CON_TVC' && (allowedNorm.includes('CONTRACTOR') || allowedNorm.includes('CONTRACT') || allowedNorm.includes('CAT_CON'))) ||
                   (norm === 'CAT_INT_GRAD' && (allowedNorm.includes('INTERN') || allowedNorm.includes('CAT_INT') || allowedNorm.includes('APPRENTICE'))) ||
                   (norm === 'CAT_TEMP_OPS' && (allowedNorm.includes('TEMPORARY') || allowedNorm.includes('CAT_TEMP') || allowedNorm.includes('CASUAL'))) ||
                   (norm === 'CAT_PLANT_WKR' && (allowedNorm.includes('BLUE_COLLAR') || allowedNorm.includes('PLANT') || allowedNorm.includes('FULL_TIME')));
        });
    }

    /**
     * Validates whether a specific Business Unit permits the selected Employee Category
     */
    function validateBuForEmployeeType(categoryCode, buCode, buList) {
        if (!categoryCode || !buCode) {
            return { valid: true, error: null };
        }

        const permitted = filterBusinessUnitsForEmployeeType(categoryCode, buList || []);
        const isPermitted = permitted.some(b => (b.businessUnitCode || b.code || b.id) === buCode);

        if (!isPermitted) {
            const typeInfo = getEmployeeTypeDetails(categoryCode);
            return {
                valid: false,
                categoryCode: typeInfo.categoryCode,
                categoryName: typeInfo.categoryName,
                buCode,
                error: `Business Unit '${buCode}' does not permit Employee Type '${typeInfo.categoryName}'.`
            };
        }

        return { valid: true, error: null };
    }

    /**
     * Reactive UI Listener: auto-computes probation dates and triggers BU filtering
     * 
     * @param {Object} options
     * @param {HTMLSelectElement} options.empTypeSelect - Employee Category select element
     * @param {HTMLInputElement} options.joiningDateInput - Joining Date input element
     * @param {HTMLInputElement} options.probationEndDateInput - Target Probation End Date input element
     * @param {HTMLInputElement} options.noticePeriodInput - Target Notice Period Days input element
     * @param {HTMLSelectElement} options.buSelect - Business Unit select element
     * @param {HTMLElement|string} options.mismatchNoticeEl - Element or ID for mismatch warning
     */
    function bindEmployeeTypeTenureListener(options = {}) {
        if (typeof document === 'undefined') return { cleanup: () => {} };

        const {
            empTypeSelect,
            joiningDateInput,
            probationEndDateInput,
            noticePeriodInput,
            buSelect,
            mismatchNoticeEl
        } = options;

        const noticeContainer = typeof mismatchNoticeEl === 'string' 
            ? document.getElementById(mismatchNoticeEl) 
            : mismatchNoticeEl;

        function refreshTenureCalculations() {
            if (!empTypeSelect) return;
            const categoryCode = empTypeSelect.value;
            const details = getEmployeeTypeDetails(categoryCode);

            // Pre-fill Notice Period Days
            if (noticePeriodInput && details.noticePeriodDays !== undefined) {
                noticePeriodInput.value = details.noticePeriodDays;
            }

            // Dynamically calculate Probation End Date if Joining Date is selected
            if (joiningDateInput && joiningDateInput.value && probationEndDateInput) {
                const res = calculateProbationEndDate(joiningDateInput.value, details.probationDays);
                if (res.valid) {
                    probationEndDateInput.value = res.formattedDate;
                }
            }

            // Interlock with Business Unit selector if available
            if (buSelect) {
                validateAndFilterBuDropdown(categoryCode, buSelect, noticeContainer);
            }
        }

        function validateAndFilterBuDropdown(categoryCode, buEl, noticeEl) {
            if (!buEl) return;
            const currentBu = (buEl.value || '').trim();

            // Retrieve active business units from options, window.KylrxBuRules, or window.state
            let buList = [];
            if (Array.isArray(options.businessUnits) && options.businessUnits.length > 0) {
                buList = options.businessUnits;
            } else if (typeof window !== 'undefined' && window.KylrxBuRules && typeof window.KylrxBuRules.getAllRules === 'function') {
                buList = window.KylrxBuRules.getAllRules(false);
            } else if (typeof window !== 'undefined' && window.state && Array.isArray(window.state.businessUnits)) {
                buList = window.state.businessUnits;
            } else {
                buList = [
                    { businessUnitCode: 'BU_ENG', businessUnitName: 'Core Engineering & Technology', allowedEmployeeTypes: ['FULL_TIME', 'INTERN', 'CONTRACT', 'CONTRACTOR'], isActive: true },
                    { businessUnitCode: 'BU-TECH', businessUnitName: 'Technology & Product Engineering', allowedEmployeeTypes: ['FULL_TIME', 'INTERN', 'CONTRACT', 'CONTRACTOR'], isActive: true },
                    { businessUnitCode: 'BU-OPS', businessUnitName: 'Global Operations & Customer Success', allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT', 'CONTRACTOR'], isActive: true },
                    { businessUnitCode: 'BU-CORP', businessUnitName: 'Corporate Finance & HR', allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT', 'CONSULTANT'], isActive: true },
                    { businessUnitCode: 'BU_CORP_01', businessUnitName: 'Corporate Operations', allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT'], isActive: true },
                    { businessUnitCode: 'BU-EXEC', businessUnitName: 'Executive Leadership & Strategy', allowedEmployeeTypes: ['EXECUTIVE', 'FULL_TIME'], isActive: true },
                    { businessUnitCode: 'BU-SALES', businessUnitName: 'Enterprise Sales & Partnerships', allowedEmployeeTypes: ['FULL_TIME', 'CONTRACT'], isActive: true }
                ];
            }

            if (buList.length > 0) {
                const permitted = filterBusinessUnitsForEmployeeType(categoryCode, buList);
                const permittedCodes = new Set(permitted.map(b => (b.businessUnitCode || b.code || b.id || '').toUpperCase()));

                let optionCount = 0;
                Array.from(buEl.options).forEach(opt => {
                    if (!opt.value) return;
                    const isAllowed = permittedCodes.has(opt.value.toUpperCase());
                    opt.disabled = !isAllowed;
                    opt.style.display = isAllowed ? '' : 'none';
                    if (isAllowed) optionCount++;
                });

                // If current selection is invalid, reset or flag
                if (currentBu && !permittedCodes.has(currentBu.toUpperCase())) {
                    const typeInfo = getEmployeeTypeDetails(categoryCode);
                    if (noticeEl) {
                        noticeEl.style.display = 'block';
                        noticeEl.innerHTML = `⚠️ <strong>Policy Restriction:</strong> '${typeInfo.categoryName}' is not permitted in Business Unit '${currentBu}'. Please select an authorized Business Unit.`;
                    }
                    if (options.autoResetBu !== false) {
                        // Reset selection
                        buEl.value = '';
                    }
                } else {
                    if (noticeEl) {
                        noticeEl.style.display = 'none';
                        noticeEl.innerHTML = '';
                    }
                }
            }
        }

        const listeners = [];
        if (empTypeSelect) {
            const h = () => refreshTenureCalculations();
            empTypeSelect.addEventListener('change', h);
            listeners.push({ el: empTypeSelect, event: 'change', fn: h });
        }

        if (joiningDateInput) {
            const h = () => refreshTenureCalculations();
            joiningDateInput.addEventListener('change', h);
            joiningDateInput.addEventListener('input', h);
            listeners.push({ el: joiningDateInput, event: 'change', fn: h });
            listeners.push({ el: joiningDateInput, event: 'input', fn: h });
        }

        if (buSelect) {
            const h = () => {
                if (empTypeSelect) {
                    validateAndFilterBuDropdown(empTypeSelect.value, buSelect, noticeContainer);
                }
            };
            buSelect.addEventListener('change', h);
            listeners.push({ el: buSelect, event: 'change', fn: h });
        }

        // Run initial calculation once
        refreshTenureCalculations();

        return {
            refresh: refreshTenureCalculations,
            cleanup: () => {
                listeners.forEach(item => item.el.removeEventListener(item.event, item.fn));
            }
        };
    }

    /**
     * Populates an HTML select dropdown with active employee categories
     */
    function populateEmployeeTypeDropdown(selectEl, options = {}) {
        if (!selectEl) return;
        const currentVal = selectEl.value;
        const activeOnly = options.activeOnly !== false;
        const types = activeOnly ? _typesCache.filter(t => t.isActive) : _typesCache;

        const selectedCode = options.selectedCode || currentVal || 'CAT_FT_REG';
        const placeholder = options.placeholder ? `<option value="">${options.placeholder}</option>` : '';

        const optionsHtml = types.map(t => {
            const isSel = (t.categoryCode === selectedCode || normalizeCategoryCode(selectedCode) === t.categoryCode) ? 'selected' : '';
            return `<option value="${t.categoryCode}" ${isSel}>${t.categoryCode} - ${t.categoryName} (${t.employmentType})</option>`;
        }).join('');

        // Include legacy aliases for backwards compatibility
        const legacyHtml = `
            <option value="FULL_TIME" style="display:none;">FULL_TIME - Full-Time Regular</option>
            <option value="CONTRACTOR" style="display:none;">CONTRACTOR - Contractor / TVC</option>
            <option value="INTERN" style="display:none;">INTERN - Intern / Apprentice</option>
            <option value="CONSULTANT" style="display:none;">CONSULTANT - Consultant / Specialist</option>
            <option value="EXECUTIVE" style="display:none;">EXECUTIVE - Executive Leadership</option>
        `;

        selectEl.innerHTML = placeholder + optionsHtml + legacyHtml;
        if (selectedCode) {
            selectEl.value = selectedCode;
            if (!selectEl.value) {
                const norm = normalizeCategoryCode(selectedCode);
                if (norm) selectEl.value = norm;
            }
        }
    }

    function dispatchUpdateEvent() {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('employee-types-updated', {
                detail: { employeeTypes: [..._typesCache] }
            }));
        }
    }

    /**
     * Resolves Firebase Firestore db instance
     */
    function getFirestoreDb() {
        if (typeof window !== 'undefined' && window.db) {
            return window.db;
        }
        try {
            const firebase = require('../config/firebase');
            return firebase.db || (firebase.firestore ? firebase.firestore() : null);
        } catch (e) {}
        try {
            const firebase = require('./config/firebase');
            return firebase.db || (firebase.firestore ? firebase.firestore() : null);
        } catch (e) {}
        return null;
    }

    /**
     * Firestore CRUD: Create Employee Type
     */
    async function createEmployeeType(orgId, typeData) {
        const resolvedOrg = resolveOrgId(orgId);
        const code = String(typeData.categoryCode || typeData['Category_Code'] || '').trim().toUpperCase().replace(/\s+/g, '_');
        if (!code) throw new Error("Missing required 'categoryCode' attribute.");

        const docPayload = {
            categoryCode: code,
            categoryName: String(typeData.categoryName || typeData['Category_Name'] || code).trim(),
            employmentType: String(typeData.employmentType || typeData['Employment_Type'] || 'Permanent').trim(),
            workerType: String(typeData.workerType || typeData['Worker_Type'] || 'White Collar').trim(),
            probationDays: Number(typeData.probationDays !== undefined ? typeData.probationDays : (typeData['Probation_Days'] || 180)),
            noticePeriodDays: Number(typeData.noticePeriodDays !== undefined ? typeData.noticePeriodDays : (typeData['Notice_Period_Days'] || 60)),
            isActive: typeData.isActive !== undefined ? Boolean(typeData.isActive) : (typeData['Active'] !== 'No'),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        try {
            const fb = await import('./firebase-config.js').catch(() => null) || await import('../firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.setDoc) {
                const docRef = fb.doc(fb.db, 'organizations', resolvedOrg, 'employee_types', code);
                await fb.setDoc(docRef, {
                    ...docPayload,
                    createdAt: fb.serverTimestamp ? fb.serverTimestamp() : docPayload.createdAt,
                    updatedAt: fb.serverTimestamp ? fb.serverTimestamp() : docPayload.updatedAt
                }, { merge: true });
            } else {
                const dbInstance = getFirestoreDb();
                if (dbInstance) {
                    await dbInstance.collection('organizations').doc(resolvedOrg)
                        .collection('employee_types').doc(code).set(docPayload, { merge: true });
                }
            }
        } catch (err) {
            console.warn('[EmployeeTypeService] Firestore write fallback:', err.message);
        }

        // Update local memory cache
        const existingIdx = _typesCache.findIndex(t => t.categoryCode === code);
        if (existingIdx >= 0) {
            _typesCache[existingIdx] = docPayload;
        } else {
            _typesCache.push(docPayload);
        }

        dispatchUpdateEvent();
        return { success: true, categoryCode: code, data: docPayload };
    }

    /**
     * Firestore CRUD: Update Employee Type
     */
    async function updateEmployeeType(orgId, categoryCode, updateData) {
        const resolvedOrg = resolveOrgId(orgId);
        const code = String(categoryCode || '').trim().toUpperCase();
        if (!code) throw new Error("Missing 'categoryCode' for update.");

        const cleanUpdates = { ...updateData, updatedAt: new Date().toISOString() };
        delete cleanUpdates.categoryCode;
        delete cleanUpdates.createdAt;

        try {
            const fb = await import('./firebase-config.js').catch(() => null) || await import('../firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.updateDoc) {
                const docRef = fb.doc(fb.db, 'organizations', resolvedOrg, 'employee_types', code);
                await fb.updateDoc(docRef, {
                    ...cleanUpdates,
                    updatedAt: fb.serverTimestamp ? fb.serverTimestamp() : cleanUpdates.updatedAt
                });
            } else {
                const dbInstance = getFirestoreDb();
                if (dbInstance) {
                    await dbInstance.collection('organizations').doc(resolvedOrg)
                        .collection('employee_types').doc(code).update(cleanUpdates);
                }
            }
        } catch (err) {
            console.warn('[EmployeeTypeService] Firestore update fallback:', err.message);
        }

        const idx = _typesCache.findIndex(t => t.categoryCode === code);
        if (idx >= 0) {
            _typesCache[idx] = { ..._typesCache[idx], ...cleanUpdates };
        }

        dispatchUpdateEvent();
        return { success: true, categoryCode: code, updates: cleanUpdates };
    }

    /**
     * Firestore CRUD: Toggle Active Status
     */
    async function toggleEmployeeTypeStatus(orgId, categoryCode, isActive) {
        const flag = Boolean(isActive);
        return updateEmployeeType(orgId, categoryCode, { isActive: flag });
    }

    /**
     * Firestore CRUD: Delete Employee Type
     */
    async function deleteEmployeeType(orgId, categoryCode) {
        const resolvedOrg = resolveOrgId(orgId);
        const code = String(categoryCode || '').trim().toUpperCase();

        try {
            const fb = await import('./firebase-config.js').catch(() => null) || await import('../firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.deleteDoc) {
                const docRef = fb.doc(fb.db, 'organizations', resolvedOrg, 'employee_types', code);
                await fb.deleteDoc(docRef);
            } else {
                const dbInstance = getFirestoreDb();
                if (dbInstance) {
                    await dbInstance.collection('organizations').doc(resolvedOrg)
                        .collection('employee_types').doc(code).delete();
                }
            }
        } catch (err) {
            console.warn('[EmployeeTypeService] Firestore delete fallback:', err.message);
        }

        _typesCache = _typesCache.filter(t => t.categoryCode !== code);
        dispatchUpdateEvent();
        return { success: true, categoryCode: code, deleted: true };
    }

    /**
     * Firestore CRUD: Get Employee Type by Code
     */
    async function getEmployeeTypeByCode(orgId, categoryCode) {
        const resolvedOrg = resolveOrgId(orgId);
        const code = String(categoryCode || '').trim().toUpperCase();

        try {
            const fb = await import('./firebase-config.js').catch(() => null) || await import('../firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.doc && fb.getDoc) {
                const docRef = fb.doc(fb.db, 'organizations', resolvedOrg, 'employee_types', code);
                const snap = await fb.getDoc(docRef);
                if (snap.exists && snap.exists()) return snap.data();
            } else {
                const dbInstance = getFirestoreDb();
                if (dbInstance) {
                    const snap = await dbInstance.collection('organizations').doc(resolvedOrg)
                        .collection('employee_types').doc(code).get();
                    if (snap.exists) return snap.data();
                }
            }
        } catch (err) {
            console.warn('[EmployeeTypeService] Firestore get fallback to cache:', err.message);
        }

        return findTypeInCache(code) || null;
    }

    /**
     * Firestore CRUD: Get All Employee Types
     */
    async function getAllEmployeeTypes(orgId, activeOnly = false) {
        const resolvedOrg = resolveOrgId(orgId);

        try {
            const fb = await import('./firebase-config.js').catch(() => null) || await import('../firebase-config.js').catch(() => null) ||
                       (typeof window !== 'undefined' && window.KylrxFirebase) || null;

            if (fb && fb.db && fb.collection && fb.getDocs) {
                const colRef = fb.collection(fb.db, 'organizations', resolvedOrg, 'employee_types');
                const snap = await fb.getDocs(colRef);
                if (!snap.empty) {
                    const list = [];
                    snap.forEach(d => list.push(d.data()));
                    _typesCache = list;
                    return activeOnly ? list.filter(t => t.isActive) : list;
                }
            } else {
                const dbInstance = getFirestoreDb();
                if (dbInstance) {
                    let query = dbInstance.collection('organizations').doc(resolvedOrg).collection('employee_types');
                    if (activeOnly) query = query.where('isActive', '==', true);
                    const snap = await query.get();
                    if (!snap.empty) {
                        const list = [];
                        snap.forEach(d => list.push(d.data()));
                        _typesCache = list;
                        return list;
                    }
                }
            }
        } catch (err) {
            console.warn('[EmployeeTypeService] Firestore query fallback to cache:', err.message);
        }

        return activeOnly ? _typesCache.filter(t => t.isActive) : [..._typesCache];
    }

    /**
     * Bulk Ingestion: Import multiple Employee Type documents into Firestore
     */
    async function bulkImportEmployeeTypes(orgId, typeRecords) {
        const resolvedOrg = resolveOrgId(orgId);
        if (!Array.isArray(typeRecords) || typeRecords.length === 0) {
            return { success: false, importedCount: 0, errors: ['No records to import.'] };
        }

        const dbInstance = getFirestoreDb();
        const imported = [];
        const errors = [];

        for (let i = 0; i < typeRecords.length; i++) {
            const rec = typeRecords[i];
            const code = String(rec.categoryCode || rec['Category_Code'] || '').trim().toUpperCase().replace(/\s+/g, '_');
            if (!code) {
                errors.push(`Row ${i + 1}: Missing Category_Code.`);
                continue;
            }

            const docPayload = {
                categoryCode: code,
                categoryName: String(rec.categoryName || rec['Category_Name'] || code).trim(),
                employmentType: String(rec.employmentType || rec['Employment_Type'] || 'Permanent').trim(),
                workerType: String(rec.workerType || rec['Worker_Type'] || 'White Collar').trim(),
                probationDays: Number(rec.probationDays !== undefined ? rec.probationDays : (rec['Probation_Days'] || 180)),
                noticePeriodDays: Number(rec.noticePeriodDays !== undefined ? rec.noticePeriodDays : (rec['Notice_Period_Days'] || 60)),
                isActive: rec.isActive !== undefined ? Boolean(rec.isActive) : (rec['Active'] !== 'No'),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            if (dbInstance) {
                await dbInstance.collection('organizations').doc(resolvedOrg)
                    .collection('employee_types').doc(code).set(docPayload);
            }

            imported.push(docPayload);

            const existingIdx = _typesCache.findIndex(t => t.categoryCode === code);
            if (existingIdx >= 0) {
                _typesCache[existingIdx] = docPayload;
            } else {
                _typesCache.push(docPayload);
            }
        }

        return {
            success: errors.length === 0,
            importedCount: imported.length,
            errorCount: errors.length,
            errors,
            imported
        };
    }

    /**
     * Administrative UI: Open Employee Category Configuration Modal Drawer
     */
    function openEmployeeTypeModal(categoryCode = null) {
        if (typeof document === 'undefined') return;

        let drawer = document.getElementById('kylrxEmployeeTypeModalDrawer');
        if (!drawer) {
            drawer = document.createElement('div');
            drawer.id = 'kylrxEmployeeTypeModalDrawer';
            drawer.style.cssText = `
                position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5);
                backdrop-filter: blur(4px); z-index: 99999; display: flex;
                align-items: center; justify-content: center; padding: 1rem;
            `;
            document.body.appendChild(drawer);
        }

        const isEdit = Boolean(categoryCode);
        const existing = isEdit ? findTypeInCache(categoryCode) : null;

        drawer.innerHTML = `
            <div style="background: white; border-radius: 20px; width: 100%; max-width: 580px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); overflow: hidden; animation: fadeIn 0.2s ease-out;">
                <div style="background: #f8fafc; padding: 1.25rem 1.75rem; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 38px; height: 38px; border-radius: 10px; background: #e0e7ff; color: #4338ca; display: flex; align-items: center; justify-content: center; font-weight: 800;">
                            🏷️
                        </div>
                        <div>
                            <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #0f172a;">${isEdit ? 'Edit Employee Category' : 'Create Employee Category'}</h3>
                            <p style="margin: 0; font-size: 0.8rem; color: #64748b;">PRD §§ 1, 10, &amp; 13: Schema, Tenure Days &amp; BU Gating</p>
                        </div>
                    </div>
                    <button type="button" id="closeTypeModalBtn" style="background: none; border: none; font-size: 1.5rem; color: #94a3b8; cursor: pointer; padding: 4px;">&times;</button>
                </div>

                <form id="employeeTypeConfigForm" style="padding: 1.75rem;">
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div>
                            <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 6px; text-transform: uppercase;">Category Code *</label>
                            <input type="text" id="typeCodeInput" value="${existing ? existing.categoryCode : ''}" placeholder="e.g. CAT_FT_REG" ${isEdit ? 'readonly style="background:#f1f5f9; cursor:not-allowed;"' : ''} required style="width: 100%; padding: 10px 14px; border: 1.5px solid #cbd5e1; border-radius: 10px; font-size: 0.9rem;">
                        </div>
                        <div>
                            <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 6px; text-transform: uppercase;">Category Name *</label>
                            <input type="text" id="typeNameInput" value="${existing ? existing.categoryName : ''}" placeholder="e.g. Full-Time Regular" required style="width: 100%; padding: 10px 14px; border: 1.5px solid #cbd5e1; border-radius: 10px; font-size: 0.9rem;">
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                        <div>
                            <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 6px; text-transform: uppercase;">Employment Type *</label>
                            <select id="typeEmploymentSelect" required style="width: 100%; padding: 10px 14px; border: 1.5px solid #cbd5e1; border-radius: 10px; font-size: 0.9rem; background: white;">
                                <option value="Permanent" ${existing && existing.employmentType === 'Permanent' ? 'selected' : ''}>Permanent</option>
                                <option value="Contract" ${existing && existing.employmentType === 'Contract' ? 'selected' : ''}>Contract (TVC / Fixed-Term)</option>
                                <option value="Intern" ${existing && existing.employmentType === 'Intern' ? 'selected' : ''}>Intern / Apprentice</option>
                                <option value="Temporary" ${existing && existing.employmentType === 'Temporary' ? 'selected' : ''}>Temporary / Casual</option>
                                <option value="Consultant" ${existing && existing.employmentType === 'Consultant' ? 'selected' : ''}>Consultant / Specialist</option>
                            </select>
                        </div>
                        <div>
                            <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 6px; text-transform: uppercase;">Worker Type *</label>
                            <select id="typeWorkerSelect" required style="width: 100%; padding: 10px 14px; border: 1.5px solid #cbd5e1; border-radius: 10px; font-size: 0.9rem; background: white;">
                                <option value="White Collar" ${existing && existing.workerType === 'White Collar' ? 'selected' : ''}>White Collar (Corporate / Tech)</option>
                                <option value="Blue Collar" ${existing && existing.workerType === 'Blue Collar' ? 'selected' : ''}>Blue Collar (Plant / Operations)</option>
                                <option value="On-Roll" ${existing && existing.workerType === 'On-Roll' ? 'selected' : ''}>On-Roll (Direct)</option>
                                <option value="Off-Roll" ${existing && existing.workerType === 'Off-Roll' ? 'selected' : ''}>Off-Roll (Agency / Vendor)</option>
                            </select>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.25rem;">
                        <div>
                            <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 6px; text-transform: uppercase;">Probation Duration</label>
                            <div style="position: relative;">
                                <input type="number" id="typeProbationInput" value="${existing ? existing.probationDays : '180'}" min="0" max="365" required style="width: 100%; padding: 10px 14px; padding-right: 48px; border: 1.5px solid #cbd5e1; border-radius: 10px; font-size: 0.9rem;">
                                <span style="position: absolute; right: 12px; top: 10px; font-size: 0.8rem; color: #94a3b8; font-weight: 600;">days</span>
                            </div>
                        </div>
                        <div>
                            <label style="display: block; font-size: 0.75rem; font-weight: 700; color: #475569; margin-bottom: 6px; text-transform: uppercase;">Notice Period</label>
                            <div style="position: relative;">
                                <input type="number" id="typeNoticeInput" value="${existing ? existing.noticePeriodDays : '60'}" min="0" max="180" required style="width: 100%; padding: 10px 14px; padding-right: 48px; border: 1.5px solid #cbd5e1; border-radius: 10px; font-size: 0.9rem;">
                                <span style="position: absolute; right: 12px; top: 10px; font-size: 0.8rem; color: #94a3b8; font-weight: 600;">days</span>
                            </div>
                        </div>
                    </div>

                    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 16px; margin-bottom: 1.5rem; display: flex; align-items: center; justify-content: space-between;">
                        <div>
                            <div style="font-size: 0.88rem; font-weight: 700; color: #1e293b;">Active Operational Status</div>
                            <div style="font-size: 0.75rem; color: #64748b;">Controls visibility in onboarding forms and assignment dropdowns</div>
                        </div>
                        <label style="position: relative; display: inline-block; width: 44px; height: 24px; cursor: pointer;">
                            <input type="checkbox" id="typeActiveToggle" ${(!existing || existing.isActive) ? 'checked' : ''} style="opacity: 0; width: 0; height: 0;">
                            <span id="activeToggleSlider" style="position: absolute; inset: 0; background: ${(!existing || existing.isActive) ? '#10b981' : '#cbd5e1'}; border-radius: 24px; transition: .3s;"></span>
                            <span id="activeToggleDot" style="position: absolute; top: 2px; left: ${(!existing || existing.isActive) ? '22px' : '2px'}; width: 20px; height: 20px; background: white; border-radius: 50%; transition: .3s; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></span>
                        </label>
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px;">
                        <button type="button" id="cancelTypeModalBtn" style="padding: 10px 18px; border: 1px solid #cbd5e1; background: white; color: #475569; border-radius: 10px; font-weight: 600; cursor: pointer;">Cancel</button>
                        <button type="submit" style="padding: 10px 22px; border: none; background: #3b82f6; color: white; border-radius: 10px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 12px rgba(59,130,246,0.3);">${isEdit ? 'Save Changes' : 'Create Category'}</button>
                    </div>
                </form>
            </div>
        `;

        drawer.style.display = 'flex';

        // Toggle slider listener
        const toggle = document.getElementById('typeActiveToggle');
        const slider = document.getElementById('activeToggleSlider');
        const dot = document.getElementById('activeToggleDot');
        if (toggle && slider && dot) {
            toggle.addEventListener('change', () => {
                slider.style.background = toggle.checked ? '#10b981' : '#cbd5e1';
                dot.style.left = toggle.checked ? '22px' : '2px';
            });
        }

        const closeBtn = document.getElementById('closeTypeModalBtn');
        const cancelBtn = document.getElementById('cancelTypeModalBtn');
        const close = () => { drawer.style.display = 'none'; };
        if (closeBtn) closeBtn.onclick = close;
        if (cancelBtn) cancelBtn.onclick = close;

        const form = document.getElementById('employeeTypeConfigForm');
        if (form) {
            form.onsubmit = async (e) => {
                e.preventDefault();
                const code = document.getElementById('typeCodeInput').value.trim().toUpperCase().replace(/\s+/g, '_');
                const name = document.getElementById('typeNameInput').value.trim();
                const employmentType = document.getElementById('typeEmploymentSelect').value;
                const workerType = document.getElementById('typeWorkerSelect').value;
                const probationDays = Number(document.getElementById('typeProbationInput').value);
                const noticePeriodDays = Number(document.getElementById('typeNoticeInput').value);
                const isActive = document.getElementById('typeActiveToggle').checked;

                const payload = {
                    categoryCode: code,
                    categoryName: name,
                    employmentType,
                    workerType,
                    probationDays,
                    noticePeriodDays,
                    isActive
                };

                try {
                    if (isEdit) {
                        await updateEmployeeType(null, code, payload);
                    } else {
                        await createEmployeeType(null, payload);
                    }
                    close();
                    if (typeof window !== 'undefined' && window.renderEmployeeTypesConsole) {
                        window.renderEmployeeTypesConsole();
                    }
                } catch (err) {
                    alert('Error saving Employee Category: ' + err.message);
                }
            };
        }
    }

    /**
     * Administrative UI: Render Employee Types Management Console Table
     */
    function renderAdminConsole(containerId, options = {}) {
        if (typeof document === 'undefined') return;
        const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
        if (!container) return;

        const types = _typesCache;

        container.innerHTML = `
            <div style="background: white; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                <div style="padding: 1.25rem 1.5rem; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
                    <div>
                        <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #0f172a;">Employee Types &amp; Categories</h3>
                        <p style="margin: 4px 0 0; font-size: 0.8rem; color: #64748b;">PRD §§ 1, 10, &amp; 13: Configured Categories, Standard Tenure Days &amp; BU Interlocks</p>
                    </div>
                    <button type="button" id="btnAddEmployeeCategory" style="padding: 8px 16px; background: #3b82f6; color: white; border: none; border-radius: 10px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px; box-shadow: 0 4px 10px rgba(59,130,246,0.25);">
                        <span>+ Add Employee Category</span>
                    </button>
                </div>

                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
                        <thead>
                            <tr style="background: #f1f5f9; color: #475569; border-bottom: 1px solid #e2e8f0; font-weight: 800; text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.05em;">
                                <th style="padding: 12px 16px;">Category Code</th>
                                <th style="padding: 12px 16px;">Category Name</th>
                                <th style="padding: 12px 16px;">Employment Type</th>
                                <th style="padding: 12px 16px;">Worker Type</th>
                                <th style="padding: 12px 16px;">Probation Days</th>
                                <th style="padding: 12px 16px;">Notice Period</th>
                                <th style="padding: 12px 16px;">Status</th>
                                <th style="padding: 12px 16px; text-align: right;">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${types.map(t => `
                                <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
                                    <td style="padding: 12px 16px; font-weight: 700; color: #1e293b;">
                                        <code>${t.categoryCode}</code>
                                    </td>
                                    <td style="padding: 12px 16px; font-weight: 600; color: #334155;">
                                        ${t.categoryName}
                                    </td>
                                    <td style="padding: 12px 16px;">
                                        <span style="display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 0.76rem; font-weight: 700; background: #e0f2fe; color: #0369a1;">
                                            ${t.employmentType}
                                        </span>
                                    </td>
                                    <td style="padding: 12px 16px;">
                                        <span style="display: inline-block; padding: 4px 10px; border-radius: 6px; font-size: 0.76rem; font-weight: 700; background: ${t.workerType === 'White Collar' ? '#f3e8ff' : '#fef3c7'}; color: ${t.workerType === 'White Collar' ? '#7e22ce' : '#b45309'};">
                                            ${t.workerType}
                                        </span>
                                    </td>
                                    <td style="padding: 12px 16px; font-weight: 600; color: #475569;">
                                        ${t.probationDays} days
                                    </td>
                                    <td style="padding: 12px 16px; font-weight: 600; color: #475569;">
                                        ${t.noticePeriodDays} days
                                    </td>
                                    <td style="padding: 12px 16px;">
                                        <span style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 100px; font-size: 0.75rem; font-weight: 700; background: ${t.isActive ? '#dcfce7' : '#f1f5f9'}; color: ${t.isActive ? '#15803d' : '#64748b'};">
                                            <span style="width: 6px; height: 6px; border-radius: 50%; background: ${t.isActive ? '#16a34a' : '#94a3b8'};"></span>
                                            ${t.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td style="padding: 12px 16px; text-align: right;">
                                        <div style="display: inline-flex; gap: 8px;">
                                            <button type="button" class="btn-edit-type" data-code="${t.categoryCode}" style="padding: 4px 10px; border: 1px solid #cbd5e1; background: white; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; color: #1e293b;">Edit</button>
                                            <button type="button" class="btn-toggle-type" data-code="${t.categoryCode}" data-active="${t.isActive}" style="padding: 4px 10px; border: 1px solid ${t.isActive ? '#fecaca' : '#bbf7d0'}; background: ${t.isActive ? '#fef2f2' : '#f0fdf4'}; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; color: ${t.isActive ? '#991b1b' : '#166534'};">
                                                ${t.isActive ? 'Deactivate' : 'Activate'}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        const addBtn = document.getElementById('btnAddEmployeeCategory');
        if (addBtn) {
            addBtn.onclick = () => openEmployeeTypeModal(null);
        }

        container.querySelectorAll('.btn-edit-type').forEach(btn => {
            btn.onclick = () => openEmployeeTypeModal(btn.dataset.code);
        });

        container.querySelectorAll('.btn-toggle-type').forEach(btn => {
            btn.onclick = async () => {
                const code = btn.dataset.code;
                const current = btn.dataset.active === 'true';
                await toggleEmployeeTypeStatus(null, code, !current);
                renderAdminConsole(containerId, options);
            };
        });
    }

    return {
        DEFAULT_EMPLOYEE_TYPES,
        resolveOrgId,
        getFirestorePath,
        normalizeCategoryCode,
        calculateProbationEndDate,
        getEmployeeTypeDetails,
        filterBusinessUnitsForEmployeeType,
        validateBuForEmployeeType,
        bindEmployeeTypeTenureListener,
        populateEmployeeTypeDropdown,
        createEmployeeType,
        updateEmployeeType,
        toggleEmployeeTypeStatus,
        deleteEmployeeType,
        getEmployeeTypeByCode,
        getAllEmployeeTypes,
        bulkImportEmployeeTypes,
        openEmployeeTypeModal,
        renderAdminConsole
    };
}));
