import { db } from "./firebase-config.js";
import { collection, doc, setDoc, updateDoc, serverTimestamp, getDoc, query, where, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * Enterprise Asset Management Service
 * Handles Allocation, Declarations, Lifecycle Tracking, and Returns.
 */

export async function allocateAsset(assetId, employeeId, adminId) {
    console.log(`[ASSET] Allocating ${assetId} to ${employeeId}...`);
    try {
        const assetRef = doc(db, 'assets', assetId);
        const employeeRef = doc(db, 'users', employeeId);
        
        const payload = {
            status: 'Allocated',
            assignedTo: employeeId,
            assignedAt: serverTimestamp(),
            lastAllocatedBy: adminId,
            declarationStatus: 'Pending',
            updatedAt: serverTimestamp()
        };

        await updateDoc(assetRef, payload);
        
        // Log to Audit Trail
        await logAssetTransaction(assetId, employeeId, 'Allocation', adminId);
        
        // Notify Employee
        await createNotification(employeeId, `A new asset (${assetId}) has been assigned to you. Please sign the declaration form.`, 'high');
        
        return { success: true };
    } catch (err) {
        console.error('[ASSET] Allocation failed:', err);
        throw err;
    }
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

        await setDoc(declarationRef, declaration);
        await updateDoc(assetRef, { 
            declarationStatus: 'Verified',
            lastVerifiedAt: serverTimestamp() 
        });
        
        await logAssetTransaction(assetId, employeeId, 'Declaration Signed', employeeId);
        
        return { success: true };
    } catch (err) {
        console.error('[ASSET] Declaration failed:', err);
        throw err;
    }
}

export async function reportAssetIssue(assetId, employeeId, issueType, description) {
    console.log(`[ASSET] Reporting issue for ${assetId}: ${issueType}...`);
    const assetRef = doc(db, 'assets', assetId);
    
    // Status update: If damage is reported, move to Repair
    const newStatus = issueType === 'Damage' ? 'Repair' : 'Allocated';
    
    await updateDoc(assetRef, { status: newStatus, updatedAt: serverTimestamp() });
    
    await addDoc(collection(db, 'asset_issue_reports'), {
        assetId,
        employeeId,
        issueType,
        description,
        timestamp: serverTimestamp(),
        status: 'Open'
    });
    
    await createNotification('admin_it', `Asset Issue Reported: ${assetId} by ${employeeId}`, 'high');
}

export async function initiateAssetReturn(assetId, employeeId) {
    console.log(`[ASSET] Return initiated for ${assetId}...`);
    const assetRef = doc(db, 'assets', assetId);
    await updateDoc(assetRef, { status: 'Return Initiated', updatedAt: serverTimestamp() });
    
    await logAssetTransaction(assetId, employeeId, 'Return Initiated', employeeId);
    await createNotification('admin_it', `Asset Return Initiated: ${assetId} from ${employeeId}`, 'normal');
}

async function logAssetTransaction(assetId, employeeId, action, actorId) {
    await addDoc(collection(db, 'asset_audit_logs'), {
        assetId,
        employeeId,
        action,
        actorId,
        timestamp: serverTimestamp()
    });
}

async function createNotification(target, message, priority) {
    await addDoc(collection(db, 'notifications'), {
        target,
        message,
        priority,
        read: false,
        timestamp: serverTimestamp()
    });
}
