const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { downloadFromDrive } = require('./driveDownloader');
const { Sessions } = require('../models/dataStore');

// Maximum concurrent downloads
const MAX_CONCURRENT = 5;
let downloadQueue = [];
let activeDownloads = 0;
let runToken = 0;

function cancelAllDownloads() {
    runToken++;
    downloadQueue = [];
    activeDownloads = 0;
}

/**
 * Download sessions from provided links
 * @param {Array} sessions - Array of session objects
 * @param {Object} io - Socket.IO instance for real-time updates
 */
async function downloadSessions(sessions, io) {
    // Append to queue
    downloadQueue.push(...sessions.map(s => ({ session: s, options: {} })));
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
        const session = item.session;
        const options = item.options || {};

        activeDownloads++;
        downloadSession(session, io, options, tokenAtStart)
            .finally(() => {
                activeDownloads--;
                processQueue(io);
            });
    }
}

/**
 * Download a single session
 */
async function downloadSession(session, io, options = {}, tokenAtStart = runToken) {
    const sessionLink = session.session_link || session.video_url || '';
    const sessionId = session.id;
    const tutorId = session.tutor_id;

    const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : async () => { };
    const onDownloadComplete = typeof options.onDownloadComplete === 'function' ? options.onDownloadComplete : async () => { };

    const isCanceled = () => tokenAtStart !== runToken;

    try {
        if (isCanceled()) return;

        // Update status
        session.download_status = 'downloading';
        session.status = 'downloading';
        session.progress = 0;

        // Update DB
        await Sessions.update(sessionId, {
            download_status: 'downloading',
            status: 'downloading',
            progress: 0
        });

        io.emit('sessionUpdate', session);
        await onUpdate(session);

        // Ensure target session folder exists
        const sessionFolder = path.join(__dirname, '..', 'Sessions', tutorId);
        if (!fs.existsSync(sessionFolder)) {
            fs.mkdirSync(sessionFolder, { recursive: true });
        }

        // Google Drive link support (public/shared file or folder)
        const driveLink = session.drive_folder_link || session.driveLink;

        if (driveLink && driveLink.includes('drive.google.com')) {
            const result = await downloadFromDrive({ driveLink, outputDir: sessionFolder });

            if (isCanceled()) return;

            const updates = {
                download_status: 'completed',
                status: 'pending', // Ready for analysis, but logic might vary
                progress: 100,
                download_path: sessionFolder
            };

            if (result.videoFile) {
                updates.video_url = `/Sessions/${tutorId}/${path.basename(result.videoFile)}`;
                session.video_url = updates.video_url; // Update local obj
            }

            if (result.transcriptFile) {
                updates.transcript_url = `/Sessions/${tutorId}/${path.basename(result.transcriptFile)}`;
                session.transcript_url = updates.transcript_url;
            }

            await Sessions.update(sessionId, updates);
            Object.assign(session, updates);

            io.emit('sessionUpdate', session);
            await onUpdate(session);

            if (!isCanceled()) {
                await onDownloadComplete(session);
            }
            return;
        }

        // Check if link is a direct HTTP download
        if (sessionLink && sessionLink.startsWith('http')) {
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

                        // Emit often but don't hammer DB
                        io.emit('sessionUpdate', session);

                        // Periodically update DB? Maybe strictly in-memory for progress is enough?
                        // Let's rely on onUpdate
                    }
                }
            });

            if (isCanceled()) return;

            // Determine file extension
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

            const updates = {
                download_path: finalPath,
                download_status: 'completed',
                status: 'pending',
                progress: 100
            };

            if (extension === '.mp4') {
                updates.video_url = `/Sessions/${tutorId}/${path.basename(finalPath)}`;
            }

            await Sessions.update(sessionId, updates);
            Object.assign(session, updates);

            io.emit('sessionUpdate', session);
            await onUpdate(session);

            if (!isCanceled()) {
                await onDownloadComplete(session);
            }
        } else {
            // Local file or invalid link
            // If it's just a file path, assume it's already there
            const updates = {
                download_status: 'completed',
                status: 'pending',
                progress: 100
            };

            await Sessions.update(sessionId, updates);
            Object.assign(session, updates);

            io.emit('sessionUpdate', session);
            await onUpdate(session);

            if (!isCanceled()) {
                await onDownloadComplete(session);
            }
        }
    } catch (error) {
        console.error(`Error downloading session ${sessionId}:`, error.message);

        if (isCanceled()) return;

        const updates = {
            download_status: 'failed',
            status: 'failed',
            error: error.message
        };

        await Sessions.update(sessionId, updates);
        Object.assign(session, updates);

        io.emit('sessionUpdate', session);
        await onUpdate(session);
    }
}

module.exports = {
    downloadSessions,
    downloadSessionsWithOptions,
    cancelAllDownloads
};
