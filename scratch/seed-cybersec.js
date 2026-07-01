const { db } = require('../config/firebase');

async function seedCyberSec() {
    console.log("--- Seeding Cybersecurity Recruits ---");

    // 1. Seed or Update John Smith
    const johnRef = db.collection('users').doc('FS_oa4x4yinz');
    await johnRef.set({
        uid: "FS_oa4x4yinz",
        name: "John Smith",
        fullName: "John Smith",
        email: "john@gmail.com",
        role: "employee",
        departmentCode: "UNIT-CYB-937",
        status: "Completed",
        onboardingStatus: "Active",
        designation: "IT Sec Analyst",
        department: "Cybersecurity",
        bankVerificationStatus: "Pending",
        onboardingStartedAt: new Date(Date.now() - 52 * 60 * 60 * 1000)
    }, { merge: true });
    console.log("✅ Seeded John Smith");

    // 2. Seed Jane Doe
    const janeRef = db.collection('users').doc('FS_cybersec_2');
    await janeRef.set({
        uid: "FS_cybersec_2",
        name: "Jane Doe",
        fullName: "Jane Doe",
        email: "jane.doe@example.com",
        role: "employee",
        departmentCode: "UNIT-CYB-937",
        status: "Completed",
        onboardingStatus: "Active",
        designation: "Cybersecurity Engineer",
        department: "Cybersecurity",
        bankVerificationStatus: "Pending",
        onboardingStartedAt: new Date(Date.now() - 48 * 60 * 60 * 1000)
    }, { merge: true });
    console.log("✅ Seeded Jane Doe");

    console.log("--- Seeding Complete ---");
    process.exit(0);
}

seedCyberSec().catch(err => {
    console.error(err);
    process.exit(1);
});
