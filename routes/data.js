const express = require('express');
const router = express.Router();
const { db } = require('../config/firebase');

// 1. Add Employee Data
router.post('/employees', async (req, res) => {
  try {
    const employeeData = req.body;
    if (!employeeData.email || !employeeData.name) {
      return res.status(400).json({ success: false, message: 'Name and Email are required' });
    }
    
    const docRef = await db.collection('employees').add({
      ...employeeData,
      createdAt: new Date().toISOString()
    });
    
    res.status(201).json({
      success: true,
      message: 'Employee added successfully',
      id: docRef.id
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 2. Fetch Attendance Data
router.get('/attendance', async (req, res) => {
  try {
    const snapshot = await db.collection('attendance').orderBy('date', 'desc').get();
    const attendance = [];
    snapshot.forEach(doc => attendance.push({ id: doc.id, ...doc.data() }));
    
    res.status(200).json({ success: true, count: attendance.length, data: attendance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 3. Fetch Payroll Data
router.get('/payroll', async (req, res) => {
  try {
    const snapshot = await db.collection('payroll').get();
    const payroll = [];
    snapshot.forEach(doc => payroll.push({ id: doc.id, ...doc.data() }));
    
    res.status(200).json({ success: true, count: payroll.length, data: payroll });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 4. Generic Fetch
router.get('/fetch', async (req, res) => {
  try {
    const { collection } = req.query;
    if (!collection) return res.status(400).json({ success: false, message: 'Collection name required' });
    
    const snapshot = await db.collection(collection).get();
    const data = [];
    snapshot.forEach(doc => data.push({ id: doc.id, ...doc.data() }));
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 5. Generic Add (For Leave Requests, Task Updates, etc.)
router.post('/add', async (req, res) => {
  try {
    const { collection, data } = req.body;
    if (!collection || !data) {
        return res.status(400).json({ success: false, message: 'Collection and data are required' });
    }
    
    const docRef = await db.collection(collection).add({
        ...data,
        timestamp: new Date().toISOString()
    });
    
    res.status(201).json({ success: true, id: docRef.id });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// 6. Workforce Stats
router.get('/stats', async (req, res) => {
    try {
        const empSnap = await db.collection('users').where('role', '==', 'employee').get();
        const attendSnap = await db.collection('attendance').where('date', '==', new Date().toISOString().split('T')[0]).get();
        const leaveSnap = await db.collection('leave_requests').where('status', '==', 'approved').get(); // Simplified

        res.status(200).json({
            success: true,
            totalEmployees: empSnap.size,
            presentToday: attendSnap.size,
            onLeave: leaveSnap.size
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 7. Log Attendance automatically to Server-side CSV (Excel compatible)
const fs = require('fs');
const path = require('path');

router.post('/log-attendance-excel', async (req, res) => {
    try {
        const { date, userId, name, department, punchIn, punchOut, duration, status } = req.body;
        
        const logDir = path.join(__dirname, '../logs');
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        
        const filePath = path.join(logDir, 'attendance_excel_log.csv');
        const fileExists = fs.existsSync(filePath);
        
        if (!fileExists) {
            const header = 'Date,Employee ID,Employee Name,Department,Punch In,Punch Out,Duration (Hours),Status\n';
            fs.writeFileSync(filePath, header, 'utf8');
        }
        
        const escapeCsv = (str) => `"${(str || '').replace(/"/g, '""')}"`;
        const row = `${escapeCsv(date)},${escapeCsv(userId)},${escapeCsv(name)},${escapeCsv(department)},${escapeCsv(punchIn)},${escapeCsv(punchOut)},${escapeCsv(duration)},${escapeCsv(status)}\n`;
        
        fs.appendFileSync(filePath, row, 'utf8');
        
        res.status(200).json({ success: true, message: 'Attendance stored automatically in server excelsheet (CSV).' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;
