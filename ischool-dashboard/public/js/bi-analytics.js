// BI Analytics Engine for iSchool Dashboard
// Handles data aggregation, metrics calculation, and chart generation

// Use dynamic API base URL for network access
const BI_API_BASE = `${window.location.protocol}//${window.location.hostname}:3000`;

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
        const response = await fetch(`${BI_API_BASE}/api/sessions`);
        allSessions = await response.json();
        filteredSessions = [...allSessions];

        // Fetch real BI metrics from reports
        try {
            const metricsResponse = await fetch(`${BI_API_BASE}/api/bi/metrics`);
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

// ===== Data Processing =====
function processData() {
    biMetrics = {
        totalTutors: calculateTotalTutors(),
        avgPerformance: calculateAvgPerformance(),
        criticalFlags: calculateCriticalFlags(),
        qualityRating: calculateQualityRating(),
        performanceDistribution: calculatePerformanceDistribution(),
        performanceTrend: calculatePerformanceTrend(),
        flagDistribution: calculateFlagDistribution(),
        flagsByCategory: calculateFlagsByCategory(),
        topPerformers: getTopPerformers(5),
        bottomPerformers: getBottomPerformers(5),
        scoreDistribution: calculateScoreDistribution(),
        scoreDimensions: calculateScoreDimensions(),
        timeSlotPerformance: calculateTimeSlotPerformance()
    };

    updateKPICards();
    updateRankings();
}

// ===== KPI Calculations =====
function calculateTotalTutors() {
    const uniqueTutors = new Set(filteredSessions.map(s => s.tutorId));
    return uniqueTutors.size;
}

function calculateAvgPerformance() {
    // Priority: Use real metrics from reports if available
    if (realReportMetrics && realReportMetrics.overallAverage > 0) {
        return realReportMetrics.overallAverage;
    }

    if (filteredSessions.length === 0) return 0;

    // Simulate performance score based on status and audit
    const scores = filteredSessions.map(s => {
        let score = 70; // Base score
        if (s.status === 'completed') score += 20;
        if (s.auditApproved) score += 10;
        return Math.min(100, score);
    });

    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return Math.round(avg);
}

function calculateCriticalFlags() {
    // Simulate critical flags (sessions with failed status or not approved)
    return filteredSessions.filter(s =>
        s.status === 'failed' || (s.auditStatus !== 'pending' && !s.auditApproved)
    ).length;
}

function calculateQualityRating() {
    const avgPerf = calculateAvgPerformance();
    return (avgPerf / 20).toFixed(1); // Convert to 5-star rating
}

function calculatePerformanceDistribution() {
    const high = filteredSessions.filter(s => {
        const score = getSessionScore(s);
        return score >= 80;
    }).length;

    const medium = filteredSessions.filter(s => {
        const score = getSessionScore(s);
        return score >= 60 && score < 80;
    }).length;

    const low = filteredSessions.filter(s => {
        const score = getSessionScore(s);
        return score < 60;
    }).length;

    return { high, medium, low };
}

function calculatePerformanceTrend() {
    // Simulate 30-day trend data
    const days = 30;
    const trend = [];

    for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];

        // Simulate performance with slight variation
        const basePerf = 75;
        const variation = Math.sin(i / 5) * 10;
        const randomness = (Math.random() - 0.5) * 5;
        const performance = Math.max(60, Math.min(95, basePerf + variation + randomness));

        trend.push({
            date: dateStr,
            performance: Math.round(performance)
        });
    }

    return trend;
}

function calculateFlagDistribution() {
    // Use real report metrics if available
    if (realReportMetrics && realReportMetrics.tutorScores && realReportMetrics.tutorScores.length > 0) {
        let red = 0, yellow = 0, green = 0;
        
        realReportMetrics.tutorScores.forEach(tutor => {
            const score = tutor.overall || 0;
            if (score >= 80) {
                green++;  // Good performance (80-100)
            } else if (score >= 60) {
                yellow++; // Needs improvement (60-79)
            } else {
                red++;    // Critical/Poor (0-59)
            }
        });
        
        return { red, yellow, green };
    }
    
    // Fallback: Calculate from session data
    const red = filteredSessions.filter(s => s.status === 'failed').length;
    const yellow = filteredSessions.filter(s =>
        s.status === 'pending' || s.status === 'downloading'
    ).length;
    const green = filteredSessions.filter(s =>
        s.status === 'completed'
    ).length;

    return { red, yellow, green };
}

