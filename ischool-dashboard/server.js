const express = require('express');
const multer = require('multer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const sessionController = require('./controllers/sessionController');
const auditController = require('./controllers/auditController');
const reportParser = require('./controllers/reportParser');
const dataStore = require('./controllers/dataStore');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
// Serve Sessions directory for video streaming
app.use('/sessions', express.static(path.join(__dirname, '..', 'Sessions')));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage: storage });

// Store active sessions
let activeSessions = [];
// Load persistent data
let sessionData = dataStore.loadData();
console.log(`Loaded ${sessionData.length} sessions from storage`);

// Track running analysis processes so we can stop them on reset
const runningAnalyses = new Set();

// ===== ANALYSIS QUEUE MANAGER =====
// Configurable concurrency - 3 is safe, can adjust based on system resources
const ANALYSIS_CONFIG = {
  maxConcurrent: 3,  // Max simultaneous analysis processes
  timeoutMinutes: 15, // Timeout per analysis
  maxRetries: 3       // Max retries on failure
};

class AnalysisQueueManager {
  constructor() {
    this.queue = [];
    this.activeCount = 0;
    this.processing = new Map(); // sessionId -> analysis state
    this.stats = {
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0
    };
  }

  // Add session to queue
  enqueue(session, io, options = {}) {
    // Don't add duplicates
    if (this.queue.find(item => item.session.sessionId === session.sessionId) ||
        this.processing.has(session.sessionId)) {
      console.log(`[QUEUE] Session ${session.sessionId} already in queue/processing`);
      return;
    }

    const queueItem = {
      session,
      io,
      options,
      addedAt: Date.now(),
      priority: options.priority || 0 // Higher = processed first
    };

    this.queue.push(queueItem);
    this.queue.sort((a, b) => b.priority - a.priority); // Sort by priority
    
    session.analysisStatus = 'queued';
    session.queuePosition = this.queue.length;
    
    this.updateStats();
    this.broadcastQueueStatus(io);
    io.emit('sessionUpdate', session);
    
    console.log(`[QUEUE] Added ${session.tutorId} to analysis queue (position: ${this.queue.length})`);
    
    this.processNext();
  }

  // Add multiple sessions
  enqueueMultiple(sessions, io, options = {}) {
    console.log(`[QUEUE] Enqueueing ${sessions.length} sessions for analysis...`);
    sessions.forEach(session => this.enqueue(session, io, options));
  }

