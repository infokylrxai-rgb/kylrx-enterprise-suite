const { db } = require('../config/firebase');

async function seed() {
    try {
        console.log('🌱 Seeding sample automation rule...');
        
        const exitRule = {
            name: 'Full-Time Employee Exit Workflow',
            trigger_event: 'resignation.submitted',
            status: 'active',
            conditions: {
                operator: 'AND',
                rules: [
                    { field: 'employee_type', op: '==', value: 'Full-Time' }
                ]
            },
            pipeline: [
                {
                    type: 'approval',
                    title: 'Manager Exit Approval',
                    description: 'Review and approve employee resignation.',
                    assignee_role: 'manager',
                    assignee_id: '{entityId}_manager',
                    escalation_hours: 48,
                    escalation_assignee: 'hr_admin'
                },
                {
                    type: 'action',
                    action: 'update_firestore',
                    params: {
                        collection: 'users',
                        documentId: '{entityId}',
                        updates: { status: 'offboarding_in_progress' }
                    }
                },
                {
                    type: 'notification',
                    target: 'it_department',
                    message: 'Please begin revoking access for departing employee.'
                }
            ],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        const docRef = await db.collection('automations').add(exitRule);
        console.log(`✅ Sample automation created with ID: ${docRef.id}`);

        console.log('\n--- HOW TO TEST THIS AUTOMATION ---');
        console.log('1. Start your server (if not already running): npm start');
        console.log('2. In another terminal, run this curl command to fire the trigger:');
        console.log(`
curl -X POST http://localhost:3000/api/automations/test-trigger \\
-H "Content-Type: application/json" \\
-d '{
  "eventName": "resignation.submitted",
  "entityId": "emp_12345",
  "entityType": "employee",
  "payload": {
    "employee_type": "Full-Time",
    "department": "Engineering"
  }
}'
        `);
        console.log('3. Check Firestore `automation_runs` and `tasks` collections to observe the workflow steps.');
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error seeding automation:', error);
        process.exit(1);
    }
}

seed();
