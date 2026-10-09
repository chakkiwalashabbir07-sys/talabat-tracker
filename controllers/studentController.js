const Student = require('../models/Student');
const MovementLog = require('../models/MovementLog');
const xlsx = require('xlsx');

// Helper to extract values by flexible column names (ignoring casing, spaces, underscores, dots)
function getVal(row, ...keys) {
  const rowKeys = Object.keys(row);
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && String(row[k]).trim() !== '') {
      return row[k];
    }
    const cleanK = k.toLowerCase().replace(/[\s_.-]/g, '');
    const foundKey = rowKeys.find(rk => rk.toLowerCase().replace(/[\s_.-]/g, '') === cleanK);
    if (foundKey && row[foundKey] !== undefined && row[foundKey] !== null && String(row[foundKey]).trim() !== '') {
      return row[foundKey];
    }
  }
  return '';
}

// 1. Search Students (Method B: Manual Entry by Name, TR No, ITS ID, or Pouch #)
exports.searchStudents = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      return res.json({ success: true, count: 0, students: [] });
    }

    const num = Number(q);
    const conditions = [
      { name: { $regex: q, $options: 'i' } },
      { itsid: { $regex: q, $options: 'i' } },
      { roomno: { $regex: q, $options: 'i' } },
      { pouch_no: q },
      { mobile: q }
    ];

    if (!isNaN(num) && q !== '') {
      conditions.push({ trno: num });
    }

    const students = await Student.find({ $or: conditions })
      .select('trno name itsid roomno darajah floor pouch_no mobile mobile_status current_status last_phone_in last_phone_out last_staff_username phone_brand')
      .limit(30)
      .sort({ name: 1 });

    res.json({ success: true, count: students.length, students });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Search error: ' + error.message });
  }
};

