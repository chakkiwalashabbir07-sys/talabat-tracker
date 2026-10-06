const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = (process.env.MONGO_URI && !process.env.MONGO_URI.includes('your_secure_password'))
    ? process.env.MONGO_URI
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
      serverSelectionTimeoutMS: 5000
    });
    console.log('MongoDB Connected Successfully');
  } catch (error) {
    console.error('MongoDB Connection Error:', error.message);
    console.error('Make sure your MongoDB Atlas IP Access List allows 0.0.0.0/0 (anywhere).');
  }
};

module.exports = connectDB;