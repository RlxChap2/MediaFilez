# MediaFilez

MediaFilez downloads public media into Discord through one `/media` command. It tries ordered engines, validates every result, fits oversized video, audio, or images to the current interaction limit, and streams one confirmed attachment without buffering the whole file in memory.

## Command

`/media` supports server installs and user installs. It can run in a server channel, a bot DM, or a private channel.

| Option         | Required | Default | Purpose                                                          |
| -------------- | -------- | ------- | ---------------------------------------------------------------- |
| `url`          | yes      | none    | Public media page or direct media URL                            |
| `output`       | yes      | none    | `auto`, `video`, `image`, or `audio`                             |
| `fit_to_limit` | no       | `true`  | Process oversized media to fit the current Discord limit         |
| `private`      | no       | `false` | Make progress and the final result visible only to the requester |

Each output value changes validation and processing:

| Output              | Result                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Auto (detect media) | Accepts the first validated video, audio, or image and uses the matching processing path |
| Video               | Returns playable video                                                                   |
| Image / video frame | Returns a source image, page thumbnail, or a frame extracted from video                  |
| Audio               | Returns source audio or extracts an MP3 audio track from video                           |

Private results use Discord's ephemeral interaction reply, so they do not depend on the user's DM settings. An operator can make every guild result private with `PUBLIC_REPLIES_IN_GUILDS=false`.

`Thumbnail` no longer appears as a separate choice. Old interactions using its stored value remain valid while Discord propagates the updated command.

## Discord reply

The original interaction shows queue position, the active engine, transfer progress when an engine reports it, and the processing or upload stage. A successful reply contains the attachment, its final size, and a `Nerd Info` button.

`Nerd Info` opens an ephemeral message with the filename, selected engine, download time, processing time, upload target, final size, and any processing or recovery note. Its small payload lives in the button ID, so the button still works after a bot restart. It does not contain the source URL, cookies, or credentials.

## What changed in 2.1

- `/media` includes an `Auto` output that accepts validated video, audio, or image media and chooses the matching processing path.
- Local installs include FFmpeg and FFprobe packages. `pnpm install` also fetches a SHA-256 verified gallery-dl build into `.tools` when no operator path is supplied.
- Instagram has a direct embed-proxy fallback. The default converts `instagram.com` to `kkkinstagram.com`, then downloads the returned media through the same redirect, SSRF, size, and signature checks as any other URL.
- Unknown pages gain a metadata extractor for Open Graph, Twitter card, and HTML media tags.
- Share-link wrappers and JSON-LD `contentUrl` fields feed the guarded direct downloader. Reddit posts first use the first-party embed path, then a configurable public embed relay when Reddit blocks the bot server's address.
- Multiple Cobalt endpoints are tried in order. A failed endpoint enters a short cooldown so queued jobs can skip the dead host.
- Cobalt now covers its full documented host set in the planner and requests a target-aware video quality instead of always requesting the largest source.
- External downloaders run only for recognized public platforms. Unknown pages and direct links stay inside the DNS-, redirect-, and byte-guarded HTTP engines, and gallery-dl enforces the byte ceiling during transfer.
- The queue accepts four jobs by default and two jobs per user. Both values remain configurable.
- Discord's `attachmentSizeLimit` is now the normal upload target. The old 7 MiB ceiling is gone.
- Final Discord uploads use a bounded-memory multipart stream. Nitro-sized attachments no longer expand into several in-memory copies before delivery.
- `fit_to_limit` now handles oversized audio and images as well as video. Audio is re-encoded to MP3; images step down JPEG quality and resolution only as far as needed.
- An engine-local timeout falls through to the next engine. Only the whole-job abort stops fallback.
- yt-dlp receives a private writable cookie copy for each attempt, so the configured source can remain mounted read-only and concurrent jobs cannot rewrite one shared jar.
- Process-lifetime ownership locks let startup remove abandoned MediaFilez temp directories without touching work owned by another running instance.

## Download pipeline

Engine order depends on the host and requested output.

`Auto` starts with the extractor best suited to the host, then falls back through the remaining engines. Direct file URLs use direct HTTP first. Page metadata checks video, audio, and image fields in that order. File signatures and FFprobe streams determine the final media type whenever available, and validation rejects unknown media.

