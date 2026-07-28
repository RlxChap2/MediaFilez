# Contributing

Use Node.js 22 or newer and pnpm 11. Keep changes narrow enough to test locally.

```bash
pnpm install
pnpm run check
pnpm run preflight
pnpm run smoke:download
pnpm run smoke:process
```

`pnpm run check` performs syntax checks and runs the unit suite. The tests cover the two failure modes that previously caused duplicate work: fallback after success, and an error edit after a Discord attachment commit.

## Adding an engine

1. Add the engine under `src/download/engines/`.
2. Accept an isolated attempt directory and an abort signal.
3. Write partial data with `.part`, `.tmp`, or another excluded sidecar extension.
4. Return a complete candidate; don't move it into the completed directory.
5. Register the engine in `src/download/orchestrator.js`.
6. Add its host/output order to `src/download/planner.js`.
7. Add a unit test proving the next engine doesn't run after success or recovery.

Don't race two download transfers. Don't parse normal yt-dlp console output for the final path. Don't add a second Discord edit after an attachment is committed.

## Pull requests

Explain the failure case, the ownership boundary it touches, and how you tested it. Include credentials or private URLs only as redacted descriptions. Never commit `.env`, cookie exports, Discord tokens, or Cobalt credentials.
