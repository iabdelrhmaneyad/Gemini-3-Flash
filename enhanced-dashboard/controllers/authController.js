const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Users, UserRoles, AuditLogs } = require('../models/dataStore');

const JWT_SECRET = process.env.JWT_SECRET || 'ischool_enhanced_dashboard_secret_key_2026';
const JWT_EXPIRATION = process.env.JWT_EXPIRATION || '24h';

// Register new user
async function register(req, res) {
  try {
    const { email, password, full_name, role = 'reviewer' } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({ error: 'Email, password, and full name are required' });
    }

    // Check if user exists
    const existingUser = await Users.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Create user
    const user = await Users.create({
      email,
      password_hash,
      full_name,
      status: 'active'
    });

    // Assign role
    await UserRoles.create({
      user_id: user.id,
      app_role: role
    });

    // Log activity
    await AuditLogs.create({
      user_id: user.id,
      action: 'USER_REGISTERED',
      resource: 'auth',
      details: { email, role }
    });

    // Remove password hash from response
    delete user.password_hash;

    res.status(201).json({
      message: 'User registered successfully',
      user: { ...user, role }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
}

// Login
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await Users.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if user is active
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is not active' });
    }

    // Get user roles
    const userRoles = await UserRoles.findAll({ user_id: user.id });
    const roles = userRoles.map(r => r.app_role);

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRATION }
    );

    // Log activity
    await AuditLogs.create({
      user_id: user.id,
      action: 'USER_LOGIN',
      resource: 'auth',
      details: { email }
    });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        roles
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
}

// Get current user
async function getCurrentUser(req, res) {
  try {
    const user = req.user;
    delete user.password_hash;
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
}

// Logout (client-side token removal)
async function logout(req, res) {
  try {
    await AuditLogs.create({
      user_id: req.user.id,
      action: 'USER_LOGOUT',
      resource: 'auth',
      details: { email: req.user.email }
    });

    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
}

module.exports = {
  register,
  login,
  getCurrentUser,
  logout
};