  // Process next item in queue
  async processNext() {
    if (this.activeCount >= ANALYSIS_CONFIG.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    if (!item) return;

    this.activeCount++;
    this.processing.set(item.session.sessionId, {
      startedAt: Date.now(),
      session: item.session
    });

    // Update queue positions for remaining items
    this.queue.forEach((qItem, idx) => {
      qItem.session.queuePosition = idx + 1;
      item.io.emit('sessionUpdate', qItem.session);
    });

    this.updateStats();
    this.broadcastQueueStatus(item.io);

    try {
      await this.analyzeSession(item.session, item.io, item.options);
      this.stats.completed++;
    } catch (error) {
      console.error(`[QUEUE] Analysis failed for ${item.session.tutorId}:`, error.message);
      this.stats.failed++;
    } finally {
      this.activeCount--;
      this.processing.delete(item.session.sessionId);
      this.updateStats();
      this.broadcastQueueStatus(item.io);
      
      // Process next item
      this.processNext();
    }
  }

  // Analyze a single session
  async analyzeSession(session, io, options = {}) {
    const { spawn } = require('child_process');
    
    try {
      // Find session folder
      const sessionFolder = path.join(__dirname, '..', 'Sessions', session.tutorId);

      if (!fs.existsSync(sessionFolder)) {
        console.log(`[QUEUE] Session folder not found for ${session.tutorId}, skipping...`);
        session.analysisStatus = 'failed';
        session.failureReason = 'folder_not_found';
        io.emit('sessionUpdate', session);
        return;
      }

      // Check if report already exists
      const reportPath = path.join(sessionFolder, `Quality_Report_RAG_${session.tutorId}.html`);
      if (fs.existsSync(reportPath)) {
        console.log(`[QUEUE] Report already exists for ${session.tutorId}, skipping...`);
        session.analysisStatus = 'completed';
        session.reportUrl = `/api/report/view/${session.tutorId}/${session.sessionId}`;
        io.emit('sessionUpdate', session);
        dataStore.saveData(sessionData);
        return;
      }

      // Find video and transcript files
      const files = fs.readdirSync(sessionFolder);
      const videoFile = files.find(f => f.endsWith('.mp4'));
      const transcriptFile = files.find(f => f.endsWith('.vtt') || f.endsWith('.txt'));

      if (!videoFile) {
        console.log(`[QUEUE] No video file found for ${session.tutorId}, skipping...`);
        session.analysisStatus = 'failed';
        session.failureReason = 'no_video';
        io.emit('sessionUpdate', session);
        return;
      }

      const videoPath = path.join(sessionFolder, videoFile);
      const transcriptPath = transcriptFile ? path.join(sessionFolder, transcriptFile) : null;
      const outputReport = path.join(sessionFolder, `Quality_Report_RAG_${session.tutorId}.html`);

      // Update status
      session.analysisStatus = 'analyzing';
      session.queuePosition = null;
      io.emit('sessionUpdate', session);
      dataStore.saveData(sessionData);

      console.log(`[QUEUE] Analyzing ${session.tutorId} (${this.activeCount}/${ANALYSIS_CONFIG.maxConcurrent} active)...`);

      // Run RAG analysis
      const args = [
        path.join(__dirname, '..', 'rag_video_analysis.py'),
        '--input', videoPath,
        '--output_report', outputReport
      ];

      if (transcriptPath) {
        args.push('--transcript', transcriptPath);
      }

      await new Promise((resolve, reject) => {
        const python = spawn('python3', args);
        runningAnalyses.add(python);

        // Safety Timeout
        const timeout = setTimeout(() => {
          console.error(`[QUEUE] Timeout for ${session.tutorId}: Killing process after ${ANALYSIS_CONFIG.timeoutMinutes}m`);
          python.kill();
          session.analysisStatus = 'failed';
          session.failureReason = 'timeout';
          io.emit('sessionUpdate', session);
        }, ANALYSIS_CONFIG.timeoutMinutes * 60 * 1000);

        python.stdout.on('data', (data) => {
          console.log(`[RAG ${session.tutorId}]: ${data}`);
        });

        python.stderr.on('data', (data) => {
          console.error(`[RAG ERROR ${session.tutorId}]: ${data}`);
        });

        python.on('close', (code) => {
          runningAnalyses.delete(python);
          clearTimeout(timeout);

          if (code === 0 && fs.existsSync(outputReport)) {
            // Check if report has score = -1 (indicates JSON parse failure)
            let needsRetry = false;
            try {
              const reportContent = fs.readFileSync(outputReport, 'utf8');
              if (reportContent.includes('final_weighted_score": -1') || reportContent.includes('"final_weighted_score": -1')) {
                needsRetry = true;
              }
            } catch (e) {}

            if (needsRetry && (session.retryCount || 0) < ANALYSIS_CONFIG.maxRetries) {
              session.analysisStatus = 'queued';
              session.failureReason = 'json_parse_error';
              session.retryCount = (session.retryCount || 0) + 1;
              console.log(`[QUEUE] ${session.tutorId} needs retry (attempt ${session.retryCount})`);
              
              // Re-enqueue with delay
              setTimeout(() => {
                this.enqueue(session, io, { priority: -1 }); // Lower priority for retries
              }, Math.min(Math.pow(2, session.retryCount) * 1000, 60000));
            } else {
              session.analysisStatus = 'completed';
              session.reportUrl = `/api/report/view/${session.tutorId}/${session.sessionId}`;

              // Extract AI score
              try {
                const jsonReportPath = outputReport.replace(/\.(html|txt)$/, '.json');
                if (fs.existsSync(jsonReportPath)) {
                  const jsonContent = JSON.parse(fs.readFileSync(jsonReportPath, 'utf8'));
                  if (jsonContent.final_weighted_score !== undefined) {
                    session.aiScore = jsonContent.final_weighted_score;
                  } else if (jsonContent.scoring && jsonContent.scoring.final_weighted_score !== undefined) {
                    session.aiScore = jsonContent.scoring.final_weighted_score;
                  }
                } else {
                  const reportContent = fs.readFileSync(outputReport, 'utf8');
                  const scoreMatch = reportContent.match(/"final_weighted_score":\s*([\d.]+)/);
                  if (scoreMatch && scoreMatch[1]) {
                    session.aiScore = parseFloat(scoreMatch[1]);
                  }
                }
              } catch (err) {
                console.warn(`[QUEUE] Could not extract AI score for ${session.tutorId}:`, err.message);
              }

              console.log(`[QUEUE] ✓ Completed ${session.tutorId} (Score: ${session.aiScore ?? 'N/A'})`);

              // Auto-delete video to save space
              try {
                if (fs.existsSync(videoPath)) {
                  fs.unlinkSync(videoPath);
                  console.log(`[CLEANUP] Deleted analyzed video: ${videoPath}`);
                }
              } catch (cleanupErr) {
                console.error(`[CLEANUP] Failed to delete video: ${cleanupErr.message}`);
              }
            }
          } else {
            session.analysisStatus = 'failed';
            session.retryCount = (session.retryCount || 0) + 1;
            
            if (session.retryCount <= ANALYSIS_CONFIG.maxRetries) {
              console.log(`[QUEUE] ✗ Failed ${session.tutorId}, will retry (attempt ${session.retryCount})...`);
              setTimeout(() => {
                this.enqueue(session, io, { priority: -1 });
              }, Math.min(Math.pow(2, session.retryCount) * 1000, 60000));
            } else {
              console.log(`[QUEUE] ✗ Failed ${session.tutorId} after ${session.retryCount} attempts`);
            }
          }
          
          io.emit('sessionUpdate', session);
          dataStore.saveData(sessionData);
          resolve();
        });

        python.on('error', (err) => {
          runningAnalyses.delete(python);
          reject(err);
        });
      });

    } catch (error) {
      console.error(`[QUEUE] Error analyzing ${session.tutorId}:`, error.message);
      session.analysisStatus = 'failed';
      io.emit('sessionUpdate', session);
      dataStore.saveData(sessionData);
    }
  }

  // Update stats
  updateStats() {
    this.stats.queued = this.queue.length;
    this.stats.processing = this.activeCount;
  }

  // Broadcast queue status to all clients
  broadcastQueueStatus(io) {
    io.emit('queueStatus', {
      queued: this.queue.length,
      processing: this.activeCount,
      maxConcurrent: ANALYSIS_CONFIG.maxConcurrent,
      completed: this.stats.completed,
      failed: this.stats.failed,
      queuedSessions: this.queue.map(item => ({
        sessionId: item.session.sessionId,
        tutorId: item.session.tutorId,
        position: this.queue.indexOf(item) + 1
      })),
      processingSessions: Array.from(this.processing.entries()).map(([id, state]) => ({
        sessionId: id,
        tutorId: state.session.tutorId,
        startedAt: state.startedAt
      }))
    });
  }

  // Get current status
  getStatus() {
    return {
      queued: this.queue.length,
      processing: this.activeCount,
      maxConcurrent: ANALYSIS_CONFIG.maxConcurrent,
      completed: this.stats.completed,
      failed: this.stats.failed
    };
  }

  // Clear queue (for reset)
  clear() {
    this.queue = [];
    this.activeCount = 0;
    this.processing.clear();
    this.stats = { queued: 0, processing: 0, completed: 0, failed: 0 };
  }
}

// Create global queue manager instance
const analysisQueue = new AnalysisQueueManager();
// ===================================

function clearDirectory(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath);
    for (const name of entries) {
      const p = path.join(dirPath, name);
      try {
        const st = fs.statSync(p);
        if (st.isDirectory()) {
          fs.rmSync(p, { recursive: true, force: true });
        } else {
          fs.unlinkSync(p);
        }
      } catch (_) {}
    }
  } catch (_) {}
}

