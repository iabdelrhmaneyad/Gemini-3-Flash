const { Sessions, AIAnalyses, HumanReviews, Tutors, Users } = require('../models/dataStore');
const path = require('path');
const fs = require('fs');
const reportParser = require('./reportParser');

// Dashboard overview stats
async function getDashboardStats(req, res) {
  try {
    const sessions = await Sessions.findAll();
    const aiAnalyses = await AIAnalyses.findAll();
    const humanReviews = await HumanReviews.findAll();
    const tutors = await Tutors.findAll();

    // Today's sessions
    const today = new Date().toISOString().split('T')[0];
    const todaySessions = sessions.filter(s => s.session_date && s.session_date.startsWith(today));

    // Pending sessions
    const pendingSessions = sessions.filter(s => s.status === 'pending');

    // Average scores
    const allScores = sessions.map(s => s.human_score || s.ai_score).filter(s => s !== null);
    const averageScore = allScores.length > 0
      ? allScores.reduce((a, b) => a + b, 0) / allScores.length
      : 0;

    // AI vs Human agreement
    let agreements = 0;
    let comparisons = 0;

    for (const session of sessions) {
      if (session.ai_score && session.human_score) {
        comparisons++;
        if (Math.abs(session.ai_score - session.human_score) <= 15) {
          agreements++;
        }
      }
    }

    const agreementRate = comparisons > 0 ? (agreements / comparisons) * 100 : 0;

    res.json({
      total_sessions: sessions.length,
      total_tutors: tutors.length,
      sessions_today: todaySessions.length,
      pending_sessions: pendingSessions.length,
      completed_sessions: sessions.filter(s => s.status === 'completed').length,
      average_score: Math.round(averageScore * 100) / 100,
      ai_human_agreement_rate: Math.round(agreementRate * 100) / 100,
      total_ai_analyses: aiAnalyses.length,
      total_human_reviews: humanReviews.length
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
}

// Quality score trends
async function getScoreTrends(req, res) {
  try {
    const { start_date, end_date, tutor_id } = req.query;

    let sessions = await Sessions.findAll();

    // Filter by date range
    if (start_date) {
      sessions = sessions.filter(s => new Date(s.session_date) >= new Date(start_date));
    }
    if (end_date) {
      sessions = sessions.filter(s => new Date(s.session_date) <= new Date(end_date));
    }
    if (tutor_id) {
      sessions = sessions.filter(s => s.tutor_id === tutor_id);
    }

    // Group by date
    const scoresByDate = sessions.reduce((acc, session) => {
      const date = session.session_date;
      if (!acc[date]) {
        acc[date] = { ai_scores: [], human_scores: [], date };
      }
      if (session.ai_score) acc[date].ai_scores.push(session.ai_score);
      if (session.human_score) acc[date].human_scores.push(session.human_score);
      return acc;
    }, {});

    // Calculate averages
    const trends = Object.values(scoresByDate).map(day => ({
      date: day.date,
      avg_ai_score: day.ai_scores.length > 0
        ? day.ai_scores.reduce((a, b) => a + b, 0) / day.ai_scores.length
        : null,
      avg_human_score: day.human_scores.length > 0
        ? day.human_scores.reduce((a, b) => a + b, 0) / day.human_scores.length
        : null,
      session_count: day.ai_scores.length
    }));

    trends.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({ trends });
  } catch (error) {
    console.error('Score trends error:', error);
    res.status(500).json({ error: 'Failed to fetch score trends' });
  }
}

// AI vs Human comparison analytics
async function getAIHumanComparison(req, res) {
  try {
    const sessions = await Sessions.findAll();
    const aiAnalyses = await AIAnalyses.findAll();
    const humanReviews = await HumanReviews.findAll();

    const comparisons = [];

    for (const session of sessions) {
      const ai = aiAnalyses.find(a => a.session_id === session.id);
      const human = humanReviews.find(h => h.session_id === session.id);

      if (ai && human) {
        const difference = Math.abs(ai.overall_score - human.overall_score);
        comparisons.push({
          session_id: session.id,
          tutor_id: session.tutor_id,
          session_date: session.session_date,
          ai_score: ai.overall_score,
          human_score: human.overall_score,
          difference,
          agrees: difference <= 15,
          ai_confidence: ai.confidence_score || null
        });
      }
    }

    // Calculate metrics
    const totalComparisons = comparisons.length;
    const agreements = comparisons.filter(c => c.agrees).length;
    const agreementRate = totalComparisons > 0 ? (agreements / totalComparisons) * 100 : 0;

    // Average difference
    const avgDifference = totalComparisons > 0
      ? comparisons.reduce((sum, c) => sum + c.difference, 0) / totalComparisons
      : 0;

    // Distribution of differences
    const differenceRanges = {
      '0-5': 0,
      '6-10': 0,
      '11-15': 0,
      '16-20': 0,
      '20+': 0
    };

    comparisons.forEach(c => {
      if (c.difference <= 5) differenceRanges['0-5']++;
      else if (c.difference <= 10) differenceRanges['6-10']++;
      else if (c.difference <= 15) differenceRanges['11-15']++;
      else if (c.difference <= 20) differenceRanges['16-20']++;
      else differenceRanges['20+']++;
    });

    res.json({
      total_comparisons: totalComparisons,
      agreement_rate: Math.round(agreementRate * 100) / 100,
      average_difference: Math.round(avgDifference * 100) / 100,
      difference_distribution: differenceRanges,
      recent_comparisons: comparisons.slice(-50)
    });
  } catch (error) {
    console.error('AI-Human comparison error:', error);
    res.status(500).json({ error: 'Failed to fetch comparison data' });
  }
}

// Tutor performance analytics
async function getTutorPerformance(req, res) {
  try {
    const tutors = await Tutors.findAll();
    const sessions = await Sessions.findAll();

    const performance = tutors.map(tutor => {
      const tutorSessions = sessions.filter(s => s.tutor_id === tutor.id);

      const scores = tutorSessions
        .map(s => s.human_score || s.ai_score)
        .filter(s => s !== null);

      const avgScore = scores.length > 0
        ? scores.reduce((a, b) => a + b, 0) / scores.length
        : 0;

      return {
        tutor_id: tutor.id,
        tutor_code: tutor.tutor_code,
        full_name: tutor.full_name,
        total_sessions: tutorSessions.length,
        average_score: Math.round(avgScore * 100) / 100,
        completed_sessions: tutorSessions.filter(s => s.status === 'completed').length,
        pending_sessions: tutorSessions.filter(s => s.status === 'pending').length
      };
    });

    // Sort by average score
    performance.sort((a, b) => b.average_score - a.average_score);

    res.json({
      total_tutors: performance.length,
      performance
    });
  } catch (error) {
    console.error('Tutor performance error:', error);
    res.status(500).json({ error: 'Failed to fetch tutor performance' });
  }
}

// BI Metrics aggregation
async function getBIMetrics(req, res) {
  try {
    const sessions = await Sessions.findAll();
    const metrics = {
      tutorScores: [],
      categoryAverages: {
        setup: 0,
        attitude: 0,
        preparation: 0,
        curriculum: 0,
        teaching: 0,
        feedback: 0
      },
      humanCategoryAverages: {
        setup: 0,
        attitude: 0,
        preparation: 0,
        curriculum: 0,
        teaching: 0,
        feedback: 0
      },
      overallAverage: 0,
      humanOverallAverage: 0,
      totalReports: 0,
      totalHumanReports: 0
    };

    // calculate category stats
    for (const session of sessions) {
      if (!session.tutor_id) continue;

      const reportPath = path.join(__dirname, '..', 'Sessions', session.tutor_id, `Quality_Report_RAG_${session.tutor_id}.html`);
      const jsonReportPath = reportPath.replace('.html', '.json');
      let scores = null;

      // 1. Try Valid JSON Report (Preferred)
      if (fs.existsSync(jsonReportPath)) {
        try {
          const jsonData = JSON.parse(fs.readFileSync(jsonReportPath, 'utf8'));
          if (jsonData.scoring && jsonData.scoring.averages) {
            const avg = jsonData.scoring.averages;
            scores = {
              setup: Math.round(avg.setup * 20),
              attitude: Math.round(avg.attitude * 20),
              preparation: Math.round(avg.preparation * 20),
              curriculum: Math.round(avg.curriculum * 20),
              teaching: Math.round(avg.teaching * 20),
              feedback: Math.round(avg.teaching * 20),
              overall: Math.round(jsonData.scoring.final_weighted_score)
            };
          }
        } catch (e) {
          // ignore
        }
      }

      // 2. Fallback to HTML scraping
      if (!scores && fs.existsSync(reportPath)) {
        const htmlContent = fs.readFileSync(reportPath, 'utf8');
        scores = reportParser.parseReportScores(htmlContent);
      }

      if (scores) {
        metrics.categoryAverages.setup += scores.setup;
        metrics.categoryAverages.attitude += scores.attitude;
        metrics.categoryAverages.preparation += scores.preparation;
        metrics.categoryAverages.curriculum += scores.curriculum;
        metrics.categoryAverages.teaching += scores.teaching;
        metrics.categoryAverages.feedback += scores.feedback;
        metrics.overallAverage += scores.overall;
        metrics.totalReports++;
      }

      // Handle human scores if available
      if (session.human_score) {
        // If we had granular human scores in DB we would add them here
        // For now just overall
        metrics.humanOverallAverage += session.human_score;
        metrics.totalHumanReports++;
      }
    }

    // Averaging
    if (metrics.totalReports > 0) {
      for (const key in metrics.categoryAverages) {
        metrics.categoryAverages[key] = Math.round(metrics.categoryAverages[key] / metrics.totalReports);
      }
      metrics.overallAverage = Math.round(metrics.overallAverage / metrics.totalReports);
    }

    if (metrics.totalHumanReports > 0) {
      metrics.humanOverallAverage = Math.round(metrics.humanOverallAverage / metrics.totalHumanReports);
    }

    res.json(metrics);
  } catch (error) {
    console.error('Error getting BI metrics:', error);
    res.status(500).json({ error: 'Failed to get BI metrics' });
  }
}

module.exports = {
  getDashboardStats,
  getScoreTrends,
  getAIHumanComparison,
  getTutorPerformance,
  getBIMetrics
};
