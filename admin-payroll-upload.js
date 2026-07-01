import { auth, db } from "./firebase-config.js";
import { 
    collection, 
    getDocs, 
    setDoc, 
    doc, 
    addDoc,
    updateDoc, // Added to fix pre-existing firestore reference bug
    query, 
    where, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// Standard Schema & Synonyms Rules
const STANDARD_COLUMNS = [
    { name: "Employee ID", required: true },
    { name: "Employee Name", required: true },
    { name: "Salary (Base)", required: true },
    { name: "Incentives", required: false, default: 0 },
    { name: "PF Contribution", required: false, default: 0 },
    { name: "ESIC", required: false, default: 0 },
    { name: "Gratuity Provision", required: false, default: 0 },
    { name: "ESOPs Grant", required: false, default: "None" },
    { name: "Variable Pay %", required: false, default: 0 },
    { name: "Tax Deductions", required: false, default: 0 },
    { name: "Bonus Structure", required: false, default: "Standard" },
    { name: "Shift Allowance", required: false, default: 0 }
];

// Finance Importer State
let state = {
    records: [],
    validCount: 0,
    totalCtc: 0,
    isProcessing: false,
    excelHeaders: [],
    excelRows: [],
    mapping: {} // Key: Standard Field, Value: Excel Column Name (or empty)
};

// UI Selectors
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const payrollBody = document.getElementById('payrollBody');
const resultsTable = document.getElementById('resultsTable');
const btnFinalize = document.getElementById('btnFinalize');
const btnDownload = document.getElementById('btnDownloadTemplate');

// Stats
const statCount = document.getElementById('statCount');
const statCtc = document.getElementById('statCtc');
const statStatus = document.getElementById('statStatus');

// Initialize
setupEvents();

function setupEvents() {
    dropZone.onclick = () => fileInput.click();
    fileInput.onchange = (e) => handleFile(e.target.files[0]);
    
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; };
    dropZone.ondragleave = () => dropZone.style.borderColor = 'var(--glass-border)';
    dropZone.ondrop = (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); };

    btnDownload.onclick = downloadTemplate;
    btnFinalize.onclick = finalizePayroll;

    // Hook up verification actions
    document.getElementById('btnCancelVerification').onclick = resetImporter;
    document.getElementById('btnConfirmVerification').onclick = confirmAndParse;
}

function downloadTemplate() {
    const headers = STANDARD_COLUMNS.map(c => c.name);
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PayrollTemplate");
    XLSX.writeFile(wb, "HRFlow_Payroll_Initialization_Template.xlsx");
}

