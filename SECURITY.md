# Security policy

Report security problems privately to the repository owner before opening a public issue. Include the affected version, a minimal reproduction, and the expected impact. Don't include live bot tokens, cookie files, or account credentials.

MediaFilez accepts untrusted URLs. Changes to redirects, DNS resolution, Cobalt tunnel handling, archive extraction, filenames, or child-process arguments need an SSRF and command-injection review.

External downloader subprocesses run only for recognized platform hosts. Unknown pages and direct links remain inside the redirect- and DNS-guarded HTTP adapters.

Instagram and Reddit relay hosts receive the public source URL. Operators can disable them with `INSTAGRAM_PROXY_HOSTS=none` and `REDDIT_PROXY_HOSTS=none`, or provide hosts they trust. Cobalt directory discovery stays disabled unless the operator accepts the instance owners' access and privacy rules.

The gallery-dl installer accepts only platform assets with a SHA-256 digest published by the release API. Tool downloads belong in `.tools`, which is ignored by Git and Docker contexts.

Rotate a Discord token or cookie export immediately if it appears in a log, screenshot, issue, or commit. Removing it from Git history doesn't make the credential safe again.
