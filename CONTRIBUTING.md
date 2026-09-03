# Contributing

Use Node.js 22.13 or newer and pnpm 11.25. Keep each change inside the module that owns the behavior.

## Before editing

Run the deterministic baseline:

```bash
pnpm install
pnpm run check
pnpm run format:check
```

`pnpm run preflight` checks runtime credentials and external binaries. It reports a failure until `BOT_TOKEN` exists, so it is not part of the credential-free unit suite.

Use live smoke checks only for the path you changed:

```bash
pnpm run smoke:download
pnpm run smoke:process
pnpm run smoke:fit -- <public-video-url>
pnpm run diagnose:engines -- <public-url>
```

## Ownership

- `src/commands` owns Discord command shapes.
- `src/jobs` owns queue admission, timeouts, Discord limits, and cleanup.
- `src/download/planner.js` owns engine order.
- `src/download/orchestrator.js` owns attempt lifetime, validation, commit, and fallback.
- `src/download/engines` owns protocol-specific resolution and transfer.
- `src/media` owns conversion after a valid artifact is committed.
- `src/platform/discord` owns reply and attachment delivery state.
- `src/utils/security.js` owns public URL and DNS checks.

Do not let an engine upload to Discord, commit its own artifact, or start another engine. Do not let reply code choose download fallbacks.

## Code style

- Prefer early returns and flat control flow.
- Use `const`, `?.`, and `??` when their semantics fit.
- Use `Map` or `Set` for repeated lookups.
- Use `Promise.all` only for independent work. Media transfers for one job stay sequential.
- Keep names short enough to read and specific enough to remove obvious comments.
- Delete dead code. Git keeps history.
- Do not add a dependency when a platform API or existing module already solves the case.
- Do not add a wrapper, factory, or shared utility for one call site.
- Keep user errors natural. Logs may contain engine detail but must not contain tokens, cookies, signed media URLs, or authorization headers.

Files may grow when one concern needs the code. Split a file only when it mixes owners or becomes hard to navigate, then place the extracted file beside its caller.

## Adding an engine

An engine receives `(rawUrl, attemptDir, options)`. `options` can include `outputType`, `maxBytes`, `signal`, and `onProgress`.

Required behavior:

1. Write incomplete data with `.part`, `.tmp`, or another excluded sidecar extension.
2. Honor the abort signal and engine timeout.
3. Return a candidate with `filePath`, `fileName`, and `method`.
4. Leave complete output in the attempt directory if a child process exits after finalizing it.
5. Throw `DownloadMethodError` for engine failures and a `UserFacingError` only when fallback must stop.
6. Register the adapter in `src/download/orchestrator.js` and its order in `src/download/planner.js`.
7. Add a unit test for success, failure, or recovery behavior introduced by the adapter.

Resolution probes may run together when they do not transfer media. Two engines must not race full downloads for the same job. The first valid artifact has one owner.

## Security checks

User URLs are hostile input. Route page URLs, redirects, proxy responses, and Cobalt tunnel URLs through the existing SSRF checks. Keep child-process arguments in arrays with `shell: false`. Sanitize filenames and enforce byte limits during the stream, not only after it ends.

New public relays require a clear opt-out setting and README disclosure. Cobalt endpoints must belong to the operator or have explicit access permission.

## Pull requests

State the failed behavior, the owning boundary, and the proof you ran. Include a redacted engine attempt summary when the bug depends on an external site. Never commit `.env`, Discord tokens, cookie exports, Cobalt keys, signed media URLs, or downloaded `.tools` binaries.
