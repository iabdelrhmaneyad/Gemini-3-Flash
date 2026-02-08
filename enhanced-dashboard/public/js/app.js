// API Configuration
const API_URL = window.location.origin;
let authToken = localStorage.getItem('authToken');
let currentUser = null;

// API Helper
async function apiCall(endpoint, options = {}) {
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

    return response.json();
}

// Authentication
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');

    try {
        const data = await apiCall('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        if (data.token) {
            authToken = data.token;
            localStorage.setItem('authToken', authToken);
            currentUser = data.user;
            showDashboard();
        } else {
            errorEl.textContent = data.error || 'Login failed';
            errorEl.classList.add('show');
        }
    } catch (error) {
        errorEl.textContent = 'Connection error';
        errorEl.classList.add('show');
    }
});

function logout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('mainDashboard').style.display = 'none';
}

document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
});

// Show Dashboard
function showDashboard() {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainDashboard').style.display = 'flex';
    
    // Display user info
    document.getElementById('userInfo').textContent = 
        `${currentUser.full_name} (${currentUser.roles.join(', ')})`;
    
    // Show admin menu items if user is admin
    if (currentUser.roles.includes('admin')) {
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = 'flex';
        });
    }
    
    // Load initial data
    loadDashboardData();
}

// Navigation
document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const page = item.dataset.page;
        
        // Update active nav
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        // Update page title
        const titles = {
            'dashboard': 'Dashboard',
            'sessions': 'Sessions',
            'tutors': 'Tutors',
            'reviews': 'Reviews',
            'ai-comparison': 'AI vs Human Comparison',
            'analytics': 'Analytics',
            'admin': 'Admin Panel',
            'audit': 'Audit Logs',
            'export': 'Export Data'
        };
        document.getElementById('pageTitle').textContent = titles[page];
        
        // Show page
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById(`${page}Page`).classList.add('active');
        
        // Load page data
        loadPageData(page);
    });
});

// Load Dashboard Data
async function loadDashboardData() {
    const stats = await apiCall('/api/analytics/dashboard');
    
    if (stats) {
        document.getElementById('totalSessions').textContent = stats.total_sessions || 0;
        document.getElementById('completedSessions').textContent = stats.completed_sessions || 0;
        document.getElementById('pendingSessions').textContent = stats.pending_sessions || 0;
        document.getElementById('averageScore').textContent = 
            stats.average_score ? Math.round(stats.average_score) : 0;
        document.getElementById('agreementRate').textContent = 
            stats.ai_human_agreement_rate ? `${Math.round(stats.ai_human_agreement_rate)}%` : '0%';
    }

    // Load recent activity
    const sessions = await apiCall('/api/sessions?status=completed');
    if (sessions && sessions.sessions) {
        displayRecentActivity(sessions.sessions.slice(0, 5));
    }
}

function displayRecentActivity(sessions) {
    const container = document.getElementById('recentActivity');
    if (!sessions || sessions.length === 0) {
        container.innerHTML = '<p>No recent activity</p>';
        return;
    }

    container.innerHTML = sessions.map(session => `
        <div style="padding: 10px 0; border-bottom: 1px solid #e0e0e0;">
            <strong>Session ${session.session_id || session.id}</strong>
            <br>
            <small>${session.session_date} - Score: ${session.human_score || session.ai_score || 'N/A'}</small>
        </div>
    `).join('');
}

// Load Page Data
async function loadPageData(page) {
    switch(page) {
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
        case 'admin':
            await loadAdminPanel();
            break;
        case 'audit':
            await loadAuditLogs();
            break;
        case 'export':
            loadExportPage();
            break;
        case 'analytics':
            await loadAnalytics();
            break;
    }
}

// Load Sessions
async function loadSessions() {
    const data = await apiCall('/api/sessions');
    const tutors = await apiCall('/api/tutors');
    
    if (data && data.sessions) {
        // Populate tutor filter
        const tutorFilter = document.getElementById('filterTutor');
        if (tutors && tutors.tutors) {
            tutorFilter.innerHTML = '<option value="">All Tutors</option>' +
                tutors.tutors.map(t => `<option value="${t.id}">${t.full_name}</option>`).join('');
        }

        displaySessionsTable(data.sessions);
    }
}

