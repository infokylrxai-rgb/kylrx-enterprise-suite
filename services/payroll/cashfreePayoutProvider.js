/**
 * ============================================================================
 * KYLRX.AI — CASHFREE PAYOUTS PROVIDER
 * ============================================================================
 * Real HTTP adapter for Cashfree Payouts. Replaces the previous Decentro stub.
 *
 * Supports BOTH Cashfree Payouts API generations, selected by CASHFREE_API_VERSION:
 *   - 'v2' (default, current): header auth (x-client-id / x-client-secret / x-api-version)
 *   - 'v1' (legacy):           POST /authorize -> short-lived bearer token (cached)
 *
 * Safety properties (these are what keep payouts hiccup-free):
 *   - Idempotent transfers: a deterministic transfer_id per (batch, employee) means a
 *     retry can NEVER create a second payment; Cashfree de-duplicates on transfer_id.
 *   - Retry ONLY on transient faults (network/timeout/5xx/429). Business 4xx never retries.
 *   - Beneficiary ensure-and-cache: "already exists" is treated as success.
 *   - Webhook signature verification (HMAC-SHA256) — unsigned callbacks are rejected.
 *   - Every request has a hard timeout so a hung gateway can't wedge payroll.
 *
 * NOTE: endpoint paths and field names are centralised in ENDPOINTS//buildTransferBody
 * so they can be reconciled against your Cashfree dashboard docs in one place.
 * ============================================================================
 */

const crypto = require('crypto');

class CashfreeApiError extends Error {
  constructor(message, status = 502, details = {}) {
    super(message);
    this.name = 'CashfreeApiError';
    this.statusCode = status;
    this.details = details;
    // Transient faults are safe to retry; business rejections are not.
    this.retryable = status === 0 || status === 408 || status === 429 || (status >= 500 && status <= 599);
  }
}

const BASE_URLS = {
  v2: { sandbox: 'https://sandbox.cashfree.com/payout', production: 'https://api.cashfree.com/payout' },
  v1: { sandbox: 'https://payout-gamma.cashfree.com/payout/v1', production: 'https://payout-api.cashfree.com/payout/v1' }
};

const ENDPOINTS = {
  v2: { authorize: null, beneficiary: '/beneficiary', transfer: '/transfers', transferStatus: '/transfers', balance: '/balance' },
  v1: { authorize: '/authorize', beneficiary: '/addBeneficiary', transfer: '/requestTransfer', transferStatus: '/getTransferStatus', balance: '/getBalance' }
};

/** Cashfree transfer modes. The caller's NEFT/RTGS/IMPS channel maps straight through. */
const VALID_MODES = ['banktransfer', 'imps', 'neft', 'rtgs', 'upi'];

class CashfreePayoutProvider {
  constructor(options = {}) {
    this.apiVersion = String(options.apiVersion || process.env.CASHFREE_API_VERSION || 'v2').toLowerCase();
    if (!['v1', 'v2'].includes(this.apiVersion)) {
      throw new Error(`CASHFREE_API_VERSION must be 'v1' or 'v2' (got '${this.apiVersion}')`);
    }
    this.environment = String(options.environment || process.env.CASHFREE_ENV || 'sandbox').toLowerCase();
    this.baseUrl = options.baseUrl || process.env.CASHFREE_BASE_URL ||
      BASE_URLS[this.apiVersion][this.environment === 'production' ? 'production' : 'sandbox'];
    this.clientId = options.clientId || process.env.CASHFREE_CLIENT_ID || '';
    this.clientSecret = options.clientSecret || process.env.CASHFREE_CLIENT_SECRET || '';
    // Cashfree signs webhooks with the client secret unless a dedicated secret is configured.
    this.webhookSecret = options.webhookSecret || process.env.CASHFREE_WEBHOOK_SECRET || this.clientSecret;
    this.xApiVersion = options.xApiVersion || process.env.CASHFREE_X_API_VERSION || '2024-01-01';
    this.timeoutMs = Number(options.timeoutMs || process.env.CASHFREE_TIMEOUT_MS || 20000);
    // Cashfree v2 scopes balance to a fund source. There is no API to list them, so the id
    // comes from the dashboard (Payouts > Fund Sources). Without it the balance guard is skipped.
    this.paymentInstrumentId = options.paymentInstrumentId || process.env.CASHFREE_PAYMENT_INSTRUMENT_ID || '';
    this.fetchImpl = options.fetch || globalThis.fetch;

    this._token = null;          // v1 bearer token cache
    this._tokenExpiresAt = 0;
    this._beneficiaryCache = new Map();
  }

