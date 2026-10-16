const mongoose = require('mongoose');

const evaluationRemarkSchema = new mongoose.Schema({
  text: { 
    type: String, 
    required: true, 
    trim: true 
  },
  evaluationType: { 
    type: String, 
    required: true, 
    enum: ['Tashjee', 'Tanbeeh'],
    index: true 
  },
  departments: [{
    type: String,
    trim: true
  }],
  idara: { 
    type: String, 
    default: 'Male Residences', 
    trim: true,
    index: true 
  },
  points: { 
    type: Number, 
    default: 10 
  },
  isCustom: { 
    type: Boolean, 
    default: false 
  }
}, { timestamps: true });

evaluationRemarkSchema.index({ evaluationType: 1, text: 1 });
evaluationRemarkSchema.index({ departments: 1 });

module.exports = mongoose.model('EvaluationRemark', evaluationRemarkSchema);