function cleanString(str) {
    if (str === undefined || str === null) return "";
    return str.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getFuzzyMatch(stdName, excelHeaders) {
    const cleanStd = cleanString(stdName);
    
    // 1. Exact cleaned match
    for (let hdr of excelHeaders) {
        if (cleanString(hdr) === cleanStd) {
            return hdr;
        }
    }
    
    // 2. Contains match
    for (let hdr of excelHeaders) {
        const cleanHdr = cleanString(hdr);
        if (cleanHdr.includes(cleanStd) || cleanStd.includes(cleanHdr)) {
            return hdr;
        }
    }
    
    // 3. Synonym mapping
    const synonyms = {
        "Employee ID": ["empid", "employeeid", "id", "empno", "employeeno"],
        "Employee Name": ["empname", "employeename", "name", "fullname", "full name"],
        "Salary (Base)": ["salary", "base", "basesalary", "basic", "basicsalary", "base salary", "basic salary"],
        "Incentives": ["incentive", "incentives"],
        "PF Contribution": ["pf", "providentfund", "provident fund", "pf contribution"],
        "ESIC": ["esic", "esi", "esicontribution"],
        "Gratuity Provision": ["gratuity", "gratuityprovision"],
        "ESOPs Grant": ["esop", "esops", "esopsgrant", "equity"],
        "Variable Pay %": ["variable", "variablepay", "variable pay", "variable %"],
        "Tax Deductions": ["tax", "taxdeduction", "tax deductions", "taxes"],
        "Bonus Structure": ["bonus", "bonusstructure", "bonus structure"],
        "Shift Allowance": ["shift", "shiftallowance", "shift allowance"]
    };
    
    const list = synonyms[stdName] || [];
    for (let syn of list) {
        for (let hdr of excelHeaders) {
            if (cleanString(hdr) === cleanString(syn)) {
                return hdr;
            }
        }
    }
    
    return null;
}

function getSheetHeaders(sheet) {
    const headers = [];
    const range = XLSX.utils.decode_range(sheet['!ref']);
    if (!range) return [];
    
    const r = range.s.r; // start row
    for (let c = range.s.c; c <= range.e.c; ++c) {
        const cell = sheet[XLSX.utils.encode_cell({ r: r, c: c })];
        if (cell) {
            let val = "";
            if (cell.t) {
                val = XLSX.utils.format_cell(cell);
            } else if (cell.v !== undefined) {
                val = cell.v.toString();
            }
            if (val) {
                headers.push(val.trim());
            } else {
                headers.push(`Column_${c + 1}`);
            }
        } else {
            headers.push(`Column_${c + 1}`);
        }
    }
    return headers;
}

async function handleFile(file) {
    if (!file || state.isProcessing) return;
    state.isProcessing = true;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            
            // Extract raw data rows
            const json = XLSX.utils.sheet_to_json(sheet);
            if (json.length === 0) {
                alert("The uploaded spreadsheet contains no data records!");
                state.isProcessing = false;
                return;
            }
            
            // Extract and clean Excel column headers
            const excelHeaders = getSheetHeaders(sheet);
            if (excelHeaders.length === 0) {
                alert("Could not identify any valid column headers in the uploaded file!");
                state.isProcessing = false;
                return;
            }
            
            state.excelHeaders = excelHeaders;
            state.excelRows = json;
            
            // Perform automatic schema mapping with fuzzy detection
            state.mapping = {};
            for (const stdCol of STANDARD_COLUMNS) {
                const autoMatch = getFuzzyMatch(stdCol.name, excelHeaders);
                state.mapping[stdCol.name] = autoMatch || "";
            }
            
            // Show verification step
            dropZone.style.display = 'none';
            document.getElementById('verificationLayer').style.display = 'block';
            
            renderSchemaMapping();
        } catch (err) {
            console.error("Error processing file:", err);
            alert("An error occurred while reading the file. Please ensure it is a valid Excel or CSV sheet.");
        } finally {
            state.isProcessing = false;
        }
    };
    reader.readAsArrayBuffer(file);
}

function validateColumnMapping() {
    const missingRequired = [];
    const missingOptional = [];
    const autoMapped = [];
    const exactMapped = [];
    const manuallyMapped = [];
    const duplicateMappings = new Set();
    const mappedValues = [];

    // Track duplicates
    for (const stdCol of STANDARD_COLUMNS) {
        const mappedVal = state.mapping[stdCol.name];
        if (mappedVal) {
            if (mappedValues.includes(mappedVal)) {
                duplicateMappings.add(mappedVal);
            }
            mappedValues.push(mappedVal);
        }
    }

    for (const stdCol of STANDARD_COLUMNS) {
        const mappedVal = state.mapping[stdCol.name];
        if (!mappedVal) {
            if (stdCol.required) {
                missingRequired.push(stdCol.name);
            } else {
                missingOptional.push(stdCol.name);
            }
        } else {
            if (mappedVal === stdCol.name) {
                exactMapped.push(stdCol.name);
            } else {
                const auto = getFuzzyMatch(stdCol.name, state.excelHeaders);
                if (mappedVal === auto) {
                    autoMapped.push(stdCol.name);
                } else {
                    manuallyMapped.push(stdCol.name);
                }
            }
        }
    }

    return {
        missingRequired,
        missingOptional,
        exactMapped,
        autoMapped,
        manuallyMapped,
        duplicateMappings: Array.from(duplicateMappings)
    };
}