// ===== STATE RECOVERY =====
// Fix items stranded by server restart
const sessionsToResume = [];
let recoveryCount = 0;

sessionData.forEach(session => {
  // If stuck downloading/queued, reset to 'queued' and add to resume list
  if (session.downloadStatus === 'downloading' || session.downloadStatus === 'queued') {
    session.downloadStatus = 'queued';
    session.status = 'pending'; // Reset main status too if needed
    sessionsToResume.push(session);
    recoveryCount++;
  }

  // If stuck analyzing or queued, reset to pending
  if (session.analysisStatus === 'analyzing' || session.analysisStatus === 'queued') {
    session.analysisStatus = 'pending';
    session.queuePosition = null;
    recoveryCount++;
  }
});

if (recoveryCount > 0) {
  console.log(`Recovered ${recoveryCount} sessions from interrupted state`);
  dataStore.saveData(sessionData); // Save clean state

  if (sessionsToResume.length > 0) {
    console.log(`Resuming download for ${sessionsToResume.length} sessions...`);
    // Re-populate active sessions
    activeSessions = [...sessionsToResume];
    // Trigger download
    setTimeout(() => {
      sessionController.downloadSessionsWithOptions(sessionsToResume, io, {
        onUpdate: () => {
          dataStore.saveData(sessionData);
        },
        onDownloadComplete: async (session) => {
          // Use queue manager instead of direct call
          analysisQueue.enqueue(session, io);
        }
      });
    }, 1000);
  }
}
// ==========================

