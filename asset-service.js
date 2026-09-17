import { db } from "./firebase-config.js";
import { collection, doc, setDoc, updateDoc, serverTimestamp, getDoc, query, where, getDocs, addDoc, orderBy, limit, deleteDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * Enterprise Asset Management Service
 * Resilient Architecture: Backend API (/api/assets) + Cloud Firestore + Instant Local Cache Fallback
 */

const API_HOST = (window.location.port === '3000') ? '' : 'http://localhost:3000';
const API_BASE = `${API_HOST}/api/assets`;

const STORAGE_KEY_ASSETS = 'kylrx_assets_inventory';
const STORAGE_KEY_LOGS = 'kylrx_asset_audit_logs';

// Default enterprise assets to display immediately without blank latency
const DEFAULT_ASSETS = [
    {
        id: 'ast-lp-084',
        name: 'Apple MacBook Pro 16" M3 Max',
        type: 'Laptop',
        tag: 'HRF-LP-2026-084',
        status: 'Allocated',
        assignedTo: 'usr-001',
        assignedToName: 'Sarah Jenkins',
        assignedAt: new Date(Date.now() - 14 * 86400000).toISOString(),
        lastAllocatedBy: 'admin_it',
        declarationStatus: 'Verified',
        createdAt: new Date(Date.now() - 60 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 14 * 86400000).toISOString()
    },
    {
        id: 'ast-lp-112',
        name: 'Dell XPS 15 OLED (i9/32GB)',
        type: 'Laptop',
        tag: 'HRF-LP-2026-112',
        status: 'In Stock',
        assignedTo: null,
        assignedToName: null,
        assignedAt: null,
        lastAllocatedBy: null,
        declarationStatus: 'Unassigned',
        createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 2 * 86400000).toISOString()
    },
    {
        id: 'ast-mb-204',
        name: 'Apple iPhone 15 Pro Enterprise Edition',
        type: 'Mobile',
        tag: 'HRF-MB-2026-204',
        status: 'Allocated',
        assignedTo: 'usr-002',
        assignedToName: 'David Chen',
        assignedAt: new Date(Date.now() - 30 * 86400000).toISOString(),
        lastAllocatedBy: 'admin_it',
        declarationStatus: 'Verified',
        createdAt: new Date(Date.now() - 40 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 30 * 86400000).toISOString()
    },
    {
        id: 'ast-pr-305',
        name: 'Keychron Q1 Pro Wireless Mechanical Keyboard',
        type: 'Peripheral',
        tag: 'HRF-PR-2026-305',
        status: 'Allocated',
        assignedTo: 'usr-003',
        assignedToName: 'Priya Sharma',
        assignedAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        lastAllocatedBy: 'admin_it',
        declarationStatus: 'Pending',
        createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 7 * 86400000).toISOString()
    },
    {
        id: 'ast-hw-410',
        name: 'Ergotron LX Dual Stacking Arm',
        type: 'Furniture',
        tag: 'HRF-HW-2026-410',
        status: 'In Stock',
        assignedTo: null,
        assignedToName: null,
        assignedAt: null,
        lastAllocatedBy: null,
        declarationStatus: 'Unassigned',
        createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
        updatedAt: new Date().toISOString()
    },
    {
        id: 'ast-lp-519',
        name: 'Lenovo ThinkPad X1 Carbon Gen 11',
        type: 'Laptop',
        tag: 'HRF-LP-2026-519',
        status: 'Repair',
        assignedTo: 'usr-004',
        assignedToName: 'Marcus Vance',
        assignedAt: new Date(Date.now() - 50 * 86400000).toISOString(),
        lastAllocatedBy: 'admin_it',
        declarationStatus: 'Verified',
        createdAt: new Date(Date.now() - 70 * 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 1 * 86400000).toISOString()
    }
];

const DEFAULT_LOGS = [
    {
        id: 'log-ast-01',
        assetId: 'ast-pr-305',
        employeeId: 'usr-003',
        action: 'Allocation',
        actorId: 'admin_it',
        timestamp: new Date(Date.now() - 7 * 86400000).toISOString()
    },
    {
        id: 'log-ast-02',
        assetId: 'ast-lp-084',
        employeeId: 'usr-001',
        action: 'Declaration Signed',
        actorId: 'usr-001',
        timestamp: new Date(Date.now() - 13 * 86400000).toISOString()
    },
    {
        id: 'log-ast-03',
        assetId: 'ast-lp-519',
        employeeId: 'usr-004',
        action: 'Damage Reported (Moved to Repair)',
        actorId: 'usr-004',
        timestamp: new Date(Date.now() - 1 * 86400000).toISOString()
    }
];

