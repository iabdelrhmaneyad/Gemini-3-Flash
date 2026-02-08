const { Sessions, AIAnalyses, HumanReviews, Tutors } = require('../models/dataStore');

// Get all sessions with filters
async function getAllSessions(req, res) {
  try {
    const { 
      start_date, 
      end_date, 
      tutor_id, 
      status, 
      min_score, 
      max_score,
      reviewer_id,
      session_type
    } = req.query;

    let sessions = await Sessions.findAll();

    // Apply filters
    if (start_date) {
      sessions = sessions.filter(s => new Date(s.session_date) >= new Date(start_date));
    }
    if (end_date) {
      sessions = sessions.filter(s => new Date(s.session_date) <= new Date(end_date));
    }
    if (tutor_id) {
      sessions = sessions.filter(s => s.tutor_id === tutor_id);
    }
    if (status) {
      sessions = sessions.filter(s => s.status === status);
    }
    if (session_type) {
      sessions = sessions.filter(s => s.session_type === session_type);
    }

    // Score filtering (combine AI and human scores)
    if (min_score || max_score) {
      sessions = sessions.filter(s => {
        const score = s.human_score || s.ai_score || 0;
        const min = min_score ? parseFloat(min_score) : 0;
        const max = max_score ? parseFloat(max_score) : 100;
        return score >= min && score <= max;
      });
    }

    // Reviewer filter
    if (reviewer_id) {
      const reviewedSessionIds = (await HumanReviews.findAll({ reviewer_id }))
        .map(r => r.session_id);
      sessions = sessions.filter(s => reviewedSessionIds.includes(s.id));
    }

    // Sort by date descending
    sessions.sort((a, b) => new Date(b.session_date) - new Date(a.session_date));

    res.json({
      total: sessions.length,
      sessions
    });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
}

// Get session by ID with full details
async function getSessionById(req, res) {
  try {
    const { id } = req.params;
    
    const session = await Sessions.findById(id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get AI analysis
    const aiAnalysis = await AIAnalyses.findOne({ session_id: id });
    
    // Get human reviews
    const humanReviews = await HumanReviews.findAll({ session_id: id });
    
    // Get tutor info
    const tutor = await Tutors.findById(session.tutor_id);

    res.json({
      session,
      ai_analysis: aiAnalysis || null,
      human_reviews: humanReviews || [],
      tutor: tutor || null
    });
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
}

// Create new session
async function createSession(req, res) {
  try {
    const {
      tutor_id,
      session_date,
      time_slot,
      video_url,
      transcript_url,
      session_type = 'mobile',
      subject,
      course
    } = req.body;

    if (!tutor_id || !session_date) {
      return res.status(400).json({ error: 'Tutor ID and session date are required' });
    }

    const session = await Sessions.create({
      tutor_id,
      session_date,
      time_slot,
      video_url,
      transcript_url,
      session_type,
      subject,
      course,
      status: 'pending',
      ai_score: null,
      human_score: null
    });

    res.status(201).json({
      message: 'Session created successfully',
      session
    });
  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({ error: 'Failed to create session' });
  }
}

// Update session
async function updateSession(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body;

    const session = await Sessions.update(id, updates);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      message: 'Session updated successfully',
      session
    });
  } catch (error) {
    console.error('Update session error:', error);
    res.status(500).json({ error: 'Failed to update session' });
  }
}

// Delete session
async function deleteSession(req, res) {
  try {
    const { id } = req.params;
    
    const deleted = await Sessions.delete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Delete associated analyses and reviews
    const aiAnalyses = await AIAnalyses.findAll({ session_id: id });
    for (const analysis of aiAnalyses) {
      await AIAnalyses.delete(analysis.id);
    }

    const humanReviews = await HumanReviews.findAll({ session_id: id });
    for (const review of humanReviews) {
      await HumanReviews.delete(review.id);
    }

    res.json({ message: 'Session deleted successfully' });
  } catch (error) {
    console.error('Delete session error:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
}

// Assign session to reviewer
async function assignSession(req, res) {
  try {
    const { id } = req.params;
    const { reviewer_id } = req.body;

    if (!reviewer_id) {
      return res.status(400).json({ error: 'Reviewer ID is required' });
    }

    const session = await Sessions.update(id, {
      assigned_reviewer: reviewer_id,
      status: 'in_review'
    });

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      message: 'Session assigned successfully',
      session
    });
  } catch (error) {
    console.error('Assign session error:', error);
    res.status(500).json({ error: 'Failed to assign session' });
  }
}

module.exports = {
  getAllSessions,
  getSessionById,
  createSession,
  updateSession,
  deleteSession,
  assignSession
};
