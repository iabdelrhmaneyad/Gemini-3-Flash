const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const { authenticate, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

router.post('/', reviewController.submitReview);
router.get('/session/:session_id', reviewController.getReviewsBySession);
router.get('/reviewer/:reviewer_id', reviewController.getReviewerProfile);
router.get('/reviewers', authorize('admin', 'manager'), reviewController.getAllReviewers);

module.exports = router;
