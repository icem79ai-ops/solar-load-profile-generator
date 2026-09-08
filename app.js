/* =====================================================================
   Load Profile Generator & Simulation Tool
   - Project management (localStorage)
   - Appliance presets + granular time slots
   - Duty-cycle / inverter simulation engine (1-min resolution)
   - 15-min aggregation (96 points/day)
   - Chart rendering + metrics + Excel/CSV export
   ===================================================================== */

'use strict';

/* ---------------------------- Constants ---------------------------- */

const STORAGE_KEY = 'lpg_projects_v1';
const SAMPLES = 1440;      // minutes in a day
const BINS = 96;           // 15-min intervals

const TYPE_LABELS = {
  'inverter-ac': 'แอร์อินเวอร์เตอร์',
  'fixed-ac':    'แอร์ธรรมดา',
  'water-heater':'เครื่องทำน้ำอุ่น',
  'ev-charger':  'ที่ชาร์จ EV',
  'refrigerator':'ตู้เย็น',
  'pump':        'ปั๊มน้ำ',
  'lighting':    'ไฟแสงสว่าง',
  'custom':      'โหลดทั่วไป'
};

/* ------------------------- Preset catalogue ------------------------ */

const PRESETS = [
  { label:'แอร์ 9,000 BTU (อินเวอร์เตอร์)', type:'inverter-ac',  w:1000, duty:.60, sur:1.3, smin:5,  cd:15, slots:['09:00-17:00','19:00-21:00'] },
  { label:'แอร์ 12,000 BTU (อินเวอร์เตอร์)',type:'inverter-ac',  w:1300, duty:.60, sur:1.3, smin:5,  cd:15, slots:['09:00-17:00','19:00-21:00'] },
  { label:'แอร์ 18,000 BTU (อินเวอร์เตอร์)',type:'inverter-ac',  w:2000, duty:.60, sur:1.3, smin:5,  cd:15, slots:['09:00-17:00','19:00-21:00'] },
  { label:'แอร์ 24,000 BTU (อินเวอร์เตอร์)',type:'inverter-ac',  w:2700, duty:.60, sur:1.3, smin:5,  cd:15, slots:['09:00-17:00','19:00-21:00'] },
  { label:'แอร์ 12,000 BTU (ธรรมดา)',       type:'fixed-ac',     w:1500, duty:.65, sur:2.3, smin:3,  cd:12, slots:['09:00-17:00','19:00-21:00'] },
  { label:'เครื่องทำน้ำอุ่น 3.5kW',          type:'water-heater', w:3500, duty:.40, sur:1.0, smin:1,  cd:0,  slots:['06:00-07:30','19:30-21:00'] },
  { label:'เครื่องทำน้ำอุ่น 6kW',            type:'water-heater', w:6000, duty:.40, sur:1.0, smin:1,  cd:0,  slots:['06:00-07:30','19:30-21:00'] },
  { label:'ที่ชาร์จ EV 7.2kW',               type:'ev-charger',   w:7200, duty:1.0, sur:1.0, smin:0,  cd:0,  slots:['22:00-06:00'] },
  { label:'ตู้เย็น 150W',                    type:'refrigerator', w:150,  duty:.40, sur:1.2, smin:1,  cd:0,  slots:['00:00-24:00'] },
  { label:'ปั๊มน้ำ 750W',                    type:'pump',         w:750,  duty:.32, sur:1.5, smin:1,  cd:0,  slots:['06:30-07:00','17:00-18:00'] },
  { label:'หลอดไฟ 60W',                     type:'lighting',     w:60,   duty:1.0, sur:1.0, smin:0,  cd:0,  slots:['18:30-23:00'] },
  { label:'โหลดทั่วไป 500W',                type:'custom',       w:500,  duty:1.0, sur:1.0, smin:0,  cd:0,  slots:['18:00-22:00'] },
  { label:'ไมโครเวฟ 1.2kW',                 type:'custom',       w:1200, duty:.15, sur:1.0, smin:0,  cd:0,  slots:['07:00-07:30','19:00-19:30'] },
  { label:'เครื่องซักผ้า 2.2kW',             type:'custom',       w:2200, duty:.20, sur:1.0, smin:0,  cd:0,  slots:['08:00-11:00'] }
];