function displaySessionsTable(sessions) {
    const container = document.getElementById('sessionsTable');
    
    if (!sessions || sessions.length === 0) {
        container.innerHTML = '<p>No sessions found</p>';
        return;
    }

    container.innerHTML = `
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Session ID</th>
                    <th>Tutor ID</th>
                    <th>Time Slot</th>
                    <th>AI Score</th>
                    <th>Human Score</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${sessions.map(s => {
                    const hasAI = s.ai_score || s.aiScore;
                    const hasHuman = s.human_score || s.humanScore;
                    return `
                    <tr>
                        <td>${s.session_date || s.date || 'N/A'}</td>
                        <td>${s.session_id || 'N/A'}</td>
                        <td>${s.tutor_id || 'N/A'}</td>
                        <td>${s.time_slot || 'N/A'}</td>
                        <td>${hasAI ? (s.ai_score || s.aiScore) : '-'}</td>
                        <td>${hasHuman ? (s.human_score || s.humanScore) : '-'}</td>
                        <td><span class="badge badge-${s.status}">${s.status || 'pending'}</span></td>
                        <td>
                            <div class="action-buttons">
                                <button class="btn-small btn-primary" onclick="viewReport('${s.session_id}')" title="View AI Report">
                                    <i class="fas fa-file-alt"></i> Report
                                </button>
                                <button class="btn-small btn-info" onclick="viewSessionDetails('${s.id}')" title="View Details">
                                    <i class="fas fa-info-circle"></i> Details
                                </button>
                                ${s.status === 'failed' || !hasAI ? `
                                <button class="btn-small btn-warning" onclick="retryAnalysis('${s.session_id}')" title="Retry Analysis">
                                    <i class="fas fa-redo"></i> Retry
                                </button>
                                ` : ''}
                            </div>
                        </td>
                    </tr>
                `}).join('')}
            </tbody>
        </table>
    `;
}

// Load Tutors
async function loadTutors() {
    const data = await apiCall('/api/tutors');
    
    if (data && data.tutors) {
        displayTutorsGrid(data.tutors);
    }
}

