const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Sessions } = require('../models/dataStore');

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
        if (this.processing.has(session.id) || this.queue.find(item => item.session.id === session.id)) {
            console.log(`Session ${session.id} is already in the queue or processing.`);
            return;
        }

        this.queue.push({ session, startTime: Date.now(), options });
        this.stats.queued++;

        // Broadcast Update
        this.broadcastQueueStatus(io);

        // Trigger processing
        this.processNext(io);
    }

    // Add multiple sessions
    enqueueMultiple(sessions, io, options = {}) {
        let addedCount = 0;
        sessions.forEach(session => {
            if (!this.processing.has(session.id) && !this.queue.find(item => item.session.id === session.id)) {
                this.queue.push({ session, startTime: Date.now(), options });
                this.stats.queued++;
                addedCount++;
            }
        });

        if (addedCount > 0) {
            this.broadcastQueueStatus(io);
            this.processNext(io);
        }
    }

    // Process next item in queue
    async processNext(io) {
        if (this.activeCount >= ANALYSIS_CONFIG.maxConcurrent || this.queue.length === 0) {
            return;
        }

        const item = this.queue.shift();
        this.stats.queued--;
        this.activeCount++;
        this.processing.set(item.session.id, {
            status: 'analyzing',
            startTime: Date.now()
        });

        // Broadcast active status
        this.broadcastQueueStatus(io);

        // update session status to analyzing
        await Sessions.update(item.session.id, {
            status: 'analyzing',
            analysis_status: 'analyzing'
        });
        item.session.status = 'analyzing';
        io.emit('sessionUpdate', item.session);

        try {
            await this.analyzeSession(item.session, io, item.options);
            this.stats.completed++;
        } catch (error) {
            console.error(`Analysis failed for ${item.session.id}:`, error);
            this.stats.failed++;
            await Sessions.update(item.session.id, {
                status: 'failed',
                analysis_status: 'failed',
                error_message: error.message
            });
            item.session.status = 'failed';
            io.emit('sessionUpdate', item.session);
        } finally {
            this.activeCount--;
            this.processing.delete(item.session.id);
            this.broadcastQueueStatus(io);
            this.processNext(io); // Process next item
        }
    }

    // Analyze a single session
    // This calls the external python script
    async analyzeSession(session, io, options = {}) {
        return new Promise((resolve, reject) => {
            const tutorId = session.tutor_id;
            const sessionId = session.id;

            const sessionFolder = path.join(__dirname, '..', 'Sessions', tutorId);

            // Re-verify files exist
            if (!fs.existsSync(sessionFolder)) {
                return reject(new Error('Session folder not found'));
            }

            const files = fs.readdirSync(sessionFolder);
            const videoFile = files.find(f => f.endsWith('.mp4'));
            const transcriptFile = files.find(f => f.endsWith('.vtt') || f.endsWith('.txt'));

            if (!videoFile) {
                return reject(new Error('Video file not found'));
            }

            const videoPath = path.join(sessionFolder, videoFile);
            const transcriptPath = transcriptFile ? path.join(sessionFolder, transcriptFile) : null;
            const outputReport = path.join(sessionFolder, `Quality_Report_RAG_${tutorId}.html`);

            // Run RAG analysis script
            // Using the one in the parent folder (legacy path)
            const scriptPath = path.join(__dirname, '..', '..', 'rag_video_analysis.py');

            const args = [
                scriptPath,
                '--input', videoPath,
                '--output_report', outputReport
            ];

            if (transcriptPath) {
                args.push('--transcript', transcriptPath);
            }

            console.log(`Starting analysis for ${sessionId} with ${videoPath}`);
            const python = spawn('python3', args);

            let output = '';
            let errorOutput = '';

            python.stdout.on('data', (data) => {
                output += data.toString();
                // We could emit detailed progress here if the python script outputs it
            });

            python.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            python.on('close', async (code) => {
                if (code === 0 && fs.existsSync(outputReport)) {
                    const reportUrl = `/Sessions/${tutorId}/Quality_Report_RAG_${tutorId}.html`;

                    await Sessions.update(sessionId, {
                        status: 'completed',
                        analysis_status: 'completed',
                        report_url: reportUrl,
                        progress: 100
                    });

                    session.status = 'completed';
                    session.report_url = reportUrl;
                    io.emit('sessionUpdate', session);

                    resolve({ reportUrl });
                } else {
                    reject(new Error(`Analysis script failed (code ${code}): ${errorOutput}`));
                }
            });

            // Setup timeout
            const timeoutMs = ANALYSIS_CONFIG.timeoutMinutes * 60 * 1000;
            const timer = setTimeout(() => {
                python.kill();
                reject(new Error('Analysis timed out'));
            }, timeoutMs);

            python.on('close', () => clearTimeout(timer));
        });
    }

    // Update stats
    updateStats() {
        this.stats.processing = this.activeCount;
        this.stats.queued = this.queue.length;
    }

    // Broadcast queue status to all clients
    broadcastQueueStatus(io) {
        this.updateStats();
        io.emit('queueStatus', this.getStatus());
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

module.exports = new AnalysisQueueManager();
