module.exports = {
  apps: [
    {
      name: 'jce-bridal-boutique',
      script: 'node_modules/.bin/next',
      args: 'start -p 3000 -H 0.0.0.0',
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
}