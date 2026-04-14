module.exports = {
  apps: [
    {
      name: 'sentinel-api',
      script: 'dist/server.js',
      cwd: '/opt/sentinel/backend',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      max_memory_restart: '500M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