/* ----------------------------- Helpers ----------------------------- */

const $ = (sel) => document.querySelector(sel);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d) => { const p = Math.pow(10, d); return Math.round(v * p) / p; };

function uid() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Deterministic pseudo-random (stable across re-renders, no flicker). */
function hash(n) {
  n = ((n >>> 16) ^ n) * 0x45d9f3b;
  n = ((n >>> 16) ^ n) * 0x45d9f3b;
  n = (n >>> 16) ^ n;
  return (n >>> 0) / 4294967296;
}
const jitter = (s) => (hash(s) - 0.5) * 2;             // -1 .. 1
const ripple = (s) => 1 + 0.07 * Math.sin(s * 0.0035); // slow wave

function toMin(str) {
  const p = String(str).split(':').map(Number);
  return (p[0] || 0) * 60 + (p[1] || 0);
}
function toHHMM(m) {
  m = ((m % 1440) + 1440) % 1440;
  const h = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return h + ':' + mm;
}
function slotAsRange(slot) {
  return { start: toMin(slot.start), end: slot.end === '24:00' ? 1440 : toMin(slot.end) };
}

/* ---------------------------- App state ---------------------------- */

let state = { projects: [], activeId: null };

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = JSON.parse(raw);
  } catch (e) { /* corrupt store -> fresh */ }
  if (!Array.isArray(state.projects)) state.projects = [];
  if (!state.projects.length) {
    const demo = createDemoProject();
    state.projects.push(demo);
    state.activeId = demo.id;
  }
  saveState();
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}

const activeProject = () => state.projects.find(p => p.id === state.activeId) || state.projects[0];

function createDemoProject() {
  const ac = makeAppliance('แอร์ 12,000 BTU ห้องนั่งเล่น', PRESETS[1]);
  const fridge = makeAppliance('ตู้เย็น', PRESETS[8]);
  const wh = makeAppliance('เครื่องทำน้ำอุ่น', PRESETS[5]);
  const ev = makeAppliance('ที่ชาร์จ EV', PRESETS[7]);
  const light = makeAppliance('ไฟห้องนั่งเล่น', PRESETS[10]);
  return { id: uid(), name: 'บ้านหลัง A', appliances: [ac, fridge, wh, ev, light] };
}

function makeAppliance(name, pres) {
  return {
    id: uid(),
    name: name,
    powerWatts: pres.w,
    quantity: 1,
    type: pres.type,
    dutyRatio: pres.duty,
    startupMult: pres.sur,
    startupMin: pres.smin,
    coolDownMin: pres.cd,
    slots: pres.slots.map(s => {
      const [a, b] = s.split('-');
      return { start: a, end: b };
    })
  };
}

/* ======================= SIMULATION ENGINE ======================== */

function clampMod(duty) { return clamp(0.30 + 0.55 * duty, 0.30, 0.90); }