function calculateFlagsByCategory() {
    // Simulate flags by category
    const categories = {
        technical: { red: 0, yellow: 0, green: 0 },
        pedagogical: { red: 0, yellow: 0, green: 0 },
        communication: { red: 0, yellow: 0, green: 0 },
        engagement: { red: 0, yellow: 0, green: 0 }
    };

    filteredSessions.forEach(s => {
        if (s.status === 'failed') {
            categories.technical.red++;
        } else if (s.status === 'completed') {
            categories.technical.green++;
            categories.pedagogical.green++;
            if (s.auditApproved) {
                categories.communication.green++;
                categories.engagement.green++;
            } else {
                categories.communication.yellow++;
                categories.engagement.yellow++;
            }
        } else {
            categories.technical.yellow++;
            categories.pedagogical.yellow++;
        }
    });

    return categories;
}

function getTopPerformers(count) {
    const tutorScores = calculateTutorScores();
    return tutorScores
        .sort((a, b) => b.score - a.score)
        .slice(0, count);
}

function getBottomPerformers(count) {
    const tutorScores = calculateTutorScores();
    return tutorScores
        .sort((a, b) => a.score - b.score)
        .slice(0, count);
}

function calculateTutorScores() {
    // Priority: Use real metrics from reports if available
    if (realReportMetrics && realReportMetrics.tutorScores && realReportMetrics.tutorScores.length > 0) {

        // Map real scores to tutors
        // Note: Filtered sessions might be a subset, so we should only include tutors in filteredSessions
        const activeTutorIds = new Set(filteredSessions.map(s => s.tutorId));

        return realReportMetrics.tutorScores
            .filter(t => activeTutorIds.has(t.tutorId))
            .map(t => ({
                tutorId: t.tutorId,
                score: t.overall,
                sessionCount: 1 // In future this could track actual session count from reports
            }));
    }

    // Fallback: Simulated scores
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

function calculateScoreDistribution() {
    const ranges = {
        '0-20': 0,
        '21-40': 0,
        '41-60': 0,
        '61-80': 0,
        '81-100': 0
    };

    filteredSessions.forEach(s => {
        const score = getSessionScore(s);
        if (score <= 20) ranges['0-20']++;
        else if (score <= 40) ranges['21-40']++;
        else if (score <= 60) ranges['41-60']++;
        else if (score <= 80) ranges['61-80']++;
        else ranges['81-100']++;
    });

    return ranges;
}

function calculateScoreDimensions() {
    // Priority: Use real metrics from reports if available
    if (realReportMetrics && realReportMetrics.totalReports > 0) {
        return {
            setup: realReportMetrics.categoryAverages.setup,
            attitude: realReportMetrics.categoryAverages.attitude,
            preparation: realReportMetrics.categoryAverages.preparation,
            curriculum: realReportMetrics.categoryAverages.curriculum,
            teaching: realReportMetrics.categoryAverages.teaching,
            feedback: realReportMetrics.categoryAverages.feedback
        };
    }

    // Simulate multi-dimensional scores (Fallback)
    return {
        engagement: Math.round(calculateAvgPerformance() * 0.95),
        clarity: Math.round(calculateAvgPerformance() * 0.90),
        technical: Math.round(calculateAvgPerformance() * 0.92),
        pedagogy: Math.round(calculateAvgPerformance() * 0.88),
        communication: Math.round(calculateAvgPerformance() * 0.93)
    };
}

function calculateTimeSlotPerformance() {
    const timeSlots = {};

    filteredSessions.forEach(s => {
        if (!timeSlots[s.timeSlot]) {
            timeSlots[s.timeSlot] = {
                count: 0,
                totalScore: 0
            };
        }
        timeSlots[s.timeSlot].count++;
        timeSlots[s.timeSlot].totalScore += getSessionScore(s);
    });

    return Object.entries(timeSlots).map(([slot, data]) => ({
        slot,
        avgScore: Math.round(data.totalScore / data.count),
        count: data.count
    }));
}

function getSessionScore(session) {
    let score = 70;
    if (session.status === 'completed') score += 20;
    if (session.auditApproved) score += 10;
    if (session.status === 'failed') score = 30;
    return Math.min(100, score);
}

// ===== Update UI Components =====
function updateKPICards() {
    // Update main KPIs
    document.getElementById('totalTutors').textContent = biMetrics.totalTutors;
    document.getElementById('avgPerformance').textContent = biMetrics.avgPerformance;
    
    // Update total reports
    const totalReportsEl = document.getElementById('totalReports');
    if (totalReportsEl) {
        totalReportsEl.textContent = realReportMetrics?.totalReports || 0;
    }
    
    // Update quality rating (convert to 5-star scale)
    const qualityRatingEl = document.getElementById('qualityRating');
    if (qualityRatingEl) {
        const rating = (biMetrics.avgPerformance / 20).toFixed(1);
        qualityRatingEl.innerHTML = `${rating}<span style="font-size: 1rem; opacity: 0.7;">/5</span>`;
    }
    
    // Update last updated timestamp
    const lastUpdatedEl = document.getElementById('lastUpdated');
    if (lastUpdatedEl) {
        lastUpdatedEl.textContent = `Last updated: ${new Date().toLocaleString()}`;
    }
    
    // Update SAPTCF scores if we have real data
    updateSAPTCFScores();
    
    // Update data source badges
    updateDataSourceBadges();
}

function updateSAPTCFScores() {
    if (realReportMetrics && realReportMetrics.categoryAverages) {
        const cat = realReportMetrics.categoryAverages;
        
        const setScore = (id, value) => {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = value > 0 ? value : '--';
                // Add color based on score
                if (value >= 80) el.style.color = '#27ae60';
                else if (value >= 60) el.style.color = '#f58220';
                else if (value > 0) el.style.color = '#e74c3c';
            }
        };
        
        setScore('scoreSetup', cat.setup || 0);
        setScore('scoreAttitude', cat.attitude || 0);
        setScore('scorePreparation', cat.preparation || 0);
        setScore('scoreTeaching', cat.teaching || 0);
        setScore('scoreCurriculum', cat.curriculum || 0);
        setScore('scoreFeedback', cat.feedback || 0);
    }
}

