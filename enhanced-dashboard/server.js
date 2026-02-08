require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');

// Routes
const authRoutes = require('./routes/auth');
const sessionRoutes = require('./routes/sessions');
const tutorRoutes = require('./routes/tutors');
const reviewRoutes = require('./routes/reviews');
const analyticsRoutes = require('./routes/analytics');
const adminRoutes = require('./routes/admin');

// Data Models
const { Sessions } = require('./models/dataStore');

// Controllers
const downloadController = require('./controllers/downloadController');
const analysisQueue = require('./controllers/analysisQueueManager');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Upload configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage });

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/Sessions', express.static(path.join(__dirname, 'Sessions')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'iSchool Enhanced Quality Dashboard',
    version: '1.0.0',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/tutors', tutorRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);

// Socket.IO Connection
io.on('connection', (socket) => {
  console.log('Client connected');

  socket.emit('queueStatus', analysisQueue.getStatus());

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// --- New Features Endpoints ---

// CSV Upload endpoint
app.post('/api/upload-csv', upload.single('csvFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const results = [];
  const filePath = req.file.path;

  // Helper to build session ID
  function buildSessionId(row, tutorId, sessionDate, timeSlot) {
    const explicit = row['Session Id'] || row['SessionId'] || row['Session ID'] || row['Session-ID'];
    if (explicit) return String(explicit).trim();

    // Fallback ID generation
    const datePart = sessionDate ? String(sessionDate).trim().replace(/[\s/]+/g, '-') : 'unknown-date';
    const slotPart = timeSlot ? String(timeSlot).trim().replace(/\s+/g, '-') : 'unknown-slot';
    return `${tutorId || 'unknown-tutor'}_${datePart}_${slotPart}`;
  }

  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', async (data) => {
      // Normalize column names
      const tutorId = (data['Tutor-ID'] || data['Tutor ID'] || data['TutorID'] || '').toString().trim();
      const sessionDate = data['Session Date'] || data['SessionDate'] || data['Session Data'] || data['Date'] || '';
      const timeSlot = data['Time slot'] || data['TimeSlot'] || data['Time Slot'] || data['Slot'] || '';

      const driveFolderLink = data['Google Drive Folder Link'] || data['Drive Link'] || data['Drive Folder Link'] || '';
      const recordingLink = data['Recording Link'] || data['Session link'] || data['Session Link'] || '';

      const sessionId = buildSessionId(data, tutorId, sessionDate, timeSlot);

      // Create session object compatible with enhanced dashboard model
      const normalizedData = {
        id: sessionId,
        tutor_id: tutorId,
        instructor_name: data["Instructor's Name"] || data['Instructor Name'] || '',
        session_date: sessionDate,
        time_slot: (timeSlot || '').toString().trim(),

        // Links
        video_url: (recordingLink || '').toString().trim(),
        drive_folder_link: (driveFolderLink || '').toString().trim(),

        // Status tracking
        status: 'pending',
        download_status: 'queued',
        analysis_status: 'pending',
        progress: 0,

        // Metadata
        subject: data['Subject'] || 'General',
        course: data['Course'] || '',
        session_type: 'mobile', // Default

        created_at: new Date().toISOString()
      };

      results.push(normalizedData);
    })
    .on('end', async () => {
      // Create sessions in DB and Queue for download
      const newSessions = [];
      let addedCount = 0;

      for (const session of results) {
        // Check if exists
        const exists = await Sessions.findById(session.id);
        if (!exists) {
          await Sessions.create(session);
          newSessions.push(session);
          addedCount++;
        }
      }

      // Start download for new sessions
      if (newSessions.length > 0) {
        downloadController.downloadSessions(newSessions, io);
      }

      res.json({
        success: true,
        message: `Processed ${results.length} rows. Added ${addedCount} new sessions.`,
        added: addedCount
      });
    })
    .on('error', (error) => {
      res.status(500).json({ error: 'Error parsing CSV file' });
    });
});