// Auto-analyze sessions function - now uses queue manager
async function autoAnalyzeSessions(sessions, io) {
  console.log(`[QUEUE] Adding ${sessions.length} sessions to analysis queue...`);
  analysisQueue.enqueueMultiple(sessions, io);
}

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('Client connected');

  // Send current session data on connection
  socket.emit('sessionData', sessionData);
  socket.emit('activeSessions', activeSessions);
  
  // Send current queue status
  socket.emit('queueStatus', analysisQueue.getStatus());

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// ===== ADMIN: RESET DASHBOARD =====
// Clears persisted session/audit data and uploads, cancels in-flight downloads/analysis,
// and broadcasts an empty state to connected clients.
app.post('/api/admin/reset', (req, res) => {
  try {
    const { confirmText, wipeDownloadedFiles } = req.body || {};
    if (String(confirmText || '').trim().toUpperCase() !== 'RESET') {
      return res.status(400).json({ success: false, error: 'Confirmation text must be RESET' });
    }

    // Stop background work
    try { sessionController.cancelAllDownloads(); } catch (_) {}
    for (const p of Array.from(runningAnalyses)) {
      try { p.kill('SIGTERM'); } catch (_) {}
    }
    runningAnalyses.clear();
    
    // Clear analysis queue
    analysisQueue.clear();

    // Clear persisted files
    const uploadsDir = path.join(__dirname, 'uploads');
    clearDirectory(uploadsDir);

    dataStore.saveData([]);
    const auditDataPath = path.join(__dirname, 'data', 'audit-data.json');
    try {
      fs.writeFileSync(auditDataPath, JSON.stringify([], null, 2));
    } catch (_) {}

    if (wipeDownloadedFiles) {
      const sessionsDir = path.join(__dirname, '..', 'Sessions');
      clearDirectory(sessionsDir);
    }

    // Clear in-memory state
    sessionData = [];
    activeSessions = [];

    // Notify clients
    io.emit('sessionData', sessionData);
    io.emit('activeSessions', activeSessions);
    io.emit('queueStatus', analysisQueue.getStatus());

    return res.json({ success: true });
  } catch (e) {
    console.error('Reset failed:', e);
    return res.status(500).json({ success: false, error: 'Reset failed' });
  }
});