function updateDataSourceBadges() {
    const hasRealData = realReportMetrics && realReportMetrics.totalReports > 0;
    
    const performanceBadge = document.getElementById('performanceBadge');
    if (performanceBadge) {
        if (hasRealData) {
            performanceBadge.className = 'data-source-badge real';
            performanceBadge.textContent = '✓ From Reports';
        } else {
            performanceBadge.className = 'data-source-badge calculated';
            performanceBadge.textContent = '📊 Calculated';
        }
    }
}

function updateRankings() {
    // Top performers
    const topContainer = document.getElementById('topPerformers');
    if (topContainer && biMetrics.topPerformers) {
        if (biMetrics.topPerformers.length === 0) {
            topContainer.innerHTML = '<p style="color: #888; font-style: italic;">No data available</p>';
        } else {
            topContainer.innerHTML = biMetrics.topPerformers.map((tutor, index) => `
                <div class="ranking-item">
                    <div class="ranking-number top">${index + 1}</div>
                    <div class="ranking-info">
                        <h4>${tutor.tutorId}</h4>
                        <p>${tutor.sessionCount} sessions</p>
                    </div>
                    <div class="ranking-score">${tutor.score}</div>
                </div>
            `).join('');
        }
    }

    // Bottom performers
    const bottomContainer = document.getElementById('bottomPerformers');
    if (bottomContainer && biMetrics.bottomPerformers) {
        if (biMetrics.bottomPerformers.length === 0) {
            bottomContainer.innerHTML = '<p style="color: #888; font-style: italic;">No data available</p>';
        } else {
            bottomContainer.innerHTML = biMetrics.bottomPerformers.map((tutor, index) => `
                <div class="ranking-item">
                    <div class="ranking-number bottom">${index + 1}</div>
                    <div class="ranking-info">
                        <h4>${tutor.tutorId}</h4>
                        <p>${tutor.sessionCount} sessions</p>
                    </div>
                    <div class="ranking-score">${tutor.score}</div>
                </div>
            `).join('');
        }
    }
}

