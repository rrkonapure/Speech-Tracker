/* ── SpeechTrack — app.js ── */

'use strict';

// ── State ──
let state = {
  isRecording: false,
  sessionStart: null,
  sessionTimer: null,
  displayTimer: null,
  totalSecs: 0,
  sessions: [],
  longestSecs: 0,
  loudCount: 0,
  normCount: 0,
  softCount: 0,
  sampleTotal: 0,
  volSamples: []
};

let audioCtx, analyser, micStream, dataArray, animFrame;
let deferredInstallPrompt = null;

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  updateDateLabel();
  loadFromStorage();
  renderAll();
  registerServiceWorker();
  listenForInstallPrompt();
});

function updateDateLabel() {
  const d = new Date();
  const opts = { weekday: 'long', month: 'long', day: 'numeric' };
  document.getElementById('appDate').textContent = d.toLocaleDateString('en-IN', opts);
}

// ── Service Worker ──
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(reg => {
      console.log('SW registered', reg.scope);
    }).catch(err => console.warn('SW error', err));
  }
}

// ── PWA Install ──
function listenForInstallPrompt() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.getElementById('installBanner').style.display = 'flex';
  });

  document.getElementById('installBtn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      document.getElementById('installBanner').style.display = 'none';
    }
    deferredInstallPrompt = null;
  });

  window.addEventListener('appinstalled', () => {
    document.getElementById('installBanner').style.display = 'none';
  });
}

// ── Recording Toggle ──
async function toggleRecording() {
  if (state.isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    document.getElementById('permBanner').style.display = 'none';
  } catch (err) {
    document.getElementById('permBanner').style.display = 'flex';
    return;
  }

  state.isRecording = true;
  state.sessionStart = Date.now();

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.7;
  dataArray = new Uint8Array(analyser.frequencyBinCount);
  const src = audioCtx.createMediaStreamSource(micStream);
  src.connect(analyser);

  // UI
  const btn = document.getElementById('micBtn');
  btn.classList.add('recording');
  document.getElementById('micBtnLabel').textContent = 'Stop';
  document.getElementById('micStatus').textContent = 'Recording in progress...';
  activateWaveBars(true);

  // Live timer
  state.displayTimer = setInterval(() => {
    const elapsed = Math.round((Date.now() - state.sessionStart) / 1000);
    document.getElementById('sessionTimer').textContent = formatClock(elapsed);
  }, 1000);

  drawVolume();
}

function stopRecording() {
  state.isRecording = false;

  cancelAnimationFrame(animFrame);
  clearInterval(state.displayTimer);
  document.getElementById('sessionTimer').textContent = '00:00';

  const dur = Math.round((Date.now() - state.sessionStart) / 1000);
  const avgVol = state.volSamples.length > 0
    ? Math.round(state.volSamples.reduce((a, b) => a + b, 0) / state.volSamples.length)
    : 0;

  state.totalSecs += dur;
  if (dur > state.longestSecs) state.longestSecs = dur;

  const session = {
    id: Date.now(),
    time: nowStr(),
    dur,
    avgVol
  };
  state.sessions.unshift(session);

  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (audioCtx) audioCtx.close();

  // Reset wave bars
  activateWaveBars(false);
  for (let i = 0; i < 9; i++) {
    const b = document.getElementById('wb' + i);
    if (b) b.style.height = '6px';
  }

  // UI
  const btn = document.getElementById('micBtn');
  btn.classList.remove('recording');
  document.getElementById('micBtnLabel').textContent = 'Start';
  document.getElementById('micStatus').textContent = 'Session saved — tap to start another';

  // Clear per-session vol buffer (keep counts for day total)
  state.volSamples = [];

  saveToStorage();
  renderAll();
}

// ── Audio Visualizer ──
function drawVolume() {
  animFrame = requestAnimationFrame(drawVolume);
  analyser.getByteFrequencyData(dataArray);

  // Average across speech freq band (roughly 300Hz–3kHz)
  const low = Math.floor(300 / (audioCtx.sampleRate / analyser.fftSize));
  const high = Math.floor(3000 / (audioCtx.sampleRate / analyser.fftSize));
  let sum = 0, count = 0;
  for (let i = low; i < high && i < dataArray.length; i++) { sum += dataArray[i]; count++; }
  const avg = count > 0 ? sum / count : 0;

  state.volSamples.push(avg);
  state.sampleTotal++;
  if (avg > 50) state.loudCount++;
  else if (avg > 20) state.normCount++;
  else state.softCount++;

  // Wave bars
  const norm = Math.min(avg / 80, 1);
  for (let i = 0; i < 9; i++) {
    const b = document.getElementById('wb' + i);
    if (!b) continue;
    const jitter = 0.4 + Math.random() * 0.8;
    const h = Math.max(6, Math.round(norm * 40 * jitter));
    b.style.height = h + 'px';
  }

  // Live volume badges
  updateActivityBadges();
}