function renderSchemaMapping() {
    const mappingGrid = document.getElementById('schemaMappingGrid');
    const healthBadge = document.getElementById('healthBadge');
    const globalAlert = document.getElementById('globalAnomalyAlert');
    const alertDesc = document.getElementById('anomalyAlertDesc');
    const alertTitle = document.getElementById('anomalyAlertTitle');
    const alertIcon = document.getElementById('anomalyAlertIcon');
    const btnConfirm = document.getElementById('btnConfirmVerification');

    const check = validateColumnMapping();
    
    // 1. Render Health Badge & Global Alert
    if (check.missingRequired.length > 0) {
        healthBadge.className = "health-badge health-danger";
        healthBadge.innerHTML = `<i data-lucide="x-circle"></i> <span>Schema Invalid</span>`;
        
        globalAlert.style.display = "flex";
        globalAlert.className = "anomaly-alert danger";
        alertTitle.innerText = "Critical Schema Error";
        alertDesc.innerHTML = `Your sheet is missing required columns: <strong>${check.missingRequired.join(', ')}</strong>. Please map them below or upload a compliant sheet to proceed.`;
        alertIcon.innerHTML = `<i data-lucide="alert-octagon" style="color: #ef4444;"></i>`;
        btnConfirm.disabled = true;
    } else if (check.duplicateMappings.length > 0) {
        healthBadge.className = "health-badge health-danger";
        healthBadge.innerHTML = `<i data-lucide="x-circle"></i> <span>Duplicate Mapping</span>`;
        
        globalAlert.style.display = "flex";
        globalAlert.className = "anomaly-alert danger";
        alertTitle.innerText = "Mapping Conflict";
        alertDesc.innerHTML = `Multiple fields are mapped to the same Excel column: <strong>${check.duplicateMappings.join(', ')}</strong>. Each column must be mapped uniquely.`;
        alertIcon.innerHTML = `<i data-lucide="alert-triangle" style="color: #ef4444;"></i>`;
        btnConfirm.disabled = true;
    } else if (check.missingOptional.length > 0 || check.autoMapped.length > 0) {
        healthBadge.className = "health-badge health-warning";
        healthBadge.innerHTML = `<i data-lucide="alert-triangle"></i> <span>Schema Warnings</span>`;
        
        globalAlert.style.display = "flex";
        globalAlert.className = "anomaly-alert";
        alertTitle.innerText = "Optimization Suggestions";
        
        let descParts = [];
        if (check.autoMapped.length > 0) {
            descParts.push(`Auto-mapped <strong>${check.autoMapped.length}</strong> fields by name similarity (e.g., ${check.autoMapped.slice(0, 3).join(', ')}).`);
        }
        if (check.missingOptional.length > 0) {
            descParts.push(`Missing <strong>${check.missingOptional.length}</strong> optional fields. These will fall back to their system defaults (e.g., 0, 'Standard', 'None').`);
        }
        alertDesc.innerHTML = descParts.join(' ');
        alertIcon.innerHTML = `<i data-lucide="sparkles" style="color: #f59e0b;"></i>`;
        btnConfirm.disabled = false;
    } else {
        healthBadge.className = "health-badge health-success";
        healthBadge.innerHTML = `<i data-lucide="check-circle-2"></i> <span>Schema Perfect</span>`;
        
        globalAlert.style.display = "flex";
        globalAlert.className = "anomaly-alert success";
        alertTitle.innerText = "Column Verification Perfect";
        alertDesc.innerText = "All required and optional columns have been successfully verified and matched exactly.";
        alertIcon.innerHTML = `<i data-lucide="shield-check" style="color: #10b981;"></i>`;
        btnConfirm.disabled = false;
    }

    // 2. Render Cards
    mappingGrid.innerHTML = STANDARD_COLUMNS.map(stdCol => {
        const mappedVal = state.mapping[stdCol.name] || "";
        const isRequired = stdCol.required;
        
        let cardClass = "schema-card";
        let statusText = "";
        let statusClass = "";
        let iconName = "";

        if (isRequired && !mappedVal) {
            cardClass += " danger";
            statusText = "Action Required: Missing Required Field";
            statusClass = "status-danger";
            iconName = "alert-octagon";
        } else if (!isRequired && !mappedVal) {
            cardClass += " warning";
            statusText = `Optional: Will default to '${stdCol.default}'`;
            statusClass = "status-warning";
            iconName = "help-circle";
        } else if (mappedVal === stdCol.name) {
            cardClass += " success";
            statusText = "Exact Match";
            statusClass = "status-success";
            iconName = "check-circle-2";
        } else {
            const auto = getFuzzyMatch(stdCol.name, state.excelHeaders);
            if (mappedVal === auto) {
                cardClass += " success";
                statusText = `Fuzzy Match (from '${mappedVal}')`;
                statusClass = "status-fuzzy";
                iconName = "sparkles";
            } else {
                cardClass += " success";
                statusText = `Manually Mapped to '${mappedVal}'`;
                statusClass = "status-fuzzy";
                iconName = "user-check";
            }
        }

        const optionsHtml = [
            `<option value="">-- Leave Empty (Default) --</option>`,
            ...state.excelHeaders.map(hdr => {
                const isSelected = hdr === mappedVal ? "selected" : "";
                return `<option value="${hdr}" ${isSelected}>${hdr}</option>`;
            })
        ].join('');

        return `
            <div class="${cardClass}">
                <div class="schema-info">
                    <span class="schema-name">${stdCol.name}</span>
                    <span class="schema-req ${isRequired ? 'req-badge' : 'opt-badge'}">
                        ${isRequired ? 'Required' : 'Optional'}
                    </span>
                </div>
                <div class="schema-select-wrapper">
                    <select class="schema-select" data-column="${stdCol.name}">
                        ${optionsHtml}
                    </select>
                </div>
                <div class="schema-status-text ${statusClass}">
                    <i data-lucide="${iconName}" style="width: 14px; height: 14px;"></i>
                    <span>${statusText}</span>
                </div>
            </div>
        `;
    }).join('');

    // Re-create lucide icons in verification container
    if (window.lucide) {
        lucide.createIcons();
    }

    // Attach event listeners to selects
    document.querySelectorAll('.schema-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const stdName = e.target.getAttribute('data-column');
            const selectedVal = e.target.value;
            state.mapping[stdName] = selectedVal;
            renderSchemaMapping(); // re-render to update badge/anomalies
        });
    });
}

