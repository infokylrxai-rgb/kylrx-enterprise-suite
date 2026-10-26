const admin = require("firebase-admin");
require('dotenv').config();

// The Firebase project comes only from the environment (see .env.example and README.md):
//   FIREBASE_PROJECT_ID, FIREBASE_STORAGE_BUCKET, and the service account in
//   FIREBASE_SERVICE_ACCOUNT (raw or base64 JSON) or FIREBASE_SERVICE_ACCOUNT_PATH (key file).
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Load from Host Environment Variable (Raw JSON or base64 encoded)
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
    if (raw.startsWith('{')) {
      serviceAccount = JSON.parse(raw);
    } else {
      const decoded = Buffer.from(raw, 'base64').toString('utf8');
      serviceAccount = JSON.parse(decoded);
    }
  } catch (error) {
    console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT env var:", error);
  }
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
  // Load from a key file path (relative paths resolve from the project root)
  try {
    const keyPath = require('path').resolve(__dirname, '..', process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    serviceAccount = require(keyPath);
  } catch (error) {
    console.error("Failed to load FIREBASE_SERVICE_ACCOUNT_PATH key file:", error.message);
  }
}

const projectId = process.env.FIREBASE_PROJECT_ID || '';
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET || '';

// Production never falls back to anything: fail at startup and say exactly what is missing
if (process.env.NODE_ENV === 'production') {
  const missing = [];
  if (!projectId) missing.push('FIREBASE_PROJECT_ID');
  if (!storageBucket) missing.push('FIREBASE_STORAGE_BUCKET');
  if (!serviceAccount) missing.push('FIREBASE_SERVICE_ACCOUNT or FIREBASE_SERVICE_ACCOUNT_PATH (a readable service account key)');
  if (missing.length) {
    throw new Error(`Firebase credentials are required in production. Missing or unreadable: ${missing.join(', ')}.`);
  }
  if (serviceAccount.project_id && serviceAccount.project_id !== projectId) {
    throw new Error(`FIREBASE_PROJECT_ID (${projectId}) does not match the service account's project (${serviceAccount.project_id}).`);
  }
}

/** The configured project for status endpoints and labels; never a hard-coded project */
function firebaseProjectInfo() {
  return {
    configured: Boolean(serviceAccount),
    projectId: projectId || (serviceAccount && serviceAccount.project_id) || null,
    storageBucket: storageBucket || null,
    clientEmail: (serviceAccount && serviceAccount.client_email) || null
  };
}

let db;
let messaging;
let rawCollection = null;

