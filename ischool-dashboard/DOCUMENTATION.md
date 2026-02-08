# iSchool AI Quality System Dashboard - Complete Documentation

A comprehensive dashboard for managing AI tutoring session quality control with CSV upload, automated session downloading, AI-powered video analysis, live analytics, and human audit capabilities.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Backend Components](#backend-components)
   - [Server (server.js)](#server-serverjs)
   - [Controllers](#controllers)
5. [Frontend Components](#frontend-components)
   - [HTML Pages](#html-pages)
   - [JavaScript Modules](#javascript-modules)
   - [Stylesheets](#stylesheets)
6. [API Endpoints](#api-endpoints)
7. [Real-time Events (Socket.IO)](#real-time-events-socketio)
8. [Data Flow](#data-flow)
9. [Configuration](#configuration)
10. [Installation & Usage](#installation--usage)

---

## Project Overview

The iSchool AI Quality System Dashboard is a full-stack web application designed to:

- **Upload and manage tutoring session data** via CSV files
- **Automatically download session recordings** from Google Drive or HTTP links
- **Generate AI-powered quality reports** using RAG (Retrieval-Augmented Generation) video analysis
- **Provide real-time progress tracking** via WebSocket connections
- **Enable human auditors** to review, comment, and approve/reject sessions
- **Display analytics and insights** with interactive charts and metrics
- **Export data** in CSV format for external use

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| **Backend Runtime** | Node.js |
| **Web Framework** | Express.js |
| **Real-time Communication** | Socket.IO |
| **File Upload** | Multer |
| **CSV Parsing** | csv-parser |
| **HTTP Client** | Axios |
| **HTML Parsing** | Cheerio |
| **Frontend** | Vanilla HTML5, CSS3, JavaScript (ES6+) |
| **Charts** | Chart.js |
| **Typography** | Inter (Google Fonts) |
| **Python Dependencies** | gdown (Google Drive downloads), rag_video_analysis.py |

---

## Project Structure

```
ischool-dashboard/
├── server.js                    # Main Express server (~1540 lines)
├── package.json                 # Node.js dependencies
├── ecosystem.config.js          # PM2 deployment configuration
│
├── controllers/                 # Backend business logic
│   ├── sessionController.js     # Session download management
│   ├── driveDownloader.js       # Google Drive file downloads
│   ├── dataStore.js             # Persistent JSON data storage
│   ├── reportParser.js          # HTML report score extraction
│   └── auditController.js       # Audit data management
│
├── public/                      # Static frontend files
│   ├── index.html               # Main dashboard (2515 lines)
│   ├── bi-dashboard.html        # Business Intelligence dashboard
│   ├── css/
│   │   ├── styles.css           # Main stylesheet
│   │   ├── polish.css           # Additional polish styles
│   │   ├── report-modal.css     # Report modal styles
│   │   └── bi-styles.css        # BI dashboard styles
│   ├── js/
│   │   ├── app.js               # Main application logic (~1806 lines)
│   │   ├── analytics.js         # Analytics & Chart.js integration
│   │   ├── bi-analytics.js      # BI dashboard analytics
│   │   └── bi-analytics-real.js # Real BI analytics data
│   └── assets/                  # Images (logo, etc.)
│
├── data/                        # Persistent data storage
│   ├── sessions.json            # Session data
│   └── audit-data.json          # Audit records
│
├── uploads/                     # Uploaded CSV files
├── downloads/                   # Legacy download folder
├── logs/                        # Server logs
│
├── README.md                    # Basic README
├── QUICK_START.md               # Quick start guide
├── QUICK_TEST_GUIDE.md          # Testing guide
└── TESTING_PLAN.md              # Detailed testing plan
```

---

## Backend Components

### Server (server.js)

The main Express server handles:

#### Core Initialization
- Express app setup with CORS and JSON parsing
- Static file serving from `public/` directory
- Session streaming from `../Sessions/` directory
- Multer configuration for CSV file uploads
- Socket.IO server for real-time updates

#### Analysis Queue Manager (`AnalysisQueueManager` class)
A sophisticated queue system for managing concurrent AI analysis:

| Property/Method | Description |
|-----------------|-------------|
| `queue` | Array of pending sessions |
| `activeCount` | Number of concurrent analyses |
| `processing` | Map of session states |
| `quotaPausedUntil` | Timestamp for API quota backoff |
| `enqueue(session, io, options)` | Add session to analysis queue |
| `enqueueMultiple(sessions, io)` | Batch add sessions |
| `processNext()` | Process next queued item |
| `analyzeSession(session, io)` | Run RAG analysis on a session |
| `broadcastQueueStatus(io)` | Send status to all clients |
| `clear()` | Clear the queue (for reset) |

**Queue Configuration (Environment Variables):**
- `ANALYSIS_MAX_CONCURRENT` - Max parallel analyses (default: auto-detect)
- `ANALYSIS_TIMEOUT_MINUTES` - Timeout per analysis (default: 15)
- `ANALYSIS_MAX_RETRIES` - Max retry attempts (default: 3)
- `AUTO_RETRY_QUOTA_BACKOFF_MINUTES` - Quota exhaustion backoff (default: 30)

#### State Recovery
On server restart:
1. Finds sessions stuck in "downloading" or "queued" status
2. Resets them to "queued" and resumes downloads
3. Auto-queues "pending" sessions with existing videos for analysis

---

### Controllers

#### 1. `sessionController.js` - Session Download Management

**Purpose:** Handle concurrent session downloads with queue management.

**Key Functions:**

| Function | Description |
|----------|-------------|
| `downloadSessions(sessions, io)` | Add sessions to download queue |
| `downloadSessionsWithOptions(sessions, io, options)` | Download with callbacks |
| `processQueue(io)` | Process download queue with concurrency control |
| `downloadSession(session, io, options)` | Download a single session |
| `cancelAllDownloads()` | Cancel all pending downloads |

**Features:**
- Configurable concurrency via `DOWNLOAD_MAX_CONCURRENT` (default: 3)
- Supports Google Drive and HTTP direct downloads
- Progress tracking with Socket.IO updates
- Automatic file type detection from content-type

---

#### 2. `driveDownloader.js` - Google Drive Integration

**Purpose:** Download files from Google Drive folders using Python helper (gdown).

**Key Functions:**

| Function | Description |
|----------|-------------|
| `downloadFromDrive({driveLink, outputDir})` | Download from Drive link |
| `walkFiles(rootDir)` | Recursively list all files |
| `pickBestVideo(files)` | Select best video file (largest .mp4/.mkv/.mov/.webm) |
| `pickBestTranscript(files)` | Select best transcript (.vtt > .txt > .srt) |

**Features:**
- OAuth script preferred if available (`drive_oauth_download.py`)
- Fallback to legacy script (`drive_download.py`)
- Corrupted video detection (skips HTML/small files)
- Returns `{ videoFile, transcriptFile, allFiles, outputDir }`

---

#### 3. `dataStore.js` - Persistent Data Storage

**Purpose:** JSON-based session data persistence.

**Data File:** `data/sessions.json`

**Key Functions:**

| Function | Description |
|----------|-------------|
| `loadData()` | Load sessions from JSON file |
| `saveData(data)` | Save sessions to JSON file |
| `appendData(newSessions)` | Merge new sessions (deduplication by sessionId) |

**Merge Logic:**
- Protected keys not overwritten: `status`, `progress`, `downloadStatus`, `analysisStatus`, `auditStatus`, `auditComments`, etc.
- Drive links preferred over generic session links
- Returns `{ data, added }` with count of new sessions

---

#### 4. `reportParser.js` - Report Score Extraction

**Purpose:** Parse HTML quality reports to extract SAPTCF category scores.

**Categories (SAPTCF):**
- **S**etup
- **A**ttitude  
- **P**reparation
- **T**eaching (also called Curriculum in some contexts)
- **C**urriculum
- **F**eedback

**Key Function:**

```javascript
parseReportScores(htmlContent) → {
  setup: number,
  attitude: number,
  preparation: number,
  curriculum: number,
  teaching: number,
  feedback: number,
  overall: number,
  flags: { red: number, yellow: number, green: number }
}
```

**Parsing Methods:**
- Regex matching for patterns like "Setup: 85" or "S: 85"
- Flag detection: "critical/poor" → red, "warning/needs improvement" → yellow, "excellent/good" → green

---

#### 5. `auditController.js` - Audit Data Management

**Purpose:** Persist human audit decisions.

**Data File:** `data/audit-data.json`

**Key Functions:**

| Function | Description |
|----------|-------------|
| `saveAuditData(sessionData)` | Extract and save audit fields |
| `loadAuditData()` | Load saved audit records |

**Audit Fields Saved:**
- `sessionId`, `tutorId`
- `auditComments`, `auditApproved`, `auditStatus`, `auditTimestamp`

---

## Frontend Components

### HTML Pages

#### 1. `index.html` - Main Dashboard

The primary interface with:

- **Header:** iSchool branding with stats summary
- **Sticky Stats Bar:** Real-time metrics (Total, Completed, In Progress, Failed)
- **Upload Zone:** Drag-and-drop CSV upload
- **Search & Filter Bar:** Text search, status filter, audit filter
- **Queue Status Banner:** Shows analysis queue progress
- **Sessions Table:** Interactive data grid with:
  - Row numbers, Tutor ID, Instructor, Session ID
  - Date, Time Slot, Human Score, AI Score
  - Download/Analysis Status with progress bars
  - Action buttons (View Report, Audit, Retry, Delete)
- **Charts Section:** Status distribution, tutor performance
- **Modals:** Video viewer, Report viewer, Audit form

#### 2. `bi-dashboard.html` - Business Intelligence Dashboard

Separate analytics page with:
- Category score comparisons (Human vs AI)
- Trend analysis
- Tutor performance rankings

---

### JavaScript Modules

#### 1. `app.js` - Main Application Logic (~1806 lines)

**DOM Elements Managed:**
- Upload zone, file input, progress bars
- Session table, search/filter inputs
- Modal windows (video, report, audit)
- Batch action buttons

**Key Features:**

| Feature | Description |
|---------|-------------|
| **Socket.IO Handlers** | `sessionData`, `sessionUpdate`, `queueStatus` events |
| **File Upload** | Drag-drop and click-to-upload CSV |
| **Session Rendering** | Dynamic table with filters |
| **Queue Status Display** | Live queue metrics |
| **Retry Failed Button** | Test-first retry mechanism |
| **Audit Modal** | Comments, approval, accuracy comparison |
| **Video Modal** | Embedded video player |
| **Report Modal** | Embedded HTML report viewer |
| **Batch Operations** | Select all, bulk approve/reject/delete |
| **Export** | CSV download of session data |
| **Admin Reset** | Clear all data with confirmation |

**State Variables:**
```javascript
let currentSessions = [];      // All loaded sessions
let filteredSessions = [];     // After filter/search
let selectedSessions = new Set(); // For batch operations
let currentAuditSession = null;   // Currently auditing
let queueStatus = { queued: 0, processing: 0, ... };
```

---

#### 2. `analytics.js` - Analytics & Charts (~328 lines)

**Chart.js Integration:**

| Function | Description |
|----------|-------------|
| `updateAnalytics()` | Refresh all analytics displays |
| `updateCharts()` | Update Chart.js visualizations |
| `updateStatusChart(analytics)` | Pie chart of session statuses |
| `updateTutorChart(analytics)` | Bar chart of tutor performance |
| `calculateTutorMetrics(sessions)` | Compute per-tutor stats |
| `calculateTimeSlotDistribution(sessions)` | Time slot breakdown |
| `getStatusSummary(sessions)` | Status counts |

**Computed Metrics:**
- Total/Completed/Failed sessions
- Average scores (Human vs AI)
- Tutor completion rates
- Time slot distribution

---

### Stylesheets

#### 1. `styles.css` - Main Stylesheet (~22KB)

**Design System:**
- **Colors:** Dark gradient header (#1a1a2e → #16213e), orange accent (#f58220)
- **Typography:** Inter font family, various weights
- **Components:** Cards, badges, buttons, tables, modals
- **Glassmorphism:** Backdrop blur effects on overlays
- **Responsive:** Grid layouts, flexbox

**Key Classes:**

| Class | Purpose |
|-------|---------|
| `.card` | White rounded container |
| `.stat-card` | Statistics display card |
| `.status-badge` | Colored status indicator |
| `.status-completed/pending/failed/analyzing` | Status variations |
| `.queue-position` | Queue position badge |
| `.action-btn` | Action button variants |
| `.modal-content` | Modal container |
| `.upload-zone` | Drag-drop upload area |

#### 2. `polish.css` - UI Refinements (~7.7KB)

Additional polish for:
- Animation effects
- Hover states
- Micro-interactions

#### 3. `report-modal.css` - Report Modal Specific (~1.5KB)

Styles for embedded report viewing.

#### 4. `bi-styles.css` - BI Dashboard (~8.2KB)

Business intelligence specific styling.

---

## API Endpoints

### Session Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/upload-csv` | Upload CSV file with sessions |
| `GET` | `/api/sessions` | Get all sessions (enriched with human scores) |
| `DELETE` | `/api/sessions/:sessionId` | Delete a session and its files |

### Analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/queue/status` | Get analysis queue status |
| `POST` | `/api/sessions/analyze/:sessionId` | Re-analyze session (full re-download) |
| `POST` | `/api/sessions/retry-analysis/:sessionId` | Retry failed analysis (use existing video) |
| `POST` | `/api/analysis/retry-failed` | Bulk retry all failed analyses |

### Reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/report/:tutorId/:sessionId` | Check if report exists |
| `GET` | `/api/report/view/:tutorId/:sessionId` | Serve report HTML content |
| `POST` | `/api/report/generate/:tutorId/:sessionId` | Trigger RAG report generation |

### Auditing

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/audit/:sessionId` | Save audit (comments, approved, reviewer, accuracy) |
| `DELETE` | `/api/audit/:sessionId` | Clear audit data |

### Analytics & Export

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/analytics` | Get session analytics summary |
| `GET` | `/api/bi/metrics` | Get BI metrics (category averages, tutor scores) |
| `GET` | `/api/export` | Export all data as CSV |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/admin/reset` | Reset dashboard (clear all data) |

---

## Real-time Events (Socket.IO)

### Server → Client Events

| Event | Payload | Description |
|-------|---------|-------------|
| `sessionData` | `Session[]` | Full session list on connection |
| `activeSessions` | `Session[]` | Currently active sessions |
| `sessionUpdate` | `Session` | Single session status change |
| `queueStatus` | `QueueStatus` | Analysis queue metrics |

### Event Payloads

**Session Object:**
```javascript
{
  sessionId: string,
  tutorId: string,
  instructorName: string,
  sessionDate: string,
  timeSlot: string,
  sessionLink: string,
  driveFolderLink: string,
  status: 'pending' | 'downloading' | 'completed' | 'failed',
  downloadStatus: 'pending' | 'downloading' | 'completed' | 'failed',
  analysisStatus: 'pending' | 'queued' | 'analyzing' | 'completed' | 'failed',
  progress: number (0-100),
  videoPath: string,
  transcriptPath: string,
  reportUrl: string,
  aiScore: number,
  humanReport: { score: string, link: string },
  auditStatus: 'pending' | 'approved' | 'rejected',
  auditComments: string,
  auditApproved: boolean,
  auditTimestamp: string,
  queuePosition: number,
  retryCount: number,
  failureReason: string,
  failureDetails: string
}
```

**QueueStatus Object:**
```javascript
{
  queued: number,
  processing: number,
  maxConcurrent: number,
  completed: number,
  failed: number,
  quotaPaused: boolean,
  quotaPausedMinutesRemaining: number,
  processingDetails: [{ sessionId, tutorId, startedAt, progressPercent }]
}
```

---

## Data Flow

```
┌─────────────────┐    CSV Upload    ┌─────────────────┐
│   CSV File      │ ───────────────► │   server.js     │
│ (Tutor data)    │                  │   /api/upload   │
└─────────────────┘                  └────────┬────────┘
                                              │
                   ┌──────────────────────────┼──────────────────────────┐
                   │                          ▼                          │
                   │              ┌─────────────────────┐                │
                   │              │   dataStore.js      │                │
                   │              │   appendData()      │───► sessions.json
                   │              └──────────┬──────────┘                │
                   │                         │                           │
                   │                         ▼                           │
                   │              ┌─────────────────────┐                │
                   │              │ sessionController   │                │
                   │              │ downloadSessions()  │                │
                   │              └──────────┬──────────┘                │
                   │                         │                           │
          Google Drive Link?                 │                  HTTP Link?
                   │                         │                           │
                   ▼                         │                           ▼
    ┌─────────────────────┐                  │          ┌─────────────────────┐
    │  driveDownloader    │                  │          │   Axios Download    │
    │  downloadFromDrive  │                  │          │                     │
    └──────────┬──────────┘                  │          └──────────┬──────────┘
               │                             │                     │
               │    Python: gdown            │                     │
               ▼                             │                     ▼
    ┌─────────────────────┐                  │          ┌─────────────────────┐
    │  ../Sessions/       │◄─────────────────┴─────────►│  ../Sessions/       │
    │  <TutorId>/         │                             │  <TutorId>/         │
    │    video.mp4        │                             │    video.mp4        │
    │    transcript.vtt   │                             │                     │
    └──────────┬──────────┘                             └──────────┬──────────┘
               │                                                   │
               └───────────────────────┬───────────────────────────┘
                                       │
                                       ▼
                         ┌─────────────────────────┐
                         │  AnalysisQueueManager   │
                         │  enqueue(session)       │
                         └───────────┬─────────────┘
                                     │
                                     ▼
                         ┌─────────────────────────┐
                         │  Python: rag_video_     │
                         │  analysis.py             │
                         └───────────┬─────────────┘
                                     │
                                     ▼
                         ┌─────────────────────────┐
                         │  Quality_Report_RAG_    │
                         │  <TutorId>.html/.json   │
                         └───────────┬─────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    ▼                                 ▼
         ┌──────────────────┐              ┌──────────────────┐
         │  reportParser    │              │  Socket.IO       │
         │  parseReportScores│             │  sessionUpdate   │
         └──────────────────┘              └────────┬─────────┘
                                                    │
                                                    ▼
                                         ┌──────────────────┐
                                         │  Browser Client  │
                                         │  app.js          │
                                         └──────────────────┘
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `DOWNLOAD_MAX_CONCURRENT` | 3 | Max parallel downloads |
| `ANALYSIS_MAX_CONCURRENT` | auto | Max parallel analyses |
| `ANALYSIS_TIMEOUT_MINUTES` | 15 | Analysis timeout |
| `ANALYSIS_MAX_RETRIES` | 3 | Max retry attempts |
| `AUTO_RETRY_FAILED_ANALYSIS` | true | Auto-retry failed analyses |
| `AUTO_RETRY_FAILED_ANALYSIS_INTERVAL_MINUTES` | 10 | Retry interval |
| `AUTO_RETRY_FAILED_ANALYSIS_MIN_FAILURE_AGE_SECONDS` | 300 | Min age before retry |
| `AUTO_RETRY_QUOTA_BACKOFF_MINUTES` | 30 | Quota exhaustion backoff |

### PM2 Configuration (ecosystem.config.js)

```javascript
module.exports = {
  apps: [{
    name: 'ischool-dashboard',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
```

---

## Installation & Usage

### Prerequisites

- Node.js (v14+)
- Python 3 with `gdown` package
- Google Drive OAuth credentials (optional, for large files)

### Installation

```bash
# 1. Install Node.js dependencies
cd ischool-dashboard
npm install

# 2. Install Python dependency for Drive downloads
python3 -m pip install gdown

# 3. Start the server
npm start

# Or with PM2 for production
pm2 start ecosystem.config.js
```

### Access

Open your browser and navigate to:
```
http://localhost:3000
```

### CSV Format

Required columns:
| Column | Description |
|--------|-------------|
| `Tutor-ID` | Unique tutor identifier |
| `Session Data` | Session metadata |
| `Time slot` | Scheduled time |
| `Session Id` | Unique session identifier |
| `Session link` | Download URL |

Optional columns:
| Column | Description |
|--------|-------------|
| `Google Drive Folder Link` | Drive folder with video + transcript |
| `Recording Link` | Alternative to Session link |
| `Instructor Name` | Instructor/tutor name |
| `Human Report (Link)` | Link to human quality report |
| `Human Report (Score)` | Human-assigned score |

---

## License

iSchool AI Quality System - Internal Use Only
