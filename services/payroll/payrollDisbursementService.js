/**
 * ============================================================================
 * KYLRX.AI ENTERPRISE HRMS - PAYROLL DISBURSEMENT SERVICE
 * ============================================================================
 * Strict Separation of Concerns (PRD Section 4):
 * Manages payout calculations, Cashfree payment batches, maker-checker
 * authorization, bank response reconciliation, and fund disbursement state transitions.
 *
 * CRITICAL ARCHITECTURAL BOUNDARY:
 * This service contains ZERO PDF, Excel, or document rendering logic.
 * It is completely decoupled from document generation pipelines.
 *
 * Cashfree Payouts Integration:
 *  - Provider adapter: services/payroll/cashfreePayoutProvider.js (v1 + v2)
 *  - Sourcing schema: 'Employee Finance Deatils' (Account_Holder_Name,
 *    Bank_Name, Account_Number, IFSC, Account_Type, Is_Primary)
 *  - 4-Eyes Maker-Checker authorization gate
 *  - Deterministic transfer ids => a retry can never pay an employee twice
 *  - Signed webhook listener with DURABLE (Firestore) idempotency
 *  - Status polling fallback so a missed webhook never strands a payout
 * ============================================================================
 */

const crypto = require('crypto');
const { CashfreePayoutProvider, CashfreeApiError } = require('./cashfreePayoutProvider');

// Optional Firebase Admin reference with safe fallback
let admin, db;
try {
  ({ admin, db } = require('../../config/firebase'));
} catch (e) {
  // Graceful fallback for non-configured environments
}

/**
 * Custom Error Classes for Clean Error Boundaries
 */
class MakerCheckerViolationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MakerCheckerViolationError';
    this.statusCode = 403;
    this.details = details;
  }
}

/** Raised when a payout cannot proceed for a business reason (not a gateway fault). */
class PayoutValidationError extends Error {
  constructor(message, status = 400, details = {}) {
    super(message);
    this.name = 'PayoutValidationError';
    this.statusCode = status;
    this.details = details;
  }
}

async function safeDb(promise, timeoutMs = 800) {
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('db timeout')), timeoutMs));
    await Promise.race([promise, timeout]);
  } catch (err) {
    console.warn(`[DISBURSE_DB] Non-blocking notice: ${err.message}`);
  }
}

async function safeDbGet(promise, timeoutMs = 800) {
  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('db get timeout')), timeoutMs));
    return await Promise.race([promise, timeout]);
  } catch (err) {
    return null;
  }
}

class PayrollDisbursementService {
  constructor(options = {}) {
    // Production must never run on blank secrets (they would validate forged callbacks)
    if (process.env.NODE_ENV === 'production') {
      const missing = [['clientId', 'CASHFREE_CLIENT_ID'], ['clientSecret', 'CASHFREE_CLIENT_SECRET']]
        .filter(([opt, env]) => !options[opt] && !process.env[env]).map(([, env]) => env);
      if (missing.length) throw new Error(`Missing required environment variable(s) in production: ${missing.join(', ')}`);
    }
    this.db = options.db !== undefined ? options.db : (process.env.NODE_ENV === 'test' ? null : db);

    // Cashfree Payouts adapter (injectable so tests can supply a fake gateway)
    this.provider = options.provider || new CashfreePayoutProvider({
      apiVersion: options.apiVersion,
      environment: options.environment,
      baseUrl: options.baseUrl,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      webhookSecret: options.webhookSecret,
      fetch: options.fetch
    });

    // How many transfers to dispatch concurrently (keeps big payrolls fast without
    // hammering the gateway or tripping rate limits).
    this.concurrency = Number(options.concurrency || process.env.CASHFREE_CONCURRENCY || 5);
    // Refuse to dispatch if the Cashfree balance cannot cover the batch.
    this.enforceBalanceCheck = options.enforceBalanceCheck !== false;
    // FAIL-SAFE: signature verification is ON everywhere by default. Keying it off
    // NODE_ENV would silently disable it on any host where NODE_ENV is unset/mistyped,
    // leaving a forged "SUCCESS" able to mark payroll paid. Opt out only, never opt in.
    this.requireWebhookSignature = options.requireWebhookSignature !== undefined
      ? options.requireWebhookSignature
      : process.env.CASHFREE_WEBHOOK_INSECURE !== 'true';

    // In-memory ledger for tests / fallback when Firestore is mock or offline
    this._localBatches = new Map();
    this._processedWebhooks = new Set();
  }

