const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'sessions.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize data file if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
}

/**
 * Load session data from JSON file
 * @returns {Array} Array of session objects
 */
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = fs.readFileSync(DATA_FILE, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.error('Error loading data:', error);
        return [];
    }
}

/**
 * Save session data to JSON file
 * @param {Array} data - Array of session objects
 */
function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log(`Saved ${data.length} sessions to storage`);
        return true;
    } catch (error) {
        console.error('Error saving data:', error);
        return false;
    }
}

/**
 * Append new sessions to existing data
 * @param {Array} newSessions - Array of new session objects
 * @returns {Array} Updated full dataset
 */
function appendData(newSessions) {
    const currentData = loadData();

    // Create a map of existing sessions by sessionId to prevent duplicates
    const sessionMap = new Map();
    currentData.forEach(s => sessionMap.set(s.sessionId, s));

    // Add/Update new sessions
    let addedCount = 0;
    newSessions.forEach(session => {
        const existing = sessionMap.get(session.sessionId);
        if (!existing) {
            sessionMap.set(session.sessionId, session);
            addedCount++;
            return;
        }

        // Merge non-empty fields into existing record (do not overwrite statuses/audits)
        const protectedKeys = new Set([
            'status',
            'progress',
            'downloadStatus',
            'analysisStatus',
            'auditStatus',
            'auditComments',
            'auditApproved',
            'auditTimestamp',
            'error'
        ]);

        Object.keys(session).forEach((key) => {
            if (protectedKeys.has(key)) return;
            const nextVal = session[key];
            const hasNext = nextVal !== undefined && nextVal !== null && String(nextVal).trim() !== '';
            if (!hasNext) return;

            const prevVal = existing[key];
            const hasPrev = prevVal !== undefined && prevVal !== null && String(prevVal).trim() !== '';

            if (!hasPrev) {
                existing[key] = nextVal;
            }

            // Prefer Drive links over generic sessionLink when both present
            if (key === 'driveFolderLink' && hasNext) {
                existing.driveFolderLink = nextVal;
                if (!existing.sessionLink || !String(existing.sessionLink).includes('drive.google.com')) {
                    existing.sessionLink = nextVal;
                }
            }
        });
    });

    const updatedData = Array.from(sessionMap.values());
    saveData(updatedData);

    return {
        data: updatedData,
        added: addedCount
    };
}

module.exports = {
    loadData,
    saveData,
    appendData
};
