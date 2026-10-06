require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

async function importToAtlas() {
  const atlasUri = process.argv[2] || process.env.MONGO_URI;

  if (!atlasUri || atlasUri.includes('your_secure_password') || atlasUri.includes('127.0.0.1')) {
    console.error('ERROR: Please provide a valid MongoDB Atlas connection string.');
    console.error('Usage: node scripts/import_to_atlas.js "mongodb+srv://user:pass@cluster.mongodb.net/student_tracker"');
    process.exit(1);
  }

  const backupPath = path.join(__dirname, '..', 'database_backup.json');
  if (!fs.existsSync(backupPath)) {
    console.error(`ERROR: Backup file not found at ${backupPath}. Run 'node scripts/export_data.js' first.`);
    process.exit(1);
  }

  const raw = fs.readFileSync(backupPath, 'utf-8');
  const data = JSON.parse(raw);

  console.log(`Connecting to MongoDB Atlas...`);
  await mongoose.connect(atlasUri);
  console.log(`Connected to Atlas successfully!`);

  const Student = require('../models/Student');
  const User = require('../models/User');
  const MovementLog = require('../models/MovementLog');

  // Import Students
  if (data.students && data.students.length > 0) {
    console.log(`Importing ${data.students.length} students...`);
    const studentOps = data.students.map(s => ({
      updateOne: {
        filter: { trno: s.trno },
        update: { $set: s },
        upsert: true
      }
    }));
    await Student.bulkWrite(studentOps);
    console.log(`Students imported successfully!`);
  }

  // Import Users
  if (data.users && data.users.length > 0) {
    console.log(`Importing ${data.users.length} users...`);
    const userOps = data.users.map(u => ({
      updateOne: {
        filter: { username: u.username },
        update: { $set: u },
        upsert: true
      }
    }));
    await User.bulkWrite(userOps);
    console.log(`Users imported successfully!`);
  }

  // Import Movement Logs
  if (data.logs && data.logs.length > 0) {
    console.log(`Importing ${data.logs.length} movement logs...`);
    const logOps = data.logs.map(l => ({
      updateOne: {
        filter: { _id: l._id },
        update: { $set: l },
        upsert: true
      }
    }));
    await MovementLog.bulkWrite(logOps);
    console.log(`Movement logs imported successfully!`);
  }

  console.log('--- ALL DATA IMPORTED TO MONGODB ATLAS SUCCESSFULLY! ---');
  await mongoose.disconnect();
  process.exit(0);
}

importToAtlas().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
