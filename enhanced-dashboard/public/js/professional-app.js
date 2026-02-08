/**
 * iSchool Quality Dashboard - Professional Edition
 * Main Application JavaScript
 */

// ============================================
// Configuration & State
// ============================================
const API_URL = window.location.origin;
let authToken = localStorage.getItem('authToken');
let currentUser = null;
let currentPage = 'dashboard';
let socket = null;

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    // Hide preloader after a delay
    setTimeout(() => {
        document.getElementById('preloader').classList.add('hidden');
    }, 1000);

    // Check for existing auth
    if (authToken) {
        validateToken();
    }

    // Initialize event listeners
    initializeEventListeners();
});

function initializeEventListeners() {
    // Login form
    document.getElementById('loginForm')?.addEventListener('submit', handleLogin);

    // Logout
    document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        logout();
    });

    // Navigation
    document.querySelectorAll('.nav-link[data-page]').forEach(link => {
        link.addEventListener('click', handleNavigation);
    });

    // Refresh button
    document.getElementById('refreshBtn')?.addEventListener('click', refreshCurrentPage);

    // Global search
    document.getElementById('globalSearch')?.addEventListener('input', debounce(handleGlobalSearch, 300));

    // Filters
    document.getElementById('applyFilters')?.addEventListener('click', applySessionFilters);
    document.getElementById('searchSessions')?.addEventListener('input', debounce(applySessionFilters, 300));

    // Close modals on escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllModals();
        }
    });

    // Close notification panel on outside click
    document.addEventListener('click', (e) => {
        const panel = document.getElementById('notificationPanel');
        const btn = document.querySelector('.notification-btn');
        if (panel?.classList.contains('show') && !panel.contains(e.target) && !btn.contains(e.target)) {
            panel.classList.remove('show');
        }
    });

    // Initialize Socket.IO
    setupSocketListeners();

    // Initialize Upload
    setupUploadListeners();
}

// ============================================
// API Helper
// ============================================
async function apiCall(endpoint, options = {}) {
    try {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        const response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers
        });

        if (response.status === 401) {
            logout();
            return null;
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error('API Error:', error);
        showToast('error', 'Connection Error', 'Failed to connect to server');
        return null;
    }
}

// ============================================
// Authentication
// ============================================
async function handleLogin(e) {
    e.preventDefault();

    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    const submitBtn = e.target.querySelector('button[type="submit"]');

    // Add loading state
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
        const data = await apiCall('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        if (data?.token) {
            authToken = data.token;
            localStorage.setItem('authToken', authToken);
            currentUser = data.user;
            showDashboard();
            showToast('success', 'Welcome!', `Logged in as ${currentUser.full_name}`);
        } else {
            errorEl.textContent = data?.error || 'Invalid credentials';
            errorEl.classList.add('show');
        }
    } catch (error) {
        errorEl.textContent = 'Connection error. Please try again.';
        errorEl.classList.add('show');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
}

async function validateToken() {
    const data = await apiCall('/api/auth/me');
    if (data?.user) {
        currentUser = data.user;
        showDashboard();
    } else {
        logout();
    }
}

function logout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');

    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('mainDashboard').style.display = 'none';

    // Reset login form
    document.getElementById('loginForm').reset();
    document.getElementById('loginError').classList.remove('show');
}

function quickLogin(email, password) {
    document.getElementById('loginEmail').value = email;
    document.getElementById('loginPassword').value = password;
    document.getElementById('loginForm').dispatchEvent(new Event('submit'));
}

function togglePassword() {
    const input = document.getElementById('loginPassword');
    const icon = document.querySelector('.toggle-password i');

    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

// ============================================
// Dashboard Display
// ============================================
function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainDashboard').style.display = 'flex';

    // Update user info
    document.getElementById('userName').textContent = currentUser.full_name;
    document.getElementById('userRole').textContent = currentUser.roles?.join(', ') || 'User';
    document.getElementById('welcomeName').textContent = currentUser.full_name.split(' ')[0];

    // Show admin menu items
    if (currentUser.roles?.includes('admin')) {
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = 'flex';
        });
    }

    // Load dashboard data
    loadDashboardData();
}

// ============================================
// Navigation
// ============================================
function handleNavigation(e) {
    e.preventDefault();
    const page = e.currentTarget.dataset.page;
    navigateTo(page);
}

function navigateTo(page) {
    currentPage = page;

    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });
    document.querySelector(`.nav-link[data-page="${page}"]`)?.classList.add('active');

    // Update page title
    const titles = {
        'dashboard': 'Dashboard',
        'sessions': 'Sessions',
        'tutors': 'Tutors',
        'reviews': 'Reviews',
        'ai-comparison': 'AI vs Human Comparison',
        'analytics': 'BI Analytics',
        'admin': 'User Management',
        'audit': 'Audit Logs',
        'export': 'Data Export'
    };
    document.getElementById('pageTitle').textContent = titles[page] || 'Dashboard';

    // Show page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(`${page}Page`)?.classList.add('active');

    // Load page data
    loadPageData(page);

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
}

function refreshCurrentPage() {
    const btn = document.getElementById('refreshBtn');
    btn.classList.add('spin');

    loadPageData(currentPage).then(() => {
        setTimeout(() => btn.classList.remove('spin'), 500);
        showToast('success', 'Refreshed', 'Data updated successfully');
    });
}