if (serviceAccount) {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: projectId || serviceAccount.project_id,
      ...(storageBucket ? { storageBucket } : {})
    });
    console.log("Firebase Admin SDK initialized successfully!");
  }
  db = admin.firestore();
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch (_) {}
  // Scope db.collection() to the requesting organization (see config/tenant.js)
  rawCollection = require('./tenant').installTenantScoping(db);
  messaging = admin.messaging();
} else {
  console.log("Firebase Backend: Active in local in-memory mode (no Firebase service account configured).");
  
  const _firestoreStore = new Map();

  // update()/set({merge}) with FieldValue.delete() removes the field (top-level fields only)
  const { FieldValue } = require('firebase-admin/firestore');
  const isDeleteSentinel = (v) => Boolean(v) && typeof v.isEqual === 'function' && v.isEqual(FieldValue.delete());
  // arrayUnion / arrayRemove apply to the stored array, as in Firestore
  const arrayTransform = (v) => v && Array.isArray(v.elements) && /^Array(Union|Remove)Transform$/.test(v.constructor && v.constructor.name) ? v.constructor.name : null;
  function mergeFields(existing, data) {
    const merged = { ...existing, ...data };
    for (const key of Object.keys(data)) {
      if (isDeleteSentinel(data[key])) { delete merged[key]; continue; }
      const kind = arrayTransform(data[key]);
      if (!kind) continue;
      const current = Array.isArray(existing[key]) ? existing[key] : [];
      const items = data[key].elements;
      merged[key] = kind === 'ArrayUnionTransform'
        ? [...current, ...items.filter(x => !current.includes(x))]
        : current.filter(x => !items.includes(x));
    }
    return merged;
  }

  function getCollectionData(name) {
    if (!_firestoreStore.has(name)) {
      const colMap = new Map();
      _firestoreStore.set(name, colMap);
      
      if (name === 'employees') {
        const departments = ['Engineering', 'Product', 'Sales', 'Customer Success', 'Operations', 'Finance', 'People Ops'];
        const bus = ['Technology', 'Sales & Marketing', 'Operations', 'Finance & HR'];
        const roles = ['Software Engineer', 'Senior Engineer', 'Lead Architect', 'Product Manager', 'Account Executive', 'Operations Lead', 'Financial Analyst', 'HRBP'];
        for (let i = 1; i <= 950; i++) {
          const id = `EMP-${String(i).padStart(4, '0')}`;
          const dept = departments[i % departments.length];
          const bu = dept.includes('Eng') || dept.includes('Prod') ? 'Technology' : (dept.includes('Sales') || dept.includes('Cust') ? 'Sales & Marketing' : (dept.includes('Ops') ? 'Operations' : 'Finance & HR'));
          colMap.set(id, {
            id,
            employeeId: id,
            name: `Employee ${i}`,
            department: dept,
            bu,
            role: roles[i % roles.length],
            status: 'Active',
            headcount: 1,
            hiring: i > 808 ? 1 : 0,
            employeeType: i % 10 === 0 ? 'Contractor' : 'Full Time',
            createdAt: new Date(Date.now() - (950 - i) * 86400000).toISOString()
          });
        }
      } else if (name === 'users') {
        const users = [
          { id: 'usr_superadmin', email: 'superadmin@kylrx.ai', name: 'Rajesh Subramanian', role: 'super_admin', status: 'Active' },
          { id: 'usr_hr_admin', email: 'hr.admin@kylrx.ai', name: 'Swati Khandelwal', role: 'hr_admin', status: 'Active' },
          { id: 'usr_manager', email: 'manager@kylrx.ai', name: 'Kavita Krishnan', role: 'manager', status: 'Active' },
          { id: 'usr_payroll', email: 'payroll@kylrx.ai', name: 'Naveen Jindal', role: 'payroll_admin', status: 'Active' }
        ];
        users.forEach(u => colMap.set(u.id, u));
      } else if (name === 'alerts') {
        const alerts = [
          { id: 'ALT-ATT-301', module: 'Attendance', severity: 'critical', title: '3 Consecutive Absences Breach', employee: 'Priya Sharma (EMP-882)', department: 'Engineering', message: '3 unexcused absences recorded. Escalated to Manager & HR Operations.', timestamp: '15 mins ago' },
          { id: 'ALT-PAY-911', module: 'Payroll', severity: 'critical', title: 'Variance > 10% Anomaly Alert', employee: 'Batch SEP-FINAL', department: 'Finance', message: 'MoM Gross Variance calculated at 12.4% (Threshold: 10%). Pre-disbursement hold applied.', timestamp: '1 hour ago' },
          { id: 'ALT-EXIT-408', module: 'Exit', severity: 'critical', title: 'Exit Clearance Delayed > 48 Hours', employee: 'Ananya Rao (EMP-771)', department: 'Finance & Accounts', message: 'Department clearance inactive for 52 hours. Escalated to Head of HR.', timestamp: '2 hours ago' }
        ];
        alerts.forEach(a => colMap.set(a.id, a));
      } else if (name === 'pending_approvals') {
        const approvals = [
          { id: 'APP-EXIT-801', type: 'Exit Department Clearance', entityId: 'EMP-771', requester: 'Ananya Rao', department: 'Finance & Accounts', submittedAt: '2026-09-09T10:15:00Z', slaHoursRemaining: 18, priority: 'high', description: 'Finance departmental clearance sign-off for asset handover & loan balance closure.' },
          { id: 'APP-LEAVE-902', type: 'Extended Medical Leave Request', entityId: 'EMP-304', requester: 'Vikramaditya Sen', department: 'Engineering', submittedAt: '2026-09-10T14:30:00Z', slaHoursRemaining: 36, priority: 'medium', description: '14 days medical leave request requiring HR Business Partner exception sign-off.' },
          { id: 'APP-SALARY-410', type: 'Off-Cycle Mid-Year Adjustment', entityId: 'EMP-119', requester: 'Pooja Iyer', department: 'Product', submittedAt: '2026-09-11T08:00:00Z', slaHoursRemaining: 24, priority: 'high', description: 'Grade promotion adjustment from L2 Senior to L3 Lead Engineer.' }
        ];
        approvals.forEach(a => colMap.set(a.id, a));
      }
    }
    return _firestoreStore.get(name);
  }

  function createQuery(collectionName, filters = [], limitCount = null) {
    return {
      where: function(field, op, val) {
        return createQuery(collectionName, [...filters, { field, op, val }], limitCount);
      },
      orderBy: function() {
        return this;
      },
      limit: function(n) {
        return createQuery(collectionName, filters, n);
      },
      get: async function() {
        const colMap = getCollectionData(collectionName);
        let items = Array.from(colMap.values());
        for (const f of filters) {
          items = items.filter(doc => {
            if (f.op === '==' || f.op === '===') return doc[f.field] === f.val;
            if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(doc[f.field]);
            return true;
          });
        }
        if (typeof limitCount === 'number') {
          items = items.slice(0, limitCount);
        }
        const docs = items.map(d => ({
          id: d.id,
          exists: true,
          data: () => d,
          get: (field) => d[field]
        }));
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
          forEach: (cb) => docs.forEach(cb)
        };
      },
      doc: function(docId) {
        return {
          collection: (sub) => createQuery(`${collectionName}/${docId}/${sub}`),
          get: async function() {
            const colMap = getCollectionData(collectionName);
            const data = colMap.get(docId);
            return {
              id: docId,
              exists: Boolean(data),
              data: () => data || null,
              get: (field) => (data ? data[field] : undefined)
            };
          },
          set: async function(data, opts = {}) {
            const colMap = getCollectionData(collectionName);
            const existing = colMap.get(docId) || {};
            const merged = opts.merge ? { ...mergeFields(existing, data), id: docId } : { ...data, id: docId };
            colMap.set(docId, merged);
            return { id: docId };
          },
          update: async function(data) {
            const colMap = getCollectionData(collectionName);
            const existing = colMap.get(docId) || { id: docId };
            colMap.set(docId, mergeFields(existing, data));
            return { id: docId };
          },
          delete: async function() {
            const colMap = getCollectionData(collectionName);
            colMap.delete(docId);
            return true;
          }
        };
      },
      add: async function(data) {
        const colMap = getCollectionData(collectionName);
        const id = data.id || `doc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        colMap.set(id, { ...data, id });
        return { id };
      }
    };
  }

  db = {
    collection: function(name) {
      return createQuery(name);
    }
  };

  // Write batches exist only in test mode. Elsewhere this store is not a database, so a batch must
  // fail visibly instead of confirming a save that only went to memory.
  if (process.env.NODE_ENV === 'test') {
    db.batch = () => {
      const ops = [];
      const batch = {
        set: (ref, data, opts) => { ops.push(() => ref.set(data, opts)); return batch; },
        update: (ref, data) => { ops.push(() => ref.update(data)); return batch; },
        delete: (ref) => { ops.push(() => ref.delete()); return batch; },
        commit: async () => { for (const op of ops) await op(); return ops.map(() => ({})); } // shortcut: not atomic, test only
      };
      return batch;
    };
  }

  admin.firestore = function() {
    return db;
  };

  admin.auth = function() {
    return {
      verifyIdToken: async function(token) {
        return {
          uid: 'superadmin_dev',
          email: 'superadmin@kylrx.ai',
          role: 'super_admin'
        };
      }
    };
  };

  messaging = {
    send: async () => ({ success: true })
  };
}

// rawCollection(name) bypasses tenant scoping; only for authentication-time lookups
module.exports = { admin, db, messaging, rawCollection: rawCollection || ((name) => db.collection(name)), firebaseProjectInfo };

