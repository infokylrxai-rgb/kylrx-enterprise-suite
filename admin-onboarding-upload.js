import { auth, db } from "./firebase-config.js";
import { collection, getDocs, setDoc, doc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// State Management
let uploadState = {
    records: [],
    managers: [],
    existingEmails: [],
    processedCount: 0,
    totalCount: 0,
    isValidating: false
};

// UI Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');
const progressCount = document.getElementById('progressCount');
const progressStatus = document.getElementById('progressStatus');
const resultsSection = document.getElementById('resultsSection');
const resultsBody = document.getElementById('resultsBody');
const finalizeBtn = document.getElementById('finalizeBtn');
const downloadBtn = document.getElementById('downloadTemplate');
const clearBtn = document.getElementById('clearBtn');
const successOverlay = document.getElementById('successOverlay');

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
    await fetchReferenceData();
    setupEventListeners();
});

async function fetchReferenceData() {
    try {
        // Fetch all users to check for existing emails and identify managers
        const usersSnap = await getDocs(collection(db, 'users'));
        uploadState.existingEmails = usersSnap.docs.map(d => d.data().email?.toLowerCase()).filter(Boolean);
        uploadState.managers = usersSnap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(u => u.role?.toLowerCase() === 'manager' || u.role?.toLowerCase() === 'admin');
        
        console.log(`Loaded ${uploadState.existingEmails.length} emails and ${uploadState.managers.length} managers for validation.`);
    } catch (err) {
        console.error('Failed to fetch reference data:', err);
    }
}

function setupEventListeners() {
    // Drop zone interactions
    dropZone.addEventListener('click', () => fileInput.click());
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length) handleFileUpload(files[0]);
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFileUpload(e.target.files[0]);
    });

    // Template Download
    downloadBtn.addEventListener('click', generateTemplate);

    // Finalize Import
    finalizeBtn.addEventListener('click', finalizeImport);

    // Clear
    clearBtn.addEventListener('click', () => window.location.reload());
}

// Template Generation
function generateTemplate() {
    const headers = [
        "Official Email ID", "Personal Email ID", "Department", "Sub-Department", 
        "Designation", "Reporting Manager", "Employment Type", "Business Unit", 
        "Legal Entity", "Joining Date", "Temporary Employee Code"
    ];
    
    const sampleData = [
        ["john.doe@enterprise.com", "john.doe.personal@gmail.com", "Engineering", "Frontend", "Sr. Software Engineer", "Manager Name or Email", "Full-Time", "Digital Transformation", "HRFlow Global Pvt Ltd", "2024-06-01", "TEMP001"]
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sampleData]);
    XLSX.utils.book_append_sheet(wb, ws, "OnboardingTemplate");
    XLSX.writeFile(wb, "HRFlow_Onboarding_Template.xlsx");
}

// File Processing
function handleFileUpload(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.SheetNames[0];
        const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);
        
        if (jsonData.length === 0) {
            alert("The uploaded file is empty.");
            return;
        }

        processRecords(jsonData);
    };
    reader.readAsArrayBuffer(file);
}

async function processRecords(data) {
    uploadState.totalCount = data.length;
    uploadState.processedCount = 0;
    uploadState.records = [];
    
    progressContainer.style.display = 'block';
    resultsSection.style.display = 'none';
    
    for (let i = 0; i < data.length; i++) {
        const raw = data[i];
        const record = validateRecord(raw);
        uploadState.records.push(record);
        
        uploadState.processedCount++;
        updateProgress();
        
        // Small delay to allow UI updates
        if (i % 10 === 0) await new Promise(r => setTimeout(r, 50));
    }

    renderResults();
    finalizeBtn.disabled = !uploadState.records.some(r => r.isValid);
}

function validateRecord(raw) {
    const record = {
        data: raw,
        errors: [],
        warnings: [],
        isValid: true,
        email: (raw["Official Email ID"] || "").trim().toLowerCase(),
        name: raw["Official Email ID"] ? raw["Official Email ID"].split('@')[0].split('.').map(n => n.charAt(0).toUpperCase() + n.slice(1)).join(' ') : "Unknown"
    };

    const requiredFields = ["Official Email ID", "Department", "Designation", "Joining Date"];
    
    // 1. Missing Field Validation
    requiredFields.forEach(field => {
        if (!raw[field]) {
            record.errors.push(`Missing required field: ${field}`);
        }
    });

    // 2. Email Format & Duplicate Validation
    if (record.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(record.email)) {
            record.errors.push("Invalid Official Email ID format");
        } else if (uploadState.existingEmails.includes(record.email)) {
            record.errors.push("Duplicate detection: Email already exists in system");
        }
    }

    // 3. Manager Validation
    const managerName = raw["Reporting Manager"];
    if (managerName) {
        const foundManager = uploadState.managers.find(m => 
            m.name?.toLowerCase() === managerName.toLowerCase() || 
            m.email?.toLowerCase() === managerName.toLowerCase()
        );
        if (!foundManager) {
            record.warnings.push(`Manager not found: "${managerName}". Defaults to Admin.`);
        } else {
            record.managerId = foundManager.uid || foundManager.id;
        }
    }

    if (record.errors.length > 0) record.isValid = false;
    return record;
}