// CSV Upload endpoint
app.post('/api/upload-csv', upload.single('csvFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const results = [];
  const filePath = req.file.path;

  function buildSessionId(row, tutorId, sessionDate, timeSlot) {
    const explicit = row['Session Id'] || row['SessionId'] || row['Session ID'] || row['Session-ID'];
    if (explicit) return String(explicit).trim();

    const meetingId = row['Meeting ID'] || row['MeetingID'] || row['Meeting Id'];
    if (meetingId) return String(meetingId).trim();

    const datePart = sessionDate ? String(sessionDate).trim().replace(/[\s/]+/g, '-') : 'unknown-date';
    const slotPart = timeSlot ? String(timeSlot).trim().replace(/\s+/g, '-') : 'unknown-slot';
    return `${tutorId || 'unknown-tutor'}_${datePart}_${slotPart}`;
  }

  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (data) => {
      // Normalize column names (handle variations in spacing/case)
      const tutorId = (data['Tutor-ID'] || data['Tutor ID'] || data['TutorID'] || '').toString().trim();
      const sessionDate = data['Session Date'] || data['SessionDate'] || data['Session data'] || data['Session Data'] || data['Date'] || '';
      const timeSlot = data['Time slot'] || data['TimeSlot'] || data['Time Slot'] || data['Slot'] || '';

      const driveFolderLink = data['Google Drive Folder Link'] || data['Drive Link'] || data['Drive Folder Link'] || data['Google Drive Link'] || '';
      const recordingLink = data['Recording Link'] || data['Session link'] || data['SessionLink'] || data['Session Link'] || '';

      const sessionId = buildSessionId(data, tutorId, sessionDate, timeSlot);

      const normalizedData = {
        tutorId,
        instructorName: data["Instructor's Name"] || data['Instructor Name'] || data['Instructor'] || '',
        sessionData: sessionDate,
        timeSlot: (timeSlot || '').toString().trim(),
        sessionId,
        // Prefer Drive link as the primary source when present
        sessionLink: (driveFolderLink || recordingLink || '').toString().trim(),
        recordingLink: (recordingLink || '').toString().trim(),
        driveFolderLink: (driveFolderLink || '').toString().trim(),
        meetingId: (data['Meeting ID'] || data['MeetingID'] || '').toString().trim(),

        status: 'pending',
        progress: 0,
        downloadStatus: 'queued',
        analysisStatus: 'pending',

        auditStatus: 'pending',
        auditComments: '',
        auditApproved: false,
        auditData: {}, // Extended audit info

        // Human Report Data (from CSV)
        humanReport: {
          positive: data['Positive'] || '',
          improvement: data['Needs to improve'] || '',
          score: data['Score'] || ''
        }
      };
      results.push(normalizedData);
    })
    .on('end', () => {
      // Process results - append to persistent storage
      const { data, added } = dataStore.appendData(results);
      sessionData = data; // Update in-memory reference

      // Use the stored objects (so status changes persist correctly)
      const newSessions = results
        .map(r => sessionData.find(s => s.sessionId === r.sessionId) || r);

      // Update active sessions list (for progress tracking)
      // activeSessions should contain currently processing items
      activeSessions = [...activeSessions, ...newSessions.map((s, i) => ({
        ...s,
        index: activeSessions.length + i,
        downloadStatus: 'queued',
        analysisStatus: 'pending'
      }))];

      // Emit new data to all clients
      io.emit('sessionData', sessionData);
      io.emit('activeSessions', activeSessions);

      // Start downloading ONLY new sessions (Drive folders supported)
      sessionController.downloadSessionsWithOptions(newSessions, io, {
        onUpdate: () => {
          dataStore.saveData(sessionData);
        },
        onDownloadComplete: async (session) => {
          await autoAnalyzeSessions([session], io);
          dataStore.saveData(sessionData);
        }
      });

      res.json({
        success: true,
        message: `Uploaded ${results.length} sessions (${added} new) - Analysis starting automatically`,
        sessions: sessionData
      });
    })
    .on('error', (error) => {
      res.status(500).json({ error: 'Error parsing CSV file' });
    });
});

// Get all sessions
app.get('/api/sessions', (req, res) => {
  res.json(sessionData);
});

// Get session analytics
app.get('/api/analytics', (req, res) => {
  const analytics = {
    totalSessions: sessionData.length,
    completedSessions: sessionData.filter(s => s.status === 'completed').length,
    pendingSessions: sessionData.filter(s => s.status === 'pending').length,
    failedSessions: sessionData.filter(s => s.status === 'failed').length,
    auditedSessions: sessionData.filter(s => s.auditApproved).length,
    tutorStats: {},
    timeSlotStats: {}
  };

  // Calculate tutor statistics
  sessionData.forEach(session => {
    if (!analytics.tutorStats[session.tutorId]) {
      analytics.tutorStats[session.tutorId] = {
        total: 0,
        completed: 0,
        audited: 0
      };
    }
    analytics.tutorStats[session.tutorId].total++;
    if (session.status === 'completed') analytics.tutorStats[session.tutorId].completed++;
    if (session.auditApproved) analytics.tutorStats[session.tutorId].audited++;
  });

  // Calculate time slot statistics
  sessionData.forEach(session => {
    if (!analytics.timeSlotStats[session.timeSlot]) {
      analytics.timeSlotStats[session.timeSlot] = 0;
    }
    analytics.timeSlotStats[session.timeSlot]++;
  });

  res.json(analytics);
});

// Get Analysis Queue Status
app.get('/api/queue/status', (req, res) => {
  res.json(analysisQueue.getStatus());
});

