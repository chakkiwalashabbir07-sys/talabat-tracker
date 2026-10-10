const Student = require('../models/Student');
const MovementLog = require('../models/MovementLog');
const xlsx = require('xlsx');

// Record Mobile IN (Phone Submitted) or Mobile OUT (Phone Returned)
exports.recordMovement = async (req, res) => {
  const { trno, action, reason, phone_brand, phone_model, reference_no, notes } = req.body;

  if (!trno || !action) {
    return res.status(400).json({ success: false, message: 'Missing student identifier (trno/itsid) or action (IN/OUT)' });
  }

  const upperAction = String(action).toUpperCase().trim();
  if (upperAction !== 'IN' && upperAction !== 'OUT') {
    return res.status(400).json({ success: false, message: 'Action must be either IN or OUT' });
  }

  try {
    const rawVal = String(trno).trim();
    const num = Number(rawVal);
    const conditions = [];

    if (!isNaN(num) && rawVal !== '') {
      conditions.push({ trno: num });
      conditions.push({ itsid: String(num) });
    }
    conditions.push({ itsid: rawVal });

    // 1. Identify Talabat from database
    const student = await Student.findOne({ $or: conditions });
    if (!student) {
      return res.status(404).json({ success: false, message: `Student with ID "${rawVal}" not found.` });
    }

    const staffUsername = req.user?.username || 'staff';
    const staffId = req.user?.id || null;
    const now = new Date();

    // 2. Determine Current Status
    const currentStatus = (student.mobile_status === 'IN' || student.current_status === 'IN')
      ? 'IN'
      : ((student.mobile_status === 'OUT' || student.current_status === 'OUT') ? 'OUT' : 'NOT_SUBMITTED');

    // 3. Validate Reason
    let finalReason = String(reason || '').trim();
    if (finalReason.toLowerCase() === 'others') {
      const customReason = req.body.custom_reason ? String(req.body.custom_reason).trim() : '';
      if (!customReason) {
        return res.status(400).json({ success: false, message: 'Please enter a custom reason when "Others" is selected.' });
      }
      finalReason = customReason;
    }

    if (!finalReason) {
      return res.status(400).json({ success: false, message: 'Please select or provide a valid reason for this entry.' });
    }

    // 4. Validate Strict Sequence Rules
    // Rule A: First entry must be IN; OUT is not allowed initially.
    // Rule B: If latest status is IN, allow only OUT.
    // Rule C: If latest status is OUT, allow only IN.
    if (upperAction === 'IN') {
      if (currentStatus === 'IN') {
        return res.status(400).json({
          success: false,
          message: `Phone for ${student.name} is currently IN (Office Custody). Only OUT is allowed.`
        });
      }
    } else if (upperAction === 'OUT') {
      if (currentStatus === 'NOT_SUBMITTED') {
        return res.status(400).json({
          success: false,
          message: `First entry must be IN; OUT is not allowed initially for ${student.name}.`
        });
      }
      if (currentStatus === 'OUT') {
        return res.status(400).json({
          success: false,
          message: `Phone for ${student.name} is currently OUT (With Talabat). Only IN is allowed.`
        });
      }
    }

    // 5. Record Transaction and Update Database
    if (upperAction === 'IN') {
      const log = await MovementLog.create({
        student_id: student._id,
        trno: student.trno,
        itsid: student.itsid || '',
        student_name: student.name,
        pouch_no: student.pouch_no || student.mobile || '',
        roomno: student.roomno || '',
        darajah: student.darajah || '',
        floor: student.floor || '',
        action: 'IN',
        reason: finalReason,
        phone_brand: phone_brand || student.phone_brand || '',
        phone_model: phone_model || student.phone_model || '',
        reference_no: reference_no || '',
        notes: notes || '',
        staff_username: staffUsername,
        staff_id: staffId,
        timestamp: now
      });

      // Update student record
      student.mobile_status = 'IN';
      student.current_status = 'IN';
      student.last_phone_in = now;
      student.last_staff_username = staffUsername;
      student.active_log_id = log._id;
      if (phone_brand) student.phone_brand = phone_brand;
      if (phone_model) student.phone_model = phone_model;
      await student.save();

      return res.json({
        success: true,
        message: `Mobile phone submitted (IN) for ${student.name} (Pouch #${student.pouch_no || student.mobile || 'N/A'})!`,
        student,
        log
      });
    } else {
      // upperAction === 'OUT'
      const log = await MovementLog.create({
        student_id: student._id,
        trno: student.trno,
        itsid: student.itsid || '',
        student_name: student.name,
        pouch_no: student.pouch_no || student.mobile || '',
        roomno: student.roomno || '',
        darajah: student.darajah || '',
        floor: student.floor || '',
        action: 'OUT',
        reason: finalReason,
        phone_brand: phone_brand || student.phone_brand || '',
        phone_model: phone_model || student.phone_model || '',
        reference_no: reference_no || '',
        notes: notes || '',
        staff_username: staffUsername,
        staff_id: staffId,
        timestamp: now
      });

      // Update student record
      student.mobile_status = 'OUT';
      student.current_status = 'OUT';
      student.last_phone_out = now;
      student.last_staff_username = staffUsername;
      student.active_log_id = null;
      await student.save();

      return res.json({
        success: true,
        message: `Mobile phone returned (OUT) to ${student.name} (Pouch #${student.pouch_no || student.mobile || 'N/A'})!`,
        student,
        log
      });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Transaction error: ' + error.message });
  }
};

// Get movement history with comprehensive filters (Search, Action, Floor, Date Range)
exports.getMovementHistory = async (req, res) => {
  try {
    const { trno, itsid, action, pouch_no, floor, search, startDate, endDate, limit } = req.query;
    let filter = {};

    if (action && (action === 'IN' || action === 'OUT')) {
      filter.action = action;
    }

    if (trno) {
      filter.trno = Number(trno);
    }

    if (itsid) {
      filter.itsid = String(itsid).trim();
    }

    if (pouch_no) {
      filter.pouch_no = String(pouch_no).trim();
    }

    if (floor) {
      filter.floor = { $regex: floor.trim(), $options: 'i' };
    }

    if (search && search.trim() !== '') {
      const q = search.trim();
      const numQ = Number(q);
      const orConditions = [
        { student_name: { $regex: q, $options: 'i' } },
        { itsid: { $regex: q, $options: 'i' } },
        { pouch_no: q }
      ];
      if (!isNaN(numQ)) {
        orConditions.push({ trno: numQ });
      }
      filter.$or = orConditions;
    }

    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        filter.timestamp.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.timestamp.$lte = end;
      }
    }

    const maxResults = limit ? Math.min(Number(limit), 1000) : 200;
    const logs = await MovementLog.find(filter)
      .sort({ timestamp: -1 })
      .limit(maxResults);

    res.json({ success: true, count: logs.length, logs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Export transactions to Excel (.xlsx) or CSV
exports.exportReport = async (req, res) => {
  try {
    const { format = 'xlsx', action, startDate, endDate, search } = req.query;
    let filter = {};

    if (action && (action === 'IN' || action === 'OUT')) {
      filter.action = action;
    }

    if (search && search.trim() !== '') {
      const q = search.trim();
      const numQ = Number(q);
      const orConditions = [
        { student_name: { $regex: q, $options: 'i' } },
        { itsid: { $regex: q, $options: 'i' } },
        { pouch_no: q }
      ];
      if (!isNaN(numQ)) orConditions.push({ trno: numQ });
      filter.$or = orConditions;
    }

    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        filter.timestamp.$gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.timestamp.$lte = end;
      }
    }

    const logs = await MovementLog.find(filter).sort({ timestamp: -1 }).limit(5000);

    // Format rows for spreadsheet
    const rows = logs.map(l => ({
      'Date': l.timestamp ? new Date(l.timestamp).toLocaleDateString() : '',
      'Time': l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '',
      'Action': l.action === 'IN' ? 'MOBILE IN (Submitted)' : 'MOBILE OUT (Returned)',
      'TR No': l.trno,
      'ITS ID': l.itsid || '',
      'Talabat Name': l.student_name || '',
      'Mobile Pouch #': l.pouch_no || '',
      'Room': l.roomno || '',
      'Darajah': l.darajah || '',
      'Floor': l.floor || '',
      'Staff Member': l.staff_username || 'staff',
      'Reason / Notes': [l.reason, l.notes].filter(Boolean).join(' | ') || '-'
    }));

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(rows);

    // Set column widths for readability
    ws['!cols'] = [
      { wch: 12 }, { wch: 12 }, { wch: 24 }, { wch: 10 },
      { wch: 12 }, { wch: 35 }, { wch: 15 }, { wch: 10 },
      { wch: 12 }, { wch: 16 }, { wch: 15 }, { wch: 25 }
    ];

    xlsx.utils.book_append_sheet(wb, ws, 'Mobile Transactions');

    const isCsv = String(format).toLowerCase() === 'csv';
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: isCsv ? 'csv' : 'xlsx' });

    const filename = `mobile_tracking_report_${Date.now()}.${isCsv ? 'csv' : 'xlsx'}`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', isCsv ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Export error: ' + error.message });
  }
};