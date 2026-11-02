import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

try {
    const health = JSON.parse(readFileSync(join(tmpdir(), "mediafilez-bot-health.json"), "utf8"));
    const age = Date.now() - health.at;
    process.exit(health.ready === true && age >= 0 && age < 45_000 ? 0 : 1);
} catch {
    process.exit(1);
}