async function loadPageData(page) {
    switch (page) {
        case 'dashboard':
            await loadDashboardData();
            break;
        case 'sessions':
            await loadSessions();
            break;
        case 'tutors':
            await loadTutors();
            break;
        case 'reviews':
            await loadReviews();
            break;
        case 'ai-comparison':
            await loadAIComparison();
            break;
        case 'analytics':
            await loadAnalytics();
            break;
        case 'admin':
            await loadAdminPanel();
            break;
        case 'audit':
            await loadAuditLogs();
            break;
    }
}

// ============================================
// Dashboard Data
// ============================================
async function loadDashboardData() {
    const [stats, sessions, tutors] = await Promise.all([
        apiCall('/api/analytics/dashboard'),
        apiCall('/api/sessions'),
        apiCall('/api/analytics/tutor-performance')
    ]);

    if (stats) {
        // Update stats
        animateValue('totalSessions', 0, stats.total_sessions || 0, 1000);
        animateValue('completedSessions', 0, stats.completed_sessions || 0, 1000);
        animateValue('pendingSessions', 0, stats.pending_sessions || 0, 1000);
        animateValue('averageScore', 0, Math.round(stats.average_score) || 0, 1000);

        // Update agreement rate
        const agreementRate = Math.round(stats.ai_human_agreement_rate) || 0;
        document.getElementById('agreementRate').textContent = agreementRate;

        // Animate agreement circle
        const circle = document.getElementById('agreementCircle');
        if (circle) {
            const offset = 283 - (283 * agreementRate / 100);
            circle.style.strokeDashoffset = offset;
        }

        document.getElementById('sessionsCompared').textContent = stats.total_comparisons || 0;
        document.getElementById('avgDifference').textContent = `${Math.round(stats.average_difference) || 0} pts`;

        // Update session count badge
        document.getElementById('sessionCount').textContent = stats.total_sessions || 0;
    }

    // Recent activity
    if (sessions?.sessions) {
        displayRecentActivity(sessions.sessions.slice(0, 5));
    }

    // Top performers
    if (tutors?.performance) {
        displayTopPerformers(tutors.performance.slice(0, 5));
    }

    // Initialize performance chart
    initPerformanceChart();
}

function displayRecentActivity(sessions) {
    const container = document.getElementById('recentActivity');
    if (!sessions?.length) {
        container.innerHTML = '<p class="text-muted text-center">No recent activity</p>';
        return;
    }

    container.innerHTML = sessions.map(session => {
        const score = session.human_score || session.ai_score;
        const status = session.status || 'pending';
        const iconClass = status === 'completed' ? 'completed' : (status === 'in_review' ? 'review' : 'pending');
        const icon = status === 'completed' ? 'fa-check-circle' : (status === 'in_review' ? 'fa-eye' : 'fa-clock');

        return `
            <div class="activity-item">
                <div class="activity-icon ${iconClass}">
                    <i class="fas ${icon}"></i>
                </div>
                <div class="activity-content">
                    <div class="activity-title">Session ${session.session_id || session.id}</div>
                    <div class="activity-meta">${session.tutor_id} • ${session.session_date || session.date || 'N/A'}</div>
                </div>
                <div class="activity-score">${score || '-'}</div>
            </div>
        `;
    }).join('');
}

function displayTopPerformers(performers) {
    const container = document.getElementById('topPerformers');
    if (!performers?.length) {
        container.innerHTML = '<p class="text-muted text-center">No data available</p>';
        return;
    }

    container.innerHTML = performers.map((tutor, index) => {
        const rankClass = index === 0 ? 'gold' : (index === 1 ? 'silver' : (index === 2 ? 'bronze' : 'default'));
        const score = Math.round(tutor.average_score) || 0;

        return `
            <div class="performer-item">
                <div class="performer-rank ${rankClass}">${index + 1}</div>
                <div class="performer-info">
                    <div class="performer-name">${tutor.full_name}</div>
                    <div class="performer-sessions">${tutor.total_sessions} sessions</div>
                </div>
                <div class="performer-score">
                    <div class="performer-score-value">${score}</div>
                    <div class="performer-score-label">avg score</div>
                </div>
            </div>
        `;
    }).join('');
}

function initPerformanceChart() {
    const ctx = document.getElementById('performanceChart')?.getContext('2d');
    if (!ctx) return;

    // Destroy existing chart
    if (window.performanceChart instanceof Chart) {
        window.performanceChart.destroy();
    }

    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const data = [82, 85, 84, 88, 90, 92, 91]; // Simulated data

    window.performanceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Average Quality Score',
                data,
                fill: true,
                backgroundColor: 'rgba(99, 102, 241, 0.1)',
                borderColor: '#6366f1',
                borderWidth: 3,
                tension: 0.4,
                pointBackgroundColor: '#6366f1',
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleFont: { size: 14, weight: '600' },
                    bodyFont: { size: 13 },
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#64748b', font: { size: 12 } }
                },
                y: {
                    min: 60,
                    max: 100,
                    grid: { color: '#f1f5f9' },
                    ticks: {
                        color: '#64748b',
                        font: { size: 12 },
                        callback: value => value + '%'
                    }
                }
            }
        }
    });
}

// ============================================
// Sessions
// ============================================
async function loadSessions() {
    const [data, tutors] = await Promise.all([
        apiCall('/api/sessions'),
        apiCall('/api/tutors')
    ]);

    if (data?.sessions) {
        // Populate tutor filter
        const tutorFilter = document.getElementById('filterTutor');
        if (tutors?.tutors) {
            tutorFilter.innerHTML = '<option value="">All Tutors</option>' +
                tutors.tutors.map(t => `<option value="${t.id}">${t.full_name}</option>`).join('');
        }

        displaySessionsTable(data.sessions);
    }
}

