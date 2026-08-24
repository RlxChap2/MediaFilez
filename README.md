# MediaFilez

MediaFilez downloads public media into Discord through one `/media` command. It tries ordered engines, validates every result, fits oversized video to the current interaction limit, and uploads one confirmed attachment.

The command has three output choices:

- **Video** downloads playable video.
- **Image / video frame** returns a source image, page thumbnail, or a frame from video.
- **Audio** downloads or extracts audio.

`Thumbnail` no longer appears as a separate choice. Old interactions using its stored value remain valid while Discord propagates the updated command.

## What changed in 2.1

- Local installs include FFmpeg and FFprobe packages. `pnpm install` also fetches a SHA-256 verified gallery-dl build into `.tools` when no operator path is supplied.
- Instagram has a direct embed-proxy fallback. The default converts `instagram.com` to `kkkinstagram.com`, then downloads the returned media through the same redirect, SSRF, size, and signature checks as any other URL.
- Unknown pages gain a metadata extractor for Open Graph, Twitter card, and HTML media tags.
- Share-link wrappers and JSON-LD `contentUrl` fields feed the guarded direct downloader. Reddit image posts also have a first-party embed fallback for cases where its normal page or JSON API blocks server addresses.
- Multiple Cobalt endpoints rotate across jobs. A failed endpoint enters a short cooldown so every queued job does not wait on the same dead host.
- The queue accepts four jobs by default and two jobs per user. Both values remain configurable.
- Discord's `attachmentSizeLimit` is now the normal upload target. The old 7 MiB ceiling is gone.

## Download pipeline

Engine order depends on the host and requested output.

| Source | Default order |
| --- | --- |
| Direct media URL | direct HTTP, yt-dlp |
| YouTube | yt-dlp, YouTube.js, Cobalt, page metadata |
| Instagram video or audio | yt-dlp, Instagram proxy, Cobalt, gallery-dl, page metadata |
| Instagram image | gallery-dl, yt-dlp, Instagram proxy, Cobalt, page metadata |
| Pinterest, Flickr, Imgur | gallery-dl, yt-dlp, Cobalt, page metadata |
| Reddit image | Reddit embed, gallery-dl, yt-dlp, Cobalt, page metadata |
| Reddit video or audio | Cobalt, yt-dlp, Reddit embed, gallery-dl, page metadata |
| Other Cobalt services | Cobalt, yt-dlp, gallery-dl, page metadata |
| Unknown page | yt-dlp, gallery-dl, page metadata, direct HTTP |

Each engine writes into its own attempt directory. MediaFilez checks file signatures and FFprobe streams before committing a result. A fallback starts only after the prior attempt stops and leaves no valid file. A process error does not discard a complete file left behind.

The catch-all engines cover many sites, including Pinterest, but no downloader can guarantee every website. Sites change markup, expire media URLs, block data-center addresses, require fresh cookies, or remove extractor access. See the current [yt-dlp supported sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) and [gallery-dl supported sites](https://github.com/mikf/gallery-dl/blob/master/docs/supportedsites.md).

## Requirements

- Node.js 22 or newer
- pnpm 11
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
pnpm run preflight
pnpm run deploy
pnpm start
```

Global command updates can take time to appear in every Discord client. `pnpm run deploy` must run after changing command choices. Deployment upserts `/media` without deleting Discord's Activity Entry Point or unrelated commands.

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

The Compose stack starts MediaFilez and two private Cobalt v11 APIs on an internal network.

```bash
docker compose up -d --build
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

MediaFilez tries configured endpoints in order, falls through failures, and cools down dead hosts. Directory results are filtered to the requested service and exclude Turnstile-protected instances. `COBALT_DIRECTORY_ENABLED` remains off because directory entries are third-party services with separate privacy, availability, and authorization rules. The request and response format follows the [Cobalt API documentation](https://github.com/imputnet/cobalt/blob/main/docs/api.md).

## Cookies and restricted posts

Some public posts still require an authenticated browser session. Export a fresh Netscape-format cookie file and set:

```env
MEDIA_COOKIES_FILE=C:\path\to\cookies.txt
```

yt-dlp and gallery-dl share this file. Mount it read-only on a server and never commit it.

```yaml
services:
  mediafilez:
    environment:
      MEDIA_COOKIES_FILE: /run/secrets/media-cookies.txt
    volumes:
      - ./secrets/media-cookies.txt:/run/secrets/media-cookies.txt:ro
```

`YTDLP_COOKIES_FROM_BROWSER` is useful for local diagnosis. A cookie file works better on servers because browsers may lock their databases and Windows DPAPI ties decryption to a user session.

MediaFilez does not bypass private-account permissions, paywalls, DRM, or removed content. Download only media you have permission to access and save.

## Main configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAX_DOWNLOAD_SIZE` | `500mb` | Maximum source artifact before processing |
| `MAX_CONCURRENT_JOBS` | `4` | Jobs running at once |
| `MAX_QUEUE_SIZE` | `50` | Waiting jobs before backpressure rejects work |
| `MAX_CONCURRENT_JOBS_PER_USER` | `2` | Per-user running or queued job cap |
| `DISCORD_UPLOAD_TARGET_SIZE` | `500mb` | Operator ceiling; the interaction limit can lower it |
| `DISCORD_UPLOAD_ATTEMPTS` | `3` | Verified attachment upload attempts |
| `JOB_TIMEOUT_MS` | `840000` | Whole-job timeout below Discord's token lifetime |
| `YTDLP_CONCURRENT_FRAGMENTS` | `4` | Fragment transfers inside one yt-dlp attempt |
| `YTDLP_IMPERSONATE` | disabled | Optional yt-dlp impersonation target; enable only when `yt-dlp --list-impersonate-targets` reports it as available |
| `FFMPEG_THREADS` | `2` | Encoder threads per fitting job |
| `GALLERY_DL_ENABLED` | `true` | Enables gallery and image extraction |
| `PAGE_METADATA_ENABLED` | `true` | Enables generic page metadata extraction |
| `PAGE_METADATA_MAX_SIZE` | `1mb` | Maximum HTML read by the metadata engine |
| `INSTAGRAM_PROXY_HOSTS` | `www.kkkinstagram.com` | Ordered public Instagram relay hosts; use `none` to disable |
| `COBALT_API_ENDPOINTS` | empty | Operator-authorized instances; Compose supplies its two internal Cobalt endpoints |
| `COBALT_DIRECTORY_ENABLED` | `false` | Opt in to tested, Turnstile-free third-party instances from cobalt.directory |
| `DISABLED_ENGINES` | empty | Engine names removed from every plan |

`.env.example` contains timeout, upload retry, path override, cookie, and Cobalt settings.

## Discord limits

Discord sends `attachment_size_limit` with each interaction. MediaFilez uses the smaller value between that limit, `DISCORD_UPLOAD_TARGET_SIZE`, and its 500 MiB hard ceiling. Discord documents this field as the effective per-attachment limit for the invoking user or guild: [Discord interaction and upload reference](https://docs.discord.com/developers/interactions/receiving-and-responding).

When `fit_to_limit` is enabled, MediaFilez keeps a video unchanged if it fits. Oversized video goes through remux, audio-only reduction, then H.264 fitting when needed. Files that cannot fit at usable settings return a measured size error.

Upload retries are verification-first. If Discord closes a connection, the bot fetches the original reply and checks its attachment before another upload starts. An unknown delivery state never clears a file that Discord may have accepted.

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
