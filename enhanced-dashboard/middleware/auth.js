const jwt = require('jsonwebtoken');
const { Users, UserRoles, AuditLogs } = require('../models/dataStore');

const JWT_SECRET = process.env.JWT_SECRET || 'ischool_enhanced_dashboard_secret_key_2026';

// Authentication middleware
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const user = await Users.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Get user roles
    const userRoles = await UserRoles.findAll({ user_id: user.id });
    req.user = {
      ...user,
      roles: userRoles.map(r => r.app_role)
    };
    
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Role-based authorization
function authorize(...allowedRoles) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const hasRole = req.user.roles.some(role => allowedRoles.includes(role));
    if (!hasRole) {
      await AuditLogs.create({
        user_id: req.user.id,
        action: 'UNAUTHORIZED_ACCESS_ATTEMPT',
        resource: req.path,
        details: { required_roles: allowedRoles, user_roles: req.user.roles }
      });
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

// Audit logging middleware
function auditLog(action, resource) {
  return async (req, res, next) => {
    const originalSend = res.send;
    res.send = function(data) {
      if (req.user && res.statusCode < 400) {
        AuditLogs.create({
          user_id: req.user.id,
          action,
          resource,
          details: {
            method: req.method,
            params: req.params,
            body: req.body,
            status: res.statusCode
          }
        }).catch(err => console.error('Audit log error:', err));
      }
      originalSend.call(this, data);
    };
    next();
  };
}

module.exports = {
  authenticate,
  authorize,
  auditLog
};