function displaySessionsTable(sessions) {
    const container = document.getElementById('sessionsTable');

    if (!sessions?.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-video"></i>
                <h3>No Sessions Found</h3>
                <p>There are no sessions matching your criteria.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <table class="data-table">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Session ID</th>
                    <th>Tutor</th>
                    <th>Time Slot</th>
                    <th>AI Score</th>
                    <th>Human Score</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${sessions.map((s, index) => {
        const hasAI = s.ai_score || s.aiScore;
        const hasHuman = s.human_score || s.humanScore;
        const aiScore = s.ai_score || s.aiScore || '-';
        const humanScore = s.human_score || s.humanScore || '-';
        const status = s.status || 'pending';

        // Progress bar for active states
        let statusHtml = `<span class="badge badge-${status}">${formatStatus(status)}</span>`;

        if (status === 'downloading') {
            statusHtml = `
                            <div class="status-progress-wrapper">
                                <span class="badge badge-info"><i class="fas fa-download"></i> ${s.progress || 0}%</span>
                                <div class="mini-progress"><div style="width: ${s.progress || 0}%"></div></div>
                            </div>
                        `;
        } else if (status === 'analyzing') {
            statusHtml = `
                            <span class="badge badge-warning"><i class="fas fa-cog fa-spin"></i> Analyzing</span>
                        `;
        } else if (s.download_status === 'queued' || s.analysis_status === 'queued') {
            statusHtml = `<span class="badge badge-secondary"><i class="fas fa-clock"></i> Queued</span>`;
        }

        return `
                        <tr id="session-row-${s.id}" style="animation-delay: ${index * 0.05}s">
                            <td>${s.session_date || s.date || 'N/A'}</td>
                            <td><strong>${s.session_id || s.id || 'N/A'}</strong></td>
                            <td>${s.tutor_id || 'N/A'}</td>
                            <td>${s.time_slot || 'N/A'}</td>
                            <td class="${getScoreClass(aiScore)}">${aiScore}</td>
                            <td class="${getScoreClass(humanScore)}">${humanScore}</td>
                            <td>${statusHtml}</td>
                            <td>
                                <div class="action-buttons">
                                    <button class="btn-icon view" onclick="viewReport('${s.tutor_id}', '${s.id}')" title="View Report" ${!hasAI ? 'disabled' : ''}>
                                        <i class="fas fa-file-alt"></i>
                                    </button>
                                    <button class="btn-icon details" onclick="viewSessionDetails('${s.id}')" title="View Details">
                                        <i class="fas fa-info-circle"></i>
                                    </button>
                                    ${(status === 'failed' || (!hasAI && status !== 'analyzing' && status !== 'downloading' && status !== 'queued')) ? `
                                        <button class="btn-icon retry" onclick="retryAnalysis('${s.id}')" title="Retry Analysis">
                                            <i class="fas fa-redo"></i>
                                        </button>
                                    ` : ''}
                                </div>
                            </td>
                        </tr>
                    `;
    }).join('')}
            </tbody>
        </table>
    `;
}

function getScoreClass(score) {
    if (score === '-' || score === null) return '';
    const numScore = parseInt(score);
    if (numScore >= 90) return 'text-success';
    if (numScore >= 80) return '';
    return 'text-danger';
}

function formatStatus(status) {
    const statusMap = {
        'pending': 'Pending',
        'in_review': 'In Review',
        'completed': 'Completed',
        'failed': 'Failed',
        'downloading': 'Downloading',
        'queued': 'Queued',
        'analyzing': 'Analyzing'
    };
    return statusMap[status] || status;
}

function applySessionFilters() {
    const search = document.getElementById('searchSessions')?.value.toLowerCase();
    const status = document.getElementById('filterStatus')?.value;
    const tutor = document.getElementById('filterTutor')?.value;

    // Re-fetch and filter
    apiCall('/api/sessions').then(data => {
        if (data?.sessions) {
            let filtered = data.sessions;

            if (search) {
                filtered = filtered.filter(s =>
                    (s.session_id || '').toLowerCase().includes(search) ||
                    (s.tutor_id || '').toLowerCase().includes(search)
                );
            }

            if (status) {
                filtered = filtered.filter(s => s.status === status);
            }

            if (tutor) {
                filtered = filtered.filter(s => s.tutor_id === tutor);
            }

            displaySessionsTable(filtered);
        }
    });
}

// ============================================
// Tutors
// ============================================
async function loadTutors() {
    const data = await apiCall('/api/tutors');

    if (data?.tutors) {
        displayTutorsGrid(data.tutors);
    }
}

function displayTutorsGrid(tutors) {
    const container = document.getElementById('tutorsGrid');

    if (!tutors?.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-chalkboard-teacher"></i>
                <h3>No Tutors Found</h3>
                <p>There are no tutors in the system.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = tutors.map(tutor => `
        <div class="tutor-card">
            <div class="tutor-header">
                <div class="tutor-avatar">
                    ${(tutor.full_name || 'T').charAt(0).toUpperCase()}
                </div>
                <div class="tutor-info">
                    <h4>${tutor.full_name || 'Unknown'}</h4>
                    <span>${tutor.tutor_code || tutor.id}</span>
                </div>
            </div>
            <div class="tutor-stats">
                <div class="tutor-stat">
                    <span class="tutor-stat-value">${tutor.total_sessions || 0}</span>
                    <span class="tutor-stat-label">Sessions</span>
                </div>
                <div class="tutor-stat">
                    <span class="tutor-stat-value">${Math.round(tutor.average_score) || 0}</span>
                    <span class="tutor-stat-label">Avg Score</span>
                </div>
                <div class="tutor-stat">
                    <span class="tutor-stat-value">${tutor.completed_sessions || 0}</span>
                    <span class="tutor-stat-label">Completed</span>
                </div>
            </div>
        </div>
    `).join('');
}

function setTutorView(view) {
    const container = document.getElementById('tutorsGrid');
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === view);
    });
    container.classList.toggle('grid-view', view === 'grid');
    container.classList.toggle('list-view', view === 'list');
}

// ============================================
// Reviews
// ============================================
async function loadReviews() {
    const data = await apiCall('/api/reviews/reviewers');

    if (data?.reviewers) {
        displayReviewers(data.reviewers);
    }
}

function displayReviewers(reviewers) {
    const container = document.getElementById('reviewersGrid');

    container.innerHTML = `
        <div class="stats-row">
            ${reviewers.map(reviewer => `
                <div class="stat-card gradient-purple">
                    <div class="stat-content">
                        <div class="stat-icon">
                            <i class="fas fa-user-check"></i>
                        </div>
                        <div class="stat-details">
                            <span class="stat-value">${reviewer.total_reviews}</span>
                            <span class="stat-label">${reviewer.full_name}</span>
                            <span class="stat-trend neutral">${reviewer.email}</span>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// ============================================
// AI Comparison
// ============================================
async function loadAIComparison() {
    const data = await apiCall('/api/analytics/ai-human-comparison');

    if (data) {
        displayAIComparison(data);
    }
}

function displayAIComparison(data) {
    const container = document.getElementById('comparisonCharts');

    container.innerHTML = `
        <div class="stats-row">
            <div class="stat-card gradient-blue">
                <div class="stat-content">
                    <div class="stat-icon"><i class="fas fa-balance-scale"></i></div>
                    <div class="stat-details">
                        <span class="stat-value">${data.total_comparisons || 0}</span>
                        <span class="stat-label">Total Comparisons</span>
                    </div>
                </div>
            </div>
            <div class="stat-card gradient-green">
                <div class="stat-content">
                    <div class="stat-icon"><i class="fas fa-handshake"></i></div>
                    <div class="stat-details">
                        <span class="stat-value">${data.agreement_rate || 0}%</span>
                        <span class="stat-label">Agreement Rate</span>
                    </div>
                </div>
            </div>
            <div class="stat-card gradient-orange">
                <div class="stat-content">
                    <div class="stat-icon"><i class="fas fa-ruler"></i></div>
                    <div class="stat-details">
                        <span class="stat-value">${Math.round(data.average_difference) || 0}</span>
                        <span class="stat-label">Avg Difference</span>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="chart-card mt-3">
            <div class="card-header">
                <h3><i class="fas fa-chart-bar"></i> Score Difference Distribution</h3>
            </div>
            <div class="card-body">
                <canvas id="diffDistChart" height="300"></canvas>
            </div>
        </div>
    `;

    // Create distribution chart
    if (data.difference_distribution) {
        const ctx = document.getElementById('diffDistChart')?.getContext('2d');
        if (ctx) {
            new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: Object.keys(data.difference_distribution),
                    datasets: [{
                        label: 'Number of Sessions',
                        data: Object.values(data.difference_distribution),
                        backgroundColor: 'rgba(99, 102, 241, 0.6)',
                        borderColor: '#6366f1',
                        borderWidth: 1,
                        borderRadius: 8
                    }]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        y: { beginAtZero: true }
                    }
                }
            });
        }
    }
}

// ============================================
// Analytics (BI Dashboard)
// ============================================
async function loadAnalytics() {
    const [performanceData, sessionsData, biMetrics] = await Promise.all([
        apiCall('/api/analytics/tutor-performance'),
        apiCall('/api/sessions'),
        apiCall('/api/analytics/bi-metrics')
    ]);

    if (performanceData?.performance && sessionsData?.sessions) {
        displayBIDashboard(performanceData.performance, sessionsData.sessions, biMetrics);
    }
}

function displayBIDashboard(performance, sessions, biMetrics) {
    const container = document.getElementById('analyticsContent');

    // Calculate KPIs
    const totalSessions = sessions.length;
    const completedSessions = sessions.filter(s => s.status === 'completed').length;
    const scores = sessions.filter(s => s.ai_score || s.human_score)
        .map(s => s.human_score || s.ai_score);
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const passRate = totalSessions ? Math.round((sessions.filter(s => (s.human_score || s.ai_score) >= 80).length / totalSessions) * 100) : 0;

    container.innerHTML = `
        <!-- KPI Cards -->
        <div class="stats-row">
            <div class="stat-card gradient-blue">
                <div class="stat-content">
                    <div class="stat-icon"><i class="fas fa-chalkboard-teacher"></i></div>
                    <div class="stat-details">
                        <span class="stat-value">${totalSessions}</span>
                        <span class="stat-label">Total Sessions Analyzed</span>
                        <span class="stat-trend positive"><i class="fas fa-arrow-up"></i> 12% vs last month</span>
                    </div>
                </div>
            </div>
            <div class="stat-card gradient-green">
                <div class="stat-content">
                    <div class="stat-icon"><i class="fas fa-star"></i></div>
                    <div class="stat-details">
                        <span class="stat-value">${avgScore}%</span>
                        <span class="stat-label">Average Quality Score</span>
                        <span class="stat-trend ${avgScore >= 90 ? 'positive' : 'neutral'}">Target: 90%</span>
                    </div>
                </div>
            </div>
            <div class="stat-card gradient-orange">
                <div class="stat-content">
                    <div class="stat-icon"><i class="fas fa-check-circle"></i></div>
                    <div class="stat-details">
                        <span class="stat-value">${passRate}%</span>
                        <span class="stat-label">Pass Rate (≥80%)</span>
                        <span class="stat-trend ${passRate >= 85 ? 'positive' : 'neutral'}">Stable</span>
                    </div>
                </div>
            </div>
            <div class="stat-card gradient-purple">
                <div class="stat-content">
                    <div class="stat-icon"><i class="fas fa-users"></i></div>
                    <div class="stat-details">
                        <span class="stat-value">${performance.length}</span>
                        <span class="stat-label">Active Tutors</span>
                        <span class="stat-trend neutral">All Categories</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Charts -->
        <div class="charts-row">
            <div class="chart-card">
                <div class="card-header">
                    <h3><i class="fas fa-chart-pie"></i> Score Distribution</h3>
                </div>
                <div class="card-body">
                    <canvas id="scoreDistChart"></canvas>
                </div>
            </div>
            <div class="chart-card">
                <div class="card-header">
                    <h3><i class="fas fa-spider"></i> SAPTCF Categories</h3>
                </div>
                <div class="card-body">
                    <canvas id="radarChart"></canvas>
                </div>
            </div>
        </div>

        <!-- Performance Table -->
        <div class="chart-card mt-3">
            <div class="card-header">
                <h3><i class="fas fa-list"></i> Detailed Tutor Performance</h3>
            </div>
            <div class="card-body">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Tutor</th>
                            <th>Sessions</th>
                            <th>Completed</th>
                            <th>Avg Score</th>
                            <th>Performance</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${performance.map(p => {
        const score = parseFloat(p.average_score) || 0;
        const barColor = score >= 90 ? '#10b981' : (score >= 80 ? '#6366f1' : '#ef4444');

        return `
                                <tr>
                                    <td>
                                        <div class="d-flex align-center gap-2">
                                            <div class="tutor-avatar" style="width: 36px; height: 36px; font-size: 14px;">
                                                ${(p.full_name || 'T').charAt(0)}
                                            </div>
                                            <div>
                                                <strong>${p.full_name}</strong>
                                                <div class="text-muted" style="font-size: 12px;">${p.tutor_code}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td>${p.total_sessions}</td>
                                    <td>${p.completed_sessions}</td>
                                    <td><strong>${score.toFixed(1)}</strong></td>
                                    <td style="min-width: 150px;">
                                        <div style="background: #f1f5f9; border-radius: 4px; height: 8px; overflow: hidden;">
                                            <div style="width: ${score}%; height: 100%; background: ${barColor}; border-radius: 4px;"></div>
                                        </div>
                                    </td>
                                </tr>
                            `;
    }).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // Initialize charts
    initBICharts(sessions, biMetrics);
}

function initBICharts(sessions, biMetrics) {
    const scores = sessions.filter(s => s.ai_score || s.human_score).map(s => s.human_score || s.ai_score);

    // Score Distribution
    const distribution = {
        '90-100': scores.filter(s => s >= 90).length,
        '80-89': scores.filter(s => s >= 80 && s < 90).length,
        '70-79': scores.filter(s => s >= 70 && s < 80).length,
        '< 70': scores.filter(s => s < 70).length
    };

    const distCtx = document.getElementById('scoreDistChart')?.getContext('2d');
    if (distCtx) {
        new Chart(distCtx, {
            type: 'doughnut',
            data: {
                labels: Object.keys(distribution),
                datasets: [{
                    data: Object.values(distribution),
                    backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#ef4444'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { position: 'right' }
                },
                cutout: '60%'
            }
        });
    }

    // Radar Chart
    const radarCtx = document.getElementById('radarChart')?.getContext('2d');

    // Prepare data
    const catAvg = biMetrics?.categoryAverages || { setup: 0, attitude: 0, preparation: 0, curriculum: 0, teaching: 0, feedback: 0 };
    const radarData = [
        catAvg.setup,
        catAvg.attitude,
        catAvg.preparation,
        catAvg.curriculum,
        catAvg.teaching,
        catAvg.feedback
    ];

    // Human data if available
    const humAvg = biMetrics?.humanCategoryAverages;
    const hasHuman = biMetrics?.totalHumanReports > 0;
    const humanRadarData = hasHuman ? [
        humAvg.setup, humAvg.attitude, humAvg.preparation, humAvg.curriculum, humAvg.teaching, humAvg.feedback
    ] : [];

    const datasets = [{
        label: 'AI Average',
        data: radarData,
        fill: true,
        backgroundColor: 'rgba(99, 102, 241, 0.2)',
        borderColor: '#6366f1',
        pointBackgroundColor: '#6366f1',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: '#6366f1'
    }];

    if (hasHuman) {
        datasets.push({
            label: 'Human Average',
            data: humanRadarData,
            fill: true,
            backgroundColor: 'rgba(16, 185, 129, 0.2)',
            borderColor: '#10b981',
            pointBackgroundColor: '#10b981',
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: '#10b981'
        });
    }

    if (radarCtx) {
        new Chart(radarCtx, {
            type: 'radar',
            data: {
                labels: ['Setup', 'Attitude', 'Preparation', 'Curriculum', 'Teaching', 'Feedback'],
                datasets: datasets
            },
            options: {
                responsive: true,
                scales: {
                    r: {
                        min: 0,
                        max: 100,
                        ticks: { stepSize: 20 }
                    }
                }
            }
        });
    }
}

// ============================================
// Admin Panel
// ============================================
async function loadAdminPanel() {
    const data = await apiCall('/api/admin/users');

    if (data?.users) {
        displayUsers(data.users);
    }
}

function displayUsers(users) {
    const container = document.getElementById('usersGrid');

    container.innerHTML = users.map(user => `
        <div class="user-card">
            <div class="user-card-avatar">
                ${(user.full_name || 'U').charAt(0).toUpperCase()}
            </div>
            <div class="user-card-info">
                <div class="user-card-name">${user.full_name}</div>
                <div class="user-card-email">${user.email}</div>
                <div class="user-card-roles">
                    ${(user.roles || []).map(role =>
        `<span class="role-badge ${role}">${role}</span>`
    ).join('')}
                </div>
            </div>
            <div class="user-card-actions">
                <button class="btn-icon details" onclick="editUser('${user.id}')" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn-icon delete" onclick="deleteUser('${user.id}')" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function showAdminTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    document.getElementById(`${tab}Tab`)?.classList.add('active');

    if (tab === 'system') {
        loadSystemStats();
    }
}

async function loadSystemStats() {
    const data = await apiCall('/api/admin/system-stats');
    if (data) {
        document.getElementById('systemTotalUsers').textContent = data.total_users || 0;
        document.getElementById('systemTotalSessions').textContent = data.total_sessions || 0;
        document.getElementById('systemTotalReviews').textContent = data.total_reviews || 0;
        document.getElementById('systemTotalAuditLogs').textContent = data.total_audit_logs || 0;
    }
}

// ============================================
// Audit Logs
// ============================================
async function loadAuditLogs() {
    const action = document.getElementById('actionFilter')?.value;
    const dateFrom = document.getElementById('dateFrom')?.value;
    const dateTo = document.getElementById('dateTo')?.value;

    let url = '/api/admin/audit-logs?';
    if (action) url += `action=${action}&`;
    if (dateFrom) url += `dateFrom=${dateFrom}&`;
    if (dateTo) url += `dateTo=${dateTo}&`;

    const data = await apiCall(url);

    if (data?.logs) {
        displayAuditLogs(data.logs);
    }
}

function displayAuditLogs(logs) {
    const tbody = document.getElementById('auditLogsTable');

    if (!logs?.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No audit logs found</td></tr>';
        return;
    }

    tbody.innerHTML = logs.map(log => `
        <tr>
            <td>${new Date(log.timestamp).toLocaleString()}</td>
            <td>${log.user_email || 'System'}</td>
            <td><span class="badge badge-${log.action.toLowerCase().includes('delete') ? 'failed' : 'completed'}">${log.action}</span></td>
            <td>${log.resource_type || '-'}</td>
            <td><small>${JSON.stringify(log.details || {}).slice(0, 50)}...</small></td>
        </tr>
    `).join('');
}

// ============================================
// Modals
// ============================================
function showAddUserModal() {
    document.getElementById('modalTitle').textContent = 'Add User';
    document.getElementById('userForm').reset();
    document.getElementById('userId').value = '';
    document.getElementById('userModal').classList.add('show');
}

function closeModal() {
    document.getElementById('userModal').classList.remove('show');
}

function closeReportModal() {
    document.getElementById('reportModal').classList.remove('show');
    document.getElementById('reportFrame').src = '';
}

function closeSessionDetailsModal() {
    document.getElementById('sessionDetailsModal').classList.remove('show');
}

function closeAllModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.classList.remove('show');
    });
}

async function submitUserForm(e) {
    e.preventDefault();

    const userId = document.getElementById('userId').value;
    const userData = {
        full_name: document.getElementById('fullName').value,
        email: document.getElementById('email').value,
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        roles: Array.from(document.querySelectorAll('input[name="roles"]:checked')).map(cb => cb.value)
    };

    const endpoint = userId ? `/api/admin/users/${userId}` : '/api/admin/users';
    const method = userId ? 'PUT' : 'POST';

    const result = await apiCall(endpoint, {
        method,
        body: JSON.stringify(userData)
    });

    if (result?.user || result?.success) {
        closeModal();
        loadAdminPanel();
        showToast('success', 'Success', `User ${userId ? 'updated' : 'created'} successfully`);
    } else {
        showToast('error', 'Error', result?.error || 'Failed to save user');
    }
}

// ============================================
// Report & Session Details
// ============================================
async function viewReport(tutorId) {
    const reportUrl = `/Sessions/${tutorId}/Quality_Report_RAG_${tutorId}.html`;

    // Check if report exists
    try {
        const response = await fetch(reportUrl, { method: 'HEAD' });
        if (response.ok) {
            document.getElementById('reportModalTitle').textContent = `Quality Report - ${tutorId}`;
            document.getElementById('reportFrame').src = reportUrl;
            document.getElementById('reportModal').classList.add('show');
        } else {
            showToast('warning', 'Report Not Found', `No report available for ${tutorId}`);
        }
    } catch {
        showToast('error', 'Error', 'Failed to load report');
    }
}

async function viewSessionDetails(sessionId) {
    const data = await apiCall(`/api/sessions/${sessionId}`);

    if (data?.session) {
        const session = data.session;
        const aiScore = session.ai_score || session.aiScore || 'N/A';
        const humanScore = session.human_score || session.humanScore || 'N/A';

        document.getElementById('sessionDetailsTitle').textContent = `Session Details - ${session.session_id || sessionId}`;
        document.getElementById('sessionDetailsContent').innerHTML = `
            <div class="session-info">
                <div class="info-grid">
                    <div class="info-item">
                        <label>Session ID</label>
                        <span>${session.session_id || 'N/A'}</span>
                    </div>
                    <div class="info-item">
                        <label>Tutor ID</label>
                        <span>${session.tutor_id || 'N/A'}</span>
                    </div>
                    <div class="info-item">
                        <label>Date</label>
                        <span>${session.session_date || session.date || 'N/A'}</span>
                    </div>
                    <div class="info-item">
                        <label>Time Slot</label>
                        <span>${session.time_slot || 'N/A'}</span>
                    </div>
                </div>
                
                <h4 class="mt-3 mb-2">Scores Comparison</h4>
                <div class="scores-grid">
                    <div class="score-box ai">
                        <div class="score-label"><i class="fas fa-robot"></i> AI Score</div>
                        <div class="score-value">${aiScore}</div>
                    </div>
                    <div class="score-box human">
                        <div class="score-label"><i class="fas fa-user"></i> Human Score</div>
                        <div class="score-value">${humanScore}</div>
                        <button class="btn-text btn-sm mt-1" onclick="editHumanScore('${session.session_id || session.id}', '${humanScore}')" style="font-size:11px; padding:2px 8px;">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                    </div>
                </div>
                
                <div class="status-section mt-3">
                    <label>Status</label>
                    <span class="badge badge-${session.status || 'pending'}">${formatStatus(session.status || 'pending')}</span>
                </div>
            </div>
            
            <style>
                .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
                .info-item { padding: 12px; background: var(--bg-tertiary); border-radius: 8px; }
                .info-item label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
                .info-item span { font-weight: 600; }
                .scores-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
                .score-box { padding: 20px; border-radius: 12px; text-align: center; }
                .score-box.ai { background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(139, 92, 246, 0.1)); }
                .score-box.human { background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(52, 211, 153, 0.1)); }
                .score-label { font-size: 14px; color: var(--text-secondary); margin-bottom: 8px; }
                .score-value { font-size: 36px; font-weight: 700; }
                .status-section { padding: 12px; background: var(--bg-tertiary); border-radius: 8px; }
                .status-section label { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 8px; }
            </style>
        `;
        document.getElementById('sessionDetailsModal').classList.add('show');
    } else {
        showToast('error', 'Error', 'Failed to load session details');
    }
}



// ============================================
// Export Functions
// ============================================
async function exportData(type, format) {
    showToast('info', 'Exporting', `Preparing ${type} export...`);

    const data = await apiCall(`/api/admin/export?type=${type}&format=${format}`);

    if (data) {
        const blob = new Blob([format === 'json' ? JSON.stringify(data, null, 2) : data],
            { type: format === 'json' ? 'application/json' : 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${type}_export_${new Date().toISOString().split('T')[0]}.${format}`;
        a.click();
        URL.revokeObjectURL(url);

        showToast('success', 'Export Complete', `${type} data downloaded successfully`);
    }
}

function exportFullReport() {
    showToast('info', 'Premium Feature', 'PDF report generation is a premium feature. Contact admin for access.');
}

// ============================================
// Utility Functions
// ============================================
function showToast(type, title, message) {
    const container = document.getElementById('toastContainer');
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-times-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon"><i class="fas ${icons[type]}"></i></div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

function showNotifications() {
    const panel = document.getElementById('notificationPanel');
    panel.classList.toggle('show');
}

function markAllRead() {
    document.querySelectorAll('.notification-item.unread').forEach(item => {
        item.classList.remove('unread');
    });
    document.querySelector('.notification-badge').style.display = 'none';
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    sidebar.classList.toggle('open');
}

function toggleUserMenu() {
    const menu = document.getElementById('userMenu');
    menu.classList.toggle('show');
}

function toggleTheme() {
    document.body.classList.toggle('dark-theme');
    const icon = document.querySelector('.theme-toggle i');
    icon.classList.toggle('fa-moon');
    icon.classList.toggle('fa-sun');
}

function showSettings() {
    showToast('info', 'Settings', 'Settings panel coming soon!');
}

function showProfile() {
    showToast('info', 'Profile', 'Profile panel coming soon!');
}

function animateValue(elementId, start, end, duration) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;

    const timer = setInterval(() => {
        current += increment;
        if ((increment > 0 && current >= end) || (increment < 0 && current <= end)) {
            current = end;
            clearInterval(timer);
        }
        element.textContent = Math.round(current);
    }, 16);
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function handleGlobalSearch(e) {
    const query = e.target.value.toLowerCase();
    if (query.length < 2) return;

    // Navigate to sessions page with search
    navigateTo('sessions');
    document.getElementById('searchSessions').value = query;
    applySessionFilters();
}

// ============================================
// Socket.IO & Real-time Updates
// ============================================
function setupSocketListeners() {
    if (typeof io !== 'function') {
        console.warn('Socket.IO not loaded');
        return;
    }

    socket = io();

    socket.on('connect', () => {
        console.log('Connected to real-time server');
        refreshQueueStatus();
    });

    socket.on('queueStatus', (status) => {
        updateQueueStatus(status);
    });

    socket.on('sessionUpdate', (session) => {
        console.log('Session Update:', session);
        if (currentPage === 'sessions') {
            loadSessions();
        } else if (currentPage === 'dashboard') {
            loadDashboardData();
        }
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from real-time server');
    });
}

function updateQueueStatus(status) {
    const bar = document.getElementById('queueStatusBar');
    if (!bar) return;

    const queueCount = document.getElementById('queueCount');
    const processingCount = document.getElementById('processingCount');

    if (status.queued > 0 || status.processing > 0) {
        bar.classList.remove('hidden');
        queueCount.textContent = status.queued;
        processingCount.textContent = status.processing;
    } else {
        bar.classList.add('hidden');
    }
}

function refreshQueueStatus() {
    apiCall('/api/queue/status').then(status => {
        if (status) updateQueueStatus(status);
    });
}

// ============================================
// File Upload
// ============================================
function setupUploadListeners() {
    const dropzone = document.getElementById('uploadZone');
    const input = document.getElementById('csvUploadInput');

    if (!dropzone || !input) return;

    dropzone.addEventListener('click', () => input.click());

    input.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleCSVUpload(e.target.files[0]);
        }
    });

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) {
            handleCSVUpload(e.dataTransfer.files[0]);
        }
    });
}

