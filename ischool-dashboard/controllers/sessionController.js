const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { downloadFromDrive } = require('./driveDownloader');

// Maximum concurrent downloads (configurable for small hosts)
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.DOWNLOAD_MAX_CONCURRENT || '3', 10));
let downloadQueue = [];
let activeDownloads = 0;
let runToken = 0;

function cancelAllDownloads() {
    runToken++;
    downloadQueue = [];
}

/**
 * Download sessions from provided links
 * @param {Array} sessions - Array of session objects
 * @param {Object} io - Socket.IO instance for real-time updates
 */
async function downloadSessions(sessions, io) {
    // Append to queue instead of overwriting
    downloadQueue.push(...sessions);
    processQueue(io);
}

async function downloadSessionsWithOptions(sessions, io, options = {}) {
    downloadQueue.push(...sessions.map(s => ({ session: s, options })));
    processQueue(io);
}

/**
 * Process download queue with concurrency control
 */
async function processQueue(io) {
    while (downloadQueue.length > 0 && activeDownloads < MAX_CONCURRENT) {
        const tokenAtStart = runToken;
        const item = downloadQueue.shift();
        const session = item && item.session ? item.session : item;
        const options = item && item.session ? item.options : {};
        activeDownloads++;
        downloadSession(session, io, options, tokenAtStart);
    }
}

/**
 * Download a single session
 */
async function downloadSession(session, io, options = {}, tokenAtStart = runToken) {
    const sessionLink = session.sessionLink;
    const sessionId = session.sessionId;
    const tutorId = session.tutorId;

    const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : () => {};
    const onDownloadComplete = typeof options.onDownloadComplete === 'function' ? options.onDownloadComplete : () => {};

    const isCanceled = () => tokenAtStart !== runToken;

    try {
        if (isCanceled()) return;

        // Update status
        session.downloadStatus = 'downloading';
        session.status = 'downloading';
        session.progress = 0;
        io.emit('sessionUpdate', session);
        onUpdate(session);

        // Ensure target session folder exists
        const sessionFolder = path.join(__dirname, '..', '..', 'Sessions', tutorId);
        fs.mkdirSync(sessionFolder, { recursive: true });

        // Google Drive link support (public/shared file or folder)
        const driveLink = session.driveFolderLink || session.driveLink;
        if (driveLink && driveLink.includes('drive.google.com')) {
            const result = await downloadFromDrive({ driveLink, outputDir: sessionFolder });

            if (isCanceled()) return;

            if (result.videoFile) {
                session.videoPath = result.videoFile;
                session.sessionLink = `/sessions/${tutorId}/${path.basename(result.videoFile)}`;
            }

            if (result.transcriptFile) {
                session.transcriptPath = result.transcriptFile;
            }

            session.downloadPath = sessionFolder;
            session.downloadStatus = 'completed';
            session.status = 'completed';
            session.progress = 100;
            io.emit('sessionUpdate', session);
            onUpdate(session);

            if (!isCanceled()) {
                await onDownloadComplete(session);
            }
            return;
        }

        // Check if link is a direct HTTP download
        if (sessionLink.startsWith('http')) {
            const response = await axios({
                method: 'get',
                url: sessionLink,
                responseType: 'stream',
                timeout: 30000,
                onDownloadProgress: (progressEvent) => {
                    if (isCanceled()) return;
                    if (progressEvent.total) {
                        const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                        session.progress = progress;
                        io.emit('sessionUpdate', session);
                        onUpdate(session);
                    }
                }
            });

            if (isCanceled()) return;

            // Determine file extension from content-type or URL
            const contentType = response.headers['content-type'];
            let extension = '.bin';
            if (contentType) {
                if (contentType.includes('video')) extension = '.mp4';
                else if (contentType.includes('audio')) extension = '.mp3';
                else if (contentType.includes('pdf')) extension = '.pdf';
            }

            const finalPath = path.join(sessionFolder, `${sessionId}${extension}`);
            const writer = fs.createWriteStream(finalPath);

            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            if (isCanceled()) return;

            session.downloadPath = finalPath;
            if (extension === '.mp4') {
                session.videoPath = finalPath;
                session.sessionLink = `/sessions/${tutorId}/${path.basename(finalPath)}`;
            }
            session.downloadStatus = 'completed';
            session.status = 'completed';
            session.progress = 100;
        } else {
            // For file:// links (local files), they're already available
            // Mark as completed since no download is needed
            session.downloadPath = sessionLink;
            session.downloadStatus = 'completed';
            session.status = 'completed';
            session.progress = 100;
        }

        io.emit('sessionUpdate', session);
        onUpdate(session);
        if (!isCanceled()) {
            await onDownloadComplete(session);
        }
    } catch (error) {
        console.error(`Error downloading session ${sessionId}:`, error.message);

        if (isCanceled()) return;

        session.downloadStatus = 'failed';
        session.status = 'failed';
        session.error = error.message;
        io.emit('sessionUpdate', session);
        onUpdate(session);
    } finally {
        activeDownloads--;
        processQueue(io);
    }
}

module.exports = {
    downloadSessions,
    downloadSessionsWithOptions,
    cancelAllDownloads
};
