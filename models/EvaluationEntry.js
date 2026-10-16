const mongoose = require('mongoose');

const evaluationEntrySchema = new mongoose.Schema({
  trno: { 
    type: Number, 
    required: true, 
    index: true 
  },
  itsid: { 
    type: String, 
    default: '', 
    trim: true, 
    index: true 
  },
  studentName: { 
    type: String, 
    required: true, 
    trim: true 
  },
  darajah: { 
    type: String, 
    default: '', 
    trim: true 
  },
  room: { 
    type: String, 
    default: '', 
    trim: true 
  },
  floor: { 
    type: String, 
    default: '', 
    trim: true 
  },
  building: { 
    type: String, 
    default: 'Male Residences', 
    trim: true 
  },
  evaluationType: { 
    type: String, 
    required: true, 
    enum: ['Tashjee', 'Tanbeeh'],
    index: true 
  },
  idara: { 
    type: String, 
    required: true, 
    default: 'Male Residences',
    trim: true 
  },
  remark: { 
    type: String, 
    required: true, 
    trim: true 
  },
  extraDetails: { 
    type: String, 
    default: '', 
    trim: true 
  },
  points: { 
    type: Number, 
    default: 10 
  },
  status: { 
    type: String, 
    enum: ['SUBMITTED', 'SKIPPED_DUPLICATE', 'FAILED', 'PENDING'], 
    default: 'SUBMITTED',
    index: true 
  },
  submissionType: { 
    type: String, 
    enum: ['MANUAL', 'BULK'], 
    default: 'MANUAL' 
  },
  portalMessage: { 
    type: String, 
    default: '' 
  },
  submittedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    default: null 
  },
  submittedByName: { 
    type: String, 
    default: 'System User' 
  }
}, { timestamps: true });

evaluationEntrySchema.index({ trno: 1, evaluationType: 1, createdAt: -1 });

module.exports = mongoose.model('EvaluationEntry', evaluationEntrySchema);
