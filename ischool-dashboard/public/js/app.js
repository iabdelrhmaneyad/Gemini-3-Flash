// ===== Backend URL (configurable) =====
const BACKEND_URL_STORAGE_KEY = 'ischoolBackendUrl';

function normalizeBaseUrl(url) {
    if (!url) return '';
    return String(url).trim().replace(/\/+$/, '');
}

function getBackendBaseUrl() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('backend') || params.get('api') || params.get('backendUrl');
    const fromStorage = window.localStorage ? localStorage.getItem(BACKEND_URL_STORAGE_KEY) : '';
    const fromMeta = document.querySelector('meta[name="backend-url"]')?.getAttribute('content');
    const fromGlobal = window.BACKEND_URL || window.__BACKEND_URL__;

    // Default to previous local-dev behavior
    const fallback = `${window.location.protocol}//${window.location.hostname}:3000`;
    return normalizeBaseUrl(fromQuery || fromStorage || fromMeta || fromGlobal || fallback);
}

let API_BASE = getBackendBaseUrl();
const socket = io(API_BASE);

// ===== Connection Status UI =====
const connPill = document.getElementById('connPill');
const connText = document.getElementById('connText');
const backendConfigBtn = document.getElementById('backendConfigBtn');

let socketConnected = false;
let apiHealthy = false;
let lastApiError = '';

function renderConnectionStatus() {
    if (!connPill || !connText) return;

    connPill.classList.remove('ok', 'warn', 'bad');

    const baseLabel = API_BASE;
    const tooltipParts = [`Backend: ${baseLabel}`];
    if (lastApiError) tooltipParts.push(`API error: ${lastApiError}`);
    connPill.title = tooltipParts.join('\n');

    if (socketConnected && apiHealthy) {
        connPill.classList.add('ok');
        connText.textContent = 'Connected';
        return;
    }

    if (socketConnected && !apiHealthy) {
        connPill.classList.add('warn');
        connText.textContent = 'Socket OK • API?';
        return;
    }

    if (!socketConnected && apiHealthy) {
        connPill.classList.add('warn');
        connText.textContent = 'API OK • Socket?';
        return;
    }

    connPill.classList.add('bad');
    connText.textContent = 'Disconnected';
}

async function checkApiHealth() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
        // Lightweight endpoint (exists in our dashboard server)
        const resp = await fetch(`${API_BASE}/api/queue/status`, {
            method: 'GET',
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        });
        apiHealthy = resp.ok;
        lastApiError = resp.ok ? '' : `HTTP ${resp.status}`;
    } catch (e) {
        apiHealthy = false;
        lastApiError = e?.name === 'AbortError' ? 'Timeout' : (e?.message || 'Fetch error');
    } finally {
        clearTimeout(timeout);
        renderConnectionStatus();
    }
}

function startHealthPolling() {
    checkApiHealth();
    setInterval(checkApiHealth, 15000);
}

if (backendConfigBtn) {
    backendConfigBtn.addEventListener('click', () => {
        const current = API_BASE;
        const value = prompt(
            'Backend URL for API + Socket.IO\n\nExample:\nhttps://34.123.3.80.sslip.io\n\nLeave empty to reset to default.',
            current
        );

        if (value === null) return; // cancelled

        const next = normalizeBaseUrl(value);
        if (!next) {
            localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
        } else {
            localStorage.setItem(BACKEND_URL_STORAGE_KEY, next);
        }

        window.location.reload();
    });
}

// DOM Elements
const uploadZone = document.getElementById('uploadZone');
const csvFileInput = document.getElementById('csvFileInput');
const fileInfo = document.getElementById('fileInfo');
const progressSection = document.getElementById('progressSection');
const progressList = document.getElementById('progressList');
const sessionsTableBody = document.getElementById('sessionsTableBody');
const exportBtn = document.getElementById('exportBtn');
const resetBtn = document.getElementById('resetBtn');
const retryFailedBtn = document.getElementById('retryFailedBtn');
const auditModal = document.getElementById('auditModal');
const closeModal = document.getElementById('closeModal');
const cancelAudit = document.getElementById('cancelAudit');
const saveAudit = document.getElementById('saveAudit');

// New Feature Elements
const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');
const auditFilter = document.getElementById('auditFilter');
const selectAll = document.getElementById('selectAll');
const batchActions = document.getElementById('batchActions');
const selectedCount = document.getElementById('selectedCount');
const batchApprove = document.getElementById('batchApprove');
const batchReject = document.getElementById('batchReject');
const batchDelete = document.getElementById('batchDelete');
const videoModal = document.getElementById('videoModal');
const closeVideo = document.getElementById('closeVideo');
const videoPlayer = document.getElementById('videoPlayer');
const videoSource = document.getElementById('videoSource');
const videoTitle = document.getElementById('videoTitle');
const chartsSection = document.getElementById('chartsSection');

// Column Filters (Sheets-style)
const colFilterTutor = document.getElementById('colFilterTutor');
const colFilterInstructor = document.getElementById('colFilterInstructor');
const colFilterSession = document.getElementById('colFilterSession');
const colFilterDate = document.getElementById('colFilterDate');
const colFilterSlot = document.getElementById('colFilterSlot');
const colFilterHumanScore = document.getElementById('colFilterHumanScore');
const colFilterAiScore = document.getElementById('colFilterAiScore');
const colFilterStatus = document.getElementById('colFilterStatus');
const colFilterAnalysis = document.getElementById('colFilterAnalysis');
const colFilterProgress = document.getElementById('colFilterProgress');

[
    colFilterTutor,
    colFilterInstructor,
    colFilterSession,
    colFilterDate,
    colFilterSlot,
    colFilterHumanScore,
    colFilterAiScore,
    colFilterProgress
].forEach((el) => {
    if (el) el.addEventListener('input', applyFilters);
});
if (colFilterStatus) colFilterStatus.addEventListener('change', applyFilters);
if (colFilterAnalysis) colFilterAnalysis.addEventListener('change', applyFilters);

// State
let currentSessions = [];
let filteredSessions = [];
let selectedSessions = new Set();
let currentAuditSession = null;

