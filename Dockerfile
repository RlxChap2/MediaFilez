FROM node:22-bookworm-slim

WORKDIR /app

ARG GALLERY_DL_VERSION=1.32.10
ARG YT_DLP_VERSION=2026.8.19

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-venv \
  && python3 -m venv /opt/gallery-dl \
  && /opt/gallery-dl/bin/pip install --no-cache-dir \
    "gallery-dl==${GALLERY_DL_VERSION}" \
    "yt-dlp[default,curl-cffi]==${YT_DLP_VERSION}" \
  && ln -s /opt/gallery-dl/bin/gallery-dl /usr/local/bin/gallery-dl \
  && ln -s /opt/gallery-dl/bin/yt-dlp /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts ./scripts
RUN GALLERY_DL_AUTO_INSTALL=false pnpm install --prod --frozen-lockfile

COPY src ./src
COPY test ./test

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe

CMD ["node", "src/index.js"]
