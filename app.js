'use strict';

// ── State ──
let currentMode = null; // 'voice' | 'steps' | 'both'
let currentTab  = 'voice';

const voice = {
  isRecording: false, sessionStart: null, displayTimer: null,
  totalSecs: 0, sessions: [], longestSecs: 0,
  loudCount: 0, normCount: 0, softCount: 0, sampleTotal: 0, volSamples: []
};

const steps = {
  isCounting: false, sessionStart: null, displayTimer: null,
  totalSteps: 0, sessions: [], activeMinutes: 0,
  goal: 8000, lastAcc: null, stepBuffer: [], lastStepTime: 0
};

let audioCtx, analyser, micStream, dataArray, animFrame;
let deferredInstall = null;

// ── Boot ──
document.addEventListener('DOMContentLoaded', () => {
  updateDateLabel();
  loadFromStorage();
  registerSW();
  listenInstall();
});

function updateDateLabel() {
  const d = new Date();
  const el = document.getElementById('appDate');
  if (el) el.textContent = d.toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ── Mode selection ──
function selectMode(mode) {
  currentMode = mode;
  document.getElementById('screenSelect').style.display = 'none';
  document.getElementById('screenApp').style.display = 'block';

  const titles = { voice: 'Voice Tracker', steps: 'Step Counter', both: 'DayTrack' };
  document.getElementById('appTitle').textContent = titles[mode];
  updateDateLabel();

  const tabBar = document.getElementById('tabBar');
  if (mode === 'both') {
    tabBar.style.display = 'flex';
    switchTab('voice');
  } else {
    tabBar.style.display = 'none';
    showPanel(mode);
  }
}

function showPanel(name) {
  document.getElementById('panelVoice').style.display = name === 'voice' ? 'block' : 'none';
  document.getElementById('panelSteps').style.display = name === 'steps' ? 'block' : 'none';
  document.getElementById('panelDash').style.display  = name === 'dashboard' ? 'block' : 'none';
}

function switchTab(tab) {
  currentTab = tab;
  ['voice','steps','dashboard'].forEach(t => {
    const btn = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.classList.toggle('active', t === tab);
  });
  showPanel(tab);
  if (tab === 'dashboard') renderDashboard();
}

function goBack() {
  // Stop any active tracking before going back
  if (voice.isRecording) stopVoice();
  if (steps.isCounting) stopSteps();
  document.getElementById('screenApp').style.display = 'none';
  document.getElementById('screenSelect').style.display = 'block';
}

// ── VOICE TRACKING ──
async function toggleVoice() {
  voice.isRecording ? stopVoice() : await startVoice();
}

async function startVoice() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    document.getElementById('permMicBanner').style.display = 'none';
  } catch (e) {
    document.getElementById('permMicBanner').style.display = 'block';
    return;
  }

  voice.isRecording = true;
  voice.sessionStart = Date.now();

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.7;
  dataArray = new Uint8Array(analyser.frequencyBinCount);
  audioCtx.createMediaStreamSource(micStream).connect(analyser);

  document.getElementById('micBtn').classList.add('recording');
  document.getElementById('micBtnLabel').textContent = 'Stop';
  document.getElementById('micStatus').textContent = 'Recording in progress...';
  document.querySelectorAll('.wave-bar').forEach(b => b.classList.add('active'));

  voice.displayTimer = setInterval(() => {
    const e = Math.round((Date.now() - voice.sessionStart) / 1000);
    document.getElementById('voiceTimer').textContent = clock(e);
  }, 1000);

  drawVolume();
}

function stopVoice() {
  voice.isRecording = false;
  cancelAnimationFrame(animFrame);
  clearInterval(voice.displayTimer);
  document.getElementById('voiceTimer').textContent = '00:00';

  const dur = Math.round((Date.now() - voice.sessionStart) / 1000);
  const avgVol = voice.volSamples.length
    ? Math.round(voice.volSamples.reduce((a,b) => a+b,0) / voice.volSamples.length)
    : 0;

  voice.totalSecs += dur;
  if (dur > voice.longestSecs) voice.longestSecs = dur;
  voice.sessions.unshift({ id: Date.now(), time: nowStr(), dur, avgVol });
  voice.volSamples = [];

  if (micStream) micStream.getTracks().forEach(t => t.stop());
  if (audioCtx)  audioCtx.close();

  document.getElementById('micBtn').classList.remove('recording');
  document.getElementById('micBtnLabel').textContent = 'Start';
  document.getElementById('micStatus').textContent = 'Session saved — tap to start another';
  document.querySelectorAll('.wave-bar').forEach(b => { b.classList.remove('active'); b.style.height = '6px'; });

  saveToStorage();
  renderVoice();
}