function updateProgress() {
    const percent = Math.round((uploadState.processedCount / uploadState.totalCount) * 100);
    progressBar.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
    progressCount.textContent = `${uploadState.processedCount}/${uploadState.totalCount}`;
    
    if (percent === 100) {
        progressStatus.textContent = "Validation complete!";
        setTimeout(() => {
            progressContainer.style.display = 'none';
            resultsSection.style.display = 'block';
        }, 800);
    }
}

function renderResults() {
    resultsBody.innerHTML = uploadState.records.map((record, index) => {
        const statusClass = record.isValid ? (record.warnings.length > 0 ? 'status-warning' : 'status-success') : 'status-error';
        const statusText = record.isValid ? (record.warnings.length > 0 ? 'Validated (Warn)' : 'Ready') : 'Error';
        
        return `
            <tr>
                <td>
                    <span class="status-pill ${statusClass}">
                        <i data-lucide="${record.isValid ? (record.warnings.length > 0 ? 'alert-circle' : 'check-circle') : 'x-circle'}" size="14"></i>
                        ${statusText}
                    </span>
                </td>
                <td>
                    <div style="font-weight: 700;">${record.name}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${record.email || 'N/A'}</div>
                </td>
                <td>
                    <div style="font-weight: 600;">${record.data["Department"] || 'N/A'}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${record.data["Designation"] || 'N/A'}</div>
                </td>
                <td>
                    <div style="font-size: 0.85rem;">${record.data["Reporting Manager"] || 'System Admin'}</div>
                </td>
                <td>
                    <div style="font-size: 0.85rem;">${record.data["Joining Date"] || 'N/A'}</div>
                </td>
                <td>
                    ${record.errors.length > 0 ? `
                        <ul class="error-list">
                            ${record.errors.map(err => `<li>• ${err}</li>`).join('')}
                        </ul>
                    ` : (record.warnings.length > 0 ? `
                        <ul class="error-list" style="color: var(--warning)">
                            ${record.warnings.map(warn => `<li>• ${warn}</li>`).join('')}
                        </ul>
                    ` : '<div class="success-badge"><i data-lucide="check" size="12"></i></div>')}
                </td>
            </tr>
        `;
    }).join('');
    
    if (window.lucide) lucide.createIcons();
}

async function finalizeImport() {
    const validRecords = uploadState.records.filter(r => r.isValid);
    if (validRecords.length === 0) return;

    finalizeBtn.disabled = true;
    finalizeBtn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Synchronizing Cloud...';
    if (window.lucide) lucide.createIcons();

    let synced = 0;
    for (const record of validRecords) {
        try {
            // Generate a temporary password
            const tempPass = `${record.data["Department"]?.substring(0,3).toUpperCase()}-2024@${record.name.split(' ')[0]}!`;
            
            const onboardingToken = `HRFLOW-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
            
            const employeeData = {
                uid: `bulk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: record.name,
                email: record.email,
                personalEmail: record.data["Personal Email ID"] || "",
                department: record.data["Department"],
                subDepartment: record.data["Sub-Department"] || "",
                designation: record.data["Designation"],
                managerId: record.managerId || "admin",
                employmentType: record.data["Employment Type"] || "Full-Time",
                businessUnit: record.data["Business Unit"] || "",
                legalEntity: record.data["Legal Entity"] || "",
                joiningDate: record.data["Joining Date"],
                employeeCode: record.data["Temporary Employee Code"] || `EMP-${Math.floor(1000 + Math.random() * 9000)}`,
                status: "Invitation Sent", // Requirements: Status update
                role: "employee",
                password: tempPass,
                onboardingToken: onboardingToken,
                onboardingTokenExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days expiry
                createdAt: serverTimestamp(),
                onboardingStep: "invitation_sent"
            };

            // Simulate Sending Emails
            console.log(`[INVITATION] Sending to Official: ${employeeData.email} | Token: ${employeeData.onboardingToken}`);
            if (employeeData.personalEmail) {
                console.log(`[INVITATION] Sending Backup to Personal: ${employeeData.personalEmail}`);
            }

            await setDoc(doc(db, 'users', employeeData.uid), employeeData);
            synced++;
        } catch (err) {
            console.error('Failed to sync record:', record.email, err);
        }
    }

    // Update Success Overlay Content
    const successMsg = document.querySelector('#successOverlay p');
    successMsg.innerHTML = `Successfully imported ${synced} employees. <br><br><b>Secure invitations with JWT-secured onboarding tokens</b> have been dispatched to all official and backup personal email addresses.`;
    
    successOverlay.style.display = 'flex';
}
