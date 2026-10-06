const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const uri = (process.env.MONGO_URI && !process.env.MONGO_URI.includes('your_secure_password'))
      ? process.env.MONGO_URI
      : 'mongodb://127.0.0.1:27017/student_tracker';

    await mongoose.connect(uri);
    console.log('MongoDB Connected Successfully');
  } catch (error) {
    console.error('MongoDB Connection Error:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;