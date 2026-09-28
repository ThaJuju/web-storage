module.exports = {
  apps: [
    {
      name: "web-storage",
      // Lance le serveur de production (server.mjs, qui calcule l'IP client
      // de facon fiable) sur le port 3300 (le 3000 est deja occupe par un
      // autre service de la machine).
      script: "server.mjs",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: "3300",
        // "true" uniquement derriere un reverse-proxy de confiance (nginx...).
        TRUST_PROXY: "false",
      },
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "512M",
    },
  ],
};