// ===== Admin: Reset Dashboard =====
if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
        const typed = prompt('Type RESET to clear the dashboard (sessions/uploads).');
        if (!typed || typed.trim().toUpperCase() !== 'RESET') {
            showNotification('Reset cancelled', 'info');
            return;
        }

        const wipeDownloadedFiles = confirm('Also delete downloaded session files in the Sessions folder?\n\nPress OK to delete downloaded videos/transcripts/reports, or Cancel to keep them.');

        try {
            resetBtn.classList.add('loading');
            const response = await fetch(`${API_BASE}/api/admin/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmText: 'RESET', wipeDownloadedFiles })
            });

            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result.success) {
                throw new Error(result.error || 'Reset failed');
            }

            // Clear local UI state immediately
            currentSessions = [];
            filteredSessions = [];
            selectedSessions.clear();
            selectAll.checked = false;
            updateBatchActions();
            applyFilters();
            updateAnalytics();
            updateCharts();

            progressSection.style.display = 'none';
            chartsSection.style.display = 'none';
            progressList.innerHTML = '';

            showNotification('Dashboard reset successfully', 'success');
        } catch (error) {
            console.error('Reset error:', error);
            showNotification(`Reset failed: ${error.message}`, 'error');
        } finally {
            resetBtn.classList.remove('loading');
        }
    });
}

// ===== File Upload Handling =====
uploadZone.addEventListener('click', () => {
    csvFileInput.click();
});

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('drag-over');
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFileUpload(files[0]);
    }
});

csvFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFileUpload(e.target.files[0]);
    }
});

async function handleFileUpload(file) {
    if (!file.name.endsWith('.csv')) {
        showNotification('Please upload a CSV file', 'error');
        return;
    }

    fileInfo.textContent = `Selected: ${file.name}`;
    fileInfo.classList.add('active');

    const formData = new FormData();
    formData.append('csvFile', file);

    try {
        const response = await fetch(`${API_BASE}/api/upload-csv`, {
            method: 'POST',
            body: formData
        });

        const data = await response.json();

        if (data.success) {
            showNotification(`Successfully uploaded ${data.sessions.length} sessions`, 'success');
            progressSection.style.display = 'block';
            chartsSection.style.display = 'block';
        } else {
            showNotification('Error uploading file', 'error');
        }
    } catch (error) {
        console.error('Upload error:', error);
        showNotification('Error uploading file', 'error');
    }
}

// ===== Queue Status State =====
let queueStatus = {
    queued: 0,
    processing: 0,
    maxConcurrent: 3,
    completed: 0,
    failed: 0
};

// ===== Socket.IO Event Handlers =====
socket.on('connect', () => {
    socketConnected = true;
    renderConnectionStatus();
});

socket.on('disconnect', () => {
    socketConnected = false;
    renderConnectionStatus();
});

socket.on('sessionData', (sessions) => {
    currentSessions = sessions;
    applyFilters();
    updateAnalytics();
    updateCharts();
});

socket.on('activeSessions', (sessions) => {
    renderProgressList(sessions);
});

socket.on('sessionUpdate', (session) => {
    const index = currentSessions.findIndex(s => s.sessionId === session.sessionId);
    if (index !== -1) {
        currentSessions[index] = session;
    }

    applyFilters();
    updateProgressItem(session);
    updateAnalytics();
    updateCharts();
});

// Queue Status Handler
socket.on('queueStatus', (status) => {
    queueStatus = status;
    updateQueueStatusDisplay();
});

// Start connection checks
startHealthPolling();

function updateQueueStatusDisplay() {
    const processingEl = document.getElementById('queueProcessing');
    const maxEl = document.getElementById('queueMax');
    const waitingEl = document.getElementById('queueWaiting');
    const cardEl = document.getElementById('queueStatusCard');
    
    if (processingEl) processingEl.textContent = queueStatus.processing;
    if (maxEl) maxEl.textContent = queueStatus.maxConcurrent;
    if (waitingEl) {
        waitingEl.textContent = `${queueStatus.queued} waiting`;
        waitingEl.classList.toggle('empty', queueStatus.queued === 0);
    }
    
    // Animate card when processing
    if (cardEl) {
        cardEl.classList.toggle('active', queueStatus.processing > 0);
    }
    
    // Update queue info banner in progress section
    const bannerEl = document.getElementById('queueInfoBanner');
    const bannerProcessing = document.getElementById('queueBannerProcessing');
    const bannerWaiting = document.getElementById('queueBannerWaiting');
    const bannerCompleted = document.getElementById('queueBannerCompleted');
    const bannerTitle = document.getElementById('queueBannerTitle');
    const bannerDesc = document.getElementById('queueBannerDesc');
    
    if (bannerEl) {
        const isActive = queueStatus.processing > 0 || queueStatus.queued > 0;
        bannerEl.style.display = isActive ? 'flex' : 'none';
        bannerEl.classList.toggle('processing', queueStatus.processing > 0);
        
        if (bannerProcessing) bannerProcessing.textContent = queueStatus.processing;
        if (bannerWaiting) bannerWaiting.textContent = queueStatus.queued;
        if (bannerCompleted) bannerCompleted.textContent = queueStatus.completed;
        
        if (bannerTitle) {
            if (queueStatus.processing > 0) {
                bannerTitle.textContent = `🔄 Analyzing ${queueStatus.processing} session${queueStatus.processing > 1 ? 's' : ''}`;
            } else if (queueStatus.queued > 0) {
                bannerTitle.textContent = `⏳ ${queueStatus.queued} session${queueStatus.queued > 1 ? 's' : ''} waiting`;
            } else {
                bannerTitle.textContent = '✅ Queue Empty';
            }
        }
        
        if (bannerDesc) {
            bannerDesc.textContent = `Max ${queueStatus.maxConcurrent} concurrent analyses • ${queueStatus.failed} failed`;
        }
    }
}

// ===== Search & Filter =====
searchInput.addEventListener('input', applyFilters);
statusFilter.addEventListener('change', applyFilters);
auditFilter.addEventListener('change', applyFilters);

// ===== Retry All Failed (Top Bar) =====
if (retryFailedBtn) {
    retryFailedBtn.addEventListener('click', async () => {
        const failedCount = currentSessions.filter(s => String(s.analysisStatus || '').toLowerCase() === 'failed').length;
        if (failedCount === 0) {
            showNotification('No failed analyses to retry', 'info');
            return;
        }

        const proceed = confirm(
            `Retry failed analyses?\n\n` +
            `Step 1: Test with 1 session first\n` +
            `Step 2: If it succeeds → automatically queue the rest\n\n` +
            `Failed count: ${failedCount}`
        );
        if (!proceed) return;

        const force = confirm(
            `Use FORCE mode?\n\n` +
            `OK = FORCE (ignores backoff/max-retries; resets retry counter)\n` +
            `Cancel = safe mode (respects backoff/max-retries)`
        );

        retryFailedBtn.classList.add('loading');
        retryFailedBtn.textContent = '⏳ Testing 1…';

        try {
            // Step 1: Queue only 1 session as a test
            const testResp = await fetch(`${API_BASE}/api/analysis/retry-failed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ limit: 1, minAgeSeconds: 0, force, resetRetryCount: force })
            });
            const testRes = await testResp.json().catch(() => ({}));

            if (!testResp.ok || !testRes.success || testRes.enqueued === 0) {
                const parts = ['Test session: nothing enqueued'];
                if (testRes.skippedBy) {
                    const details = Object.entries(testRes.skippedBy)
                        .filter(([, v]) => Number(v) > 0)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(' ');
                    if (details) parts.push(details);
                }
                showNotification(parts.join(' • '), 'info');
                retryFailedBtn.textContent = '↻ Retry Failed';
                retryFailedBtn.classList.remove('loading');
                return;
            }

            const testSessionId = testRes.firstEnqueuedSessionId;
            showNotification(`Testing 1 session${testSessionId ? ' (' + testSessionId + ')' : ''}… waiting for result`, 'info');

            // Step 2: Wait for that session to finish (completed or failed) via socket
            const waitForResult = () => new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    socket.off('sessionUpdate', handler);
                    resolve('timeout');
                }, 20 * 60 * 1000); // 20 min max wait

                const handler = (session) => {
                    if (testSessionId && session.sessionId !== testSessionId) return;
                    const st = String(session.analysisStatus || '').toLowerCase();
                    if (st === 'completed' || st === 'failed') {
                        clearTimeout(timeout);
                        socket.off('sessionUpdate', handler);
                        resolve(st);
                    }
                };
                socket.on('sessionUpdate', handler);
            });

            const result = await waitForResult();

            if (result === 'completed') {
                showNotification('✅ Test session succeeded! Queuing the rest…', 'success');
                retryFailedBtn.textContent = '⏳ Queuing rest…';

                // Step 3: Queue remaining failed sessions
                const bulkResp = await fetch(`${API_BASE}/api/analysis/retry-failed`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ limit: 200, minAgeSeconds: 0, force, resetRetryCount: force })
                });
                const bulkRes = await bulkResp.json().catch(() => ({}));

                const parts = [`✅ Test passed → Queued ${bulkRes.enqueued || 0} more`];
                if (bulkRes.skipped) parts.push(`Skipped: ${bulkRes.skipped}`);
                if (bulkRes.skippedBy) {
                    const details = Object.entries(bulkRes.skippedBy)
                        .filter(([, v]) => Number(v) > 0)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(' ');
                    if (details) parts.push(details);
                }
                showNotification(parts.join(' • '), 'success');

            } else if (result === 'failed') {
                showNotification('❌ Test session failed (API may still be down). Not queuing the rest.', 'error');
            } else {
                showNotification('⏱ Test session timed out. Not queuing the rest.', 'error');
            }

        } catch (e) {
            showNotification('Bulk retry error: ' + e.message, 'error');
        } finally {
            retryFailedBtn.textContent = '↻ Retry Failed';
            retryFailedBtn.classList.remove('loading');
        }
    });
}

const scoreFilter = document.getElementById('scoreFilter');
if (scoreFilter) scoreFilter.addEventListener('change', applyFilters);