function confirmAndParse() {
    // 1. Normalize rows based on confirmed column mapping
    const normalizedRows = state.excelRows.map(row => {
        const normalized = {};
        for (const stdCol of STANDARD_COLUMNS) {
            const excelKey = state.mapping[stdCol.name];
            if (excelKey && row[excelKey] !== undefined) {
                normalized[stdCol.name] = row[excelKey];
            } else {
                normalized[stdCol.name] = stdCol.default !== undefined ? stdCol.default : "";
            }
        }
        return normalized;
    });

    // 2. Process Normalized rows
    processPayrollData(normalizedRows);
    
    // 3. Hide Verification Layer & show Results Table
    document.getElementById('verificationLayer').style.display = 'none';
    resultsTable.style.display = 'block';
}

function resetImporter() {
    state.records = [];
    state.validCount = 0;
    state.totalCtc = 0;
    state.excelHeaders = [];
    state.excelRows = [];
    state.mapping = {};
    
    fileInput.value = ""; // Clear file choice
    document.getElementById('verificationLayer').style.display = 'none';
    resultsTable.style.display = 'none';
    dropZone.style.display = 'block';
    
    // Update stats to 0
    updateStats();
    btnFinalize.disabled = true;
}

function processPayrollData(data) {
    state.records = data.map((row, idx) => validateRow(row, idx));
    state.validCount = state.records.filter(r => r.isValid).length;
    state.totalCtc = state.records.reduce((acc, r) => acc + (Number(r.data["Salary (Base)"]) || 0), 0);
    
    renderResults();
    updateStats();
    
    dropZone.style.display = 'none';
    resultsTable.style.display = 'block';
    btnFinalize.disabled = state.validCount === 0;
    state.isProcessing = false;
}

