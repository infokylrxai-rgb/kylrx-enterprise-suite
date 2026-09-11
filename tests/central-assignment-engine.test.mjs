import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import assignmentEngine from '../services/central-assignment-engine.js';

describe('Central Configuration + Assignment Engine (Layer 3)', () => {

    beforeEach(() => {
        assignmentEngine.inMemoryConfig.clear();
        assignmentEngine.inMemoryHierarchy.clear();
    });

    it('should set and get central configurations with fallback', async () => {
        const fallback = await assignmentEngine.getConfig('non_existent_key', 42);
        assert.equal(fallback, 42);

        await assignmentEngine.setConfig('leave_annual_quota', 24, 'admin');
        const updated = await assignmentEngine.getConfig('leave_annual_quota');
        assert.equal(updated, 24);
    });

    it('should resolve reporting manager and HRBP dynamically', async () => {
        assignmentEngine.inMemoryHierarchy.set('EMP_101', 'MGR_VIKRAM');

        const manager = await assignmentEngine.resolveReportingManager('EMP_101');
        assert.equal(manager.managerId, 'MGR_VIKRAM');
        assert.equal(manager.email, 'mgr_vikram@kylrx.ai');

        const hrbp = await assignmentEngine.resolveHRBP('Engineering');
        assert.equal(hrbp.role, 'HRBP');
        assert.equal(hrbp.email, 'hrbp_tech@kylrx.ai');
    });

    it('should dynamically tier finance approvers based on disbursement amount', async () => {
        const tier1 = await assignmentEngine.resolveFinanceApprover(25000);
        assert.equal(tier1.level, 1);
        assert.equal(tier1.role, 'Finance Lead');

        const tier2 = await assignmentEngine.resolveFinanceApprover(250000);
        assert.equal(tier2.level, 2);
        assert.equal(tier2.role, 'Head of Finance');

        const tier3 = await assignmentEngine.resolveFinanceApprover(2500000);
        assert.equal(tier3.level, 3);
        assert.equal(tier3.role, 'CFO / Super Admin');
    });

    it('should resolve multi-tier approval chains for exit, leave, and payroll', async () => {
        // Exit chain: Manager -> HRBP -> HR Admin -> Payroll
        const exitChain = await assignmentEngine.resolveApprovalChain('exit_offboarding', 'EMP_101', { department: 'Engineering' });
        assert.equal(exitChain.length, 4);
        assert.equal(exitChain[0].role, 'Reporting Manager');
        assert.equal(exitChain[1].role, 'HRBP');
        assert.equal(exitChain[2].role, 'HR Admin');
        assert.equal(exitChain[3].role, 'Payroll Lead');

        // Short leave (2 days): Single tier (Reporting Manager)
        const shortLeaveChain = await assignmentEngine.resolveApprovalChain('leave_attendance', 'EMP_101', { daysCount: 2 });
        assert.equal(shortLeaveChain.length, 1);
        assert.equal(shortLeaveChain[0].role, 'Reporting Manager');

        // Extended leave (10 days): Dual tier (Reporting Manager + HRBP)
        const longLeaveChain = await assignmentEngine.resolveApprovalChain('leave_attendance', 'EMP_101', { daysCount: 10, department: 'Engineering' });
        assert.equal(longLeaveChain.length, 2);
        assert.equal(longLeaveChain[1].role, 'HRBP');
    });

    it('should safely reassign reporting hierarchies and reject circular loops', async () => {
        // Set hierarchy: EMP_A -> MGR_B -> DIR_C
        assignmentEngine.inMemoryHierarchy.set('EMP_A', 'MGR_B');
        assignmentEngine.inMemoryHierarchy.set('MGR_B', 'DIR_C');

        // Reassign EMP_A to report directly to DIR_C
        const res = await assignmentEngine.reassignReportingHierarchy('MGR_B', 'DIR_C', ['EMP_A']);
        assert.equal(res.success, true);
        assert.equal(res.reassignedCount, 1);

        const newMgr = await assignmentEngine.resolveReportingManager('EMP_A');
        assert.equal(newMgr.managerId, 'DIR_C');

        // Attempt circular assignment: DIR_C reporting to EMP_A should throw
        await assert.rejects(
            async () => {
                await assignmentEngine.reassignReportingHierarchy('SOME_MGR', 'EMP_A', ['DIR_C']);
            },
            /Circular hierarchy detected/
        );
    });
});