function applyFilters() {
    const searchTerm = searchInput.value.toLowerCase();
    const statusValue = statusFilter.value;
    const auditValue = auditFilter.value;
    const scoreValue = scoreFilter?.value || 'all';

    const matchText = (value, filter) => {
        const f = String(filter ?? '').trim().toLowerCase();
        if (!f) return true;
        return String(value ?? '').toLowerCase().includes(f);
    };

    const matchNumeric = (value, filter) => {
        const f = String(filter ?? '').trim();
        if (!f) return true;

        const raw = String(value ?? '').toString().replace('%', '').trim();
        const v = parseFloat(raw);
        const m = f.match(/^(<=|>=|<|>|=)?\s*([0-9]+(?:\.[0-9]+)?)$/);
        if (!m) {
            // fallback: substring match
            return String(value ?? '').toLowerCase().includes(f.toLowerCase());
        }
        const op = m[1] || '=';
        const n = parseFloat(m[2]);
        if (Number.isNaN(v) || Number.isNaN(n)) return false;
        if (op === '>') return v > n;
        if (op === '>=') return v >= n;
        if (op === '<') return v < n;
        if (op === '<=') return v <= n;
        return v === n;
    };

    const colStatus = String(colFilterStatus?.value || '').trim();
    const colAnalysis = String(colFilterAnalysis?.value || '').trim();

    filteredSessions = currentSessions.filter(session => {
        // Search filter (now includes instructor)
        const matchesSearch = !searchTerm ||
            session.tutorId.toLowerCase().includes(searchTerm) ||
            session.sessionId.toLowerCase().includes(searchTerm) ||
            (session.instructorName || '').toLowerCase().includes(searchTerm) ||
            session.timeSlot.toLowerCase().includes(searchTerm);

        // Status filter
        const matchesStatus = statusValue === 'all' || session.status === statusValue;

        // Audit filter
        const matchesAudit = auditValue === 'all' ||
            (auditValue === 'audited' && session.auditApproved) ||
            (auditValue === 'not-audited' && !session.auditApproved);

        // Score filter
        let matchesScore = true;
        const aiScore = parseFloat(session.aiScore);
        const humanScore = parseFloat(session.humanReport?.score);
        
        if (scoreValue === 'high') {
            matchesScore = !isNaN(aiScore) && aiScore >= 85;
        } else if (scoreValue === 'medium') {
            matchesScore = !isNaN(aiScore) && aiScore >= 70 && aiScore < 85;
        } else if (scoreValue === 'low') {
            matchesScore = !isNaN(aiScore) && aiScore < 70;
        } else if (scoreValue === 'variance') {
            matchesScore = !isNaN(aiScore) && !isNaN(humanScore) && Math.abs(aiScore - humanScore) > 15;
        }

        // Column filters
        const colTutorOk = matchText(session.tutorId, colFilterTutor?.value);
        const colInstructorOk = matchText(session.instructorName || '', colFilterInstructor?.value);
        const colSessionOk = matchText(session.sessionId, colFilterSession?.value);
        const colDateOk = matchText(session.sessionData, colFilterDate?.value);
        const colSlotOk = matchText(session.timeSlot, colFilterSlot?.value);
        const colHumanOk = matchNumeric(session.humanReport?.score, colFilterHumanScore?.value);
        const colAiOk = matchNumeric(session.aiScore, colFilterAiScore?.value);
        const colProgOk = matchNumeric(session.progress, colFilterProgress?.value);

        const colStatusOk = !colStatus || String(session.status || '').toLowerCase() === colStatus;
        const colAnalysisOk = !colAnalysis || String(session.analysisStatus || 'pending').toLowerCase() === colAnalysis;

        return matchesSearch && matchesStatus && matchesAudit && matchesScore &&
            colTutorOk && colInstructorOk && colSessionOk && colDateOk && colSlotOk &&
            colHumanOk && colAiOk && colProgOk && colStatusOk && colAnalysisOk;
    });

    renderSessionsTable(filteredSessions);
}

// ===== Batch Operations =====
selectAll.addEventListener('change', (e) => {
    const checkboxes = document.querySelectorAll('.session-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = e.target.checked;
        const sessionId = cb.dataset.sessionId;
        if (e.target.checked) {
            selectedSessions.add(sessionId);
        } else {
            selectedSessions.delete(sessionId);
        }
    });
    updateBatchActions();
});

function handleSessionCheckbox(sessionId, checked) {
    if (checked) {
        selectedSessions.add(sessionId);
    } else {
        selectedSessions.delete(sessionId);
    }
    updateBatchActions();
}

function updateBatchActions() {
    const count = selectedSessions.size;
    selectedCount.textContent = count;

    if (count > 0) {
        batchActions.classList.remove('hidden');
    } else {
        batchActions.classList.add('hidden');
    }

    // Update select all checkbox
    const checkboxes = document.querySelectorAll('.session-checkbox');
    const allChecked = checkboxes.length > 0 && Array.from(checkboxes).every(cb => cb.checked);
    selectAll.checked = allChecked;
}

batchApprove.addEventListener('click', async () => {
    if (selectedSessions.size === 0) return;

    const confirmed = confirm(`Approve ${selectedSessions.size} sessions?`);
    if (!confirmed) return;

    for (const sessionId of selectedSessions) {
        await updateAudit(sessionId, 'Batch approved', true);
    }

    selectedSessions.clear();
    updateBatchActions();
    showNotification('Sessions approved successfully', 'success');
});

batchReject.addEventListener('click', async () => {
    if (selectedSessions.size === 0) return;

    const confirmed = confirm(`Reject ${selectedSessions.size} sessions?`);
    if (!confirmed) return;

    for (const sessionId of selectedSessions) {
        await updateAudit(sessionId, 'Batch rejected', false);
    }

    selectedSessions.clear();
    updateBatchActions();
    showNotification('Sessions rejected successfully', 'success');
});

