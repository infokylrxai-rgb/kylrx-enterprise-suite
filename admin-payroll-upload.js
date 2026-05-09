import { auth, db } from "./firebase-config.js";
import { collection, getDocs, setDoc, doc, updateDoc, serverTimestamp, addDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// State
let payrollState = {
    records: [],
    employees: [],
    totalOutflow: 0
};

document.addEventListener('DOMContentLoaded', async () => {
    if (window.lucide) lucide.createIcons();
    await fetchEmployees();
    setupEvents();
});

async function fetchEmployees() {
    const snap = await getDocs(collection(db, 'users'));
    payrollState.employees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function setupEvents() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');

    dropZone.addEventListener('click', () => fileInput.click());
    
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    document.getElementById('downloadTemplate').addEventListener('click', downloadTemplate);
    document.getElementById('finalizePayroll').addEventListener('click', finalizePayroll);
}

function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(sheet);
        
        processPayrollData(json);
    };
    reader.readAsArrayBuffer(file);
}

function processPayrollData(data) {
    payrollState.records = data.map(row => {
        const salary = parseFloat(row["Salary"] || 0);
        const incentives = parseFloat(row["Incentives"] || 0);
        const pf = parseFloat(row["PF Deductions"] || 0);
        const esic = parseFloat(row["ESIC"] || 0);
        const tax = parseFloat(row["Tax Deductions"] || 0);
        const variable = parseFloat(row["Variable Pay"] || 0);
        const shift = parseFloat(row["Shift Allowance"] || 0);

        const net = (salary + incentives + variable + shift) - (pf + esic + tax);
        
        // Match with employee
        const empId = row["Employee ID"] || row["Official Email ID"];
        const employee = payrollState.employees.find(e => 
            e.employeeCode === empId || e.email === empId
        );

        return {
            employee: employee || { name: row["Employee Name"] || "Unknown", employeeCode: empId },
            isMatched: !!employee,
            salary, incentives, pf, esic, tax, variable, shift, net,
            raw: row
        };
    });

    renderResults();
}

function renderResults() {
    const body = document.getElementById('payrollBody');
    const resultsSection = document.getElementById('resultsSection');
    let totalSalary = 0;
    let errors = 0;

    body.innerHTML = payrollState.records.map(record => {
        if (!record.isMatched) errors++;
        totalSalary += record.net;

        return `
            <tr>
                <td>
                    <span class="status-pill ${record.isMatched ? 'status-ready' : 'status-error'}">
                        <i data-lucide="${record.isMatched ? 'check-circle' : 'alert-circle'}"></i>
                        ${record.isMatched ? 'Matched' : 'Unmatched'}
                    </span>
                </td>
                <td>
                    <div style="font-weight: 700;">${record.employee.name}</div>
                    <div style="font-size: 0.7rem; color: var(--text-muted);">${record.employee.employeeCode || 'N/A'}</div>
                </td>
                <td class="currency">$${record.salary.toLocaleString()}</td>
                <td style="color: var(--success); font-weight: 600;">+$${record.incentives.toLocaleString()}</td>
                <td style="color: var(--danger); font-weight: 600;">-$${(record.pf + record.esic).toLocaleString()}</td>
                <td style="color: var(--warning); font-weight: 600;">$${(record.tax).toLocaleString()}</td>
                <td class="currency" style="font-size: 1rem; color: var(--primary);">$${record.net.toLocaleString()}</td>
            </tr>
        `;
    }).join('');

    document.getElementById('statTotal').textContent = payrollState.records.length;
    document.getElementById('statSalary').textContent = `$${totalSalary.toLocaleString()}`;
    document.getElementById('statErrors').textContent = errors;
    document.getElementById('validationCount').textContent = `${payrollState.records.length} Records Validated`;

    resultsSection.style.display = 'block';
    document.getElementById('finalizePayroll').disabled = (errors > 0 || payrollState.records.length === 0);
    
    if (window.lucide) lucide.createIcons();
}

async function finalizePayroll() {
    const btn = document.getElementById('finalizePayroll');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Finalizing...';
    if (window.lucide) lucide.createIcons();

    try {
        for (const record of payrollState.records) {
            const empId = record.employee.uid || record.employee.id;
            
            // Create Payroll Profile
            await setDoc(doc(db, 'payroll_profiles', empId), {
                ...record,
                status: 'Active',
                initializedAt: serverTimestamp(),
                lastUpdated: serverTimestamp()
            });

            // Update User Status
            await updateDoc(doc(db, 'users', empId), {
                payrollInitialized: true,
                baseSalary: record.salary,
                netMonthly: record.net
            });
        }

        // Audit Log
        await addDoc(collection(db, 'audit_logs'), {
            action: 'PAYROLL_INITIALIZATION',
            recordCount: payrollState.records.length,
            totalOutflow: payrollState.records.reduce((a, b) => a + b.net, 0),
            performedBy: 'Admin',
            timestamp: serverTimestamp()
        });

        alert('Payroll initialization complete! All financial profiles are now active.');
        window.location.reload();
    } catch (err) {
        console.error('Finalization failed:', err);
        alert('Failed to finalize payroll. Check console for details.');
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="shield-check"></i> Finalize Payroll';
    }
}

function downloadTemplate() {
    const headers = [
        "Employee ID", "Employee Name", "Salary", "Incentives", "PF Deductions", 
        "ESIC", "Gratuity", "ESOPs", "Variable Pay", "Tax Deductions", "Shift Allowance"
    ];
    const data = [
        ["EMP-001", "John Doe", 5000, 500, 600, 150, 0, 100, 200, 450, 50]
    ];
    
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    XLSX.utils.book_append_sheet(wb, ws, "PayrollTemplate");
    XLSX.writeFile(wb, "HRFlow_Payroll_Template.xlsx");
}