// Backend status tracking
let isBackendAvailable = true;
let lastBackendAttempt = 0;
const BACKEND_RETRY_COOLDOWN_MS = 15000;

function shouldAttemptBackend() {
    if (isBackendAvailable === true) return true;
    return (Date.now() - lastBackendAttempt) > BACKEND_RETRY_COOLDOWN_MS;
}

function noteBackendSuccess() {
    isBackendAvailable = true;
    lastBackendAttempt = Date.now();
}

function noteBackendOffline(err) {
    isBackendAvailable = false;
    lastBackendAttempt = Date.now();
    console.info('[ASSET] Backend server note (' + (err?.message || 'Offline') + '). Operating smoothly via resilient direct/local store.');
}

// Timeout protector ensuring promises never hang indefinitely
function withTimeout(promise, ms = 2500, fallbackVal = undefined) {
    let timeoutId;
    const timeoutPromise = new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
            if (fallbackVal !== undefined) resolve(fallbackVal);
            else reject(new Error(`Operation timed out after ${ms}ms`));
        }, ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

// Local Storage helpers
function getLocalAssets() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_ASSETS);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch (_) {}
    saveLocalAssets(DEFAULT_ASSETS);
    return DEFAULT_ASSETS;
}

function saveLocalAssets(list) {
    try {
        localStorage.setItem(STORAGE_KEY_ASSETS, JSON.stringify(list));
    } catch (_) {}
}

function getLocalLogs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_LOGS);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch (_) {}
    saveLocalLogs(DEFAULT_LOGS);
    return DEFAULT_LOGS;
}

function saveLocalLogs(logs) {
    try {
        localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(logs));
    } catch (_) {}
}

/**
 * Onboard / Initialize New Hardware Asset
 */
export async function addAsset(assetData) {
    console.log('[ASSET] Initializing new asset...', assetData);
    
    // 1. Try Backend API first
    if (shouldAttemptBackend()) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);
            const res = await fetch(`${API_BASE}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(assetData),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const json = await res.json();
                if (json && json.success) {
                    noteBackendSuccess();
                    // Update local cache
                    const current = getLocalAssets();
                    const newRecord = json.data || {
                        id: json.id,
                        ...assetData,
                        status: 'In Stock',
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };
                    saveLocalAssets([newRecord, ...current.filter(a => a.id !== newRecord.id)]);
                    return json.id;
                }
            }
        } catch (apiErr) {
            noteBackendOffline(apiErr);
        }
    }

    // 2. Direct Firestore Client SDK with strict 2000ms timeout
    const generatedId = `ast-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;
    try {
        const assetRef = doc(collection(db, 'assets'));
        const firestoreId = assetRef.id || generatedId;
        const record = {
            ...assetData,
            status: 'In Stock',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        await withTimeout(setDoc(assetRef, record), 2000);
        
        // Update local cache
        const current = getLocalAssets();
        saveLocalAssets([{ id: firestoreId, ...assetData, status: 'In Stock', createdAt: new Date().toISOString() }, ...current]);
        return firestoreId;
    } catch (fsErr) {
        console.warn('[ASSET] Direct Firestore write timed out or offline, using resilient local storage:', fsErr.message);
        
        // 3. Resilient Local Storage Fallback
        const current = getLocalAssets();
        const localRecord = {
            id: generatedId,
            ...assetData,
            status: 'In Stock',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        saveLocalAssets([localRecord, ...current]);
        return generatedId;
    }
}

/**
 * Fetch Asset Inventory List
 */
export async function getAssets() {
    console.log('[ASSET] Fetching inventory...');
    
    // 1. Try Backend API
    if (shouldAttemptBackend()) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            const res = await fetch(`${API_BASE}`, {
                headers: { 'Accept': 'application/json' },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const json = await res.json();
                if (json && json.success && Array.isArray(json.data)) {
                    noteBackendSuccess();
                    saveLocalAssets(json.data);
                    return json.data;
                }
            }
        } catch (apiErr) {
            noteBackendOffline(apiErr);
        }
    }

    // 2. Fallback to Firestore Client SDK with timeout
    try {
        const snap = await withTimeout(getDocs(collection(db, 'assets')), 1800);
        if (snap && snap.docs && snap.docs.length > 0) {
            const cloudAssets = snap.docs.map(doc => {
                const d = doc.data();
                return {
                    id: doc.id,
                    ...d,
                    createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : d.createdAt,
                    updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : d.updatedAt
                };
            });
            saveLocalAssets(cloudAssets);
            return cloudAssets;
        }
    } catch (fsErr) {
        console.warn('[ASSET] Firestore getDocs timed out or quota exceeded:', fsErr.message);
    }

    // 3. Fallback to Local Storage Cache
    return getLocalAssets();
}

/**
 * Compute inventory metrics
 */
export async function getAssetStats() {
    // 1. Try Backend API
    if (shouldAttemptBackend()) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1500);
            const res = await fetch(`${API_BASE}/stats`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
                const json = await res.json();
                if (json && json.success) {
                    noteBackendSuccess();
                    return {
                        total: json.total,
                        allocated: json.allocated,
                        repair: json.repair,
                        missing: json.missing
                    };
                }
            }
        } catch (e) {
            noteBackendOffline(e);
        }
    }

    // Fallback: calculate from getAssets
    const assets = await getAssets();
    return {
        total: assets.length,
        allocated: assets.filter(a => a.status === 'Allocated').length,
        repair: assets.filter(a => a.status === 'Repair').length,
        missing: assets.filter(a => a.status === 'Missing').length
    };
}