function drawVolume() {
  animFrame = requestAnimationFrame(drawVolume);
  analyser.getByteFrequencyData(dataArray);
  const lo = Math.floor(300 / (audioCtx.sampleRate / analyser.fftSize));
  const hi = Math.floor(3000 / (audioCtx.sampleRate / analyser.fftSize));
  let sum = 0, cnt = 0;
  for (let i = lo; i < hi && i < dataArray.length; i++) { sum += dataArray[i]; cnt++; }
  const avg = cnt ? sum / cnt : 0;

  voice.volSamples.push(avg);
  voice.sampleTotal++;
  if (avg > 50) voice.loudCount++;
  else if (avg > 20) voice.normCount++;
  else voice.softCount++;

  const norm = Math.min(avg / 80, 1);
  for (let i = 0; i < 9; i++) {
    const b = document.getElementById('wb' + i);
    if (!b) continue;
    b.style.height = Math.max(6, Math.round(norm * 40 * (0.4 + Math.random() * 0.8))) + 'px';
  }
  renderVoiceActivity();
}

// ── STEP TRACKING ──
async function toggleSteps() {
  steps.isCounting ? stopSteps() : await startSteps();
}

async function startSteps() {
  // iOS requires explicit permission for DeviceMotion
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const perm = await DeviceMotionEvent.requestPermission();
      if (perm !== 'granted') {
        document.getElementById('permMotionBanner').style.display = 'block';
        return;
      }
    } catch (e) {
      document.getElementById('permMotionBanner').style.display = 'block';
      return;
    }
  }
  document.getElementById('permMotionBanner').style.display = 'none';

  steps.isCounting = true;
  steps.sessionStart = Date.now();
  steps.lastAcc = null;
  steps.stepBuffer = [];

  window.addEventListener('devicemotion', onMotion);

  document.getElementById('stepBtn').classList.add('counting');
  document.getElementById('stepBtnLabel').textContent = 'Stop counting';
  document.getElementById('stepStatus').textContent = 'Counting steps — keep phone in pocket or hand';

  steps.displayTimer = setInterval(() => {
    const e = Math.round((Date.now() - steps.sessionStart) / 1000);
    steps.activeMinutes = Math.floor(steps.totalSecs_session_so_far(e) / 60);
    renderStepsStats();
  }, 2000);
}

function stopSteps() {
  steps.isCounting = false;
  clearInterval(steps.displayTimer);
  window.removeEventListener('devicemotion', onMotion);

  const dur = Math.round((Date.now() - steps.sessionStart) / 1000);
  const sessionSteps = steps._sessionSteps || 0;

  if (sessionSteps > 0 || dur > 5) {
    steps.sessions.unshift({
      id: Date.now(), time: nowStr(), dur, stepCount: sessionSteps
    });
    steps.activeMinutes += Math.floor(dur / 60);
  }
  steps._sessionSteps = 0;

  document.getElementById('stepBtn').classList.remove('counting');
  document.getElementById('stepBtnLabel').textContent = 'Start counting';
  document.getElementById('stepStatus').textContent = 'Session saved — tap to start another';

  saveToStorage();
  renderSteps();
}

// Step detection via accelerometer magnitude peak detection
function onMotion(e) {
  const acc = e.accelerationIncludingGravity;
  if (!acc) return;
  const mag = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);

  steps.stepBuffer.push({ mag, t: Date.now() });
  if (steps.stepBuffer.length > 20) steps.stepBuffer.shift();

  // Simple threshold crossing step detection
  const now = Date.now();
  const avg = steps.stepBuffer.reduce((a,b) => a + b.mag, 0) / steps.stepBuffer.length;
  const threshold = avg + 2.5;

  if (mag > threshold && (now - steps.lastStepTime) > 300) {
    steps.lastStepTime = now;
    steps.totalSteps++;
    steps._sessionSteps = (steps._sessionSteps || 0) + 1;
    renderStepsLive();
  }
}

steps.totalSecs_session_so_far = function(elapsed) { return elapsed; };

// ── RENDER VOICE ──
function renderVoice() {
  const mins = (voice.totalSecs / 60).toFixed(1);
  document.getElementById('vStatTotal').innerHTML    = mins + '<span class="stat-u">min</span>';
  document.getElementById('vStatSessions').textContent = voice.sessions.length;
  document.getElementById('vStatLongest').innerHTML  = voice.longestSecs + '<span class="stat-u">s</span>';

  const vols = voice.sessions.map(s => s.avgVol).filter(v => v > 0);
  document.getElementById('vStatAvgVol').textContent = vols.length
    ? Math.round(vols.reduce((a,b) => a+b,0)/vols.length)
    : '–';

  renderVoiceActivity();
  renderVoiceLog();
}

