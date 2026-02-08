// BI Analytics Engine for iSchool Dashboard
// Handles data aggregation, metrics calculation, and chart generation

// Use configurable API base URL (works when frontend is hosted separately)
const BI_API_BASE = (() => {
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
        attachFilterListeners();

        hideLoading();
    } catch (error) {
        console.error('Error initializing BI dashboard:', error);
        hideLoading();
        showEmptyState();
    }
}

// ===== Filter Management =====
function attachFilterListeners() {
    const dateFilter = document.getElementById('dateRangeFilter');
    const tutorFilter = document.getElementById('tutorFilter');
    const performanceFilter = document.getElementById('performanceFilter');
    const statusFilter = document.getElementById('statusFilter');

    if (dateFilter) dateFilter.addEventListener('change', applyFilters);
    if (tutorFilter) tutorFilter.addEventListener('change', applyFilters);
    if (performanceFilter) performanceFilter.addEventListener('change', applyFilters);
    if (statusFilter) statusFilter.addEventListener('change', applyFilters);
}

function applyFilters() {
    filteredSessions = [...allSessions];

    // Date Range Filter
    const dateRange = document.getElementById('dateRangeFilter')?.value;
    if (dateRange && dateRange !== 'all') {
        const now = new Date();
        const cutoffDate = new Date();
        
        switch (dateRange) {
            case 'today':
                cutoffDate.setHours(0, 0, 0, 0);
                break;
            case 'week':
                cutoffDate.setDate(now.getDate() - 7);
                break;
            case 'month':
                cutoffDate.setDate(now.getDate() - 30);
                break;
            case 'quarter':
                cutoffDate.setDate(now.getDate() - 90);
                break;
        }
        
        filteredSessions = filteredSessions.filter(s => {
            const sessionDate = new Date(s.dateTime || s.createdAt || now);
            return sessionDate >= cutoffDate;
        });
    }

    // Tutor Filter
    const tutorId = document.getElementById('tutorFilter')?.value;
    if (tutorId && tutorId !== 'all') {
        filteredSessions = filteredSessions.filter(s => s.tutorId === tutorId);
    }

    // Performance Filter
    const performanceLevel = document.getElementById('performanceFilter')?.value;
    if (performanceLevel && performanceLevel !== 'all') {
        filteredSessions = filteredSessions.filter(s => {
            const score = s.aiScore || 0;
            switch (performanceLevel) {
                case 'high': return score >= 80;
                case 'medium': return score >= 60 && score < 80;
                case 'low': return score < 60;
                default: return true;
            }
        });
    }

    // Status Filter
    const status = document.getElementById('statusFilter')?.value;
    if (status && status !== 'all') {
        filteredSessions = filteredSessions.filter(s => s.status === status);
    }

    // Reprocess and update
    processData();
    updateAllCharts();
    displayInsights();
    
    showNotification(`Filters applied: ${filteredSessions.length} sessions found`, 'success');
}

