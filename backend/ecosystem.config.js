module.exports = {
  apps: [{
    name: 'sentinel-trust',
    script: 'src/monitors/trustScore.js',
    cwd: '/home/vps/sentinel-defi/backend',
    args: '--watch',
    watch: false,
    autorestart: true,
    env: {
      SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com',
      RPC_DELAY_MS: '2500',
      TRUST_POLL_INTERVAL: '3600000',
    },
  }],
};