// ===== Chart Generation =====
function updateAllCharts() {
    createPerformanceDistChart();
    createPerformanceTrendChart();
    createFlagDistChart();
    createFlagCategoryChart();
    createScoreDistChart();
    createScoreDimensionsChart();
    createTimeSlotChart();
    createHeatmap();
}

function createPerformanceDistChart() {
    const ctx = document.getElementById('performanceDistChart');
    if (!ctx) return;

    const dist = biMetrics.performanceDistribution;

    if (performanceDistChart) {
        performanceDistChart.destroy();
    }

    performanceDistChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['High (80-100)', 'Medium (60-79)', 'Low (0-59)'],
            datasets: [{
                data: [dist.high, dist.medium, dist.low],
                backgroundColor: ['#2ecc71', '#F59E0B', '#EF4444'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        font: { size: 12, family: 'Poppins' }
                    }
                }
            }
        }
    });
}

function createPerformanceTrendChart() {
    const ctx = document.getElementById('performanceTrendChart');
    if (!ctx) return;

    const trend = biMetrics.performanceTrend;

    if (performanceTrendChart) {
        performanceTrendChart.destroy();
    }

    performanceTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: trend.map(t => new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
            datasets: [{
                label: 'Performance Score',
                data: trend.map(t => t.performance),
                borderColor: '#007bff',
                backgroundColor: 'rgba(0, 123, 255, 0.1)',
                borderWidth: 3,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    min: 50,
                    max: 100
                }
            }
        }
    });
}