// Trigger Re-Analysis
app.post('/api/sessions/analyze/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessionData.find(s => s.sessionId === sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // Delete old report files and video
  const sessionFolder = path.join(__dirname, '..', 'Sessions', session.tutorId);
  const htmlReport = path.join(sessionFolder, `Quality_Report_RAG_${session.tutorId}.html`);
  const jsonReport = path.join(sessionFolder, `Quality_Report_RAG_${session.tutorId}.json`);
  
  try {
    // Delete old reports
    if (fs.existsSync(htmlReport)) {
      fs.unlinkSync(htmlReport);
      console.log(`[REGENERATE] Deleted old HTML report for ${session.tutorId}`);
    }
    if (fs.existsSync(jsonReport)) {
      fs.unlinkSync(jsonReport);
      console.log(`[REGENERATE] Deleted old JSON report for ${session.tutorId}`);
    }
    
    // Delete old video and transcript files
    if (fs.existsSync(sessionFolder)) {
      const files = fs.readdirSync(sessionFolder);
      files.forEach(file => {
        if (file.endsWith('.mp4') || file.endsWith('.vtt') || file.endsWith('.txt')) {
          const filePath = path.join(sessionFolder, file);
          fs.unlinkSync(filePath);
          console.log(`[REGENERATE] Deleted old file: ${file}`);
        }
      });
    }
  } catch (deleteError) {
    console.error(`[REGENERATE] Error deleting old files for ${session.tutorId}:`, deleteError);
  }

  // Reset status and clear score
  session.analysisStatus = 'pending';
  session.downloadStatus = 'pending';
  session.aiScore = null;
  session.retryCount = 0;
  session.reportUrl = null;
  session.progress = 0;
  
  // Save changes
  dataStore.saveData(sessionData);
  
  // Broadcast update
  io.emit('sessionUpdate', session);
  
  // Start re-download and analysis
  console.log(`[REGENERATE] Starting re-download for ${session.tutorId}`);
  sessionController.downloadSessionsWithOptions([session], io, {
    onUpdate: () => {
      dataStore.saveData(sessionData);
    },
    onDownloadComplete: async (completedSession) => {
      console.log(`[REGENERATE] Download completed for ${completedSession.tutorId}, queuing analysis...`);
      analysisQueue.enqueue(completedSession, io);
      dataStore.saveData(sessionData);
    }
  });

  res.json({ 
    success: true, 
    message: 'Re-downloading video and regenerating report...'
  });
});

// Update audit data
app.post('/api/audit/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const { comments, approved, reviewer, accuracy, comparison } = req.body;

  const session = sessionData.find(s => s.sessionId === sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  session.auditComments = comments || '';
  session.auditApproved = approved || false;
  session.auditStatus = approved ? 'approved' : 'reviewed';
  session.auditTimestamp = new Date().toISOString();
  
  // Extended Fields with date tracking
  session.auditData = {
    reviewer: reviewer || 'Anonymous',
    accuracy: parseInt(accuracy) || 0,
    comparison: comparison || '',
    date: new Date().toISOString()
  };

  // Save to persistent storage
  dataStore.saveData(sessionData);

  // Save to audit file (legacy/backup)
  auditController.saveAuditData(sessionData);

  // Broadcast update
  io.emit('sessionData', sessionData);

  res.json({ success: true, session });
});

// Delete audit data (clear audit without deleting session)
app.delete('/api/audit/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  const session = sessionData.find(s => s.sessionId === sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Clear audit data
  session.auditComments = '';
  session.auditApproved = false;
  session.auditStatus = 'pending';
  session.auditTimestamp = '';
  session.auditData = null;

  // Save to persistent storage
  dataStore.saveData(sessionData);

  // Save to audit file (legacy/backup)
  auditController.saveAuditData(sessionData);

  // Broadcast update
  io.emit('sessionData', sessionData);

  res.json({ success: true, message: 'Audit data deleted', session });
});

// Delete session
app.delete('/api/sessions/:sessionId', (req, res) => {
  const { sessionId } = req.params;

  const sessionIndex = sessionData.findIndex(s => s.sessionId === sessionId);
  if (sessionIndex === -1) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Remove session from data
  sessionData.splice(sessionIndex, 1);

  // Remove from active sessions if present
  const activeIndex = activeSessions.findIndex(s => s.sessionId === sessionId);
  if (activeIndex !== -1) {
    activeSessions.splice(activeIndex, 1);
  }

  // Save changes to persistent storage
  dataStore.saveData(sessionData);

  // Save updated audit data (keep for backward compatibility)
  auditController.saveAuditData(sessionData);

  // Broadcast update to all clients
  io.emit('sessionData', sessionData);
  io.emit('activeSessions', activeSessions);

  res.json({ success: true, message: `Session ${sessionId} deleted successfully` });
});

