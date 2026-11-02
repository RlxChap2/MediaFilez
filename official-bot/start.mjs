import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { attachOfficialPresence } from "./presence.mjs";

const botRoot = resolve(process.env.MEDIAFILEZ_BOT_ROOT || process.cwd());
const requireFromBot = createRequire(pathToFileURL(resolve(botRoot, "package.json")));
const { Client } = requireFromBot("discord.js");

const originalLogin = Client.prototype.login;

Client.prototype.login = function (...args) {
    Client.prototype.login = originalLogin;

    try {
        attachOfficialPresence(this);
    } catch {
        console.warn("Official presence disabled: setup failed.");
    }

    return originalLogin.apply(this, args);
};

try {
    await import(pathToFileURL(resolve(botRoot, "src/index.js")).href);
} finally {
    Client.prototype.login = originalLogin;
}
