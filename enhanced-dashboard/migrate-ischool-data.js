/**
 * Migration Script: Import iSchool Dashboard Data to Enhanced Dashboard
 * This script transforms and imports sessions with their human reports
 */

const fs = require('fs').promises;
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

async function loadJSON(filename) {
    try {
        const data = await fs.readFile(path.join(DATA_DIR, filename), 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.log(`Could not load ${filename}:`, error.message);
        return [];
    }
}

async function saveJSON(filename, data) {
    await fs.writeFile(
        path.join(DATA_DIR, filename), 
        JSON.stringify(data, null, 2),
        'utf8'
    );
    console.log(`✅ Saved ${filename}`);
}

async function migrate() {
    console.log('🚀 Starting Data Migration from iSchool Dashboard...\n');

    // Load source data
    const ischoolSessions = await loadJSON('ischool-sessions-full.json');
    console.log(`📥 Loaded ${ischoolSessions.length} sessions from iSchool Dashboard\n`);

    // Transform sessions
    const sessions = [];
    const tutors = [];
    const reviews = [];
    const tutorMap = new Map();

    for (let i = 0; i < ischoolSessions.length; i++) {
        const s = ischoolSessions[i];
        const timestamp = Date.now() + i;

        // Create session record
        const session = {
            id: timestamp.toString(),
            session_id: s.sessionId || s.meetingId || `SES-${timestamp}`,
            tutor_id: s.tutorId,
            instructor_name: s.instructorName,
            session_date: s.sessionData || s.sessionDate,
            time_slot: s.timeSlot,
            video_url: s.recordingLink || s.sessionLink,
            drive_folder: s.driveFolderLink,
            video_path: s.videoPath,
            transcript_path: s.transcriptPath,
            download_path: s.downloadPath,
            status: s.status || 'completed',
            progress: s.progress || 100,
            download_status: s.downloadStatus || 'completed',
            analysis_status: s.analysisStatus || 'completed',
            audit_status: s.auditStatus || 'pending',
            ai_score: s.aiScore || null,
            human_score: s.humanReport?.score ? parseInt(s.humanReport.score) : null,
            human_reviewed: !!s.humanReport?.score,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        sessions.push(session);

        // Create/update tutor record
        if (s.tutorId && !tutorMap.has(s.tutorId)) {
            const tutor = {
                id: `tutor-${s.tutorId}`,
                tutor_code: s.tutorId,
                full_name: s.instructorName || 'Unknown',
                email: `${s.tutorId.toLowerCase()}@ischool.com`,
                status: 'active',
                hire_date: new Date().toISOString(),
                total_sessions: 0,
                average_score: 0,
                created_at: new Date().toISOString()
            };
            tutorMap.set(s.tutorId, tutor);
        }

        // Create AI review
        if (s.aiScore) {
            reviews.push({
                id: `ai-${timestamp}`,
                session_id: session.id,
                tutor_id: s.tutorId,
                reviewer_id: 'ai-system',
                review_type: 'ai',
                score: s.aiScore,
                positive_feedback: '',
                improvement_areas: '',
                created_at: new Date().toISOString()
            });
        }

        // Create human review
        if (s.humanReport && s.humanReport.score) {
            reviews.push({
                id: `human-${timestamp}`,
                session_id: session.id,
                tutor_id: s.tutorId,
                reviewer_id: 'admin-user',
                review_type: 'human',
                score: parseInt(s.humanReport.score),
                positive_feedback: s.humanReport.positive || '',
                improvement_areas: s.humanReport.improvement || '',
                saptcf_scores: extractSAPTCF(s.humanReport),
                created_at: new Date().toISOString()
            });
        }
    }

    // Calculate tutor statistics
    for (const [tutorId, tutor] of tutorMap) {
        const tutorSessions = sessions.filter(s => s.tutor_id === tutorId);
        const scores = tutorSessions
            .map(s => s.human_score || s.ai_score)
            .filter(s => s !== null);
        
        tutor.total_sessions = tutorSessions.length;
        tutor.average_score = scores.length 
            ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
            : 0;
    }

    const tutorsArray = Array.from(tutorMap.values());

    // Save all data
    console.log('\n📤 Saving migrated data...');
    await saveJSON('sessions.json', sessions);
    await saveJSON('tutors.json', tutorsArray);
    await saveJSON('reviews.json', reviews);

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 MIGRATION SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Sessions migrated: ${sessions.length}`);
    console.log(`✅ Tutors extracted: ${tutorsArray.length}`);
    console.log(`✅ Reviews created: ${reviews.length}`);
    console.log(`   - AI Reviews: ${reviews.filter(r => r.review_type === 'ai').length}`);
    console.log(`   - Human Reviews: ${reviews.filter(r => r.review_type === 'human').length}`);
    
    // Score statistics
    const humanScores = sessions.filter(s => s.human_score).map(s => s.human_score);
    const aiScores = sessions.filter(s => s.ai_score).map(s => s.ai_score);
    
    if (humanScores.length) {
        const avgHuman = Math.round(humanScores.reduce((a, b) => a + b, 0) / humanScores.length);
        console.log(`\n📈 Average Human Score: ${avgHuman}`);
    }
    if (aiScores.length) {
        const avgAI = Math.round(aiScores.reduce((a, b) => a + b, 0) / aiScores.length);
        console.log(`📈 Average AI Score: ${avgAI}`);
    }
    
    console.log('\n✨ Migration completed successfully!');
}

function extractSAPTCF(humanReport) {
    // Extract SAPTCF scores from human report text
    const categories = {
        setup: { score: 95, notes: '' },
        attitude: { score: 95, notes: '' },
        preparation: { score: 95, notes: '' },
        time: { score: 95, notes: '' },
        content: { score: 95, notes: '' },
        feedback: { score: 95, notes: '' }
    };

    const text = (humanReport.positive || '') + ' ' + (humanReport.improvement || '');
    
    // Simple extraction based on SAPTCF prefixes in text
    if (text.includes('S -') || text.includes('S-') || text.toLowerCase().includes('setup')) {
        categories.setup.notes = extractCategory(text, 'S');
    }
    if (text.includes('A -') || text.includes('A-') || text.toLowerCase().includes('attitude')) {
        categories.attitude.notes = extractCategory(text, 'A');
    }
    if (text.includes('P -') || text.includes('P-') || text.toLowerCase().includes('preparation')) {
        categories.preparation.notes = extractCategory(text, 'P');
    }
    if (text.includes('T -') || text.includes('T-') || text.toLowerCase().includes('time')) {
        categories.time.notes = extractCategory(text, 'T');
    }
    if (text.includes('C -') || text.includes('C-') || text.toLowerCase().includes('content')) {
        categories.content.notes = extractCategory(text, 'C');
    }
    if (text.includes('F -') || text.includes('F-') || text.toLowerCase().includes('feedback')) {
        categories.feedback.notes = extractCategory(text, 'F');
    }

    return categories;
}

function extractCategory(text, letter) {
    // Extract text for a specific SAPTCF category
    const regex = new RegExp(`${letter}\\s*[-–:]\\s*([^\\n]+)`, 'gi');
    const matches = text.match(regex);
    return matches ? matches.join(' ') : '';
}

// Run migration
migrate().catch(console.error);
