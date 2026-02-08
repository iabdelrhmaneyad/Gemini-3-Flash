const { Tutors, TutorPresence, Sessions, AIAnalyses, HumanReviews } = require('../models/dataStore');

// Get all tutors
async function getAllTutors(req, res) {
  try {
    const tutors = await Tutors.findAll();
    
    // Calculate stats for each tutor
    const tutorsWithStats = await Promise.all(tutors.map(async (tutor) => {
      const sessions = await Sessions.findAll({ tutor_id: tutor.id });
      const presence = await TutorPresence.findAll({ tutor_id: tutor.id });
      
      return {
        ...tutor,
        total_sessions: sessions.length,
        total_presence_logs: presence.length,
        average_score: sessions.length > 0
          ? sessions.reduce((sum, s) => sum + (s.human_score || s.ai_score || 0), 0) / sessions.length
          : 0
      };
    }));

    res.json({
      total: tutorsWithStats.length,
      tutors: tutorsWithStats
    });
  } catch (error) {
    console.error('Get tutors error:', error);
    res.status(500).json({ error: 'Failed to fetch tutors' });
  }
}

// Get tutor by ID
async function getTutorById(req, res) {
  try {
    const { id } = req.params;
    
    const tutor = await Tutors.findById(id);
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    // Get sessions
    const sessions = await Sessions.findAll({ tutor_id: id });
    
    // Get presence logs
    const presence = await TutorPresence.findAll({ tutor_id: id });
    
    // Calculate average scores
    const aiScores = sessions.map(s => s.ai_score).filter(s => s !== null);
    const humanScores = sessions.map(s => s.human_score).filter(s => s !== null);

    res.json({
      tutor,
      stats: {
        total_sessions: sessions.length,
        total_presence_logs: presence.length,
        average_ai_score: aiScores.length > 0
          ? aiScores.reduce((a, b) => a + b, 0) / aiScores.length
          : 0,
        average_human_score: humanScores.length > 0
          ? humanScores.reduce((a, b) => a + b, 0) / humanScores.length
          : 0
      },
      recent_sessions: sessions.slice(0, 10)
    });
  } catch (error) {
    console.error('Get tutor error:', error);
    res.status(500).json({ error: 'Failed to fetch tutor' });
  }
}

// Create tutor
async function createTutor(req, res) {
  try {
    const { tutor_code, full_name, email, phone, hire_date } = req.body;

    if (!tutor_code || !full_name) {
      return res.status(400).json({ error: 'Tutor code and full name are required' });
    }

    const tutor = await Tutors.create({
      tutor_code,
      full_name,
      email,
      phone,
      hire_date: hire_date || new Date().toISOString().split('T')[0],
      status: 'active'
    });

    res.status(201).json({
      message: 'Tutor created successfully',
      tutor
    });
  } catch (error) {
    console.error('Create tutor error:', error);
    res.status(500).json({ error: 'Failed to create tutor' });
  }
}

// Update tutor
async function updateTutor(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body;

    const tutor = await Tutors.update(id, updates);
    if (!tutor) {
      return res.status(404).json({ error: 'Tutor not found' });
    }

    res.json({
      message: 'Tutor updated successfully',
      tutor
    });
  } catch (error) {
    console.error('Update tutor error:', error);
    res.status(500).json({ error: 'Failed to update tutor' });
  }
}

// Log tutor presence (login/logout)
async function logPresence(req, res) {
  try {
    const { tutor_id, event_type, status } = req.body;

    if (!tutor_id || !event_type) {
      return res.status(400).json({ error: 'Tutor ID and event type are required' });
    }

    const log = await TutorPresence.create({
      tutor_id,
      event_type, // 'login', 'logout', 'status_change'
      status, // 'active', 'idle', 'on_break'
      timestamp: new Date().toISOString()
    });

    res.status(201).json({
      message: 'Presence logged successfully',
      log
    });
  } catch (error) {
    console.error('Log presence error:', error);
    res.status(500).json({ error: 'Failed to log presence' });
  }
}

// Get tutor presence logs
async function getPresenceLogs(req, res) {
  try {
    const { tutor_id, start_date, end_date } = req.query;

    let logs = await TutorPresence.findAll();

    if (tutor_id) {
      logs = logs.filter(log => log.tutor_id === tutor_id);
    }

    if (start_date) {
      logs = logs.filter(log => new Date(log.timestamp) >= new Date(start_date));
    }

    if (end_date) {
      logs = logs.filter(log => new Date(log.timestamp) <= new Date(end_date));
    }

    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      total: logs.length,
      logs
    });
  } catch (error) {
    console.error('Get presence logs error:', error);
    res.status(500).json({ error: 'Failed to fetch presence logs' });
  }
}

module.exports = {
  getAllTutors,
  getTutorById,
  createTutor,
  updateTutor,
  logPresence,
  getPresenceLogs
};
