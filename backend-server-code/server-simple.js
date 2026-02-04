// Simplified Backend Server for iSchool AI Quality Dashboard (No Database Required)
// Run: npm start

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this';
const DATA_DIR = path.join(__dirname, 'data');

// Initialize data files
async function initializeDataFiles() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    const files = {
      'users.json': [],
      'sessions.json': [],
      'tutors.json': [],
      'reviews.json': []
    };
    
    for (const [filename, defaultData] of Object.entries(files)) {
      const filepath = path.join(DATA_DIR, filename);
      try {
        await fs.access(filepath);
      } catch {
        await fs.writeFile(filepath, JSON.stringify(defaultData, null, 2));
      }
    }
    console.log('✅ Data files initialized');
  } catch (error) {
    console.error('Error initializing data files:', error);
  }
}

// Helper functions for data management
async function readData(filename) {
  try {
    const filepath = path.join(DATA_DIR, filename);
    const data = await fs.readFile(filepath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filename}:`, error);
    return [];
  }
}

async function writeData(filename, data) {
  try {
    const filepath = path.join(DATA_DIR, filename);
    await fs.writeFile(filepath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`Error writing ${filename}:`, error);
    return false;
  }
}

// Auth middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// ============ AUTH ROUTES ============

// Sign Up
app.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, full_name, role = 'reviewer' } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    // Check if user exists
    const users = await readData('users.json');
    const existingUser = users.find(u => u.email === email);
    
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const newUser = {
      id: Date.now().toString(),
      email,
      password_hash: hashedPassword,
      full_name: full_name || email.split('@')[0],
      role,
      created_at: new Date().toISOString(),
      email_verified: false
    };
    
    users.push(newUser);
    await writeData('users.json', users);
    
    res.status(201).json({ 
      message: 'User created successfully',
      user: { id: newUser.id, email: newUser.email, role: newUser.role }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sign In
app.post('/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const users = await readData('users.json');
    const user = users.find(u => u.email === email);
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Current User
app.get('/auth/user', authenticateToken, async (req, res) => {
  try {
    const users = await readData('users.json');
    const user = users.find(u => u.id === req.user.userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ TUTOR ROUTES ============

// Get All Tutors
app.get('/api/tutors', authenticateToken, async (req, res) => {
  try {
    const tutors = await readData('tutors.json');
    res.json(tutors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Tutor
app.post('/api/tutors', authenticateToken, async (req, res) => {
  try {
    const { tutor_id, full_name, email, phone, hire_date, status = 'active' } = req.body;
    
    if (!tutor_id || !full_name) {
      return res.status(400).json({ error: 'Tutor ID and name required' });
    }
    
    const tutors = await readData('tutors.json');
    
    // Check if tutor exists
    if (tutors.find(t => t.tutor_id === tutor_id)) {
      return res.status(400).json({ error: 'Tutor already exists' });
    }
    
    const newTutor = {
      id: Date.now().toString(),
      tutor_id,
      full_name,
      email: email || null,
      phone: phone || null,
      hire_date: hire_date || new Date().toISOString().split('T')[0],
      status,
      created_at: new Date().toISOString()
    };
    
    tutors.push(newTutor);
    await writeData('tutors.json', tutors);
    
    res.status(201).json(newTutor);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Tutor
app.put('/api/tutors/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const tutors = await readData('tutors.json');
    const index = tutors.findIndex(t => t.id === id);
    
    if (index === -1) {
      return res.status(404).json({ error: 'Tutor not found' });
    }
    
    tutors[index] = { ...tutors[index], ...updates, updated_at: new Date().toISOString() };
    await writeData('tutors.json', tutors);
    
    res.json(tutors[index]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Tutor
app.delete('/api/tutors/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const tutors = await readData('tutors.json');
    const filtered = tutors.filter(t => t.id !== id);
    
    if (filtered.length === tutors.length) {
      return res.status(404).json({ error: 'Tutor not found' });
    }
    
    await writeData('tutors.json', filtered);
    res.json({ message: 'Tutor deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ SESSION ROUTES ============

// Get All Sessions
app.get('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const sessions = await readData('sessions.json');
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Session
app.post('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const { session_id, tutor_id, date, time_slot, video_url, transcript_url, status = 'pending' } = req.body;
    
    if (!session_id || !tutor_id) {
      return res.status(400).json({ error: 'Session ID and Tutor ID required' });
    }
    
    const sessions = await readData('sessions.json');
    
    const newSession = {
      id: Date.now().toString(),
      session_id,
      tutor_id,
      date: date || new Date().toISOString().split('T')[0],
      time_slot: time_slot || 'Slot 1',
      video_url: video_url || null,
      transcript_url: transcript_url || null,
      status,
      created_at: new Date().toISOString()
    };
    
    sessions.push(newSession);
    await writeData('sessions.json', sessions);
    
    res.status(201).json(newSession);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ REVIEW ROUTES ============

// Get Reviews for Session
app.get('/api/sessions/:sessionId/reviews', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const reviews = await readData('reviews.json');
    const sessionReviews = reviews.filter(r => r.session_id === sessionId);
    res.json(sessionReviews);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Review
app.post('/api/sessions/:sessionId/reviews', authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { review_type, scores, comments, overall_score } = req.body;
    
    const reviews = await readData('reviews.json');
    
    const newReview = {
      id: Date.now().toString(),
      session_id: sessionId,
      reviewer_id: req.user.userId,
      review_type: review_type || 'human',
      scores: scores || {},
      comments: comments || '',
      overall_score: overall_score || 0,
      created_at: new Date().toISOString()
    };
    
    reviews.push(newReview);
    await writeData('reviews.json', reviews);
    
    res.status(201).json(newReview);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ ANALYTICS ROUTES ============

// Dashboard Stats
app.get('/api/dashboard/stats', authenticateToken, async (req, res) => {
  try {
    const sessions = await readData('sessions.json');
    const reviews = await readData('reviews.json');
    
    const today = new Date().toISOString().split('T')[0];
    
    res.json({
      totalSessions: sessions.length,
      pendingSessions: sessions.filter(s => s.status === 'pending').length,
      completedToday: reviews.filter(r => r.created_at.startsWith(today)).length,
      averageScore: reviews.length > 0 
        ? reviews.reduce((sum, r) => sum + r.overall_score, 0) / reviews.length 
        : 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'iSchool Quality Backend',
    mode: 'JSON File Storage',
    timestamp: new Date().toISOString() 
  });
});

// Start server
async function startServer() {
  await initializeDataFiles();
  
  app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📊 API available at http://localhost:${PORT}`);
    console.log(`💾 Data stored in: ${DATA_DIR}`);
    console.log(`\n🔐 Auth Endpoints:`);
    console.log(`   POST /auth/signup`);
    console.log(`   POST /auth/signin`);
    console.log(`   GET  /auth/user (authenticated)`);
    console.log(`\n📂 API Endpoints (require authentication):`);
    console.log(`   GET/POST    /api/tutors`);
    console.log(`   GET/POST    /api/sessions`);
    console.log(`   GET/POST    /api/sessions/:id/reviews`);
    console.log(`   GET         /api/dashboard/stats`);
  });
}

startServer();
