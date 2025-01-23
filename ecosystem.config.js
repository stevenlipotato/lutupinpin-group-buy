module.exports = {
  apps: [{
    name: 'lutupinpin',
    script: 'src/server.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      QR_SECRET: 'lutupinpin-qr-secret',
      SESSION_SECRET: 'lutupinpin-secret',
      MONGODB_URI: 'mongodb+srv://stevenlipotato:Lutupinpin123@cluster0.lmgwb.mongodb.net/lutupinpin'
    }
  }]
}; 