function resetFilters() {
    // Reset all filter dropdowns
    ['dateRangeFilter', 'tutorFilter', 'performanceFilter', 'statusFilter'].forEach(id => {
        const filter = document.getElementById(id);
        if (filter) filter.selectedIndex = 0;
    });
    
    // Reapply with defaults
    applyFilters();
    showNotification('Filters reset', 'info');
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
        timeSlotPerformance: calculateTimeSlotPerformance(),
        humanVsAI: calculateHumanVsAIComparison()
    };

    updateKPICards();
    updateRankings();
    displayInsights();
    displayHumanVsAIComparison();
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

    // Use real metrics if available
    if (realReportMetrics && realReportMetrics.tutorScores && realReportMetrics.tutorScores.length > 0) {
        const activeTutorIds = new Set(filteredSessions.map(s => s.tutorId));
        realReportMetrics.tutorScores
            .filter(t => activeTutorIds.has(t.tutorId))
            .forEach(t => {
                const score = t.overall || 0;
                if (score <= 20) ranges['0-20']++;
                else if (score <= 40) ranges['21-40']++;
                else if (score <= 60) ranges['41-60']++;
                else if (score <= 80) ranges['61-80']++;
                else ranges['81-100']++;
            });
        return ranges;
    }

    // Fallback to simulated scores
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
        if (!s.timeSlot) return; // Skip if no time slot
        
        if (!timeSlots[s.timeSlot]) {
            timeSlots[s.timeSlot] = {
                count: 0,
                totalScore: 0
            };
        }
        timeSlots[s.timeSlot].count++;
        
        // Use AI score if available, otherwise use simulated score
        const score = s.aiScore || getSessionScore(s);
        timeSlots[s.timeSlot].totalScore += score;
    });

    return Object.entries(timeSlots)
        .map(([slot, data]) => ({
            slot,
            avgScore: Math.round(data.totalScore / data.count),
            count: data.count
        }))
        .sort((a, b) => {
            // Sort by slot number (assuming format like "Slot 1", "Slot 2")
            const slotA = parseInt(a.slot.replace(/[^0-9]/g, '')) || 0;
            const slotB = parseInt(b.slot.replace(/[^0-9]/g, '')) || 0;
            return slotA - slotB;
        });
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
        const hasHumanScores = realReportMetrics.humanCategoryAverages && 
                              realReportMetrics.totalHumanReports > 0;
        
        const categories = [
            { key: 'setup', id: 'scoreSetup' },
            { key: 'attitude', id: 'scoreAttitude' },
            { key: 'preparation', id: 'scorePreparation' },
            { key: 'teaching', id: 'scoreTeaching' },
            { key: 'curriculum', id: 'scoreCurriculum' },
            { key: 'feedback', id: 'scoreFeedback' }
        ];

        categories.forEach(({ key, id }) => {
            const el = document.getElementById(id);
            if (el) {
                const aiScore = cat[key] || 0;
                const humanScore = hasHumanScores ? (realReportMetrics.humanCategoryAverages[key] || 0) : null;
                
                if (hasHumanScores && humanScore !== null && humanScore > 0) {
                    const diff = aiScore - humanScore;
                    const diffColor = Math.abs(diff) <= 5 ? '#27ae60' : Math.abs(diff) <= 10 ? '#f39c12' : '#e74c3c';
                    const diffIcon = diff > 0 ? '▲' : diff < 0 ? '▼' : '●';
                    
                    el.innerHTML = `
                        <div style="display: flex; flex-direction: column; gap: 0.35rem; width: 100%;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="display: flex; align-items: center; gap: 0.35rem;">
                                    <span style="color: #f5576c; font-weight: bold; font-size: 1rem;">🤖</span>
                                    <span style="color: #1a1a2e; font-weight: 600;">${aiScore}</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 0.35rem;">
                                    <span style="color: #4facfe; font-weight: bold; font-size: 1rem;">👤</span>
                                    <span style="color: #1a1a2e; font-weight: 600;">${humanScore}</span>
                                </div>
                            </div>
                            <div style="height: 4px; background: #e0e0e0; border-radius: 2px; overflow: hidden; position: relative;">
                                <div style="position: absolute; left: 0; top: 0; height: 100%; background: linear-gradient(90deg, #f5576c 50%, #4facfe 50%); width: ${Math.max(aiScore, humanScore)}%; transition: width 0.3s;"></div>
                            </div>
                            <div style="text-align: center; font-size: 0.7rem; color: ${diffColor}; font-weight: 600;">
                                ${diffIcon} ${Math.abs(diff)}
                            </div>
                        </div>
                    `;
                } else {
                    el.textContent = aiScore > 0 ? aiScore : '--';
                    if (aiScore >= 80) el.style.color = '#27ae60';
                    else if (aiScore >= 60) el.style.color = '#f58220';
                    else if (aiScore > 0) el.style.color = '#e74c3c';
                }
            }
        });

        // Update section header
        const saptcfTitle = document.querySelector('.saptcf-section .section-title');
        if (saptcfTitle && hasHumanScores) {
            const originalText = saptcfTitle.textContent.replace(' (AI 🤖 vs Human 👤)', '');
            saptcfTitle.textContent = originalText + ' (AI 🤖 vs Human 👤)';
        }
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
    showNotification('Generating comprehensive BI report...', 'info');
    
    try {
        // Generate CSV data
        const csvData = generateCSVReport();
        downloadCSV(csvData, `BI_Report_${new Date().toISOString().split('T')[0]}.csv`);
        
        // Generate HTML report
        generateHTMLReport();
        
        showNotification('Reports exported successfully!', 'success');
    } catch (error) {
        console.error('Export error:', error);
        showNotification('Error exporting report', 'error');
    }
}

function generateCSVReport() {
    const rows = [];
    
    // Header
    rows.push(['iSchool BI Analytics Report']);
    rows.push([`Generated: ${new Date().toLocaleString()}`]);
    rows.push(['']);
    
    // KPI Summary
    rows.push(['KEY METRICS']);
    rows.push(['Total Tutors', biMetrics.totalTutors]);
    rows.push(['Average Performance', biMetrics.avgPerformance + '%']);
    rows.push(['Critical Flags', biMetrics.criticalFlags]);
    rows.push(['Quality Rating', biMetrics.qualityRating + '%']);
    rows.push(['']);
    
    // Human vs AI Comparison
    if (biMetrics.humanVsAI && biMetrics.humanVsAI.totalCompared > 0) {
        rows.push(['HUMAN VS AI COMPARISON']);
        rows.push(['Sessions Compared', biMetrics.humanVsAI.totalCompared]);
        rows.push(['Agreement Rate', biMetrics.humanVsAI.agreement + '%']);
        rows.push(['Average AI Score', biMetrics.humanVsAI.avgAIScore + '%']);
        rows.push(['Average Human Score', biMetrics.humanVsAI.avgHumanScore + '%']);
        rows.push(['AI Scored Higher', biMetrics.humanVsAI.aiHigher]);
        rows.push(['Human Scored Higher', biMetrics.humanVsAI.humanHigher]);
        rows.push(['Closely Matched', biMetrics.humanVsAI.matched]);
        rows.push(['']);
    }
    
    // SAPTCF Scores
    if (realReportMetrics && realReportMetrics.categoryAverages) {
        rows.push(['SAPTCF CATEGORY SCORES']);
        rows.push(['Setup', realReportMetrics.categoryAverages.setup]);
        rows.push(['Attitude', realReportMetrics.categoryAverages.attitude]);
        rows.push(['Preparation', realReportMetrics.categoryAverages.preparation]);
        rows.push(['Teaching', realReportMetrics.categoryAverages.teaching]);
        rows.push(['Curriculum', realReportMetrics.categoryAverages.curriculum]);
        rows.push(['Feedback', realReportMetrics.categoryAverages.feedback]);
        rows.push(['']);
    }
    
    // Top Performers
    rows.push(['TOP PERFORMERS']);
    rows.push(['Rank', 'Tutor ID', 'Score', 'Sessions']);
    biMetrics.topPerformers.forEach((t, i) => {
        rows.push([i + 1, t.tutorId, t.score, t.sessionCount]);
    });
    rows.push(['']);
    
    // Bottom Performers
    rows.push(['NEEDS IMPROVEMENT']);
    rows.push(['Rank', 'Tutor ID', 'Score', 'Sessions']);
    biMetrics.bottomPerformers.forEach((t, i) => {
        rows.push([i + 1, t.tutorId, t.score, t.sessionCount]);
    });
    
    return rows.map(row => row.join(',')).join('\\n');
}

