import { db } from "./firebase-config.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

async function checkManagers() {
    const q = query(collection(db, "users"), where("role", "==", "manager"));
    const snap = await getDocs(q);
    console.log(`Found ${snap.size} managers:`);
    snap.forEach(doc => {
        console.log(`- ${doc.id}: ${doc.data().name} (${doc.data().email})`);
    });
    
    const empSnap = await getDocs(collection(db, "employees"));
    console.log(`Found ${empSnap.size} employees:`);
    empSnap.forEach(doc => {
        console.log(`- ${doc.id}: ${doc.data().name}`);
    });
}

checkManagers();
