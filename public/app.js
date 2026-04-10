// ── Blood sugar level thresholds (mg/dL) ─────────────────────────────────────
const THRESHOLDS = {
  DANGER_LOW_MAX:  54,
  LOW_MAX:         70,
  NORMAL_MAX:      180,
  HIGH_MAX:        250,
};

const LEVEL_META = {
  'Dangerously Low':  { cls: 'dangerously-low',  color: '#ff3b5c' },
  'Low':              { cls: 'low',               color: '#ff9f0a' },
  'Normal':           { cls: 'normal',            color: '#30d158' },
  'High':             { cls: 'high',              color: '#ff9f0a' },
  'Dangerously High': { cls: 'dangerously-high',  color: '#ff3b5c' },
};

function classifyLevel(value) {
  if (value < THRESHOLDS.DANGER_LOW_MAX) return 'Dangerously Low';
  if (value < THRESHOLDS.LOW_MAX)        return 'Low';
  if (value <= THRESHOLDS.NORMAL_MAX)    return 'Normal';
  if (value <= THRESHOLDS.HIGH_MAX)      return 'High';
  return 'Dangerously High';
}

// ── Gauge drawing ─────────────────────────────────────────────────────────────
const canvas  = document.getElementById('gaugeCanvas');
const ctx     = canvas.getContext('2d');
const CX      = canvas.width / 2;
const CY      = canvas.height - 20;
const RADIUS  = 140;
const START   = Math.PI;         // 9 o'clock  (left)
const END     = 2 * Math.PI;     // 3 o'clock  (right)  — full 180° arc

// Map a value in [min, max] to an angle in [START, END]
function valueToAngle(value, min = 20, max = 400) {
  const fraction = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return START + fraction * (END - START);
}

// Zone definitions: [fromValue, toValue, color, opacity]
const GAUGE_ZONES = [
  [20,  54,  '#ff3b5c', 1.0],
  [54,  70,  '#ff9f0a', 1.0],
  [70,  180, '#30d158', 1.0],
  [180, 250, '#ff9f0a', 0.75],
  [250, 400, '#ff3b5c', 0.85],
];