/* Instantaneous power (kW) of one appliance at a given day-minute. */
function minutePower(app, kW, segStart, m) {
  const elapsed = m - segStart;
  const startupEnd = app.startupMin;                       // surge phase
  const cooldownEnd = app.startupMin + app.coolDownMin;    // cool-down end
  const T = app.type;
  const baseId = app.id.length + app.id.charCodeAt(0) * 31 + (app.name ? app.name.length : 0);

  switch (T) {
    case 'inverter-ac': {
      const M = clampMod(app.dutyRatio);
      if (elapsed < startupEnd) return kW * app.startupMult;
      if (elapsed < cooldownEnd) {
        const t = (elapsed - startupEnd) / Math.max(1, cooldownEnd - startupEnd);
        return kW * (1 - (1 - M) * t);
      }
      return kW * M * ripple(baseId + m) * (1 + 0.04 * jitter(baseId + Math.floor(elapsed / 22)));
    }

    case 'fixed-ac': {
      if (elapsed < startupEnd) return kW * app.startupMult;
      if (elapsed < cooldownEnd) return kW;                 // full-on cool-down
      return cycleOnOff(kW, app.dutyRatio, 21, elapsed, baseId, 0.05);
    }

    case 'water-heater': {
      return cycleOnOff(kW, app.dutyRatio, 45, elapsed, baseId, 0);
    }

    case 'ev-charger': {
      if (app.dutyRatio >= 1) return kW * (1 + 0.01 * jitter(baseId + elapsed));
      return cycleOnOff(kW, app.dutyRatio, 60, elapsed, baseId, 0);
    }

    case 'refrigerator': {
      const frac = elapsed % 30;
      const mult = Math.max(app.startupMult, 1.2);
      if (frac < 2) return kW * mult;                 // compressor start kick
      return cycleOnOff(kW, app.dutyRatio, 30, elapsed, baseId, 0);
    }

    case 'pump': {
      return cycleOnOff(kW, app.dutyRatio, 25, elapsed, baseId, 0, app.startupMult);
    }

    case 'lighting':
    default: {
      if (app.dutyRatio >= 1) return kW * (1 + 0.015 * jitter(baseId + Math.floor(elapsed / 30)));
      return cycleOnOff(kW, app.dutyRatio, 30, elapsed, baseId, 0);
    }
  }
}

/* Duty-cycled compressor profile with jittered on/off boundaries. */
function cycleOnOff(kW, onFrac, cycle, elapsed, seed, standby, surgeMult) {
  const k = Math.floor(elapsed / cycle);
  const frac = elapsed % cycle;
  let dur = clamp(onFrac * cycle + jitter(seed * 31 + k * 104729) * cycle * 0.12, cycle * 0.06, cycle * 0.95);
  const on = frac < dur;
  if (!on) return kW * standby;
  const s = surgeMult && frac < 1 ? kW * surgeMult : kW;
  return s * (1 + 0.04 * jitter(seed * 17 + k * 7919));
}

/* Build 1-minute power array for one appliance (kW, includes qty). */
function simulateApplianceDay(app) {
  const arr = new Float64Array(SAMPLES);
  const kW = (app.powerWatts * app.quantity) / 1000;
  if (app.powerWatts <= 0) return arr;

  for (const slot of app.slots || []) {
    const r = slotAsRange(slot);
    const segs = r.end > r.start
      ? [[r.start, r.end]]
      : [[r.start, SAMPLES], [0, Math.min(r.end, SAMPLES)]];
    for (const [s, e] of segs) {
      for (let m = s; m < e; m++) {
        arr[m] += minutePower(app, kW, s, m);
      }
    }
  }
  return arr;
}

/* Aggregate per-appliance minutes into 96 x 15-min kW values. */
function aggregateBins(arr) {
  const bins = new Array(BINS).fill(0);
  for (let b = 0; b < BINS; b++) {
    let sum = 0;
    for (let k = 0; k < 15; k++) sum += arr[b * 15 + k];
    bins[b] = sum / 15;
  }
  return bins;
}

/* Full project simulation -> rows + metrics. `override` is a temp appliance
   for live modal preview (replaces the one with the same id if present). */
