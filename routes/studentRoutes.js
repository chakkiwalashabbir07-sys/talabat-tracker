const express = require('express');
const router = express.Router();
const multer = require('multer');
const studentController = require('../controllers/studentController');

const { isAdmin } = require('../middleware/authMiddleware');

const upload = multer({ storage: multer.memoryStorage() });

// Specific GET routes (Must come before /:trno parameter route)
router.get('/search', studentController.searchStudents);
router.get('/metrics', studentController.getDashboardMetrics);
router.get('/stats', studentController.getStats);
router.get('/not-submitted', studentController.getNotSubmittedStudents);
router.get('/in', studentController.getInStudents);
router.get('/out', studentController.getOutStudents);
router.get('/:trno', studentController.getStudentByTrNo);

// Admin Action routes
router.post('/', isAdmin, studentController.createStudent);
router.post('/import', isAdmin, upload.single('file'), studentController.importStudentsFromExcel);
router.post('/upload-excel', isAdmin, upload.single('file'), studentController.importStudentsFromExcel);

module.exports = router;