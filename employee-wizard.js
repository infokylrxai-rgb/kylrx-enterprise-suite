import { auth, db } from "./firebase-config.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const CONFIG_TEMPLATES = {
    personal: {
        title: "Personal Information",
        desc: "Basic identification details",
        fields: [
            { id: "full_name", label: "Full Name", type: "text", required: true, full: true },
            { id: "gender", label: "Gender", type: "select", options: ["Male", "Female", "Non-binary", "Prefer not to say"] },
            { id: "dob", label: "Date of Birth", type: "date", required: true },
            { id: "nationality", label: "Nationality", type: "text", required: true }
        ]
    },
    address: {
        title: "Address Details",
        desc: "Permanent and current residence",
        fields: [
            { id: "addr_line1", label: "Address Line 1", type: "text", required: true, full: true },
            { id: "city", label: "City", type: "text", required: true },
            { id: "state", label: "State / Province", type: "text", required: true },
            { id: "zip", label: "ZIP / Postal Code", type: "text", required: true },
            { id: "country", label: "Country", type: "select", options: ["United States", "United Kingdom", "India", "Germany", "Canada"], required: true }
        ]
    },
    bank: {
        title: "Bank Details",
        desc: "Payroll processing information",
        fields: [
            { id: "bank_name", label: "Bank Name", type: "text", required: true, full: true },
            { id: "account_number", label: "Account Number", type: "text", required: true },
            { id: "routing_number", label: "Routing / Sort Code", type: "text", required: true },
            { id: "account_type", label: "Account Type", type: "select", options: ["Savings", "Current / Checking"] }
        ]
    },
    government: {
        title: "Government IDs",
        desc: "Identity verification documents",
        fields: [
            { id: "id_type", label: "Primary ID Type", type: "select", options: ["Passport", "Driver License", "National ID Card"], required: true },
            { id: "id_number", label: "ID Number", type: "text", required: true },
            { id: "tax_id", label: "Tax ID / SSN / PAN", type: "text", required: true }
        ]
    }
};

let currentStep = 0;
let workflowSteps = [];
let formData = {};
let employeeId = "demo_user_123";

document.addEventListener('DOMContentLoaded', async () => {
    if (window.lucide) lucide.createIcons();
    
    // 1. Fetch Workflow Configuration
    await loadWorkflow();
    
    // 2. Initialize UI
    renderStep();
    setupNavigation();
});

async function loadWorkflow() {
    try {
        // In a real app, we'd fetch based on employee's profile
        // For demo, we'll fetch the 'flow_all_all' config
        const flowSnap = await getDoc(doc(db, 'onboarding_configs', 'flow_all_all'));
        
        if (flowSnap.exists()) {
            workflowSteps = flowSnap.data().steps;
        } else {
            // Fallback default steps if no custom config exists
            workflowSteps = [
                { id: 'personal', title: 'Personal Info' },
                { id: 'address', title: 'Address' },
                { id: 'government', title: 'Identity' },
                { id: 'bank', title: 'Payroll' }
            ];
        }

        // Load existing data if any
        const dataSnap = await getDoc(doc(db, 'onboarding_data', employeeId));
        if (dataSnap.exists()) {
            formData = dataSnap.data();
            currentStep = formData.lastStep || 0;
        }

        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('formContainer').style.display = 'block';
    } catch (err) {
        console.error('Failed to load workflow:', err);
    }
}

