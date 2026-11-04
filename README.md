# 🎧 BitChord NetEase Addon

**Lossless**

It searches NetEase's public catalog, resolves audio through a Meting endpoint, then opens the file and checks the header itself
Real FLAC gets through to BitChord
Everything else is turned away at the door.

## ✨ What it does
- 🔎 Searches NetEase Cloud Music's public catalog
- 🕵️ Inspects the audio header before playback
- ✅ Only passes genuine FLAC to BitChord
- 🚫 Returns nothing instead of a fake-lossless stream

## 📦 Requirements
- Node.js 20 or newer

## 🚀 Run it
```powershell
npm start
```
The addon listens on `http://localhost:8787` for local checks.

## 📱 Connect to BitChord
Your phone can't reach your computer's `localhost`, so the addon needs a home your phone can see:

1. Host it somewhere reachable over **HTTPS** (a server or a tunnel)
2. Open BitChord → **Settings → Sources**
3. Add your HTTPS URL
4. Search, tap, enjoy

## 🔐 Heads up: tunnels are public
A public tunnel exposes the addon, and the Meting endpoint it uses, to anyone with the URL. Use tunnels for personal testing and shut them down when you're done. Add authentication before keeping a public deployment online.

## ⚠️ Disclaimer
- This project is **not affiliated with or endorsed by** NetEase Cloud Music, Meting, or BitChord.
- It only works with content NetEase makes publicly available. It does not bypass VIP, paywall, DRM, or region restrictions.
- Availability and quality vary by track. If no genuine FLAC is found, nothing plays.
- Provided for **personal and educational use**, as is and without warranty. You are responsible for following NetEase's terms of service and the copyright laws where you live.
- Please support the artists you love by buying their music or subscribing to a licensed service