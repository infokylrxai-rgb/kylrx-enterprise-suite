const { db, admin } = require('../config/firebase');

async function finalizeOnboarding() {
    try {
        console.log("🚀 Finalizing onboarding for Nandan...");

        const empEmail = "nandanb449@gmail.com";
        const usersSnap = await db.collection('users')
            .where('email', '==', empEmail)
            .where('role', '==', 'employee')
            .where('status', '==', 'Invitation Sent')
            .get();

        if (usersSnap.empty) {
            console.error("❌ Employee document not found for email nandanb449@gmail.com");
            process.exit(1);
        }

        const empDoc = usersSnap.docs[0];
        const empId = empDoc.id;
        const empData = empDoc.data();
        console.log(`Found Employee: ${empData.fullName} with Document ID: ${empId}`);

        // 1. Ensure Code Engine Config exists in system_configs
        const configRef = db.collection('system_configs').doc('employee_code_engine');
        const configSnap = await configRef.get();
        if (!configSnap.exists) {
            console.log("Creating default employee_code_engine configuration...");
            await configRef.set({
                configs: {
                    "full-time": {
                        prefix: "KYLRX",
                        seqStart: 1,
                        deptEnabled: true,
                        entity: "ENT"
                    }
                }
            });
        }

        // 2. Generate Employee Code (Transaction-safe replica)
        const generatedCode = await db.runTransaction(async (transaction) => {
            const configDoc = await transaction.get(configRef);
            const engineConfig = configDoc.data().configs['full-time'];

            const seqRef = db.collection('system_counters').doc('emp_code_full-time');
            const seqSnap = await transaction.get(seqRef);

            let currentSeq = seqSnap.exists ? seqSnap.data().current : (engineConfig.seqStart || 1);

            const year = new Date().getFullYear();
            const prefix = engineConfig.prefix || 'EMP';
            const deptCode = 'ENG'; // Engineering department code
            const entity = engineConfig.entity ? `-${engineConfig.entity}` : '';
            const paddedSeq = String(currentSeq).padStart(4, '0');

            const code = `${prefix}-${deptCode}${entity}-${year}-${paddedSeq}`;

            // Update Counter
            transaction.set(seqRef, { current: currentSeq + 1 }, { merge: true });

            // Audit Log
            const auditRef = db.collection('audit_logs_codes').doc();
            transaction.set(auditRef, {
                employeeId: empId,
                generatedCode: code,
                type: 'full-time',
                timestamp: new Date().toISOString(),
                operator: 'System-AutoOnboard'
            });

            return code;
        });

        console.log(`🚀 Generated Employee ID: ${generatedCode}`);

        // 3. Finalize User details
        const updatePayload = {
            employeeId: generatedCode,
            onboardingStatus: "Completed",
            status: "Completed",
            onboardingCompletedAt: new Date().toISOString(),
            residentialAddress: "Kylrx AI Campus, Phase 2, Bangalore, India",
            bankName: "Kylrx Partner Bank",
            bankAccount: "9000100449",
            bankIfsc: "KYLRX0000449",
            uploadedDocs: ["Identity Proof", "Address Proof", "Academic Certificates"],
            skippedDocs: [],
            pendingDocuments: [],
            updatedAt: new Date().toISOString()
        };

        await db.collection('users').doc(empId).update(updatePayload);
        console.log(`✅ Updated employee user document in users collection.`);

        // 4. Update Candidate document status to Hired
        if (empData.hiredFromCandidateId) {
            await db.collection('candidates').doc(empData.hiredFromCandidateId).update({
                stage: "Hired",
                onboardingStatus: "completed",
                updatedAt: new Date().toISOString()
            });
            console.log(`✅ Updated candidate document status to Hired.`);
        }

        console.log("\n🎉 Nandan B has been successfully onboarded as a full employee!");
        console.log(`Employee ID: ${generatedCode}`);
        console.log(`Name: Nandan B`);
        console.log(`Email: ${empEmail}`);
        console.log(`Status: Active & Completed`);
    } catch (e) {
        console.error("❌ Onboarding finalization failed:", e);
    }
    process.exit(0);
}

finalizeOnboarding();
