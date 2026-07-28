import path from 'node:path';
import { config } from '../config.js';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);
const GALLERY_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'pinterest.com', 'www.pinterest.com', 'flickr.com', 'www.flickr.com', 'imgur.com', 'www.imgur.com']);
const COBALT_HOSTS = new Set([
  'instagram.com', 'www.instagram.com', 'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be',
  'tiktok.com', 'www.tiktok.com', 'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'facebook.com', 'www.facebook.com',
  'fb.watch', 'reddit.com', 'www.reddit.com', 'redd.it', 'tumblr.com', 'www.tumblr.com', 'bsky.app', 'soundcloud.com',
  'vimeo.com', 'www.vimeo.com', 'snapchat.com', 'www.snapchat.com', 'streamable.com', 'www.streamable.com', 'vk.com',
]);
const DIRECT_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mp3', '.m4a', '.ogg', '.opus', '.wav', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif']);

export function classifySource(rawUrl) {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const extension = path.extname(url.pathname).toLowerCase();
    return {
        direct: DIRECT_EXTENSIONS.has(extension),
        youtube: YOUTUBE_HOSTS.has(host),
        gallery: GALLERY_HOSTS.has(host),
        cobalt: COBALT_HOSTS.has(host),
        host,
    };
}

export function planEngines(rawUrl, outputType, settings = config) {
    const source = classifySource(rawUrl);
    let names;
    if (source.direct) names = ["direct-http", "yt-dlp"];
    else if (source.youtube) names = ["yt-dlp", "youtube-js", "cobalt"];
    else if (source.gallery && ["image", "thumbnail"].includes(outputType)) names = ["gallery-dl", "cobalt", "yt-dlp"];
    else if (source.cobalt) names = ["cobalt", "yt-dlp", "gallery-dl"];
    else names = ["yt-dlp", "gallery-dl", "direct-http"];

    return names.filter((name) => {
        if (settings.disabledEngines?.has(name)) return false;
        if (name === "youtube-js" && !settings.youtubeJsEnabled) return false;
        if (name === "gallery-dl" && !settings.galleryDlEnabled) return false;
        if (name === "cobalt" && settings.cobaltApiEndpoints.length === 0 && !settings.cobaltDirectoryEnabled)
            return false;
        return true;
    });
}
