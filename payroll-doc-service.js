import { db } from "./firebase-config.js";
import { collection, doc, setDoc, updateDoc, serverTimestamp, getDoc, query, where, getDocs, addDoc } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

/**
 * Payroll Document Generation Service
 * Handles Payslips, Invoices, Experience Letters, and Encryption.
 */

export async function generateDocument(employeeId, docType, data) {
    console.log(`[PAYROLL] Generating ${docType} for ${employeeId}...`);
    try {
        const docId = `${docType.substring(0,3).toUpperCase()}-${Date.now()}`;
        const docRef = doc(db, 'payroll_documents', docId);
        
        // Security logic: Watermarking & Encryption (Simulated)
        const secureMetadata = {
            isEncrypted: true,
            encryptionType: 'AES-256',
            watermark: 'HRFlow Confidential',
            generatedBy: 'System Admin',
            generationIp: '192.168.1.1'
        };

        const payload = {
            ...data,
            employeeId,
            docId,
            docType,
            status: 'Generated',
            security: secureMetadata,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        await setDoc(docRef, payload);
        
        // Log Access
        await logAccess(employeeId, docId, 'Generation');
        
        // Create Notification
        await createNotification(employeeId, `Your ${docType} for the current cycle is now available in your portal.`, 'normal');
        
        return { success: true, docId };
    } catch (err) {
        console.error('[PAYROLL] Document generation failed:', err);
        throw err;
    }
}

export async function generateMonthlyBatch(month, year) {
    console.log(`[PAYROLL] Initiating batch generation for ${month} ${year}...`);
    const employeesSnap = await getDocs(collection(db, 'users'));
    
    let count = 0;
    for (const empDoc of employeesSnap.docs) {
        const emp = empDoc.data();
        if ((emp.role || '').toLowerCase() === 'admin') continue; // Skip admins

        const type = emp.employmentType === 'Full Time' ? 'Payslip' : 'Invoice';
        
        const gross = emp.salary || 50000;
        await generateDocument(empDoc.id, type, {
            period: `${month} ${year}`,
            employeeName: emp.name,
            designation: emp.designation,
            grossSalary: gross,
            breakdown: {
                basic: gross * 0.45,
                hra: gross * 0.25,
                variable: gross * 0.2,
                tax: gross * 0.1
            },
            deductions: gross * 0.1 // Simulated 10% deduction
        });
        count++;
    }
    return { success: true, count };
}

async function logAccess(userId, docId, action) {
    await addDoc(collection(db, 'document_audit_logs'), {
        userId,
        docId,
        action,
        timestamp: serverTimestamp(),
        ip: '192.168.1.1'
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

export async function generateFullFinal(employeeId) {
    console.log(`[PAYROLL] Processing F&F Settlement for ${employeeId}...`);
    // Logic for settlement calculation
    return generateDocument(employeeId, 'F&F Settlement', {
        settlementDate: new Date().toISOString(),
        gratuity: 0,
        leaveEncashment: 12000,
        noticePay: 0
    });
}

export async function disburseSalaries(authority) {
    console.log(`[PAYROLL] Disbursing salaries via ${authority}...`);
    const docsSnap = await getDocs(query(collection(db, 'payroll_documents'), where('status', '==', 'Generated')));
    
    let count = 0;
    for (const d of docsSnap.docs) {
        await updateDoc(doc(db, 'payroll_documents', d.id), {
            status: 'Paid',
            paidVia: authority,
            paidAt: serverTimestamp()
        });
        count++;
    }
    
    await addDoc(collection(db, 'document_audit_logs'), {
        action: 'Mass Salary Disbursement',
        authority,
        count,
        timestamp: serverTimestamp(),
        ip: '192.168.1.1'
    });
    
    return { success: true, count };
}
