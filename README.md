# MediaFilez

MediaFilez downloads public media into Discord through one `/media` command. It tries ordered engines, validates every result, fits oversized video, audio, or images to the current interaction limit, and streams one confirmed attachment without buffering the whole file in memory.

The command has four output choices:

- **Auto (detect media)** accepts the first validated video, audio, or image found at the URL and applies the matching processing path.
- **Video** downloads playable video.
- **Image / video frame** returns a source image, page thumbnail, or a frame from video.
- **Audio** downloads or extracts audio.

`Thumbnail` no longer appears as a separate choice. Old interactions using its stored value remain valid while Discord propagates the updated command.

## What changed in 2.1

- `/media` includes an `Auto` output that accepts validated video, audio, or image media and chooses the matching processing path.
- Local installs include FFmpeg and FFprobe packages. `pnpm install` also fetches a SHA-256 verified gallery-dl build into `.tools` when no operator path is supplied.
- Instagram has a direct embed-proxy fallback. The default converts `instagram.com` to `kkkinstagram.com`, then downloads the returned media through the same redirect, SSRF, size, and signature checks as any other URL.
- Unknown pages gain a metadata extractor for Open Graph, Twitter card, and HTML media tags.
- Share-link wrappers and JSON-LD `contentUrl` fields feed the guarded direct downloader. Reddit posts first use the first-party embed path, then a configurable public embed relay when Reddit blocks the bot server's address.
- Multiple Cobalt endpoints rotate across jobs. A failed endpoint enters a short cooldown so every queued job does not wait on the same dead host.
- Cobalt now covers its full documented host set in the planner and requests a target-aware video quality instead of always requesting the largest source.
- External downloaders run only for recognized public platforms. Unknown pages and direct links stay inside the DNS-, redirect-, and byte-guarded HTTP engines, and gallery-dl enforces the byte ceiling during transfer.
- The queue accepts four jobs by default and two jobs per user. Both values remain configurable.
- Discord's `attachmentSizeLimit` is now the normal upload target. The old 7 MiB ceiling is gone.
- Final Discord uploads use a bounded-memory multipart stream. Nitro-sized attachments no longer expand into several in-memory copies before delivery.
- `fit_to_limit` now handles oversized audio and images as well as video. Audio is re-encoded to MP3; images step down JPEG quality and resolution only as far as needed.
- An engine-local timeout falls through to the next engine. Only the whole-job abort stops fallback.
- yt-dlp receives a private writable cookie copy for each attempt, so the configured source can remain mounted read-only and concurrent jobs cannot rewrite one shared jar.
- Startup removes abandoned MediaFilez temp directories owned by stopped processes without touching work owned by another running instance.

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

The platform engines cover many sites, including Pinterest, while unknown pages can still expose media through standard page metadata or direct HTTP. Unknown URLs are not passed blindly to yt-dlp or gallery-dl: keeping them in the redirect-, DNS-, and byte-guarded HTTP path prevents an arbitrary page from expanding the subprocess network boundary. Add a host to an explicit platform route only after its extractor and security behavior are known.

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

MediaFilez tries configured endpoints in order, falls through failures, and cools down dead hosts. Directory results are filtered to the requested service and exclude Turnstile-protected instances. `COBALT_API_KEY` is sent only to operator-configured endpoints, never endpoints learned from the directory. Directory connections repeat the public-address check when opening the socket, and Cobalt JSON responses have a fixed size limit. `COBALT_DIRECTORY_ENABLED` remains off because directory entries are third-party services with separate privacy, availability, and authorization rules. The request and response format follows the [Cobalt API documentation](https://github.com/imputnet/cobalt/blob/main/docs/api.md).

## Cookies and restricted posts

Some public posts still require an authenticated browser session. Export a fresh Netscape-format cookie file and set:

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

MediaFilez does not bypass private-account permissions, paywalls, DRM, or removed content. Download only media you have permission to access and save.

## Main configuration

| Variable                       | Default                | Purpose                                                                                                            |
| ------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `MAX_DOWNLOAD_SIZE`            | `500mb`                | Maximum source artifact before processing                                                                          |
| `MAX_CONCURRENT_JOBS`          | `4`                    | Jobs running at once                                                                                               |
| `MAX_QUEUE_SIZE`               | `50`                   | Waiting jobs before backpressure rejects work                                                                      |
| `MAX_CONCURRENT_JOBS_PER_USER` | `2`                    | Per-user running or queued job cap                                                                                 |
| `DISCORD_UPLOAD_TARGET_SIZE`   | `500mb`                | Operator ceiling; the interaction limit can lower it                                                               |
| `DISCORD_UPLOAD_ATTEMPTS`      | `3`                    | Verified attachment upload attempts                                                                                |
| `JOB_TIMEOUT_MS`               | `840000`               | Whole-job timeout below Discord's token lifetime                                                                   |
| `YTDLP_CONCURRENT_FRAGMENTS`   | `4`                    | Fragment transfers inside one yt-dlp attempt                                                                       |
| `YTDLP_IMPERSONATE`            | disabled               | Optional yt-dlp impersonation target; enable only when `yt-dlp --list-impersonate-targets` reports it as available |
| `FFMPEG_THREADS`               | `2`                    | Encoder threads per fitting job                                                                                    |
| `GALLERY_DL_ENABLED`           | `true`                 | Enables gallery and image extraction                                                                               |
| `PAGE_METADATA_ENABLED`        | `true`                 | Enables generic page metadata extraction                                                                           |
| `PAGE_METADATA_MAX_SIZE`       | `1mb`                  | Maximum HTML read by the metadata engine                                                                           |
| `INSTAGRAM_PROXY_HOSTS`        | `www.kkkinstagram.com` | Ordered public Instagram relay hosts; use `none` to disable                                                        |
| `REDDIT_PROXY_HOSTS`           | `redditez.com`         | Ordered public Reddit embed relay hosts; use `none` to disable                                                     |
| `COBALT_API_ENDPOINTS`         | empty                  | Operator-authorized instances; Compose supplies its two internal Cobalt endpoints                                  |
| `COBALT_DIRECTORY_ENABLED`     | `false`                | Opt in to tested, Turnstile-free third-party instances from cobalt.directory                                       |
| `DISABLED_ENGINES`             | empty                  | Engine names removed from every plan                                                                               |

`.env.example` contains timeout, upload retry, path override, cookie, and Cobalt settings.

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