// 2. Get student profile by TrNo or ITSID (with active submission log details)
exports.getStudentByTrNo = async (req, res) => {
  try {
    const rawParam = String(req.params.trno || '').trim();
    if (!rawParam) {
      return res.status(400).json({ success: false, message: 'Please provide a valid TR No or ITS ID' });
    }

    const numericVal = Number(rawParam);
    const conditions = [];

    if (!isNaN(numericVal) && rawParam !== '') {
      conditions.push({ trno: numericVal });
      conditions.push({ itsid: String(numericVal) });
    }
    conditions.push({ itsid: rawParam });

    const student = await Student.findOne({ $or: conditions });
    if (!student) {
      return res.status(404).json({ success: false, message: `Student "${rawParam}" not found in database.` });
    }

    // Retrieve active submission log if currently IN
    let activeLog = null;
    if (student.active_log_id) {
      activeLog = await MovementLog.findById(student.active_log_id);
    } else if (student.mobile_status === 'IN' || student.current_status === 'IN') {
      activeLog = await MovementLog.findOne({ trno: student.trno, action: 'IN' }).sort({ timestamp: -1 });
    }

    res.json({ success: true, student, activeLog });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 3. Comprehensive Dashboard Metrics
exports.getDashboardMetrics = async (req, res) => {
  try {
    const total = await Student.countDocuments();
    const inCount = await Student.countDocuments({
      $or: [{ mobile_status: 'IN' }, { current_status: 'IN' }]
    });
    const outCount = await Student.countDocuments({
      $or: [{ mobile_status: 'OUT' }, { current_status: 'OUT' }]
    });
    const notSubmittedCount = await Student.countDocuments({
      mobile_status: { $nin: ['IN', 'OUT'] },
      current_status: { $nin: ['IN', 'OUT'] }
    });

    const recentTransactions = await MovementLog.find()
      .sort({ timestamp: -1 })
      .limit(8);

    res.json({
      success: true,
      total,
      inCount,
      outCount,
      notSubmittedCount,
      heldInOffice: inCount,
      recentTransactions
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Alias for backwards compatibility
exports.getStats = exports.getDashboardMetrics;

// 4. Get list of students who have not submitted their mobile phones
exports.getNotSubmittedStudents = async (req, res) => {
  try {
    const { floor, search } = req.query;
    let filter = {
      mobile_status: { $nin: ['IN', 'OUT'] },
      current_status: { $nin: ['IN', 'OUT'] }
    };

    if (floor) {
      filter.floor = { $regex: floor.trim(), $options: 'i' };
    }

    if (search && search.trim() !== '') {
      const q = search.trim();
      const numQ = Number(q);
      const orC = [
        { name: { $regex: q, $options: 'i' } },
        { itsid: { $regex: q, $options: 'i' } },
        { pouch_no: q }
      ];
      if (!isNaN(numQ)) orC.push({ trno: numQ });
      filter.$and = [{ $or: orC }];
    }

    const students = await Student.find(filter)
      .select('trno name itsid roomno darajah floor pouch_no mobile mobile_status')
      .sort({ trno: 1 });

    res.json({ success: true, count: students.length, students });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 5. Get list of all students currently with phone IN (in office custody)
exports.getInStudents = async (req, res) => {
  try {
    const students = await Student.find({
      $or: [{ mobile_status: 'IN' }, { current_status: 'IN' }]
    }).sort({ updatedAt: -1 });

    res.json({ success: true, count: students.length, students });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 6. Get list of all students currently OUT (phone returned)
exports.getOutStudents = async (req, res) => {
  try {
    const students = await Student.find({
      $or: [{ mobile_status: 'OUT' }, { current_status: 'OUT' }]
    }).sort({ updatedAt: -1 });

    res.json({ success: true, count: students.length, students });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 7. Register a new single student
exports.createStudent = async (req, res) => {
  const { trno, name, roomno, darajah, itsid, floor, mobile, pouch_no } = req.body;
  if (!trno || !name || !roomno || !darajah) {
    return res.status(400).json({ success: false, message: 'TR No, Name, Room, and Darajah are required' });
  }

  const pouchVal = String(pouch_no || mobile || '').trim();

  try {
    const newStudent = await Student.create({
      trno: Number(trno),
      name: String(name).trim(),
      roomno: String(roomno).trim(),
      darajah: String(darajah).trim(),
      itsid: itsid ? String(itsid).trim() : '',
      floor: floor ? String(floor).trim() : '',
      mobile: pouchVal,
      pouch_no: pouchVal,
      mobile_status: 'NOT_SUBMITTED',
      current_status: 'NOT_SUBMITTED'
    });
    res.json({ success: true, message: 'Student registered successfully', student: newStudent });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'TR No already exists!' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
};

// 8. Bulk upload students from Excel (.xlsx / .xls)
exports.importStudentsFromExcel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please select an Excel file' });
    }

    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    if (!workbook.SheetNames.length) {
      return res.status(400).json({ success: false, message: 'Excel file is empty' });
    }

    const sheetData = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });

    let count = 0;
    for (const row of sheetData) {
      const rawTr = getVal(row, 'trno', 'tr no', 'tr', 'rollno', 'id');
      const trno = Number(rawTr);
      const name = String(getVal(row, 'name', 'student name')).trim();

      if (!trno || isNaN(trno) || !name || name.toLowerCase() === 'empty') continue;

      const roomno = String(getVal(row, 'roomno', 'room no', 'room')).trim();
      const darajah = String(getVal(row, 'darajah', 'daraja', 'class')).trim();
      const itsid = String(getVal(row, 'itsid', 'its', 'its id')).trim();
      const floor = String(getVal(row, 'floor')).trim();
      const mobile = String(getVal(row, 'mobile', 'pouch', 'pouchno', 'pouch no', 'pouch_no', 'mobile pouch', 'phone')).trim();

      await Student.findOneAndUpdate(
        { trno },
        {
          $set: {
            name,
            roomno,
            darajah,
            itsid,
            floor,
            mobile,
            pouch_no: mobile
          },
          $setOnInsert: {
            mobile_status: 'NOT_SUBMITTED',
            current_status: 'NOT_SUBMITTED'
          }
        },
        { upsert: true, returnDocument: 'after' }
      );
      count++;
    }

    res.json({ success: true, message: `${count} students processed and updated successfully!` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Excel Processing Error: ' + error.message });
  }
};