async function handleCSVUpload(file) {
    if (!file.name.endsWith('.csv')) {
        showToast('error', 'Invalid File', 'Please upload a CSV file');
        return;
    }

    const progressEl = document.getElementById('uploadProgress');
    const progressBar = progressEl.querySelector('.progress-bar');
    const contentEl = document.querySelector('.upload-content');

    contentEl.classList.add('hidden');
    progressEl.classList.remove('hidden');
    progressBar.style.width = '0%';

    const formData = new FormData();
    formData.append('csvFile', file);

    try {
        let w = 10;
        const timer = setInterval(() => {
            w += 10;
            if (w > 90) clearInterval(timer);
            progressBar.style.width = `${w}%`;
        }, 200);

        const response = await fetch('/api/upload-csv', {
            method: 'POST',
            body: formData,
            headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
        });

        clearInterval(timer);
        progressBar.style.width = '100%';

        const result = await response.json();

        if (response.ok) {
            showToast('success', 'Upload Successful', result.message);
            loadSessions();
        } else {
            showToast('error', 'Upload Failed', result.error || 'Unknown error');
        }
    } catch (error) {
        showToast('error', 'Error', 'Failed to upload file');
        console.error(error);
    } finally {
        setTimeout(() => {
            progressEl.classList.add('hidden');
            contentEl.classList.remove('hidden');
        }, 1500);
    }
}

