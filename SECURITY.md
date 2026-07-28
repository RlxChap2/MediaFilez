# Security policy

Report security problems privately to the repository owner before opening a public issue. Include the affected version, a minimal reproduction, and the expected impact. Don't include live bot tokens, cookie files, or account credentials.

MediaFilez accepts untrusted URLs. Changes to redirects, DNS resolution, Cobalt tunnel handling, archive extraction, filenames, or child-process arguments need an SSRF and command-injection review.

Rotate a Discord token or cookie export immediately if it appears in a log, screenshot, issue, or commit. Removing it from Git history doesn't make the credential safe again.