function simulateProject(project, override) {
  const appliances = project.appliances.slice();
  if (override) {
    const i = appliances.findIndex(a => a.id === override.id);
    if (i >= 0) { appliances[i] = override; }
    else appliances.push(override);
  }

  const total = new Float64Array(SAMPLES);
  for (const app of appliances) {
    const arr = simulateApplianceDay(app);
    for (let m = 0; m < SAMPLES; m++) total[m] += arr[m];
  }

  const bins = aggregateBins(total);
  const rows = bins.map((kW, i) => ({ timeIndex: i, kW: round(kW, 4) }));
  const totalKwh = round(rows.reduce((s, r) => s + r.kW, 0) * 0.25, 2);

  let peakIdx = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i].kW > rows[peakIdx].kW) peakIdx = i;
  const peakKw = round(rows[peakIdx].kW, 3);

  return {
    rows,
    metrics: { totalKwh, peakKw, peakTime: toHHMM(peakIdx * 15) }
  };
}

/* ============================ RENDERING =========================== */

Chart.defaults.font.family = '"Segoe UI", "Tahoma", "Leelawadee UI", "Noto Sans Thai", sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.color = '#94a3b8';

let chart = null;
let editing = null;           // appliance being edited (or {id:null} for new)
let modalMode = 'new';        // 'new' | 'preset' | 'edit' | 'project-rename'

function renderAll() {
  renderProjectSelect();
  renderPresets();
  renderAppliances();
  runSim(null, false);
}

/* --- Project select --- */
function renderProjectSelect() {
  const sel = $('#project-select');
  sel.innerHTML = '';
  state.projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    opt.selected = p.id === activeProject().id;
    sel.appendChild(opt);
  });
  $('#appliance-count').textContent = activeProject().appliances.length;
}

/* --- Preset grid --- */
function renderPresets() {
  const grid = $('#preset-grid');
  grid.innerHTML = '';
  PRESETS.forEach(p => {
    const b = document.createElement('button');
    b.className = 'preset-btn';
    b.innerHTML = p.label + '<small>' + kwLabel(p.w) + ' · ' + TYPE_LABELS[p.type] + '</small>';
    b.addEventListener('click', () => addFromPreset(p));
    grid.appendChild(b);
  });
}

function kwLabel(w) {
  const v = w / 1000;
  return (v >= 1 ? v.toFixed(v >= 10 ? 0 : 1) : v.toFixed(2)) + ' kW';
}

function addFromPreset(p) {
  const project = activeProject();
  const app = makeAppliance(p.label, p);
  project.appliances.push(app);
  saveState();
  renderAppliances();
  runSim(null, false);
  openApplianceModal(app, 'preset');
  toast('เพิ่ม "' + p.label + '" แล้ว แก้ไขรายละเอียดแล้วกดบันทึก');
}

/* --- Appliance list --- */
function renderAppliances() {
  const project = activeProject();
  const list = $('#appliance-list');
  $('#appliance-count').textContent = project.appliances.length;
  list.innerHTML = '';

  if (!project.appliances.length) {
    list.innerHTML = '<div class="empty-state"><span class="icon">&#10052;</span>ยังไม่มีเครื่องใช้ไฟฟ้า<br>ใช้ปุ่มเพิ่มด่วนด้านบน หรือเพิ่มเครื่องใช้แบบกำหนดเอง</div>';
    return;
  }

  project.appliances.forEach(app => {
    const div = document.createElement('div');
    div.className = 'appliance-item';

    const info = document.createElement('div');
    info.className = 'appliance-info';
    const name = document.createElement('div');
    name.className = 'appliance-name';
    name.textContent = app.name;

    const meta = document.createElement('div');
    meta.className = 'appliance-meta';
    const slotsHtml = app.slots.map(s => '<span class="tag">' + s.start + '–' + s.end + '</span>').join(' ');
    meta.innerHTML = slotsHtml || '<span class="tag">ไม่มีช่วงเวลา</span>';

    info.appendChild(name);
    info.appendChild(meta);

    const right = document.createElement('div');
    right.style.cssText = 'text-align:right;flex-shrink:0;';
    const typeBadge = document.createElement('div');
    typeBadge.className = 'appliance-type-badge';
    typeBadge.textContent = TYPE_LABELS[app.type] || app.type;
    const kw = ((app.powerWatts * app.quantity) / 1000).toFixed(app.powerWatts * app.quantity >= 1000 ? 1 : 2);
    const total = document.createElement('div');
    total.className = 'appliance-total';
    total.innerHTML = kw + ' <small>kW</small>';
    right.appendChild(typeBadge);
    right.appendChild(total);

    div.appendChild(info);
    div.appendChild(right);
    div.addEventListener('click', () => openApplianceModal(app, 'edit'));
    list.appendChild(div);
  });
}