function renderStep() {
    const step = workflowSteps[currentStep];
    const template = CONFIG_TEMPLATES[step.id] || { title: step.title, desc: step.desc, fields: [] };
    
    document.getElementById('currentStepTitle').textContent = template.title;
    document.getElementById('currentStepDesc').textContent = template.desc;
    
    const form = document.getElementById('wizardForm');
    form.innerHTML = template.fields.map(field => {
        const val = formData[field.id] || '';
        const fieldHtml = field.type === 'select' 
            ? `<select id="${field.id}" ${field.required ? 'required' : ''}>
                <option value="">Select ${field.label}</option>
                ${field.options.map(opt => `<option value="${opt}" ${val === opt ? 'selected' : ''}>${opt}</option>`).join('')}
               </select>`
            : `<input type="${field.type}" id="${field.id}" value="${val}" placeholder="Enter ${field.label}" ${field.required ? 'required' : ''}>`;

        return `
            <div class="form-group ${field.full ? 'full' : ''}">
                <label for="${field.id}">${field.label} ${field.required ? '<span style="color:red">*</span>' : ''}</label>
                ${fieldHtml}
            </div>
        `;
    }).join('');

    updateProgressUI();
    
    // Add change listeners for auto-save
    form.querySelectorAll('input, select').forEach(input => {
        input.addEventListener('change', (e) => {
            formData[e.target.id] = e.target.value;
            autoSave();
        });
    });
}

function updateProgressUI() {
    const total = workflowSteps.length;
    const progress = Math.round(((currentStep + 1) / total) * 100);
    
    document.getElementById('progressBar').style.width = `${progress}%`;
    document.getElementById('percentLabel').textContent = `${progress}% Complete`;
    document.getElementById('stepIndicator').textContent = `Step ${currentStep + 1} of ${total}`;
    
    document.getElementById('btnPrev').disabled = currentStep === 0;
    document.getElementById('btnNext').innerHTML = currentStep === total - 1 
        ? 'Complete Onboarding <i data-lucide="check"></i>' 
        : 'Next Step <i data-lucide="arrow-right"></i>';
    
    if (window.lucide) lucide.createIcons();
}

function setupNavigation() {
    document.getElementById('btnNext').addEventListener('click', async () => {
        if (currentStep < workflowSteps.length - 1) {
            currentStep++;
            renderStep();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            finalizeOnboarding();
        }
    });

    document.getElementById('btnPrev').addEventListener('click', () => {
        if (currentStep > 0) {
            currentStep--;
            renderStep();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });

    document.getElementById('btnSaveDraft').addEventListener('click', async () => {
        await autoSave(true);
        alert('Draft saved successfully!');
    });
}

let saveTimeout;
async function autoSave(force = false) {
    const status = document.getElementById('saveStatus');
    status.innerHTML = '<i data-lucide="refresh-cw" class="animate-spin"></i> <span>Saving...</span>';
    if (window.lucide) lucide.createIcons();

    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        try {
            await setDoc(doc(db, 'onboarding_data', employeeId), {
                ...formData,
                lastStep: currentStep,
                updatedAt: serverTimestamp()
            });
            status.innerHTML = '<i data-lucide="cloud-check"></i> <span>Data Auto-saved</span>';
            if (window.lucide) lucide.createIcons();
        } catch (err) {
            console.error('Save failed:', err);
            status.innerHTML = '<i data-lucide="alert-circle" style="color:var(--danger)"></i> <span>Save Failed</span>';
            if (window.lucide) lucide.createIcons();
        }
    }, 1000);
}

import { generateEmployeeCodeAndActivate } from "./employee-code-engine.js";

async function finalizeOnboarding() {
    try {
        const btn = document.getElementById('btnNext');
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="loader" class="animate-spin"></i> Finalizing...';
        
        // Save final data first
        await setDoc(doc(db, 'onboarding_data', employeeId), {
            ...formData,
            status: 'Completed',
            completedAt: serverTimestamp()
        });

        // Trigger Code Generation & Profile Activation
        const finalCode = await generateEmployeeCodeAndActivate(employeeId, {
            department: formData.department || 'General',
            employeeType: formData.employeeType || 'Full-Time'
        });

        alert(`Congratulations! Your onboarding is now complete.\nYour Employee ID is: ${finalCode}\nYou will be redirected to the main dashboard.`);
        window.location.href = 'index.html';
    } catch (err) {
        alert('Failed to finalize onboarding. Please try again.');
        console.error(err);
    }
}
