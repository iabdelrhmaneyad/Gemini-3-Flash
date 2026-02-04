// Analytics and statistics functions with Chart.js integration

// Use dynamic API base URL for network access
const ANALYTICS_API_BASE = `${window.location.protocol}//${window.location.hostname}:3000`;

let statusChart = null;
let tutorChart = null;

/**
 * Update analytics dashboard with current session data
 */
async function updateAnalytics() {
    try {
        const response = await fetch(`${ANALYTICS_API_BASE}/api/analytics`);
        const analytics = await response.json();

        // Update stat cards
        const totalEl = document.getElementById('totalSessions');
        const completedEl = document.getElementById('completedSessions');
        const auditedEl = document.getElementById('auditedSessions');
        const reportsEl = document.getElementById('reportsGenerated');
        const avgScoreEl = document.getElementById('avgScoreDisplay');

        if (totalEl) totalEl.textContent = analytics.totalSessions || 0;
        if (completedEl) completedEl.textContent = analytics.completedSessions || 0;
        if (auditedEl) auditedEl.textContent = analytics.auditedSessions || 0;
        if (reportsEl) reportsEl.textContent = analytics.reportsGenerated || analytics.completedSessions || 0;
        
        // Calculate average AI score from currentSessions (global variable from app.js)
        if (avgScoreEl && typeof currentSessions !== 'undefined') {
            const scores = currentSessions
                .map(s => parseFloat(s.aiScore))
                .filter(s => !isNaN(s));
            
            if (scores.length > 0) {
                const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
                avgScoreEl.textContent = avg + '%';
            } else {
                avgScoreEl.textContent = '—';
            }
        }

        // Animate numbers
        animateNumbers();
    } catch (error) {
        console.error('Analytics update error:', error);
    }
}

/**
 * Update charts with current session data
 */
async function updateCharts() {
    try {
        const response = await fetch(`${ANALYTICS_API_BASE}/api/analytics`);
        const analytics = await response.json();

        // Update Status Distribution Chart
        updateStatusChart(analytics);

        // Update Tutor Performance Chart
        updateTutorChart(analytics);
    } catch (error) {
        console.error('Chart update error:', error);
    }
}

/**
 * Update status distribution pie chart
 */
function updateStatusChart(analytics) {
    const ctx = document.getElementById('statusChart');
    if (!ctx) return;

    const data = {
        labels: ['Completed', 'Pending', 'Failed'],
        datasets: [{
            data: [
                analytics.completedSessions,
                analytics.pendingSessions,
                analytics.failedSessions
            ],
            backgroundColor: [
                '#2ecc71',
                '#F59E0B',
                '#EF4444'
            ],
            borderWidth: 0
        }]
    };

    const config = {
        type: 'doughnut',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        font: {
                            size: 12,
                            family: 'Poppins'
                        }
                    }
                }
            }
        }
    };

    if (statusChart) {
        statusChart.data = data;
        statusChart.update();
    } else {
        statusChart = new Chart(ctx, config);
    }
}

/**
 * Update tutor performance bar chart
 */
function updateTutorChart(analytics) {
    const ctx = document.getElementById('tutorChart');
    if (!ctx) return;

    const tutorIds = Object.keys(analytics.tutorStats);
    const tutorTotals = tutorIds.map(id => analytics.tutorStats[id].total);
    const tutorCompleted = tutorIds.map(id => analytics.tutorStats[id].completed);
    const tutorAudited = tutorIds.map(id => analytics.tutorStats[id].audited);

    const data = {
        labels: tutorIds,
        datasets: [
            {
                label: 'Total Sessions',
                data: tutorTotals,
                backgroundColor: '#007bff',
                borderRadius: 8
            },
            {
                label: 'Completed',
                data: tutorCompleted,
                backgroundColor: '#2ecc71',
                borderRadius: 8
            },
            {
                label: 'Audited',
                data: tutorAudited,
                backgroundColor: '#f58220',
                borderRadius: 8
            }
        ]
    };

    const config = {
        type: 'bar',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 15,
                        font: {
                            size: 12,
                            family: 'Poppins'
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    };

    if (tutorChart) {
        tutorChart.data = data;
        tutorChart.update();
    } else {
        tutorChart = new Chart(ctx, config);
    }
}

/**
 * Animate number changes in stat cards
 */
function animateNumbers() {
    const statCards = document.querySelectorAll('.stat-content h3');
    statCards.forEach(card => {
        card.style.animation = 'none';
        setTimeout(() => {
            card.style.animation = 'pulse 0.5s ease';
        }, 10);
    });
}

/**
 * Calculate tutor performance metrics
 */
function calculateTutorMetrics(sessions) {
    const tutorMetrics = {};

    sessions.forEach(session => {
        if (!tutorMetrics[session.tutorId]) {
            tutorMetrics[session.tutorId] = {
                total: 0,
                completed: 0,
                audited: 0,
                approved: 0,
                completionRate: 0,
                approvalRate: 0
            };
        }

        const metrics = tutorMetrics[session.tutorId];
        metrics.total++;

        if (session.status === 'completed') {
            metrics.completed++;
        }

        if (session.auditStatus !== 'pending') {
            metrics.audited++;
        }

        if (session.auditApproved) {
            metrics.approved++;
        }

        // Calculate rates
        metrics.completionRate = metrics.total > 0
            ? Math.round((metrics.completed / metrics.total) * 100)
            : 0;
        metrics.approvalRate = metrics.audited > 0
            ? Math.round((metrics.approved / metrics.audited) * 100)
            : 0;
    });

    return tutorMetrics;
}

/**
 * Calculate time slot distribution
 */
function calculateTimeSlotDistribution(sessions) {
    const distribution = {};

    sessions.forEach(session => {
        if (!distribution[session.timeSlot]) {
            distribution[session.timeSlot] = 0;
        }
        distribution[session.timeSlot]++;
    });

    return distribution;
}

/**
 * Get session status summary
 */
function getStatusSummary(sessions) {
    return {
        total: sessions.length,
        pending: sessions.filter(s => s.status === 'pending').length,
        downloading: sessions.filter(s => s.status === 'downloading').length,
        completed: sessions.filter(s => s.status === 'completed').length,
        failed: sessions.filter(s => s.status === 'failed').length,
        auditPending: sessions.filter(s => s.auditStatus === 'pending').length,
        auditReviewed: sessions.filter(s => s.auditStatus === 'reviewed').length,
        auditApproved: sessions.filter(s => s.auditApproved).length
    };
}

/**
 * Format percentage for display
 */
function formatPercentage(value) {
    return `${Math.round(value)}%`;
}

/**
 * Format time duration
 */
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

// Add pulse animation
const analyticsStyle = document.createElement('style');
analyticsStyle.textContent = `
    @keyframes pulse {
        0%, 100% {
            transform: scale(1);
        }
        50% {
            transform: scale(1.1);
        }
    }
`;
document.head.appendChild(analyticsStyle);

// Export functions for use in other modules
window.updateAnalytics = updateAnalytics;
window.updateCharts = updateCharts;
window.calculateTutorMetrics = calculateTutorMetrics;
window.calculateTimeSlotDistribution = calculateTimeSlotDistribution;
window.getStatusSummary = getStatusSummary;
