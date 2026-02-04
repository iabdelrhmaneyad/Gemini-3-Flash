# iSchool AI Quality System Dashboard

A comprehensive dashboard for managing AI tutoring session quality control with CSV upload, automated session downloading, live analytics, and human audit capabilities.

## Features

- **CSV Upload**: Drag-and-drop or click to upload CSV files with session data
- **Concurrent Downloads**: Automatically downloads up to 5 sessions simultaneously
- **Real-time Progress**: Live updates via WebSocket for download progress
- **Live Analytics**: Dashboard with session statistics and metrics
- **Human Audit Interface**: Add comments and approve sessions
- **Data Export**: Export all session data including audit information
- **Premium UI**: Modern glassmorphism design with iSchool branding

## CSV Format

The uploaded CSV file should contain the following columns:
- `Tutor-ID`: Unique identifier for the tutor
- `Session Data`: Session information/metadata
- `Time slot`: Scheduled time for the session
- `Session Id`: Unique session identifier
- `Session link`: URL to download the session recording

Additional supported columns (optional):
- `Recording Link`: Alternative name for `Session link`
- `Google Drive Folder Link`: A public/shared Google Drive folder containing the session video + transcript

Notes:
- If `Google Drive Folder Link` is present, the dashboard will download from Drive and then auto-generate the RAG report.
- Session assets are stored under `../Sessions/<TutorId>/` so the dashboard can stream videos via `/sessions/...`.

## Installation

1. Install dependencies:
```bash
npm install
```

2. (For Google Drive downloads) install Python dependency:
```bash
python3 -m pip install gdown
```

2. Start the server:
```bash
npm start
```

3. Open your browser and navigate to:
```
http://localhost:3000
```

## Usage

1. **Upload CSV**: Click or drag-and-drop your CSV file into the upload zone
2. **Monitor Progress**: Watch real-time download progress for all sessions
3. **View Analytics**: Check the statistics dashboard for session metrics
4. **Audit Sessions**: Click "Audit" on any session to add comments and approve
5. **Export Data**: Click "Export Data" to download all session information

## Technology Stack

- **Backend**: Node.js, Express, Socket.IO
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Real-time**: WebSocket via Socket.IO
- **File Processing**: Multer, CSV-parser
- **HTTP Client**: Axios

## Project Structure

```
ischool-dashboard/
├── controllers/
│   ├── sessionController.js    # Session download logic
│   └── auditController.js      # Audit data management
├── public/
│   ├── css/
│   │   └── styles.css          # Premium styling
│   ├── js/
│   │   ├── app.js              # Main application logic
│   │   └── analytics.js        # Analytics functions
│   ├── assets/
│   │   └── ischool-logo.png    # iSchool branding
│   └── index.html              # Main dashboard
├── uploads/                     # Uploaded CSV files
├── downloads/                   # Legacy download folder (not used for Drive)
├── data/                        # Audit data storage
├── server.js                    # Express server
└── package.json                # Dependencies
```

## API Endpoints

- `POST /api/upload-csv`: Upload CSV file
- `GET /api/sessions`: Get all sessions
- `GET /api/analytics`: Get session analytics
- `POST /api/audit/:sessionId`: Save audit data
- `GET /api/export`: Export all data as CSV

## Features in Detail

### Concurrent Session Downloads
The system handles up to 5 simultaneous downloads with automatic queue management and retry logic.

### Real-time Updates
All clients receive live updates when:
- New sessions are uploaded
- Download progress changes
- Sessions complete or fail
- Audit data is saved

### Human Audit System
- Add detailed comments for each session
- Approve/reject sessions with checkbox
- Track audit history and timestamps
- Export audit reports

## Browser Support

- Chrome (recommended)
- Firefox
- Safari
- Edge

## License

iSchool AI Quality System - Internal Use Only