// Admin Reset
app.post('/api/admin/reset', async (req, res) => {
  try {
    const { confirmText, wipeDownloadedFiles } = req.body || {};
    if (String(confirmText || '').trim().toUpperCase() !== 'RESET') {
      return res.status(400).json({ success: false, error: 'Confirmation text must be RESET' });
    }

    // Stop background work
    downloadController.cancelAllDownloads();
    analysisQueue.clear();

    // Clear Queues/Status in DB
    const allSessions = await Sessions.findAll();
    for (const session of allSessions) {
      await Sessions.update(session.id, {
        status: 'pending',
        download_status: 'pending',
        analysis_status: 'pending',
        progress: 0
      });
    }

    if (wipeDownloadedFiles) {
      // Logic to wipe actual files if needed
      // For safety, maybe we just reset the DB pointers for now 
      // or strictly implement directory clearing
    }

    io.emit('queueStatus', analysisQueue.getStatus());
    io.emit('systemReset', { timestamp: Date.now() });

    res.json({ success: true, message: 'System reset initiated' });
  } catch (e) {
    console.error('Reset failed:', e);
    res.status(500).json({ success: false, error: 'Reset failed' });
  }
});

// Queue Status
app.get('/api/queue/status', (req, res) => {
  res.json(analysisQueue.getStatus());
});

// Trigger Re-Analysis
app.post('/api/sessions/analyze/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  const session = await Sessions.findById(sessionId);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Reset status
  await Sessions.update(sessionId, {
    status: 'pending',
    analysis_status: 'queued',
    progress: 0
  });

  const updatedSession = await Sessions.findById(sessionId);

  // Add to queue
  analysisQueue.enqueue(updatedSession, io, {
    force: true
  });

  res.json({ success: true, message: 'Analysis queued' });
});

// Report endpoints (Legacy Support)
// Check if report exists
app.get('/api/reports/check/:tutorId', (req, res) => {
  const { tutorId } = req.params;
  const reportPath = path.join(__dirname, 'Sessions', tutorId, `Quality_Report_RAG_${tutorId}.html`);
  res.json({ exists: fs.existsSync(reportPath) });
});

// Get report HTML
app.get('/api/reports/:tutorId', (req, res) => {
  const { tutorId } = req.params;
  const reportPath = path.join(__dirname, 'Sessions', tutorId, `Quality_Report_RAG_${tutorId}.html`);

  if (fs.existsSync(reportPath)) {
    res.sendFile(reportPath);
  } else {
    res.status(404).send('<html><body><h1>Report Not Found</h1><p>The requested report does not exist.</p></body></html>');
  }
});

// List all available reports
app.get('/api/reports', (req, res) => {
  const sessionsDir = path.join(__dirname, 'Sessions');

  if (!fs.existsSync(sessionsDir)) {
    return res.json({ reports: [] });
  }

  const reports = [];
  try {
    const tutorDirs = fs.readdirSync(sessionsDir);

    tutorDirs.forEach(tutorId => {
      const tutorPath = path.join(sessionsDir, tutorId);
      try {
        if (fs.statSync(tutorPath).isDirectory()) {
          const htmlReport = path.join(tutorPath, `Quality_Report_RAG_${tutorId}.html`);
          const jsonReport = path.join(tutorPath, `Quality_Report_RAG_${tutorId}.json`);

          if (fs.existsSync(htmlReport)) {
            const stats = fs.statSync(htmlReport);
            reports.push({
              tutorId,
              htmlPath: `/Sessions/${tutorId}/Quality_Report_RAG_${tutorId}.html`,
              jsonPath: fs.existsSync(jsonReport) ? `/Sessions/${tutorId}/Quality_Report_RAG_${tutorId}.json` : null,
              size: stats.size,
              modified: stats.mtime
            });
          }
        }
      } catch (e) {
        // Ignore access errors
      }
    });
  } catch (e) {
    console.log('Error listing reports:', e);
  }

  res.json({ total: reports.length, reports });
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Start server (Using server.listen instead of app.listen for Socket.IO)
server.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   iSchool AI Quality Dashboard - Enhanced Edition    ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔗 API Health: http://localhost:${PORT}/health`);
  console.log(`📁 Data stored in: ./data/`);
  console.log('');
  console.log('API Endpoints:');
  console.log('  Auth:      /api/auth/register, /api/auth/login');
  console.log('  Sessions:  /api/sessions');
  console.log('  Tutors:    /api/tutors');
  console.log('  Reviews:   /api/reviews');
  console.log('  Admin:     /api/admin/users, /api/admin/reset');
  console.log('  Analytics: /api/analytics/dashboard');
  console.log('');
  console.log('Press Ctrl+C to stop the server');
  console.log('═══════════════════════════════════════════════════════════');
});

module.exports = app;
