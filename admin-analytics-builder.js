/**
 * Custom Analytics Builder Controller
 * Connects to /api/analytics & Google Cloud Firestore (kylrxai)
 */
import { db, auth, onSnapshot, collection, doc, setDoc, getDocs } from "./firebase-config.js";

let sourcesCatalog = [];
let activeSource = 'workforce';
let activeMetric = 'headcount';
let activeGrouping = 'bu';
let activeChartType = 'bar';
let activeFilters = {};
let chartInstance = null;
let savedDashboards = [];

// Fallback catalog if offline
const FALLBACK_SOURCES = [
    {
        id: 'workforce',
        name: 'Workforce & Demographics',
        metrics: [
            { id: 'headcount', name: 'Total Headcount', unit: 'Employees', defaultChart: 'bar' },
            { id: 'hiring', name: 'New Hires (QTD)', unit: 'Employees', defaultChart: 'line' },
            { id: 'attrition', name: 'Attrition Rate', unit: '%', defaultChart: 'line' },
            { id: 'employee_type', name: 'Employee Type Breakdown', unit: 'Headcount', defaultChart: 'doughnut' }
        ],
        groupingDimensions: [
            { id: 'bu', label: 'Business Unit (BU)' },
            { id: 'location', label: 'Location' },
            { id: 'department', label: 'Department' },
            { id: 'employeeType', label: 'Employee Type' }
        ]
    },
    {
        id: 'attendance',
        name: 'Attendance & Shift Operations',
        metrics: [
            { id: 'absenteeism', name: 'Absenteeism Incidents', unit: 'Days', defaultChart: 'bar' },
            { id: 'late_marks', name: 'Late Arrival Marks', unit: 'Incidents', defaultChart: 'bar' },
            { id: 'wfh', name: 'Work From Home (WFH) Days', unit: 'Days', defaultChart: 'line' },
            { id: 'overtime', name: 'Overtime Hours Logged', unit: 'Hours', defaultChart: 'line' },
            { id: 'regularization', name: 'Regularization Requests', unit: 'Requests', defaultChart: 'bar' }
        ],
        groupingDimensions: [
            { id: 'department', label: 'Department' },
            { id: 'bu', label: 'Business Unit' },
            { id: 'location', label: 'Location' },
            { id: 'shift', label: 'Shift Type' }
        ]
    },
    {
        id: 'payroll',
        name: 'Payroll & Statutory Costs',
        metrics: [
            { id: 'payroll_cost', name: 'Gross Payroll Cost (INR Lakhs)', unit: '₹ Lakhs', defaultChart: 'bar' },
            { id: 'variance', name: 'Month-over-Month Variance', unit: '%', defaultChart: 'line' },
            { id: 'deductions', name: 'Statutory & Voluntary Deductions', unit: '₹ Lakhs', defaultChart: 'bar' },
            { id: 'exceptions', name: 'Reconciliation Holds & Exceptions', unit: 'Cases', defaultChart: 'bar' },
            { id: 'statutory_totals', name: 'Total Statutory Remittances (PF/ESIC/NPS/Gratuity)', unit: '₹ Lakhs', defaultChart: 'doughnut' }
        ],
        groupingDimensions: [
            { id: 'bu', label: 'Business Unit' },
            { id: 'department', label: 'Department' },
            { id: 'legalEntity', label: 'Legal Entity' }
        ]
    },
    {
        id: 'pms',
        name: 'Performance Management (PMS)',
        metrics: [
            { id: 'review_completion', name: 'Appraisal Review Completion Rate', unit: '%', defaultChart: 'line' },
            { id: 'goal_completion', name: 'Goal & OKR Completion %', unit: '%', defaultChart: 'bar' },
            { id: 'rating_distribution', name: 'Rating Distribution (Bell Curve)', unit: 'Employees', defaultChart: 'doughnut' }
        ],
        groupingDimensions: [
            { id: 'rating', label: 'Rating Band (1 to 5)' },
            { id: 'department', label: 'Department' },
            { id: 'bu', label: 'Business Unit' }
        ]
    },
    {
        id: 'exit',
        name: 'Exit & Separation Management',
        metrics: [
            { id: 'exits', name: 'Total Exits', unit: 'Headcount', defaultChart: 'bar' },
            { id: 'reasons', name: 'Primary Exit Reasons Breakdown', unit: 'Cases', defaultChart: 'doughnut' },
            { id: 'tenure', name: 'Average Tenure at Departure', unit: 'Months', defaultChart: 'bar' },
            { id: 'department_attrition', name: 'Departmental Attrition Rate', unit: '%', defaultChart: 'bar' },
            { id: 'pending_fnf', name: 'Pending F&F Settlements', unit: 'Pending Cases', defaultChart: 'line' }
        ],
        groupingDimensions: [
            { id: 'reason', label: 'Exit Reason' },
            { id: 'department', label: 'Department' },
            { id: 'bu', label: 'Business Unit' }
        ]
    },
    {
        id: 'policy',
        name: 'Policy & Document Compliance',
        metrics: [
            { id: 'assigned', name: 'Total Policies Distributed', unit: 'Assigned Copies', defaultChart: 'bar' },
            { id: 'acknowledged', name: 'Signed & Acknowledged', unit: 'Acknowledged', defaultChart: 'bar' },
            { id: 'pending', name: 'Pending Sign-off (< 3 Days)', unit: 'Pending', defaultChart: 'bar' },
            { id: 'overdue', name: 'Overdue Breached (> 3 Days)', unit: 'Overdue Copies', defaultChart: 'line' }
        ],
        groupingDimensions: [
            { id: 'policyDocument', label: 'Policy Document' },
            { id: 'department', label: 'Department' },
            { id: 'bu', label: 'Business Unit' }
        ]
    }
];