/* ========================= APP MODAL ============================= */

function openProjectModal(mode, project) {
  modalMode = mode;
  $('#project-modal-title').textContent = mode === 'rename' ? 'เปลี่ยนชื่อโครงการ' : 'โครงการใหม่';
  $('#project-name-input').value = project ? project.name : '';
  $('#project-modal').classList.remove('hidden');
  setTimeout(() => $('#project-name-input').focus(), 60);
}

function openApplianceModal(app, mode) {
  modalMode = mode;
  editing = app;
  $('#appliance-modal-title').textContent = mode === 'edit' ? 'แก้ไขเครื่องใช้ไฟฟ้า' : 'เครื่องใช้ไฟฟ้าใหม่';

  $('#app-name').value = app.name;
  $('#app-power').value = app.powerWatts;
  $('#app-qty').value = app.quantity;
  $('#app-type').value = app.type;
  $('#app-duty').value = app.dutyRatio;
  $('#app-startup').value = app.startupMult;
  $('#app-startup-min').value = app.startupMin;
  $('#app-cool-down').value = app.coolDownMin;

  renderSlots(app.slots);
  $('#appliance-modal').classList.remove('hidden');
  bindModalLive(inputs());
}

function inputs() {
  return ['app-name', 'app-power', 'app-qty', 'app-type', 'app-duty',
          'app-startup', 'app-startup-min', 'app-cool-down']
    .map(id => document.getElementById(id));
}

/* Live instant re-simulation while editing, debounced. */
let previewTimer = null;
function bindModalLive(els) {
  els.forEach(el => { if (!el.dataset.bound) { el.addEventListener('input', onModalChange); el.dataset.bound = '1'; } });
}
function onModalChange() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const app = readModal();
    if (app) { delete app.slots; app.slots = readSlotInputs(); runSim(app, true); }
  }, 300);
}

/* Read modal fields into an appliance object (for preview or save). */
function readModal() {
  const power = parseFloat($('#app-power').value);
  const qty = parseInt($('#app-qty').value, 10) || 1;
  return {
    id: editing ? editing.id : uid(),
    name: $('#app-name').value.trim() || 'เครื่องใช้ไฟฟ้า',
    powerWatts: isNaN(power) ? 0 : Math.max(0, power),
    quantity: Math.max(1, qty),
    type: $('#app-type').value,
    dutyRatio: clamp(parseFloat($('#app-duty').value) || 0.5, 0, 1),
    startupMult: Math.max(1, parseFloat($('#app-startup').value) || 1),
    startupMin: Math.max(0, parseInt($('#app-startup-min').value, 10) || 0),
    coolDownMin: Math.max(0, parseInt($('#app-cool-down').value, 10) || 0),
    slots: null
  };
}

/* --- Slot list editing (uses #slot-list container) --- */
function renderSlots(slots) {
  const box = $('#slot-list');
  box.innerHTML = '';
  slots.forEach(s => box.appendChild(slotRowDOM(s.start, s.end)));
}

