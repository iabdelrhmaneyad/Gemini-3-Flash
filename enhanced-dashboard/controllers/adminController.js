const { Users, UserRoles, AuditLogs, Sessions, Tutors, HumanReviews } = require('../models/dataStore');

// Get all users (admin only)
async function getAllUsers(req, res) {
  try {
    const users = await Users.findAll();
    const usersWithRoles = await Promise.all(users.map(async (user) => {
      const roles = await UserRoles.findAll({ user_id: user.id });
      delete user.password_hash;
      return {
        ...user,
        roles: roles.map(r => r.app_role)
      };
    }));

    res.json({
      total: usersWithRoles.length,
      users: usersWithRoles
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
}

// Create user (admin only)
async function createUser(req, res) {
  try {
    const { email, password, full_name, roles = ['reviewer'] } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Email, password, and full name required' });
    }

    const bcrypt = require('bcryptjs');
    const password_hash = await bcrypt.hash(password, 10);

    const user = await Users.create({
      email,
      password_hash,
      full_name,
      status: 'active'
    });

    // Assign roles
    for (const role of roles) {
      await UserRoles.create({
        user_id: user.id,
        app_role: role
      });
    }

    await AuditLogs.create({
      user_id: req.user.id,
      action: 'USER_CREATED',
      resource: 'users',
      details: { created_user_id: user.id, email, roles }
    });

    delete user.password_hash;
    res.status(201).json({
      message: 'User created successfully',
      user: { ...user, roles }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
}

// Update user (admin only)
async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { full_name, email, status, roles } = req.body;

    const updates = {};
    if (full_name) updates.full_name = full_name;
    if (email) updates.email = email;
    if (status) updates.status = status;

    const user = await Users.update(id, updates);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update roles if provided
    if (roles && Array.isArray(roles)) {
      const existingRoles = await UserRoles.findAll({ user_id: id });
      for (const roleEntry of existingRoles) {
        await UserRoles.delete(roleEntry.id);
      }
      for (const role of roles) {
        await UserRoles.create({ user_id: id, app_role: role });
      }
    }

    await AuditLogs.create({
      user_id: req.user.id,
      action: 'USER_UPDATED',
      resource: 'users',
      details: { updated_user_id: id, updates, roles }
    });

    delete user.password_hash;
    res.json({ message: 'User updated successfully', user });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
}

// Delete user (admin only)
async function deleteUser(req, res) {
  try {
    const { id } = req.params;

    if (id === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const deleted = await Users.delete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete associated roles
    const roles = await UserRoles.findAll({ user_id: id });
    for (const role of roles) {
      await UserRoles.delete(role.id);
    }

    await AuditLogs.create({
      user_id: req.user.id,
      action: 'USER_DELETED',
      resource: 'users',
      details: { deleted_user_id: id }
    });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
}

// Get audit logs (admin only)
async function getAuditLogs(req, res) {
  try {
    const { user_id, action, start_date, end_date, limit = 100 } = req.query;

    let logs = await AuditLogs.findAll();

    // Apply filters
    if (user_id) {
      logs = logs.filter(log => log.user_id === user_id);
    }
    if (action) {
      logs = logs.filter(log => log.action === action);
    }
    if (start_date) {
      logs = logs.filter(log => new Date(log.created_at) >= new Date(start_date));
    }
    if (end_date) {
      logs = logs.filter(log => new Date(log.created_at) <= new Date(end_date));
    }

    // Sort by date descending
    logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Limit results
    logs = logs.slice(0, parseInt(limit));

    // Enrich with user info
    const enrichedLogs = await Promise.all(logs.map(async (log) => {
      const user = await Users.findById(log.user_id);
      return {
        ...log,
        user: user ? {
          id: user.id,
          full_name: user.full_name,
          email: user.email
        } : null
      };
    }));

    res.json({
      total: enrichedLogs.length,
      logs: enrichedLogs
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
}

// Get system stats (admin only)
async function getSystemStats(req, res) {
  try {
    const users = await Users.findAll();
    const sessions = await Sessions.findAll();
    const tutors = await Tutors.findAll();
    const reviews = await HumanReviews.findAll();
    const auditLogs = await AuditLogs.findAll();

    // Activity by day (last 7 days)
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - i);
      return date.toISOString().split('T')[0];
    }).reverse();

    const activityByDay = last7Days.map(date => {
      const dayLogs = auditLogs.filter(log => 
        log.created_at.startsWith(date)
      );
      return {
        date,
        actions: dayLogs.length
      };
    });

    // User activity
    const userActivity = await Promise.all(users.map(async (user) => {
      const userLogs = auditLogs.filter(log => log.user_id === user.id);
      const userReviews = reviews.filter(r => r.reviewer_id === user.id);
      return {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        total_actions: userLogs.length,
        total_reviews: userReviews.length,
        last_activity: userLogs.length > 0 
          ? userLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0].created_at
          : null
      };
    }));

    res.json({
      total_users: users.length,
      active_users: users.filter(u => u.status === 'active').length,
      total_sessions: sessions.length,
      total_tutors: tutors.length,
      total_reviews: reviews.length,
      total_audit_logs: auditLogs.length,
      activity_by_day: activityByDay,
      user_activity: userActivity.sort((a, b) => b.total_actions - a.total_actions)
    });
  } catch (error) {
    console.error('Get system stats error:', error);
    res.status(500).json({ error: 'Failed to fetch system stats' });
  }
}

// Bulk operations (admin only)
async function bulkAssignSessions(req, res) {
  try {
    const { session_ids, reviewer_id } = req.body;

    if (!session_ids || !Array.isArray(session_ids) || !reviewer_id) {
      return res.status(400).json({ error: 'Session IDs array and reviewer ID required' });
    }

    const results = [];
    for (const sessionId of session_ids) {
      try {
        const session = await Sessions.update(sessionId, {
          assigned_reviewer: reviewer_id,
          status: 'in_review'
        });
        if (session) {
          results.push({ session_id: sessionId, success: true });
        } else {
          results.push({ session_id: sessionId, success: false, error: 'Not found' });
        }
      } catch (error) {
        results.push({ session_id: sessionId, success: false, error: error.message });
      }
    }

    await AuditLogs.create({
      user_id: req.user.id,
      action: 'BULK_ASSIGN_SESSIONS',
      resource: 'sessions',
      details: { session_count: session_ids.length, reviewer_id, results }
    });

    res.json({
      message: 'Bulk assignment completed',
      total: session_ids.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    });
  } catch (error) {
    console.error('Bulk assign error:', error);
    res.status(500).json({ error: 'Bulk assignment failed' });
  }
}

// Export data (admin only)
async function exportData(req, res) {
  try {
    const { type = 'sessions', format = 'json' } = req.query;

    let data;
    switch (type) {
      case 'sessions':
        data = await Sessions.findAll();
        break;
      case 'tutors':
        data = await Tutors.findAll();
        break;
      case 'reviews':
        data = await HumanReviews.findAll();
        break;
      case 'users':
        data = await Users.findAll();
        data = data.map(u => {
          delete u.password_hash;
          return u;
        });
        break;
      case 'audit_logs':
        data = await AuditLogs.findAll();
        break;
      default:
        return res.status(400).json({ error: 'Invalid export type' });
    }

    await AuditLogs.create({
      user_id: req.user.id,
      action: 'DATA_EXPORT',
      resource: type,
      details: { format, record_count: data.length }
    });

    if (format === 'csv') {
      // Convert to CSV
      if (data.length === 0) {
        return res.status(404).json({ error: 'No data to export' });
      }

      const headers = Object.keys(data[0]).join(',');
      const rows = data.map(item => 
        Object.values(item).map(val => 
          typeof val === 'object' ? JSON.stringify(val) : val
        ).join(',')
      );
      const csv = [headers, ...rows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${type}_export.csv`);
      res.send(csv);
    } else {
      res.json({
        type,
        count: data.length,
        exported_at: new Date().toISOString(),
        data
      });
    }
  } catch (error) {
    console.error('Export data error:', error);
    res.status(500).json({ error: 'Export failed' });
  }
}

module.exports = {
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  getAuditLogs,
  getSystemStats,
  bulkAssignSessions,
  exportData
};
