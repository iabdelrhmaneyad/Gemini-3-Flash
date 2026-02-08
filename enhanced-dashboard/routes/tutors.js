const express = require('express');
const router = express.Router();
const tutorController = require('../controllers/tutorController');
const { authenticate, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

router.get('/', tutorController.getAllTutors);
router.get('/:id', tutorController.getTutorById);
router.post('/', authorize('admin', 'manager'), tutorController.createTutor);
router.put('/:id', authorize('admin', 'manager'), tutorController.updateTutor);

// Presence tracking
router.post('/presence', tutorController.logPresence);
router.get('/presence/logs', tutorController.getPresenceLogs);

module.exports = router;
