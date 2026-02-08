const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { authenticate } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

router.get('/dashboard', analyticsController.getDashboardStats);
router.get('/trends', analyticsController.getScoreTrends);
router.get('/ai-human-comparison', analyticsController.getAIHumanComparison);
router.get('/tutor-performance', analyticsController.getTutorPerformance);
router.get('/bi-metrics', analyticsController.getBIMetrics);

module.exports = router;