function drawGauge(value) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const trackWidth  = 22;
  const needleWidth = 10;

  // Track background
  ctx.beginPath();
  ctx.arc(CX, CY, RADIUS, START, END);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = trackWidth;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Colored zones
  GAUGE_ZONES.forEach(([from, to, color, alpha]) => {
    ctx.beginPath();
    ctx.arc(CX, CY, RADIUS, valueToAngle(from), valueToAngle(to));
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = trackWidth;
    ctx.lineCap = 'butt';
    ctx.stroke();
    ctx.globalAlpha = 1;
  });

  // Active arc (bright overlay up to current value)
  const level = classifyLevel(value);
  const { color } = LEVEL_META[level];
  ctx.beginPath();
  ctx.arc(CX, CY, RADIUS, START, valueToAngle(value));
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.25;
  ctx.lineWidth = trackWidth + 8;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Needle
  const angle = valueToAngle(value);
  const needleLen = RADIUS - 6;
  const nx = CX + needleLen * Math.cos(angle);
  const ny = CY + needleLen * Math.sin(angle);

  ctx.beginPath();
  ctx.moveTo(CX, CY);
  ctx.lineTo(nx, ny);
  ctx.strokeStyle = color;
  ctx.lineWidth = needleWidth;
  ctx.lineCap = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Needle center hub
  ctx.beginPath();
  ctx.arc(CX, CY, 10, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowBlur = 0;

  // Tick marks at threshold boundaries
  [54, 70, 180, 250].forEach((tick) => {
    const a = valueToAngle(tick);
    const inner = RADIUS - trackWidth / 2 - 4;
    const outer = RADIUS + trackWidth / 2 + 4;
    ctx.beginPath();
    ctx.moveTo(CX + inner * Math.cos(a), CY + inner * Math.sin(a));
    ctx.lineTo(CX + outer * Math.cos(a), CY + outer * Math.sin(a));
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

// ── UI element refs ───────────────────────────────────────────────────────────
const slider      = document.getElementById('glucoseSlider');
const readingEl   = document.getElementById('readingValue');
const badgeEl     = document.getElementById('levelBadge');
const sendBtn     = document.getElementById('sendBtn');
const statusEl    = document.getElementById('status');
const lastSentEl  = document.getElementById('lastSent');
const tableEl     = document.getElementById('lastSentTable');
const patientEl   = document.getElementById('patientId');

// ── Update UI to reflect current slider value ─────────────────────────────────
function updateUI(value) {
  const level = classifyLevel(value);
  const { cls, color } = LEVEL_META[level];

  drawGauge(value);

  readingEl.textContent = value;
  readingEl.style.color = color;

  badgeEl.textContent = level;
  badgeEl.className = `level-badge ${cls}`;

  // Update slider thumb color via CSS custom property
  document.documentElement.style.setProperty('--thumb-color', color);

  // Color the thumb border dynamically
  slider.style.setProperty('--thumb-border', color);
  updateSliderThumbColor(color);
}

// Dynamically inject a style rule to update the range thumb border color
let thumbStyleEl = null;
function updateSliderThumbColor(color) {
  if (!thumbStyleEl) {
    thumbStyleEl = document.createElement('style');
    document.head.appendChild(thumbStyleEl);
  }
  thumbStyleEl.textContent = `
    input[type="range"]::-webkit-slider-thumb { border-color: ${color} !important; }
    input[type="range"]::-moz-range-thumb      { border-color: ${color} !important; }
  `;
}

// ── Slider event ──────────────────────────────────────────────────────────────
slider.addEventListener('input', () => updateUI(parseInt(slider.value, 10)));

// ── Load default patient ID from server config ────────────────────────────────
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const cfg = await res.json();
    if (cfg.defaultPatientId) patientEl.value = cfg.defaultPatientId;
  } catch (_) { /* best-effort */ }
}

// ── Show status ───────────────────────────────────────────────────────────────
function showStatus(type, html) {
  statusEl.className = `status ${type}`;
  statusEl.innerHTML = html;
  statusEl.classList.remove('hidden');
}

// ── Send button ───────────────────────────────────────────────────────────────
sendBtn.addEventListener('click', async () => {
  const patientId         = patientEl.value.trim();
  const bloodSugarReading = parseInt(slider.value, 10);
  const level             = classifyLevel(bloodSugarReading);

  if (!patientId) {
    showStatus('error', '⚠ Please enter a Patient ID before sending.');
    return;
  }

  sendBtn.disabled = true;
  showStatus('loading', '<span class="spinner"></span> Sending to Salesforce Data Cloud…');

  try {
    const res = await fetch('/api/glucose', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ patientId, bloodSugarReading, level }),
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = typeof data.error === 'object'
        ? JSON.stringify(data.error, null, 2)
        : data.error;
      showStatus('error', `✗ Error ${res.status}: <pre style="margin-top:6px;white-space:pre-wrap;">${msg}</pre>`);
    } else {
      showStatus('success', `✓ Reading transmitted successfully (HTTP ${data.salesforceStatus})`);
      renderLastSent(data.payload);
    }
  } catch (err) {
    showStatus('error', `✗ Network error: ${err.message}`);
  } finally {
    sendBtn.disabled = false;
  }
});

// ── Render last-sent summary ──────────────────────────────────────────────────
function renderLastSent(payload) {
  const rows = [
    ['eventId',           payload.eventId],
    ['patientId',         payload.patientId],
    ['dateTimeStamp',     payload.dateTimeStamp],
    ['bloodSugarReading', `${payload.bloodSugarReading} mg/dL`],
    ['level',             payload.level],
  ];
  tableEl.innerHTML = rows.map(([k, v]) =>
    `<tr><td>${k}</td><td>${v}</td></tr>`
  ).join('');
  lastSentEl.classList.remove('hidden');
}

// ── Init ──────────────────────────────────────────────────────────────────────
loadConfig();
updateUI(parseInt(slider.value, 10));
