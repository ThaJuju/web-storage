module.exports = {
  apps: [
    {
      name: "web-storage",
      // Lance le serveur de production Next.js sur le port 3300
      // (le 3000 est deja occupe par un autre service de la machine).
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3300",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: "3300",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
    },
  ],
};
