require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const connectDB = require('./config/db');
const User = require('./models/User');

async function seedDB() {
  await connectDB();

  try {
    // 1. Hash passwords
    const adminPassword = await bcrypt.hash('admin123', 10);
    const guardPassword = await bcrypt.hash('guard123', 10);

    // 2. Upsert Admin and Guard accounts safely (does not delete student records)
    await User.findOneAndUpdate(
      { username: 'admin' },
      { $set: { password: adminPassword, role: 'admin' } },
      { upsert: true }
    );

    await User.findOneAndUpdate(
      { username: 'guard' },
      { $set: { password: guardPassword, role: 'guard' } },
      { upsert: true }
    );

    console.log("Admin and Guard accounts verified/created successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Seeding failed:", error);
    process.exit(1);
  }
}

seedDB();