function validateRow(row, index) {
    const errors = [];
    const required = ["Employee ID", "Employee Name", "Salary (Base)"];
    
    required.forEach(f => { if (!row[f]) errors.push(`Missing ${f}`); });

    const salary = Number(row["Salary (Base)"]) || 0;
    const pf = Number(row["PF Contribution"]) || 0;
    const tax = Number(row["Tax Deductions"]) || 0;
    const net = salary - pf - tax;

    return {
        isValid: errors.length === 0,
        errors,
        data: row,
        net,
        id: row["Employee ID"],
        name: row["Employee Name"]
    };
}

function renderResults() {
    payrollBody.innerHTML = state.records.map(r => `
        <tr>
            <td>
                <span class="val-pill ${r.isValid ? 'pill-success' : 'pill-error'}">
                    ${r.isValid ? 'VALID' : 'ERROR'}
                </span>
            </td>
            <td>
                <div style="font-weight: 800;">${r.name}</div>
                <div style="font-size: 0.7rem; color: var(--text-muted);">${r.id}</div>
            </td>
            <td>₹${Number(r.data["Salary (Base)"] || 0).toLocaleString()}</td>
            <td>₹${Number(r.data["PF Contribution"] || 0).toLocaleString()}</td>
            <td>${r.data["Variable Pay %"] || 0}% / ${r.data["Bonus Structure"] || 'Standard'}</td>
            <td>${r.data["ESOPs Grant"] || 'None'}</td>
            <td style="font-weight: 800; color: #10b981;">₹${r.net.toLocaleString()}</td>
        </tr>
    `).join('');
    if (window.lucide) lucide.createIcons();
}

function updateStats() {
    statCount.innerText = state.records.length;
    statCtc.innerText = `₹${(state.totalCtc / 12).toLocaleString()} /mo`;
    statStatus.innerText = state.records.length === 0 
        ? "No Data" 
        : state.validCount === state.records.length 
            ? "All Clear" 
            : `${state.records.length - state.validCount} Issues`;
    statStatus.style.color = state.validCount === state.records.length ? "#10b981" : "#ef4444";
}

async function finalizePayroll() {
    btnFinalize.disabled = true;
    btnFinalize.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Initializing Cloud...';
    lucide.createIcons();

    for (const record of state.records.filter(r => r.isValid)) {
        const payrollData = {
            employeeId: record.id,
            employeeName: record.name,
            salaryStructure: {
                base: Number(record.data["Salary (Base)"]),
                incentives: Number(record.data["Incentives"] || 0),
                pf: Number(record.data["PF Contribution"] || 0),
                esic: Number(record.data["ESIC"] || 0),
                gratuity: Number(record.data["Gratuity Provision"] || 0),
                esops: record.data["ESOPs Grant"] || "None",
                variablePay: record.data["Variable Pay %"] || 0,
                taxDeductions: Number(record.data["Tax Deductions"] || 0),
                bonusStructure: record.data["Bonus Structure"] || "Standard",
                shiftAllowance: Number(record.data["Shift Allowance"] || 0)
            },
            netMonthly: record.net,
            approvalStatus: "Pending Finance Approval",
            initializedAt: serverTimestamp(),
            encryptionVersion: "AES-256-HRF"
        };

        // Create Payroll Profile
        await setDoc(doc(db, "payroll_profiles", record.id), payrollData);
        
        // Update Employee record
        try {
            const q = query(collection(db, "users"), where("employeeId", "==", record.id));
            const snap = await getDocs(q);
            if (!snap.empty) {
                await updateDoc(doc(db, "users", snap.docs[0].id), {
                    payrollStatus: "Initialized",
                    salary: Number(record.data["Salary (Base)"])
                });
            }
        } catch (e) { console.warn("Failed to update user profile status", record.id); }
    }

    alert(`Finance Initialization Complete. ${state.validCount} payroll profiles have been securely provisioned and are awaiting Finance Approval.`);
    window.location.reload();
}
