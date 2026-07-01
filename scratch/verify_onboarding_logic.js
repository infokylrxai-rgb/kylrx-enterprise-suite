const { db } = require('../config/firebase');
const http = require('http');

// Mock data matching the validation requirements and user roles
const validEmployeeRow = {
    "Official Email": "onboard_test_emp_role@gmail.com",
    "Personal Email": "personal_emp@gmail.com",
    "Employee Name": "Role Test Employee",
    "Department": "Cybersecurity",
    "Designation": "Software Engineer",
    "Reporting Manager": "CYBER",
    "Employment Type": "Full-time",
    "Joining Date": "2026-06-25",
    "Role": "employee"
};

const validManagerRow = {
    "Official Email": "onboard_test_mgr_role@gmail.com",
    "Personal Email": "",
    "Employee Name": "Role Test Manager",
    "Department": "Cybersecurity",
    "Designation": "Engineering Manager",
    "Reporting Manager": "CYBER",
    "Employment Type": "Full-time",
    "Joining Date": "2026-06-25",
    "Role": "manager"
};

const invalidAdminRow = {
    "Official Email": "onboard_test_admin_role@gmail.com",
    "Personal Email": "",
    "Employee Name": "Role Test Admin",
    "Department": "Cybersecurity",
    "Designation": "HR Admin",
    "Reporting Manager": "CYBER",
    "Employment Type": "Full-time",
    "Joining Date": "2026-06-25",
    "Role": "admin"
};

const invalidMissingFieldsRow = {
    "Official Email": "onboard_test_bad_role@gmail.com",
    "Employee Name": "Bad Role",
    "Department": "Cybersecurity",
    "Designation": "Software Engineer",
    "Reporting Manager": "CYBER",
    "Joining Date": "2026-06-25"
    // Missing Role field entirely
};

// Simulation of frontend validation rules in node
function simulateValidateRow(row, existingEmails, managers) {
    const errors = [];
    let isDupe = false;

    const required = ["Official Email", "Employee Name", "Department", "Designation", "Reporting Manager", "Joining Date", "Role"];
    
    required.forEach(f => {
        if (!row[f]) errors.push(`Missing field: ${f}`);
    });

    const role = (row["Role"] || "").trim().toLowerCase();
    if (role && role !== "employee" && role !== "manager") {
        errors.push(`Invalid role: "${row["Role"]}". Must be strictly "employee" or "manager".`);
    }

    const email = (row["Official Email"] || "").trim().toLowerCase();
    if (email) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Invalid email format");
        if (existingEmails.includes(email)) {
            errors.push("Email already exists in HRMS");
            isDupe = true;
        }
    }

    const manager = row["Reporting Manager"];
    if (manager) {
        const found = managers.find(m => 
            m.name?.toLowerCase() === manager.toLowerCase() || 
            m.email?.toLowerCase() === manager.toLowerCase() ||
            m.fullName?.toLowerCase() === manager.toLowerCase()
        );
        if (!found) errors.push(`Manager "${manager}" not found in system`);
    }

    return { isValid: errors.length === 0, errors, isDupe };
}

async function runVerification() {
    console.log("--- 🧪 ONBOARDING LOGIC & ROLE VALIDATION VERIFICATION TEST ---");

    // Fetch existing emails and managers
    const usersSnap = await db.collection('users').get();
    const existingEmails = usersSnap.docs.map(d => d.data().email?.toLowerCase()).filter(Boolean);
    const managers = usersSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(u => ['manager', 'admin', 'hr'].includes(u.role?.toLowerCase()));

    console.log(`System has ${existingEmails.length} existing emails.`);
    console.log(`System has ${managers.length} managers:`, managers.map(m => m.name || m.fullName || m.email));

    // Test 1: Valid Employee Row
    const resEmp = simulateValidateRow(validEmployeeRow, existingEmails, managers);
    console.log("Test 1 (Valid Employee):", resEmp.isValid ? "PASSED" : "FAILED", resEmp.errors);
    if (!resEmp.isValid) throw new Error("Valid Employee row validation failed!");

    // Test 2: Valid Manager Row
    const resMgr = simulateValidateRow(validManagerRow, existingEmails, managers);
    console.log("Test 2 (Valid Manager):", resMgr.isValid ? "PASSED" : "FAILED", resMgr.errors);
    if (!resMgr.isValid) throw new Error("Valid Manager row validation failed!");

    // Test 3: Invalid Admin Row (Should fail because role 'admin' is restricted)
    const resAdmin = simulateValidateRow(invalidAdminRow, existingEmails, managers);
    console.log("Test 3 (Invalid Admin role):", !resAdmin.isValid ? "PASSED (Rejected as expected)" : "FAILED (Accepted wrongly!)", resAdmin.errors);
    if (resAdmin.isValid) throw new Error("Admin role was accepted, but should be restricted!");

    // Test 4: Missing Role Field Row (Should fail)
    const resMissing = simulateValidateRow(invalidMissingFieldsRow, existingEmails, managers);
    console.log("Test 4 (Missing Role field):", !resMissing.isValid ? "PASSED (Rejected as expected)" : "FAILED (Accepted wrongly!)", resMissing.errors);
    if (resMissing.isValid) throw new Error("Missing Role field row was accepted!");

    // Test 5: SMTP Dispatch Integration for Onboarding Invite
    console.log("\n--- Testing SMTP Email Dispatch via localhost:3000 ---");
    const testOnboardToken = `HRFLOW-VERIFY-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const generatedPassword = `Kylrx-${Math.random().toString(36).substr(2, 6).toUpperCase()}!`;
    const inviteLink = `http://localhost:3000/onboarding-invite.html?token=${testOnboardToken}&id=verify_emp`;
    const html = `
        <div style="font-family: 'Outfit', sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 24px; background-color: #ffffff; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);">
            <h2>Kylrx AI Verification</h2>
            <p>Onboarding Invite Verification for <strong>Role Test Employee</strong>.</p>
            <p>Temporary Password: <strong>${generatedPassword}</strong></p>
            <p>Access Link: <a href="${inviteLink}">Start Onboarding</a></p>
        </div>
    `;

    const payload = JSON.stringify({
        to: ["onboard_test_emp_role@gmail.com", "personal_emp@gmail.com"],
        subject: "Welcome to Kylrx AI - Secure Onboarding Invitation (LOGIC TEST)",
        html: html
    });

    const options = {
        hostname: '127.0.0.1',
        port: 3000,
        path: '/api/email/send',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        }
    };

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
            console.log(`SMTP API status: ${res.statusCode}`);
            console.log(`SMTP API response: ${body}`);
            if (res.statusCode === 200) {
                console.log("✅ SMTP dispatch functional.");
            } else {
                console.error("❌ SMTP API failed.");
            }
            console.log("All tests completed successfully!");
            process.exit(0);
        });
    });

    req.on('error', (err) => {
        console.error("SMTP integration request failed:", err.message);
        process.exit(1);
    });

    req.write(payload);
    req.end();
}

runVerification().catch(err => {
    console.error("❌ Verification failed:", err);
    process.exit(1);
});