// Batch Delete Selected Sessions
batchDelete.addEventListener('click', async () => {
    if (selectedSessions.size === 0) return;

    const confirmed = confirm(`⚠️ Are you sure you want to DELETE ${selectedSessions.size} session(s)?\n\nThis action cannot be undone!`);
    if (!confirmed) return;

    let deletedCount = 0;
    let failedCount = 0;

    for (const sessionId of selectedSessions) {
        try {
            const response = await fetch(`${API_BASE}/api/sessions/${sessionId}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                deletedCount++;
            } else {
                failedCount++;
            }
        } catch (error) {
            console.error(`Failed to delete session ${sessionId}:`, error);
            failedCount++;
        }
    }

    selectedSessions.clear();
    selectAll.checked = false;
    updateBatchActions();
    await loadSessions();

    if (failedCount === 0) {
        showNotification(`${deletedCount} session(s) deleted successfully`, 'success');
    } else {
        showNotification(`Deleted ${deletedCount}, failed ${failedCount}`, 'warning');
    }
});

// Regenerate Analysis
async function regenerateAnalysis(sessionId) {
    const session = currentSessions.find(s => s.sessionId === sessionId);
    if (!session) return;
    
    if(!confirm('Are you sure you want to REGENERATE the analysis?\n\nThis will:\n• Delete the current video and report files\n• Re-download the video from Google Drive\n• Generate a fresh report from scratch\n\nThis may take several minutes.')) return;
    
    showNotification('Starting regeneration: Deleting old files and re-downloading video...', 'info');
    
    try {
        const response = await fetch(`${API_BASE}/api/sessions/analyze/${sessionId}`, { method: 'POST' });
        const res = await response.json();
        
        if(res.success) {
            showNotification('Regeneration started! Re-downloading video...', 'success');
            // Refresh the session list to show updated status
            applyFilters();
        } else {
            showNotification('Failed: ' + res.error, 'error');
        }
    } catch(e) {
        showNotification('Error: ' + e.message, 'error');
    }
}

// Restart failed report (light retry: reuse local video, re-run analysis)
async function restartFailedReport(sessionId) {
    const session = currentSessions.find(s => s.sessionId === sessionId);
    if (!session) return;

    const isFailed = String(session.analysisStatus || '').toLowerCase() === 'failed';
    if (!isFailed) {
        // For non-failed sessions, keep existing behavior (full regenerate)
        return regenerateAnalysis(sessionId);
    }

    if (!confirm('Retry FAILED analysis now?\n\nThis will:\n• Delete only the old report files\n• Re-run the analysis using the existing local video\n\nIf the video is missing, you must use full regeneration (re-download).')) return;

    showNotification('Retrying failed analysis (re-queue)...', 'info');

    try {
        const response = await fetch(`${API_BASE}/api/sessions/retry-analysis/${sessionId}`, { method: 'POST' });
        const res = await response.json().catch(() => ({}));
        if (response.ok && res.success) {
            showNotification(res.message || 'Retry queued', 'success');
            applyFilters();
        } else {
            showNotification('Retry failed: ' + (res.error || 'Unknown error'), 'error');
        }
    } catch (e) {
        showNotification('Error: ' + e.message, 'error');
    }
}

window.restartFailedReport = restartFailedReport;

// Human Report Modal
function openHumanReportModal(sessionId) {
    const session = currentSessions.find(s => s.sessionId === sessionId);
    if (!session || !session.humanReport) return;
    
    document.getElementById('humanScoreDisplay').textContent = session.humanReport.score || 'N/A';
    document.getElementById('humanPositive').textContent = session.humanReport.positive || 'No data';
    document.getElementById('humanImprovement').textContent = session.humanReport.improvement || 'No data';
    
    document.getElementById('humanReportModal').classList.add('active');
}

window.closeHumanModal = function() {
    document.getElementById('humanReportModal').classList.remove('active');
}

// ===== Tab Navigation =====
let currentTab = 'sessions';

window.switchTab = function(tabName) {
    currentTab = tabName;
    
    // Update tab buttons
    document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
    event.target.classList.add('active');
    
    // Hide all pages
    document.querySelector('.upload-section').style.display = tabName === 'sessions' ? 'block' : 'none';
    document.querySelector('.sessions-section').style.display = tabName === 'sessions' ? 'block' : 'none';
    document.getElementById('progressSection').style.display = (tabName === 'sessions' && currentSessions.length > 0) ? 'block' : 'none';
    document.getElementById('chartsSection').style.display = tabName === 'analytics' ? 'block' : 'none';
    document.getElementById('auditHubPage').style.display = tabName === 'audit' ? 'block' : 'none';
    
    // Render content for active tab
    if (tabName === 'audit') {
        renderAuditHub();
    } else if (tabName === 'analytics') {
        updateCharts();
    }
}

// ===== Audit Hub Rendering =====
let currentAuditView = 'table';

window.setAuditView = function(view) {
    currentAuditView = view;
    
    // Update toggle buttons
    document.querySelectorAll('.view-toggle-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`audit${view.charAt(0).toUpperCase() + view.slice(1)}ViewBtn`)?.classList.add('active');
    
    // Hide all views
    document.getElementById('auditTableView').style.display = 'none';
    document.getElementById('auditCardsView').style.display = 'none';
    document.getElementById('auditResponsesView').style.display = 'none';
    
    // Show selected view
    document.getElementById(`audit${view.charAt(0).toUpperCase() + view.slice(1)}View`).style.display = 
        view === 'table' ? 'block' : view === 'cards' ? 'grid' : 'flex';
    
    renderAuditHub();
}

window.renderAuditHub = function() {
    const filterValue = document.getElementById('auditHubFilter')?.value || 'all';
    const searchTerm = (document.getElementById('auditSearchInput')?.value || '').toLowerCase();
    
    let auditedSessions = currentSessions.filter(s => s.auditApproved !== undefined || s.auditComments || s.auditData);
    
    // Apply filter
    if (filterValue === 'approved') {
        auditedSessions = auditedSessions.filter(s => s.auditApproved === true);
    } else if (filterValue === 'rejected') {
        auditedSessions = auditedSessions.filter(s => s.auditApproved === false);
    } else if (filterValue === 'high-accuracy') {
        auditedSessions = auditedSessions.filter(s => s.auditData && s.auditData.accuracy >= 4);
    } else if (filterValue === 'low-accuracy') {
        auditedSessions = auditedSessions.filter(s => s.auditData && s.auditData.accuracy <= 2);
    } else if (filterValue === 'has-feedback') {
        auditedSessions = auditedSessions.filter(s => s.auditData?.comparison || s.auditComments);
    }
    
    // Apply search
    if (searchTerm) {
        auditedSessions = auditedSessions.filter(s => 
            s.tutorId.toLowerCase().includes(searchTerm) ||
            (s.auditData?.reviewer || '').toLowerCase().includes(searchTerm) ||
            (s.instructorName || '').toLowerCase().includes(searchTerm)
        );
    }
    
    // Sort by date (newest first)
    auditedSessions.sort((a, b) => {
        const dateA = new Date(a.auditData?.date || 0);
        const dateB = new Date(b.auditData?.date || 0);
        return dateB - dateA;
    });
    
    // Update summary counts
    const allAudited = currentSessions.filter(s => s.auditApproved !== undefined || s.auditData);
    const accurateCount = allAudited.filter(s => s.auditData && s.auditData.accuracy >= 4).length;
    const varianceCount = currentSessions.filter(s => {
        const h = parseFloat(s.humanReport?.score);
        const a = parseFloat(s.aiScore);
        return !isNaN(h) && !isNaN(a) && Math.abs(h - a) > 15;
    }).length;
    const pendingCount = currentSessions.filter(s => s.analysisStatus === 'completed' && !s.auditApproved && !s.auditData).length;
    
    document.getElementById('auditTotalCount').textContent = allAudited.length;
    document.getElementById('auditAccurateCount').textContent = accurateCount;
    document.getElementById('auditVarianceCount').textContent = varianceCount;
    document.getElementById('auditPendingCount').textContent = pendingCount;
    
    // Render based on current view
    if (currentAuditView === 'table') {
        renderAuditTableView(auditedSessions);
    } else if (currentAuditView === 'cards') {
        renderAuditCardsView(auditedSessions);
    } else if (currentAuditView === 'responses') {
        renderAuditResponsesView(auditedSessions);
    }
}

function renderAuditTableView(auditedSessions) {
    const tbody = document.getElementById('auditHubTableBody');
    
    if (auditedSessions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:40px; color:#64748b;">No audit records found. Complete audits from the Sessions tab.</td></tr>';
        return;
    }
    
    tbody.innerHTML = auditedSessions.map(s => {
        const hScore = s.humanReport?.score;
        const aScore = s.aiScore;
        const variance = (hScore && aScore) ? (parseFloat(aScore) - parseFloat(hScore)).toFixed(0) : '—';
        const varianceClass = Math.abs(parseFloat(variance)) > 15 ? 'color:#ef4444; font-weight:700;' : 'color:#64748b;';
        const accuracyStars = s.auditData?.accuracy ? '⭐'.repeat(s.auditData.accuracy) : '—';
        const statusBadge = s.auditApproved ? 
            '<span class="status-badge status-completed">✓ Approved</span>' : 
            '<span class="status-badge status-failed">✗ Rejected</span>';
        const auditDate = s.auditData?.date ? new Date(s.auditData.date).toLocaleDateString() : '—';
        
        return `
            <tr>
                <td>
                    <div style="font-weight:600;">${s.tutorId}</div>
                    <div style="font-size:0.75rem; color:#64748b;">${s.sessionId}</div>
                </td>
                <td style="font-weight:500;">${s.auditData?.reviewer || 'Unknown'}</td>
                <td style="font-weight:700; color:#2563eb;">${hScore || '—'}</td>
                <td style="font-weight:700; color:#d97706;">${aScore || '—'}</td>
                <td style="${varianceClass}">${variance !== '—' ? (variance > 0 ? '+' : '') + variance : '—'}</td>
                <td title="${s.auditData?.accuracy || 0}/5">${accuracyStars}</td>
                <td style="max-width:250px; font-size:0.85rem; color:#374151;">
                    ${(s.auditData?.comparison || s.auditComments || '').substring(0, 80)}${(s.auditData?.comparison || s.auditComments || '').length > 80 ? '...' : ''}
                </td>
                <td>${statusBadge}</td>
                <td style="font-size:0.8rem; color:#64748b;">${auditDate}</td>
                <td>
                    <button class="action-btn drive-btn" onclick="openExternalLink('${s.driveFolderLink || s.driveLink || ''}')"
                        ${(s.driveFolderLink || s.driveLink) ? '' : 'disabled'} 
                        title="View in Google Drive" style="margin-right:8px;">👁️</button>
                    <button class="action-btn delete-btn" onclick="deleteAudit('${s.sessionId}')" title="Delete Audit">🗑️</button>
                </td>
            </tr>
        `;
    }).join('');
}

function renderAuditCardsView(auditedSessions) {
    const container = document.getElementById('auditCardsView');
    
    if (auditedSessions.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:40px; color:#64748b; grid-column:1/-1;">No audit records found.</div>';
        return;
    }
    
    container.innerHTML = auditedSessions.map(s => {
        const hScore = s.humanReport?.score || '—';
        const aScore = s.aiScore ? Math.round(s.aiScore) : '—';
        const variance = (s.humanReport?.score && s.aiScore) ? 
            (parseFloat(s.aiScore) - parseFloat(s.humanReport.score)).toFixed(0) : '—';
        const varianceColor = Math.abs(parseFloat(variance)) > 15 ? '#ef4444' : '#64748b';
        const accuracyStars = s.auditData?.accuracy ? '⭐'.repeat(s.auditData.accuracy) : '—';
        const statusClass = s.auditApproved ? 'approved' : 'rejected';
        const statusText = s.auditApproved ? '✓ Approved' : '✗ Rejected';
        const auditDate = s.auditData?.date ? new Date(s.auditData.date).toLocaleDateString() : '—';
        const feedback = s.auditData?.comparison || s.auditComments || 'No feedback provided';
        
        return `
            <div class="audit-card">
                <div class="audit-card-header">
                    <span class="tutor-id">${s.tutorId}</span>
                    <span class="audit-status ${statusClass}">${statusText}</span>
                </div>
                <div class="audit-card-body">
                    <div class="audit-card-scores">
                        <div class="score-item">
                            <div class="score-value" style="color:#2563eb;">${hScore}</div>
                            <div class="score-label">Human</div>
                        </div>
                        <div class="score-item">
                            <div class="score-value" style="color:#7c3aed;">${aScore}</div>
                            <div class="score-label">AI</div>
                        </div>
                        <div class="score-item">
                            <div class="score-value" style="color:${varianceColor};">${variance !== '—' ? (variance > 0 ? '+' : '') + variance : '—'}</div>
                            <div class="score-label">Δ Variance</div>
                        </div>
                    </div>
                    <div class="audit-card-feedback">${feedback}</div>
                </div>
                <div class="audit-card-footer">
                    <div>
                        <span>👤 ${s.auditData?.reviewer || 'Unknown'}</span>
                        <span>${accuracyStars}</span>
                        <span>📅 ${auditDate}</span>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <button class="action-btn drive-btn" onclick="openExternalLink('${s.driveFolderLink || s.driveLink || ''}')"
                            ${(s.driveFolderLink || s.driveLink) ? '' : 'disabled'} 
                            title="View in Google Drive">👁️ View</button>
                        <button class="action-btn delete-btn" onclick="deleteAudit('${s.sessionId}')" title="Delete Audit">🗑️</button>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderAuditResponsesView(auditedSessions) {
    const container = document.getElementById('auditResponsesView');
    
    if (auditedSessions.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:40px; color:#64748b;">No audit responses found.</div>';
        return;
    }
    
    container.innerHTML = auditedSessions.map(s => {
        const hScore = s.humanReport?.score || '—';
        const aScore = s.aiScore ? Math.round(s.aiScore) : '—';
        const variance = (s.humanReport?.score && s.aiScore) ? 
            (parseFloat(s.aiScore) - parseFloat(s.humanReport.score)).toFixed(0) : '—';
        const variancePrefix = variance !== '—' && parseFloat(variance) > 0 ? '+' : '';
        const accuracyStars = s.auditData?.accuracy ? '⭐'.repeat(s.auditData.accuracy) + '☆'.repeat(5 - s.auditData.accuracy) : '☆☆☆☆☆';
        const statusClass = s.auditApproved ? 'status-completed' : 'status-failed';
        const statusText = s.auditApproved ? '✓ Approved' : '✗ Rejected';
        const auditDate = s.auditData?.date ? new Date(s.auditData.date).toLocaleString() : '—';
        const initials = s.tutorId.replace('T-', '').substring(0, 2);
        
        const positiveContent = s.humanReport?.positive || '';
        const improvementContent = s.humanReport?.improvement || '';
        const comparisonContent = s.auditData?.comparison || s.auditComments || '';
        
        return `
            <div class="response-card">
                <div class="response-header">
                    <div class="response-meta">
                        <div class="tutor-info">
                            <div class="tutor-avatar">${initials}</div>
                            <div class="tutor-details">
                                <h4>${s.tutorId} ${s.instructorName ? '- ' + s.instructorName : ''}</h4>
                                <div class="session-id">Session: ${s.sessionId} • ${s.timeSlot || ''}</div>
                            </div>
                        </div>
                        <div class="review-info">
                            <span>👤 Reviewed by: <strong>${s.auditData?.reviewer || 'Unknown'}</strong></span>
                            <span>📅 ${auditDate}</span>
                        </div>
                    </div>
                    <div class="response-scores">
                        <div class="score-box human">
                            <div class="value" style="color:#2563eb;">${hScore}</div>
                            <div class="label">Human</div>
                        </div>
                        <div class="score-box ai">
                            <div class="value" style="color:#7c3aed;">${aScore}</div>
                            <div class="label">AI</div>
                        </div>
                        <div class="score-box variance">
                            <div class="value" style="color:#b45309;">${variancePrefix}${variance}</div>
                            <div class="label">Δ</div>
                        </div>
                    </div>
                </div>
                
                <div class="response-body">
                    ${positiveContent ? `
                        <div class="response-section">
                            <h5>✅ Positive Feedback (Human)</h5>
                            <div class="content positive">${positiveContent}</div>
                        </div>
                    ` : ''}
                    
                    ${improvementContent ? `
                        <div class="response-section">
                            <h5>⚠️ Areas for Improvement (Human)</h5>
                            <div class="content improvement">${improvementContent}</div>
                        </div>
                    ` : ''}
                    
                    ${comparisonContent ? `
                        <div class="response-section">
                            <h5>💬 Audit Comparison Notes</h5>
                            <div class="content comparison">${comparisonContent}</div>
                        </div>
                    ` : '<div class="response-section"><h5>💬 Audit Comparison Notes</h5><div class="content" style="color:#94a3b8;">No comparison notes provided</div></div>'}
                </div>
                
                <div class="response-footer">
                    <div class="accuracy-display">
                        <span class="stars">${accuracyStars}</span>
                        <span class="accuracy-label">AI Accuracy Rating</span>
                    </div>
                    <div style="display:flex; gap:12px; align-items:center;">
                        <button class="action-btn drive-btn" onclick="openExternalLink('${s.driveFolderLink || s.driveLink || ''}')"
                            ${(s.driveFolderLink || s.driveLink) ? '' : 'disabled'} 
                            title="View in Google Drive" style="font-size:0.8rem;">👁️ View</button>
                        <button class="action-btn delete-btn" onclick="deleteAudit('${s.sessionId}')" title="Delete Audit" style="font-size:0.8rem;">🗑️ Delete</button>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

window.exportAuditData = function() {
    const auditedSessions = currentSessions.filter(s => s.auditApproved !== undefined || s.auditData);
    
    const csvContent = [
        ['Tutor ID', 'Session ID', 'Reviewer', 'Human Score', 'AI Score', 'Variance', 'Accuracy', 'Comparison', 'Comments', 'Status', 'Date'].join(','),
        ...auditedSessions.map(s => {
            const h = s.humanReport?.score || '';
            const a = s.aiScore || '';
            const v = (h && a) ? (parseFloat(a) - parseFloat(h)).toFixed(0) : '';
            return [
                s.tutorId,
                s.sessionId,
                s.auditData?.reviewer || '',
                h,
                a,
                v,
                s.auditData?.accuracy || '',
                `"${(s.auditData?.comparison || '').replace(/"/g, '""')}"`,
                `"${(s.auditComments || '').replace(/"/g, '""')}"`,
                s.auditApproved ? 'Approved' : 'Rejected',
                s.auditData?.date || ''
            ].join(',');
        })
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('Audit data exported', 'success');
}

// Legacy toggle (for backward compatibility)
window.toggleAuditView = function() {
    switchTab('audit');
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.remove('active');
        if (tab.textContent.includes('Audit')) tab.classList.add('active');
    });
}