function createFlagDistChart() {
    const ctx = document.getElementById('flagDistChart');
    if (!ctx) return;

    const flags = biMetrics.flagDistribution;
    const total = flags.red + flags.yellow + flags.green;

    if (flagDistChart) {
        flagDistChart.destroy();
    }

    flagDistChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['Critical (<60%)', 'Needs Improvement (60-79%)', 'Good (≥80%)'],
            datasets: [{
                data: [flags.red, flags.yellow, flags.green],
                backgroundColor: ['#EF4444', '#F59E0B', '#2ecc71'],
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        font: { size: 11, family: 'Inter' },
                        usePointStyle: true
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                            return `${context.label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
}

function createFlagCategoryChart() {
    const ctx = document.getElementById('flagCategoryChart');
    if (!ctx) return;

    const categories = biMetrics.flagsByCategory;

    if (flagCategoryChart) {
        flagCategoryChart.destroy();
    }

    flagCategoryChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(categories),
            datasets: [
                {
                    label: 'Critical',
                    data: Object.values(categories).map(c => c.red),
                    backgroundColor: '#EF4444',
                    borderRadius: 8
                },
                {
                    label: 'Warning',
                    data: Object.values(categories).map(c => c.yellow),
                    backgroundColor: '#F59E0B',
                    borderRadius: 8
                },
                {
                    label: 'Good',
                    data: Object.values(categories).map(c => c.green),
                    backgroundColor: '#2ecc71',
                    borderRadius: 8
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        font: { size: 12, family: 'Poppins' }
                    }
                }
            },
            scales: {
                x: { stacked: true },
                y: { stacked: true, beginAtZero: true }
            }
        }
    });
}

function createScoreDistChart() {
    const ctx = document.getElementById('scoreDistChart');
    if (!ctx) return;

    const dist = biMetrics.scoreDistribution;

    if (scoreDistChart) {
        scoreDistChart.destroy();
    }

    scoreDistChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Object.keys(dist),
            datasets: [{
                label: 'Number of Sessions',
                data: Object.values(dist),
                backgroundColor: '#007bff',
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

function createScoreDimensionsChart() {
    const ctx = document.getElementById('scoreDimensionsChart');
    if (!ctx) return;

    const dimensions = biMetrics.scoreDimensions;

    if (scoreDimensionsChart) {
        scoreDimensionsChart.destroy();
    }

    // Use SAPTCF labels if real data available
    let labels, data;
    if (dimensions.setup !== undefined) {
        // Real SAPTCF data
        labels = ['Setup', 'Attitude', 'Preparation', 'Curriculum', 'Teaching', 'Feedback'];
        data = [dimensions.setup, dimensions.attitude, dimensions.preparation, dimensions.curriculum, dimensions.teaching, dimensions.feedback];
    } else {
        // Fallback simulated data
        labels = Object.keys(dimensions).map(k => k.charAt(0).toUpperCase() + k.slice(1));
        data = Object.values(dimensions);
    }

    scoreDimensionsChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: labels,
            datasets: [{
                label: 'SAPTCF Scores',
                data: data,
                backgroundColor: 'rgba(245, 130, 32, 0.2)',
                borderColor: '#f58220',
                borderWidth: 2,
                pointBackgroundColor: '#f58220',
                pointBorderColor: '#fff',
                pointRadius: 5,
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: '#f58220'
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
                        stepSize: 20,
                        font: { family: 'Inter', size: 10 }
                    },
                    pointLabels: {
                        font: { family: 'Inter', size: 12, weight: '600' }
                    }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function createTimeSlotChart() {
    const ctx = document.getElementById('timeSlotChart');
    if (!ctx) return;

    const timeSlots = biMetrics.timeSlotPerformance;

    if (timeSlotChart) {
        timeSlotChart.destroy();
    }

    timeSlotChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: timeSlots.map(t => t.slot),
            datasets: [{
                label: 'Average Performance',
                data: timeSlots.map(t => t.avgScore),
                backgroundColor: '#f58220',
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { beginAtZero: true, max: 100 }
            }
        }
    });
}

function createHeatmap() {
    const container = document.getElementById('heatmapContainer');
    if (!container) return;

    container.innerHTML = '';

    // Create simple heatmap visualization
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const hours = 24;

    const heatmapHTML = `
        <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; width: 100%;">
            ${days.map(day => `
                <div style="text-align: center; font-weight: 600; color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 0.5rem;">
                    ${day}
                </div>
            `).join('')}
            ${Array.from({ length: 7 * 6 }, (_, i) => {
        const intensity = Math.random();
        const colorClass = intensity > 0.75 ? 'very-high' :
            intensity > 0.5 ? 'high' :
                intensity > 0.25 ? 'medium' : 'low';
        return `<div class="heatmap-cell ${colorClass}" style="height: 40px;" title="Performance: ${Math.round(intensity * 100)}%"></div>`;
    }).join('')}
        </div>
    `;

    container.innerHTML = heatmapHTML;
}

// ===== Filtering =====
function populateTutorFilters() {
    const tutorFilter = document.getElementById('tutorFilter');
    const tutor1Select = document.getElementById('tutor1Select');
    const tutor2Select = document.getElementById('tutor2Select');

    if (!allSessions || allSessions.length === 0) return;

    const uniqueTutors = [...new Set(allSessions.map(s => s.tutorId))].sort();
    const options = uniqueTutors.map(t => `<option value="${t}">${t}</option>`).join('');

    if (tutorFilter) tutorFilter.innerHTML += options;
    if (tutor1Select) tutor1Select.innerHTML += options;
    if (tutor2Select) tutor2Select.innerHTML += options;
}

function applyFilters() {
    const dateRange = document.getElementById('dateRangeFilter').value;
    const tutor = document.getElementById('tutorFilter').value;
    const performance = document.getElementById('performanceFilter').value;

    filteredSessions = allSessions.filter(s => {
        // Tutor filter
        if (tutor !== 'all' && s.tutorId !== tutor) return false;

        // Performance filter
        if (performance !== 'all') {
            const score = getSessionScore(s);
            if (performance === 'high' && score < 80) return false;
            if (performance === 'medium' && (score < 60 || score >= 80)) return false;
            if (performance === 'low' && score >= 60) return false;
        }

        return true;
    });

    processData();
    updateAllCharts();
}

function resetFilters() {
    document.getElementById('dateRangeFilter').value = 'month';
    document.getElementById('tutorFilter').value = 'all';
    document.getElementById('performanceFilter').value = 'all';
    applyFilters();
}

// ===== Tutor Comparison =====
function compareTutors() {
    const tutor1Id = document.getElementById('tutor1Select').value;
    const tutor2Id = document.getElementById('tutor2Select').value;

    if (!tutor1Id || !tutor2Id) {
        alert('Please select both tutors to compare');
        return;
    }

    const tutor1Sessions = allSessions.filter(s => s.tutorId === tutor1Id);
    const tutor2Sessions = allSessions.filter(s => s.tutorId === tutor2Id);

    const tutor1Score = tutor1Sessions.reduce((sum, s) => sum + getSessionScore(s), 0) / tutor1Sessions.length;
    const tutor2Score = tutor2Sessions.reduce((sum, s) => sum + getSessionScore(s), 0) / tutor2Sessions.length;

    createComparisonChart(tutor1Id, tutor2Id, tutor1Score, tutor2Score);
}

function createComparisonChart(tutor1Id, tutor2Id, score1, score2) {
    const ctx = document.getElementById('comparisonRadarChart');
    if (!ctx) return;

    if (comparisonRadarChart) {
        comparisonRadarChart.destroy();
    }

    // Simulate multi-dimensional comparison
    const dimensions = ['Engagement', 'Clarity', 'Technical', 'Pedagogy', 'Communication'];

    comparisonRadarChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: dimensions,
            datasets: [
                {
                    label: tutor1Id,
                    data: dimensions.map(() => score1 + (Math.random() - 0.5) * 10),
                    backgroundColor: 'rgba(0, 123, 255, 0.2)',
                    borderColor: '#007bff',
                    borderWidth: 2
                },
                {
                    label: tutor2Id,
                    data: dimensions.map(() => score2 + (Math.random() - 0.5) * 10),
                    backgroundColor: 'rgba(245, 130, 32, 0.2)',
                    borderColor: '#f58220',
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                r: {
                    beginAtZero: true,
                    max: 100
                }
            }
        }
    });
}

// ===== Export Report =====
function exportReport() {
    alert('Export functionality will generate a PDF report with all BI metrics and charts. This feature is coming soon!');
}

// ===== Loading States =====
function showLoading() {
    let overlay = document.getElementById('loadingOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.id = 'loadingOverlay';
        overlay.innerHTML = '<div class="loading-spinner"></div><p>Loading Analytics...</p>';
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

function showEmptyState() {
    document.querySelector('.container').innerHTML = `
        <div class="empty-state-bi">
            <svg width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 3h18v18H3z"></path>
                <path d="M3 9h18"></path>
                <path d="M9 21V9"></path>
            </svg>
            <h3>No Data Available</h3>
            <p>Upload session data from the main dashboard to view BI insights.</p>
            <button class="btn btn-primary" onclick="window.location.href='index.html'" style="margin-top: 1rem;">
                Go to Main Dashboard
            </button>
        </div>
    `;
}

// ===== Event Listeners =====
document.addEventListener('DOMContentLoaded', () => {
    initializeBIDashboard();

    document.getElementById('applyFiltersBtn')?.addEventListener('click', applyFilters);
    document.getElementById('resetFiltersBtn')?.addEventListener('click', resetFilters);
    document.getElementById('compareBtn')?.addEventListener('click', compareTutors);
    document.getElementById('exportReportBtn')?.addEventListener('click', exportReport);
});
