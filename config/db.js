const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Helper to auto-encode special characters (like '@') in password
function cleanMongoUri(rawUri) {
  if (!rawUri) return rawUri;
  const match = rawUri.match(/^(mongodb(?:\+srv)?:\/\/)([^:]+):(.*)@([^@/]+(?:\/.*)?)$/);
  if (match) {
    const protocol = match[1];
    const username = match[2];
    const password = match[3];
    const rest = match[4];
    return `${protocol}${username}:${encodeURIComponent(decodeURIComponent(password))}@${rest}`;
  }
  return rawUri;
}

// Auto-seed cloud database if empty
async function autoSeedCloudDB() {
  try {
    const Student = require('../models/Student');
    const User = require('../models/User');
    const MovementLog = require('../models/MovementLog');

    const studentCount = await Student.countDocuments();
    if (studentCount === 0) {
      console.log('--- Initializing Empty Cloud Database ---');
      const seedPath = path.join(__dirname, '..', 'seed_data.json');
      if (fs.existsSync(seedPath)) {
        const raw = fs.readFileSync(seedPath, 'utf-8');
        const data = JSON.parse(raw);

        if (data.students && data.students.length > 0) {
          console.log(`Auto-seeding ${data.students.length} students...`);
          const studentOps = data.students.map(s => ({
            updateOne: { filter: { trno: s.trno }, update: { $set: s }, upsert: true }
          }));
          await Student.bulkWrite(studentOps);
        }

        if (data.users && data.users.length > 0) {
          console.log(`Auto-seeding ${data.users.length} users...`);
          const userOps = data.users.map(u => ({
            updateOne: { filter: { username: u.username }, update: { $set: u }, upsert: true }
          }));
          await User.bulkWrite(userOps);
        }

        // Always ensure admin and guard credentials exist with known passwords
        const bcrypt = require('bcryptjs');
        const adminHash = await bcrypt.hash('admin123', 10);
        const guardHash = await bcrypt.hash('guard123', 10);
        await User.findOneAndUpdate(
          { username: 'admin' },
          { $set: { password: adminHash, role: 'admin' } },
          { upsert: true }
        );
        await User.findOneAndUpdate(
          { username: 'guard' },
          { $set: { password: guardHash, role: 'guard' } },
          { upsert: true }
        );

        if (data.logs && data.logs.length > 0) {
          console.log(`Auto-seeding ${data.logs.length} movement logs...`);
          const logOps = data.logs.map(l => ({
            updateOne: { filter: { _id: l._id }, update: { $set: l }, upsert: true }
          }));
          await MovementLog.bulkWrite(logOps);
        }

        console.log('--- Cloud Database Initialized Successfully! ---');
      }
    }
  } catch (err) {
    console.error('Auto-seed warning:', err.message);
  }
}

const connectDB = async () => {
  let uri = (process.env.MONGO_URI && !process.env.MONGO_URI.includes('your_secure_password'))
    ? cleanMongoUri(process.env.MONGO_URI)
    : (process.env.NODE_ENV === 'production' ? null : 'mongodb://127.0.0.1:27017/student_tracker');

  if (!uri) {
    console.error('===============================================================');
    console.error('ERROR: MONGO_URI environment variable is missing in Render!');
    console.error('Please go to Render Dashboard -> Environment and add MONGO_URI.');
    console.error('===============================================================');
    return;
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000
    });
    console.log('MongoDB Connected Successfully to:', mongoose.connection.host);
    await autoSeedCloudDB();
  } catch (error) {
    console.error('MongoDB Connection Error:', error.message);
    console.error('Make sure your MongoDB Atlas IP Access List allows 0.0.0.0/0 (anywhere).');
  }
};

module.exports = connectDB;