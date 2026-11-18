FROM node:22-alpine3.24@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a

WORKDIR /app

ARG GALLERY_DL_VERSION=1.32.10
ARG YT_DLP_VERSION=2026.8.19

RUN apk add --no-cache ca-certificates ffmpeg python3 py3-pip \
  && python3 -m venv /opt/gallery-dl \
  && /opt/gallery-dl/bin/pip install --no-cache-dir \
    "gallery-dl==${GALLERY_DL_VERSION}" \
    "yt-dlp[default,curl-cffi]==${YT_DLP_VERSION}" \
  && ln -s /opt/gallery-dl/bin/gallery-dl /usr/local/bin/gallery-dl \
  && ln -s /opt/gallery-dl/bin/yt-dlp /usr/local/bin/yt-dlp

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
RUN GALLERY_DL_AUTO_INSTALL=false YOUTUBE_DL_SKIP_DOWNLOAD=true pnpm install --prod --frozen-lockfile

COPY src ./src
COPY test ./test
COPY official-bot ./official-bot

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    YTDLP_PATH=/usr/local/bin/yt-dlp

RUN apk add --no-cache 'zlib>=1.4-r0'
USER node
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 CMD ["node", "scripts/healthcheck.mjs"]
CMD ["node", "src/index.js"]
