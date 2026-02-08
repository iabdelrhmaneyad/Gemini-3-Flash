const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, authorize, auditLog } = require('../middleware/auth');

// All routes require admin role
router.use(authenticate);
router.use(authorize('admin'));

// User management
router.get('/users', auditLog('VIEW_USERS', 'admin'), adminController.getAllUsers);
router.post('/users', auditLog('CREATE_USER', 'admin'), adminController.createUser);
router.put('/users/:id', auditLog('UPDATE_USER', 'admin'), adminController.updateUser);
router.delete('/users/:id', auditLog('DELETE_USER', 'admin'), adminController.deleteUser);

// Audit logs
router.get('/audit-logs', adminController.getAuditLogs);

// System stats
router.get('/system-stats', adminController.getSystemStats);

// Bulk operations
router.post('/bulk-assign', auditLog('BULK_ASSIGN', 'admin'), adminController.bulkAssignSessions);

// Data export
router.get('/export', auditLog('EXPORT_DATA', 'admin'), adminController.exportData);

module.exports = router;