async function updateAudit(sessionId, comments, approved, reviewer, accuracy, comparison) {
    try {
        const response = await fetch(`${API_BASE}/api/audit/${sessionId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ comments, approved, reviewer, accuracy, comparison })
        });

        return await response.json();
    } catch (error) {
        console.error('Audit update error:', error);
        return null;
    }
}

// ===== Video Player & Viewing =====
// ===== Video Player & Viewing =====
function handleViewSession(sessionId) {
    const session = currentSessions.find(s => s.sessionId === sessionId);
    if (!session) return;

    // Priority 1: Google Drive Link (Redirect)
    const driveLink = session.driveFolderLink || session.driveLink;
    if (driveLink && (driveLink.includes('http') || driveLink.includes('drive.google.com'))) {
        window.open(driveLink, '_blank');
        return;
    }

    // Priority 2: Local Video Player
    openVideoPlayer(sessionId);
}

function openVideoPlayer(sessionId) {
    const session = currentSessions.find(s => s.sessionId === sessionId);
    if (!session) return;

    videoTitle.textContent = `Session ${sessionId} - ${session.tutorId}`;

    // Construct HTTP URL for video
    // Assuming video is in Sessions/<TutorId>/<VideoFile.mp4>
    // We need to find the filename or use a standard naming convention if possible
    // Since we don't have the filename in the session object usually, we might need to rely on the server serving it
    // BUT, existing logic used session.sessionLink. If that's a file path, we need to convert it.

    let videoUrl = session.sessionLink;

    // Convert local Windows path to server URL if applicable
    if (session.sessionLink && !session.sessionLink.startsWith('http')) {
        // Just use the TutorID directory assuming standard naming or that the server knows
        // Actually, the server doesn't expose a direct "get video filename" API yet, 
        // but we setup /sessions static route mapped to ../Sessions

        // If the link is just a download link, this might not work.
        // Let's try to assume a standard structure for now or use the sessionLink if it's relative
    }

    // Better approach: Use the report logic. Real sessions have a specific folder structure.
    // Let's assume for now we use the raw link if http, else warn

    if (session.sessionLink && !session.sessionLink.startsWith('http')) {
        // Transform "C:\Users\...\Sessions\T-123\video.mp4" -> "/sessions/T-123/video.mp4"
        const parts = session.sessionLink.split('\\');
        const filename = parts.pop();
        const folder = parts.pop(); // TutorID usually
        videoUrl = `/sessions/${folder}/${filename}`;
    }

    videoSource.src = videoUrl;
    videoPlayer.load();
    videoModal.classList.add('active');
}

closeVideo.addEventListener('click', () => {
    videoModal.classList.remove('active');
    videoPlayer.pause();
});

videoModal.addEventListener('click', (e) => {
    if (e.target === videoModal) {
        videoModal.classList.remove('active');
        videoPlayer.pause();
    }
});

window.openVideoPlayer = openVideoPlayer;

// ===== Render Functions =====
function renderProgressList(sessions) {
    progressList.innerHTML = '';

    // Smart Rendering: If > 20 sessions, show summary to prevent UI clutter
    if (sessions.length > 20) {
        const completed = sessions.filter(s => s.downloadStatus === 'completed').length;
        const failed = sessions.filter(s => s.downloadStatus === 'failed').length;
        const pending = sessions.filter(s => s.downloadStatus === 'pending' || s.downloadStatus === 'queued' || s.downloadStatus === 'manual_required').length;
        const downloading = sessions.filter(s => s.downloadStatus === 'downloading').length;
        const total = sessions.length;
        const percent = total > 0 ? Math.round(((completed + failed) / total) * 100) : 0;

        const summaryHTML = `
            <div class="progress-summary">
                <div class="summary-header-row">
                    <div class="summary-info">
                        <h3>Mass Download in Progress</h3>
                        <p>${completed} of ${total} Completed</p>
                    </div>
                    <div class="summary-percentage">${percent}%</div>
                </div>
                <div class="progress-bar-container large">
                    <div class="progress-bar" style="width: ${percent}%"></div>
                </div>
                <div class="summary-stats-row">
                    <span class="stat-badge completed">✅ ${completed} Done</span>
                    <span class="stat-badge downloading">⬇️ ${downloading} Active</span>
                    <span class="stat-badge pending">⏳ ${pending} Queued</span>
                    <span class="stat-badge failed">⚠️ ${failed} Failed</span>
                </div>
                
                <button class="toggle-details-btn" onclick="window.toggleDetails()">Show Active Downloads</button>
                
                <div class="active-downloads-list">
                    <h4>Active & Failed Items</h4>
                    <div id="activeItemsContainer"></div>
                </div>
            </div>
        `;
        progressList.innerHTML = summaryHTML;

        // Render only active/failed items in the hidden list
        const activeContainer = document.getElementById('activeItemsContainer');
        const noteworthySessions = sessions.filter(s =>
            s.downloadStatus === 'downloading' ||
            s.downloadStatus === 'failed'
        );

        if (noteworthySessions.length === 0 && downloading > 0) {
            // If downloading but no specific status (?) unlikely but fallback
        }

        noteworthySessions.forEach(session => {
            const item = createProgressItem(session);
            activeContainer.appendChild(item);
        });

        if (noteworthySessions.length === 0) {
            activeContainer.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">No active downloads currently.</p>';
        }

    } else {
        // Standard rendering for small batches
        sessions.forEach(session => {
            const progressItem = createProgressItem(session);
            progressList.appendChild(progressItem);
        });
    }
}

// Helper for summary view
window.toggleDetails = function () {
    const list = document.querySelector('.active-downloads-list');
    const btn = document.querySelector('.toggle-details-btn');
    if (list) {
        list.classList.toggle('visible');
        btn.textContent = list.classList.contains('visible') ? 'Hide Active Downloads' : 'Show Active Downloads';
    }
};

function createProgressItem(session) {
    const div = document.createElement('div');
    div.className = 'progress-item';
    div.id = `progress-${session.sessionId}`;

    const statusClass = session.downloadStatus === 'completed' ? 'status-completed' :
        session.downloadStatus === 'failed' ? 'status-failed' :
            'status-downloading';

    div.innerHTML = `
        <div class="progress-header">
            <span class="progress-title">Session ${session.sessionId}</span>
            <span class="progress-status ${statusClass}">${session.downloadStatus || 'queued'}</span>
        </div>
        <div class="progress-bar-container">
            <div class="progress-bar" style="width: ${session.progress || 0}%"></div>
        </div>
    `;

    return div;
}

function updateProgressItem(session) {
    const progressItem = document.getElementById(`progress-${session.sessionId}`);
    if (progressItem) {
        const statusClass = session.downloadStatus === 'completed' ? 'status-completed' :
            session.downloadStatus === 'failed' ? 'status-failed' :
                'status-downloading';

        progressItem.querySelector('.progress-status').className = `progress-status ${statusClass}`;
        progressItem.querySelector('.progress-status').textContent = session.downloadStatus || 'queued';
        progressItem.querySelector('.progress-bar').style.width = `${session.progress || 0}%`;
    }
}

function renderSessionsTable(sessions) {
    if (sessions.length === 0) {
        sessionsTableBody.innerHTML = `
            <tr class="empty-state">
                <td colspan="12">
                    <div class="empty-message">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        <p>No sessions found</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    const escapeHtml = (value) => {
        const s = String(value ?? '');
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };

    const formatDate = (value) => {
        const s = String(value ?? '').trim();
        if (!s) return '—';
        return s;
    };

    const getScoreDisplay = (score) => {
        const s = parseFloat(score);
        if (isNaN(s)) return { text: '—', color: '#6b7280', bg: '#f3f4f6' };
        
        let color = '#ef4444'; // red
        let bg = '#fef2f2';
        if (s >= 85) { color = '#10b981'; bg = '#ecfdf5'; } // green
        else if (s >= 70) { color = '#f59e0b'; bg = '#fffbeb'; } // orange
        
        return { text: Math.round(s) + '%', color, bg };
    };

    const hasVideo = (session) => {
        const link = String(session.sessionLink || '');
        const videoPath = String(session.videoPath || '');
        return link.includes('/sessions/') || link.endsWith('.mp4') || videoPath.endsWith('.mp4');
    };

    const hasDrive = (session) => {
        const link = String(session.driveFolderLink || session.driveLink || '');
        return link.includes('drive.google.com');
    };

    const hasRecording = (session) => {
        const link = String(session.recordingLink || '');
        return link.startsWith('http');
    };

    sessionsTableBody.innerHTML = sessions.map((session, idx) => {
        const statusClass = session.status === 'completed' ? 'status-completed' :
            session.status === 'failed' ? 'status-failed' :
                session.status === 'downloading' ? 'status-downloading' :
                    'status-pending';

        const auditBtnClass = session.auditApproved ? 'audit-btn audited' : 'audit-btn';
        const auditBtnText = session.auditApproved ? '✓ Audited' : 'Audit';
        const isChecked = selectedSessions.has(session.sessionId) ? 'checked' : '';
        const rowClass = selectedSessions.has(session.sessionId) ? 'selected' : '';

        const instructor = session.instructorName || '—';
        const dateVal = formatDate(session.sessionData);
        const progressVal = Number.isFinite(Number(session.progress)) ? Number(session.progress) : 0;
        const canView = hasVideo(session) || hasDrive(session);
        const canDrive = hasDrive(session);
        const canRecording = hasRecording(session);

        // Scores
        const hScore = session.humanReport ? session.humanReport.score : null;
        const aScore = session.aiScore;
        
        const hStyle = getScoreDisplay(hScore);
        const aStyle = getScoreDisplay(aScore);

        let diffBadge = '';
        if (hScore && aScore) {
             const h = parseFloat(hScore);
             const a = parseFloat(aScore);
             if (!isNaN(h) && !isNaN(a)) {
                 const diff = a - h;
                 const sign = diff > 0 ? '+' : '';
                 // Alert color if difference is large (>15%), otherwise neutral
                 const diffColor = Math.abs(diff) > 15 ? '#ef4444' : '#6b7280'; 
                 diffBadge = `<div style="font-size:0.7rem; color:${diffColor}; font-weight:600; margin-top:4px;">${sign}${Math.round(diff)}</div>`;
             }
        }

        // Check if human report has any content
        const hasHumanReport = session.humanReport && (session.humanReport.score || session.humanReport.positive || session.humanReport.improvement);
        const hasAIReport = session.analysisStatus === 'completed';
        const analysisStatus = String(session.analysisStatus || 'pending').toLowerCase();
        const retryTitle = analysisStatus === 'failed'
            ? 'Retry failed analysis (reuse local video)'
            : 'Regenerate AI Analysis (re-download + re-run)';
        const retryLabel = analysisStatus === 'failed' ? '↻ Retry' : '↻';

        return `
            <tr class="${rowClass}">
                <td><input type="checkbox" class="session-checkbox" data-session-id="${session.sessionId}" ${isChecked} onchange="handleSessionCheckbox('${session.sessionId}', this.checked)"></td>
                <td class="row-num">${idx + 1}</td>
                <td>
                    <div class="cell-title">${escapeHtml(session.tutorId)}</div>
                </td>
                <td>
                    <div class="cell-subtitle">${escapeHtml(instructor)}</div>
                </td>
                <td>
                    <div class="cell-mono">${escapeHtml(session.sessionId)}</div>
                </td>
                <td>
                    <div class="cell-subtitle">${escapeHtml(dateVal)}</div>
                </td>
                <td>${session.timeSlot}</td>
                <td>
                    <div style="font-weight:700; color:${hStyle.color}; background:${hStyle.bg}; padding:2px 8px; border-radius:12px; display:inline-block; cursor:${hasHumanReport ? 'pointer' : 'default'};" ${hasHumanReport ? `onclick="openHumanReportModal('${session.sessionId}')" title="Click to view Human Report"` : ''}>
                        ${hStyle.text}
                    </div>
                </td>
                <td>
                     <div style="display:flex; flex-direction:column; align-items:center;">
                        <div style="font-weight:700; color:${aStyle.color}; background:${aStyle.bg}; padding:2px 8px; border-radius:12px; display:inline-block; cursor:${hasAIReport ? 'pointer' : 'default'};" ${hasAIReport ? `onclick="viewReport('${session.tutorId}', '${session.sessionId}')" title="Click to view AI Report"` : ''}>
                            ${aStyle.text}
                        </div>
                        ${diffBadge}
                     </div>
                </td>
                <td><span class="status-badge ${statusClass}">${session.status}</span></td>
                <td title="${escapeHtml(session.failureReason || session.failureDetails || '')}">${getAnalysisDisplay(session)}</td>
                <td>
                    <div class="progress-cell">
                        <div class="progress-mini"><div class="progress-mini-bar" style="width:${Math.max(0, Math.min(100, progressVal))}%"></div></div>
                        <div class="progress-mini-text">${progressVal}%</div>
                    </div>
                </td>
                <td>
                    <div class="action-buttons">
                        <!-- Primary Actions Row -->
                        <div class="action-row primary-actions">
                            ${hasHumanReport ? `
                            <button class="action-btn human-btn" onclick="openHumanReportModal('${session.sessionId}')" title="View Human Report from CSV">
                                <span class="btn-icon">👤</span> Human
                            </button>` : `
                            <button class="action-btn human-btn disabled" disabled title="No Human Report in CSV">
                                <span class="btn-icon">👤</span> Human
                            </button>`}
                            
                            <button class="action-btn ai-btn ${hasAIReport ? '' : 'pending'}" onclick="viewReport('${session.tutorId}', '${session.sessionId}')" title="${hasAIReport ? 'View AI Report' : 'Generate AI Report'}">
                                <span class="btn-icon">🤖</span> ${hasAIReport ? 'AI Report' : 'Generate'}
                            </button>
                        </div>
                        
                        <!-- Secondary Actions Row -->
                        <div class="action-row secondary-actions">
                            <button class="action-btn ${session.auditApproved ? 'audit-done' : 'audit-pending'}" onclick="openAuditModal('${session.sessionId}')" title="Open Audit">
                                ${session.auditApproved ? '✓' : '○'} Audit
                            </button>
                            
                            <button class="action-btn retry-btn" onclick="restartFailedReport('${session.sessionId}')" title="${retryTitle}">
                                ${retryLabel}
                            </button>
                            
                            <button class="action-btn drive-btn" onclick="openExternalLink('${(session.driveFolderLink || session.driveLink || '').replace(/'/g, "\\'")}')" ${canDrive ? '' : 'disabled'} title="View in Google Drive">
                                👁️ View
                            </button>
                            
                            <button class="action-btn delete-btn" onclick="deleteSession('${session.sessionId}')" title="Delete Session">
                                🗑
                            </button>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function getAnalysisClass(status) {
    switch (status) {
        case 'completed': return 'status-completed';
        case 'analyzing': return 'status-analyzing';
        case 'queued': return 'status-queued';
        case 'failed': return 'status-failed';
        default: return 'status-pending';
    }
}

function getAnalysisDisplay(session) {
    const status = session.analysisStatus || 'pending';
    const position = session.queuePosition;
    
    if (status === 'queued' && position) {
        return `<span class="queue-position">
            <span>🕐</span> Queue <span class="position-num">#${position}</span>
        </span>`;
    }
    
    if (status === 'analyzing') {
        return `<span class="status-badge status-analyzing">
            <span class="spinner-mini"></span> Analyzing
        </span>`;
    }
    
    return `<span class="status-badge ${getAnalysisClass(status)}">${status}</span>`;
}

window.handleSessionCheckbox = handleSessionCheckbox;

window.openExternalLink = function (url) {
    const u = String(url || '').trim();
    if (!u || !(u.startsWith('http://') || u.startsWith('https://'))) {
        showNotification('No link available for this session', 'info');
        return;
    }
    window.open(u, '_blank', 'noopener,noreferrer');
};

// ===== Audit Modal =====
let selectedAccuracy = 0;

function openAuditModal(sessionId) {
    const session = currentSessions.find(s => s.sessionId === sessionId);
    if (!session) return;

    currentAuditSession = session;

    // Populate session info
    document.getElementById('auditSessionIdVal').value = sessionId;
    document.getElementById('auditTutorId').textContent = session.tutorId;
    document.getElementById('auditSessionId').textContent = session.sessionId;
    document.getElementById('auditTimeSlot').textContent = session.timeSlot || '—';

    // Populate scores for comparison
    const humanScore = session.humanReport?.score;
    const aiScore = session.aiScore;
    document.getElementById('auditHumanScore').textContent = humanScore || '—';
    document.getElementById('auditAIScore').textContent = aiScore || '—';

    // Populate existing audit data
    document.getElementById('auditComments').value = session.auditComments || '';
    document.getElementById('auditApproved').checked = session.auditApproved || false;
    
    // New Fields
    document.getElementById('reviewerName').value = session.auditData?.reviewer || '';
    document.getElementById('comparisonFeedback').value = session.auditData?.comparison || '';
    
    // Set accuracy rating
    selectedAccuracy = session.auditData?.accuracy || 0;
    updateAccuracyDisplay();

    document.getElementById('auditModal').classList.add('active');
}

function updateAccuracyDisplay() {
    const stars = document.querySelectorAll('#accuracyRating .rating-star');
    const label = document.getElementById('accuracyLabel');
    
    stars.forEach(star => {
        const val = parseInt(star.dataset.value);
        star.classList.toggle('active', val <= selectedAccuracy);
    });
    
    const labels = ['Not rated', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];
    label.textContent = labels[selectedAccuracy] || 'Not rated';
}

// Rating star click handler
document.getElementById('accuracyRating')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('rating-star')) {
        selectedAccuracy = parseInt(e.target.dataset.value);
        updateAccuracyDisplay();
    }
});

function closeAuditModal() {
    auditModal.classList.remove('active');
    currentAuditSession = null;
    selectedAccuracy = 0;
}

closeModal.addEventListener('click', closeAuditModal);
cancelAudit.addEventListener('click', closeAuditModal);

auditModal.addEventListener('click', (e) => {
    if (e.target === auditModal) {
        closeAuditModal();
    }
});

// Reject button handler
document.getElementById('rejectAudit')?.addEventListener('click', async () => {
    if (!currentAuditSession) return;
    
    document.getElementById('auditApproved').checked = false;
    
    const comments = document.getElementById('auditComments').value;
    const reviewer = document.getElementById('reviewerName').value;
    const comparison = document.getElementById('comparisonFeedback').value;

    const result = await updateAudit(currentAuditSession.sessionId, comments, false, reviewer, selectedAccuracy, comparison);

    if (result && result.success) {
        showNotification('Session rejected', 'info');
        currentAuditSession.auditApproved = false;
        currentAuditSession.auditComments = comments;
        currentAuditSession.auditData = { reviewer, accuracy: selectedAccuracy, comparison, date: new Date().toISOString() };
        applyFilters();
        updateAnalytics();
        closeAuditModal();
    } else {
        showNotification('Failed to save audit', 'error');
    }
});

saveAudit.addEventListener('click', async () => {
    if (!currentAuditSession) return;

    const comments = document.getElementById('auditComments').value;
    const approved = document.getElementById('auditApproved').checked;
    const reviewer = document.getElementById('reviewerName').value;
    const comparison = document.getElementById('comparisonFeedback').value;

    const result = await updateAudit(currentAuditSession.sessionId, comments, approved, reviewer, selectedAccuracy, comparison);

    if (result && result.success) {
        showNotification('Audit saved successfully', 'success');
        
        // Update local object immediately
        if(currentAuditSession) {
            currentAuditSession.auditComments = comments;
            currentAuditSession.auditApproved = approved;
            currentAuditSession.auditData = { reviewer, accuracy: selectedAccuracy, comparison, date: new Date().toISOString() };
        }
        
        closeAuditModal();
        applyFilters(); // Re-render table
        updateAnalytics();
    } else {
        showNotification('Error saving audit', 'error');
    }
});

window.openAuditModal = openAuditModal;

// ===== Delete Session =====
async function deleteSession(sessionId) {
    const session = currentSessions.find(s => s.sessionId === sessionId);
    if (!session) return;

    const confirmed = confirm(`Are you sure you want to delete session ${sessionId}?\n\nTutor: ${session.tutorId}\nTime: ${session.timeSlot}\n\nThis action cannot be undone.`);
    if (!confirmed) return;

    try {
        const response = await fetch(`${API_BASE}/api/sessions/${sessionId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            // Remove from local state
            currentSessions = currentSessions.filter(s => s.sessionId !== sessionId);
            selectedSessions.delete(sessionId);

            // Re-apply filters and update UI
            applyFilters();
            updateBatchActions();
            updateAnalytics();
            updateCharts();

            showNotification(`Session ${sessionId} deleted successfully`, 'success');
        } else {
            showNotification('Error deleting session', 'error');
        }
    } catch (error) {
        console.error('Delete error:', error);
        showNotification('Error deleting session', 'error');
    }
}

window.deleteSession = deleteSession;

// ===== Delete Audit =====
async function deleteAudit(sessionId) {
    const session = currentSessions.find(s => s.sessionId === sessionId);
    if (!session) return;

    const confirmed = confirm(`Are you sure you want to delete the audit for session ${sessionId}?\n\nTutor: ${session.tutorId}\n\nThis will remove all audit feedback, comments, and approval status.`);
    if (!confirmed) return;

    try {
        const response = await fetch(`${API_BASE}/api/audit/${sessionId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            // Clear audit data from local state
            session.auditComments = '';
            session.auditApproved = false;
            session.auditStatus = 'pending';
            session.auditTimestamp = '';
            session.auditData = null;

            // Re-render
            applyFilters();
            updateAnalytics();
            renderAuditHub();

            showNotification(`Audit for ${sessionId} deleted successfully`, 'success');
        } else {
            showNotification(`Error: ${result.error}`, 'error');
        }
    } catch (error) {
        console.error('Delete audit error:', error);
        showNotification('Failed to delete audit', 'error');
    }
}

window.deleteAudit = deleteAudit;

// ===== View/Generate Report =====
// ===== Report Modal Logic =====
const reportModal = document.getElementById('reportModal');
const closeReportBtn = document.getElementById('closeReport');
const reportFrame = document.getElementById('reportFrame');
const reportTitle = document.getElementById('reportTitle');

function openReportModal(tutorId, sessionId, url) {
    if (!reportModal) return;
    reportTitle.textContent = `Quality Report - ${tutorId} (${sessionId})`;
    reportFrame.src = url;
    reportModal.classList.add('active');
}

function closeReportModal() {
    reportModal.classList.remove('active');
    reportFrame.src = '';
}

if (closeReportBtn) {
    closeReportBtn.addEventListener('click', closeReportModal);
}
if (reportModal) {
    reportModal.addEventListener('click', (e) => {
        if (e.target === reportModal) closeReportModal();
    });
}

// ===== View/Generate Report =====
async function viewReport(tutorId, sessionId) {
    try {
        showNotification('Checking for report...', 'info');

        // Check if report exists
        const checkResponse = await fetch(`/api/report/check/${tutorId}/${sessionId}`);
        const checkData = await checkResponse.json();

        if (checkData.exists) {
            // Open existing report in modal using relative API path
            // The server should serve it at /api/report/view/... OR static file if safe
            // We use the view endpoint logic
            const reportUrl = `/api/report/view/${tutorId}/${sessionId}`;
            openReportModal(tutorId, sessionId, reportUrl);
            showNotification('Opening report...', 'success');
        } else {
            // Ask user if they want to generate report
            const confirmed = confirm(`No report found for ${sessionId}.\n\nWould you like to generate a new report using RAG analysis?\n\nThis may take a few minutes.`);

            if (!confirmed) return;

            showNotification('Generating report... This may take a few minutes', 'info');

            // Generate new report
            const generateResponse = await fetch(`/api/report/generate/${tutorId}/${sessionId}`, {
                method: 'POST'
            });

            const generateData = await generateResponse.json();

            if (generateData.success) {
                showNotification('Report generated successfully!', 'success');
                // Open newly generated report
                const reportUrl = `/api/report/view/${tutorId}/${sessionId}`;
                openReportModal(tutorId, sessionId, reportUrl);
            } else {
                showNotification(`Error: ${generateData.error}`, 'error');
            }
        }
    } catch (error) {
        console.error('Report error:', error);
        showNotification('Error accessing report', 'error');
    }
}

window.viewReport = viewReport;


// ===== Export Data =====
exportBtn.addEventListener('click', () => {
    window.open('/api/export', '_blank');
});

// ===== Notifications =====
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 100px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: ${type === 'success' ? 'linear-gradient(135deg, #2ecc71, #27ae60)' :
            type === 'error' ? 'linear-gradient(135deg, #EF4444, #DC2626)' :
                'linear-gradient(135deg, #007bff, #0056b3)'};
        color: white;
        border-radius: 50px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        z-index: 3000;
        font-weight: 600;
        animation: slideInRight 0.3s ease;
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from {
            opacity: 0;
            transform: translateX(100px);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }
    
    @keyframes slideOutRight {
        from {
            opacity: 1;
            transform: translateX(0);
        }
        to {
            opacity: 0;
            transform: translateX(100px);
        }
    }
`;
document.head.appendChild(style);

// ===== Initialize =====
async function initialize() {
    try {
        const response = await fetch(`${API_BASE}/api/sessions`);
        const sessions = await response.json();
        currentSessions = sessions;
        applyFilters();
        updateAnalytics();
        if (sessions.length > 0) {
            chartsSection.style.display = 'block';
            updateCharts();
        }
    } catch (error) {
        console.error('Initialization error:', error);
    }
}

initialize();
