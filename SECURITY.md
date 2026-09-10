# Security policy

## Supported versions

Security fixes are made on the latest release and the `main` branch. Older deployments should update before requesting a backport.

## Report a vulnerability privately

Do not open a public issue for an unpatched vulnerability. Use [GitHub private vulnerability reporting](https://github.com/RlxChap2/MediaFilez/security/advisories/new) or email **mediafilez44@gmail.com** with the subject **"MediaFilez Security Report"**.

Include the affected version or commit, the component and configuration involved, a minimal reproduction, the expected impact, and any safe remediation idea. Do not include live bot tokens, cookie files, account credentials, private media, or unnecessary personal data. Redact signed URLs and authorization headers.

We aim to acknowledge a complete report within seven days. Investigation and remediation time depend on severity and reproducibility. Please allow a reasonable period for a fix before public disclosure.

## Security boundaries

MediaFilez accepts untrusted URLs. Changes to redirects, DNS resolution, Cobalt tunnel handling, archive extraction, filenames, or child-process arguments need an SSRF and command-injection review.

External downloader subprocesses run only for recognized platform hosts. Unknown pages and direct links remain inside the redirect- and DNS-guarded HTTP adapters.

Instagram and Reddit relay hosts receive the public source URL. Operators can disable them with `INSTAGRAM_PROXY_HOSTS=none` and `REDDIT_PROXY_HOSTS=none`, or provide hosts they trust. Cobalt directory discovery stays disabled unless the operator accepts the instance owners' access and privacy rules.

The gallery-dl installer accepts only platform assets with a SHA-256 digest published by the release API. Tool downloads belong in `.tools`, which is ignored by Git and Docker contexts.

Rotate a Discord token or cookie export immediately if it appears in a log, screenshot, issue, or commit. Removing it from Git history doesn't make the credential safe again.

Use a dedicated, least-privilege source-platform account for authenticated downloads rather than a personal account. Enable multi-factor authentication where supported, keep its cookie export read-only and outside the repository, and revoke all sessions immediately if the file may have been exposed.

For information about personal-data handling and deletion requests, see the [Privacy Policy](PRIVACY_POLICY.md).