function downloadCSV(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

function generateHTMLReport() {
    const reportWindow = window.open('', '_blank');
    
    const hasHumanData = biMetrics.humanVsAI && biMetrics.humanVsAI.totalCompared > 0;
    const hasHumanCategories = realReportMetrics && realReportMetrics.humanCategoryAverages && realReportMetrics.totalHumanReports > 0;
    
    reportWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>BI Analytics Report - ${new Date().toLocaleDateString()}</title>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
            <style>
                body { font-family: Arial, sans-serif; padding: 40px; max-width: 1200px; margin: 0 auto; background: #f5f7fa; }
                h1 { color: #1a1a2e; border-bottom: 3px solid #f58220; padding-bottom: 10px; margin-bottom: 20px; }
                h2 { color: #1a1a2e; margin-top: 30px; padding: 10px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px; }
                .metric { display: inline-block; margin: 15px; padding: 20px; background: white; border-radius: 12px; min-width: 150px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-align: center; }
                .metric .value { font-size: 2.5rem; font-weight: bold; color: #f58220; margin-bottom: 8px; }
                .metric .label { color: #666; font-size: 0.95rem; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
                th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
                th { background: #1a1a2e; color: white; font-weight: 600; }
                tr:hover { background: #f5f7fa; }
                .action-buttons { margin: 20px 0; display: flex; gap: 10px; }
                .print-btn { background: #f58220; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 1rem; font-weight: 600; box-shadow: 0 2px 8px rgba(245, 130, 32, 0.3); }
                .print-btn:hover { background: #e67310; }
                .pdf-btn { background: #667eea; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-size: 1rem; font-weight: 600; box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3); }
                .pdf-btn:hover { background: #5568d3; }
                .comparison-box { background: linear-gradient(135deg, #e0e7ff 0%, #f0f4ff 100%); padding: 20px; border-radius: 12px; margin: 20px 0; border-left: 4px solid #667eea; }
                .category-comparison { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
                .category-item { background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                .category-item h3 { margin: 0 0 10px 0; color: #1a1a2e; font-size: 1rem; }
                .score-row { display: flex; justify-content: space-between; margin: 8px 0; }
                .score-row .ai { color: #f5576c; font-weight: bold; }
                .score-row .human { color: #4facfe; font-weight: bold; }
                .diff { text-align: center; margin-top: 10px; padding-top: 10px; border-top: 1px solid #ddd; font-weight: 600; }
                .diff.good { color: #27ae60; }
                .diff.moderate { color: #f39c12; }
                .diff.poor { color: #e74c3c; }
                #pdf-loader { display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 30px 50px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 10000; }
                #pdf-loader.active { display: block; }
                @media print {
                    .action-buttons { display: none; }
                    body { background: white; }
                }
            </style>
            <script>
                function exportToPDF() {
                    const loader = document.getElementById('pdf-loader');
                    loader.classList.add('active');
                    
                    const element = document.getElementById('report-content');
                    const opt = {
                        margin: 10,
                        filename: 'BI_Analytics_Report_${new Date().toISOString().split('T')[0]}.pdf',
                        image: { type: 'jpeg', quality: 0.98 },
                        html2canvas: { scale: 2, useCORS: true },
                        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
                    };
                    
                    html2pdf().set(opt).from(element).save().then(() => {
                        loader.classList.remove('active');
                    }).catch((err) => {
                        console.error('PDF generation error:', err);
                        loader.classList.remove('active');
                        alert('Error generating PDF. Please try Print instead.');
                    });
                }
            </script>
        </head>
        <body>
            <div id="pdf-loader">
                <p style="margin: 0; font-size: 1.1rem; color: #1a1a2e; font-weight: 600;">📄 Generating PDF...</p>
                <p style="margin: 10px 0 0 0; font-size: 0.9rem; color: #666;">Please wait</p>
            </div>
            
            <div id="report-content">
                <h1>📊 iSchool BI Analytics Report</h1>
                <p style="color: #666; margin-bottom: 20px;">Generated: ${new Date().toLocaleString()}</p>
                <div class="action-buttons">
                    <button class="pdf-btn" onclick="exportToPDF()">📄 Export to PDF</button>
                    <button class="print-btn" onclick="window.print()">🖨️ Print Report</button>
                </div>
            
            <h2>Key Performance Indicators</h2>
            <div>
                <div class="metric"><div class="value">${biMetrics.totalTutors}</div><div class="label">Total Tutors</div></div>
                <div class="metric"><div class="value">${biMetrics.avgPerformance}%</div><div class="label">Avg Performance</div></div>
                <div class="metric"><div class="value">${biMetrics.criticalFlags}</div><div class="label">Critical Flags</div></div>
                <div class="metric"><div class="value">${biMetrics.qualityRating}%</div><div class="label">Quality Rating</div></div>
            </div>
            
            ${hasHumanData ? `
            <h2>🤖 Human vs AI Comparison</h2>
            <div class="comparison-box">
                <div style="display: flex; justify-content: space-around; flex-wrap: wrap;">
                    <div class="metric" style="margin: 10px;"><div class="value">${biMetrics.humanVsAI.totalCompared}</div><div class="label">Sessions Compared</div></div>
                    <div class="metric" style="margin: 10px;"><div class="value">${biMetrics.humanVsAI.agreement}%</div><div class="label">Agreement Rate</div></div>
                    <div class="metric" style="margin: 10px;"><div class="value">${biMetrics.humanVsAI.avgAIScore}%</div><div class="label">Avg AI Score</div></div>
                    <div class="metric" style="margin: 10px;"><div class="value">${biMetrics.humanVsAI.avgHumanScore}%</div><div class="label">Avg Human Score</div></div>
                </div>
                <table style="margin-top: 20px;">
                    <tr><th>Metric</th><th>Count</th><th>Percentage</th></tr>
                    <tr><td>Closely Matched (±10%)</td><td>${biMetrics.humanVsAI.matched}</td><td>${Math.round((biMetrics.humanVsAI.matched/biMetrics.humanVsAI.totalCompared)*100)}%</td></tr>
                    <tr><td>AI Scored Higher</td><td>${biMetrics.humanVsAI.aiHigher}</td><td>${Math.round((biMetrics.humanVsAI.aiHigher/biMetrics.humanVsAI.totalCompared)*100)}%</td></tr>
                    <tr><td>Human Scored Higher</td><td>${biMetrics.humanVsAI.humanHigher}</td><td>${Math.round((biMetrics.humanVsAI.humanHigher/biMetrics.humanVsAI.totalCompared)*100)}%</td></tr>
                </table>
            </div>
            ` : ''}
            
            <h2>SAPTCF Category Scores ${hasHumanCategories ? '(AI 🤖 vs Human 👤)' : ''}</h2>
            ${hasHumanCategories ? `
            <div class="category-comparison">
                ${['setup', 'attitude', 'preparation', 'teaching', 'curriculum', 'feedback'].map(cat => {
                    const aiScore = realReportMetrics.categoryAverages[cat];
                    const humanScore = realReportMetrics.humanCategoryAverages[cat];
                    const diff = Math.abs(aiScore - humanScore);
                    const diffClass = diff <= 5 ? 'good' : diff <= 10 ? 'moderate' : 'poor';
                    const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
                    return `
                        <div class="category-item">
                            <h3>${catLabel}</h3>
                            <div class="score-row">
                                <span>🤖 AI:</span>
                                <span class="ai">${aiScore}%</span>
                            </div>
                            <div class="score-row">
                                <span>👤 Human:</span>
                                <span class="human">${humanScore}%</span>
                            </div>
                            <div class="diff ${diffClass}">Δ ${diff}%</div>
                        </div>
                    `;
                }).join('')}
            </div>
            ` : `
            <table>
                <tr><th>Category</th><th>Score</th></tr>
                <tr><td>Setup</td><td>${realReportMetrics?.categoryAverages.setup || 'N/A'}</td></tr>
                <tr><td>Attitude</td><td>${realReportMetrics?.categoryAverages.attitude || 'N/A'}</td></tr>
                <tr><td>Preparation</td><td>${realReportMetrics?.categoryAverages.preparation || 'N/A'}</td></tr>
                <tr><td>Teaching</td><td>${realReportMetrics?.categoryAverages.teaching || 'N/A'}</td></tr>
                <tr><td>Curriculum</td><td>${realReportMetrics?.categoryAverages.curriculum || 'N/A'}</td></tr>
                <tr><td>Feedback</td><td>${realReportMetrics?.categoryAverages.feedback || 'N/A'}</td></tr>
            </table>
            `}
            
            <h2>Top Performers</h2>
            <table>
                <tr><th>Rank</th><th>Tutor ID</th><th>Score</th><th>Sessions</th></tr>
                ${biMetrics.topPerformers.map((t, i) => `<tr><td>${i + 1}</td><td>${t.tutorId}</td><td>${t.score}%</td><td>${t.sessionCount}</td></tr>`).join('')}
            </table>
            
            <h2>Needs Improvement</h2>
            <table>
                <tr><th>Rank</th><th>Tutor ID</th><th>Score</th><th>Sessions</th></tr>
                ${biMetrics.bottomPerformers.map((t, i) => `<tr><td>${i + 1}</td><td>${t.tutorId}</td><td>${t.score}%</td><td>${t.sessionCount}</td></tr>`).join('')}
            </table>
            
            <div style="margin-top: 40px; padding: 20px; background: #f8f9fa; border-radius: 8px; text-align: center; color: #666;">
                <p style="margin: 0;">Report generated by iSchool AI Quality System</p>
                <p style="margin: 5px 0 0 0; font-size: 0.9rem;">Powered by Gemini 3.0 Flash Analysis</p>
            </div>
            </div>
        </body>
        </html>
    `);
}

// ===== Human vs AI Comparison =====
function calculateHumanVsAIComparison() {
    // Only compare sessions with actual human scores (not audit approval)
    const sessionsWithBoth = filteredSessions.filter(s => 
        s.aiScore && s.humanScore && typeof s.humanScore === 'number'
    );

    if (sessionsWithBoth.length === 0) {
        return {
            totalCompared: 0,
            totalAvailable: filteredSessions.length,
            withAIScore: filteredSessions.filter(s => s.aiScore).length,
            withHumanScore: filteredSessions.filter(s => s.humanScore).length,
            agreement: 0,
            disagreement: 0,
            avgAIScore: 0,
            avgHumanScore: 0,
            aiHigher: 0,
            humanHigher: 0,
            matched: 0,
            scoreDiff: 0,
            categories: null
        };
    }

    let agreement = 0;
    let aiScoreSum = 0;
    let humanScoreSum = 0;
    let aiHigher = 0;
    let humanHigher = 0;
    let matched = 0;
    let diffSum = 0;

    // Category-level comparison
    const categoryComparison = {
        setup: { ai: [], human: [], diff: [] },
        attitude: { ai: [], human: [], diff: [] },
        preparation: { ai: [], human: [], diff: [] },
        teaching: { ai: [], human: [], diff: [] },
        curriculum: { ai: [], human: [], diff: [] },
        feedback: { ai: [], human: [], diff: [] }
    };

    sessionsWithBoth.forEach(session => {
        const aiScore = session.aiScore || 0;
        const humanScore = session.humanScore || 0;
        
        aiScoreSum += aiScore;
        humanScoreSum += humanScore;
        
        const diff = Math.abs(aiScore - humanScore);
        diffSum += diff;
        
        if (diff <= 10) {
            agreement++;
            matched++;
        }
        
        if (aiScore > humanScore + 10) aiHigher++;
        if (humanScore > aiScore + 10) humanHigher++;

        // Collect category scores if available
        if (session.categoryScores) {
            Object.keys(categoryComparison).forEach(cat => {
                if (session.categoryScores.ai && session.categoryScores.ai[cat]) {
                    categoryComparison[cat].ai.push(session.categoryScores.ai[cat]);
                }
                if (session.categoryScores.human && session.categoryScores.human[cat]) {
                    categoryComparison[cat].human.push(session.categoryScores.human[cat]);
                    const catDiff = Math.abs(
                        (session.categoryScores.ai[cat] || 0) - 
                        (session.categoryScores.human[cat] || 0)
                    );
                    categoryComparison[cat].diff.push(catDiff);
                }
            });
        }
    });

    // Calculate category averages
    const categories = {};
    Object.keys(categoryComparison).forEach(cat => {
        if (categoryComparison[cat].ai.length > 0 && categoryComparison[cat].human.length > 0) {
            categories[cat] = {
                avgAI: Math.round(categoryComparison[cat].ai.reduce((a,b) => a+b, 0) / categoryComparison[cat].ai.length),
                avgHuman: Math.round(categoryComparison[cat].human.reduce((a,b) => a+b, 0) / categoryComparison[cat].human.length),
                avgDiff: Math.round(categoryComparison[cat].diff.reduce((a,b) => a+b, 0) / categoryComparison[cat].diff.length)
            };
        }
    });

    return {
        totalCompared: sessionsWithBoth.length,
        totalAvailable: filteredSessions.length,
        withAIScore: filteredSessions.filter(s => s.aiScore).length,
        withHumanScore: filteredSessions.filter(s => s.humanScore).length,
        agreement: Math.round((agreement / sessionsWithBoth.length) * 100),
        disagreement: Math.round(((sessionsWithBoth.length - agreement) / sessionsWithBoth.length) * 100),
        avgAIScore: Math.round(aiScoreSum / sessionsWithBoth.length),
        avgHumanScore: Math.round(humanScoreSum / sessionsWithBoth.length),
        scoreDiff: Math.round(diffSum / sessionsWithBoth.length),
        aiHigher: aiHigher,
        humanHigher: humanHigher,
        matched: matched,
        sessions: sessionsWithBoth,
        categories: Object.keys(categories).length > 0 ? categories : null
    };
}

function displayHumanVsAIComparison() {
    const container = document.getElementById('humanVsAIContainer');
    if (!container || !biMetrics.humanVsAI) return;

    const comparison = biMetrics.humanVsAI;
    
    if (comparison.totalCompared === 0) {
        container.innerHTML = `
            <div style="padding: 2rem; text-align: center; background: #f8f9fa; border-radius: 12px;">
                <div style="font-size: 3rem; margin-bottom: 1rem;">📊</div>
                <h3 style="color: #1a1a2e; margin-bottom: 1rem;">No Comparison Data Available</h3>
                <p style="color: #666; margin-bottom: 0.5rem;">Human vs AI comparison requires sessions with both scores.</p>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-top: 1.5rem; max-width: 600px; margin-left: auto; margin-right: auto;">
                    <div style="background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        <div style="font-size: 1.5rem; font-weight: bold; color: #667eea;">${comparison.totalAvailable}</div>
                        <div style="font-size: 0.85rem; color: #666;">Total Sessions</div>
                    </div>
                    <div style="background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        <div style="font-size: 1.5rem; font-weight: bold; color: #f5576c;">${comparison.withAIScore}</div>
                        <div style="font-size: 0.85rem; color: #666;">With AI Score</div>
                    </div>
                    <div style="background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                        <div style="font-size: 1.5rem; font-weight: bold; color: #4facfe;">${comparison.withHumanScore}</div>
                        <div style="font-size: 0.85rem; color: #666;">With Human Score</div>
                    </div>
                </div>
                <p style="color: #888; font-size: 0.9rem; margin-top: 1.5rem;">💡 Tip: Upload CSV with human scores or ensure JSON reports include humanScore field.</p>
            </div>
        `;
        return;
    }

    const agreementColor = comparison.agreement >= 80 ? '#27ae60' : comparison.agreement >= 70 ? '#2ecc71' : comparison.agreement >= 60 ? '#f39c12' : '#e74c3c';
    const scoreDiff = comparison.avgAIScore - comparison.avgHumanScore;
    const scoreDiffText = scoreDiff > 0 ? `AI scores ${Math.abs(scoreDiff)}% higher on average` : 
                         scoreDiff < 0 ? `Human scores ${Math.abs(scoreDiff)}% higher on average` : 
                         'Perfect alignment';
    const coveragePercent = Math.round((comparison.totalCompared / comparison.totalAvailable) * 100);

    container.innerHTML = `
        <!-- Coverage Stats -->
        <div style="background: linear-gradient(135deg, #e0e7ff 0%, #f0f4ff 100%); padding: 1.25rem; border-radius: 12px; margin-bottom: 1.5rem; border-left: 4px solid #667eea;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
                <div>
                    <div style="font-size: 0.9rem; color: #666; margin-bottom: 0.25rem;">Comparison Coverage</div>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #667eea;">${comparison.totalCompared} of ${comparison.totalAvailable} sessions (${coveragePercent}%)</div>
                </div>
                <div style="display: flex; gap: 1.5rem;">
                    <div style="text-align: center;">
                        <div style="font-size: 1.25rem; font-weight: bold; color: #f5576c;">🤖 ${comparison.withAIScore}</div>
                        <div style="font-size: 0.75rem; color: #666;">AI Analyzed</div>
                    </div>
                    <div style="text-align: center;">
                        <div style="font-size: 1.25rem; font-weight: bold; color: #4facfe;">👤 ${comparison.withHumanScore}</div>
                        <div style="font-size: 0.75rem; color: #666;">Human Reviewed</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Main Metrics -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
            <div class="comparison-card" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 1.5rem; border-radius: 12px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);">
                <div style="font-size: 2.5rem; font-weight: bold; margin-bottom: 0.5rem;">${comparison.totalCompared}</div>
                <div style="opacity: 0.9;">Sessions Compared</div>
                <div style="font-size: 0.8rem; opacity: 0.75; margin-top: 0.5rem;">Avg Difference: ${comparison.scoreDiff}%</div>
            </div>
            
            <div class="comparison-card" style="background: ${agreementColor}; color: white; padding: 1.5rem; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
                <div style="font-size: 2.5rem; font-weight: bold; margin-bottom: 0.5rem;">${comparison.agreement}%</div>
                <div style="opacity: 0.9;">Agreement Rate</div>
                <div style="font-size: 0.85rem; opacity: 0.8; margin-top: 0.25rem;">±10 points threshold</div>
            </div>
            
            <div class="comparison-card" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 1.5rem; border-radius: 12px; box-shadow: 0 4px 15px rgba(240, 147, 251, 0.3);">
                <div style="font-size: 2.5rem; font-weight: bold; margin-bottom: 0.5rem;">${comparison.avgAIScore}%</div>
                <div style="opacity: 0.9;">Average AI Score</div>
            </div>
            
            <div class="comparison-card" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 1.5rem; border-radius: 12px; box-shadow: 0 4px 15px rgba(79, 172, 254, 0.3);">
                <div style="font-size: 2.5rem; font-weight: bold; margin-bottom: 0.5rem;">${comparison.avgHumanScore}%</div>
                <div style="opacity: 0.9;">Average Human Score</div>
            </div>
        </div>

        <div style="background: white; padding: 1.5rem; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 1.5rem;">
            <h3 style="margin: 0 0 1rem 0; color: #1a1a2e; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">
                <span>📊</span> Detailed Analysis
            </h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                <div style="text-align: center; padding: 1rem; background: #f8f9fa; border-radius: 8px; border: 2px solid #667eea;">
                    <div style="font-size: 1.75rem; font-weight: bold; color: #667eea;">${comparison.matched}</div>
                    <div style="color: #666; font-size: 0.9rem; margin-top: 0.25rem;">Closely Matched</div>
                    <div style="font-size: 0.75rem; color: #999; margin-top: 0.25rem;">${Math.round((comparison.matched/comparison.totalCompared)*100)}% of total</div>
                </div>
                <div style="text-align: center; padding: 1rem; background: #f8f9fa; border-radius: 8px; border: 2px solid #f5576c;">
                    <div style="font-size: 1.75rem; font-weight: bold; color: #f5576c;">${comparison.aiHigher}</div>
                    <div style="color: #666; font-size: 0.9rem; margin-top: 0.25rem;">AI Scored Higher</div>
                    <div style="font-size: 0.75rem; color: #999; margin-top: 0.25rem;">${Math.round((comparison.aiHigher/comparison.totalCompared)*100)}% of total</div>
                </div>
                <div style="text-align: center; padding: 1rem; background: #f8f9fa; border-radius: 8px; border: 2px solid #4facfe;">
                    <div style="font-size: 1.75rem; font-weight: bold; color: #4facfe;">${comparison.humanHigher}</div>
                    <div style="color: #666; font-size: 0.9rem; margin-top: 0.25rem;">Human Scored Higher</div>
                    <div style="font-size: 0.75rem; color: #999; margin-top: 0.25rem;">${Math.round((comparison.humanHigher/comparison.totalCompared)*100)}% of total</div>
                </div>
            </div>
            <!-- Distribution Bars -->
            <div style="margin-top: 1rem;">
                <div style="font-size: 0.9rem; color: #666; margin-bottom: 0.5rem; font-weight: 500;">Score Distribution</div>
                <div style="display: flex; height: 30px; border-radius: 6px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    <div style="background: #4facfe; width: ${Math.round((comparison.humanHigher/comparison.totalCompared)*100)}%; display: flex; align-items: center; justify-content: center; color: white; font-size: 0.8rem; font-weight: bold;">
                        ${comparison.humanHigher > 0 ? Math.round((comparison.humanHigher/comparison.totalCompared)*100) + '%' : ''}
                    </div>
                    <div style="background: #667eea; width: ${Math.round((comparison.matched/comparison.totalCompared)*100)}%; display: flex; align-items: center; justify-content: center; color: white; font-size: 0.8rem; font-weight: bold;">
                        ${comparison.matched > 0 ? Math.round((comparison.matched/comparison.totalCompared)*100) + '%' : ''}
                    </div>
                    <div style="background: #f5576c; width: ${Math.round((comparison.aiHigher/comparison.totalCompared)*100)}%; display: flex; align-items: center; justify-content: center; color: white; font-size: 0.8rem; font-weight: bold;">
                        ${comparison.aiHigher > 0 ? Math.round((comparison.aiHigher/comparison.totalCompared)*100) + '%' : ''}
                    </div>
                </div>
                <div style="display: flex; justify-content: space-between; margin-top: 0.5rem; font-size: 0.75rem; color: #999;">
                    <span>👤 Human Higher</span>
                    <span>✓ Matched</span>
                    <span>🤖 AI Higher</span>
                </div>
            </div>
        </div>

        ${comparison.categories ? `
        <!-- Category Breakdown -->
        <div style="background: white; padding: 1.5rem; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 1.5rem;">
            <h3 style="margin: 0 0 1.25rem 0; color: #1a1a2e; font-size: 1.1rem; display: flex; align-items: center; gap: 0.5rem;">
                <span>📋</span> SAPTCF Category Comparison
            </h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem;">
                ${Object.entries(comparison.categories).map(([cat, data]) => {
                    const catDiff = data.avgAI - data.avgHuman;
                    const catColor = Math.abs(catDiff) <= 5 ? '#27ae60' : Math.abs(catDiff) <= 10 ? '#f39c12' : '#e74c3c';
                    const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1);
                    return `
                        <div style="background: #f8f9fa; padding: 1rem; border-radius: 8px; border-left: 3px solid ${catColor};">
                            <div style="font-weight: 600; color: #1a1a2e; margin-bottom: 0.75rem; font-size: 0.95rem;">${catLabel}</div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                <span style="color: #666; font-size: 0.85rem;">🤖 AI:</span>
                                <span style="font-weight: bold; color: #f5576c;">${data.avgAI}%</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; margin-bottom: 0.5rem;">
                                <span style="color: #666; font-size: 0.85rem;">👤 Human:</span>
                                <span style="font-weight: bold; color: #4facfe;">${data.avgHuman}%</span>
                            </div>
                            <div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #ddd;">
                                <div style="font-size: 0.8rem; color: #666;">Avg Difference</div>
                                <div style="font-weight: bold; color: ${catColor}; font-size: 0.95rem;">±${data.avgDiff}%</div>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
        ` : ''}

        <!-- Key Finding -->
        <div style="background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%); padding: 1.25rem; border-radius: 12px; border-left: 4px solid #f39c12;">
            <div style="font-weight: 600; color: #1a1a2e; margin-bottom: 0.5rem;">💡 Key Finding</div>
            <div style="color: #333;">${scoreDiffText}. ${comparison.agreement >= 80 ? 'Excellent alignment between human and AI assessments!' : comparison.agreement >= 70 ? 'Strong correlation between human and AI assessments.' : comparison.agreement >= 60 ? 'Moderate agreement. Consider calibration review.' : 'Low agreement detected. Review scoring criteria and training.'}</div>
        </div>
    `;

    // Update comparison chart
    updateHumanVsAIChart();
}

function updateHumanVsAIChart() {
    if (!biMetrics.humanVsAI || !biMetrics.humanVsAI.sessions) return;

    const ctx = document.getElementById('humanVsAIChart');
    if (!ctx) return;

    const sessions = biMetrics.humanVsAI.sessions.slice(0, 20); // Show first 20
    const labels = sessions.map((s, i) => s.tutorId || `Session ${i + 1}`);
    const aiScores = sessions.map(s => s.aiScore || 0);
    const humanScores = sessions.map(s => s.humanScore || 0);

    if (window.humanVsAIChartInstance) {
        window.humanVsAIChartInstance.destroy();
    }

    window.humanVsAIChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'AI Score',
                    data: aiScores,
                    borderColor: '#f5576c',
                    backgroundColor: 'rgba(245, 87, 108, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 5,
                    pointHoverRadius: 7
                },
                {
                    label: 'Human Score',
                    data: humanScores,
                    borderColor: '#4facfe',
                    backgroundColor: 'rgba(79, 172, 254, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 5,
                    pointHoverRadius: 7
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        font: { size: 12, weight: 'bold' },
                        padding: 15
                    }
                },
                title: {
                    display: true,
                    text: 'Human vs AI Score Comparison by Session',
                    font: { size: 14, weight: 'bold' }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + context.parsed.y + '%';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        callback: function(value) {
                            return value + '%';
                        }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        maxRotation: 45,
                        minRotation: 45
                    }
                }
            }
        }
    });
}

// ===== Advanced Analytics =====
function calculateTrends() {
    if (!realReportMetrics || !realReportMetrics.tutorScores) return null;
    
    const scores = realReportMetrics.tutorScores.map(t => t.overall);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - avg, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);
    
    return {
        average: Math.round(avg),
        median: scores.sort((a, b) => a - b)[Math.floor(scores.length / 2)],
        stdDev: Math.round(stdDev * 10) / 10,
        min: Math.min(...scores),
        max: Math.max(...scores),
        range: Math.max(...scores) - Math.min(...scores)
    };
}

function getInsights() {
    const insights = [];
    
    if (biMetrics.avgPerformance >= 85) {
        insights.push({ type: 'success', text: '🎉 Excellent overall performance! Team is exceeding expectations.' });
    } else if (biMetrics.avgPerformance < 70) {
        insights.push({ type: 'warning', text: '⚠️ Performance below target. Consider additional training programs.' });
    }
    
    if (biMetrics.criticalFlags > 5) {
        insights.push({ type: 'alert', text: '🚨 High number of critical flags detected. Immediate attention required.' });
    }
    
    if (realReportMetrics && realReportMetrics.categoryAverages) {
        const weakest = Object.entries(realReportMetrics.categoryAverages)
            .sort((a, b) => a[1] - b[1])[0];
        if (weakest && weakest[1] < 75) {
            insights.push({ type: 'info', text: `📚 Focus area: ${weakest[0].toUpperCase()} (${weakest[1]}%). Consider targeted coaching.` });
        }
        
        const strongest = Object.entries(realReportMetrics.categoryAverages)
            .sort((a, b) => b[1] - a[1])[0];
        if (strongest && strongest[1] >= 90) {
            insights.push({ type: 'success', text: `⭐ Outstanding performance in ${strongest[0].toUpperCase()} (${strongest[1]}%). Keep it up!` });
        }
    }
    
    if (biMetrics.topPerformers && biMetrics.topPerformers.length > 0) {
        const top = biMetrics.topPerformers[0];
        insights.push({ type: 'info', text: `🏆 Top performer: ${top.tutorId} with ${top.score}% average across ${top.sessionCount} sessions.` });
    }
    
    if (filteredSessions.length < allSessions.length) {
        insights.push({ type: 'info', text: `🔍 Showing ${filteredSessions.length} of ${allSessions.length} total sessions based on active filters.` });
    }
    
    // Human vs AI comparison insights
    if (biMetrics.humanVsAI && biMetrics.humanVsAI.totalCompared > 0) {
        const comparison = biMetrics.humanVsAI;
        
        if (comparison.agreement >= 80) {
            insights.push({ type: 'success', text: `🤝 Excellent agreement (${comparison.agreement}%) between human and AI assessments!` });
        } else if (comparison.agreement < 60) {
            insights.push({ type: 'warning', text: `⚖️ Low agreement (${comparison.agreement}%) between human and AI. Review scoring criteria.` });
        }
        
        if (comparison.aiHigher > comparison.humanHigher * 1.5) {
            insights.push({ type: 'info', text: `🤖 AI tends to score ${Math.round((comparison.aiHigher/comparison.totalCompared)*100)}% higher. Consider bias calibration.` });
        } else if (comparison.humanHigher > comparison.aiHigher * 1.5) {
            insights.push({ type: 'info', text: `👤 Humans tend to score ${Math.round((comparison.humanHigher/comparison.totalCompared)*100)}% higher. Review human auditor training.` });
        }
    }
    
    return insights;
}

function displayInsights() {
    const container = document.getElementById('insightsContainer');
    if (!container) return;
    
    const insights = getInsights();
    
    if (insights.length === 0) {
        container.innerHTML = '<p style="color: #666;">No specific insights available. Continue monitoring performance.</p>';
        return;
    }
    
    container.innerHTML = insights.map(insight => {
        const colors = {
            success: { bg: 'rgba(46, 204, 113, 0.1)', border: '#27ae60', icon: '✓' },
            warning: { bg: 'rgba(241, 196, 15, 0.1)', border: '#f39c12', icon: '⚠' },
            alert: { bg: 'rgba(231, 76, 60, 0.1)', border: '#e74c3c', icon: '!' },
            info: { bg: 'rgba(52, 152, 219, 0.1)', border: '#3498db', icon: 'i' }
        };
        
        const style = colors[insight.type] || colors.info;
        
        return `
            <div style="
                background: ${style.bg};
                border-left: 4px solid ${style.border};
                padding: 1rem 1.25rem;
                border-radius: 8px;
                display: flex;
                align-items: start;
                gap: 0.75rem;
            ">
                <span style="
                    font-weight: bold;
                    color: ${style.border};
                    font-size: 1.1rem;
                ">${style.icon}</span>
                <p style="margin: 0; color: #1a1a2e; line-height: 1.5;">${insight.text}</p>
            </div>
        `;
    }).join('');
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 10000;
        padding: 15px 20px; border-radius: 8px; color: white; font-weight: 500;
        background: ${type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : '#3498db'};
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
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
