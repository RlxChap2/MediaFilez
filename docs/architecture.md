# Download architecture

## Invariants

Four rules own correctness:

1. One job runs one media transfer at a time.
2. One validated artifact is committed once.
3. No fallback starts after a commit or recovered artifact.
4. Discord delivery has one terminal owner and never replaces a committed or unknown attachment with an error.

The global queue can run several independent jobs. Sequential transfer applies inside each job, not across users.

## Job flow

```text
interaction
  -> queue and per-user admission
  -> URL and SSRF validation
  -> host-aware engine plan
  -> isolated attempt directory
  -> engine resolution and transfer
  -> signature and FFprobe validation
  -> atomic artifact commit
  -> optional image/audio/video processing
  -> one verified Discord attachment edit
  -> temporary directory cleanup
```

`AbortController` owns the whole job deadline. The signal reaches HTTP requests, child processes, FFmpeg, metadata resolution, and status callbacks. Cleanup runs after a committed reply or terminal failure.

## Planning

`planner.js` classifies only routing hints. A host list does not claim support. The adapter still has to return media that passes validation.

Specific extractors run before generic page metadata. Direct URLs avoid HTML resolution. Instagram can use a configured host-rewrite relay after yt-dlp. Pinterest and other gallery hosts prefer gallery-dl. Reddit image posts prefer its public embed surface when normal pages block data-center addresses. Cobalt appears only when an endpoint or opt-in directory exists.

An engine name can appear once in a plan. `DISABLED_ENGINES` removes it before any attempt directory is created.

## Engine contract

An engine receives a source URL, an empty attempt directory, and job options. It returns a candidate with `filePath`, `fileName`, and `method`. Metadata is optional.

Engines write partial data with an excluded extension and keep final data in their attempt directory. They do not move output into `completed`, choose another adapter, process for Discord, or upload replies.

The orchestrator validates a returned candidate. If a process throws, the orchestrator scans only that attempt directory and can recover a complete artifact. Invalid attempts are deleted before the next engine starts.

Image output accepts a source image or a valid video. The media processor copies the image or extracts one frame. This keeps the command at three choices without weakening artifact checks.

## Generic page metadata

The page metadata adapter reads at most `PAGE_METADATA_MAX_SIZE`. It accepts HTML responses, extracts ordered Open Graph, Twitter card, media-tag, JSON-LD `contentUrl`, and URL-wrapped candidates, resolves relative paths, then sends each candidate through direct HTTP guards.

The adapter does not run page JavaScript, execute embedded code, follow non-HTTP schemes, or scrape arbitrary `<img>` elements. Those limits keep an unknown page from turning into an unbounded crawler.

## Reddit embed fallback

The Reddit adapter resolves short links through guarded redirects, derives the matching `embed.reddit.com` post URL, and reads a bounded HTML response. It accepts only post media hosted on Reddit's media domains. It ignores community icons, avatars, and other page images. The selected file still passes direct HTTP SSRF and byte limits plus the orchestrator's signature and stream validation.

## Cobalt endpoint state

Cobalt rotates the starting endpoint across jobs, then falls through the remaining configured endpoints. A failed endpoint receives a local cooldown. Later jobs skip that endpoint while another configured endpoint is available. If every endpoint is cooling down, the earliest retry is attempted so the engine can recover without a restart.

The directory source is disabled by default. Hosted instances can impose authentication and access policies that MediaFilez cannot infer. Directory endpoints never receive the configured API key, are checked again for public DNS addresses when their socket opens, and cannot return unbounded JSON bodies.

## Delivery ownership

`ReplySession` uses `open`, `committing`, `committed`, `failed`, and `unknown` states.

- Status edits run only while open.
- Commit sends final text and one attachment together.
- A rejected upload call triggers `fetchReply` verification.
- A confirmed attachment counts as success.
- Failed verification leaves the response unknown and blocks error replacement.

The processing target is the minimum of Discord's interaction limit, the operator ceiling, and 500 MiB. Upload retries begin only after Discord confirms the expected attachment is absent.

## Tool resolution

yt-dlp comes from `youtube-dl-exec`. FFmpeg and FFprobe use explicit environment paths first, then packaged binaries. gallery-dl uses `GALLERY_DL_PATH`, a verified `.tools` build, or `gallery-dl` on `PATH`, in that order.

Docker sets system FFmpeg paths and installs gallery-dl into its own Python environment. The local installer verifies the SHA-256 digest published with the selected gallery-dl build before replacing `.tools/gallery-dl`.

## Security boundaries

Initial URLs and every direct HTTP redirect resolve through public-address checks. Direct connections use the guarded DNS lookup again when opening the socket, reducing DNS-rebinding exposure. Trusted Cobalt hosts may be private because Compose uses an internal network; URLs returned by Cobalt receive public checks unless they point back to that configured host.

Child processes use argument arrays and `shell: false`. Filenames pass through sanitization. Stream byte counts enforce the maximum even when a server omits or lies about `Content-Length`.

Cookie files, relay URLs, Cobalt credentials, Discord tokens, and signed CDN URLs stay out of logs and source control.
