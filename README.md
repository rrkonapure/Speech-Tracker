# SpeechTrack — Daily Speech Tracker PWA

A Progressive Web App to measure and analyse how much you speak throughout the day.

## Features
- Live microphone recording with waveform visualizer
- Real-time volume detection (Loud / Normal / Soft)
- Daily stats: total speaking time, session count, longest session, average volume
- Automatic smart badges (Good pacing, Varied tone, etc.)
- Session log with timestamps
- Data persists across sessions (resets each day)
- Works offline (Service Worker)
- Installable to phone home screen (PWA)

## Files
```
speech-tracker-pwa/
├── index.html      ← Main app
├── style.css       ← Styles
├── app.js          ← App logic + mic recording
├── sw.js           ← Service Worker (offline)
├── manifest.json   ← PWA manifest
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

## How to Deploy (Required for mic access on mobile)

### Option 1 — Netlify (Easiest, Free)
1. Go to https://netlify.com and sign up free
2. Drag and drop this entire folder onto Netlify's dashboard
3. You get a live HTTPS URL instantly (e.g. https://speechtrack.netlify.app)
4. Open on your phone → browser shows "Add to Home Screen"

### Option 2 — GitHub Pages
1. Create a new GitHub repo
2. Upload all files
3. Go to Settings → Pages → Branch: main → Save
4. Your app is live at https://yourusername.github.io/repo-name

### Option 3 — Local Testing (Desktop Chrome only)
```bash
# Python (comes pre-installed on most systems)
python3 -m http.server 8080
# Then open http://localhost:8080 in Chrome
```
Note: Mic permission works on localhost but NOT on mobile without HTTPS.

## Mobile Install (Android)
1. Open the HTTPS URL in Chrome
2. Tap the 3-dot menu → "Add to Home Screen"
3. Or tap the install banner that appears in the app

## Mobile Install (iPhone/iOS)
1. Open the HTTPS URL in Safari (must be Safari)
2. Tap the Share button (box with arrow)
3. Scroll down → "Add to Home Screen"
4. Tap Add — the app icon appears on your home screen

## Important Notes
- Microphone permission MUST be granted for the app to work
- On iOS (Safari), permission may need to be re-granted each session
- On Android (Chrome), permission is saved permanently
- All data stays on your device — nothing is sent to any server
- The app resets daily (new day = fresh stats)
