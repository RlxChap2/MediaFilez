# MediaFilez

MediaFilez is a Discord media downloader built around one rule: a fallback may start only after the previous attempt has stopped and left no valid file behind.

The `/media` command accepts a page or direct-media URL and returns video, audio, an image, or a thumbnail. Each download runs in an isolated attempt directory. MediaFilez validates the result with file signatures and FFprobe, moves one accepted artifact into a completed directory, then uploads it once.

## Engines

The engine order depends on the URL and requested output.

| Source | Typical order |
| --- | --- |
| Direct media URL | direct HTTP → yt-dlp |
| YouTube | yt-dlp → YouTube.js → Cobalt |
| Instagram/Pinterest image | gallery-dl → Cobalt → yt-dlp |
| Other supported social sites | Cobalt → yt-dlp → gallery-dl |
| Unknown page | yt-dlp → gallery-dl → direct HTTP |

- **yt-dlp** handles most video and audio sites. MediaFilez invokes its bundled executable directly and uses Node 22 as the YouTube JavaScript runtime.
- **Cobalt** runs as a private v11 sidecar in the Compose stack. No community instance is enabled by default.
- **YouTube.js** is the YouTube-specific fallback.
- **gallery-dl** covers image posts and galleries. The Docker image installs it; local installs are optional.
- **direct HTTP** streams obvious media URLs with redirect and size checks.

Metadata is best effort. yt-dlp info JSON, YouTube.js basic info, gallery-dl metadata, Cobalt metadata, and HTTP headers are normalized in memory. A metadata failure doesn't discard an otherwise valid download.

## Requirements

- Node.js 22 or newer
- pnpm 11
- FFmpeg and FFprobe for validation, conversion, thumbnails, and fitting video to Discord limits
- gallery-dl only if you want that engine outside Docker

The `youtube-dl-exec` package supplies the official yt-dlp executable. MediaFilez doesn't use its process wrapper.

## Local setup

```bash
pnpm install
copy .env.example .env
pnpm run check
pnpm run preflight
pnpm run deploy
pnpm start
```

Set `BOT_TOKEN` and `CLIENT_ID` in `.env`. The bot registers one global, user-installable command. Discord can take time to propagate a global command update.

Useful checks:

```bash
pnpm run diagnose:engines
pnpm run smoke:download
pnpm run smoke:process
```

## Docker and private Cobalt

The default Compose stack starts MediaFilez and Cobalt on an internal network. Cobalt isn't published on a host port.

```bash
docker compose up -d --build
docker compose logs -f --tail=100
docker compose run --rm mediafilez pnpm run preflight
```

Cobalt is a separate AGPL-licensed service. MediaFilez calls its HTTP API and doesn't copy Cobalt source into this repository.

## Authentication and cookies

Some Reddit, Instagram, YouTube, and other posts require a logged-in session. Export a fresh Netscape-format cookie file and set:

```env
MEDIA_COOKIES_FILE=C:\path\to\cookies.txt
```

That file is shared by yt-dlp and gallery-dl. On a server, mount it read-only. Don't commit it.

```yaml
# compose.override.yaml
services:
  mediafilez:
    environment:
      MEDIA_COOKIES_FILE: /run/secrets/media-cookies.txt
    volumes:
      - ./secrets/media-cookies.txt:/run/secrets/media-cookies.txt:ro
  cobalt:
    environment:
      COOKIE_PATH: /cookies.json
    volumes:
      - ./secrets/cobalt-cookies.json:/cookies.json:ro
```

`YTDLP_COOKIES_FROM_BROWSER` remains available for local troubleshooting. It's a poor server default: Chrome may lock its cookie database, and Windows DPAPI decryption is tied to the user and browser context. A cookie file avoids both failure modes. Closing Chrome or using a Firefox profile may help when browser extraction is unavoidable.

Fresh cookies aren't a bypass for private or access-restricted media. The account still needs permission to view the post.

## Configuration

The full list lives in `.env.example`. These settings control the download system:

| Variable | Default | Purpose |
| --- | --- | --- |
| `MAX_DOWNLOAD_SIZE` | `500mb` | Internal ceiling, clamped to Discord's 500 MB hard limit |
| `MAX_CONCURRENT_JOBS` | `2` | Jobs allowed to run at once |
| `MAX_QUEUE_SIZE` | `50` | Waiting jobs before the bot refuses new work |
| `MAX_CONCURRENT_JOBS_PER_USER` | `1` | Stops one user from occupying the worker pool |
| `JOB_TIMEOUT_MS` | `840000` | Cancels the worker and child processes; it does not merely reject the queue promise |
| `DISCORD_REST_TIMEOUT_MS` | `180000` | Maximum duration of one Discord request; sized for slow 10 MiB uploads |
| `DISCORD_REST_RETRIES` | `0` | Disables opaque library retries; MediaFilez verifies the original response before retrying an upload |
| `DISCORD_UPLOAD_TARGET_SIZE` | `7mb` | Safe processing target for routes that cut slow uploads before Discord's advertised size limit |
| `DISCORD_UPLOAD_ATTEMPTS` | `3` | Verified upload attempts; another attempt starts only after Discord confirms no attachment exists |
| `DISCORD_UPLOAD_RETRY_DELAY_MS` | `1500` | Initial delay between verified upload attempts |
| `HTTP_RESPONSE_TIMEOUT_MS` | `45000` | Maximum wait for a media server to start its response |
| `HTTP_IDLE_TIMEOUT_MS` | `60000` | Cancels a transfer only when no new bytes arrive during this interval |
| `STATUS_UPDATE_INTERVAL_MS` | `2500` | Minimum interval between progress edits in the same phase |
| `MEDIA_COOKIES_FILE` | empty | Shared Netscape cookie file |
| `YTDLP_CONCURRENT_FRAGMENTS` | `4` | Parallel fragment count inside one yt-dlp attempt |
| `GALLERY_DL_ENABLED` | `true` | Enables the optional gallery engine |
| `YOUTUBE_JS_ENABLED` | `true` | Enables the YouTube-specific fallback |
| `DISABLED_ENGINES` | empty | Comma-separated engine names to remove from plans |
| `COBALT_API_ENDPOINTS` | empty | Comma-separated private Cobalt v11 instances |
| `COBALT_DIRECTORY_ENABLED` | `false` | Opt-in discovery of third-party instances |

Compose overrides `COBALT_API_ENDPOINTS` with `http://cobalt:9000`. For local non-Docker use, start your Cobalt instance and set its URL in `.env`.

## Delivery behavior

The reply moves through queued, resolving, downloading, processing, uploading, then one terminal state. The successful attachment and its final text are sent in the same `editReply` call. There's no second edit for upload timing.

If Discord rejects the request after accepting the bytes, MediaFilez fetches the original interaction response and checks the attachment name and size. A confirmed attachment counts as success. If Discord can't confirm either outcome, the response is left untouched and the log records an unknown delivery state.

MediaFilez deliberately does not import `undici` directly. A current discord.js bug can make file sends time out when an application also imports undici; direct downloads use Node's built-in HTTP clients instead. See [discord.js issue #11525](https://github.com/discordjs/discord.js/issues/11525).

## Limits

No engine can promise every site. Platforms change extractors, require accounts, expire cookies, challenge data-center IPs, or limit media by region. MediaFilez reports an authentication action when the failures point to login or cookies; it doesn't disguise those cases as generic scraper failures.

Discord supplies `interaction.attachmentSizeLimit` for each command. MediaFilez uses the smaller of that value and `DISCORD_UPLOAD_TARGET_SIZE`. The conservative 7 MiB default leaves enough transfer-time margin on routes that close near-limit uploads after about a minute. Raise it only after confirming the host can upload larger files reliably. With `fit_to_limit` enabled, an oversized video can be transcoded when a usable result can fit; otherwise the bot reports the measured size and target.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the test commands and engine contract. The state and ownership rules are documented in [docs/architecture.md](docs/architecture.md).

## License

MediaFilez is available under the MIT License. See [LICENSE](LICENSE).
