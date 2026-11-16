module.exports = {
  apps: [{
    name: 'automatr',
    cwd: '/var/www/automatr/server',   // dotenv reads server/.env from here
    script: 'src/index.js',
    instances: 1,                       // uploads on local disk + in-process jobs: keep ONE instance
    exec_mode: 'fork',
    max_memory_restart: '2500M',
    kill_timeout: 10000,
    time: true,
    env: { NODE_ENV: 'production' }
  }]
};
