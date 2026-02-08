const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');
const { authenticate, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

router.get('/', sessionController.getAllSessions);
router.get('/:id', sessionController.getSessionById);
router.post('/', authorize('admin', 'manager'), sessionController.createSession);
router.put('/:id', authorize('admin', 'manager'), sessionController.updateSession);
router.delete('/:id', authorize('admin'), sessionController.deleteSession);
router.post('/:id/assign', authorize('admin', 'manager'), sessionController.assignSession);

module.exports = router;
