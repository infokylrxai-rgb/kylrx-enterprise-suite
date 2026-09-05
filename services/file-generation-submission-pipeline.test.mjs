import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FileGenerationSubmissionPipeline,
  PipelinePreconditionError,
  FinancialDriftError,
  SubmissionSecurityError,
  DuplicateSubmissionError,
  computeSha256,
} from './file-generation-submission-pipeline.mjs';

test('📦 KYLRX AI FILE GENERATION & PRE-SUBMISSION PIPELINE TEST SUITE', async (t) => {
  const pipeline = new FileGenerationSubmissionPipeline();

  await t.test('1. Pre-Condition Checks: Batch Must Be Strictly APPROVED', async () => {
    const unapprovedBatch = {
      batch_id: 'BATCH-SAL-001',
      batch_type: 'SALARY',
      status: 'PENDING_APPROVAL',
      summary: { total_amount: 100000 },
    };

    await assert.rejects(
      async () => {
        await pipeline.compilePayoutFile({
          batch: unapprovedBatch,
          records: [{ employee_id: 'EMP001', net_payable_amount: 100000 }],
        });
      },
      (err) => {
        assert(err instanceof PipelinePreconditionError);
        assert.equal(err.statusCode, 412);
        assert.match(err.message, /strictly 'APPROVED'/);
        return true;
      }
    );
  });

  await t.test('2. Pre-Condition Checks: Financial Drift Rejection', async () => {
    const approvedBatch = {
      batch_id: 'BATCH-SAL-002',
      batch_type: 'SALARY',
      status: 'APPROVED',
      approved_snapshot: {
        total_amount: 54000,
        gross_payroll: 60000,
        employee_deductions: 6000,
      },
    };

    // Tampered records where net drifted to 58000
    const driftedRecords = [
      { employee_id: 'EMP001', gross: 65000, deductions: 7000, net: 58000 },
    ];

    await assert.rejects(
      async () => {
        await pipeline.compilePayoutFile({
          batch: approvedBatch,
          records: driftedRecords,
        });
      },
      (err) => {
        assert(err instanceof FinancialDriftError);
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /Financial Drift Detected/);
        assert.equal(err.driftDetails.baseline_net, 54000);
        assert.equal(err.driftDetails.current_net, 58000);
        return true;
      }
    );
  });

  await t.test('3. Pre-Condition Checks: Unresolved BLOCKING Validation Issues Rejection', async () => {
    const approvedBatch = {
      batch_id: 'BATCH-SAL-003',
      batch_type: 'SALARY',
      status: 'APPROVED',
      approved_snapshot: { total_amount: 45000 },
    };

    const records = [{ employee_id: 'EMP001', net: 45000 }];
    const blockingIssues = [
      { id: 'ISS_01', code: 'GATE_04_IFSC_REGEX', severity: 'BLOCKING', resolved: false },
    ];

    await assert.rejects(
      async () => {
        await pipeline.compilePayoutFile({
          batch: approvedBatch,
          records,
          validationIssues: blockingIssues,
        });
      },
      (err) => {
        assert(err instanceof PipelinePreconditionError);
        assert.equal(err.statusCode, 412);
        assert.match(err.message, /unresolved BLOCKING validation issue/);
        return true;
      }
    );
  });

  await t.test('4. Format & Cryptographic Checksum Compilers: Salary, PF, ESIC, and NPS', async () => {
    // A. SALARY NEFT CSV
    const salBatch = { batch_id: 'BATCH-SAL-SEP', batch_type: 'SALARY', status: 'APPROVED', approved_snapshot: { total_amount: 90000 } };
    const salRecords = [
      { employee_id: 'EMP001', employee_name: 'Abhishek Rai', account_number: '50100492819200', ifsc_code: 'SBIN0001234', net: 50000 },
      { employee_id: 'EMP002', employee_name: 'Rohit Kumar', account_number: '50100492819201', ifsc_code: 'HDFC0001234', net: 40000 },
    ];

    const salFile = await pipeline.compilePayoutFile({ batch: salBatch, records: salRecords, payoutDate: '2026-09-30' });
    assert.equal(salFile.batch_type, 'SALARY');
    assert.equal(salFile.file_extension, 'csv');
    assert.equal(salFile.total_amount, 90000);
    assert.equal(salFile.checksum, computeSha256(salFile.content));
    assert(salFile.content.includes('Transaction Reference,Beneficiary Name,Beneficiary Account Number'));
    assert(salFile.content.includes('SBIN0001234,50000.00,2026-09-30'));

    // B. PF ECR TXT
    const pfBatch = { batch_id: 'BATCH-PF-SEP', batch_type: 'PF', status: 'APPROVED', approved_snapshot: { total_amount: 3600 } };
    const pfRecords = [
      { uan: '100112233445', employee_name: 'Abhishek Rai', gross_wages: 15000 },
    ];
    const pfFile = await pipeline.compilePayoutFile({ batch: pfBatch, records: pfRecords });
    assert.equal(pfFile.batch_type, 'PF');
    assert.equal(pfFile.file_extension, 'txt');
    assert(pfFile.content.includes('100112233445#~#Abhishek Rai#~#15000#~#15000#~#15000#~#15000#~#1800#~#1250#~#550#~#0#~#0'));
    assert.equal(pfFile.checksum, computeSha256(pfFile.content));

    // C. ESIC CSV
    const esicBatch = { batch_id: 'BATCH-ESIC-SEP', batch_type: 'ESIC', status: 'APPROVED', approved_snapshot: { total_amount: 800 } };
    const esicRecords = [
      { esic_ip_number: '3100998877', employee_name: 'Rohit Kumar', gross_wages: 20000, days_worked: 30 },
    ];
    const esicFile = await pipeline.compilePayoutFile({ batch: esicBatch, records: esicRecords });
    assert.equal(esicFile.batch_type, 'ESIC');
    assert(esicFile.content.includes('IP Number,IP Name,No of Days for which wages paid'));
    assert(esicFile.content.includes('3100998877,"Rohit Kumar",30,20000.00,,'));
    assert.equal(esicFile.checksum, computeSha256(esicFile.content));

    // D. NPS SCF TXT
    const npsBatch = { batch_id: 'BATCH-NPS-SEP', batch_type: 'NPS', status: 'APPROVED', approved_snapshot: { total_amount: 10000 } };
    const npsRecords = [
      { pran: '110099887766', employee_name: 'Sneha Sharma', nps_ee_contribution: 5000, nps_er_contribution: 5000 },
    ];
    const npsFile = await pipeline.compilePayoutFile({ batch: npsBatch, records: npsRecords });
    assert.equal(npsFile.batch_type, 'NPS');
    assert(npsFile.content.includes('FH^NPS^KYLRX_CORP'));
    assert(npsFile.content.includes('BH^1^1^KYLRX_NPS_SEP2026'));
    assert(npsFile.content.includes('SD^1^110099887766^Sneha Sharma^5000^5000^10000'));
    assert(npsFile.content.includes('FT^1^1^10000'));
    assert.equal(npsFile.checksum, computeSha256(npsFile.content));
  });

  await t.test('5. Submission Guard: Missing Checksum, Tampering, and Duplicate Submissions', async () => {
    const subPipeline = new FileGenerationSubmissionPipeline();
    const batch = { batch_id: 'BATCH-SUB-001', batch_type: 'SALARY', status: 'APPROVED', approved_snapshot: { total_amount: 50000 } };
    const records = [{ employee_id: 'EMP001', account_number: '50100411223344', ifsc_code: 'SBIN0001234', net: 50000 }];

    const compiledFile = await subPipeline.compilePayoutFile({ batch, records });

    // ❌ Tampered Checksum rejection
    const tamperedFile = { ...compiledFile, checksum: 'tampered_fake_sha256_hash_1234567890abcdef' };
    await assert.rejects(
      async () => {
        await subPipeline.validateAndExecuteSubmission({
          batch,
          compiledFile: tamperedFile,
          requestingUser: { user_id: 'OPERATOR_1' },
          submissionChannel: 'HDFC_HOST_TO_HOST',
        });
      },
      (err) => {
        assert(err instanceof SubmissionSecurityError);
        assert.match(err.message, /Checksum mismatch/);
        return true;
      }
    );

    // ✅ First successful submission
    const subResult1 = await subPipeline.validateAndExecuteSubmission({
      batch,
      compiledFile,
      requestingUser: { user_id: 'OPERATOR_1' },
      submissionChannel: 'HDFC_HOST_TO_HOST',
    });

    assert.equal(subResult1.success, true);
    assert.equal(subResult1.new_batch_state, 'SUBMITTED');
    assert.equal(subResult1.submission_log.status, 'SUBMITTED');

    // ❌ Duplicate submission rejection
    await assert.rejects(
      async () => {
        await subPipeline.validateAndExecuteSubmission({
          batch,
          compiledFile,
          requestingUser: { user_id: 'OPERATOR_1' },
          submissionChannel: 'HDFC_HOST_TO_HOST',
        });
      },
      (err) => {
        assert(err instanceof DuplicateSubmissionError);
        assert.equal(err.statusCode, 409);
        assert.match(err.message, /Duplicate Submission Detected/);
        return true;
      }
    );
  });

});
