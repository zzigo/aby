module.exports = {
  apps: [{
    name: 'aby-web',
    cwd: '/opt/apps/aby',
    script: './scripts/start-production.sh',
    interpreter: '/usr/bin/bash',
    autorestart: true,
    max_memory_restart: '512M',
    time: true,
    env: {
      NODE_ENV: 'production'
    }
  }]
};

