const fs = require('fs');
const path = require('path');
const { db } = require('../config/firebase');

function formatTimestamp(ts) {
  if (!ts) return 'N/A';
  if (typeof ts.toDate === 'function') {
    return ts.toDate().toISOString().replace('T', ' ').substring(0, 19);
  }
  if (ts._seconds !== undefined) {
    return new Date(ts._seconds * 1000).toISOString().replace('T', ' ').substring(0, 19);
  }
  if (ts.toDateString) {
    return ts.toISOString().replace('T', ' ').substring(0, 19);
  }
  return String(ts);
}

function escapeCsv(val) {
  if (val === undefined || val === null) return '""';
  const str = String(val);
  return `"${str.replace(/"/g, '""')}"`;
}

(async () => {
  try {
    console.log("Fetching user profiles...");
    const usersSnap = await db.collection('users').get();
    const usersMap = {};
    usersSnap.forEach(doc => {
      const data = doc.data();
      const uid = doc.id;
      usersMap[uid] = {
        uid: uid,
        employeeId: data.employeeId || 'N/A',
        name: data.fullName || data.name || 'Unnamed Employee',
        email: data.email || 'N/A',
        role: data.role || 'employee',
        department: data.department || data.departmentName || 'N/A'
      };
    });
    console.log(`Loaded ${Object.keys(usersMap).length} users.`);

    console.log("Fetching attendance records...");
    const attendSnap = await db.collection('attendance').get();
    const records = [];
    
    attendSnap.forEach(doc => {
      const data = doc.data();
      const userId = data.userId;
      const user = usersMap[userId] || {};

      // Fallbacks
      const employeeId = user.employeeId || data.employeeId || 'N/A';
      const name = user.name || data.name || data.userName || 'Unnamed Employee';
      const email = user.email || data.email || 'N/A';
      const role = user.role || data.role || 'employee';
      const department = user.department || data.department || 'N/A';

      records.push({
        date: data.date, // format YYYY-MM-DD
        employeeId,
        name,
        email,
        role,
        department,
        punchIn: formatTimestamp(data.punchIn),
        punchOut: formatTimestamp(data.punchOut),
        durationHours: data.durationHours !== undefined ? Number(data.durationHours).toFixed(2) : 'N/A',
        status: data.status || 'Present'
      });
    });

    console.log(`Loaded ${records.length} attendance records.`);

    // Define date boundaries (relative to local time: June 23, 2026)
    const todayStr = '2026-06-23';
    const today = new Date(todayStr);

    // Calculate dates
    const oneWeekAgo = new Date(today);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    // Filter reports
    // 1. Weekly: logs from last 7 days (>= oneWeekAgo date string)
    const weeklyRecords = records.filter(r => r.date && r.date >= oneWeekAgo.toISOString().split('T')[0]);
    // 2. Monthly: logs in current month (June 2026, i.e., starts with '2026-06')
    const monthlyRecords = records.filter(r => r.date && r.date.startsWith('2026-06'));
    // 3. Yearly: logs in current year (2026, i.e., starts with '2026')
    const yearlyRecords = records.filter(r => r.date && r.date.startsWith('2026'));

    const reportsDir = path.join(__dirname, '../reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const headers = 'Date,Employee ID,Employee Name,Official Email,Role,Department,Punch In Time,Punch Out Time,Duration (Hours),Status\n';

    const generateCsvContent = (filteredRecords) => {
      let content = headers;
      // Sort by Date descending, then Name ascending
      const sorted = filteredRecords.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return a.name.localeCompare(b.name);
      });
      sorted.forEach(r => {
        content += `${escapeCsv(r.date)},${escapeCsv(r.employeeId)},${escapeCsv(r.name)},${escapeCsv(r.email)},${escapeCsv(r.role)},${escapeCsv(r.department)},${escapeCsv(r.punchIn)},${escapeCsv(r.punchOut)},${escapeCsv(r.durationHours)},${escapeCsv(r.status)}\n`;
      });
      return content;
    };

    const weeklyFile = path.join(reportsDir, 'weekly_attendance_report.csv');
    const monthlyFile = path.join(reportsDir, 'monthly_attendance_report.csv');
    const yearlyFile = path.join(reportsDir, 'yearly_attendance_report.csv');

    fs.writeFileSync(weeklyFile, generateCsvContent(weeklyRecords), 'utf8');
    fs.writeFileSync(monthlyFile, generateCsvContent(monthlyRecords), 'utf8');
    fs.writeFileSync(yearlyFile, generateCsvContent(yearlyRecords), 'utf8');

    console.log(`CSV reports generated successfully!`);
    console.log(`Weekly Report: ${weeklyFile} (${weeklyRecords.length} records)`);
    console.log(`Monthly Report: ${monthlyFile} (${monthlyRecords.length} records)`);
    console.log(`Yearly Report: ${yearlyFile} (${yearlyRecords.length} records)`);

  } catch (err) {
    console.error("Failed to generate reports:", err);
    process.exit(1);
  }
})();
