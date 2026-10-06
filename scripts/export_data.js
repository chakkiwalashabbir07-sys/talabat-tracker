require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

async function exportLocalData() {
  const localUri = 'mongodb://127.0.0.1:27017/student_tracker';
  console.log('Connecting to local MongoDB...');
  await mongoose.connect(localUri);

  const Student = require('../models/Student');
  const User = require('../models/User');
  const MovementLog = require('../models/MovementLog');

  const students = await Student.find({}).lean();
  const users = await User.find({}).lean();
  const logs = await MovementLog.find({}).lean();

  const backupData = {
    exportedAt: new Date().toISOString(),
    totalStudents: students.length,
    totalUsers: users.length,
    totalLogs: logs.length,
    students,
    users,
    logs
  };

  const backupPath = path.join(__dirname, '..', 'database_backup.json');
  fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2), 'utf-8');

  console.log(`Backup completed successfully!`);
  console.log(`Saved to: ${backupPath}`);
  console.log(`Summary: ${students.length} students, ${users.length} users, ${logs.length} movement logs.`);

  await mongoose.disconnect();
  process.exit(0);
}

exportLocalData().catch(err => {
  console.error('Export failed:', err);
  process.exit(1);
});
