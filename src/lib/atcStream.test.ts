import { describe, expect, it } from "vitest";
import { isPlaylistUrl, parsePlaylist } from "./atcStream";

describe("isPlaylistUrl", () => {
  it("flags playlist wrappers but not raw streams", () => {
    expect(isPlaylistUrl("https://www.liveatc.net/play/lszh1_app_fin2.pls")).toBe(true);
    expect(isPlaylistUrl("https://x/y.m3u")).toBe(true);
    expect(isPlaylistUrl("https://x/y.m3u8")).toBe(true);
    expect(isPlaylistUrl("https://d.liveatc.net/lszh1_app_fin2")).toBe(false);
    expect(isPlaylistUrl("https://x/stream.mp3")).toBe(false);
  });
});

describe("parsePlaylist", () => {
  it("pulls the stream URL out of a .pls and upgrades http→https", () => {
    const pls = "[playlist]\nnumberofentries=1\nFile1=http://d.liveatc.net/lszh1_app_fin2\nTitle1=ZRH\nversion=2\n";
    expect(parsePlaylist(pls)).toBe("https://d.liveatc.net/lszh1_app_fin2");
  });

  it("pulls the first URL from an .m3u, skipping comments", () => {
    const m3u = "#EXTM3U\n#EXTINF:-1,ZRH\nhttp://example.com/stream\n";
    expect(parsePlaylist(m3u)).toBe("https://example.com/stream");
  });

  it("leaves an https stream as-is and returns null for an empty playlist", () => {
    expect(parsePlaylist("File1=https://s.example.com/live")).toBe("https://s.example.com/live");
    expect(parsePlaylist("[playlist]\nnumberofentries=0\n")).toBeNull();
  });
});