function activateWaveBars(active) {
  const bars = document.querySelectorAll('.wave-bar');
  bars.forEach(b => active ? b.classList.add('active') : b.classList.remove('active'));
}

// ── Render ──
function renderAll() {
  renderStats();
  renderActivity();
  renderLog();
}

function renderStats() {
  const mins = (state.totalSecs / 60).toFixed(1);
  document.getElementById('statTotal').innerHTML = mins + '<span class="stat-u">min</span>';
  document.getElementById('statSessions').textContent = state.sessions.length;
  document.getElementById('statLongest').innerHTML = state.longestSecs + '<span class="stat-u">s</span>';

  if (state.sessions.length > 0) {
    const allVols = state.sessions.map(s => s.avgVol).filter(v => v > 0);
    const avg = allVols.length > 0 ? Math.round(allVols.reduce((a,b) => a+b, 0) / allVols.length) : 0;
    document.getElementById('statAvgVol').textContent = avg || '–';
  } else {
    document.getElementById('statAvgVol').textContent = '–';
  }
}

function renderActivity() {
  const total = state.sampleTotal || 1;
  const lp = Math.round(state.loudCount / total * 100);
  const np = Math.round(state.normCount / total * 100);
  const sp = Math.round(state.softCount / total * 100);

  document.getElementById('fillLoud').style.width = lp + '%';
  document.getElementById('fillNorm').style.width = np + '%';
  document.getElementById('fillSoft').style.width = sp + '%';
  document.getElementById('pctLoud').textContent = lp + '%';
  document.getElementById('pctNorm').textContent = np + '%';
  document.getElementById('pctSoft').textContent = sp + '%';

  updateActivityBadges();
}

function updateActivityBadges() {
  const total = state.sampleTotal || 1;
  const lp = Math.round(state.loudCount / total * 100);
  const np = Math.round(state.normCount / total * 100);
  const sp = Math.round(state.softCount / total * 100);

  const container = document.getElementById('badges');
  const items = [];

  if (state.sampleTotal < 20) { container.innerHTML = ''; return; }

  if (np > 45) items.push(['badge-green', 'Good pacing']);
  if (sp > 25 && np > 20) items.push(['badge-blue', 'Varied tone']);
  if (lp > 35) items.push(['badge-red', 'Loud sections']);
  if (state.sessions.length >= 5) items.push(['badge-amber', 'Very active day']);
  if (state.totalSecs > 3600) items.push(['badge-green', 'High speaker']);

  container.innerHTML = items.map(([cls, label]) =>
    `<span class="badge ${cls}">${label}</span>`
  ).join('');
}

function renderLog() {
  const list = document.getElementById('logList');
  if (state.sessions.length === 0) {
    list.innerHTML = '<li class="log-empty">No sessions yet — tap the mic to start</li>';
    return;
  }
  list.innerHTML = state.sessions.slice(0, 20).map(s => `
    <li class="log-item">
      <div class="log-left">
        <div class="log-dot"></div>
        <div class="log-details">
          <span class="log-time">${s.time}</span>
          <span class="log-vol">${s.avgVol > 0 ? 'avg vol: ' + s.avgVol : 'no voice detected'}</span>
        </div>
      </div>
      <span class="log-dur">${formatDur(s.dur)}</span>
    </li>
  `).join('');
}

// ── Reset ──
function resetDay() {
  if (!confirm('Reset all data for today?')) return;
  state.totalSecs = 0;
  state.sessions = [];
  state.longestSecs = 0;
  state.loudCount = 0;
  state.normCount = 0;
  state.softCount = 0;
  state.sampleTotal = 0;
  state.volSamples = [];
  saveToStorage();
  renderAll();
}

// ── Persistence ──
function saveToStorage() {
  try {
    const save = {
      date: todayKey(),
      totalSecs: state.totalSecs,
      sessions: state.sessions,
      longestSecs: state.longestSecs,
      loudCount: state.loudCount,
      normCount: state.normCount,
      softCount: state.softCount,
      sampleTotal: state.sampleTotal
    };
    localStorage.setItem('speechtrack_data', JSON.stringify(save));
  } catch (e) { console.warn('Storage save failed', e); }
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('speechtrack_data');
    if (!raw) return;
    const save = JSON.parse(raw);
    if (save.date !== todayKey()) return; // new day — start fresh
    state.totalSecs = save.totalSecs || 0;
    state.sessions = save.sessions || [];
    state.longestSecs = save.longestSecs || 0;
    state.loudCount = save.loudCount || 0;
    state.normCount = save.normCount || 0;
    state.softCount = save.softCount || 0;
    state.sampleTotal = save.sampleTotal || 0;
  } catch (e) { console.warn('Storage load failed', e); }
}

// ── Helpers ──
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function nowStr() {
  const d = new Date();
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

function formatDur(secs) {
  if (secs < 60) return secs + 's';
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatClock(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
