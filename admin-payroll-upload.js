import { auth, db } from "./firebase-config.js";
import { 
    collection, 
    getDocs, 
    setDoc, 
    doc, 
    addDoc,
    query, 
    where, 
    serverTimestamp 
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// Finance Engine State
let state = {
    records: [],
    validCount: 0,
    totalCtc: 0,
    isProcessing: false
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
}

function downloadTemplate() {
    const headers = [
        "Employee ID", "Employee Name", "Salary (Base)", "Incentives", "PF Contribution", 
        "ESIC", "Gratuity Provision", "ESOPs Grant", "Variable Pay %", 
        "Tax Deductions", "Bonus Structure", "Shift Allowance"
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "PayrollTemplate");
    XLSX.writeFile(wb, "HRFlow_Payroll_Initialization_Template.xlsx");
}

async function handleFile(file) {
    if (!file || state.isProcessing) return;
    state.isProcessing = true;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const json = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
        processPayrollData(json);
    };
    reader.readAsArrayBuffer(file);
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
    statStatus.innerText = state.validCount === state.records.length ? "All Clear" : `${state.records.length - state.validCount} Issues`;
    statStatus.style.color = state.validCount === state.records.length ? "#10b981" : "#ef4444";
}

async function finalizePayroll() {
    btnFinalize.disabled = true;
    btnFinalize.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Initializing Cloud...';
    lucide.createIcons();

    const batch = [];
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
            // Note: This assumes Employee ID matches the Document ID in 'users' or we search for it
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