  isConfigured() { return Boolean(this.clientId && this.clientSecret); }

  assertConfigured() {
    if (!this.isConfigured()) {
      throw new CashfreeApiError('Cashfree is not configured: set CASHFREE_CLIENT_ID and CASHFREE_CLIENT_SECRET.', 503);
    }
  }

  /** Low-level HTTP with hard timeout + normalised errors. */
  async _request(path, { method = 'GET', body, headers = {}, query } = {}) {
    if (!this.fetchImpl) throw new CashfreeApiError('No fetch implementation available in this runtime.', 500);
    let url = `${this.baseUrl}${path}`;
    if (query && Object.keys(query).length) {
      url += '?' + new URLSearchParams(query).toString();
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res, text;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      text = await res.text();
    } catch (err) {
      // Network failure / abort => status 0 => retryable
      throw new CashfreeApiError(`Cashfree request failed: ${err.message}`, 0, { url, method });
    } finally {
      clearTimeout(timer);
    }
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { raw: text }; }
    if (!res.ok) {
      const msg = json.message || json.error_description || json.subCode || `HTTP ${res.status}`;
      throw new CashfreeApiError(`Cashfree ${method} ${path} failed: ${msg}`, res.status, { url, response: json });
    }
    return json;
  }

  /** Auth headers. v2 = static headers; v1 = cached bearer token (refreshed 60s before expiry). */
  async _authHeaders() {
    this.assertConfigured();
    if (this.apiVersion === 'v2') {
      return {
        'x-client-id': this.clientId,
        'x-client-secret': this.clientSecret,
        'x-api-version': this.xApiVersion
      };
    }
    if (this._token && Date.now() < this._tokenExpiresAt - 60000) {
      return { Authorization: `Bearer ${this._token}` };
    }
    const res = await this._request(ENDPOINTS.v1.authorize, {
      method: 'POST',
      headers: { 'X-Client-Id': this.clientId, 'X-Client-Secret': this.clientSecret }
    });
    const token = res && res.data && res.data.token;
    if (!token) throw new CashfreeApiError('Cashfree authorize did not return a token.', 502, { response: res });
    this._token = token;
    // Cashfree v1 tokens live ~10 minutes.
    this._tokenExpiresAt = Date.now() + (Number(res.data.expiry || 600) * 1000);
    return { Authorization: `Bearer ${this._token}` };
  }

  /**
   * Create the beneficiary if absent. Treats "already exists" as success and caches the id,
   * so a re-run of payroll does not re-register every employee.
   */
  async ensureBeneficiary({ beneficiaryId, name, accountNumber, ifsc, email, phone, address }) {
    this.assertConfigured();
    if (this._beneficiaryCache.has(beneficiaryId)) {
      return { beneficiaryId: this._beneficiaryCache.get(beneficiaryId), created: false, cached: true };
    }

    const headers = await this._authHeaders();
    const body = this.apiVersion === 'v2'
      ? {
          beneficiary_id: beneficiaryId,
          beneficiary_name: name,
          beneficiary_instrument_details: { bank_account_number: accountNumber, bank_ifsc: ifsc },
          beneficiary_contact_details: {
            beneficiary_email: email || undefined,
            beneficiary_phone: phone || undefined,
            beneficiary_address: address || undefined
          }
        }
      : { beneId: beneficiaryId, name, bankAccount: accountNumber, ifsc, email, phone, address1: address || 'NA' };

    try {
      await this._request(ENDPOINTS[this.apiVersion].beneficiary, { method: 'POST', headers, body });
      this._beneficiaryCache.set(beneficiaryId, beneficiaryId);
      return { beneficiaryId, created: true };
    } catch (err) {
      const resp = (err.details && err.details.response) || {};
      const code = String(resp.code || '').toLowerCase();
      const msg = String(resp.message || '').toLowerCase();
      const conflict = err.statusCode === 409 || code.includes('already_exists') ||
        code.includes('conflict') || msg.includes('already exists');
      if (!conflict) throw err;

      // A conflict does NOT mean OUR id exists. Cashfree returns 409
      // conflict_with_existing_beneficiary when the bank account is already registered
      // under a DIFFERENT beneficiary id - and our id was never created. Assuming success
      // here would make every later transfer fail with beneficiary_not_found, so resolve
      // the real id and use that instead.
      const existing = await this.findBeneficiary({ beneficiaryId, accountNumber, ifsc });
      if (!existing) throw err;
      this._beneficiaryCache.set(beneficiaryId, existing);
      return { beneficiaryId: existing, created: false, reused: true, requestedId: beneficiaryId };
    }
  }

  /**
   * Resolves an existing beneficiary: first by id, then by bank account + IFSC.
   * Returns the beneficiary id, or null when nothing matches.
   */
  async findBeneficiary({ beneficiaryId, accountNumber, ifsc }) {
    if (this.apiVersion !== 'v2') return null; // v1 lookup not wired
    const headers = await this._authHeaders();
    const tryGet = async (query) => {
      try {
        const res = await this._request(ENDPOINTS.v2.beneficiary, { method: 'GET', headers, query });
        const d = (res && (res.data || res)) || {};
        return d.beneficiary_id || null;
      } catch (_) { return null; }
    };
    if (beneficiaryId) {
      const byId = await tryGet({ beneficiary_id: beneficiaryId });
      if (byId) return byId;
    }
    if (accountNumber && ifsc) {
      return await tryGet({ bank_account_number: accountNumber, bank_ifsc: ifsc });
    }
    return null;
  }

  _buildTransferBody({ transferId, beneficiaryId, amount, mode, remarks }) {
    const normalizedMode = VALID_MODES.includes(String(mode).toLowerCase())
      ? String(mode).toLowerCase()
      : 'banktransfer';
    if (this.apiVersion === 'v2') {
      return {
        transfer_id: transferId,
        transfer_amount: Number(amount),
        transfer_mode: normalizedMode,
        beneficiary_details: { beneficiary_id: beneficiaryId },
        transfer_remarks: remarks || 'Salary payout'
      };
    }
    return { beneId: beneficiaryId, amount: Number(amount), transferId, transferMode: normalizedMode, remarks: remarks || 'Salary payout' };
  }

  /**
   * Initiate ONE transfer. transferId must be deterministic for the (batch, employee)
   * pair — that is what makes a retry safe: Cashfree rejects/returns the existing
   * transfer instead of paying twice.
   */
  async createTransfer({ transferId, beneficiaryId, amount, mode, remarks }) {
    this.assertConfigured();
    if (!transferId) throw new CashfreeApiError('transferId is required for an idempotent transfer.', 400);
    const headers = await this._authHeaders();
    // An idempotency key gives a second layer of protection on v2.
    if (this.apiVersion === 'v2') headers['x-idempotency-key'] = transferId;

    try {
      const res = await this._request(ENDPOINTS[this.apiVersion].transfer, {
        method: 'POST', headers,
        body: this._buildTransferBody({ transferId, beneficiaryId, amount, mode, remarks })
      });
      return this._normalizeTransfer(res, transferId);
    } catch (err) {
      // A duplicate transfer_id means the payment already exists — fetch its real state
      // rather than treating it as a failure (prevents double-pay AND false alarms).
      const detail = JSON.stringify(err.details && err.details.response || {}).toLowerCase();
      if (err.statusCode === 409 || detail.includes('duplicate') || detail.includes('already exists')) {
        return await this.getTransferStatus(transferId);
      }
      throw err;
    }
  }

  async getTransferStatus(transferId) {
    this.assertConfigured();
    const headers = await this._authHeaders();
    const query = this.apiVersion === 'v2' ? { transfer_id: transferId } : { transferId };
    const res = await this._request(ENDPOINTS[this.apiVersion].transferStatus, { method: 'GET', headers, query });
    return this._normalizeTransfer(res, transferId);
  }

  /** Throws a non-retryable BALANCE_NOT_CONFIGURED when no fund source id is set. */
  /**
   * Read-only reachability + auth probe. Lists transfers (GET), which authenticates and triggers
   * Cashfree's IP allow-list check without creating, moving or changing anything. Lets the
   * disbursement preflight verify production credentials before any real payout is attempted.
   */
  async verifyConnectivity() {
    try {
      const headers = await this._authHeaders();
      const path = this.apiVersion === 'v2' ? ENDPOINTS.v2.transfer : ENDPOINTS.v1.balance;
      await this._request(path, { method: 'GET', headers, query: { limit: 1 } });
      return { ok: true, status: 200, message: null };
    } catch (err) {
      const resp = (err.details && err.details.response) || {};
      return { ok: false, status: err.statusCode || null, message: String(resp.message || err.message || 'unknown error') };
    }
  }

  async getBalance() {
    this.assertConfigured();
    if (this.apiVersion === 'v2' && !this.paymentInstrumentId) {
      const err = new CashfreeApiError('BALANCE_NOT_CONFIGURED: set CASHFREE_PAYMENT_INSTRUMENT_ID (Cashfree dashboard > Payouts > Fund Sources) to enable the pre-flight balance guard.', 400);
      err.notConfigured = true;
      throw err;
    }
    const headers = await this._authHeaders();
    const query = this.apiVersion === 'v2' ? { paymentInstrumentId: this.paymentInstrumentId } : undefined;
    const res = await this._request(ENDPOINTS[this.apiVersion].balance, { method: 'GET', headers, query });
    const d = (res && (res.data || res)) || {};
    const available = Number(d.available_balance ?? d.availableBalance ?? d.balance ?? 0);
    return { availableBalance: Number.isFinite(available) ? available : 0, raw: res };
  }

  /** Maps any Cashfree shape (v1/v2, POST/GET) onto one internal status vocabulary. */
  _normalizeTransfer(res, transferId) {
    const d = (res && (res.data || res)) || {};
    const rawStatus = String(d.status || d.transfer_status || d.transferStatus || res.status || 'PENDING').toUpperCase();
    return {
      transferId: d.transfer_id || d.transferId || transferId,
      providerReferenceId: d.cf_transfer_id || d.referenceId || d.reference_id || null,
      status: CashfreePayoutProvider.normalizeStatus(rawStatus),
      rawStatus,
      utr: d.transfer_utr || d.utr || d.bank_reference || null,
      message: d.status_description || d.message || res.message || null,
      raw: res
    };
  }

  /** Cashfree vocabulary -> SUCCESS | PENDING | FAILURE | REVERSED */
  static normalizeStatus(status) {
    const s = String(status || '').toUpperCase();
    if (['SUCCESS', 'COMPLETED', 'PAID', 'TRANSFER_SUCCESS'].includes(s)) return 'SUCCESS';
    if (['FAILED', 'FAILURE', 'ERROR', 'REJECTED', 'TRANSFER_FAILED'].includes(s)) return 'FAILURE';
    if (['REVERSED', 'RETURNED', 'REFUNDED'].includes(s)) return 'REVERSED';
    return 'PENDING'; // PENDING / RECEIVED / APPROVAL_PENDING / PROCESSING / QUEUED
  }

  /**
   * Verify a Cashfree webhook: base64( HMAC-SHA256( timestamp + rawBody, secret ) ).
   * Rejects anything unsigned — without this, a forged "SUCCESS" could mark payroll paid.
   */
  verifyWebhookSignature(rawBody, signature, timestamp) {
    if (!signature) return false;
    if (!this.webhookSecret) return false;
    const payload = `${timestamp || ''}${typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody || {})}`;
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(payload).digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  /** Normalises a webhook body (v1/v2 shapes) into the same vocabulary as transfers. */
  static parseWebhook(body = {}) {
    const d = body.data || body;
    const t = d.transfer || d;
    const rawStatus = t.transfer_status || t.status || t.event || body.type || 'PENDING';
    return {
      transferId: t.transfer_id || t.transferId || d.transferId || null,
      providerReferenceId: t.cf_transfer_id || t.referenceId || null,
      status: CashfreePayoutProvider.normalizeStatus(String(rawStatus).replace(/^TRANSFER_/, '')),
      rawStatus: String(rawStatus),
      utr: t.transfer_utr || t.utr || null,
      message: t.status_description || t.reason || d.message || null,
      eventTime: body.event_time || d.event_time || null
    };
  }
}

module.exports = { CashfreePayoutProvider, CashfreeApiError, BASE_URLS, ENDPOINTS };