function slotRowDOM(start, end) {
  const row = document.createElement('div');
  row.className = 'slot-row';

  const sCol = document.createElement('div');
  sCol.innerHTML = '<label>เริ่ม</label>';
  const sIn = document.createElement('input');
  sIn.type = 'time'; sIn.value = start; sIn.step = 60;
  sCol.appendChild(sIn);

  const eCol = document.createElement('div');
  eCol.innerHTML = '<label>สิ้นสุด</label>';
  const eIn = document.createElement('input');
  eIn.type = 'time'; eIn.value = end; eIn.step = 60;
  eCol.appendChild(eIn);

  const btn = document.createElement('button');
  btn.className = 'slot-remove';
  btn.textContent = '×';
  btn.title = 'ลบช่วงเวลา';
  btn.addEventListener('click', () => { row.remove(); onModalChange(); });

  row.appendChild(sCol); row.appendChild(eCol); row.appendChild(btn);
  [sIn, eIn].forEach(i => i.addEventListener('input', () => onModalChange()));
  return row;
}

function readSlotInputs() {
  return [...$('#slot-list').querySelectorAll('.slot-row')].map(r => {
    const ins = r.querySelectorAll('input[type=time]');
    const start = ins[0].value || '00:00';
    const end = ins[1].value || '00:00';
    return { start, end };
  });
}

/* ========================= SIM + RESULTS ========================= */

let simDate = null;

function runSim(override, isPreview) {
  const project = activeProject();
  const res = simulateProject(project, override);
  renderMetrics(res.metrics);
  renderChart(res);
  renderDataTable(res.rows);
  if (isPreview) $('#results-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderMetrics(m) {
  $('#m-total').textContent = m.totalKwh.toFixed(2);
  $('#m-peak').textContent = m.peakKw.toFixed(3);
  $('#m-peak-time').textContent = m.peakTime;
}

function renderChart(res) {
  const ctx = $('#profile-chart');
  const labels = res.rows.map(r => toHHMM(r.timeIndex * 15));
  const data = res.rows.map(r => r.kW);

  const fillGrad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 300);
  fillGrad.addColorStop(0, 'rgba(56,189,248,0.35)');
  fillGrad.addColorStop(1, 'rgba(56,189,248,0.02)');

  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: 'rgba(56,189,248,0.95)',
        backgroundColor: fillGrad,
        fill: true,
        borderWidth: 2,
        pointRadius: 0,
        pointHitRadius: 12,
        tension: 0.25,
        spanGaps: false
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0b1220',
          borderColor: 'rgba(56,189,248,0.4)',
          borderWidth: 1,
          titleColor: '#94a3b8',
          bodyColor: '#e2e8f0',
          callbacks: {
            title: (items) => items[0].label,
            label: (item) => '  ' + item.parsed.y.toFixed(3) + ' กิโลวัตต์ (kW)'
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: true, color: 'rgba(51,65,85,0.4)' },
          ticks: {
            color: '#94a3b8',
            maxRotation: 0,
            minRotation: 0,
            autoSkip: false,
            maxTicksLimit: 12,
            callback: function (val) {
              const idx = Number(val);
              if (isNaN(idx) || idx < 0 || idx >= labels.length) return '';
              return (idx % 16 === 0) ? labels[idx] : '';
            }
          }
        },
        y: {
          title: { display: true, text: 'กำลังไฟฟ้า (kW)', color: '#94a3b8' },
          grid: { color: 'rgba(51,65,85,0.35)' },
          ticks: { color: '#94a3b8', callback: v => v.toFixed(1) },
          beginAtZero: true
        }
      }
    }
  };

  if (chart) { chart.destroy(); }
  chart = new Chart(ctx, cfg);
}