| Source                   | Default order                                                         |
| ------------------------ | --------------------------------------------------------------------- |
| Direct media URL         | direct HTTP                                                           |
| YouTube                  | yt-dlp, YouTube.js, Cobalt, page metadata                             |
| Instagram auto or image  | gallery-dl, yt-dlp, Instagram proxy, Cobalt, page metadata            |
| Instagram video or audio | yt-dlp, Instagram proxy, Cobalt, gallery-dl, page metadata            |
| Pinterest, Flickr, Imgur | gallery-dl, yt-dlp, Cobalt, page metadata                             |
| Reddit auto or image     | Reddit embed, Reddit proxy, gallery-dl, yt-dlp, Cobalt, page metadata |
| Reddit video or audio    | Cobalt, yt-dlp, Reddit embed, Reddit proxy, gallery-dl, page metadata |
| Other Cobalt services    | Cobalt, yt-dlp, gallery-dl, page metadata                             |
| Unknown page             | page metadata, direct HTTP                                            |

Each engine writes into its own attempt directory. MediaFilez checks file signatures and FFprobe streams before committing a result. A fallback starts only after the prior attempt stops and leaves no valid file. A process error does not discard a complete file left behind.

For `auto` and `video`, MediaFilez asks yt-dlp for an audio-bearing alternative when the first valid video is silent and yt-dlp remains in the plan. It uses the second result if validation passes. If that attempt fails, MediaFilez keeps the original silent video instead of turning a usable download into an error.

Unknown pages can still expose media through standard page metadata or direct HTTP. They are not passed blindly to yt-dlp or gallery-dl: keeping them in the redirect-, DNS-, and byte-guarded HTTP path prevents an arbitrary page from expanding the subprocess network boundary. Add a host to an explicit platform route only after its extractor and security behavior are known.

Recognized platform routes include TikTok short links (`vm.tiktok.com` and `vt.tiktok.com`), X/Twitter, Facebook, Tumblr, Bluesky, SoundCloud, Vimeo, Snapchat, Streamable, VK, Bilibili, Dailymotion, Loom, Newgrounds, OK.ru, Rutube, and Twitch. Recognition selects an engine plan; it does not guarantee that the source site will allow a download.

