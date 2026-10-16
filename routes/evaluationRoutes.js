const express = require('express');
const router = express.Router();
const evaluationController = require('../controllers/evaluationController');

// 1. Remarks & Lookups
router.get('/remarks', evaluationController.apiGetRemarks);
router.post('/remarks', evaluationController.apiAddRemark);
router.delete('/remarks/:id', evaluationController.apiDeleteRemark);

// 2. Student Search & Validation
router.get('/search-student', evaluationController.apiSearchStudent);
router.post('/check-duplicate', evaluationController.apiCheckDuplicate);
router.post('/validate-bulk', evaluationController.apiValidateBulkStudents);

// 3. Shared Automation Queue
router.post('/queue/manual', evaluationController.apiEnqueueManual);
router.post('/queue/bulk', evaluationController.apiEnqueueBulk);
router.get('/queue/status', evaluationController.apiGetQueueStatus);
router.post('/queue/pause', evaluationController.apiPauseQueue);
router.post('/queue/resume', evaluationController.apiResumeQueue);
router.post('/queue/cancel-item/:itemId', evaluationController.apiCancelQueueItem);
router.post('/queue/cancel-all', evaluationController.apiCancelAllQueue);
router.post('/queue/clear-history', evaluationController.apiClearQueueHistory);

// 4. Statistics & Recent Submissions
router.get('/stats', evaluationController.apiGetStats);

module.exports = router;