  /** Deterministic, Cashfree-safe transfer id. Same batch+employee => same id => never double-paid. */
  buildTransferId(batchId, record) {
    const raw = `${batchId}-${record.employeeId || record.instructionId}`;
    return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  }

  /** Cashfree beneficiary id derived from the employee (stable across payroll runs). */
  buildBeneficiaryId(record) {
    const raw = `EMP-${record.employeeId || record.instructionId}`;
    return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  }

  /**
   * Helper: Exponential Backoff Retry Executor
   */
  async executeWithRetry(fn, { maxRetries = 3, baseDelayMs = 300, factor = 2 } = {}) {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        return await fn();
      } catch (err) {
        // Only transient faults (network/timeout/429/5xx) are safe to retry. Retrying a
        // business rejection just burns time, and retrying a non-idempotent call risks
        // a double payment — the provider marks which errors are retryable.
        if (err && err.retryable === false) throw err;
        attempt++;
        if (attempt >= maxRetries) throw err;
        const delay = baseDelayMs * Math.pow(factor, attempt - 1);
        await new Promise(res => setTimeout(res, delay));
      }
    }
  }

  /**
   * Normalizes employee financial details strictly conforming to
   * the 'Employee Finance Deatils' sheet schema.
   */
  extractBeneficiaryDetails(financeData = {}) {
    // Support casing and aliases
    const accountHolderName = financeData.Account_Holder_Name || financeData.accountHolderName || financeData.name || '';
    const bankName = financeData.Bank_Name || financeData.bankName || '';
    const accountNumber = String(financeData.Account_Number || financeData.accountNumber || '').trim();
    const ifsc = String(financeData.IFSC || financeData.ifscCode || financeData.ifsc || '').trim().toUpperCase();
    const accountType = (financeData.Account_Type || financeData.accountType || 'SAVINGS').toUpperCase();
    const isPrimaryVal = financeData.Is_Primary !== undefined ? financeData.Is_Primary : financeData.isPrimary;
    const isPrimary = isPrimaryVal === true || String(isPrimaryVal).toLowerCase() === 'yes' || String(isPrimaryVal).toLowerCase() === 'y';

    const errors = [];
    if (!accountHolderName) errors.push("Missing 'Account_Holder_Name'");
    if (!accountNumber || accountNumber.length < 8) errors.push("Invalid 'Account_Number'");
    if (!ifsc || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) errors.push(`Invalid 'IFSC' format: ${ifsc}`);

    return {
      isValid: errors.length === 0,
      errors,
      beneficiary: {
        Account_Holder_Name: accountHolderName,
        Bank_Name: bankName,
        Account_Number: accountNumber,
        IFSC: ifsc,
        Account_Type: accountType,
        Is_Primary: isPrimary,
        accountHolderName,
        bankName,
        accountNumber,
        ifsc,
        accountType,
        isPrimary
      }
    };
  }

  /**
   * Creates a New Payroll Payout Batch in DRAFT / PENDING_APPROVAL state.
   * Enforces 4-Eyes Maker record.
   */
  async createDisbursementBatch({
    batchId = `DISB-${Date.now()}`,
    period = 'September 2026',
    makerId,
    orgId = null,
    payoutChannel = 'IMPS', // IMPS, NEFT, RTGS
    employees = []
  }) {
    if (!makerId) {
      throw new Error("Maker ID is required to initiate a payout batch (4-Eyes Maker-Checker principle).");
    }

    const validChannels = ['IMPS', 'NEFT', 'RTGS'];
    if (!validChannels.includes(payoutChannel.toUpperCase())) {
      throw new Error(`Invalid payout channel: ${payoutChannel}. Must be one of: ${validChannels.join(', ')}`);
    }

    let totalAmount = 0;
    const records = employees.map((emp, idx) => {
      const finance = this.extractBeneficiaryDetails(emp.financeDetails || emp.bankDetails || emp);
      const netPayable = Number(emp.netPayable || emp.netSalary || emp.salary || 0);
      totalAmount += netPayable;

      return {
        instructionId: `INST-${batchId}-${idx + 1}`,
        orgId,
        employeeId: emp.id || emp.employeeId || `EMP${String(idx + 1).padStart(4, '0')}`,
        employeeName: emp.name || emp.employeeName || 'Staff Member',
        amount: netPayable,
        currency: 'INR',
        channel: payoutChannel.toUpperCase(),
        beneficiary: finance.beneficiary,
        isBeneficiaryValid: finance.isValid,
        validationErrors: finance.errors,
        status: finance.isValid ? 'READY' : 'INVALID_BENEFICIARY',
        cashfreeTransferId: null,
        providerReferenceId: null,
        utr: null,
        failureReason: null,
        reconciledAt: null
      };
    });

    const batchRecord = {
      batchId,
      // Tenant tag. routes/payroll.js lists batches with orgDocs(), which filters on
      // orgId, so an untagged batch is invisible to the org that created it.
      orgId,
      period,
      payoutChannel: payoutChannel.toUpperCase(),
      status: 'PENDING_APPROVAL',
      maker: {
        makerId,
        initiatedAt: new Date().toISOString()
      },
      checker: null,
      summary: {
        totalRecords: records.length,
        validRecords: records.filter(r => r.isBeneficiaryValid).length,
        invalidRecords: records.filter(r => !r.isBeneficiaryValid).length,
        totalAmount,
        currency: 'INR'
      },
      records,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Store in Firestore and memory
    this._localBatches.set(batchId, batchRecord);

    // Persist BEFORE any money can move, and fail LOUDLY if we cannot. Records go to a
    // subcollection: a single document would hit Firestore's 1 MiB cap at ~1340 staff,
    // and the old code swallowed that rejection, disbursing a payroll it never recorded.
    await this._persistBatch(batchRecord, records, { strict: true });

    return batchRecord;
  }

  /**
   * 4-Eyes Maker-Checker Authorization Gate
   * Requires checkerId !== makerId
   */
  async approveDisbursementBatch(batchId, checkerId, notes = 'Approved for banking transfer') {
    if (!checkerId) {
      throw new MakerCheckerViolationError("Checker ID is required for 4-Eyes authorization.");
    }

    let batch = this._localBatches.get(batchId);
    if (!batch) batch = await this._loadBatch(batchId);

    if (!batch) {
      throw new Error(`Disbursement batch ${batchId} not found.`);
    }

    if (batch.status === 'APPROVED' || batch.status === 'DISBURSED') {
      return { success: true, message: `Batch ${batchId} is already approved.`, batch };
    }

    // STRICT 4-EYES RULE: Maker cannot approve their own batch
    if (batch.maker && batch.maker.makerId === checkerId) {
      throw new MakerCheckerViolationError(
        `4-Eyes Violation: Maker (${checkerId}) cannot approve their own disbursement batch. A distinct checker is required.`,
        { batchId, makerId: batch.maker.makerId, checkerId }
      );
    }

    batch.status = 'APPROVED';
    batch.checker = {
      checkerId,
      approvedAt: new Date().toISOString(),
      notes
    };
    batch.updatedAt = new Date().toISOString();

    this._localBatches.set(batchId, batch);

    if (this.db && typeof this.db.collection === 'function') {
      await safeDb(Promise.all([
        this.db.collection('disbursement_batches').doc(batchId).set(this._batchMeta(batch), { merge: true }),
        this.db.collection('audit_logs').add({
          action: 'DISBURSEMENT_BATCH_APPROVED',
          batchId,
          makerId: batch.maker?.makerId,
          checkerId,
          timestamp: new Date().toISOString()
        })
      ]));
    }

    return {
      success: true,
      batchId,
      status: 'APPROVED',
      approvedBy: checkerId,
      batch
    };
  }

  /**
   * Dispatches Payout Batch to Cashfree Payouts.
   * Requires batch.status === 'APPROVED'.
   */
  async executeCashfreePayoutBatch(batchId, options = {}) {
    let batch = this._localBatches.get(batchId);
    if (!batch) batch = await this._loadBatch(batchId);

    if (!batch) {
      throw new Error(`Disbursement batch ${batchId} not found.`);
    }

    // Enforce 4-Eyes approval check before payout execution
    if (batch.status !== 'APPROVED') {
      throw new MakerCheckerViolationError(
        `Batch ${batchId} cannot be disbursed. Current status: ${batch.status}. It must be APPROVED by a distinct checker first.`,
        { batchId, status: batch.status }
      );
    }

    const validRecords = batch.records.filter(r => r.isBeneficiaryValid && r.amount > 0);
    if (!validRecords.length) {
      throw new PayoutValidationError(`Batch ${batchId} has no payable records with a valid beneficiary.`, 422, { batchId });
    }

    // Guard: never start a payroll run the Cashfree balance cannot cover. A part-paid
    // payroll is the single most painful failure mode, so we stop before the first debit.
    if (this.enforceBalanceCheck && options.skipBalanceCheck !== true) {
      const required = validRecords.reduce((sum, r) => sum + Number(r.amount || 0), 0);
      try {
        const { availableBalance } = await this.provider.getBalance();
        if (Number.isFinite(availableBalance) && availableBalance > 0 && availableBalance < required) {
          throw new PayoutValidationError(
            `Insufficient Cashfree balance: available ₹${availableBalance}, required ₹${required}. Fund the payout account and retry.`,
            402, { batchId, availableBalance, required }
          );
        }
      } catch (err) {
        if (err instanceof PayoutValidationError) throw err;
        // A balance hiccup, or an unconfigured fund source, must not block payroll.
        console.warn(`[DISBURSE] Balance pre-check skipped: ${err.message}`);
      }
    }

    batch.status = 'DISBURSING';
    this._localBatches.set(batchId, batch);

    const executionResults = [];

    // Dispatch with bounded concurrency. Each transfer is individually idempotent.
    const queue = [...validRecords];
    const runWorker = async () => {
      while (queue.length) {
        const record = queue.shift();
        executionResults.push(await this._dispatchRecord(record, batch));
      }
    };
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(this.concurrency, queue.length)) }, runWorker)
    );

    batch.status = this._deriveBatchStatus(batch);
    batch.updatedAt = new Date().toISOString();
    const persisted = await this._chunkedBatchSave(batch, validRecords);

    return {
      success: true,
      persisted: persisted.ok,
      persistError: persisted.error,
      batchId,
      status: batch.status,
      totalDispatched: executionResults.length,
      succeeded: executionResults.filter(r => r.status === 'SUCCESS').length,
      pending: executionResults.filter(r => r.status === 'PENDING').length,
      failed: executionResults.filter(r => r.status === 'FAILURE').length,
      gateway: `Cashfree Payouts (${this.provider.apiVersion}/${this.provider.environment})`,
      results: executionResults
    };
  }

  /**
   * Registers the beneficiary then fires ONE idempotent transfer.
   * Retries only transient faults — a business rejection is never retried, and the
   * deterministic transfer id means even a retried network timeout cannot double-pay.
   */
  async _dispatchRecord(record, batch) {
    const transferId = this.buildTransferId(batch.batchId, record);
    const beneficiaryId = this.buildBeneficiaryId(record);
    record.cashfreeTransferId = transferId;

    try {
      // ensureBeneficiary can resolve to a DIFFERENT id when the bank account is already
      // registered at Cashfree, so always transfer against the id it hands back.
      const beneResult = await this.executeWithRetry(() => this.provider.ensureBeneficiary({
        beneficiaryId,
        name: record.beneficiary.Account_Holder_Name,
        accountNumber: record.beneficiary.Account_Number,
        ifsc: record.beneficiary.IFSC
      }));
      const effectiveBeneficiaryId = (beneResult && beneResult.beneficiaryId) || beneficiaryId;
      record.beneficiaryId = effectiveBeneficiaryId;

      const result = await this.executeWithRetry(() => this.provider.createTransfer({
        transferId,
        beneficiaryId: effectiveBeneficiaryId,
        amount: record.amount,
        mode: record.channel,
        remarks: `Salary ${batch.period}`.slice(0, 60)
      }));

      record.status = result.status;                       // SUCCESS | PENDING | FAILURE | REVERSED
      record.providerReferenceId = result.providerReferenceId || null;
      record.utr = result.utr || null;
      record.failureReason = result.status === 'FAILURE' ? (result.message || 'Rejected by gateway') : null;
      record.dispatchedAt = new Date().toISOString();
      return {
        instructionId: record.instructionId,
        employeeId: record.employeeId,
        transferId,
        status: record.status,
        utr: record.utr,
        amount: record.amount,
        channel: record.channel
      };
    } catch (err) {
      // Gateway/business failure for THIS employee must not abort the whole payroll.
      record.status = 'FAILURE';
      record.failureReason = err.message;
      record.dispatchedAt = new Date().toISOString();
      console.error(`[DISBURSE] Transfer ${transferId} failed: ${err.message}`);
      return {
        instructionId: record.instructionId,
        employeeId: record.employeeId,
        transferId,
        status: 'FAILURE',
        error: err.message,
        amount: record.amount,
        channel: record.channel
      };
    }
  }

  /** DISBURSED only when every record settled successfully. */
  _deriveBatchStatus(batch) {
    const records = batch.records.filter(r => r.isBeneficiaryValid && r.amount > 0);
    if (!records.length) return batch.status;
    if (records.every(r => r.status === 'SUCCESS')) return 'DISBURSED';
    if (records.some(r => r.status === 'PENDING')) return 'DISBURSING';
    if (records.some(r => r.status === 'SUCCESS')) return 'PARTIALLY_RECONCILED';
    return 'FAILED';
  }

  /**
   * Polling fallback: if a webhook is dropped, this pulls the authoritative state from
   * Cashfree so a payout can never sit "PENDING" forever. Safe to run on a schedule.
   */
  async reconcilePendingTransfers(batchId) {
    const batch = await this.getBatch(batchId);
    if (!batch) throw new Error(`Disbursement batch ${batchId} not found.`);

    const pending = batch.records.filter(r => r.status === 'PENDING' && r.cashfreeTransferId);
    const updated = [];
    const dirty = [];
    for (const record of pending) {
      try {
        const result = await this.provider.getTransferStatus(record.cashfreeTransferId);
        if (result.status !== record.status) {
          record.status = result.status;
          record.utr = result.utr || record.utr;
          record.providerReferenceId = result.providerReferenceId || record.providerReferenceId;
          record.failureReason = result.status === 'FAILURE' ? (result.message || 'Rejected by gateway') : null;
          record.reconciledAt = new Date().toISOString();
          updated.push({ transferId: record.cashfreeTransferId, status: record.status, utr: record.utr });
          dirty.push(record);
        }
      } catch (err) {
        console.warn(`[DISBURSE] Poll failed for ${record.cashfreeTransferId}: ${err.message}`);
      }
    }

    if (updated.length) {
      batch.status = this._deriveBatchStatus(batch);
      batch.updatedAt = new Date().toISOString();
      this._localBatches.set(batchId, batch);
      await this._chunkedBatchSave(batch, dirty);
    }
    return { batchId, checked: pending.length, updated: updated.length, changes: updated, status: batch.status };
  }

  /**
   * Durable idempotency. The previous in-memory Set forgot everything on restart and was
   * not shared between instances, so a replayed webhook could re-apply after a deploy.
   * Firestore makes the guard survive restarts and work across horizontally-scaled nodes.
   */
  async _alreadyProcessed(idempotencyKey) {
    if (this._processedWebhooks.has(idempotencyKey)) return true;
    if (this.db && typeof this.db.collection === 'function') {
      const snap = await safeDbGet(this.db.collection('webhook_idempotency').doc(idempotencyKey).get());
      if (snap && snap.exists) {
        this._processedWebhooks.add(idempotencyKey);
        return true;
      }
    }
    return false;
  }

  async _markProcessed(idempotencyKey, meta = {}) {
    this._processedWebhooks.add(idempotencyKey);
    if (this.db && typeof this.db.collection === 'function') {
      await safeDb(this.db.collection('webhook_idempotency').doc(idempotencyKey).set({
        ...meta, processedAt: new Date().toISOString()
      }, { merge: true }));
    }
  }

  /**
   * Cashfree webhook listener.
   *
   * SECURITY: the signature is verified before any state changes. Without this an
   * attacker could POST a forged "SUCCESS" and mark an unpaid payroll as disbursed.
   * Pass the EXACT raw request body — re-serialised JSON will not match the HMAC.
   */
  async handleCashfreeWebhook({ rawBody, signature, timestamp, payload } = {}) {
    const body = payload || (typeof rawBody === 'string' ? JSON.parse(rawBody || '{}') : (rawBody || {}));

    if (this.requireWebhookSignature) {
      const valid = this.provider.verifyWebhookSignature(
        typeof rawBody === 'string' ? rawBody : JSON.stringify(body),
        signature,
        timestamp
      );
      if (!valid) {
        throw new PayoutValidationError('Cashfree webhook rejected: invalid or missing signature.', 401);
      }
    }

    const event = CashfreePayoutProvider.parseWebhook(body);
    if (!event.transferId) {
      throw new PayoutValidationError('Invalid webhook payload: missing transfer_id.', 400);
    }

    const idempotencyKey = `cashfree_${event.transferId}_${event.status}`;
    if (await this._alreadyProcessed(idempotencyKey)) {
      return { success: true, idempotent: true, message: `Webhook ${idempotencyKey} already processed.` };
    }

    let reconciledRecord = null;
    let matchedBatchId = null;

    const applyTo = (bId, batch) => {
      const found = batch.records.find(r => r.cashfreeTransferId === event.transferId);
      if (!found) return false;
      // Never regress a settled payment back to PENDING on an out-of-order delivery.
      const isTerminal = ['SUCCESS', 'FAILURE', 'REVERSED'].includes(found.status);
      if (!(isTerminal && event.status === 'PENDING')) {
        found.status = event.status;
        found.utr = event.utr || found.utr;
        found.providerReferenceId = event.providerReferenceId || found.providerReferenceId;
        found.failureReason = event.status === 'FAILURE' ? (event.message || 'Rejected by gateway') : null;
        found.reconciledAt = new Date().toISOString();
        found.webhookResponse = { rawStatus: event.rawStatus, message: event.message || null };
      }
      batch.status = this._deriveBatchStatus(batch);
      batch.updatedAt = new Date().toISOString();
      reconciledRecord = found;
      matchedBatchId = bId;
      return true;
    };

    // Local ledger first, then Firestore (so a webhook still lands after a restart).
    let hit = false;
    for (const [bId, batch] of this._localBatches.entries()) {
      if (applyTo(bId, batch)) { hit = true; break; }
    }
    if (!hit && this.db && typeof this.db.collection === 'function') {
      const batchId = String(event.transferId).split('-').slice(0, -1).join('-');
      const batch = await this._loadBatch(batchId);
      if (batch) {
        if (applyTo(batchId, batch)) {
          this._localBatches.set(batchId, batch);
          hit = true;
        }
      }
    }

    await this._markProcessed(idempotencyKey, { transferId: event.transferId, status: event.status, batchId: matchedBatchId });

    if (matchedBatchId) {
      // Only the reconciled record is rewritten; rewriting all of them would cost N
      // writes per callback, i.e. N^2 writes per payroll run.
      await this._chunkedBatchSave(this._localBatches.get(matchedBatchId), reconciledRecord ? [reconciledRecord] : []);
    }
    if (this.db && typeof this.db.collection === 'function') {
      await safeDb(this.db.collection('webhook_audit_logs').add({
        gateway: 'Cashfree Payouts',
        transferId: event.transferId,
        providerReferenceId: event.providerReferenceId,
        status: event.status,
        rawStatus: event.rawStatus,
        matched: Boolean(matchedBatchId),
        timestamp: new Date().toISOString()
      }));
    }

    return {
      success: true,
      idempotent: false,
      matched: Boolean(matchedBatchId),
      batchId: matchedBatchId,
      transferId: event.transferId,
      reconciledStatus: event.status,
      reconciledRecord
    };
  }

  /**
   * Safe Firestore Batch Writer (Chunked to maximum 400 operations per batch)
   */
  /** Firestore doc ids may not contain "/" and must be non-empty. */
  _recordDocId(record, idx) {
    const raw = String(record.employeeId || record.instructionId || idx);
    return raw.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 1500) || String(idx);
  }

  /** The batch WITHOUT its records array - what actually lives in the parent document. */
  _batchMeta(batch) {
    const { records, ...meta } = batch;
    return { ...meta, recordsInSubcollection: true };
  }

  /**
   * Writes parent metadata plus the given records, chunked under Firestore's
   * 500-operations-per-commit limit. Records live in a subcollection, so a batch is
   * bounded by headcount, not by the 1 MiB document cap.
   * Returns { ok, error }; with strict:true it throws instead of reporting.
   */
  async _persistBatch(batch, recordsToWrite = [], { strict = false } = {}) {
    if (!this.db || typeof this.db.collection !== 'function') return { ok: true, error: null };

    const CHUNK_SIZE = 400; // comfortably below the 500-operation commit limit
    const batchRef = this.db.collection('disbursement_batches').doc(batch.batchId);

    try {
      await batchRef.set(this._batchMeta(batch), { merge: true });

      const records = recordsToWrite || [];
      const canCommit = typeof this.db.batch === 'function';
      for (let i = 0; i < records.length; i += CHUNK_SIZE) {
        const slice = records.slice(i, i + CHUNK_SIZE);
        if (canCommit) {
          const writer = this.db.batch();
          slice.forEach((rec, j) =>
            writer.set(batchRef.collection('records').doc(this._recordDocId(rec, i + j)), rec));
          await writer.commit();
        } else {
          for (let j = 0; j < slice.length; j++) {
            await batchRef.collection('records').doc(this._recordDocId(slice[j], i + j)).set(slice[j]);
          }
        }
      }
      return { ok: true, error: null };
    } catch (err) {
      // A persist failure after money has moved must never be reported as success.
      console.error('[DISBURSE_DB] FAILED to persist batch ' + batch.batchId + ': ' + err.message);
      if (strict) throw new Error('Could not persist disbursement batch ' + batch.batchId + ': ' + err.message);
      return { ok: false, error: err.message };
    }
  }

  /** Reads a batch and reattaches its records, transparently handling legacy inline batches. */
  async _loadBatch(batchId) {
    if (!this.db || typeof this.db.collection !== 'function') return null;
    const batchRef = this.db.collection('disbursement_batches').doc(batchId);
    const snap = await safeDbGet(batchRef.get());
    if (!snap || !snap.exists) return null;
    const batch = snap.data();

    // Legacy batches (written before records moved to a subcollection) keep them inline.
    if (Array.isArray(batch.records) && batch.records.length) return batch;

    const records = [];
    try {
      const sub = await batchRef.collection('records').get();
      if (sub && Array.isArray(sub.docs)) sub.docs.forEach(d => records.push(d.data()));
      else if (sub && typeof sub.forEach === 'function') sub.forEach(d => records.push(d.data()));
    } catch (err) {
      console.error('[DISBURSE_DB] Could not read records for ' + batchId + ': ' + err.message);
    }
    records.sort((a, b) => String(a.instructionId).localeCompare(String(b.instructionId), undefined, { numeric: true }));
    batch.records = records;
    return batch;
  }

  /** Saves batch metadata plus only the records that changed. */
  async _chunkedBatchSave(batch, changedRecords = null) {
    if (!batch) return { ok: true, error: null };
    return this._persistBatch(batch, changedRecords === null ? (batch.records || []) : changedRecords);
  }

  /**
   * Retrieves batch details by ID
   */
  async getBatch(batchId) {
    let batch = this._localBatches.get(batchId);
    if (!batch) batch = await this._loadBatch(batchId);
    return batch || null;
  }
}

module.exports = {
  PayrollDisbursementService,
  MakerCheckerViolationError,
  PayoutValidationError,
  CashfreeApiError
};