function renderVoiceActivity() {
  const total = voice.sampleTotal || 1;
  const lp = Math.round(voice.loudCount / total * 100);
  const np = Math.round(voice.normCount / total * 100);
  const sp = Math.round(voice.softCount / total * 100);
  document.getElementById('fillLoud').style.width = lp + '%';
  document.getElementById('fillNorm').style.width = np + '%';
  document.getElementById('fillSoft').style.width = sp + '%';
  document.getElementById('pctLoud').textContent  = lp + '%';
  document.getElementById('pctNorm').textContent  = np + '%';
  document.getElementById('pctSoft').textContent  = sp + '%';

  if (voice.sampleTotal < 20) return;
  const items = [];
  if (np > 45) items.push(['badge-green', 'Good pacing']);
  if (sp > 25 && np > 20) items.push(['badge-blue', 'Varied tone']);
  if (lp > 35) items.push(['badge-red', 'Loud sections']);
  if (voice.sessions.length >= 5) items.push(['badge-amber', 'Very active day']);
  document.getElementById('vBadges').innerHTML = items.map(([c,l]) =>
    `<span class="badge ${c}">${l}</span>`).join('');
}

function renderVoiceLog() {
  const list = document.getElementById('vLogList');
  if (!voice.sessions.length) { list.innerHTML = '<li class="log-empty">No sessions yet — tap the mic to start</li>'; return; }
  list.innerHTML = voice.sessions.slice(0,15).map(s => `
    <li class="log-item">
      <div class="log-left"><div class="log-dot"></div><div class="log-details">
        <span class="log-time">${s.time}</span>
        <span class="log-sub">${s.avgVol > 0 ? 'avg vol: ' + s.avgVol : '–'}</span>
      </div></div>
      <span class="log-dur">${durStr(s.dur)}</span>
    </li>`).join('');
}

// ── RENDER STEPS ──
function renderStepsLive() {
  document.getElementById('stepCount').textContent = steps.totalSteps.toLocaleString();
  updateRing();
  renderStepsStats();
}

function renderSteps() {
  renderStepsLive();
  renderStepsLog();
  renderStepsBadges();
}

function renderStepsStats() {
  const dist = (steps.totalSteps * 0.00078).toFixed(2); // avg 78cm stride
  const cal  = Math.round(steps.totalSteps * 0.04);
  document.getElementById('sStatSteps').textContent  = steps.totalSteps.toLocaleString();
  document.getElementById('sStatDist').innerHTML     = dist + '<span class="stat-u">km</span>';
  document.getElementById('sStatCal').textContent    = cal;
  document.getElementById('sStatActive').innerHTML   = steps.activeMinutes + '<span class="stat-u">min</span>';

  const pct = Math.min(Math.round(steps.totalSteps / steps.goal * 100), 100);
  document.getElementById('stepProgressBar').style.width = pct + '%';
  document.getElementById('stepProgressPct').textContent = pct + '%';
}

function updateRing() {
  const circ = 477.5;
  const pct  = Math.min(steps.totalSteps / steps.goal, 1);
  const offset = circ - pct * circ;
  const ring = document.getElementById('stepRingFill');
  if (ring) ring.style.strokeDashoffset = offset;
}

function renderStepsBadges() {
  const items = [];
  if (steps.totalSteps >= steps.goal)     items.push(['badge-green', 'Goal reached!']);
  if (steps.totalSteps >= 10000)          items.push(['badge-amber', '10K club']);
  if (steps.totalSteps >= 5000 && steps.totalSteps < steps.goal) items.push(['badge-blue', 'Halfway there']);
  if (steps.activeMinutes >= 30)          items.push(['badge-green', '30 min active']);
  document.getElementById('sBadges').innerHTML = items.map(([c,l]) =>
    `<span class="badge ${c}">${l}</span>`).join('');
}

function renderStepsLog() {
  const list = document.getElementById('sLogList');
  if (!steps.sessions.length) { list.innerHTML = '<li class="log-empty">No step sessions yet</li>'; return; }
  list.innerHTML = steps.sessions.slice(0,10).map(s => `
    <li class="log-item">
      <div class="log-left"><div class="log-dot blue"></div><div class="log-details">
        <span class="log-time">${s.time}</span>
        <span class="log-sub">${s.stepCount} steps</span>
      </div></div>
      <span class="log-dur">${durStr(s.dur)}</span>
    </li>`).join('');
}

