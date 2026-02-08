// BI Analytics Engine for iSchool Dashboard - UPDATED WITH REAL DATA
// Handles data aggregation, metrics calculation, and chart generation using real SAPTCF scores

// Use configurable API base URL (works when frontend is hosted separately)
const BI_REAL_API_BASE = (() => {
    const key = 'ischoolBackendUrl';
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('backend') || params.get('api') || params.get('backendUrl');
    const fromStorage = window.localStorage ? localStorage.getItem(key) : '';
    const fallback = `${window.location.protocol}//${window.location.hostname}:3000`;
    return String(fromQuery || fromStorage || fallback).trim().replace(/\/+$/, '');
})();

// Chart instances
let performanceDistChart = null;
let performanceTrendChart = null;
let flagDistChart = null;
let flagCategoryChart = null;
let scoreDistChart = null;
let scoreDimensionsChart = null;
let comparisonRadarChart = null;
let timeSlotChart = null;

// Data storage
let allSessions = [];
let filteredSessions = [];
let biMetrics = {};
let realReportMetrics = null;

// ===== Initialize BI Dashboard =====
async function initializeBIDashboard() {
    showLoading();

    try {
        // Fetch session data
        const sessionsResponse = await fetch(`${BI_REAL_API_BASE}/api/sessions`);
        allSessions = await sessionsResponse.json();
        filteredSessions = [...allSessions];

        // Fetch real BI metrics from reports
        try {
            const metricsResponse = await fetch(`${BI_REAL_API_BASE}/api/bi/metrics`);
            realReportMetrics = await metricsResponse.json();
            console.log('Real BI metrics loaded:', realReportMetrics);
        } catch (error) {
            console.warn('Could not load real metrics, using simulated data:', error);
        }

        // Process data and update UI
        await processData();
        updateAllCharts();
        populateTutorFilters();

        hideLoading();
    } catch (error) {
        console.error('Error initializing BI dashboard:', error);
        hideLoading();
        showEmptyState();
    }
}

// Update calculateScoreDimensions to use real SAPTCF categories
function calculateScoreDimensions() {
    if (realReportMetrics && realReportMetrics.totalReports > 0) {
        // Use real SAPTCF scores from parsed reports
        return {
            setup: realReportMetrics.categoryAverages.setup,
            attitude: realReportMetrics.categoryAverages.attitude,
            preparation: realReportMetrics.categoryAverages.preparation,
            curriculum: realReportMetrics.categoryAverages.curriculum,
            teaching: realReportMetrics.categoryAverages.teaching,
            feedback: realReportMetrics.categoryAverages.feedback
        };
    } else {
        // Fallback to simulated data if no reports available
        const avgPerf = calculateAvgPerformance();
        return {
            setup: Math.round(avgPerf * 0.92),
            attitude: Math.round(avgPerf * 0.95),
            preparation: Math.round(avgPerf * 0.88),
            curriculum: Math.round(avgPerf * 0.90),
            teaching: Math.round(avgPerf * 0.93),
            feedback: Math.round(avgPerf * 0.87)
        };
    }
}

// Update calculateAvgPerformance to use real scores
function calculateAvgPerformance() {
    if (realReportMetrics && realReportMetrics.overallAverage > 0) {
        return realReportMetrics.overallAverage;
    }

    // Fallback to session-based calculation
    if (filteredSessions.length === 0) return 0;

    const scores = filteredSessions.map(s => {
        let score = 70;
        if (s.status === 'completed') score += 20;
        if (s.auditApproved) score += 10;
        return Math.min(100, score);
    });

    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return Math.round(avg);
}

// Update calculateTutorScores to use real report scores
function calculateTutorScores() {
    if (realReportMetrics && realReportMetrics.tutorScores.length > 0) {
        // Use real scores from reports
        return realReportMetrics.tutorScores.map(t => ({
            tutorId: t.tutorId,
            score: t.overall,
            sessionCount: 1 // Could be enhanced to count multiple sessions per tutor
        }));
    }

    // Fallback to session-based calculation
    const tutorMap = new Map();

    filteredSessions.forEach(s => {
        if (!tutorMap.has(s.tutorId)) {
            tutorMap.set(s.tutorId, {
                tutorId: s.tutorId,
                sessions: [],
                totalScore: 0
            });
        }

        const tutor = tutorMap.get(s.tutorId);
        const score = getSessionScore(s);
        tutor.sessions.push(score);
        tutor.totalScore += score;
    });

    return Array.from(tutorMap.values()).map(t => ({
        tutorId: t.tutorId,
        score: Math.round(t.totalScore / t.sessions.length),
        sessionCount: t.sessions.length
    }));
}

// Update createScoreDimensionsChart to show SAPTCF categories
function createScoreDimensionsChart() {
    const ctx = document.getElementById('scoreDimensionsChart');
    if (!ctx) return;

    const dimensions = biMetrics.scoreDimensions;

    if (scoreDimensionsChart) {
        scoreDimensionsChart.destroy();
    }

    // Use SAPTCF category labels
    const labels = [
        'Setup (S)',
        'Attitude (A)',
        'Preparation (P)',
        'Curriculum (C)',
        'Teaching (T)',
        'Feedback (F)'
    ];

    const data = [
        dimensions.setup,
        dimensions.attitude,
        dimensions.preparation,
        dimensions.curriculum,
        dimensions.teaching,
        dimensions.feedback
    ];

    scoreDimensionsChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: [{
                label: 'SAPTCF Scores',
                data: data,
                backgroundColor: 'rgba(0, 123, 255, 0.2)',
                borderColor: '#007bff',
                borderWidth: 2,
                pointBackgroundColor: '#007bff',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: '#007bff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        stepSize: 20
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return context.label + ': ' + context.parsed.r + '/100';
                        }
                    }
                }
            }
        }
    });
}

// Export the updated functions
window.calculateScoreDimensions = calculateScoreDimensions;
window.calculateAvgPerformance = calculateAvgPerformance;
window.calculateTutorScores = calculateTutorScores;
window.createScoreDimensionsChart = createScoreDimensionsChart;
