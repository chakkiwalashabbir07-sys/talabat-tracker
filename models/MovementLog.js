const mongoose = require('mongoose');

const movementLogSchema = new mongoose.Schema({
  student_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  trno: { type: Number, required: true, index: true },
  itsid: { type: String, default: '', index: true },
  student_name: { type: String, default: '' },
  pouch_no: { type: String, default: '', index: true },
  roomno: { type: String, default: '' },
  darajah: { type: String, default: '' },
  floor: { type: String, default: '' },
  action: { type: String, enum: ['IN', 'OUT'], required: true },
  reason: { type: String, default: 'Phone Submission/Return' },
  phone_brand: { type: String, default: '' },
  phone_model: { type: String, default: '' },
  reference_no: { type: String, default: '' },
  notes: { type: String, default: '' },
  staff_username: { type: String, default: 'staff' },
  staff_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  timestamp: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

module.exports = mongoose.model('MovementLog', movementLogSchema);