function updateGoal(val) {
  steps.goal = parseInt(val);
  document.getElementById('goalVal').textContent = parseInt(val).toLocaleString();
  document.getElementById('stepGoalDisp').textContent = parseInt(val).toLocaleString();
  updateRing();
  renderStepsStats();
  saveToStorage();
}

// ── DASHBOARD ──
function renderDashboard() {
  const voiceMins = Math.round(voice.totalSecs / 60);
  const dist  = (steps.totalSteps * 0.00078).toFixed(1);
  const cal   = Math.round(steps.totalSteps * 0.04);
  document.getElementById('dVoiceMin').textContent = voiceMins;
  document.getElementById('dSteps').textContent    = steps.totalSteps.toLocaleString();
  document.getElementById('dCal').textContent      = cal;
  document.getElementById('dActive').textContent   = steps.activeMinutes;

  const totalMins = 1440; // mins in day
  const vp = Math.min(Math.round(voiceMins / totalMins * 100), 50);
  const sp = Math.min(Math.round(steps.activeMinutes / totalMins * 100), 50);
  const rp = Math.max(0, 100 - vp - sp);
  document.getElementById('dBarVoice').style.width = vp + '%';
  document.getElementById('dBarSteps').style.width = sp + '%';
  document.getElementById('dBarRest').style.width  = rp + '%';
  document.getElementById('dPctVoice').textContent = vp + '%';
  document.getElementById('dPctSteps').textContent = sp + '%';
  document.getElementById('dPctRest').textContent  = rp + '%';

  // Mirror logs
  const dvl = document.getElementById('dVoiceLog');
  const dsl = document.getElementById('dStepLog');
  dvl.innerHTML = voice.sessions.length
    ? voice.sessions.slice(0,5).map(s => `<li class="log-item"><div class="log-left"><div class="log-dot"></div><span class="log-time">${s.time}</span></div><span class="log-dur">${durStr(s.dur)}</span></li>`).join('')
    : '<li class="log-empty">No voice sessions yet</li>';
  dsl.innerHTML = steps.sessions.length
    ? steps.sessions.slice(0,5).map(s => `<li class="log-item"><div class="log-left"><div class="log-dot blue"></div><span class="log-time">${s.time}</span></div><span class="log-dur">${s.stepCount} steps</span></li>`).join('')
    : '<li class="log-empty">No step sessions yet</li>';
}

// ── RESET ──
function resetDay() {
  if (!confirm('Reset all data for today?')) return;
  if (voice.isRecording) stopVoice();
  if (steps.isCounting) stopSteps();

  Object.assign(voice, { totalSecs:0, sessions:[], longestSecs:0, loudCount:0, normCount:0, softCount:0, sampleTotal:0, volSamples:[] });
  Object.assign(steps, { totalSteps:0, sessions:[], activeMinutes:0, _sessionSteps:0 });

  saveToStorage();
  renderVoice();
  renderSteps();
  if (currentTab === 'dashboard') renderDashboard();
}

// ── PERSISTENCE ──
function saveToStorage() {
  try {
    localStorage.setItem('daytrack_v2', JSON.stringify({
      date: todayKey(),
      voice: { totalSecs: voice.totalSecs, sessions: voice.sessions, longestSecs: voice.longestSecs, loudCount: voice.loudCount, normCount: voice.normCount, softCount: voice.softCount, sampleTotal: voice.sampleTotal },
      steps: { totalSteps: steps.totalSteps, sessions: steps.sessions, activeMinutes: steps.activeMinutes, goal: steps.goal }
    }));
  } catch(e) {}
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('daytrack_v2');
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.date !== todayKey()) return;
    if (d.voice) Object.assign(voice, d.voice);
    if (d.steps) {
      Object.assign(steps, d.steps);
      const slider = document.getElementById('goalSlider');
      if (slider) { slider.value = steps.goal; }
      const gv = document.getElementById('goalVal');
      if (gv) gv.textContent = steps.goal.toLocaleString();
    }
  } catch(e) {}
}

// ── SW + INSTALL ──
function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

function listenInstall() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredInstall = e;
    const b = document.getElementById('installBanner');
    if (b) b.style.display = 'flex';
  });
  const btn = document.getElementById('installBtn');
  if (btn) btn.addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    document.getElementById('installBanner').style.display = 'none';
  });
}

// ── HELPERS ──
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function nowStr() { const d = new Date(); return d.getHours().toString().padStart(2,'0') + ':' + d.getMinutes().toString().padStart(2,'0'); }
function durStr(s) { if (s < 60) return s + 's'; const m = Math.floor(s/60), r = s%60; return r ? `${m}m ${r}s` : `${m}m`; }
function clock(s) { return Math.floor(s/60).toString().padStart(2,'0') + ':' + (s%60).toString().padStart(2,'0'); }
