const fs = require('fs');
const path = require('path');
const Student = require('../models/Student');
const EvaluationEntry = require('../models/EvaluationEntry');
const EvaluationRemark = require('../models/EvaluationRemark');
const evaluationAutomationService = require('../services/evaluationAutomationService');

// Auto-seed remarks if empty
async function ensureRemarksSeeded() {
  try {
    const count = await EvaluationRemark.countDocuments();
    if (count === 0) {
      const seedFile = path.join(__dirname, '..', 'data', 'evaluation_remarks.json');
      if (fs.existsSync(seedFile)) {
        const raw = fs.readFileSync(seedFile, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data) && data.length > 0) {
          console.log(`[Evaluation] Auto-seeding ${data.length} remarks...`);
          await EvaluationRemark.insertMany(data);
        }
      }
    }
  } catch (err) {
    console.warn('[Evaluation] Remark seed notice:', err.message);
  }
}

// 1. Get All Remarks API
exports.apiGetRemarks = async (req, res) => {
  try {
    await ensureRemarksSeeded();
    const { type, idara } = req.query;
    const filter = {};
    if (type) filter.evaluationType = type;
    if (idara && idara !== 'All') {
      filter.$or = [
        { departments: idara },
        { idara: idara }
      ];
    }
    const remarks = await EvaluationRemark.find(filter).sort({ evaluationType: 1, text: 1 });
    res.json({ success: true, count: remarks.length, remarks });
  } catch (error) {
    console.error('Error fetching remarks:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 2. Search Student by TRNO API (Searches Talabat Tracker Students)
exports.apiSearchStudent = async (req, res) => {
  try {
    const trnoInput = req.query.trno || req.query.q;
    if (!trnoInput) {
      return res.status(400).json({ success: false, message: 'TRNO parameter is required.' });
    }

    const trnoNum = parseInt(String(trnoInput).trim(), 10);
    if (isNaN(trnoNum)) {
      return res.status(400).json({ success: false, message: 'TRNO must be a valid number.' });
    }

    const student = await Student.findOne({ trno: trnoNum });
    if (!student) {
      return res.status(404).json({
        success: false,
        message: `No student found matching TRNO ${trnoNum} in Talabat records.`
      });
    }

    return res.json({
      success: true,
      student: {
        trno: student.trno,
        itsid: student.itsid || '',
        name: student.name || '',
        darajah: student.darajah || '',
        room: student.roomno || '',
        floor: student.floor || '',
        building: 'Male Residences',
        mobile: student.mobile || '',
        mobile_status: student.mobile_status || 'NOT_SUBMITTED'
      }
    });
  } catch (error) {
    console.error('Error searching student:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Check Duplicate Submission Today API
exports.apiCheckDuplicate = async (req, res) => {
  try {
    const { trno, evaluationType, remark } = req.body;
    if (!trno || !evaluationType || !remark) {
      return res.status(400).json({ success: false, message: 'Missing parameters.' });
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const existing = await EvaluationEntry.findOne({
      trno: Number(trno),
      evaluationType,
      remark,
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    });

    if (existing) {
      return res.json({
        isDuplicate: true,
        message: `⚠️ TRNO ${trno} already received this ${evaluationType} remark today at ${new Date(existing.createdAt).toLocaleTimeString()}.`,
        entry: existing
      });
    }

    return res.json({ isDuplicate: false });
  } catch (error) {
    console.error('Error checking duplicate:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 4. Validate Bulk Students List API
exports.apiValidateBulkStudents = async (req, res) => {
  try {
    const { trnosText, evaluationType, remark } = req.body;
    if (!trnosText || typeof trnosText !== 'string') {
      return res.status(400).json({ success: false, message: 'Please provide TRNOs text.' });
    }

    const matches = trnosText.match(/\d+/g) || [];
    const uniqueTrnos = [...new Set(matches.map(n => parseInt(n, 10)).filter(n => n > 0))];

    if (uniqueTrnos.length === 0) {
      return res.json({
        success: true,
        validStudents: [],
        notFoundTrnos: [],
        duplicateCount: 0
      });
    }

    const students = await Student.find({ trno: { $in: uniqueTrnos } });
    const studentMap = new Map();
    students.forEach(s => studentMap.set(s.trno, s));

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const dupSet = new Set();
    if (evaluationType && remark) {
      const existingEntries = await EvaluationEntry.find({
        trno: { $in: uniqueTrnos },
        evaluationType,
        remark,
        createdAt: { $gte: startOfDay }
      });
      existingEntries.forEach(e => dupSet.add(e.trno));
    }

    const validStudents = [];
    const notFoundTrnos = [];

    for (const tr of uniqueTrnos) {
      const s = studentMap.get(tr);
      if (s) {
        validStudents.push({
          trno: s.trno,
          itsid: s.itsid || '',
          name: s.name || '',
          darajah: s.darajah || '',
          room: s.roomno || '',
          floor: s.floor || '',
          building: 'Male Residences',
          mobile: s.mobile || '',
          isDuplicateToday: dupSet.has(s.trno)
        });
      } else {
        notFoundTrnos.push(tr);
      }
    }

    return res.json({
      success: true,
      totalRequested: uniqueTrnos.length,
      validStudents,
      notFoundTrnos,
      duplicateCount: dupSet.size
    });
  } catch (error) {
    console.error('Error validating bulk students:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 5. Shared Queue Management APIs
exports.apiEnqueueManual = async (req, res) => {
  try {
    const { trno, evaluationType, idara, remark, extraDetails, points } = req.body;
    if (!trno || !evaluationType || !remark) {
      return res.status(400).json({ success: false, message: 'Missing required fields (trno, evaluationType, remark).' });
    }

    const student = await Student.findOne({ trno: Number(trno) });
    const entryData = {
      trno: Number(trno),
      itsid: student ? student.itsid : (req.body.itsid || ''),
      studentName: student ? student.name : (req.body.studentName || `Student ${trno}`),
      darajah: student ? student.darajah : (req.body.darajah || ''),
      room: student ? student.roomno : (req.body.room || ''),
      floor: student ? student.floor : (req.body.floor || ''),
      building: 'Male Residences',
      evaluationType,
      idara: idara || 'Male Residences',
      remark,
      extraDetails: extraDetails || '',
      points: points || (evaluationType === 'Tashjee' ? 10 : -5)
    };

    const item = evaluationAutomationService.enqueueManual(entryData, req.user);
    res.json({
      success: true,
      message: `Enqueued manual entry for TRNO ${trno}.`,
      item,
      queueStatus: evaluationAutomationService.getQueueStatus()
    });
  } catch (error) {
    console.error('Error enqueueing manual entry:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.apiEnqueueBulk = async (req, res) => {
  try {
    const { students, evaluationType, idara, remark, extraDetails, points } = req.body;
    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ success: false, message: 'Students array is required and cannot be empty.' });
    }
    if (!evaluationType || !remark) {
      return res.status(400).json({ success: false, message: 'Evaluation type and remark are required.' });
    }

    const commonParams = {
      evaluationType,
      idara: idara || 'Male Residences',
      remark,
      extraDetails: extraDetails || '',
      points: points || (evaluationType === 'Tashjee' ? 10 : -5)
    };

    const result = evaluationAutomationService.enqueueBulk(students, req.user, commonParams);
    res.json({
      success: true,
      message: `Enqueued ${result.count} students into shared automation queue.`,
      count: result.count,
      jobId: result.jobId,
      queueStatus: evaluationAutomationService.getQueueStatus()
    });
  } catch (error) {
    console.error('Error enqueueing bulk entries:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.apiGetQueueStatus = (req, res) => {
  try {
    const status = evaluationAutomationService.getQueueStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.apiPauseQueue = (req, res) => {
  const result = evaluationAutomationService.pauseQueue();
  res.json({ success: true, ...result });
};

exports.apiResumeQueue = (req, res) => {
  const result = evaluationAutomationService.resumeQueue();
  res.json({ success: true, ...result });
};

exports.apiCancelQueueItem = (req, res) => {
  const result = evaluationAutomationService.cancelQueueItem(req.params.itemId);
  res.json({ success: true, ...result });
};

exports.apiCancelAllQueue = (req, res) => {
  const result = evaluationAutomationService.cancelAllQueue();
  res.json({ success: true, ...result });
};

exports.apiClearQueueHistory = (req, res) => {
  const result = evaluationAutomationService.clearRecentItems();
  res.json({ success: true, ...result });
};

// 6. Stats & History API
exports.apiGetStats = async (req, res) => {
  try {
    const totalCount = await EvaluationEntry.countDocuments();
    const tashjeeCount = await EvaluationEntry.countDocuments({ evaluationType: 'Tashjee' });
    const tanbeehCount = await EvaluationEntry.countDocuments({ evaluationType: 'Tanbeeh' });
    const recentEntries = await EvaluationEntry.find().sort({ createdAt: -1 }).limit(30);

    res.json({
      success: true,
      totalCount,
      tashjeeCount,
      tanbeehCount,
      recentEntries
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 7. Add / Delete Remark APIs
exports.apiAddRemark = async (req, res) => {
  try {
    const { text, evaluationType, idara, points } = req.body;
    if (!text || !evaluationType) {
      return res.status(400).json({ success: false, message: 'Remark text and type are required.' });
    }

    const remark = await EvaluationRemark.create({
      text: text.trim(),
      evaluationType,
      departments: [idara || 'Male Residences'],
      idara: idara || 'Male Residences',
      points: Number(points) || (evaluationType === 'Tashjee' ? 10 : -5),
      isCustom: true
    });

    res.json({ success: true, message: 'Remark added successfully.', remark });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.apiDeleteRemark = async (req, res) => {
  try {
    await EvaluationRemark.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Remark deleted successfully.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
