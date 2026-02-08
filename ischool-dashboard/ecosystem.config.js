module.exports = {
  apps: [{
    name: 'ischool-dashboard',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,

      // Resource tuning (helps on smaller hosts)
      ANALYSIS_MAX_CONCURRENT: 1,
      DOWNLOAD_MAX_CONCURRENT: 2,

      // Timed auto-retry tuning
      AUTO_RETRY_FAILED_ANALYSIS_INTERVAL_MINUTES: 15,
      AUTO_RETRY_FAILED_ANALYSIS_MIN_FAILURE_AGE_SECONDS: 600,
      AUTO_RETRY_QUOTA_BACKOFF_MINUTES: 30
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 4000,
    kill_timeout: 5000,
    listen_timeout: 10000
  }]
};