function displayTutorsGrid(tutors) {
    const container = document.getElementById('tutorsGrid');
    
    container.innerHTML = `
        <div class="stats-grid">
            ${tutors.map(tutor => `
                <div class="stat-card">
                    <div class="stat-icon blue">
                        <i class="fas fa-user-tie"></i>
                    </div>
                    <div class="stat-info">
                        <h3>${tutor.tutor_code || tutor.id}</h3>
                        <p><strong>${tutor.full_name}</strong></p>
                        <p>${tutor.total_sessions || 0} sessions</p>
                        <p>Avg: ${tutor.average_score ? Math.round(tutor.average_score) : 0}</p>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// Load Reviews
async function loadReviews() {
    const data = await apiCall('/api/reviews/reviewers');
    
    if (data && data.reviewers) {
        displayReviewersGrid(data.reviewers);
    }
}

function displayReviewersGrid(reviewers) {
    const container = document.getElementById('reviewersGrid');
    
    container.innerHTML = `
        <div class="stats-grid">
            ${reviewers.map(reviewer => `
                <div class="stat-card">
                    <div class="stat-icon purple">
                        <i class="fas fa-user-check"></i>
                    </div>
                    <div class="stat-info">
                        <h3>${reviewer.total_reviews}</h3>
                        <p><strong>${reviewer.full_name}</strong></p>
                        <p>${reviewer.email}</p>
                        <p>Avg Score: ${reviewer.average_score}</p>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// Load AI Comparison
async function loadAIComparison() {
    const data = await apiCall('/api/analytics/ai-human-comparison');
    
    if (data) {
        displayAIComparison(data);
    }
}

function displayAIComparison(data) {
    const container = document.getElementById('comparisonCharts');
    
    container.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-info">
                    <h3>${data.total_comparisons || 0}</h3>
                    <p>Total Comparisons</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info">
                    <h3>${data.agreement_rate || 0}%</h3>
                    <p>Agreement Rate</p>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-info">
                    <h3>${data.average_difference || 0}</h3>
                    <p>Average Difference</p>
                </div>
            </div>
        </div>
        
        <div class="chart-card" style="margin-top: 20px;">
            <h3>Difference Distribution</h3>
            <canvas id="diffChart" width="400" height="200"></canvas>
        </div>
    `;

    // Create chart
    if (data.difference_distribution) {
        const ctx = document.getElementById('diffChart').getContext('2d');
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Object.keys(data.difference_distribution),
                datasets: [{
                    label: 'Number of Sessions',
                    data: Object.values(data.difference_distribution),
                    backgroundColor: 'rgba(102, 126, 234, 0.6)'
                }]
            }
        });
    }
}

// Load Analytics (Enhanced BI Dashboard)
async function loadAnalytics() {
    const [performanceData, sessionsData] = await Promise.all([
        apiCall('/api/analytics/tutor-performance'),
        apiCall('/api/sessions')
    ]);
    
    if (performanceData && performanceData.performance && sessionsData && sessionsData.sessions) {
        displayBIDashboard(performanceData.performance, sessionsData.sessions);
    }
}

function displayBIDashboard(performance, sessions) {
    const container = document.getElementById('analyticsContent');
    
    // Calculate KPIs
    const totalSessions = sessions.length;
    const completedSessions = sessions.filter(s => s.status === 'completed').length;
    const scores = sessions.filter(s => s.ai_score || s.human_score)
                          .map(s => s.human_score || s.ai_score);
    const avgScore = scores.length ? Math.round(scores.reduce((a,b) => a+b, 0) / scores.length) : 0;
    const passRate = totalSessions ? Math.round((sessions.filter(s => (s.human_score || s.ai_score) >= 80).length / totalSessions) * 100) : 0;

    container.innerHTML = `
        <div class="bi-dashboard">
            <!-- Executive Summary -->
            <section class="executive-summary">
                <h3 class="section-title"><i class="fas fa-chart-line"></i> Performance Overview</h3>
                <div class="kpi-grid">
                    <div class="kpi-card" style="border-left: 4px solid #4834d4;">
                        <div class="kpi-icon" style="background: rgba(72, 52, 212, 0.1); color: #4834d4;">
                            <i class="fas fa-chalkboard-teacher fa-2x"></i>
                        </div>
                        <div class="kpi-content">
                            <h3>${totalSessions}</h3>
                            <p>Total Sessions Analyzed</p>
                            <span class="kpi-trend positive"><i class="fas fa-arrow-up"></i> 12% vs last month</span>
                        </div>
                    </div>

                    <div class="kpi-card" style="border-left: 4px solid #6ab04c;">
                        <div class="kpi-icon" style="background: rgba(106, 176, 76, 0.1); color: #6ab04c;">
                            <i class="fas fa-star fa-2x"></i>
                        </div>
                        <div class="kpi-content">
                            <h3>${avgScore}%</h3>
                            <p>Average Quality Score</p>
                            <span class="kpi-trend ${avgScore >= 90 ? 'positive' : 'neutral'}">Target: 90%</span>
                        </div>
                    </div>

                    <div class="kpi-card" style="border-left: 4px solid #eb4d4b;">
                        <div class="kpi-icon" style="background: rgba(235, 77, 75, 0.1); color: #eb4d4b;">
                            <i class="fas fa-check-circle fa-2x"></i>
                        </div>
                        <div class="kpi-content">
                            <h3>${passRate}%</h3>
                            <p>Pass Rate (>80%)</p>
                            <span class="kpi-trend ${passRate >= 85 ? 'positive' : 'neutral'}">Stable</span>
                        </div>
                    </div>
                    
                    <div class="kpi-card" style="border-left: 4px solid #e056fd;">
                        <div class="kpi-icon" style="background: rgba(224, 86, 253, 0.1); color: #e056fd;">
                            <i class="fas fa-users fa-2x"></i>
                        </div>
                        <div class="kpi-content">
                            <h3>${performance.length}</h3>
                            <p>Active Tutors</p>
                            <span class="kpi-trend neutral">All Categories</span>
                        </div>
                    </div>
                </div>
            </section>

            <!-- Charts Grid -->
            <div class="charts-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 30px;">
                <div class="chart-card glass-panel" style="padding: 20px; border-radius: 12px;">
                    <h4 class="chart-title" style="margin-bottom: 15px;">Score Distribution</h4>
                    <canvas id="scoreDistChart"></canvas>
                </div>
                <div class="chart-card glass-panel" style="padding: 20px; border-radius: 12px;">
                    <h4 class="chart-title" style="margin-bottom: 15px;">Evaluation Categories (SAPTCF)</h4>
                    <canvas id="radarChart"></canvas>
                </div>
            </div>

            <div class="chart-card glass-panel" style="padding: 20px; border-radius: 12px; margin-bottom: 30px;">
                <h4 class="chart-title" style="margin-bottom: 15px;">Performance Trend (Last 7 Days)</h4>
                <canvas id="trendChart" height="80"></canvas>
            </div>

            <!-- Detailed Table -->
            <section class="detailed-metrics">
                <h3 class="section-title"><i class="fas fa-list"></i> Detailed Tutor Performance</h3>
                <div style="overflow-x: auto;">
                    <table class="styled-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background-color: #f8f9fa;">
                                <th style="padding: 12px; text-align: left;">Tutor</th>
                                <th style="padding: 12px; text-align: center;">Sessions</th>
                                <th style="padding: 12px; text-align: center;">Completed</th>
                                <th style="padding: 12px; text-align: center;">Avg Score</th>
                                <th style="padding: 12px; text-align: center;">Performance</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${performance.map(p => {
                                const score = parseFloat(p.average_score);
                                let badgeClass = 'bg-red-100 text-red-800';
                                if (score >= 90) badgeClass = 'bg-green-100 text-green-800';
                                else if (score >= 80) badgeClass = 'bg-blue-100 text-blue-800';
                                
                                return `
                                <tr style="border-bottom: 1px solid #eee;">
                                    <td style="padding: 12px;">
                                        <div style="display: flex; align-items: center; gap: 10px;">
                                            <div style="width: 30px; height: 30px; background: #e0e0e0; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px;">${p.tutor_code.substring(0,2)}</div>
                                            <div>
                                                <div style="font-weight: 600;">${p.full_name}</div>
                                                <div style="font-size: 11px; color: #777;">${p.tutor_code}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td style="padding: 12px; text-align: center;">${p.total_sessions}</td>
                                    <td style="padding: 12px; text-align: center;">${p.completed_sessions}</td>
                                    <td style="padding: 12px; text-align: center;">
                                        <strong style="font-size: 1.1em;">${score}</strong>
                                    </td>
                                    <td style="padding: 12px; text-align: center;">
                                        <div style="width: 100px; height: 6px; background: #eee; border-radius: 3px; display: inline-block;">
                                            <div style="width: ${score}%; height: 100%; background: ${score >= 90 ? '#2ecc71' : (score >= 80 ? '#3498db' : '#e74c3c')}; border-radius: 3px;"></div>
                                        </div>
                                    </td>
                                </tr>
                            `}).join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    `;

    // Initialize Charts
    initBICharts(sessions);
}

function initBICharts(sessions) {
    const scores = sessions.filter(s => s.ai_score || s.human_score).map(s => s.human_score || s.ai_score);
    
    // Distribution Data
    const distribution = {
        '90-100%': scores.filter(s => s >= 90).length,
        '80-89%': scores.filter(s => s >= 80 && s < 90).length,
        '70-79%': scores.filter(s => s >= 70 && s < 80).length,
        '< 70%': scores.filter(s => s < 70).length
    };

    // Score Distribution Chart
    new Chart(document.getElementById('scoreDistChart'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(distribution),
            datasets: [{
                data: Object.values(distribution),
                backgroundColor: ['#2ecc71', '#3498db', '#f1c40f', '#e74c3c'],
                borderWidth: 0
            }]
        },
        options: {
            plugins: {
                legend: { position: 'right' }
            },
            responsive: true,
            maintainAspectRatio: false
        }
    });

    // Radar Chart (Simulated categories as we don't have this granular data in API list yet, 
    // real implementation would pull from session details)
    new Chart(document.getElementById('radarChart'), {
        type: 'radar',
        data: {
            labels: ['Setup', 'Attitude', 'Preparation', 'Time', 'Content', 'Feedback'],
            datasets: [{
                label: 'System Average',
                data: [95, 92, 88, 85, 90, 87],
                fill: true,
                backgroundColor: 'rgba(54, 162, 235, 0.2)',
                borderColor: 'rgb(54, 162, 235)',
                pointBackgroundColor: 'rgb(54, 162, 235)',
                pointBorderColor: '#fff',
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderColor: 'rgb(54, 162, 235)'
            }]
        },
        options: {
            elements: { line: { borderWidth: 3 } },
            scales: { r: { min: 0, max: 100 } }
        }
    });

    // Trend Chart (Simulated 7 days)
    new Chart(document.getElementById('trendChart'), {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Average Quality Score',
                data: [82, 85, 84, 88, 90, 92, 91],
                fill: true,
                backgroundColor: 'rgba(106, 176, 76, 0.1)',
                borderColor: '#6ab04c',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: { min: 60, max: 100 }
            }
        }
    });

}

// Refresh Button
document.getElementById('refreshBtn')?.addEventListener('click', () => {
    const activePage = document.querySelector('.nav-item.active').dataset.page;
    if (activePage === 'dashboard') {
        loadDashboardData();
    } else {
        loadPageData(activePage);
    }
});

// Apply Filters
document.getElementById('applyFilters')?.addEventListener('click', async () => {
    const status = document.getElementById('filterStatus').value;
    const tutor = document.getElementById('filterTutor').value;
    
    let url = '/api/sessions?';
    if (status) url += `status=${status}&`;
    if (tutor) url += `tutor_id=${tutor}`;
    
    const data = await apiCall(url);
    if (data && data.sessions) {
        displaySessionsTable(data.sessions);
    }
});

// Check if already logged in
if (authToken) {
    (async () => {
        const data = await apiCall('/api/auth/me');
        if (data && data.user) {
            currentUser = data.user;
            showDashboard();
        } else {
            logout();
        }
    })();
}

// =============================
// ADMIN PANEL FUNCTIONS
// =============================

let allUsers = [];
let allAuditLogs = [];

// Load Admin Panel
async function loadAdminPanel() {
    // Load users first
    await loadAdminUsers();
    
    // Show users tab by default
    showAdminTab('users');
}

// Show Admin Tab
function showAdminTab(tab) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-tab') === tab) {
            btn.classList.add('active');
        }
    });
    
    // Show/hide tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none';
    });
    document.getElementById(`${tab}Tab`).style.display = 'block';
    
    // Load data for specific tab
    if (tab === 'bulk') {
        loadBulkSessions();
    } else if (tab === 'system') {
        loadSystemStats();
    }
}

// Load Admin Users
async function loadAdminUsers() {
    const data = await apiCall('/api/admin/users');
    if (data && data.users) {
        allUsers = data.users;
        renderUsers();
    }
}

// Render Users
function renderUsers() {
    const container = document.getElementById('usersGrid');
    if (!allUsers || allUsers.length === 0) {
        container.innerHTML = '<p>No users found</p>';
        return;
    }
    
    container.innerHTML = allUsers.map(user => `
        <div class="user-card">
            <div class="user-info">
                <h4>${user.full_name}</h4>
                <p><strong>Email:</strong> ${user.email}</p>
                <p><strong>Username:</strong> ${user.username}</p>
                <p><strong>Roles:</strong> ${user.roles.map(r => `<span class="badge">${r}</span>`).join(' ')}</p>
                <p><strong>Status:</strong> <span class="badge ${user.is_active ? 'badge-active' : 'badge-inactive'}">${user.is_active ? 'Active' : 'Inactive'}</span></p>
                <p class="text-small">Created: ${new Date(user.created_at).toLocaleDateString()}</p>
            </div>
            <div class="user-actions">
                <button class="btn-small btn-primary" onclick="editUser(${user.id})">
                    <i class="fas fa-edit"></i> Edit
                </button>
                <button class="btn-small btn-danger" onclick="deleteUser(${user.id})">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </div>
        </div>
    `).join('');
}

// Show Add User Modal
function showAddUserModal() {
    document.getElementById('modalTitle').textContent = 'Add New User';
    document.getElementById('userId').value = '';
    document.getElementById('userForm').reset();
    
    // Uncheck all roles
    document.querySelectorAll('input[name="roles"]').forEach(cb => cb.checked = false);
    
    document.getElementById('userModal').style.display = 'flex';
}

// Edit User
function editUser(userId) {
    const user = allUsers.find(u => u.id === userId);
    if (!user) return;
    
    document.getElementById('modalTitle').textContent = 'Edit User';
    document.getElementById('userId').value = user.id;
    document.getElementById('fullName').value = user.full_name;
    document.getElementById('email').value = user.email;
    document.getElementById('username').value = user.username;
    document.getElementById('password').value = ''; // Don't show password
    document.getElementById('password').placeholder = 'Leave blank to keep current';
    
    // Check user roles
    document.querySelectorAll('input[name="roles"]').forEach(cb => {
        cb.checked = user.roles.includes(cb.value);
    });
    
    document.getElementById('userModal').style.display = 'flex';
}

// Delete User
async function deleteUser(userId) {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
        return;
    }
    
    const data = await apiCall(`/api/admin/users/${userId}`, 'DELETE');
    if (data && data.message) {
        alert(data.message);
        await loadAdminUsers();
    }
}

// Close Modal
function closeModal() {
    document.getElementById('userModal').style.display = 'none';
}

// Submit User Form
async function submitUserForm(event) {
    event.preventDefault();
    
    const userId = document.getElementById('userId').value;
    const formData = {
        full_name: document.getElementById('fullName').value,
        email: document.getElementById('email').value,
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        roles: Array.from(document.querySelectorAll('input[name="roles"]:checked')).map(cb => cb.value)
    };
    
    // Remove password if empty (for edit)
    if (!formData.password) {
        delete formData.password;
    }
    
    let data;
    if (userId) {
        // Update existing user
        data = await apiCall(`/api/admin/users/${userId}`, 'PUT', formData);
    } else {
        // Create new user
        data = await apiCall('/api/admin/users', 'POST', formData);
    }
    
    if (data && data.message) {
        alert(data.message);
        closeModal();
        await loadAdminUsers();
    }
}

// Load Bulk Sessions
async function loadBulkSessions() {
    const data = await apiCall('/api/sessions?status=pending');
    if (data && data.sessions) {
        renderBulkSessions(data.sessions);
    }
}

// Render Bulk Sessions
function renderBulkSessions(sessions) {
    const container = document.getElementById('sessionsList');
    if (!sessions || sessions.length === 0) {
        container.innerHTML = '<p>No pending sessions found</p>';
        return;
    }
    
    container.innerHTML = sessions.map(session => `
        <div class="checkbox-item">
            <input type="checkbox" id="session-${session.id}" value="${session.id}">
            <label for="session-${session.id}">
                ${session.session_id} - ${session.tutor_name} (${new Date(session.session_date).toLocaleDateString()})
            </label>
        </div>
    `).join('');
    
    // Load reviewers for dropdown
    loadReviewers();
}

// Load Reviewers
async function loadReviewers() {
    if (allUsers.length === 0) {
        await loadAdminUsers();
    }
    
    const reviewers = allUsers.filter(u => u.roles.includes('reviewer'));
    const select = document.getElementById('reviewerSelect');
    select.innerHTML = '<option value="">Select Reviewer...</option>' + 
        reviewers.map(r => `<option value="${r.id}">${r.full_name}</option>`).join('');
}

// Bulk Assign Sessions
async function bulkAssignSessions() {
    const selectedSessions = Array.from(document.querySelectorAll('#sessionsList input[type="checkbox"]:checked'))
        .map(cb => parseInt(cb.value));
    
    const reviewerId = parseInt(document.getElementById('reviewerSelect').value);
    
    if (selectedSessions.length === 0) {
        alert('Please select at least one session');
        return;
    }
    
    if (!reviewerId) {
        alert('Please select a reviewer');
        return;
    }
    
    const data = await apiCall('/api/admin/bulk-assign', 'POST', {
        session_ids: selectedSessions,
        reviewer_id: reviewerId
    });
    
    if (data) {
        alert(`Assigned ${data.successful} sessions successfully. ${data.failed} failed.`);
        await loadBulkSessions();
    }
}

// Load System Stats
async function loadSystemStats() {
    const data = await apiCall('/api/admin/system-stats');
    if (data) {
        // Update stat cards
        document.getElementById('totalUsers').textContent = data.total_users || 0;
        document.getElementById('totalSessions').textContent = data.total_sessions || 0;
        document.getElementById('totalReviews').textContent = data.total_reviews || 0;
        document.getElementById('totalAuditLogs').textContent = data.total_audit_logs || 0;
        
        // Render activity chart
        if (data.activity_by_day && data.activity_by_day.length > 0) {
            renderActivityChart(data.activity_by_day);
        }
        
        // Render user activity table
        if (data.user_activity && data.user_activity.length > 0) {
            renderUserActivity(data.user_activity);
        }
    }
}

// Render Activity Chart
function renderActivityChart(activityData) {
    const ctx = document.getElementById('activityChart');
    if (!ctx) return;
    
    const labels = activityData.map(d => new Date(d.date).toLocaleDateString());
    const data = activityData.map(d => d.actions);
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Actions per Day',
                data: data,
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

// Render User Activity
function renderUserActivity(userActivity) {
    const tbody = document.getElementById('userActivityTable');
    if (!tbody) return;
    
    tbody.innerHTML = userActivity.map(ua => `
        <tr>
            <td>${ua.full_name}</td>
            <td>${ua.email}</td>
            <td>${ua.total_actions}</td>
            <td>${new Date(ua.last_action).toLocaleString()}</td>
        </tr>
    `).join('');
}

// =============================
// AUDIT LOGS FUNCTIONS
// =============================

// Load Audit Logs
async function loadAuditLogs() {
    const actionFilter = document.getElementById('actionFilter').value;
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;
    
    let url = '/api/admin/audit-logs?';
    if (actionFilter) url += `action=${actionFilter}&`;
    if (dateFrom) url += `date_from=${dateFrom}&`;
    if (dateTo) url += `date_to=${dateTo}&`;
    
    const data = await apiCall(url);
    if (data && data.logs) {
        allAuditLogs = data.logs;
        renderAuditLogs();
    }
}

// Render Audit Logs
function renderAuditLogs() {
    const tbody = document.getElementById('auditLogsTable');
    if (!allAuditLogs || allAuditLogs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No audit logs found</td></tr>';
        return;
    }
    
    tbody.innerHTML = allAuditLogs.map(log => `
        <tr>
            <td>${new Date(log.timestamp).toLocaleString()}</td>
            <td>${log.user_full_name || 'System'}</td>
            <td><span class="badge">${log.action}</span></td>
            <td>${log.resource_type}</td>
            <td>${log.resource_id || 'N/A'}</td>
            <td class="text-small">${log.details || ''}</td>
        </tr>
    `).join('');
}

// =============================
// EXPORT FUNCTIONS
// =============================

// Load Export Page
function loadExportPage() {
    // Just show the page, export happens on button click
}

// Export Data
async function exportData(type, format) {
    const url = `/api/admin/export?type=${type}&format=${format}`;
    
    if (format === 'csv') {
        // Download CSV
        window.location.href = API_BASE_URL + url;
    } else {
        // Show JSON
        const data = await apiCall(url);
        if (data) {
            const pre = document.createElement('pre');
            pre.textContent = JSON.stringify(data, null, 2);
            
            const win = window.open('', '_blank');
            win.document.write('<html><head><title>Export Data</title></head><body>');
            win.document.write(pre.outerHTML);
            win.document.write('</body></html>');
        }
    }
}

// Export CSV from Current Page
function exportCurrentPageCSV() {
    const currentPage = document.querySelector('.page:not([style*="display: none"])').id.replace('Page', '');
    
    switch(currentPage) {
        case 'sessions':
            exportData('sessions', 'csv');
            break;
        case 'tutors':
            exportData('tutors', 'csv');
            break;
        case 'reviews':
            exportData('reviews', 'csv');
            break;
        default:
            alert('CSV export not available for this page');
    }
}

// =============================
// EVENT LISTENERS
// =============================

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('userModal');
    const reportModal = document.getElementById('reportModal');
    const detailsModal = document.getElementById('sessionDetailsModal');
    
    if (event.target === modal) {
        closeModal();
    }
    if (event.target === reportModal) {
        closeReportModal();
    }
    if (event.target === detailsModal) {
        closeSessionDetailsModal();
    }
}

// =============================
// REPORT MODAL FUNCTIONS
// =============================

// View Report
async function viewReport(sessionId) {
    try {
        // Find session to get tutor_id
        const response = await apiCall('/api/sessions');
        if (!response || !response.sessions) {
            alert('Unable to load sessions');
            return;
        }
        
        const session = response.sessions.find(s => s.session_id === sessionId);
        if (!session) {
            alert('Session not found');
            return;
        }
        
        const tutorId = session.tutor_id;
        
        // Check if report exists
        const checkResponse = await apiCall(`/api/reports/check/${tutorId}`);
        if (!checkResponse || !checkResponse.exists) {
            alert(`Report not found for ${tutorId}.\n\nThe report may not have been generated yet.`);
            return;
        }
        
        // Load report in iframe
        const reportFrame = document.getElementById('reportFrame');
        reportFrame.src = `/Sessions/${tutorId}/Quality_Report_RAG_${tutorId}.html`;
        
        // Show modal
        document.getElementById('reportModalTitle').textContent = `Quality Report - ${tutorId}`;
        document.getElementById('reportModal').style.display = 'flex';
        
    } catch (error) {
        console.error('Error loading report:', error);
        alert('Error loading report');
    }
}

// Close Report Modal
function closeReportModal() {
    document.getElementById('reportModal').style.display = 'none';
    document.getElementById('reportFrame').src = '';
}

// =============================
// SESSION DETAILS MODAL
// =============================

// View Session Details
async function viewSessionDetails(sessionId) {
    try {
        const response = await apiCall(`/api/sessions/${sessionId}`);
        if (!response) {
            alert('Session not found');
            return;
        }
        
        const session = response.session || response;
        
        // Get AI analysis and human reviews
        const aiResponse = await apiCall(`/api/ai-analyses?session_id=${sessionId}`);
        const humanResponse = await apiCall(`/api/reviews?session_id=${sessionId}`);
        
        const aiAnalysis = aiResponse?.ai_analyses?.[0];
        const humanReview = humanResponse?.reviews?.[0];
        
        // Build details HTML
        let detailsHTML = `
            <div class="session-details">
                <div class="detail-section">
                    <h4>📋 Session Information</h4>
                    <p><strong>Session ID:</strong> ${session.session_id}</p>
                    <p><strong>Tutor ID:</strong> ${session.tutor_id}</p>
                    <p><strong>Date:</strong> ${session.date || 'N/A'}</p>
                    <p><strong>Time Slot:</strong> ${session.time_slot || 'N/A'}</p>
                    <p><strong>Status:</strong> <span class="badge badge-${session.status}">${session.status}</span></p>
                </div>
                
                <div class="scores-comparison">
                    <div class="score-box ${aiAnalysis ? 'ai' : ''}">
                        <div class="score-label">🤖 AI Score</div>
                        <div class="score-value">${aiAnalysis?.overall_score || 'N/A'}</div>
                        ${aiAnalysis?.confidence_score ? `<div class="score-confidence">Confidence: ${aiAnalysis.confidence_score}%</div>` : ''}
                    </div>
                    
                    <div class="score-vs">VS</div>
                    
                    <div class="score-box ${humanReview ? 'human' : ''}">
                        <div class="score-label">👤 Human Score</div>
                        <div class="score-value">${humanReview?.overall_score || 'N/A'}</div>
                    </div>
                </div>
        `;
        
        // Add SAPTCF breakdown if available
        if (aiAnalysis && aiAnalysis.saptcf_scores) {
            detailsHTML += `
                <div class="detail-section">
                    <h4>📊 SAPTCF Analysis Breakdown</h4>
                    <div class="saptcf-grid">
                        <div class="saptcf-item">
                            <div class="letter">S</div>
                            <div class="score">${aiAnalysis.saptcf_scores.S || 0}</div>
                            <div class="label">Subject</div>
                        </div>
                        <div class="saptcf-item">
                            <div class="letter">A</div>
                            <div class="score">${aiAnalysis.saptcf_scores.A || 0}</div>
                            <div class="label">Approach</div>
                        </div>
                        <div class="saptcf-item">
                            <div class="letter">P</div>
                            <div class="score">${aiAnalysis.saptcf_scores.P || 0}</div>
                            <div class="label">Presentation</div>
                        </div>
                        <div class="saptcf-item">
                            <div class="letter">T</div>
                            <div class="score">${aiAnalysis.saptcf_scores.T || 0}</div>
                            <div class="label">Technology</div>
                        </div>
                        <div class="saptcf-item">
                            <div class="letter">C</div>
                            <div class="score">${aiAnalysis.saptcf_scores.C || 0}</div>
                            <div class="label">Communication</div>
                        </div>
                        <div class="saptcf-item">
                            <div class="letter">F</div>
                            <div class="score">${aiAnalysis.saptcf_scores.F || 0}</div>
                            <div class="label">Feedback</div>
                        </div>
                    </div>
                </div>
            `;
        }
        
        detailsHTML += '</div>';
        
        // Show modal
        document.getElementById('sessionDetailsTitle').textContent = `Session Details - ${session.session_id}`;
        document.getElementById('sessionDetailsContent').innerHTML = detailsHTML;
        document.getElementById('sessionDetailsModal').style.display = 'flex';
        
    } catch (error) {
        console.error('Error loading session details:', error);
        alert('Error loading session details');
    }
}

// Close Session Details Modal
function closeSessionDetailsModal() {
    document.getElementById('sessionDetailsModal').style.display = 'none';
    document.getElementById('sessionDetailsContent').innerHTML = '';
}

// =============================
// RETRY/REGENERATE ANALYSIS
// =============================

// Retry Analysis
async function retryAnalysis(sessionId) {
    if (!confirm(`Are you sure you want to regenerate the AI analysis for session ${sessionId}?\n\nThis will create a new analysis and may take several minutes.`)) {
        return;
    }
    
    try {
        alert('Analysis regeneration feature requires integration with the analysis Python script.\n\nThis feature will be available after connecting to the analysis service.');
        
        // TODO: Implement actual regeneration by calling the Python analysis script
        // const response = await apiCall(`/api/sessions/${sessionId}/regenerate`, 'POST');
        // if (response && response.success) {
        //     alert('Analysis regeneration started. This may take a few minutes.');
        //     await loadSessions();
        // }
    } catch (error) {
        console.error('Error regenerating analysis:', error);
        alert('Error regenerating analysis');
    }
}

// Make functions available globally
window.viewReport = viewReport;
window.closeReportModal = closeReportModal;
window.viewSessionDetails = viewSessionDetails;
window.closeSessionDetailsModal = closeSessionDetailsModal;
window.retryAnalysis = retryAnalysis;
