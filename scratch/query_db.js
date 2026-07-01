const { db } = require('../config/firebase');

(async () => {
  const userId = 'demo_1782106417274';
  const q = await db.collection('attendance').where('userId', '==', userId).get();
  console.log(`Documents found: ${q.docs.length}`);
  q.docs.forEach(doc => {
    console.log(doc.id, "=>", doc.data());
  });
})();
