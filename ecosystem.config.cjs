module.exports = {
    apps: [
        {
            name: "MediaFilez",
            script: "pnpm",
            args: "prod:start",
            cwd: __dirname,
            exec_mode: "fork",
            instances: 1,
            autorestart: true,
            watch: false,
            max_memory_restart: "650M",
            kill_timeout: 20_000,
            env: {
                NODE_ENV: "production",
            },
        },
    ],
};
