const { db } = require("../config/firebase");

/**
 * Generates a unique, sequential Employee ID using Firestore transactions.
 * Format: EMP + departmentCode + 4-digit number (e.g., EMPENG0001)
 * 
 * @param {string} departmentCode - The code for the department (e.g., "ENG", "MKT")
 * @returns {Promise<string>} - The generated unique Employee ID
 */
async function generateEmployeeId(departmentCode) {
    if (!departmentCode) throw new Error("Department code is required");
    
    const code = departmentCode.toUpperCase();
    const counterRef = db.collection("counters").doc(`employee_${code}`);

    try {
        const newID = await db.runTransaction(async (transaction) => {
            const counterDoc = await transaction.get(counterRef);
            
            let count = 1;
            if (counterDoc.exists) {
                count = counterDoc.data().count + 1;
            }

            // Update the counter in Firestore
            transaction.set(counterRef, { count: count }, { merge: true });

            // Format the ID: EMP + CODE + 4-digit padded number
            const paddedNumber = count.toString().padStart(4, "0");
            return `EMP${code}${paddedNumber}`;
        });

        return newID;
    } catch (error) {
        console.error("Failed to generate unique Employee ID:", error);
        throw error;
    }
}

module.exports = { generateEmployeeId };