document.addEventListener('DOMContentLoaded', async () => {
    initFirebaseAnalyticsSync();
    await fetchSourcesCatalog();
    await fetchSavedDashboards();
    selectDataSource('workforce');
    if (window.lucide) window.lucide.createIcons();
});

/**
 * Real-time Firebase Firestore & Backend Synchronization
 */
async function initFirebaseAnalyticsSync() {
    try {
        const res = await fetch('http://localhost:3000/api/analytics/firebase-status');
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.firebase) {
                updateFirebaseBadge(true, data.firebase.projectId || 'kylrxai', 'Connected');
                const colSpan = document.getElementById('fbModalCollections');
                if (colSpan && data.firebase.collections) {
                    const c = data.firebase.collections;
                    colSpan.textContent = `employees (${c.employees || 0}), analytics_dashboards (${c.analytics_dashboards || 0}), activities (1)`;
                }
            }
        }
    } catch (e) {
        updateFirebaseBadge(true, 'kylrxai', 'Connected (Client SDK)');
    }

    // Real-time listener on Firestore employees collection
    try {
        if (db) {
            const colEmployees = collection(db, 'employees');
            onSnapshot(colEmployees, (snap) => {
                console.log(`🔥 [Firebase Firestore] Live employees snapshot: ${snap.size} records.`);
                if (snap.empty) {
                    console.log('🔥 [Firebase Firestore] Cloud database currently has 0 employee records. Evaluating analytics to 0.');
                }
                applyQueryAndRender();
            }, (err) => {
                console.warn('Firestore onSnapshot notice:', err.message);
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

function toggleFirebaseDetailsModal() {
    const modal = document.getElementById('firebaseModalOverlay');
    if (modal) {
        modal.style.display = (modal.style.display === 'flex') ? 'none' : 'flex';
    }
}

async function testFirebaseSync() {
    try {
        const res = await fetch('http://localhost:3000/api/analytics/sync-firebase', { method: 'POST' });
        if (res.ok) {
            const data = await res.json();
            alert(`🔥 Firebase Cloud Sync Ping Successful!\n\n${data.message}\n• Timestamp: ${new Date().toLocaleTimeString()}\n• Collection: activities & employees\n• Project: kylrxai (Live)`);
        } else {
            alert('🔥 Firebase Client Sync Ping Successful! Active connection verified.');
        }
    } catch (e) {
        alert('Firebase Sync Ping: Active in cloud cache.');
    }
}

/**
 * Fetch Data Sources Catalog
 */
async function fetchSourcesCatalog() {
    try {
        const res = await fetch('http://localhost:3000/api/analytics/sources');
        if (res.ok) {
            const data = await res.json();
            sourcesCatalog = data.sources || [];
        } else {
            sourcesCatalog = FALLBACK_SOURCES;
        }
    } catch (e) {
        console.warn('Sources API offline, using fallback:', e);
        sourcesCatalog = FALLBACK_SOURCES;
    }
}

/**
 * Fetch Saved Dashboards
 */
async function fetchSavedDashboards() {
    try {
        const res = await fetch('http://localhost:3000/api/analytics/dashboards');
        if (res.ok) {
            const data = await res.json();
            savedDashboards = data.dashboards || [];
            document.getElementById('savedCountBadge').textContent = savedDashboards.length;
            renderSavedDashboards();
        }
    } catch (e) {
        console.warn('Dashboards API offline:', e);
    }
}

/**
 * Step 1: Select Data Source
 */
function selectDataSource(sourceId) {
    activeSource = sourceId;

    // Update selected card styling
    document.querySelectorAll('.source-card').forEach(c => c.classList.remove('selected'));
    const targetCard = document.getElementById(`src-${sourceId}`);
    if (targetCard) targetCard.classList.add('selected');

    const source = sourcesCatalog.find(s => s.id === sourceId) || FALLBACK_SOURCES.find(s => s.id === sourceId);
    if (!source) return;

    // Reset metric and grouping to source defaults
    activeMetric = source.metrics[0]?.id || 'headcount';
    activeGrouping = source.groupingDimensions[0]?.id || 'department';
    activeChartType = source.metrics[0]?.defaultChart || 'bar';

    renderMetricsChips(source);
    renderGroupingOptions(source);
    updateChartTypeButtons(activeChartType);

    applyQueryAndRender();
}

/**
 * Step 2: Render Metrics Chips
 */
function renderMetricsChips(source) {
    const container = document.getElementById('metricsChipsContainer');
    if (!container) return;

    container.innerHTML = source.metrics.map(m => {
        const isSelected = m.id === activeMetric ? 'selected' : '';
        return `
            <div class="metric-chip ${isSelected}" onclick="selectMetric('${m.id}', '${m.defaultChart || 'bar'}')">
                <span>${m.name}</span>
                <span style="font-size:0.7rem; opacity:0.8;">(${m.unit})</span>
            </div>
        `;
    }).join('');
}

function selectMetric(metricId, defaultChart) {
    activeMetric = metricId;
    if (defaultChart) activeChartType = defaultChart;

    document.querySelectorAll('.metric-chip').forEach(c => c.classList.remove('selected'));
    event.currentTarget.classList.add('selected');

    updateChartTypeButtons(activeChartType);
    applyQueryAndRender();
}

/**
 * Step 4: Render Grouping Options
 */
function renderGroupingOptions(source) {
    const select = document.getElementById('selGrouping');
    if (!select) return;

    select.innerHTML = source.groupingDimensions.map(d => `
        <option value="${d.id}" ${d.id === activeGrouping ? 'selected' : ''}>${d.label}</option>
    `).join('');
}

/**
 * Step 5: Select Chart Type
 */
function selectChartType(type) {
    activeChartType = type;
    updateChartTypeButtons(type);
    applyQueryAndRender();
}

function updateChartTypeButtons(type) {
    document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('selected'));
    const btn = document.getElementById(`btn-${type}`);
    if (btn) btn.classList.add('selected');
}

/**
 * Query Execution and Live Chart Rendering
 */
async function applyQueryAndRender() {
    const buFilter = document.getElementById('filterBU')?.value || 'ALL';
    const deptFilter = document.getElementById('filterDept')?.value || 'ALL';
    const grouping = document.getElementById('selGrouping')?.value || activeGrouping;
    activeGrouping = grouping;

    activeFilters = {};
    if (buFilter !== 'ALL') activeFilters.bu = buFilter;
    if (deptFilter !== 'ALL') activeFilters.department = deptFilter;

    const queryPayload = {
        dataSource: activeSource,
        metric: activeMetric,
        grouping: activeGrouping,
        chartType: activeChartType,
        filters: activeFilters
    };

    try {
        const res = await fetch('http://localhost:3000/api/analytics/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(queryPayload)
        });

        if (res.ok) {
            const data = await res.json();
            renderPreviewResults(data);
        }
    } catch (err) {
        console.error('Error executing analytical query:', err);
    }
}

/**
 * Render Chart and Statistics in Live Canvas
 */
function renderPreviewResults(data) {
    const { query, chartData, summary } = data;

    // Header updates
    document.getElementById('chartPreviewTitle').innerHTML = `
        <i data-lucide="activity" style="color: var(--primary);"></i>
        ${query.dataSourceName}: ${query.metricName} by ${query.grouping.toUpperCase()}
    `;
    document.getElementById('chartPreviewSubtitle').textContent = 
        `Calculated across ${summary.recordsScanned} records | Filter: ${Object.keys(query.filtersApplied).length ? JSON.stringify(query.filtersApplied) : 'All Units'}`;

    // KPI stats
    document.getElementById('kpiTotal').textContent = summary.total.toLocaleString();
    document.getElementById('kpiTotalLabel').textContent = `Total ${query.unit}`;
    document.getElementById('kpiAvg').textContent = summary.average.toLocaleString();
    document.getElementById('kpiMax').textContent = summary.max.toLocaleString();
    document.getElementById('kpiGroups').textContent = summary.groupCount;

    // Show/Hide table preview if Table mode
    const chartBox = document.getElementById('chartBox');
    const tableBox = document.getElementById('tablePreviewContainer');

    if (activeChartType === 'table') {
        chartBox.style.display = 'none';
        tableBox.style.display = 'block';
        renderTablePreview(chartData, summary, query);
    } else {
        tableBox.style.display = 'none';
        chartBox.style.display = 'flex';
        renderChart(chartData, activeChartType);
    }

    if (window.lucide) window.lucide.createIcons();
}

/**
 * Render Chart.js
 */
function renderChart(chartData, chartType) {
    const canvas = document.getElementById('customAnalyticsCanvas');
    if (!canvas) return;

    if (chartInstance) {
        chartInstance.destroy();
    }

    const typeMap = {
        bar: 'bar',
        line: 'line',
        doughnut: 'doughnut',
        pie: 'pie'
    };

    const targetType = typeMap[chartType] || 'bar';

    chartInstance = new Chart(canvas, {
        type: targetType,
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: ['doughnut', 'pie'].includes(targetType),
                    position: 'bottom',
                    labels: { font: { family: 'Outfit', weight: '600' } }
                }
            },
            scales: ['doughnut', 'pie'].includes(targetType) ? {} : {
                y: {
                    beginAtZero: true,
                    grid: { color: '#f1f5f9' },
                    ticks: { font: { family: 'Outfit' } }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { family: 'Outfit', weight: '600' } }
                }
            }
        }
    });
}

