module.exports = {
  apps: [{
    name: 'mudvault-mesh',
    script: 'dist/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 8080,
      WS_PORT: 8082
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    // Restart if it crashes
    min_uptime: '10s',
    max_restarts: 10,
    // Graceful shutdown
    kill_timeout: 3000,
    // Cluster mode for scaling (optional)
    exec_mode: 'fork'
  }]
};