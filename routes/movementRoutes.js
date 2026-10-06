const express = require('express');
const router = express.Router();
const movementController = require('../controllers/movementController');

router.post('/', movementController.recordMovement);
router.get('/history', movementController.getMovementHistory);
router.get('/export', movementController.exportReport);

module.exports = router;