const { db } = require('../config/firebase');
const eventBus = require('../services/event-bus');
const automationEngine = require('../services/automation-engine');
const logger = require('../utils/logger');

async function runLiveDemo() {
    console.log("==================================================");
    console.log("🚀 STARTING LIVE AUTOMATION ENGINE DEMO");
    console.log("==================================================\n");

    // 1. Start Engine
    automationEngine.start();
    console.log("Step 1: Automation Engine initialized & listening on EventBus ✅");

    // 2. Setup a Demo Automation Rule
    const demoRuleId = "demo-leave-rule";
    const demoRule = {
        name: "Urgent Leave Approval & Status Update",
        trigger_event: "demo.leave.requested",
        status: "active",
        conditions: {
            field: "days",
            op: ">=",
            value: 3
        },
        pipeline: [
            {
                type: "approval",
                title: "Manager Leave Approval",
                assignee_role: "manager",
                escalation_hours: 24,
                escalation_assignee: "hr_admin"
            },
            {
                type: "action",
                action: "update_firestore",
                params: {
                    collection: "users",
                    documentId: "{entityId}",
                    updates: { status: "on_leave" }
                }
            },
            {
                type: "notification",
                target: "hr_channel",
                message: "Leave has been approved by manager and user status set to on_leave."
            }
        ],
        updated_at: new Date().toISOString()
    };

    await db.collection('automations').doc(demoRuleId).set(demoRule);
    console.log(`Step 2: Rule [${demoRule.name}] registered in Firestore ✅`);

    // 3. Create a test user document to demonstrate the action step
    const testUserId = "test-user-demo-123";
    await db.collection('users').doc(testUserId).set({
        name: "Demo Employee",
        email: "demo@kylrx.com",
        status: "active"
    });
    console.log(`Step 3: Created test user document [${testUserId}] (Status: active) ✅`);

    // 4. Emit the Trigger Event
    console.log("\nStep 4: Emitting event 'demo.leave.requested' with 5 days leave...");
    const eventId = eventBus.emitEvent('demo.leave.requested', testUserId, 'employee', {
        employeeName: "Demo Employee",
        days: 5,
        reason: "Medical leave"
    });

    // Wait for the engine to evaluate condition, start run, and create the task
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 5. Query the created automation run by exact eventId
    const runsSnapshot = await db.collection('automation_runs')
        .where('event_id', '==', eventId)
        .get();

    if (runsSnapshot.empty) {
        console.error("❌ No automation run recorded.");
        process.exit(1);
    }

    const runData = runsSnapshot.docs[0].data();
    const runId = runData.run_id;
    console.log(`\nStep 5: Automation Run Created!`);
    console.log(`   - Run ID: ${runId}`);
    console.log(`   - Status: ${runData.status} (Paused waiting on manager approval) ⏸️`);

    // 6. Query the pending task
    const tasksSnapshot = await db.collection('tasks')
        .where('run_id', '==', runId)
        .get();

    if (tasksSnapshot.empty) {
        console.error("❌ Task was not created.");
        process.exit(1);
    }

    const taskData = tasksSnapshot.docs[0].data();
    const taskId = taskData.task_id;
    console.log(`\nStep 6: Pending Task Generated!`);
    console.log(`   - Task ID: ${taskId}`);
    console.log(`   - Title: ${taskData.title}`);
    console.log(`   - Assigned Role: ${taskData.assignee_role}`);
    console.log(`   - Task Status: ${taskData.status}`);

    // 7. Simulate Manager Approving the Task
    console.log("\nStep 7: Manager clicks [APPROVE] on the task...");
    await db.collection('tasks').doc(taskId).update({
        status: 'approved',
        resolved_at: new Date().toISOString(),
        resolution_notes: 'Approved by Manager'
    });

    // Resume the pipeline
    await automationEngine.resumePipeline(runId, {
        task_id: taskId,
        action: 'approved',
        notes: 'Approved by Manager'
    });

    await new Promise(resolve => setTimeout(resolve, 1500));

    // 8. Verify the Final State
    const updatedRunDoc = await db.collection('automation_runs').doc(runId).get();
    const finalRunData = updatedRunDoc.data();

    const updatedUserDoc = await db.collection('users').doc(testUserId).get();
    const finalUserData = updatedUserDoc.data();

    console.log("\n==================================================");
    console.log("🎉 PIPELINE EXECUTION COMPLETED!");
    console.log("==================================================");
    console.log(`   - Automation Run Status: ${finalRunData.status} ✅`);
    console.log(`   - User [${testUserId}] New Status: ${finalUserData.status} (Updated via Action step) ✅`);
    console.log("\n📜 Audit Trail / Logs:");
    finalRunData.logs.forEach((log, index) => {
        console.log(`   [${index + 1}] ${log.timestamp} - ${log.message} ${log.meta ? JSON.stringify(log.meta) : ''}`);
    });

    // Clean up demo docs
    await db.collection('automations').doc(demoRuleId).delete();
    await db.collection('users').doc(testUserId).delete();
    await db.collection('tasks').doc(taskId).delete();
    await db.collection('automation_runs').doc(runId).delete();

    console.log("\n🧹 Demo cleanup completed.");
    process.exit(0);
}

runLiveDemo().catch(err => {
    console.error("Demo failed:", err);
    process.exit(1);
});