function renderDataTable(rows) {
  const tbody = $('#data-table').querySelector('tbody');
  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  rows.forEach(r => {
    const tr = document.createElement('tr');
    const tdT = document.createElement('td');
    tdT.textContent = toHHMM(r.timeIndex * 15);
    const tdK = document.createElement('td');
    tdK.textContent = r.kW.toFixed(4);
    tr.appendChild(tdT); tr.appendChild(tdK);
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

/* ============================ BACKUP ============================ */

function exportBackup() {
  if (!state.projects.length) return toast('ไม่มีข้อมูลให้สำรอง');
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const fname = 'load_profile_backup_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + '.json';
  const content = JSON.stringify(state, null, 2);
  download(fname, content, 'application/json');
  toast('สำรองข้อมูลเรียบร้อย เก็บไฟล์ไว้ที่ปลอดภัย');
}

function restoreBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.projects)) throw new Error('bad structure');
      const existing = new Set(state.projects.map(x => x.id));
      let added = 0, updated = 0;
      data.projects.forEach(imported => {
        if (!(imported && imported.id && typeof imported.name === 'string')) return;
        if (Array.isArray(imported.appliances) && imported.appliances.some(a => !Array.isArray(a.slots) || typeof a.powerWatts !== 'number')) return;
        if (existing.has(imported.id)) {
          const i = state.projects.findIndex(x => x.id === imported.id);
          state.projects[i] = imported;
          updated++;
        } else {
          state.projects.push(imported);
          added++;
        }
      });
      if (!added && !updated) throw new Error('no valid projects');
      saveState();
      renderAll();
      toast('กู้คืนสำเร็จ: เพิ่ม ' + added + ' โครงการ, อัปเดต ' + updated + ' โครงการ');
    } catch (e) {
      toast('ไฟล์สำรองไม่ถูกต้อง ไม่ได้กู้คืนอะไรเลย');
    }
  };
  reader.readAsText(file);
}

/* ============================= EXPORT ============================ */

function todayIso() {
  if (!simDate) simDate = new Date();
  const d = simDate;
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function buildRows() {
  const res = simulateProject(activeProject());
  const d = todayIso();
  return res.rows.map(r => ({ ts: d + ' ' + toHHMM(r.timeIndex * 15), kw: r.kW }));
}

function exportCSV() {
  if (!activeProject().appliances.length) return toast('กรุณาเพิ่มเครื่องใช้ไฟฟ้าก่อน');
  const rows = buildRows();
  let csv = '\ufeffTimestamp,Power_kW\r\n';
  rows.forEach(r => { csv += r.ts + ',' + r.kw.toFixed(4) + '\r\n'; });
  download(activeProject().name + '_load_profile.csv', csv, 'text/csv');
  toast('ส่งออกไฟล์ CSV แล้ว');
}

function exportXLSX() {
  if (!activeProject().appliances.length) return toast('กรุณาเพิ่มเครื่องใช้ไฟฟ้าก่อน');
  const rows = buildRows();
  const aoa = [['Timestamp', 'Power Consumption (kW)']];
  rows.forEach(r => aoa.push([r.ts, r.kw]));

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 18 }, { wch: 16 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Load Profile');
  const fname = activeProject().name.replace(/[^\w\- ]+/g, '_') + '_load_profile.xlsx';
  XLSX.writeFile(wb, fname);
  toast('ส่งออกไฟล์ Excel แล้ว');
}

function download(fname, content, mime) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fname;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 150);
}

