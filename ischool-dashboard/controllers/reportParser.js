const cheerio = require('cheerio');

/**
 * Parse HTML report to extract SAPTCF category scores
 * Categories: Setup, Attitude, Preparation, Curriculum, Teaching, Feedback
 */
function parseReportScores(htmlContent) {
    try {
        const $ = cheerio.load(htmlContent);
        const scores = {
            setup: 0,
            attitude: 0,
            preparation: 0,
            curriculum: 0,
            teaching: 0,
            feedback: 0,
            overall: 0,
            flags: {
                red: 0,
                yellow: 0,
                green: 0
            }
        };

        // Extract category scores from the report
        // Look for patterns like "S: 85" or "Setup: 85"
        const text = $('body').text();

        // Parse Setup (S)
        const setupMatch = text.match(/(?:Setup|S):\s*(\d+)/i);
        if (setupMatch) scores.setup = parseInt(setupMatch[1]);

        // Parse Attitude (A)
        const attitudeMatch = text.match(/(?:Attitude|A):\s*(\d+)/i);
        if (attitudeMatch) scores.attitude = parseInt(attitudeMatch[1]);

        // Parse Preparation (P)
        const preparationMatch = text.match(/(?:Preparation|P):\s*(\d+)/i);
        if (preparationMatch) scores.preparation = parseInt(preparationMatch[1]);

        // Parse Curriculum (C)
        const curriculumMatch = text.match(/(?:Curriculum|C):\s*(\d+)/i);
        if (curriculumMatch) scores.curriculum = parseInt(curriculumMatch[1]);

        // Parse Teaching (T)
        const teachingMatch = text.match(/(?:Teaching|T):\s*(\d+)/i);
        if (teachingMatch) scores.teaching = parseInt(teachingMatch[1]);

        // Parse Feedback (F)
        const feedbackMatch = text.match(/(?:Feedback|F):\s*(\d+)/i);
        if (feedbackMatch) scores.feedback = parseInt(feedbackMatch[1]);

        // Calculate overall score
        const validScores = [
            scores.setup,
            scores.attitude,
            scores.preparation,
            scores.curriculum,
            scores.teaching,
            scores.feedback
        ].filter(s => s > 0);

        if (validScores.length > 0) {
            scores.overall = Math.round(
                validScores.reduce((a, b) => a + b, 0) / validScores.length
            );
        }

        // Parse flags (look for color indicators or quality ratings)
        const flagText = text.toLowerCase();
        if (flagText.includes('critical') || flagText.includes('poor')) {
            scores.flags.red++;
        } else if (flagText.includes('warning') || flagText.includes('needs improvement')) {
            scores.flags.yellow++;
        } else if (flagText.includes('excellent') || flagText.includes('good')) {
            scores.flags.green++;
        }

        return scores;
    } catch (error) {
        console.error('Error parsing report:', error);
        return null;
    }
}

module.exports = {
    parseReportScores
};