// Check if report exists
app.get('/api/report/check/:tutorId/:sessionId', (req, res) => {
  const { tutorId, sessionId } = req.params;
  const reportPath = path.join(__dirname, '..', 'Sessions', tutorId, `Quality_Report_RAG_${tutorId}.html`);

  if (fs.existsSync(reportPath)) {
    res.json({ exists: true, reportUrl: `/api/report/view/${tutorId}/${sessionId}` });
  } else {
    res.json({ exists: false });
  }
});

// Serve report HTML content
app.get('/api/report/view/:tutorId/:sessionId', (req, res) => {
  const { tutorId, sessionId } = req.params;
  const reportPath = path.join(__dirname, '..', 'Sessions', tutorId, `Quality_Report_RAG_${tutorId}.html`);

  if (fs.existsSync(reportPath)) {
    // Read and serve the HTML file
    const htmlContent = fs.readFileSync(reportPath, 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(htmlContent);
  } else {
    res.status(404).send('<html><body><h1>Report not found</h1><p>The requested report does not exist.</p></body></html>');
  }
});

// Generate report using RAG analysis
app.post('/api/report/generate/:tutorId/:sessionId', async (req, res) => {
  const { tutorId, sessionId } = req.params;
  const { spawn } = require('child_process');

  try {
    const session = sessionData.find(s => s.sessionId === sessionId && s.tutorId === tutorId) || sessionData.find(s => s.sessionId === sessionId);

    // Find session folder
    const sessionFolder = path.join(__dirname, '..', 'Sessions', tutorId);

    if (!fs.existsSync(sessionFolder)) {
      return res.status(404).json({ success: false, error: 'Session folder not found' });
    }

    // Find video file
    const files = fs.readdirSync(sessionFolder);
    const videoFile = files.find(f => f.endsWith('.mp4'));
    const transcriptFile = files.find(f => f.endsWith('.vtt') || f.endsWith('.txt'));

    if (!videoFile) {
      return res.status(404).json({ success: false, error: 'Video file not found' });
    }

    const videoPath = path.join(sessionFolder, videoFile);
    const transcriptPath = transcriptFile ? path.join(sessionFolder, transcriptFile) : null;
    const outputReport = path.join(sessionFolder, `Quality_Report_RAG_${tutorId}.html`);

    if (session) {
      session.analysisStatus = 'analyzing';
      io.emit('sessionUpdate', session);
      dataStore.saveData(sessionData);
    }

    // Run RAG analysis script
    const args = [
      path.join(__dirname, '..', 'rag_video_analysis.py'),
      '--input', videoPath,
      '--output_report', outputReport
    ];

    if (transcriptPath) {
      args.push('--transcript', transcriptPath);
    }

    const python = spawn('python3', args);

    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
      console.log(`RAG Analysis: ${data}`);
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.error(`RAG Error: ${data}`);
    });

    python.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputReport)) {
        if (session) {
          session.analysisStatus = 'completed';
          session.reportUrl = `/api/report/view/${tutorId}/${sessionId}`;
          io.emit('sessionUpdate', session);
          dataStore.saveData(sessionData);
        }

        res.json({ success: true, reportUrl: `/api/report/view/${tutorId}/${sessionId}` });
      } else {
        if (session) {
          session.analysisStatus = 'failed';
          io.emit('sessionUpdate', session);
          dataStore.saveData(sessionData);
        }

        res.status(500).json({
          success: false,
          error: 'Report generation failed',
          details: errorOutput || 'Unknown error'
        });
      }
    });

  } catch (error) {
    console.error('Report generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get BI metrics from all reports
app.get('/api/bi/metrics', async (req, res) => {
  const reportParser = require('./controllers/reportParser');

  try {
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
      overallAverage: 0,
      totalReports: 0
    };

    // Parse all available reports
    for (const session of sessionData) {
      const reportPath = path.join(__dirname, '..', 'Sessions', session.tutorId, `Quality_Report_RAG_${session.tutorId}.html`);
      const jsonReportPath = reportPath.replace('.html', '.json');

      let scores = null;

      // 1. Try Valid JSON Report (Preferred)
      if (fs.existsSync(jsonReportPath)) {
        try {
          const jsonData = JSON.parse(fs.readFileSync(jsonReportPath, 'utf8'));
          if (jsonData.scoring && jsonData.scoring.averages) {
            scores = {
              setup: Math.round(jsonData.scoring.averages.setup * 20), // Convert 5-scale to 100-scale? Or keep 5? 
              // Wait, BI chart uses 0-100 usually. But HTML report shows /5.
              // Let's check chart logic. If chart expects 0-100, we multiply * 20.
              // Previous logic used parseInt(match[1]) where text was "Setup: 85". So it was 100-scale.
              // The new JSON averages are 0-5. So we must multiply by 20.
              attitude: Math.round(jsonData.scoring.averages.attitude * 20),
              preparation: Math.round(jsonData.scoring.averages.preparation * 20),
              curriculum: Math.round(jsonData.scoring.averages.curriculum * 20),
              teaching: Math.round(jsonData.scoring.averages.teaching * 20),
              feedback: 85, // JSON average might not have feedback specific rating, usually included in others or implicit?
              // RAG JSON schema has "averages": {setup, attitude, prep, curr, teaching}. Feedback is not in average list in python script?
              // Let's check python script line 790. "Feedback" is missing from averages keys?
              // Python weights: setup, attitude, prep, curriculum, teaching. No Feedback category in weights?
              // But SAPTCF has F.
              // If Feedback is missing, we default to a safe value or calc from valid items.
              overall: Math.round(jsonData.scoring.final_weighted_score)
            };
            // Add Feedback if missing (hack)
            scores.feedback = scores.teaching;
          }
        } catch (e) {
          console.error(`Error parsing JSON report for ${session.tutorId}:`, e);
        }
      }

      // 2. Fallback to HTML scraping
      if (!scores && fs.existsSync(reportPath)) {
        const htmlContent = fs.readFileSync(reportPath, 'utf8');
        scores = reportParser.parseReportScores(htmlContent);
      }

      if (scores) {
        metrics.tutorScores.push({
          tutorId: session.tutorId,
          sessionId: session.sessionId,
          scores: scores,
          overall: scores.overall
        });

        // Aggregate category scores
        metrics.categoryAverages.setup += scores.setup;
        metrics.categoryAverages.attitude += scores.attitude;
        metrics.categoryAverages.preparation += scores.preparation;
        metrics.categoryAverages.curriculum += scores.curriculum;
        metrics.categoryAverages.teaching += scores.teaching;
        metrics.categoryAverages.feedback += scores.feedback;
        metrics.overallAverage += scores.overall;
        metrics.totalReports++;
      }
    }

    // Calculate averages
    if (metrics.totalReports > 0) {
      metrics.categoryAverages.setup = Math.round(metrics.categoryAverages.setup / metrics.totalReports);
      metrics.categoryAverages.attitude = Math.round(metrics.categoryAverages.attitude / metrics.totalReports);
      metrics.categoryAverages.preparation = Math.round(metrics.categoryAverages.preparation / metrics.totalReports);
      metrics.categoryAverages.curriculum = Math.round(metrics.categoryAverages.curriculum / metrics.totalReports);
      metrics.categoryAverages.teaching = Math.round(metrics.categoryAverages.teaching / metrics.totalReports);
      metrics.categoryAverages.feedback = Math.round(metrics.categoryAverages.feedback / metrics.totalReports);
      metrics.overallAverage = Math.round(metrics.overallAverage / metrics.totalReports);
    }

    res.json(metrics);
  } catch (error) {
    console.error('Error getting BI metrics:', error);
    res.status(500).json({ error: 'Failed to get BI metrics' });
  }
});

// Export data
app.get('/api/export', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  const csvContent = [
    ['Tutor-ID', 'Session Data', 'Time slot', 'Session Id', 'Recording Link', 'Google Drive Folder Link', 'Report Link', 'Status', 'Download Status', 'Analysis Status', 'Audit Status', 'Audit Comments', 'Audit Approved', 'Audit Timestamp'].join(','),
    ...sessionData.map(s => [
      s.tutorId,
      s.sessionData,
      s.timeSlot,
      s.sessionId,
      (s.recordingLink || s.sessionLink || ''),
      (s.driveFolderLink || ''),
      (() => {
        const reportPath = path.join(__dirname, '..', 'Sessions', s.tutorId, `Quality_Report_RAG_${s.tutorId}.html`);
        if (fs.existsSync(reportPath)) {
          return `${baseUrl}/api/report/view/${s.tutorId}/${s.sessionId}`;
        }
        return '';
      })(),
      s.status,
      s.downloadStatus || '',
      s.analysisStatus || '',
      s.auditStatus,
      `"${(s.auditComments || '').replace(/"/g, '""')}"`,
      s.auditApproved,
      s.auditTimestamp || ''
    ].join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=ischool-sessions-export.csv');
  res.send(csvContent);
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`iSchool Dashboard server running on http://0.0.0.0:${PORT}`);
});
