const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.mov', '.webm']);
const TRANSCRIPT_EXTS = new Set(['.txt', '.vtt', '.srt']);

function walkFiles(rootDir) {
    const out = [];
    const stack = [rootDir];

    while (stack.length) {
        const current = stack.pop();
        try {
            const entries = fs.readdirSync(current, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    stack.push(fullPath);
                } else {
                    out.push(fullPath);
                }
            }
        } catch (e) {
            // Ignore access errors
        }
    }

    return out;
}

function pickBestVideo(files) {
    const videos = files.filter(p => VIDEO_EXTS.has(path.extname(p).toLowerCase()));
    if (videos.length === 0) return null;

    // Prefer the largest video if multiple, and verify it's not corrupted
    let best = null;
    let bestSize = 0;
    for (const v of videos) {
        try {
            const size = fs.statSync(v).size;

            // Check if video file is corrupted (HTML instead of video)
            if (size < 100000) { // Less than 100KB is suspicious
                const fd = fs.openSync(v, 'r');
                const buffer = Buffer.alloc(200);
                fs.readSync(fd, buffer, 0, 200, 0);
                fs.closeSync(fd);
                const header = buffer.toString('utf8');
                if (header.includes('<!DOCTYPE') || header.includes('<html') || header.includes('Google Drive')) {
                    console.log(`[WARNING] Corrupted video detected: ${v} (${size} bytes) - contains HTML`);
                    continue; // Skip this corrupted file
                }
            }

            if (size > bestSize) {
                best = v;
                bestSize = size;
            }
        } catch {
            // ignore
        }
    }
    return best;
}

function pickBestTranscript(files) {
    const transcripts = files.filter(p => TRANSCRIPT_EXTS.has(path.extname(p).toLowerCase()));
    if (transcripts.length === 0) return null;

    // Prefer .vtt then .txt then .srt
    const score = (p) => {
        const ext = path.extname(p).toLowerCase();
        if (ext === '.vtt') return 3;
        if (ext === '.txt') return 2;
        if (ext === '.srt') return 1;
        return 0;
    };

    return transcripts.sort((a, b) => score(b) - score(a))[0];
}

async function downloadFromDrive({ driveLink, outputDir }) {
    if (!driveLink) {
        throw new Error('driveLink is required');
    }

    fs.mkdirSync(outputDir, { recursive: true });

    // Try OAuth download first (handles large files better)
    const oauthScriptPath = path.join(__dirname, '..', '..', 'drive_oauth_download.py');
    const legacyScriptPath = path.join(__dirname, '..', '..', 'drive_download.py');

    // Use OAuth script if available
    const scriptPath = fs.existsSync(oauthScriptPath) ? oauthScriptPath : legacyScriptPath;
    console.log(`Using download script: ${path.basename(scriptPath)}`);

    return await new Promise((resolve, reject) => {
        const py = spawn('python3', [scriptPath, '--drive_link', driveLink, '--output_dir', outputDir]);

        let stdout = '';
        let stderr = '';

        py.stdout.on('data', (d) => { stdout += d.toString(); });
        py.stderr.on('data', (d) => { stderr += d.toString(); });

        py.on('close', (code) => {
            if (code !== 0) {
                // The script prints JSON on stdout when possible.
                const msg = stderr.trim() || stdout.trim() || `drive_download.py exited with code ${code}`;
                return reject(new Error(msg));
            }

            // Parse the *last* JSON object printed (gdown itself can print progress).
            const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            let parsed = null;
            for (let i = lines.length - 1; i >= 0; i--) {
                try {
                    parsed = JSON.parse(lines[i]);
                    break;
                } catch {
                    // continue
                }
            }

            if (!parsed || !parsed.ok) {
                return reject(new Error((parsed && parsed.error) ? parsed.error : (stderr || 'Drive download failed')));
            }

            const allFiles = fs.existsSync(outputDir) ? walkFiles(outputDir) : [];
            const videoFile = pickBestVideo(allFiles);
            const transcriptFile = pickBestTranscript(allFiles);

            resolve({
                outputDir,
                allFiles,
                videoFile,
                transcriptFile,
                raw: parsed,
            });
        });
    });
}

module.exports = {
    downloadFromDrive,
};
