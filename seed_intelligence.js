const { db } = require('./config/firebase');

async function seed() {
    console.log("--- ⚡ STARTING SYSTEM INTELLIGENCE SEEDING ⚡ ---");

    // 1. Seed system_intelligence
    const sysIntelRef = db.collection('system_intelligence');
    const existingSys = await sysIntelRef.get();
    existingSys.forEach(async doc => {
        await doc.ref.delete();
    });
    await sysIntelRef.add({
        prediction: "36h",
        sentiment: 4.6,
        automation: 92
    });
    console.log("✅ Seeded system_intelligence");

    // 2. Seed intelligence_insights
    const insightsRef = db.collection('intelligence_insights');
    const existingInsights = await insightsRef.get();
    existingInsights.forEach(async doc => {
        await doc.ref.delete();
    });
    
    const insights = [
        {
            title: "Finance Verification Bottleneck",
            description: "Verification stage for cybersecurity recruits is causing a 48-hour delay.",
            type: "bottleneck"
        },
        {
            title: "Onboarding Sequence Alert",
            description: "Automated greeting emails have a 98% open rate this week.",
            type: "reminder"
        },
        {
            title: "Workspace Provisioning Speedup",
            description: "IT provisioning latency decreased by 15% due to automatic asset tagging.",
            type: "suggestion"
        }
    ];

    for (const insight of insights) {
        await insightsRef.add(insight);
    }
    console.log("✅ Seeded intelligence_insights");

    // 3. Seed employee_eods
    const eodsRef = db.collection('employee_eods');
    const existingEods = await eodsRef.get();
    existingEods.forEach(async doc => {
        await doc.ref.delete();
    });

    const eods = [
        {
            employeeId: "FS_oa4x4yinz",
            date: "2026-05-20",
            status: "Reviewed",
            managerScore: 5,
            submittedAt: new Date("2026-05-20T17:00:00Z")
        },
        {
            employeeId: "FS_oa4x4yinz",
            date: "2026-05-21",
            status: "Reviewed",
            managerScore: 4,
            submittedAt: new Date("2026-05-21T17:00:00Z")
        },
        {
            employeeId: "FS_oa4x4yinz",
            date: "2026-05-22",
            status: "Reviewed",
            managerScore: 5,
            submittedAt: new Date("2026-05-22T17:00:00Z")
        }
    ];

    for (const eod of eods) {
        await eodsRef.add(eod);
    }
    console.log("✅ Seeded employee_eods");

    // 4. Update existing users with onboardingCompletedAt so chart can render weekly stats
    const usersRef = db.collection('users');
    const usersSnap = await usersRef.get();
    let updatedCount = 0;
    for (const doc of usersSnap.docs) {
        const data = doc.data();
        if (data.role === 'employee' || data.status === 'Completed') {
            await doc.ref.update({
                onboardingStatus: data.onboardingStatus || 'Active',
                onboardingStartedAt: data.onboardingStartedAt || new Date("2026-05-18T09:00:00Z"),
                onboardingCompletedAt: data.onboardingCompletedAt || new Date("2026-05-19T17:00:00Z")
            });
            updatedCount++;
        }
    }
    console.log(`✅ Updated ${updatedCount} user documents with onboarding metadata`);

    // 5. Seed employee_code_engine configuration
    const sysConfigsRef = db.collection('system_configs').doc('employee_code_engine');
    await sysConfigsRef.set({
        configs: {
            'full-time': {
                prefix: 'FTE',
                seqStart: 1050,
                deptEnabled: true,
                entity: 'CORP'
            },
            'intern': {
                prefix: 'INT',
                seqStart: 205,
                deptEnabled: true,
                entity: 'CORP'
            },
            'contracting': {
                prefix: 'CON',
                seqStart: 8012,
                deptEnabled: true,
                entity: 'CORP'
            }
        }
    });
    console.log("✅ Seeded employee_code_engine system config");

    console.log("--- 🌱 SEEDING COMPLETE 🌱 ---");
    process.exit(0);
}

seed().catch(err => {
    console.error("❌ Seeding failed:", err);
    process.exit(1);
});
