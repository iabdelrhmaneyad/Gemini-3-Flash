const { HumanReviews, Sessions, Users, AIAnalyses } = require('../models/dataStore');

// Submit human review
async function submitReview(req, res) {
  try {
    const { session_id, scores, overall_score, comments, quality_notes } = req.body;
    const reviewer_id = req.user.id;

    if (!session_id || !overall_score) {
      return res.status(400).json({ error: 'Session ID and overall score are required' });
    }

    // Check if session exists
    const session = await Sessions.findById(session_id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Create review
    const review = await HumanReviews.create({
      session_id,
      reviewer_id,
      review_type: 'human',
      scores: scores || {},
      overall_score,
      comments,
      quality_notes,
      review_date: new Date().toISOString()
    });

    // Update session with human score
    await Sessions.update(session_id, {
      human_score: overall_score,
      status: 'completed'
    });

    res.status(201).json({
      message: 'Review submitted successfully',
      review
    });
  } catch (error) {
    console.error('Submit review error:', error);
    res.status(500).json({ error: 'Failed to submit review' });
  }
}

// Get reviews by session
async function getReviewsBySession(req, res) {
  try {
    const { session_id } = req.params;

    const reviews = await HumanReviews.findAll({ session_id });
    
    // Get reviewer info for each review
    const reviewsWithReviewers = await Promise.all(reviews.map(async (review) => {
      const reviewer = await Users.findById(review.reviewer_id);
      return {
        ...review,
        reviewer: reviewer ? {
          id: reviewer.id,
          full_name: reviewer.full_name,
          email: reviewer.email
        } : null
      };
    }));

    res.json({
      total: reviewsWithReviewers.length,
      reviews: reviewsWithReviewers
    });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
}

// Get reviewer profile and performance
async function getReviewerProfile(req, res) {
  try {
    const { reviewer_id } = req.params;

    const reviewer = await Users.findById(reviewer_id);
    if (!reviewer) {
      return res.status(404).json({ error: 'Reviewer not found' });
    }

    // Get all reviews by this reviewer
    const reviews = await HumanReviews.findAll({ reviewer_id });
    
    // Calculate metrics
    const totalReviews = reviews.length;
    const averageScore = totalReviews > 0
      ? reviews.reduce((sum, r) => sum + r.overall_score, 0) / totalReviews
      : 0;

    // Compare with AI scores
    let agreementCount = 0;
    let aiComparisons = [];
    
    for (const review of reviews) {
      const aiAnalysis = await AIAnalyses.findOne({ session_id: review.session_id });
      if (aiAnalysis) {
        const difference = Math.abs(review.overall_score - aiAnalysis.overall_score);
        const agrees = difference <= 15; // Within 15 points
        if (agrees) agreementCount++;
        
        aiComparisons.push({
          session_id: review.session_id,
          human_score: review.overall_score,
          ai_score: aiAnalysis.overall_score,
          difference,
          agrees
        });
      }
    }

    const agreementRate = aiComparisons.length > 0
      ? (agreementCount / aiComparisons.length) * 100
      : 0;

    // Group reviews by date
    const reviewsByDate = reviews.reduce((acc, review) => {
      const date = review.review_date.split('T')[0];
      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {});

    res.json({
      reviewer: {
        id: reviewer.id,
        full_name: reviewer.full_name,
        email: reviewer.email
      },
      metrics: {
        total_reviews: totalReviews,
        average_score: Math.round(averageScore * 100) / 100,
        agreement_rate: Math.round(agreementRate * 100) / 100,
        reviews_this_week: reviews.filter(r => {
          const reviewDate = new Date(r.review_date);
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          return reviewDate >= weekAgo;
        }).length
      },
      reviews_by_date: reviewsByDate,
      recent_comparisons: aiComparisons.slice(-10),
      recent_reviews: reviews.slice(-20)
    });
  } catch (error) {
    console.error('Get reviewer profile error:', error);
    res.status(500).json({ error: 'Failed to fetch reviewer profile' });
  }
}

// Get all reviewers with stats
async function getAllReviewers(req, res) {
  try {
    const allUsers = await Users.findAll();
    const allReviews = await HumanReviews.findAll();

    const reviewers = await Promise.all(allUsers.map(async (user) => {
      const userReviews = allReviews.filter(r => r.reviewer_id === user.id);
      
      const totalReviews = userReviews.length;
      const averageScore = totalReviews > 0
        ? userReviews.reduce((sum, r) => sum + r.overall_score, 0) / totalReviews
        : 0;

      return {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        total_reviews: totalReviews,
        average_score: Math.round(averageScore * 100) / 100,
        last_review_date: userReviews.length > 0
          ? userReviews.sort((a, b) => new Date(b.review_date) - new Date(a.review_date))[0].review_date
          : null
      };
    }));

    // Filter out users with no reviews
    const activeReviewers = reviewers.filter(r => r.total_reviews > 0);

    res.json({
      total: activeReviewers.length,
      reviewers: activeReviewers.sort((a, b) => b.total_reviews - a.total_reviews)
    });
  } catch (error) {
    console.error('Get reviewers error:', error);
    res.status(500).json({ error: 'Failed to fetch reviewers' });
  }
}

module.exports = {
  submitReview,
  getReviewsBySession,
  getReviewerProfile,
  getAllReviewers
};
