const { db } = require('../config/firebase');

(async () => {
  try {
    const attendSnap = await db.collection('attendance').limit(5).get();
    console.log(`Found ${attendSnap.size} attendance records:`);
    attendSnap.forEach(doc => {
      console.log(doc.id, '=>', doc.data());
    });

    const userSnap = await db.collection('users').limit(5).get();
    console.log(`Found ${userSnap.size} user records:`);
    userSnap.forEach(doc => {
      console.log(doc.id, '=>', doc.data());
    });
  } catch (err) {
    console.error("Error reading database:", err);
  }
})();
