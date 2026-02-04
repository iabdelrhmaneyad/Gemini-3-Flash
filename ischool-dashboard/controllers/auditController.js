const fs = require('fs');
const path = require('path');

const AUDIT_DATA_PATH = path.join(__dirname, '..', 'data', 'audit-data.json');

/**
 * Save audit data to file
 * @param {Array} sessionData - Array of session objects with audit information
 */
function saveAuditData(sessionData) {
    try {
        const auditData = sessionData.map(session => ({
            sessionId: session.sessionId,
            tutorId: session.tutorId,
            auditComments: session.auditComments,
            auditApproved: session.auditApproved,
            auditStatus: session.auditStatus,
            auditTimestamp: session.auditTimestamp
        }));

        fs.writeFileSync(AUDIT_DATA_PATH, JSON.stringify(auditData, null, 2));
        console.log('Audit data saved successfully');
    } catch (error) {
        console.error('Error saving audit data:', error);
    }
}

/**
 * Load audit data from file
 * @returns {Array} Array of audit records
 */
function loadAuditData() {
    try {
        if (fs.existsSync(AUDIT_DATA_PATH)) {
            const data = fs.readFileSync(AUDIT_DATA_PATH, 'utf8');
            return JSON.parse(data);
        }
        return [];
    } catch (error) {
        console.error('Error loading audit data:', error);
        return [];
    }
}

module.exports = {
    saveAuditData,
    loadAuditData
};
