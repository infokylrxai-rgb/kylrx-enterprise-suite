const { db } = require('../config/firebase');
const http = require('http');

async function runTest() {
    console.log("Starting bulk onboarding verification test...");
    
    // Generate mock candidate data
    const email = "onboard_test_verification_candidate@gmail.com";
    const personalEmail = "onboard_test_verification_candidate_personal@gmail.com";
    const name = "Verification Candidate";
    const designation = "Software Engineering Manager"; // should result in role: manager
    const department = "Cybersecurity";
    const reportingManager = "CYBER";
    
    // Generate temporary password
    const generatedPassword = `Kylrx-${Math.random().toString(36).substr(2, 6).toUpperCase()}!`;

    // Determine role based on designation
    const role = "manager"; // since designation is Software Engineering Manager

    const onboardingToken = `HRFLOW-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const expiryDate = new Date();
    expiryDate.setHours(expiryDate.getHours() + 3);

    const empId = `emp_test_${Math.random().toString(36).substr(2, 9)}`;
    const empData = {
        fullName: name,
        email: email.toLowerCase(),
        personalEmail: personalEmail,
        department: department,
        subDepartment: "",
        designation: designation,
        reportingManager: reportingManager,
        employmentType: "Full-time",
        businessUnit: "Default",
        legalEntity: "Default",
        joiningDate: "2026-06-25",
        phoneNumber: "+91 99999 88888",
        status: "Invitation Sent", 
        onboardingStatus: "Invitation Sent",
        onboardingToken: onboardingToken,
        onboardingTokenExpiry: expiryDate,
        role: role,
        tempPassword: generatedPassword,
        password: generatedPassword,
        createdAt: new Date().toISOString(),
        sessionId: "test_verification_session"
    };

    const inviteLink = `http://localhost:3000/onboarding-invite.html?token=${onboardingToken}&id=${empId}`;
    
    // Construct HTML body
    const html = `
        <div style="font-family: 'Outfit', sans-serif; max-width: 600px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 24px; background-color: #ffffff; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);">
            <h2 style="color: #3b82f6; font-weight: 800; font-size: 1.8rem;">Kylrx AI Onboarding</h2>
            <p>Welcome <strong>${empData.fullName}</strong>!</p>
            <p>Credentials: Email: ${empData.email}, Temp Password: ${generatedPassword}, Role: ${role}</p>
            <p>Invite Link: <a href="${inviteLink}">${inviteLink}</a></p>
        </div>
    `;

    // Dispatch email
    console.log(`Sending verification invite email to ${email} and ${personalEmail}...`);
    const data = JSON.stringify({
        to: [email, personalEmail],
        subject: 'Welcome to Kylrx AI - Secure Onboarding Invitation (VERIFICATION TEST)',
        html: html
    });

    const options = {
        hostname: '127.0.0.1',
        port: 3000,
        path: '/api/email/send',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };

    const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', async () => {
            console.log(`Email Send Response Status: ${res.statusCode}`);
            console.log(`Response Body: ${body}`);
            
            if (res.statusCode === 200) {
                console.log("Writing mock user to Firestore...");
                await db.collection("users").doc(empId).set(empData);
                console.log(`✅ Test user document created in Firestore with ID: ${empId}`);
                
                // Verify direct read
                const verifyDoc = await db.collection("users").doc(empId).get();
                if (verifyDoc.exists) {
                    const verifiedData = verifyDoc.data();
                    console.log(`✅ Verified Firestore data role: ${verifiedData.role}`);
                    console.log(`✅ Verified Firestore data tempPassword: ${verifiedData.tempPassword}`);
                    console.log("ALL TESTS PASSED!");
                } else {
                    console.error("❌ Failed to verify user in Firestore!");
                }
            } else {
                console.error("❌ Email dispatch failed!");
            }
            process.exit(0);
        });
    });

    req.on('error', (e) => {
        console.error(`Request error: ${e.message}`);
        process.exit(1);
    });

    req.write(data);
    req.end();
}

runTest();