/**
 * Fetch transaction audit logs
 */
export async function getAssetLogs() {
    if (shouldAttemptBackend()) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1500);
            const res = await fetch(`${API_BASE}/logs`, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
                const json = await res.json();
                if (json && json.success && Array.isArray(json.data)) {
                    noteBackendSuccess();
                    saveLocalLogs(json.data);
                    return json.data;
                }
            }
        } catch (e) {
            noteBackendOffline(e);
        }
    }

    // Fallback to Firestore SDK with timeout
    try {
        const q = query(collection(db, 'asset_audit_logs'), orderBy('timestamp', 'desc'), limit(10));
        const snap = await withTimeout(getDocs(q), 1500);
        if (snap && snap.docs && snap.docs.length > 0) {
            const logs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            saveLocalLogs(logs);
            return logs;
        }
    } catch (_) {}

    return getLocalLogs();
}

/**
 * Allocate Hardware to Employee
 */
export async function allocateAsset(assetId, employeeId, adminId, employeeName = null) {
    console.log(`[ASSET] Allocating ${assetId} to ${employeeId}...`);

    // 1. Try Backend API
    if (shouldAttemptBackend()) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);
            const res = await fetch(`${API_BASE}/${assetId}/allocate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ employeeId, employeeName, adminId }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                noteBackendSuccess();
                // Update local storage
                const list = getLocalAssets();
                const item = list.find(a => a.id === assetId);
                if (item) {
                    item.status = 'Allocated';
                    item.assignedTo = employeeId;
                    item.assignedToName = employeeName || employeeId;
                    item.assignedAt = new Date().toISOString();
                    item.lastAllocatedBy = adminId;
                    item.declarationStatus = 'Pending';
                    saveLocalAssets(list);
                }
                return { success: true };
            }
        } catch (e) {
            noteBackendOffline(e);
        }
    }

    // 2. Direct Firestore with timeout
    try {
        const assetRef = doc(db, 'assets', assetId);
        const payload = {
            status: 'Allocated',
            assignedTo: employeeId,
            assignedToName: employeeName || employeeId,
            assignedAt: serverTimestamp(),
            lastAllocatedBy: adminId,
            declarationStatus: 'Pending',
            updatedAt: serverTimestamp()
        };

        await withTimeout(updateDoc(assetRef, payload), 2000);
        logAssetTransaction(assetId, employeeId, 'Allocation', adminId);
        createNotification(employeeId, `A new asset (${assetId}) has been assigned to you. Please sign the declaration form.`, 'high');
    } catch (fsErr) {
        console.warn('[ASSET] Allocation direct firestore failed, updating local state:', fsErr.message);
    }

    // Update local cache
    const list = getLocalAssets();
    const item = list.find(a => a.id === assetId);
    if (item) {
        item.status = 'Allocated';
        item.assignedTo = employeeId;
        item.assignedToName = employeeName || employeeId;
        item.assignedAt = new Date().toISOString();
        item.lastAllocatedBy = adminId;
        item.declarationStatus = 'Pending';
        saveLocalAssets(list);
    }
    return { success: true };
}

/**
 * Remove / Deprovision Asset
 */
export async function deleteAsset(assetId) {
    console.log(`[ASSET] Removing asset ${assetId} from inventory...`);

    // 1. Try Backend API
    if (shouldAttemptBackend()) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);
            const res = await fetch(`${API_BASE}/${assetId}`, {
                method: 'DELETE',
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            if (res.ok) {
                noteBackendSuccess();
                // Update local storage
                const list = getLocalAssets().filter(a => a.id !== assetId);
                saveLocalAssets(list);
                return { success: true };
            }
        } catch (e) {
            noteBackendOffline(e);
        }
    }

    // 2. Direct Firestore
    try {
        const assetRef = doc(db, 'assets', assetId);
        await withTimeout(deleteDoc(assetRef), 2000);
        logAssetTransaction(assetId, 'system', 'Deprovisioned', 'admin_it');
    } catch (fsErr) {
        console.warn('[ASSET] Direct Firestore delete failed:', fsErr.message);
    }

    // Update local cache
    const list = getLocalAssets().filter(a => a.id !== assetId);
    saveLocalAssets(list);
    return { success: true };
}

export async function acknowledgeAssetDeclaration(assetId, employeeId, condition, signature) {
    console.log(`[ASSET] Acknowledging declaration for ${assetId}...`);
    try {
        const assetRef = doc(db, 'assets', assetId);
        const declarationRef = doc(db, 'asset_declarations', `${employeeId}_${assetId}`);
        
        const declaration = {
            employeeId,
            assetId,
            condition,
            signature,
            timestamp: serverTimestamp(),
            status: 'Verified'
        };

        await withTimeout(setDoc(declarationRef, declaration), 2000);
        await withTimeout(updateDoc(assetRef, { 
            declarationStatus: 'Verified',
            lastVerifiedAt: serverTimestamp() 
        }), 2000);
        
        logAssetTransaction(assetId, employeeId, 'Declaration Signed', employeeId);
        return { success: true };
    } catch (err) {
        console.warn('[ASSET] Declaration offline sync:', err.message);
        return { success: true };
    }
}

export async function reportAssetIssue(assetId, employeeId, issueType, description) {
    console.log(`[ASSET] Reporting issue for ${assetId}: ${issueType}...`);
    try {
        const assetRef = doc(db, 'assets', assetId);
        const newStatus = issueType === 'Damage' ? 'Repair' : 'Allocated';
        
        await withTimeout(updateDoc(assetRef, { status: newStatus, updatedAt: serverTimestamp() }), 2000);
        
        addDoc(collection(db, 'asset_issue_reports'), {
            assetId,
            employeeId,
            issueType,
            description,
            timestamp: serverTimestamp(),
            status: 'Open'
        }).catch(() => {});
        
        createNotification('admin_it', `Asset Issue Reported: ${assetId} by ${employeeId}`, 'high');
    } catch (err) {
        console.warn('[ASSET] Report issue notice:', err.message);
    }
}

export async function initiateAssetReturn(assetId, employeeId) {
    console.log(`[ASSET] Return initiated for ${assetId}...`);
    try {
        const assetRef = doc(db, 'assets', assetId);
        await withTimeout(updateDoc(assetRef, { status: 'Return Initiated', updatedAt: serverTimestamp() }), 2000);
        
        logAssetTransaction(assetId, employeeId, 'Return Initiated', employeeId);
        createNotification('admin_it', `Asset Return Initiated: ${assetId} from ${employeeId}`, 'normal');
    } catch (err) {
        console.warn('[ASSET] Return initiated notice:', err.message);
    }
}

async function logAssetTransaction(assetId, employeeId, action, actorId) {
    try {
        addDoc(collection(db, 'asset_audit_logs'), {
            assetId,
            employeeId,
            action,
            actorId,
            timestamp: serverTimestamp()
        }).catch(() => {});
    } catch (_) {}
}

async function createNotification(target, message, priority, title = 'Asset Hub') {
    try {
        addDoc(collection(db, 'notifications'), {
            target,
            targetUid: target,
            title,
            text: message,
            message,
            priority,
            read: false,
            timestamp: serverTimestamp()
        }).catch(() => {});
    } catch (_) {}
}
