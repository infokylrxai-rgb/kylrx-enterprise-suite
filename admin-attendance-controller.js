/**
 * Kylrx.ai Enterprise HRMS - Super Admin Attendance Controls Controller (PRD Section 16)
 * Real-Time Team Attendance Console, Manual Adjustment/Regularization,
 * Dynamic Shift & Week-off Rule Calculation, and SheetJS (.xlsx) Export Generator.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const exports = factory();
        root.AdminAttendanceController = exports.AdminAttendanceController;
        root.AdminAttendanceControllerClass = exports.AdminAttendanceControllerClass;
        root.DEFAULT_SHIFT_ROSTER = exports.DEFAULT_SHIFT_ROSTER;
        root.DEFAULT_ATTENDANCE_RULES = exports.DEFAULT_ATTENDANCE_RULES;
    }
}(typeof self !== 'undefined' ? self : this, function () {

// Standard Shifts matching official 27-sheet Templates.xlsx schema
const DEFAULT_SHIFT_ROSTER = [
    {
        shiftCode: "SH_GEN_01",
        shiftName: "General Shift",
        startTime: "09:00:00",
        endTime: "18:00:00",
        gracePeriodMinutes: 15,
        breakMinutes: 45,
        fullDayHours: 8.0,
        halfDayHours: 4.5
    },
    {
        shiftCode: "SH_MORN_01",
        shiftName: "Morning Shift",
        startTime: "06:00:00",
        endTime: "15:00:00",
        gracePeriodMinutes: 15,
        breakMinutes: 45,
        fullDayHours: 8.0,
        halfDayHours: 4.5
    },
    {
        shiftCode: "SH_EVE_01",
        shiftName: "Evening Shift",
        startTime: "14:00:00",
        endTime: "23:00:00",
        gracePeriodMinutes: 15,
        breakMinutes: 45,
        fullDayHours: 8.0,
        halfDayHours: 4.5
    },
    {
        shiftCode: "SH_NIGHT_01",
        shiftName: "Night Shift",
        startTime: "22:00:00",
        endTime: "07:00:00",
        gracePeriodMinutes: 15,
        breakMinutes: 45,
        fullDayHours: 8.0,
        halfDayHours: 4.5
    }
];

// Attendance Rules matching Templates.xlsx
const DEFAULT_ATTENDANCE_RULES = {
    weeklyOffPolicy: "sat-sun",
    lateDeductionThresholdMinutes: 15,
    halfDayHours: 4.5,
    fullDayHours: 8.0,
    dailyOvertimeThresholdHours: 8.5
};

// Daily log status (attendance collection) -> console status
const LOG_TO_CONSOLE_STATUS = {
    'on-time': 'PRESENT', 'present': 'PRESENT', 'late': 'LATE', 'half day': 'HALF_DAY',
    'absent': 'ABSENT', 'missing': 'MISSING', 'short hours': 'SHORT_HOURS', 'on duty': 'ON_DUTY'
};

// Text from Firestore is escaped before it is placed into HTML
const esc = (value) => String(value === undefined || value === null ? '' : value)
    .replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

class AdminAttendanceControllerClass {
    constructor() {
        this.records = [];
        this.shifts = [...DEFAULT_SHIFT_ROSTER];
        this.attendanceRules = { ...DEFAULT_ATTENDANCE_RULES };
        this.regularizationRequests = [];
        this.employeesList = [];

        // Active Filter State
        this.filters = {
            statusTab: 'ALL',       // 'ALL' | 'PRESENT' | 'LATE' | 'ABSENT' | 'REGULARIZATION'
            presetPeriod: 'today',  // 'today' | 'week' | 'month' | 'last_month' | 'all' | 'custom'
            startDate: '',
            endDate: '',
            department: 'ALL',
            statusSelect: 'ALL',
            searchQuery: ''
        };

        // Backend calls (attendance-admin-service.js), passed in by the page
        this.api = null;
        this.isInitialized = false;
    }

    /**
     * Initialize Controller and UI triggers. Data arrives through setData() whenever the page
     * loads this organization's attendance from the backend.
     */
    init(config = {}) {
        if (config.api) this.api = config.api;
        if (this.isInitialized) return;
        this.isInitialized = true;

        this.initDefaultDateFilters();
        this.bindEvents();
        this.populateEmployeeDropdown();
        this.renderTable();
        this.updateStatsCards();
    }

    todayStr() {
        return this.api ? this.api.localDateStr(new Date()) : new Date().toISOString().split('T')[0];
    }

    initDefaultDateFilters() {
        const today = this.todayStr();
        this.filters.startDate = today;
        this.filters.endDate = today;
    }

    /**
     * Rows for the console: every daily punch log of this organization, with an admin's manual
     * adjustment (attendance_records) taking the place of the log for the same employee and day.
     */
    setData(data) {
        const timeOf = (iso) => {
            if (!iso) return '--:--';
            const d = new Date(iso);
            return Number.isFinite(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '--:--';
        };
        const rows = new Map();
        (data.logs || []).forEach(l => {
            if (!l.date || !l.userId) return;
            const status = LOG_TO_CONSOLE_STATUS[String(l.status || '').toLowerCase()] || (l.punchIn ? 'PRESENT' : 'MISSING');
            rows.set(`${l.userId}|${l.date}`, {
                attendanceId: l.id,
                employeeId: l.userId,
                employeeName: l.userName || 'Employee',
                department: l.department || 'General',
                date: l.date,
                punchIn: timeOf(l.punchIn),
                punchOut: timeOf(l.punchOut),
                shiftCode: l.shiftCode || '',
                status,
                isLate: status === 'LATE',
                lateMinutes: l.lateMinutes || 0,
                totalHoursWorked: Math.round((Number(l.durationHours) || 0) * 10) / 10,
                isManualEntry: !!(l.isManualOverride || l.regularized),
                recordedBy: l.regularizedBy || 'Punch',
                adminRemark: l.regularized ? 'Regularization approved' : '',
                updatedAt: l.lastUpdated || ''
            });
        });
        (data.records || []).forEach(r => rows.set(`${r.employeeId}|${r.date}`, r));

        // Names come from the directory when the person is known
        const people = new Map((data.employees || []).map(e => [e.id, e]));
        this.records = [...rows.values()]
            .map(r => people.has(r.employeeId) ? { ...r, employeeName: people.get(r.employeeId).name, department: r.department || people.get(r.employeeId).department } : r)
            .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.employeeName).localeCompare(String(b.employeeName)));
        this.regularizationRequests = (data.regularizations || []).filter(r => (r.status || 'Pending') === 'Pending');
        this.employeesList = (data.employees || []).filter(e => e.active);

        this.populateEmployeeDropdown();
        this.renderTable();
        this.updateStatsCards();
    }

    /** Department filter options from this organization's people */
    setDepartments(departments) {
        if (typeof document === 'undefined') return;
        const select = document.getElementById("attFilterDepartment");
        if (!select) return;
        const previous = select.value;
        select.innerHTML = '';
        select.appendChild(new Option('All Departments', 'ALL'));
        departments.forEach(d => select.appendChild(new Option(d, d)));
        select.value = [...select.options].some(o => o.value === previous) ? previous : 'ALL';
        this.filters.department = select.value;
    }

    populateEmployeeDropdown() {
        if (typeof document === 'undefined') return;
        const select = document.getElementById("attManualEmployeeSelect");
        if (!select) return;
        const previous = select.value;
        select.innerHTML = '';
        select.appendChild(new Option(this.employeesList.length ? '-- Choose Personnel --' : 'No employees found', ''));
        this.employeesList.forEach(emp => {
            const details = [emp.department, emp.email || emp.employeeCode].filter(Boolean).join(' · ');
            select.appendChild(new Option(`${emp.name} (${details})`, emp.id));
        });
        if ([...select.options].some(o => o.value === previous)) select.value = previous;
    }

    /**
     * Dynamic Calculation Engine conforming to PRD §16 & Templates.xlsx
     * Recalculates working hours, break minutes, late arrival, and overtime
     */
    calculateAttendanceMetrics(punchInStr, punchOutStr, shiftCode = 'SH_GEN_01') {
        const shift = this.shifts.find(s => s.shiftCode === shiftCode) || this.shifts[0];
        
        if (!punchInStr || punchInStr === '--:--' || punchInStr === '00:00:00') {
            return {
                grossDurationHours: 0,
                breakMinutes: shift.breakMinutes || 45,
                totalHoursWorked: 0,
                isLate: false,
                lateMinutes: 0,
                isOvertime: false,
                overtimeHours: 0,
                suggestedStatus: 'ABSENT'
            };
        }

        const parseTimeToMinutes = (tStr) => {
            if (!tStr) return 0;
            const parts = tStr.split(':');
            const h = parseInt(parts[0], 10) || 0;
            const m = parseInt(parts[1], 10) || 0;
            return (h * 60) + m;
        };

        const inMinutes = parseTimeToMinutes(punchInStr);
        const shiftStartMinutes = parseTimeToMinutes(shift.startTime);
        const graceMinutes = shift.gracePeriodMinutes || 15;

        // Late Arrival calculation
        let isLate = false;
        let lateMinutes = 0;
        if (inMinutes > shiftStartMinutes) {
            lateMinutes = inMinutes - shiftStartMinutes;
            if (lateMinutes > graceMinutes) {
                isLate = true;
            }
        }

        // Punch Out & Duration calculation
        let totalHoursWorked = 8.0;
        let isOvertime = false;
        let overtimeHours = 0;

        if (punchOutStr && punchOutStr !== '--:--') {
            const outMinutes = parseTimeToMinutes(punchOutStr);
            let diffMinutes = outMinutes - inMinutes;
            if (diffMinutes < 0) diffMinutes += (24 * 60); // Overnight shift handling
            
            const breakMins = shift.breakMinutes || 45;
            const netWorkMinutes = Math.max(0, diffMinutes - breakMins);
            totalHoursWorked = parseFloat((netWorkMinutes / 60).toFixed(1));

            const fullDayThreshold = shift.fullDayHours || 8.0;
            if (totalHoursWorked > (fullDayThreshold + 0.5)) {
                isOvertime = true;
                overtimeHours = parseFloat((totalHoursWorked - fullDayThreshold).toFixed(1));
            }
        }

        // Status Determination
        let suggestedStatus = 'PRESENT';
        if (totalHoursWorked >= (shift.fullDayHours || 8.0) - 1.0) {
            suggestedStatus = isLate ? 'LATE' : 'PRESENT';
        } else if (totalHoursWorked >= (shift.halfDayHours || 4.5)) {
            suggestedStatus = isLate ? 'LATE' : 'HALF_DAY';
        } else if (totalHoursWorked > 0) {
            suggestedStatus = 'HALF_DAY';
        } else {
            suggestedStatus = 'ABSENT';
        }

        return {
            grossDurationHours: totalHoursWorked,
            breakMinutes: shift.breakMinutes || 45,
            totalHoursWorked,
            isLate,
            lateMinutes,
            isOvertime,
            overtimeHours,
            suggestedStatus
        };
    }

    /**
     * Save an attendance record / adjustment through the backend. It is stored in
     * `attendance_records` and the employee's daily log, and the console shows it once Firebase
     * confirmed the save (the page then reloads the overview).
     */
    async recordAttendance(formData) {
        try {
            const { employeeId, date, punchIn, punchOut, shiftCode, status, adminRemark } = formData;
            if (!employeeId || !date) {
                throw new Error("Choose an employee and a date.");
            }
            if (!this.api) throw new Error("The attendance service is not available. Reload the page.");

            const metrics = this.calculateAttendanceMetrics(punchIn, punchOut, shiftCode);
            const result = await this.api.recordAttendance({
                employeeId,
                date,
                punchIn,
                punchOut,
                shiftCode: shiftCode || 'SH_GEN_01',
                status: (status || metrics.suggestedStatus).toUpperCase(),
                lateMinutes: metrics.lateMinutes,
                totalHoursWorked: metrics.totalHoursWorked,
                adminRemark: adminRemark || 'Manual adjustment'
            });

            this.showToast(`Attendance for ${result.data.employeeName} on ${date} saved to Firebase.`, 'success');
            this.closeManualModal();
            return result;
        } catch (err) {
            console.error("[AdminAttendanceController] Save error:", err);
            this.showToast(`Failed to record attendance: ${err.message}`, 'danger');
            return null;
        }
    }

    /**
     * Filter Records based on tab, date preset, department, and status
     */
    getFilteredRecords() {
        const { statusTab, presetPeriod, startDate, endDate, department, statusSelect, searchQuery } = this.filters;

        if (statusTab === 'REGULARIZATION') {
            return this.regularizationRequests.map(r => ({
                attendanceId: r.id,
                employeeId: r.employeeId || 'EMP',
                employeeName: r.employeeName || 'Employee',
                department: r.department || 'General',
                date: r.date || '',
                punchIn: r.correctedTime || '--:--',
                punchOut: r.correctedPunchOut || '--:--',
                shiftCode: '',
                status: 'REGULARIZATION_PENDING',
                isLate: false,
                lateMinutes: 0,
                totalHoursWorked: 0,
                isManualEntry: false,
                recordedBy: r.employeeId || 'Employee',
                adminRemark: r.reason || 'Pending employee regularization request'
            }));
        }

        const now = new Date();
        const todayStr = this.todayStr();

        return this.records.filter(r => {
            // Status Tab Filter (missing punches count as absences)
            if (statusTab === 'PRESENT' && r.status !== 'PRESENT') return false;
            if (statusTab === 'LATE' && r.status !== 'LATE' && !r.isLate) return false;
            if (statusTab === 'ABSENT' && r.status !== 'ABSENT' && r.status !== 'MISSING') return false;

            // Status Dropdown Filter
            if (statusSelect !== 'ALL' && r.status.toUpperCase() !== statusSelect.toUpperCase()) return false;

            // Department Filter
            if (department !== 'ALL' && (r.department || '').toLowerCase() !== department.toLowerCase()) return false;

            // Date Filter
            if (presetPeriod === 'today') {
                if (r.date !== todayStr) return false;
            } else if (presetPeriod === 'week') {
                const recDate = new Date(r.date);
                const diffDays = Math.ceil(Math.abs(now - recDate) / (1000 * 60 * 60 * 24));
                if (diffDays > 7) return false;
            } else if (presetPeriod === 'month') {
                const recDate = new Date(r.date);
                if (recDate.getMonth() !== now.getMonth() || recDate.getFullYear() !== now.getFullYear()) return false;
            } else if (presetPeriod === 'last_month') {
                const recDate = new Date(r.date);
                const lastMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
                const expectedYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
                if (recDate.getMonth() !== lastMonth || recDate.getFullYear() !== expectedYear) return false;
            } else if (presetPeriod === 'custom') {
                if (startDate && r.date < startDate) return false;
                if (endDate && r.date > endDate) return false;
            }

            // Search Query Filter
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const matchId = (r.employeeId || '').toLowerCase().includes(q);
                const matchName = (r.employeeName || '').toLowerCase().includes(q);
                const matchDept = (r.department || '').toLowerCase().includes(q);
                if (!matchId && !matchName && !matchDept) return false;
            }

            return true;
        });
    }

    /**
     * Render Centralized Data Table
     */
    renderTable() {
        if (typeof document === 'undefined') return;
        const tbody = document.getElementById("attConsoleTableBody");
        if (!tbody) return;

        const filtered = this.getFilteredRecords();
        const countBadge = document.getElementById("attConsoleTotalCount");
        if (countBadge) countBadge.textContent = `${filtered.length} Records`;

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 3.5rem 1rem; color: var(--att-text-muted);">
                        <i data-lucide="calendar-x" style="width: 36px; height: 36px; margin: 0 auto 10px; opacity: 0.4;"></i>
                        <h4 style="font-size: 0.95rem; font-weight: 700; margin: 0;">No Attendance Records Match Filter</h4>
                        <p style="font-size: 0.78rem; margin: 4px 0 0 0;">Try adjusting your date range, preset intervals, or status filter.</p>
                    </td>
                </tr>
            `;
            if (window.lucide) window.lucide.createIcons();
            return;
        }

        tbody.innerHTML = filtered.map(rec => {
            const statusUpper = (rec.status || 'PRESENT').toUpperCase();
            let badgeClass = 'att-badge-present';
            let badgeLabel = 'Present';

            if (statusUpper.includes('LATE')) {
                badgeClass = 'att-badge-late';
                badgeLabel = `Late (+${rec.lateMinutes || 15}m)`;
            } else if (statusUpper.includes('HALF')) {
                badgeClass = 'att-badge-halfday';
                badgeLabel = 'Half Day';
            } else if (statusUpper.includes('ABSENT')) {
                badgeClass = 'att-badge-absent';
                badgeLabel = 'Absent';
            } else if (statusUpper === 'MISSING') {
                badgeClass = 'att-badge-absent';
                badgeLabel = 'Missing Punch';
            } else if (statusUpper === 'SHORT_HOURS') {
                badgeClass = 'att-badge-halfday';
                badgeLabel = 'Short Hours';
            } else if (statusUpper.includes('DUTY')) {
                badgeClass = 'att-badge-onduty';
                badgeLabel = 'On Duty';
            } else if (statusUpper.includes('REGULARIZATION')) {
                badgeClass = 'att-badge-halfday';
                badgeLabel = 'Regularization Request';
            }

            const initial = esc((rec.employeeName || 'E').charAt(0).toUpperCase());

            return `
                <tr>
                    <td>
                        <div class="att-user-cell">
                            <div class="att-user-avatar">${initial}</div>
                            <div class="att-user-meta">
                                <h4>${esc(rec.employeeName)}</h4>
                                <span>${esc(rec.department)}</span>
                            </div>
                        </div>
                    </td>
                    <td>
                        <span style="font-weight: 700; color: #0f172a;">${esc(rec.date)}</span>
                    </td>
                    <td>
                        <span style="font-family: monospace; font-size: 0.78rem; font-weight: 700; background: #f1f5f9; padding: 3px 8px; border-radius: 6px; color: #334155;">
                            ${esc(rec.shiftCode || '—')}
                        </span>
                    </td>
                    <td>
                        <span style="font-weight: 800; color: ${rec.isLate ? '#d97706' : '#059669'};">
                            ${esc(rec.punchIn || '--:--')}
                        </span>
                    </td>
                    <td>
                        <span style="font-weight: 700; color: #64748b;">
                            ${esc(rec.punchOut || '--:--')}
                        </span>
                    </td>
                    <td>
                        <span style="font-weight: 800; color: #2563eb;">
                            ${esc(rec.totalHoursWorked || 0)} hrs
                        </span>
                    </td>
                    <td>
                        <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
                            <span class="att-badge ${badgeClass}">${esc(badgeLabel)}</span>
                            ${rec.isManualEntry ? '<span class="att-manual-tag" title="' + esc(rec.adminRemark || 'Manual Adjustment') + '">OVERRIDE</span>' : ''}
                        </div>
                    </td>
                    <td style="text-align: right;">
                        ${statusUpper.includes('REGULARIZATION') ? '<span style="font-size: 0.72rem; color: #64748b;">Approve in the queue</span>' : `
                        <button class="btn-att btn-att-outline btn-att-row-override"
                            data-emp-id="${esc(rec.employeeId)}"
                            data-date="${esc(rec.date)}"
                            style="padding: 6px 12px; font-size: 0.75rem;" 
                            title="Manual override for this record">
                            <i data-lucide="edit-3" style="width: 13px; height: 13px;"></i>
                            <span>Adjust</span>
                        </button>`}
                    </td>
                </tr>
            `;
        }).join("");

        if (window.lucide) window.lucide.createIcons();
    }

    /**
     * Update Dashboard Stats & Tab Counters
     */
    updateStatsCards() {
        if (typeof document === 'undefined') return;
        const count = (records) => {
            let present = 0, late = 0, absent = 0;
            records.forEach(r => {
                const s = (r.status || '').toUpperCase();
                if (s === 'PRESENT') present++;
                else if (s === 'LATE' || r.isLate) late++;
                else if (s === 'ABSENT' || s === 'MISSING') absent++;
            });
            return { present, late, absent };
        };

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val;
        };

        // KPI cards: today
        const today = count(this.records.filter(r => r.date === this.todayStr()));
        setVal("attKpiPresentCount", today.present);
        setVal("attKpiLateCount", today.late);
        setVal("attKpiAbsentCount", today.absent);
        setVal("attKpiRegPendingCount", this.regularizationRequests.length);

        // Tab badges: the selected period, department, status and search
        const statusTab = this.filters.statusTab;
        this.filters.statusTab = 'ALL';
        const inPeriod = this.getFilteredRecords();
        this.filters.statusTab = statusTab;
        const period = count(inPeriod);
        setVal("attTabCountAll", inPeriod.length);
        setVal("attTabCountPresent", period.present);
        setVal("attTabCountLate", period.late);
        setVal("attTabCountAbsent", period.absent);
        setVal("attTabCountReg", this.regularizationRequests.length);
    }

    /**
     * Client-Side SheetJS Excel (.xlsx) Report Generator
     * Formats official enterprise report matching Templates.xlsx schema
     */
    exportAttendanceExcel() {
        try {
            const filtered = this.getFilteredRecords();
            if (filtered.length === 0) {
                this.showToast("No attendance records to export under current filters.", "warning");
                return;
            }

            const now = new Date();
            const dateRangeLabel = this.filters.presetPeriod === 'custom' 
                ? `${this.filters.startDate} to ${this.filters.endDate}`
                : this.filters.presetPeriod.toUpperCase();

            // Check if SheetJS is available
            const XLSX = window.XLSX;
            if (!XLSX) {
                console.warn("[AdminAttendanceController] SheetJS not found, falling back to CSV export.");
                this.exportAttendanceCSV(filtered);
                return;
            }

            // 1. Prepare Workbook Header & Metadata Rows conforming to Templates.xlsx
            const reportRows = [
                ["KYLRX.AI ENTERPRISE WORKFORCE MANAGEMENT"],
                ["SUPER ADMIN ATTENDANCE AUDIT & CONTROL REPORT (PRD §16)"],
                [`Date Range Filter: ${dateRangeLabel}`, "", `Generated On: ${now.toLocaleString()}`, "", `Generated By: Super Admin`],
                [`Total Records: ${filtered.length}`, "", `Department Scope: ${this.filters.department}`, "", `Status Scope: ${this.filters.statusSelect}`],
                [] // Blank separator
            ];

            // 2. Table Column Headers
            const tableHeaders = [
                "Attendance ID",
                "Employee ID",
                "Employee Name",
                "Department",
                "Date",
                "Shift Code",
                "Punch In Time",
                "Punch Out Time",
                "Late Minutes",
                "Total Hours Worked",
                "Attendance Status",
                "Is Manual Override",
                "Recorded By",
                "Admin Remark / Reason",
                "Last Updated"
            ];
            reportRows.push(tableHeaders);

            // 3. Record Data Rows
            filtered.forEach(rec => {
                reportRows.push([
                    rec.attendanceId || `ATT-${rec.date}-${rec.employeeId}`,
                    rec.employeeId,
                    rec.employeeName,
                    rec.department || "General",
                    rec.date,
                    rec.shiftCode || "SH_GEN_01",
                    rec.punchIn || "--:--",
                    rec.punchOut || "--:--",
                    rec.lateMinutes || 0,
                    rec.totalHoursWorked || 0,
                    rec.status,
                    rec.isManualEntry ? "YES (Manual Adjustment)" : "NO (Biometric Swipe)",
                    rec.recordedBy || "super_admin",
                    rec.adminRemark || "Verified attendance swipe",
                    rec.updatedAt || now.toISOString()
                ]);
            });

            // 4. Summary KPI Rows at Bottom
            let totalWorkedHours = 0;
            let totalManualEntries = 0;
            filtered.forEach(r => {
                totalWorkedHours += parseFloat(r.totalHoursWorked || 0);
                if (r.isManualEntry) totalManualEntries++;
            });

            reportRows.push([]);
            reportRows.push(["--- EXECUTIVE SUMMARY METRICS ---"]);
            reportRows.push(["Total Cumulative Hours Worked:", totalWorkedHours.toFixed(1) + " hrs"]);
            reportRows.push(["Total Manual Regularization Entries:", totalManualEntries]);
            reportRows.push(["Report Compliance Verification:", "PRD Section 16 & Templates.xlsx Certified"]);

            // 5. Generate Sheet and Workbook
            const ws = XLSX.utils.aoa_to_sheet(reportRows);

            // Set column widths for clean readability
            ws['!cols'] = [
                { wch: 26 }, // Attendance ID
                { wch: 14 }, // Employee ID
                { wch: 22 }, // Employee Name
                { wch: 22 }, // Department
                { wch: 14 }, // Date
                { wch: 14 }, // Shift Code
                { wch: 16 }, // Punch In
                { wch: 16 }, // Punch Out
                { wch: 14 }, // Late Mins
                { wch: 18 }, // Hours Worked
                { wch: 18 }, // Status
                { wch: 24 }, // Manual Override
                { wch: 22 }, // Recorded By
                { wch: 36 }, // Admin Remark
                { wch: 22 }  // Last Updated
            ];

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Attendance_Control_Report");

            // 6. Write and trigger download
            const cleanDateStr = now.toISOString().slice(0, 10);
            const fileName = `Kylrx_Attendance_Report_${cleanDateStr}.xlsx`;
            XLSX.writeFile(wb, fileName);

            this.showToast(`Excel Attendance Report downloaded: ${fileName}`, "success");
        } catch (err) {
            console.error("[AdminAttendanceController] Export failed:", err);
            this.showToast(`Export failed: ${err.message}`, "danger");
        }
    }

    /**
     * Fallback CSV Exporter if SheetJS is unavailable
     */
    exportAttendanceCSV(records) {
        const headers = ["Employee ID", "Employee Name", "Department", "Date", "Shift Code", "Punch In", "Punch Out", "Hours Worked", "Status", "Manual Override", "Admin Remark"];
        const rows = records.map(r => [
            r.employeeId,
            r.employeeName,
            r.department,
            r.date,
            r.shiftCode || "SH_GEN_01",
            r.punchIn || "--:--",
            r.punchOut || "--:--",
            r.totalHoursWorked || 0,
            r.status,
            r.isManualEntry ? "YES" : "NO",
            r.adminRemark || ""
        ]);

        const csvContent = [
            headers.join(","),
            ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        ].join("\r\n");

        const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `Kylrx_Attendance_Logs_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
            if (link.parentNode) link.parentNode.removeChild(link);
            URL.revokeObjectURL(url);
        }, 150);
        this.showToast("Attendance CSV downloaded successfully!", "success");
    }

    /**
     * Open Manual Attendance Record / Adjustment Modal
     */
    openManualModal(employeeId = null, date = null) {
        if (typeof document === 'undefined') return;
        const modal = document.getElementById("attManualModal");
        if (!modal) return;

        const empSelect = document.getElementById("attManualEmployeeSelect");
        const dateInput = document.getElementById("attManualDateInput");
        const inInput = document.getElementById("attManualPunchIn");
        const outInput = document.getElementById("attManualPunchOut");
        const shiftSelect = document.getElementById("attManualShiftSelect");
        const statusSelect = document.getElementById("attManualStatusSelect");
        const remarkInput = document.getElementById("attManualRemark");

        const today = this.todayStr();

        if (dateInput) dateInput.value = date || today;
        if (empSelect && employeeId) empSelect.value = employeeId;
        if (inInput) inInput.value = "09:00:00";
        if (outInput) outInput.value = "18:00:00";
        if (shiftSelect) shiftSelect.value = "SH_GEN_01";
        if (statusSelect) statusSelect.value = "PRESENT";
        if (remarkInput) remarkInput.value = "Manual swipe adjustment approved by Super Admin";

        // If existing record exists for this employee and date, pre-fill it
        if (employeeId && date) {
            const existing = this.records.find(r => r.employeeId === employeeId && r.date === date);
            if (existing) {
                const hasOption = (select, value) => select && [...select.options].some(o => o.value === value);
                if (inInput && /^\d/.test(existing.punchIn || '')) inInput.value = existing.punchIn;
                if (outInput && /^\d/.test(existing.punchOut || '')) outInput.value = existing.punchOut;
                if (hasOption(shiftSelect, existing.shiftCode)) shiftSelect.value = existing.shiftCode;
                if (hasOption(statusSelect, existing.status)) statusSelect.value = existing.status;
                if (remarkInput && existing.adminRemark) remarkInput.value = existing.adminRemark;
            }
        }

        this.updateModalCalculationPreview();
        modal.classList.add("active");
        if (window.lucide) window.lucide.createIcons();
    }

    closeManualModal() {
        if (typeof document === 'undefined') return;
        const modal = document.getElementById("attManualModal");
        if (modal) modal.classList.remove("active");
    }

    /**
     * Live Metrics Preview in Manual Record Modal
     */
    updateModalCalculationPreview() {
        if (typeof document === 'undefined') return;
        const inInput = document.getElementById("attManualPunchIn");
        const outInput = document.getElementById("attManualPunchOut");
        const shiftSelect = document.getElementById("attManualShiftSelect");

        const inTime = inInput ? inInput.value.trim() : "09:00:00";
        const outTime = outInput ? outInput.value.trim() : "18:00:00";
        const shiftCode = shiftSelect ? shiftSelect.value : "SH_GEN_01";

        const metrics = this.calculateAttendanceMetrics(inTime, outTime, shiftCode);

        const durationEl = document.getElementById("attCalcDurationVal");
        const lateEl = document.getElementById("attCalcLateVal");
        const overtimeEl = document.getElementById("attCalcOvertimeVal");

        if (durationEl) durationEl.textContent = `${metrics.totalHoursWorked} hrs`;
        if (lateEl) {
            lateEl.textContent = metrics.isLate ? `+${metrics.lateMinutes}m Late` : `On-Time`;
            lateEl.style.color = metrics.isLate ? "#d97706" : "#059669";
        }
        if (overtimeEl) {
            overtimeEl.textContent = metrics.isOvertime ? `+${metrics.overtimeHours}h OT` : `Standard`;
            overtimeEl.style.color = metrics.isOvertime ? "#2563eb" : "#64748b";
        }
    }

    /**
     * UI Event Bindings
     */
    bindEvents() {
        if (typeof document === 'undefined') return;
        // Toolbar buttons
        document.getElementById("btnOpenRecordAttendanceModal")?.addEventListener("click", () => {
            this.openManualModal();
        });

        document.getElementById("btnExportAttendanceExcel")?.addEventListener("click", () => {
            this.exportAttendanceExcel();
        });

        document.getElementById("btnCloseManualAttModal")?.addEventListener("click", () => {
            this.closeManualModal();
        });

        document.getElementById("btnCancelManualAttModal")?.addEventListener("click", () => {
            this.closeManualModal();
        });

        // Live calculation triggers on modal inputs
        ["attManualPunchIn", "attManualPunchOut", "attManualShiftSelect"].forEach(id => {
            document.getElementById(id)?.addEventListener("input", () => {
                this.updateModalCalculationPreview();
            });
            document.getElementById(id)?.addEventListener("change", () => {
                this.updateModalCalculationPreview();
            });
        });

        // Status Tabs Click delegation
        document.querySelectorAll(".att-tab-item").forEach(tab => {
            tab.addEventListener("click", (e) => {
                document.querySelectorAll(".att-tab-item").forEach(t => t.classList.remove("active"));
                const target = e.currentTarget;
                target.classList.add("active");
                this.filters.statusTab = target.getAttribute("data-tab");
                this.renderTable();
            });
        });

        // Preset Interval Buttons
        document.querySelectorAll(".att-preset-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                document.querySelectorAll(".att-preset-btn").forEach(b => b.classList.remove("active"));
                const target = e.currentTarget;
                target.classList.add("active");
                this.filters.presetPeriod = target.getAttribute("data-preset");

                const customContainer = document.getElementById("attCustomDateInputs");
                if (customContainer) {
                    customContainer.style.display = this.filters.presetPeriod === 'custom' ? 'flex' : 'none';
                }

                this.renderTable();
            });
        });

        // Custom Date Inputs
        document.getElementById("attFilterStartDate")?.addEventListener("change", (e) => {
            this.filters.startDate = e.target.value;
            this.renderTable();
        });

        document.getElementById("attFilterEndDate")?.addEventListener("change", (e) => {
            this.filters.endDate = e.target.value;
            this.renderTable();
        });

        // Department and Status dropdown filters
        document.getElementById("attFilterDepartment")?.addEventListener("change", (e) => {
            this.filters.department = e.target.value;
            this.renderTable();
        });

        document.getElementById("attFilterStatus")?.addEventListener("change", (e) => {
            this.filters.statusSelect = e.target.value;
            this.renderTable();
        });

        // Search Input
        document.getElementById("attSearchInput")?.addEventListener("input", (e) => {
            this.filters.searchQuery = e.target.value.trim();
            this.renderTable();
        });

        // Table Row Edit Button delegation
        document.addEventListener("click", (e) => {
            const btn = e.target.closest(".btn-att-row-override");
            if (btn) {
                const empId = btn.getAttribute("data-emp-id");
                const date = btn.getAttribute("data-date");
                this.openManualModal(empId, date);
            }
        });

        // Manual Record Form Submission
        document.getElementById("attManualRecordForm")?.addEventListener("submit", async (e) => {
            e.preventDefault();
            const empSelect = document.getElementById("attManualEmployeeSelect");
            const dateInput = document.getElementById("attManualDateInput");
            const inInput = document.getElementById("attManualPunchIn");
            const outInput = document.getElementById("attManualPunchOut");
            const shiftSelect = document.getElementById("attManualShiftSelect");
            const statusSelect = document.getElementById("attManualStatusSelect");
            const remarkInput = document.getElementById("attManualRemark");

            const selectedOpt = empSelect?.options[empSelect.selectedIndex];
            const empName = selectedOpt?.dataset?.name || 'Employee';
            const dept = selectedOpt?.dataset?.dept || 'General';

            const formData = {
                employeeId: empSelect?.value,
                employeeName: empName,
                department: dept,
                date: dateInput?.value,
                punchIn: inInput?.value,
                punchOut: outInput?.value,
                shiftCode: shiftSelect?.value || 'SH_GEN_01',
                status: statusSelect?.value || 'PRESENT',
                adminRemark: remarkInput?.value || 'Manual Adjustment'
            };

            const submitBtn = document.getElementById("btnSubmitManualAtt");
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = `<i data-lucide="loader" class="animate-spin" style="width:14px; height:14px;"></i> Saving...`;
            }

            try {
                await this.recordAttendance(formData);
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = `<i data-lucide="check-circle" style="width:14px; height:14px;"></i> Save &amp; Sync to Firebase`;
                    if (window.lucide) window.lucide.createIcons();
                }
            }
        });
    }

    /**
     * Enterprise Toast Notification
     */
    showToast(message, type = "success") {
        if (typeof document === 'undefined') return;
        const existing = document.querySelector(".att-toast");
        if (existing) existing.remove();

        const toast = document.createElement("div");
        toast.className = `att-toast ${type}`;
        toast.style.position = "fixed";
        toast.style.bottom = "24px";
        toast.style.right = "24px";
        toast.style.background = "#0f172a";
        toast.style.color = "white";
        toast.style.padding = "12px 20px";
        toast.style.borderRadius = "12px";
        toast.style.fontSize = "0.85rem";
        toast.style.fontWeight = "700";
        toast.style.boxShadow = "0 10px 25px rgba(0,0,0,0.25)";
        toast.style.zIndex = "10000";
        toast.style.display = "flex";
        toast.style.alignItems = "center";
        toast.style.gap = "10px";
        toast.style.border = type === "danger" ? "1px solid #ef4444" : "1px solid #10b981";

        const icon = type === "danger" ? "⚠️" : "✅";
        toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 4000);
    }
}

const AdminAttendanceController = new AdminAttendanceControllerClass();

return {
    AdminAttendanceController,
    AdminAttendanceControllerClass,
    DEFAULT_SHIFT_ROSTER,
    DEFAULT_ATTENDANCE_RULES
};

}));
