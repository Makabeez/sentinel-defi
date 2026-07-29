module.exports = {
  apps: [{
    name: 'sentinel-trust',
    script: 'src/monitors/trustScore.js',
    cwd: '/home/vps/sentinel-defi/backend',
    args: '--watch',
    watch: false,
    autorestart: true,
  }],
};
