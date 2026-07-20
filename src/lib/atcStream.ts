/**
 * Helpers for bring-your-own ATC stream URLs. LiveATC (and many Icecast feeds) hand
 * out a `.pls`/`.m3u` *playlist* file, not a raw audio stream — an `<audio>` element
 * can't play the playlist itself, so we resolve it to the stream URL inside.
 */

/** Does the URL point to a playlist wrapper (.pls/.m3u/.m3u8) rather than a raw stream? */
export function isPlaylistUrl(url: string): boolean {
  return /\.(pls|m3u8?)(\?|#|$)/i.test(url.trim());
}

/**
 * Extract the first stream URL from a `.pls` or `.m3u` playlist body, upgrading
 * `http://` → `https://` so it isn't blocked as mixed content on our HTTPS page.
 * Returns null when no stream URL is present.
 */
export function parsePlaylist(text: string): string | null {
  // .pls: `FileN=<url>`
  const pls = text.match(/^\s*File\d*\s*=\s*(\S+)/im);
  let stream = pls?.[1]?.trim() ?? null;
  if (!stream) {
    // .m3u: the first non-comment line that looks like a URL.
    stream =
      text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith("#") && /^https?:\/\//i.test(l)) ?? null;
  }
  if (!stream) return null;
  return stream.replace(/^http:\/\//i, "https://");
}