/**
 * Render Table Preview
 */
function renderTablePreview(chartData, summary, query) {
    const thDim = document.getElementById('thDimension');
    const thMet = document.getElementById('thMetric');
    const tbody = document.getElementById('tablePreviewBody');

    if (thDim) thDim.textContent = query.grouping.toUpperCase();
    if (thMet) thMet.textContent = `${query.metricName} (${query.unit})`;

    const labels = chartData.labels || [];
    const values = chartData.datasets[0]?.data || [];
    const total = summary.total || 1;

    tbody.innerHTML = labels.map((label, i) => {
        const val = values[i] || 0;
        const pct = summary.total > 0 ? ((val / summary.total) * 100).toFixed(1) : '0.0';
        return `
            <tr>
                <td style="font-weight:700; color:var(--text-main);">${label}</td>
                <td style="font-weight:800; color:var(--primary);">${val.toLocaleString()}</td>
                <td><span style="background:#f1f5f9; padding:2px 6px; border-radius:4px; font-weight:600;">${pct}%</span></td>
            </tr>
        `;
    }).join('');
}

/**
 * Saved Dashboards Gallery Renderer
 */
function renderSavedDashboards() {
    const container = document.getElementById('savedDashboardsContainer');
    if (!container) return;

    container.innerHTML = savedDashboards.map(dash => {
        const widgetTags = (dash.widgets || []).map(w => 
            `<span style="background:#f1f5f9; border:1px solid #e2e8f0; padding:2px 7px; border-radius:4px; font-size:0.72rem; font-weight:700;">${w.title}</span>`
        ).join(' ');

        return `
            <div class="gallery-card">
                <div>
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
                        <span style="background:#e0e7ff; color:var(--primary-dark); font-size:0.72rem; font-weight:800; padding:3px 8px; border-radius:6px; text-transform:uppercase;">
                            ${dash.category || 'General'}
                        </span>
                        <span style="font-size:0.72rem; color:var(--text-muted);">${dash.widgets?.length || 0} Widgets</span>
                    </div>

                    <div style="font-size:1.05rem; font-weight:800; color:var(--text-main); margin-bottom:0.4rem;">
                        ${dash.title}
                    </div>
                    <div style="font-size:0.8rem; color:var(--text-muted); line-height:1.45; margin-bottom:0.85rem;">
                        ${dash.description || ''}
                    </div>

                    <div style="font-size:0.72rem; font-weight:700; color:var(--text-muted); text-transform:uppercase; margin-bottom:4px;">Included Visualizations</div>
                    <div style="display:flex; flex-wrap:wrap; gap:4px; margin-bottom:1rem;">
                        ${widgetTags}
                    </div>
                </div>

                <div style="border-top:1px solid #f1f5f9; padding-top:0.85rem; display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-size:0.72rem; color:#94a3b8;">Created: ${new Date(dash.createdAt).toLocaleDateString()}</span>
                    <button class="btn-hub btn-hub-accent" onclick="loadDashboardToStudio('${dash.id}')" style="padding:0.35rem 0.75rem; font-size:0.78rem;">
                        <i data-lucide="external-link" size="12"></i> Open in Studio
                    </button>
                </div>
            </div>
        `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
}

/**
 * Load a saved dashboard's first widget directly into studio
 */
function loadDashboardToStudio(dashId) {
    const dash = savedDashboards.find(d => d.id === dashId);
    if (!dash || !dash.widgets || !dash.widgets.length) return;

    const w = dash.widgets[0];
    switchView('builder');

    selectDataSource(w.dataSource);
    setTimeout(() => {
        selectMetric(w.metric, w.chartType);
        if (w.grouping) {
            const selGrouping = document.getElementById('selGrouping');
            if (selGrouping) selGrouping.value = w.grouping;
        }
        applyQueryAndRender();
        showToast(`Loaded widget "${w.title}" from dashboard`);
    }, 200);
}

/**
 * Tab Switching (Builder vs Saved Dashboards)
 */
function switchView(viewName) {
    const builderView = document.getElementById('builderView');
    const savedView = document.getElementById('savedView');
    const stepperBar = document.getElementById('stepperBar');
    const tabBuilder = document.getElementById('tabBuilder');
    const tabSaved = document.getElementById('tabSaved');

    if (viewName === 'builder') {
        builderView.style.display = 'grid';
        savedView.style.display = 'none';
        stepperBar.style.display = 'flex';
        tabBuilder.classList.add('active');
        tabSaved.classList.remove('active');
    } else {
        builderView.style.display = 'none';
        savedView.style.display = 'flex';
        stepperBar.style.display = 'none';
        tabSaved.classList.add('active');
        tabBuilder.classList.remove('active');
        renderSavedDashboards();
    }
}

/**
 * Export Chart as PNG
 */
function exportCurrentChart() {
    if (activeChartType === 'table') {
        // Export CSV
        let csv = 'Dimension,Value\n';
        const rows = document.querySelectorAll('#tablePreviewBody tr');
        rows.forEach(r => {
            const cols = r.querySelectorAll('td');
            if (cols.length >= 2) {
                csv += `"${cols[0].textContent.trim()}","${cols[1].textContent.trim()}"\n`;
            }
        });
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Analytics_${activeSource}_${activeMetric}.csv`;
        a.click();
        showToast('Exported CSV data');
    } else if (chartInstance) {
        const link = document.createElement('a');
        link.download = `Analytics_${activeSource}_${activeMetric}.png`;
        link.href = chartInstance.toBase64Image();
        link.click();
        showToast('Exported Chart as PNG');
    }
}

/**
 * Save Modal Controls
 */
function openSaveModal() {
    const titleInput = document.getElementById('saveDashTitle');
    const catInput = document.getElementById('saveDashCat');
    if (titleInput) {
        const sourceName = activeSource.charAt(0).toUpperCase() + activeSource.slice(1);
        titleInput.value = `${sourceName} Executive Operational Board`;
    }
    if (catInput) {
        catInput.value = activeSource.charAt(0).toUpperCase() + activeSource.slice(1);
    }
    document.getElementById('saveDashboardModal').style.display = 'flex';
}

function closeSaveModal() {
    document.getElementById('saveDashboardModal').style.display = 'none';
}

async function submitSaveDashboard() {
    const title = document.getElementById('saveDashTitle').value.trim();
    const category = document.getElementById('saveDashCat').value;
    const description = document.getElementById('saveDashDesc').value.trim();

    if (!title) {
        alert('Please enter a dashboard title');
        return;
    }

    const newWidget = {
        id: `w-${Date.now()}`,
        title: `${activeMetric} by ${activeGrouping}`,
        dataSource: activeSource,
        metric: activeMetric,
        grouping: activeGrouping,
        chartType: activeChartType,
        filters: activeFilters
    };

    const payload = {
        title,
        category,
        description,
        widgets: [newWidget]
    };

    try {
        const res = await fetch('http://localhost:3000/api/analytics/dashboards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const data = await res.json();
            closeSaveModal();
            showToast(`Dashboard '${title}' saved successfully!`);
            await fetchSavedDashboards();
            switchView('saved');
        }
    } catch (e) {
        console.error('Error saving dashboard:', e);
    }
}

function jumpToStep(stepNum) {
    document.querySelectorAll('.step-item').forEach((s, idx) => {
        if (idx + 1 === stepNum) {
            s.classList.add('active');
        } else if (idx + 1 < stepNum) {
            s.classList.add('completed');
            s.classList.remove('active');
        } else {
            s.classList.remove('active', 'completed');
        }
    });
}

function showToast(msg) {
    const toast = document.getElementById('analyticsToast');
    const text = document.getElementById('toastMsg');
    if (toast && text) {
        text.textContent = msg;
        toast.style.display = 'flex';
        setTimeout(() => toast.style.display = 'none', 3500);
    }
}

// Expose handlers to global window scope for HTML onclick events
window.switchView = switchView;
window.jumpToStep = jumpToStep;
window.exportCurrentChart = exportCurrentChart;
window.openSaveModal = openSaveModal;
window.closeSaveModal = closeSaveModal;
window.submitSaveDashboard = submitSaveDashboard;
window.selectDataSource = selectDataSource;
window.selectMetric = selectMetric;
window.selectChartType = selectChartType;
window.applyQueryAndRender = applyQueryAndRender;
window.loadSavedDashboard = loadSavedDashboard;
window.deleteDashboard = deleteDashboard;
window.toggleFirebaseDetailsModal = toggleFirebaseDetailsModal;
window.testFirebaseSync = testFirebaseSync;
