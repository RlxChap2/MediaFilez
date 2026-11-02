import { randomUUID } from "node:crypto";

export function attachOfficialPresence(
    client,
    { env = process.env, fetchImpl = fetch, warn = console.warn, intervalMs = 30_000 } = {},
) {
    const {
        MEDIAFILEZ_CONTROL_API_URL: base,
        MEDIAFILEZ_CONTROL_API_TOKEN: token,
        MEDIAFILEZ_INSTANCE_ID: instanceId,
    } = env;

    if (!base || !token || !instanceId) return () => {};

    let url;

    try {
        url = new URL(base);

        if (
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            !["/", "/api/v1", "/api/v1/"].includes(url.pathname) ||
            !/^[a-zA-Z0-9_-]{1,64}$/.test(instanceId) ||
            token.length < 32
        )
            throw new Error();
    } catch {
        warn("Official presence disabled: invalid control configuration.");

        return () => {};
    }

    const endpoint = `${url.origin}/api/v1/internal/instances/${instanceId}`;
    const sessionId = randomUUID();
    let sequence = 0;
    let dirty = true;
    let revision = 0;
    let busy = false;
    let stopped = false;
    let lastSync = 0;
    let lastWarning = 0;
    let timer;
    let controller;

    const disconnected = new Set();
    const ready = () => client.isReady() && disconnected.size === 0;
    async function report(operation, guildId, guild) {
        if (stopped || !ready()) return;

        if (busy) {
            if (operation !== "heartbeat") dirty = true;

            return;
        }

        busy = true;
        const sentRevision = revision;
        const actual = dirty || Date.now() - lastSync >= 300_000 ? "sync" : operation;

        try {
            const payload = { sessionId, sequence: ++sequence };

            if (actual === "sync") {
                payload.applicationId = client.application?.id ?? client.user.id;
                payload.botUserId = client.user.id;
                payload.guildIds = [...client.guilds.cache.keys()];

                if (payload.guildIds.length > 10_000) throw new Error("Guild limit");

                payload.guilds = [...client.guilds.cache.values()].map(guildMetadata).filter(Boolean);
            } else if (actual !== "heartbeat") {
                payload.guildId = guildId;

                if (actual === "upsert") {
                    const metadata = guildMetadata(guild ?? client.guilds.cache.get(guildId));

                    if (metadata) payload.guild = metadata;
                }
            }

            controller = new AbortController();
            const timeout = setTimeout(() => controller?.abort(), 3_000);
            timeout.unref?.();

            try {
                const response = await fetchImpl(
                    `${endpoint}/${actual === "heartbeat" ? actual : `guilds/${actual}`}`,
                    {
                        method: "POST",
                        headers: { authorization: `Control ${token}`, "content-type": "application/json" },
                        body: JSON.stringify(payload),
                        signal: controller.signal,
                        redirect: "error",
                    },
                );
                await response.body?.cancel();

                if (!response.ok) throw new Error("Control request rejected");
            } finally {
                clearTimeout(timeout);
                controller = undefined;
            }

            if (actual === "sync") {
                lastSync = Date.now();
                dirty = revision !== sentRevision;
            }
        } catch {
            dirty = true;

            if (!stopped && Date.now() - lastWarning >= 60_000) {
                lastWarning = Date.now();

                try {
                    warn("Official presence unavailable; retrying on the next heartbeat.");
                } catch {}
            }
        } finally {
            busy = false;
        }
    }

    const safeReport = (operation, guildId, guild) => {
        void report(operation, guildId, guild).catch(() => {
            dirty = true;
        });
    };

    const onReady = () => {
        dirty = true;
        safeReport("sync");

        if (!timer) {
            timer = setInterval(() => safeReport("heartbeat"), intervalMs);
            timer.unref?.();
        }
    };

    const onCreate = (guild) => {
        revision++;
        safeReport("upsert", guild.id, guild);
    };

    const onDelete = (guild) => {
        revision++;
        safeReport("remove", guild.id);
    };

    const onDisconnect = (_event, shardId) => {
        disconnected.add(shardId);
        dirty = true;
    };

    const onResume = (shardId) => {
        disconnected.delete(shardId);
        dirty = true;
        safeReport("sync");
    };

    const handlers = [
        ["clientReady", onReady],
        ["guildCreate", onCreate],
        ["guildDelete", onDelete],
        ["guildUpdate", (_previous, guild) => onCreate(guild)],
        ["guildAvailable", onCreate],
        [
            "guildUnavailable",
            () => {
                revision++;
                dirty = true;
            },
        ],
        ["shardDisconnect", onDisconnect],
        ["shardResume", onResume],
        ["shardReady", onResume],
    ];

    for (const [event, handler] of handlers) client.on(event, handler);

    if (ready()) onReady();

    return () => {
        stopped = true;
        clearInterval(timer);
        controller?.abort();

        for (const [event, handler] of handlers) client.off(event, handler);
    };
}

function guildMetadata(guild) {
    if (!guild?.id || !guild.name || guild.available === false) return null;

    return {
        id: guild.id,
        name: guild.name,
        icon: guild.icon ?? null,
        features: (guild.features ?? []).filter((feature) => ["PARTNERED", "VERIFIED", "COMMUNITY"].includes(feature)),
        memberCount: Number.isSafeInteger(guild.memberCount) && guild.memberCount >= 0 ? guild.memberCount : null,
        vanityCode: guild.vanityURLCode ?? null,
    };
}