// ============================================
// Actions
// ============================================
async function retryAnalysis(sessionId) {
    if (!confirm('Are you sure you want to retry analysis for this session?')) return;

    showToast('info', 'Queuing Analysis', 'Adding session to analysis queue...');

    try {
        const result = await apiCall(`/api/sessions/analyze/${sessionId}`, { method: 'POST' });
        if (result?.success) {
            showToast('success', 'Queued', 'Session added to analysis queue');
        } else {
            showToast('error', 'Failed', result?.error || 'Could not queue session');
        }
    } catch (e) {
        showToast('error', 'Error', 'Failed to reach server');
    }
}



function downloadReport() {
    const frame = document.getElementById('reportFrame');
    if (frame.src) {
        window.open(frame.src, '_blank');
    }
}

// Export for use in inline handlers
window.quickLogin = quickLogin;
window.togglePassword = togglePassword;
window.viewReport = viewReport;
window.viewSessionDetails = viewSessionDetails;
window.retryAnalysis = retryAnalysis;
window.showAdminTab = showAdminTab;
window.showAddUserModal = showAddUserModal;
window.closeModal = closeModal;
window.closeReportModal = closeReportModal;
window.closeSessionDetailsModal = closeSessionDetailsModal;
window.submitUserForm = submitUserForm;
window.loadAuditLogs = loadAuditLogs;
window.exportData = exportData;
window.exportFullReport = exportFullReport;
window.navigateTo = navigateTo;
window.setTutorView = setTutorView;
window.showNotifications = showNotifications;
window.markAllRead = markAllRead;
window.toggleSidebar = toggleSidebar;
window.toggleUserMenu = toggleUserMenu;
window.toggleTheme = toggleTheme;
window.showSettings = showSettings;
window.showProfile = showProfile;
window.refreshQueueStatus = refreshQueueStatus;
window.downloadReport = downloadReport;
window.updateQueueStatus = updateQueueStatus;
window.handleCSVUpload = handleCSVUpload;
// New function for editing score
async function editHumanScore(sessionId, currentScore) {
    const newScore = prompt('Enter new Human Overall Score (0-100):', currentScore !== 'N/A' ? currentScore : '');
    if (newScore === null) return;

    const score = parseInt(newScore);
    if (isNaN(score) || score < 0 || score > 100) {
        showToast('error', 'Invalid Input', 'Score must be between 0 and 100');
        return;
    }

    showToast('info', 'Updating', 'Submitting new score...');

    const result = await apiCall('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
            session_id: sessionId,
            overall_score: score,
            scores: {},
            comments: 'Quick score update from dashboard',
            quality_notes: ''
        })
    });

    if (result) {
        showToast('success', 'Updated', 'Human score updated');
        closeSessionDetailsModal();
        loadSessions();
        // Also update details if still open? No, we closed it.
    }
}

window.editHumanScore = editHumanScore;
window.bulkAssignSessions = () => showToast('info', 'Bulk Assign', 'Select sessions and a reviewer to assign');
