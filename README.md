# BitChord NetEase addon

A small, NetEase-only HTTP addon for BitChord, following the NetEase source design from [Purebit](https://github.com/bijimathew/purebit-addon): it searches NetEase's public catalog and resolves audio through a Meting endpoint. Before returning a stream to BitChord, it inspects the audio header and only accepts a real FLAC stream; requesting a high bitrate alone is not proof of lossless audio.

## Requirements

- Node.js 20 or newer
- A reachable NetEase catalog and Meting endpoint

This addon does not require API Enhanced or your own NetEase account. The default Meting endpoint is a third-party public service; its availability, quality, and account access are outside this project's control. For reliability and privacy, configure a Meting instance you operate.

## Run locally

In this project:

```powershell
npm start
```

The addon listens on `http://localhost:8787` for local checks. BitChord on a phone cannot use the computer's `localhost`; the phone must be able to reach the addon host. For practical mobile use, publish the addon behind HTTPS and add that HTTPS URL in BitChord's Sources settings.

A public tunnel exposes the addon to anyone with its URL, and requests use the configured Meting endpoint. Use the tunnel for personal testing and stop it when you are done; add authentication before keeping a public deployment online.

Optional environment variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | Addon port (default `8787`) |
| `HOST` | Bind address (default `0.0.0.0`) |
| `NETEASE_SEARCH_BASE` | NetEase catalog base URL (default `https://music.163.com`) |
| `METING_BASES` | Comma-separated Meting endpoint URLs (default `https://api.qijieya.cn/meting`) |
| `NETEASE_BITRATE` | Requested Meting bitrate (default `999000`) |

If you are testing on a local network, use the addon host's LAN address only if BitChord accepts HTTP source URLs; otherwise use an HTTPS reverse proxy.

You can self-host [Meting](https://github.com/metowolf/Meting) and set `METING_BASES` to its endpoint. The addon tries configured endpoints in order and uses the first one that resolves to verified FLAC.

## Check it

```powershell
Invoke-RestMethod http://localhost:8787/manifest.json
Invoke-RestMethod "http://localhost:8787/search?q=Radiohead%20Creep"
Invoke-RestMethod http://localhost:8787/stream/ne_123456
npm test
```

Replace `ne_123456` with a track ID returned by `/search`. A stream request returns 404 when the configured Meting endpoints cannot resolve that track as FLAC. Upstream search errors are logged by the addon and returned as 502.

## API flow

1. BitChord requests `/search?q=...`; the addon calls NetEase's public `/api/cloudsearch/pc` catalog and translates songs into BitChord track rows.
2. BitChord requests `/stream/{addon-track-id}`; the addon asks each configured Meting endpoint for `server=netease&type=url&id=...&br=999000`.
3. The addon follows the stream redirect, range-reads the candidate audio, checks the FLAC marker and STREAMINFO block, and returns audio metadata plus the direct URL. Non-FLAC results are rejected.

Search results are catalog matches and may include tracks that have no lossless stream available. Those are rejected at stream resolution rather than advertised as playable lossless audio. Meting services may return MP3 even when asked for a high bitrate; the addon verifies the actual bytes and does not relabel MP3 as FLAC.