/* ============================ EVENTS ============================= */

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function wireEvents() {

  /* Project select */
  $('#project-select').addEventListener('change', e => {
    state.activeId = e.target.value;
    saveState();
    renderProjectSelect();
    renderAppliances();
    runSim(null, false);
  });

  $('#btn-new-project').addEventListener('click', () => openProjectModal('new', null));
  $('#btn-rename-project').addEventListener('click', () => openProjectModal('rename', activeProject()));
  $('#btn-backup').addEventListener('click', exportBackup);
  $('#btn-restore').addEventListener('click', () => $('#restore-file').click());
  $('#restore-file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) restoreBackup(f);
    e.target.value = '';
  });
  $('#btn-delete-project').addEventListener('click', () => {
    if (state.projects.length <= 1) return toast('ไม่สามารถลบโครงการสุดท้ายได้');
    const p = activeProject();
    if (!confirm('ลบโครงการ "' + p.name + '" และเครื่องใช้ไฟฟ้าทั้งหมดในโครงการหรือไม่?')) return;
    state.projects = state.projects.filter(x => x.id !== p.id);
    state.activeId = state.projects[0].id;
    saveState();
    renderAll();
    toast('ลบโครงการแล้ว');
  });

  /* Project modal */
  $('#btn-project-ok').addEventListener('click', () => {
    const name = $('#project-name-input').value.trim() || 'โครงการที่ไม่มีชื่อ';
    if (modalMode === 'rename') {
      activeProject().name = name;
    } else {
      const p = { id: uid(), name, appliances: [] };
      state.projects.push(p);
      state.activeId = p.id;
      $('#project-select').value = p.id;
    }
    saveState();
    $('#project-modal').classList.add('hidden');
    renderAll();
    toast(modalMode === 'rename' ? 'เปลี่ยนชื่อโครงการแล้ว' : 'สร้างโครงการแล้ว');
  });
  $('#btn-project-cancel').addEventListener('click', () => $('#project-modal').classList.add('hidden'));

  /* Custom appliance */
  $('#btn-add-custom').addEventListener('click', () => {
    const base = { label: 'เครื่องใช้ไฟฟ้าใหม่', type: 'custom', w: 1000, duty: 1.0, sur: 1.0, smin: 0, cd: 0, slots: ['08:00-18:00'] };
    const app = makeAppliance('เครื่องใช้ไฟฟ้าใหม่', base);
    openApplianceModal(app, 'new');
  });

  /* Appliance modal */
  $('#btn-add-slot').addEventListener('click', () => {
    $('#slot-list').appendChild(slotRowDOM('08:00', '18:00'));
    onModalChange();
  });

  $('#btn-app-cancel').addEventListener('click', () => $('#appliance-modal').classList.add('hidden'));

  $('#btn-app-ok').addEventListener('click', () => {
    const app = readModal();
    app.slots = readSlotInputs().filter(s => s.start !== s.end);
    if (!app.slots.length) return toast('กรุณาเพิ่มช่วงเวลาการใช้งานอย่างน้อย 1 ช่วง');

    const project = activeProject();
    const i = project.appliances.findIndex(a => a.id === app.id);
    if (i >= 0) project.appliances[i] = app;
    else project.appliances.push(app);
    saveState();
    $('#appliance-modal').classList.add('hidden');
    renderAppliances();
    runSim(null, false);
    toast('บันทึกเครื่องใช้ไฟฟ้าแล้ว · อัปเดตกราฟแล้ว');
  });

  /* Export */
  $('#btn-export-csv').addEventListener('click', exportCSV);
  $('#btn-export-xlsx').addEventListener('click', exportXLSX);

  /* Close modals on overlay click / Escape */
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', e => { if (e.target === ov) ov.classList.add('hidden'); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') document.querySelectorAll('.modal-overlay').forEach(ov => ov.classList.add('hidden'));
  });
}

/* Delete button inside appliance modal (bottom, before Save). */
function ensureDeleteButton() {
  const home = $('#appliance-modal .modal-actions');
  if ($('#btn-app-delete')) return;
  const del = document.createElement('button');
  del.id = 'btn-app-delete';
  del.className = 'btn btn-danger';
  del.textContent = 'ลบ';
  del.style.marginRight = 'auto';
  del.addEventListener('click', () => {
    const project = activeProject();
    project.appliances = project.appliances.filter(a => a.id !== editing.id);
    saveState();
    $('#appliance-modal').classList.add('hidden');
    renderAppliances();
    runSim(null, false);
    toast('ลบเครื่องใช้ไฟฟ้าแล้ว');
  });
  home.insertBefore(del, home.firstChild);
}

/* --------------------------- Boot ------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  ensureDeleteButton();
  renderAll();
  wireEvents();
});