No downloader can guarantee every website: sites change markup, expire media URLs, block data-center addresses, require fresh cookies, or remove extractor access. See the current [yt-dlp supported sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) and [gallery-dl supported sites](https://github.com/mikf/gallery-dl/blob/master/docs/supportedsites.md).

## Requirements

- Node.js 22.13 or newer
- pnpm 11.25
- A Discord application token

Local users do not need to install FFmpeg, FFprobe, yt-dlp, or gallery-dl by hand. The package install supplies them. Run `pnpm run preflight` to see the exact binary version and path status.

Docker uses Debian FFmpeg plus pinned Python builds of gallery-dl and yt-dlp. Its yt-dlp installation includes curl-cffi for optional browser impersonation.

## Setup

```bash
pnpm install
```

Copy `.env.example` to `.env`, then set `BOT_TOKEN` and `CLIENT_ID`.

```bash
pnpm run check
pnpm run format:check
pnpm run preflight
pnpm run deploy
pnpm start
```

Global command updates can take time to appear in every Discord client. `pnpm run deploy` must run after changing command choices. Deployment upserts `/media` without deleting Discord's Activity Entry Point or unrelated commands.

The included PM2 file runs `prod:start`, which publishes the current command definition before starting the bot:

```bash
pm2 start ecosystem.config.cjs
```

### Remote API and Worker

Set `MEDIA_API_URL` and `MEDIA_API_KEY` when the bot should submit jobs to the MediaFilez API. The API enqueues the versioned job for `media-worker`; the bot polls the job, downloads the completed object through the API's signed file URL, and uploads that final artifact to Discord. Leave both values empty to use the local downloader during development.

```env
MEDIA_API_URL=https://api.example.com
MEDIA_API_KEY=mf_your_api_key
MEDIA_API_REQUEST_TIMEOUT_MS=45000
MEDIA_API_POLL_INTERVAL_MS=1000
MEDIA_API_MAX_DOWNLOAD_SIZE=5gb
```

The bot also publishes its application ID, user ID, and guild IDs to `POST /api/v1/internal/discord/presence` when Discord reports it ready. The API keeps the latest snapshot in memory and exposes authenticated `GET /api/v1/discord/presence` and `/events` endpoints. Guild names, members, and message content are not sent.

Useful diagnostics:

```bash
pnpm run diagnose:engines -- https://www.instagram.com/reels/DcV3RyRz0sq/
pnpm run smoke:download
pnpm run smoke:process
pnpm run smoke:fit -- <public-video-url>
```

If the gallery-dl download was skipped or interrupted, run:

```bash
pnpm run tools:install
```

Set `GALLERY_DL_AUTO_INSTALL=false` in the shell that runs `pnpm install` to skip the automatic tool download. `GALLERY_DL_PATH` can point to an operator-managed executable.

## Docker and Cobalt

The Compose stack starts MediaFilez and two private Cobalt v11 APIs on an internal network. The container starts the bot but does not publish slash-command changes on its own.

```bash
docker compose build mediafilez
docker compose run --rm mediafilez pnpm run deploy
docker compose up -d
docker compose logs -f --tail=100
docker compose run --rm mediafilez pnpm run preflight
```

Set `YTDLP_IMPERSONATE=chrome` on Docker hosts only after preflight confirms `chrome impersonation ready`. Leave it disabled for installations whose yt-dlp build does not include curl-cffi.

Cobalt's maintainers state that hosted instances are not intended for unrelated projects without permission. Self-hosting is the safe default. Compose starts the official `11.7.1` image first, then a digest-pinned [zImPatrick compatibility build](https://github.com/zImPatrick/cobalt/tree/56258ad6d1a71ca079a19340d17255e7576f7019) as a second local fallback. Both remain private to the Compose network.

Add more operator-owned endpoints as a comma-separated list:

```env
COBALT_API_ENDPOINTS=https://cobalt-a.example,https://cobalt-b.example
COBALT_MAX_ENDPOINTS=5
COBALT_FAILURE_COOLDOWN_MS=60000
```

MediaFilez tries configured endpoints in order, falls through failures, and cools down dead hosts. Directory results are filtered to the requested service and exclude Turnstile-protected instances. `COBALT_API_KEY` is sent only to operator-configured endpoints, never endpoints learned from the directory. Directory connections repeat the public-address check when opening the socket, and Cobalt JSON responses have a fixed size limit. `COBALT_DIRECTORY_ENABLED` remains off because directory entries are third-party services with separate privacy, availability, and authorization rules. The request and response format follows the [Cobalt API documentation](https://github.com/imputnet/cobalt/blob/main/docs/api.md).

## Cookies and restricted posts

Some public posts still require an authenticated browser session. The hosted bot may use a dedicated operator-controlled source-platform account for this purpose. Users never sign in through MediaFilez and must not provide their own passwords or cookies. Export a fresh Netscape-format cookie file for the dedicated account and set:

```env
MEDIA_COOKIES_FILE=C:\path\to\cookies.txt
```

yt-dlp and gallery-dl share this source. Mount it read-only on a server and never commit it. MediaFilez copies it with private permissions into the current yt-dlp attempt because yt-dlp updates its cookie jar on exit; the mounted source remains unchanged.

```yaml
services:
    mediafilez:
        environment:
            MEDIA_COOKIES_FILE: /run/secrets/media-cookies.txt
        volumes:
            - ./secrets/media-cookies.txt:/run/secrets/media-cookies.txt:ro
```

`YTDLP_COOKIES_FROM_BROWSER` is useful for local diagnosis. A cookie file works better on servers because browsers may lock their databases and Windows DPAPI ties decryption to a user session.

Public YouTube links use an anonymous yt-dlp session by default. This avoids sending an operator's general browser session to YouTube and is often faster from data-center addresses. Set `YTDLP_COOKIES_FOR_YOUTUBE=true` only when restricted YouTube media requires the dedicated account session.

The source platform may associate requests made with these cookies with the dedicated account. MediaFilez does not bypass private-account permissions, paywalls, DRM, or removed content. Download only media you have permission to access and save.

## Configuration

Start with `.env.example`. Size values accept `b`, `kb`, `kib`, `mb`, `mib`, `gb`, or `gib`. Timeout values are milliseconds.

### Discord and job limits

| Variable                        | Default  | Purpose                                                  |
| ------------------------------- | -------- | -------------------------------------------------------- |
| `BOT_TOKEN`                     | required | Discord bot token                                        |
| `CLIENT_ID`                     | required | Discord application ID used to publish `/media`          |
| `PUBLIC_REPLIES_IN_GUILDS`      | `true`   | Guild reply visibility; `false` forces ephemeral replies |
| `MAX_DOWNLOAD_SIZE`             | `500mb`  | Maximum source artifact before processing                |
| `MIN_FREE_DISK_SPACE`           | `1gb`    | Free temp-storage floor checked before a job starts      |
| `MAX_CONCURRENT_JOBS`           | `4`      | Jobs running at once                                     |
| `MAX_QUEUE_SIZE`                | `50`     | Waiting jobs accepted before backpressure rejects work   |
| `MAX_CONCURRENT_JOBS_PER_USER`  | `2`      | Per-user running or queued job cap                       |
| `DISCORD_UPLOAD_TARGET_SIZE`    | `500mb`  | Operator ceiling; the interaction limit can lower it     |
| `DISCORD_UPLOAD_ATTEMPTS`       | `3`      | Verified attachment upload attempts                      |
| `DISCORD_UPLOAD_RETRY_DELAY_MS` | `1500`   | Base delay between verified upload retries               |
| `STATUS_UPDATE_INTERVAL_MS`     | `2500`   | Minimum delay between progress-message edits             |

### Remote execution

| Variable                       | Default | Purpose                                                                 |
| ------------------------------ | ------- | ----------------------------------------------------------------------- |
| `MEDIA_API_URL`                | empty   | API base URL; enables API/Worker jobs when paired with an API key       |
| `MEDIA_API_KEY`                | empty   | API key used for job creation, polling, file delivery, and presence     |
| `MEDIA_API_REQUEST_TIMEOUT_MS` | `45000` | Timeout for one API request                                             |
| `MEDIA_API_POLL_INTERVAL_MS`   | `1000`  | Delay between job status checks                                         |
| `MEDIA_API_MAX_DOWNLOAD_SIZE`  | `5gb`   | Source limit sent to the API; final Discord output still uses its limit |

### Timeouts

| Variable                   | Default  | Purpose                                     |
| -------------------------- | -------- | ------------------------------------------- |
| `HTTP_RESPONSE_TIMEOUT_MS` | `45000`  | Time allowed to receive an HTTP response    |
| `HTTP_IDLE_TIMEOUT_MS`     | `60000`  | Maximum pause between downloaded chunks     |
| `YTDLP_TIMEOUT_MS`         | `480000` | yt-dlp and gallery-dl process timeout       |
| `FFMPEG_TIMEOUT_MS`        | `600000` | FFmpeg and FFprobe process timeout          |
| `JOB_TIMEOUT_MS`           | `840000` | Whole-job deadline                          |
| `DISCORD_REST_TIMEOUT_MS`  | `300000` | Discord request and streamed upload timeout |
| `DISCORD_REST_RETRIES`     | `0`      | Retries inside discord.js REST calls        |

### Download and processing tools

| Variable                     | Default                | Purpose                                                                                            |
| ---------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| `MEDIA_COOKIES_FILE`         | empty                  | Netscape cookie source shared by yt-dlp and gallery-dl                                             |
| `YTDLP_COOKIES_FROM_BROWSER` | empty                  | Local browser-cookie extraction                                                                    |
| `YTDLP_COOKIES_FOR_YOUTUBE`  | `false`                | Send the configured cookie source to YouTube; normally unnecessary for public videos               |
| `YTDLP_PATH`                 | automatic              | Operator-managed yt-dlp executable                                                                 |
| `YTDLP_CONCURRENT_FRAGMENTS` | `4`                    | Fragment transfers inside one yt-dlp attempt                                                       |
| `YTDLP_IMPERSONATE`          | disabled               | Impersonation target; enable only when `yt-dlp --list-impersonate-targets` reports it as available |
| `FFMPEG_PATH`                | automatic              | Operator-managed FFmpeg executable                                                                 |
| `FFPROBE_PATH`               | automatic              | Operator-managed FFprobe executable                                                                |
| `FFMPEG_THREADS`             | `2`                    | Encoder threads per fitting job                                                                    |
| `YOUTUBE_JS_ENABLED`         | `true`                 | Enables the YouTube.js fallback                                                                    |
| `GALLERY_DL_ENABLED`         | `true`                 | Enables gallery and image extraction                                                               |
| `GALLERY_DL_PATH`            | automatic              | Operator-managed gallery-dl executable                                                             |
| `PAGE_METADATA_ENABLED`      | `true`                 | Enables generic page metadata extraction                                                           |
| `PAGE_METADATA_MAX_SIZE`     | `1mb`                  | Maximum HTML read by the metadata engine                                                           |
| `INSTAGRAM_PROXY_HOSTS`      | `www.kkkinstagram.com` | Ordered Instagram relay hosts; use `none` to disable                                               |
| `INSTAGRAM_PROXY_FIRST`      | `false`                | Try the configured relay before other engines for Instagram video/auto; the relay receives the URL |
| `REDDIT_PROXY_HOSTS`         | `redditez.com`         | Ordered Reddit embed relay hosts; use `none` to disable                                            |
| `DISABLED_ENGINES`           | empty                  | Engine names removed from every plan                                                               |

### Cobalt and runtime

| Variable                     | Default                                                     | Purpose                                                                 |
| ---------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| `COBALT_API_ENDPOINTS`       | empty                                                       | Operator-authorized instances; Compose supplies two internal URLs       |
| `COBALT_DIRECTORY_ENABLED`   | `false`                                                     | Opt in to tested, Turnstile-free entries from cobalt.directory          |
| `COBALT_DIRECTORY_URL`       | `https://cobalt.directory/api/working?type=api&turnstile=0` | Directory API used when discovery is enabled                            |
| `COBALT_ENDPOINT_TIMEOUT_MS` | `12000`                                                     | Cobalt endpoint request timeout                                         |
| `COBALT_MAX_ENDPOINTS`       | `5`                                                         | Maximum configured and discovered endpoints                             |
| `COBALT_FAILURE_COOLDOWN_MS` | `60000`                                                     | Local cooldown after an endpoint failure                                |
| `COBALT_API_KEY`             | empty                                                       | Credential for operator-configured Cobalt endpoints                     |
| `COBALT_AUTH_SCHEME`         | `Api-Key`                                                   | Authorization scheme paired with `COBALT_API_KEY`                       |
| `TEMP_PREFIX`                | `mediafilez-`                                               | Temp-directory prefix; it must be a plain name of at least 8 characters |
| `HTTP_USER_AGENT`            | `MediaFilez/2.1 (Discord media downloader)`                 | User-Agent for HTTP, Cobalt, and Discord upload requests                |
| `DEBUG`                      | `false`                                                     | Enables debug log lines                                                 |

## Discord limits

Discord sends `attachment_size_limit` with each interaction. MediaFilez uses the smaller value between that limit, `DISCORD_UPLOAD_TARGET_SIZE`, and its 500 MiB hard ceiling. Discord documents this field as the effective per-attachment limit for the invoking user or guild: [Discord interaction and upload reference](https://docs.discord.com/developers/interactions/receiving-and-responding).

When `fit_to_limit` is enabled, MediaFilez keeps media unchanged if it fits. Oversized video goes through remux, audio-only reduction, then H.264 fitting when needed. Oversized audio is re-encoded at a target-aware bitrate. Oversized images become JPEG and step down through bounded quality and resolution attempts. Files that cannot fit at usable settings return a measured size error.

The final multipart request streams from disk and remains under the whole-job abort signal. Upload retries are verification-first. If Discord closes a connection, the bot fetches the original reply and checks its attachment before another upload starts. An unknown delivery state never clears a file that Discord may have accepted.

## Project map

```text
src/
  commands/              Discord command schema
  jobs/                  queue, limits, and job lifetime
  download/              planning, validation, and engine ownership
    engines/             one adapter per downloader or resolver
  media/                 image, audio, and video preparation
  platform/discord/      reply and upload state machine
  utils/                 shared process, file, security, and format code
test/
  unit/                  deterministic behavior tests
  smoke-*.js             live local proofs
docs/architecture.md     invariants and ownership boundaries
CONTRIBUTING.md          code and test rules
```

Keep new engines beside existing engines. Do not move validation, fallback ownership, or reply state into adapters. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change.

## License

MediaFilez is licensed under AGPL-3.0-only. See [LICENSE](LICENSE).

## Policies

- [Terms of Service](TERMS_OF_SERVICE.md) for the official hosted bot
- [Privacy Policy](PRIVACY_POLICY.md), including data use, recipients, retention, and deletion requests
- [Security Policy](SECURITY.md) for private vulnerability reporting

Self-hosters are independent operators and must publish policies that match their actual deployment.
