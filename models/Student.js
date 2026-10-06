const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  trno: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  roomno: { type: String, required: true },
  darajah: { type: String, required: true },
  itsid: { type: String, default: '' },
  floor: { type: String, default: '' },
  mobile: { type: String, default: '' },
  pouch_no: { type: String, default: '' },
  // Mobile Phone Tracking Fields
  mobile_status: { type: String, enum: ['IN', 'OUT', 'NOT_SUBMITTED'], default: 'NOT_SUBMITTED' },
  phone_brand: { type: String, default: '' },
  phone_model: { type: String, default: '' },
  active_log_id: { type: mongoose.Schema.Types.ObjectId, ref: 'MovementLog', default: null },
  last_phone_in: { type: Date, default: null },
  last_phone_out: { type: Date, default: null },
  last_staff_username: { type: String, default: '' },
  current_status: { type: String, enum: ['IN', 'OUT', 'NOT_SUBMITTED'], default: 'NOT_SUBMITTED' }
}, { timestamps: true });

module.exports = mongoose.model('Student', studentSchema);