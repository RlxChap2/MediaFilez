import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const scanRoots = ["src", "test", "scripts"];

async function listJsFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await listJsFiles(fullPath)));
        } else if (entry.isFile() && entry.name.endsWith(".js")) {
            files.push(fullPath);
        }
    }

    return files;
}

const files = [];
for (const scanRoot of scanRoots) {
    files.push(...(await listJsFiles(path.join(root, scanRoot))));
}

for (const file of files) {
    await execFileAsync(process.execPath, ["--check", file], { windowsHide: true });
}

console.log(`Syntax OK (${files.length} files).`);
