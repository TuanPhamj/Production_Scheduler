// ===== Giao diện: đọc tham số, chạy mô phỏng, vẽ kết quả =====
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const N = n => Math.round(n).toLocaleString('en-US');
const RUNS = [];
let lastRes = null, lastTxt = '';
const STORE_KEY = 'aps_heijunka_v2_data';
const CLEAR_FLAG_KEY = 'aps_heijunka_v2_cleared';
const UI_PREF_KEY = 'aps_heijunka_v2_prefs';
// Tăng khi đổi giá trị mặc định cần áp lại cho máy đã lưu tham số cũ (v2: định mức 3.360 PC/h)
const UI_PREF_VER = 2;
const EMPTY_DATA_NOTE = 'Chưa có dữ liệu kế hoạch. Hãy bấm Nạp FINE / Nạp CHISEL hoặc Nhập Excel / CSV để bắt đầu.';
let WORK_SKUS = SKUS.map(r => r.slice());
let WORK_META = JSON.parse(JSON.stringify(SKU_META));
let dataNote = EMPTY_DATA_NOTE;
// Nguồn duy nhất (Single Source of Truth) cho toàn bộ bộ lọc bảng SKU
const SKU_FILTER = { q: '', fam: 'all', st: 'all' };
let ganttMode = 'day', selectedDay = '';
let ACTUAL_PROD = {};
// Nguồn của SL thực tế theo 'ngày:Mx': 'manual' = tổ trưởng nhập tay (không bị xóa khi nạp lại file)
let ACTUAL_SRC = {};
let lastRunError = '';
let lastImportError = '';
let saveStorageWarned = false;
// File mới nhất đã nạp cho từng dòng bút: { F: { file, at }, C: { file, at } }
let DATA_SRC = {};
// Gợi ý dòng bút khi người dùng bấm nút "Nạp FINE" hoặc "Nạp CHISEL" riêng biệt
let pendingImportFam = null;
// Snapshot tạm để hoàn tác thao tác xóa mã gần nhất (chỉ giữ trong phiên làm việc)
let DELETE_UNDO = null;
let toastTimer = null;

// Bản đồ trạng thái gốc (nếu có) để nhận diện ô Trạng thái được chỉnh tay
const DEFAULT_ST_MAP = new Map(SKUS.map(r => [r[4] + ':' + r[0], r[5]]));

function ensureStableStt(){
  WORK_SKUS.forEach((row, idx) => {
    const k = row[4] + ':' + row[0];
    if (!WORK_META[k]) WORK_META[k] = { btp_ready_date: null, due_date: null, fixedMachine: null };
    const v = WORK_META[k].stt;
    if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0){
      WORK_META[k].stt = idx;
    }
  });
}

function hideToast(){
  if (toastTimer){
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  const el = $('appToast');
  if (el){
    el.classList.remove('show');
    el.innerHTML = '';
  }
}

function showToast(msg, withUndo){
  const el = $('appToast');
  if (!el) return;
  if (toastTimer){
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  el.innerHTML = '<span>' + esc(msg) + '</span>' +
    (withUndo ? '<button type="button" id="toastUndoBtn">↩ Hoàn tác</button>' : '');
  el.classList.add('show');
  if (withUndo && $('toastUndoBtn')){
    $('toastUndoBtn').addEventListener('click', () => {
      hideToast();
      undoLastDelete();
    });
  }
  toastTimer = setTimeout(hideToast, 8000);
}

function defaultStartIso(){
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

const SIDEBAR_NUM_IDS = ['machines', 'backupDelayMin', 'h1', 'h2', 'h3', 'waitDays', 'rate', 'co', 'coSame', 'cuGroup', 'cuSwitch'];
const SIDEBAR_CHK_IDS = ['on1', 'on2', 'on3', 'skipSun', 'campaign', 'onlyReady', 'allowPullW', 'prioritizeUrgent'];
const SIDEBAR_SEL_IDS = ['sortMode', 'coMode'];

function saveUiPrefs(){
  try {
    const prefs = {};
    SIDEBAR_NUM_IDS.forEach(id => { if ($(id)) prefs[id] = $(id).value; });
    SIDEBAR_CHK_IDS.forEach(id => { if ($(id)) prefs[id] = Boolean($(id).checked); });
    SIDEBAR_SEL_IDS.forEach(id => { if ($(id)) prefs[id] = $(id).value; });
    if ($('start') && /^\d{4}-\d{2}-\d{2}$/.test($('start').value)) prefs.start = $('start').value;
    prefs.v = UI_PREF_VER;
    localStorage.setItem(UI_PREF_KEY, JSON.stringify(prefs));
  } catch (e) {}
}

function loadUiPrefs(){
  let hasStart = false;
  try {
    const raw = localStorage.getItem(UI_PREF_KEY);
    if (!raw) return false;
    const prefs = JSON.parse(raw);
    if (!prefs || typeof prefs !== 'object') return false;
    // Bản lưu cũ (trước v2) còn định mức 2.000 PC/h -> bỏ qua ô năng suất để dùng định mức mới 3.360 PC/h
    const oldVer = !(Number(prefs.v) >= UI_PREF_VER);
    SIDEBAR_NUM_IDS.forEach(id => {
      if (oldVer && id === 'rate') return;
      if ($(id) && prefs[id] !== undefined && prefs[id] !== null && prefs[id] !== ''){
        $(id).value = prefs[id];
      }
    });
    SIDEBAR_CHK_IDS.forEach(id => {
      if ($(id) && typeof prefs[id] === 'boolean') $(id).checked = prefs[id];
    });
    SIDEBAR_SEL_IDS.forEach(id => {
      if ($(id) && typeof prefs[id] === 'string' && Array.from($(id).options).some(o => o.value === prefs[id])){
        $(id).value = prefs[id];
      }
    });
    if ($('start') && typeof prefs.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(prefs.start)){
      $('start').value = prefs.start;
      hasStart = true;
    }
  } catch (e) {
    try { localStorage.removeItem(UI_PREF_KEY); } catch (_) {}
  }
  return hasStart;
}

function loadStoredData(){
  let hasStart = false;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw){
      const p = JSON.parse(raw);
      const valid = Array.isArray(p.skus) && p.skus.length && p.skus.every(r =>
        Array.isArray(r) && r.length >= 6 && String(r[0] || '').trim() && Number.isFinite(Number(r[2])) && Number(r[2]) > 0
      );
      if (!valid) throw new Error('Invalid stored SKUS');
      WORK_SKUS = p.skus.map(r => [
        String(r[0]).trim(),
        String(r[1] ?? r[0]).trim(),
        Number(r[2]),
        [1, 2, 3].includes(Number(r[3])) ? Number(r[3]) : 2,
        r[4] === 'C' ? 'C' : 'F',
        (r[5] === 'R' || r[5] === 'Y' || r[5] === 'W') ? r[5] : 'Y'
      ]);
      if (p.meta && typeof p.meta === 'object') WORK_META = p.meta;
      if (p.actual && typeof p.actual === 'object') ACTUAL_PROD = p.actual;
      if (p.actualSrc && typeof p.actualSrc === 'object'){
        ACTUAL_SRC = p.actualSrc;
      } else {
        // Dữ liệu cũ chưa có nguồn: coi là nhập tay để không bao giờ bị ghi đè mất
        ACTUAL_SRC = Object.fromEntries(Object.keys(ACTUAL_PROD).map(k => [k, 'manual']));
      }
      if (p.sources && typeof p.sources === 'object') DATA_SRC = p.sources;
      if (p.note) dataNote = p.note;
      if (p.startIso && /^\d{4}-\d{2}-\d{2}$/.test(p.startIso) && $('start')){
        $('start').value = p.startIso;
        hasStart = true;
      }
      if (typeof p.prioritizeUrgent === 'boolean' && $('prioritizeUrgent')){
        $('prioritizeUrgent').checked = p.prioritizeUrgent;
      }
    } else if (localStorage.getItem(CLEAR_FLAG_KEY) === '1'){
      WORK_SKUS = [];
      WORK_META = {};
      ACTUAL_PROD = {};
      ACTUAL_SRC = {};
      DATA_SRC = {};
      dataNote = EMPTY_DATA_NOTE;
    }
  } catch (e) {
    console.warn('loadStoredData:', e);
    try { localStorage.removeItem(STORE_KEY); } catch (_) {}
    WORK_SKUS = [];
    WORK_META = {};
    dataNote = '⚠ Dữ liệu lưu cục bộ bị hỏng nên đã đặt lại trạng thái trống. Hãy nạp lại file Excel / CSV.';
  }
  const prefStart = loadUiPrefs();
  if (!hasStart && !prefStart && $('start')) $('start').value = defaultStartIso();
  ensureStableStt();
  clampSidebarInputs();
}

function saveStoredData(){
  saveUiPrefs();
  try {
    if (!WORK_SKUS.length){
      localStorage.removeItem(STORE_KEY);
      localStorage.setItem(CLEAR_FLAG_KEY, '1');
      return;
    }
    localStorage.removeItem(CLEAR_FLAG_KEY);
    const startIso = $('start') ? $('start').value : defaultStartIso();
    localStorage.setItem(STORE_KEY, JSON.stringify({
      skus: WORK_SKUS, meta: WORK_META, note: dataNote, startIso,
      prioritizeUrgent: Boolean($('prioritizeUrgent') && $('prioritizeUrgent').checked),
      actual: ACTUAL_PROD, actualSrc: ACTUAL_SRC, sources: DATA_SRC
    }));
  } catch (e) {
    console.warn('saveStoredData:', e);
    if (!saveStorageWarned){
      saveStorageWarned = true;
      const warn = ' ⚠ Không thể lưu vào localStorage trình duyệt (hết dung lượng hoặc bị chặn) — dữ liệu có thể mất khi tải lại trang.';
      if (!dataNote.includes('localStorage')) dataNote += warn;
      if ($('dataInfo')) $('dataInfo').textContent = dataNote;
    }
  }
}

function clearAllData(){
  if (!confirm('Xóa toàn bộ dữ liệu kế hoạch hiện tại (cả FINE, CHISEL và các ô đã chỉnh tay) để nạp kế hoạch mới?')) return;
  try {
    localStorage.removeItem(STORE_KEY);
    localStorage.setItem(CLEAR_FLAG_KEY, '1');
  } catch (e) {}
  WORK_SKUS = [];
  WORK_META = {};
  ACTUAL_PROD = {};
  ACTUAL_SRC = {};
  DATA_SRC = {};
  RUNS.length = 0;
  pendingImportFam = null;
  DELETE_UNDO = null;
  hideToast();
  lastRunError = '';
  selectedDay = '';
  SKU_FILTER.q = '';
  SKU_FILTER.fam = 'all';
  SKU_FILTER.st = 'all';
  if ($('skuSearch')) $('skuSearch').value = '';
  if ($('scName')) $('scName').value = 'Kịch bản A';
  if ($('xlsxIn')) $('xlsxIn').value = '';
  syncFilterUi();
  dataNote = EMPTY_DATA_NOTE;
  renderRuns();
  run();
}

function clampSidebarInputs(){
  const defaultRate = (typeof DTM_SPECS !== 'undefined' && DTM_SPECS.ratePerHour) ? DTM_SPECS.ratePerHour : 3360;
  const clampNum = (id, min, max, fallback, round) => {
    const el = $(id);
    if (!el) return;
    let v = parseFloat(el.value);
    if (!Number.isFinite(v)) v = fallback;
    if (round) v = Math.round(v);
    if (min !== null && v < min) v = min;
    if (max !== null && v > max) v = max;
    el.value = String(v);
  };
  clampNum('machines', 1, 4, 3, true);
  clampNum('backupDelayMin', 0, null, 480, true);
  clampNum('h1', 0, 8, 7.5, false);
  clampNum('h2', 0, 8, 7.5, false);
  clampNum('h3', 0, 8, 7.25, false);
  clampNum('waitDays', 0, null, 3, true);
  clampNum('rate', 60, null, defaultRate, true);
  clampNum('co', 0, null, 15, true);
  clampNum('coSame', 0, null, 9, true);
  clampNum('cuGroup', 0, null, 10, true);
  clampNum('cuSwitch', 0, null, 60, true);
}

function setCtrlDisabled(elId, lblId, disabled){
  const el = $(elId);
  if (el) el.disabled = Boolean(disabled);
  const lbl = lblId ? $(lblId) : null;
  if (lbl) lbl.classList.toggle('ctrl-disabled', Boolean(disabled));
}

function syncControlStates(R){
  const onlyReady = Boolean($('onlyReady') && $('onlyReady').checked);
  const machines = Math.round(parseFloat($('machines') ? $('machines').value : 3)) || 3;
  const isSop = ($('coMode') ? $('coMode').value : 'sop') !== 'heijunka';

  // Khóa các ô không có tác dụng trong cấu hình hiện tại
  setCtrlDisabled('allowPullW', 'lblAllowPullW', onlyReady);
  setCtrlDisabled('waitDays', 'lblWaitDays', onlyReady);
  setCtrlDisabled('backupDelayMin', 'lblBackupDelay', machines < 4);
  setCtrlDisabled('coSame', 'lblCoSame', isSop);
  setCtrlDisabled('cuGroup', 'lblCuGroup', isSop);
  [1, 2, 3].forEach(i => {
    const on = Boolean($('on' + i) && $('on' + i).checked);
    setCtrlDisabled('h' + i, null, !on);
  });

  // Đánh dấu preset đang khớp ở sidebar
  const presets = $('presetBtns');
  if (presets){
    const onArr = [1, 2, 3].map(i => Boolean($('on' + i) && $('on' + i).checked));
    presets.querySelectorAll('[data-preset]').forEach(btn => {
      const p = PRE[btn.dataset.preset];
      const match = Boolean(p && p.m === machines && p.ready === onlyReady &&
        onArr[0] === !!p.on[0] && onArr[1] === !!p.on[1] && onArr[2] === !!p.on[2]);
      btn.className = 'sm' + (match ? ' pri' : '');
    });
  }

  // Khóa nút Xóa dữ liệu khi danh sách đang trống; khóa In / Sao chép / Xuất khi không có dữ liệu lập lịch hoạt động
  const hasActiveJobs = Boolean(R && R.incl && R.incl.length > 0 && R.slots && R.slots.length > 0);
  const hasDayOrders = Boolean(R && selectedDay && Object.values(R.orders || {}).some(o => o.slot.ds === selectedDay));
  if ($('btnClearData')) $('btnClearData').disabled = WORK_SKUS.length === 0;
  if ($('btnExportXlsx')) $('btnExportXlsx').disabled = !hasActiveJobs;
  if ($('btnPrintOrders')) $('btnPrintOrders').disabled = !hasDayOrders;
  if ($('btnPrintSlip')) $('btnPrintSlip').disabled = !hasDayOrders;
  if ($('copyTxt')) $('copyTxt').disabled = !hasDayOrders;
}

function readParams(){
  const defaultRate = (typeof DTM_SPECS !== 'undefined' && DTM_SPECS.ratePerHour) ? DTM_SPECS.ratePerHour : 3360;
  const num = id => {
    const v = parseFloat($(id).value);
    return Number.isFinite(v) ? v : 0;
  };
  const rawRate = num('rate');
  const rawStart = $('start') ? $('start').value : '';
  const startD = new Date((rawStart || defaultStartIso()) + 'T00:00:00');
  const start = Number.isNaN(startD.getTime()) ? new Date(defaultStartIso() + 'T00:00:00') : startD;
  return {
    machines: Math.max(1, Math.min(4, Math.round(num('machines')) || 1)),
    backupDelayMin: Math.max(0, num('backupDelayMin')),
    // Mỗi ca nằm trong khung 8 giờ -> giới hạn 0..8h
    shifts: [1, 2, 3].map(i => ({name: 'Ca ' + i, on: $('on' + i).checked, h: Math.min(8, Math.max(0, num('h' + i)))})),
    rate: rawRate > 0 ? Math.max(60, rawRate) : defaultRate,
    coMode: $('coMode').value,
    co: Math.max(0, num('co')),
    coSame: Math.max(0, num('coSame')),
    cuGroup: Math.max(0, num('cuGroup')),
    cuSwitch: Math.max(0, num('cuSwitch')),
    start,
    skipSun: $('skipSun').checked,
    waitDays: Math.max(0, Math.round(num('waitDays'))),
    onlyReady: $('onlyReady').checked,
    allowPullW: $('allowPullW').checked,
    campaign: $('campaign').checked,
    sortMode: $('sortMode').value,
    prioritizeUrgent: Boolean($('prioritizeUrgent') && $('prioritizeUrgent').checked),
    minShiftTailMin: 20,
    maxDays: 60,
    skus: WORK_SKUS,
    metaMap: WORK_META,
    // Thứ tự file kế hoạch đã tải lên của từng dòng bút (nhỏ hơn = tải lên trước = chạy trước)
    famOrder: { F: famSeqOf('F'), C: famSeqOf('C') }
  };
}

// Số thứ tự tải file của 1 dòng bút. Dữ liệu cũ chưa có số thứ tự: FINE = 1, CHISEL = 2 (như trước đây)
function famSeqOf(fam){
  const s = DATA_SRC[fam] && Number(DATA_SRC[fam].seq);
  return Number.isFinite(s) && s > 0 ? s : (fam === 'C' ? 2 : 1);
}

function renderSourceBadges(){
  const fRows = WORK_SKUS.filter(r => r[4] === 'F');
  const cRows = WORK_SKUS.filter(r => r[4] === 'C');
  const fPcs = fRows.reduce((s, r) => s + Number(r[2] || 0), 0);
  const cPcs = cRows.reduce((s, r) => s + Number(r[2] || 0), 0);
  const elF = $('badgeSrcF'), elC = $('badgeSrcC');
  // Thứ tự chạy theo file tải lên (chỉ hiện khi bật "Chạy theo thứ tự file" và cả 2 dòng có dữ liệu)
  const byFile = Boolean($('campaign') && $('campaign').checked) && fRows.length > 0 && cRows.length > 0;
  const firstFam = famSeqOf('F') <= famSeqOf('C') ? 'F' : 'C';
  const orderTag = fam => byFile ? (fam === firstFam ? 'Chạy trước · ' : 'Chạy sau · ') : '';
  const orderTip = fam => byFile ? ' · Chạy ' + (fam === firstFam ? 'TRƯỚC' : 'SAU') + ' (theo thứ tự tải file)' : '';
  if (elF){
    const src = DATA_SRC.F;
    if (!fRows.length && !src){
      elF.className = 'badge-src fine';
      elF.innerHTML = '<i class="dot"></i>FINE: 0 mã (Trống)';
      elF.title = 'Chưa có dữ liệu dòng FINE';
    } else {
      elF.className = 'badge-src fine' + (src ? ' loaded' : '');
      elF.innerHTML = '<i class="dot"></i>' + orderTag('F') + 'FINE: ' + fRows.length + ' mã · ' + N(fPcs) + ' PC (' + esc(src ? src.file : 'Đã nạp') + ')';
      elF.title = (src ? ('Đã nạp từ file ' + src.file + ' lúc ' + src.at) : 'Dữ liệu dòng FINE hiện tại') + orderTip('F');
    }
  }
  if (elC){
    const src = DATA_SRC.C;
    if (!cRows.length && !src){
      elC.className = 'badge-src chisel';
      elC.innerHTML = '<i class="dot"></i>CHISEL: 0 mã (Trống)';
      elC.title = 'Chưa có dữ liệu dòng CHISEL';
    } else {
      elC.className = 'badge-src chisel' + (src ? ' loaded' : '');
      elC.innerHTML = '<i class="dot"></i>' + orderTag('C') + 'CHISEL: ' + cRows.length + ' mã · ' + N(cPcs) + ' PC (' + esc(src ? src.file : 'Đã nạp') + ')';
      elC.title = (src ? ('Đã nạp từ file ' + src.file + ' lúc ' + src.at) : 'Dữ liệu dòng CHISEL hiện tại') + orderTip('C');
    }
  }
}

function renderSidebarMachines(R){
  const el = $('sidebarMachines');
  if (!el || !R) return;
  const maxClock = R.segs.reduce((mx, g) => Math.max(mx, g.e), 0) || 1;
  let html = '';
  for (let mi = 1; mi <= 4; mi++){
    const enabled = mi <= R.P.machines;
    const isBackup = mi === 4;
    const mSegs = R.segs.filter(g => g.m === mi);
    const runMin = mSegs.filter(g => g.type === 'run').reduce((s, g) => s + (g.e - g.s), 0);
    const coMin = mSegs.filter(g => g.type === 'co').reduce((s, g) => s + (g.e - g.s), 0);
    const pcs = Math.round(mSegs.filter(g => g.type === 'run').reduce((s, g) => s + g.pcs, 0));
    const utilPct = enabled && maxClock > 0 ? Math.min(100, Math.round((runMin / maxClock) * 100)) : 0;

    let badge = '';
    if (!enabled){
      badge = '<span class="m-badge stby">Dự phòng (Tắt)</span>';
    } else if (isBackup){
      badge = pcs > 0
        ? '<span class="m-badge act-bkp">DP · Kích hoạt</span>'
        : '<span class="m-badge stby">DP · Chờ tải</span>';
    } else {
      badge = '<span class="m-badge pri">Máy chính</span>';
    }

    html += '<div class="mach-card ' + (enabled && pcs > 0 ? 'active' : 'standby') + '">' +
      '<div class="mach-card-hd"><span>M' + mi + '</span>' + badge + '</div>' +
      '<div style="display:flex;justify-content:space-between;color:var(--mut)"><span>Tải: <b style="color:var(--ink)">' + utilPct + '%</b></span><span>' + N(pcs) + ' PC</span></div>' +
      '<div class="mach-bar"><div class="mach-fill" style="width:' + utilPct + '%"></div></div>' +
      '<div style="font-size:10.5px;color:var(--mut)">Chạy: ' + (runMin / 60).toFixed(1) + 'h · Đổi: ' + Math.round(coMin) + 'p</div>' +
      '</div>';
  }
  el.innerHTML = html;
}

function renderKpis(R){
  const P = R.P;
  const sumH = P.shifts.reduce((s, sh) => s + (sh.on ? sh.h : 0), 0);
  const hasJobs = R.jobs && R.jobs.length > 0;
  const finish = !hasJobs ? '–' : (R.ok && R.lastJ ? R.lastJ.end.ds : 'Chưa xong');
  const finSub = !hasJobs ? 'chưa có dữ liệu kế hoạch' : (R.ok && R.lastJ ? 'ngày thứ ' + (R.lastJ.endDay + 1) + ' của lịch' : 'còn ' + N(R.need - R.doneTot) + ' PC');
  // Thẻ "Khả năng hoàn thành bộ túi" đã gỡ (21/11/2026): app không có số tồn kho nên không kết luận được đủ bộ
  const cards = [
    ['Cần sản xuất', N(R.need) + ' PC', R.incl.length + ' mã đưa vào mô phỏng'],
    ['Làm được trong mô phỏng', N(R.doneTot) + ' PC', R.fin.length + ' / ' + R.incl.length + ' mã hoàn thành'],
    ['Ngày xong toàn bộ', finish, finSub],
    ['Công suất danh định/ngày', N(P.machines * sumH * P.rate) + ' PC', P.machines + ' máy × ' + sumH + ' giờ'],
    ['Giờ đổi màu', R.coH.toFixed(1) + ' h', R.trans + ' lần đổi · ' + R.fSw + ' lần FINE↔CHISEL'],
    ['Hiệu suất máy', (R.util * 100).toFixed(1) + '%', 'tỷ lệ giờ máy thực sự sản xuất'],
    ['Giờ máy rảnh', R.idleH.toFixed(1) + ' h', 'thường do chờ BTP'],
    ['Cảnh báo trễ PO', R.lateCount + ' mã', R.lateCount ? 'trễ hạn PO hoặc chưa xếp xong mã có hạn PO' : 'chưa phát hiện trễ PO', R.lateCount > 0]
  ];
  $('kpis').innerHTML = cards.map(c =>
    '<div class="kpi' + (c[3] ? ' warn' : '') + (c[4] ? ' wide' : '') + '"><span>' + c[0] + '</span><b>' + c[1] + '</b><span>' + c[2] + '</span></div>'
  ).join('');
}

function getActiveDays(R){
  if (!R || !R.jobs || !R.jobs.length || !R.horizon || !R.slots || !R.slots.length) return [];
  const H = R.horizon;
  const days = [], seen = new Set();
  for (const s of R.slots){
    if (s.cum >= H) break;
    if (!seen.has(s.ds)){
      seen.add(s.ds);
      const dayPcs = R.segs.filter(g => g.ds === s.ds && g.type === 'run').reduce((sum, g) => sum + g.pcs, 0);
      days.push({ ds: s.ds, dow: s.dow, date: s.date, dayIdx: s.dayIdx, cum: s.cum, pcs: dayPcs });
    }
  }
  return days;
}

function fmtMinOfDay(min){
  const norm = ((Math.round(min) % 1440) + 1440) % 1440;
  return String(Math.floor(norm / 60)).padStart(2, '0') + ':' + String(norm % 60).padStart(2, '0');
}

function renderDailyTracker(R, day){
  const el = $('dailyTracker');
  if (!el) return;
  if (!day || !R || !R.jobs || !R.jobs.length || !R.slots.length){ el.innerHTML = ''; return; }
  let cards = '', totPlan = 0, totAct = 0;
  for (let mi = 1; mi <= R.P.machines; mi++){
    const plan = Math.round(R.segs.filter(g => g.ds === day && g.m === mi && g.type === 'run').reduce((s, g) => s + g.pcs, 0));
    const key = day + ':M' + mi;
    const act = Math.max(0, Math.round(numVal(ACTUAL_PROD[key] ?? 0)));
    const isManual = ACTUAL_SRC[key] === 'manual';
    totPlan += plan;
    totAct += act;
    const pct = plan > 0 ? Math.min(100, Math.round((act / plan) * 100)) : (act > 0 ? 100 : 0);
    const diff = act - plan;
    const diffStr = (diff >= 0 ? '+' : '') + N(diff) + ' PC';
    const mLabel = mi === 4 ? 'M4 (dự phòng)' : 'M' + mi;
    cards += '<div class="trk-card' + (isManual ? ' manual-override' : '') + '">' +
      '<div class="row" style="justify-content:space-between"><b>' + mLabel + ' · KH: ' + N(plan) + ' PC</b><span>Đạt: <b>' + pct + '%</b> (' + diffStr + ')</span></div>' +
      '<div class="trk-bar"><div class="trk-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="row" style="margin-top:4px">' +
      '<span style="font-size:11.5px;color:var(--mut)">SL thực tế (PC):</span>' +
      '<input type="number" class="cell-in n' + (isManual ? ' is-edited' : '') + '" style="width:95px" min="0" step="100" data-trk-key="' + esc(key) + '" value="' + act + '" title="' +
        (isManual ? 'Đang dùng số nhập tay (được giữ nguyên khi nạp lại file).' : 'Nhập số lượng thực tế ca làm việc để theo dõi đạt kế hoạch.') + '">' +
      '<button class="sm" data-trk-fill="' + esc(key) + '" data-plan="' + plan + '">= KH</button>' +
      '</div></div>';
  }
  const totPct = totPlan > 0 ? Math.round((totAct / totPlan) * 100) : 0;
  const totDiff = totAct - totPlan;
  el.innerHTML = '<div class="row" style="justify-content:space-between">' +
    '<b>Theo dõi tiến độ thực tế ngày ' + esc(day) + ' (Tổng KH: ' + N(totPlan) + ' PC · Thực tế: ' + N(totAct) + ' PC · Đạt ' + totPct + '% · Chênh lệch: ' + (totDiff >= 0 ? '+' : '') + N(totDiff) + ' PC)</b>' +
    '<span class="note" style="margin:0">Ô màu xanh nhạt = Tổ trưởng đã nhập tay SL thực tế (được giữ nguyên khi nạp lại file)</span></div>' +
    '<div class="trk-grid">' + cards + '</div>';
}

function buildRichTooltipHtml(g, job, slotShift, slotTime, durMin){
  const famName = g.fam === 'C' ? 'CHISEL' : 'FINE';
  if (g.type === 'co'){
    return '<div class="tt-hd"><span>Đổi màu / Đổi dòng → ' + esc(g.code) + '</span><span class="tt-tag ' + esc(g.fam) + '">' + famName + '</span></div>' +
      '<div><b>Khung giờ:</b> ' + esc(g.ds + ' · ' + slotShift + ' (' + (g.timeWin || slotTime) + ')') + '</div>' +
      '<div><b>Thời gian SMED:</b> ' + durMin + ' phút</div>';
  }
  const stName = STAT[g.st] || g.st || '';
  const poTxt = job ? (poStatus(job).long || (job.dueDateStr ? 'Đúng hạn (' + job.dueDateStr + ')' : 'Chưa gán hạn PO')) : '–';
  const btpTxt = job && job.st === 'W' ? (' · Đủ BTP: ' + (job.btpReadyStr || '–') + (job.pulledEarly ? ' [Kéo sớm]' : '')) : '';
  return '<div class="tt-hd"><span>' + esc(g.code) + ' · SAP: ' + esc(g.sap || g.code) + '</span><span class="tt-tag ' + esc(g.fam) + '">' + famName + '</span></div>' +
    '<div><b>Ca chạy:</b> ' + esc(g.ds + ' · ' + slotShift + ' (' + (g.timeWin || slotTime) + ')') + '</div>' +
    '<div><b>SL trong ca:</b> ' + N(g.pcs) + ' PC' + (job ? ' / Tổng lô: ' + N(job.rem0) + ' PC' : '') + '</div>' +
    '<div><b>Trạng thái BTP:</b> ' + esc(g.st + ' (' + stName + ')' + btpTxt) + '</div>' +
    '<div><b>Hạn PO:</b> ' + esc(job && job.dueDateStr ? job.dueDateStr + ' · ' : '') + esc(poTxt) + '</div>';
}

function renderGantt(R){
  const warnEl = $('shiftWarnBanner');
  const noShifts = !R.slots || !R.slots.length;
  if (warnEl){
    if (noShifts){
      warnEl.style.display = 'block';
      warnEl.textContent = '⚠ Chưa bật ca làm việc nào (Ca 1 / Ca 2 / Ca 3 đều đang tắt hoặc 0 giờ) — hệ thống không thể lập lịch chạy máy. Hãy bật ít nhất 1 ca ở thanh cấu hình bên trái.';
    } else {
      warnEl.style.display = 'none';
      warnEl.textContent = '';
    }
  }

  const H = R.horizon || 1;
  const days = getActiveDays(R);
  if (!days.some(d => d.ds === selectedDay)){
    selectedDay = ($('dayPick') && days.some(d => d.ds === $('dayPick').value))
      ? $('dayPick').value
      : (days[0] ? days[0].ds : '');
  }
  if ($('dayPick') && selectedDay && $('dayPick').value !== selectedDay){
    $('dayPick').value = selectedDay;
  }

  if ($('ganttTabs')){
    $('ganttTabs').querySelectorAll('[data-gtab]').forEach(b => {
      b.className = 'sm' + (b.dataset.gtab === ganttMode ? ' pri' : '');
    });
  }

  // Day pills + hiển thị vạch nghỉ Chủ nhật (06:00 CN -> 06:00 T2)
  if ($('dayPills')){
    const pillHtml = [];
    days.forEach((d, idx) => {
      if (idx > 0 && d.dayIdx - days[idx - 1].dayIdx > 1){
        pillHtml.push('<span class="sun-pill" title="Nghỉ Chủ nhật: từ 06:00 sáng CN đến 06:00 sáng Thứ Hai (Ca 3 Thứ Bảy vẫn chạy tới 06:00 CN)">CN · Nghỉ (06:00 CN→06:00 T2)</span>');
      }
      pillHtml.push(
        '<button class="day-pill' + (d.ds === selectedDay ? ' pri' : '') + '" data-day="' + esc(d.ds) + '">' +
        esc(d.dow + ' ' + d.ds.slice(0, 5)) + ' · ' + N(d.pcs) + ' PC</button>'
      );
    });
    $('dayPills').innerHTML = pillHtml.join('');
  }

  if (!days.length){
    const emptyMsg = noShifts
      ? 'Chưa có ca làm việc nào được bật.'
      : ((!R.jobs || !R.jobs.length) ? EMPTY_DATA_NOTE : 'Chưa có mã nào được phân bổ vào lịch.');
    $('gantt').innerHTML = '<div style="padding:18px;text-align:center" class="note">' + esc(emptyMsg) + '</div>';
    $('legend').innerHTML = '';
    renderDailyTracker(R, '');
    return;
  }

  const jobMap = new Map(R.jobs.map(j => [j.fam + ':' + j.code, j]));

  if (ganttMode === 'day' && selectedDay){
    const daySlots = R.slots.filter(s => s.ds === selectedDay && s.cum < H);
    const nSh = Math.max(1, daySlots.length);
    const shBand = '<div class="sh-band-row"><div class="sh-corner">Máy / Ca (' + esc(selectedDay.slice(0, 5)) + ')</div>' +
      '<div class="sh-band" style="grid-template-columns:repeat(' + nSh + ',1fr)">' +
      daySlots.map(s => '<div class="sh-cell">' + esc(s.shift + ' (' + fmtMinOfDay(s.startEpochMin) + '–' + fmtMinOfDay(s.startEpochMin + s.len) + ' · ' + (s.len / 60).toFixed(s.len % 60 === 0 ? 0 : 2).replace(/\.?0+$/, '') + 'h)') + '</div>').join('') +
      '</div></div>';

    // Vẽ thước giờ thực theo từng ca được bật (hỗ trợ cả ca không liên tiếp như Ca 1 + Ca 3 tắt Ca 2)
    let ticks = '', hrGrid = '';
    const firstStartStr = daySlots.length ? fmtMinOfDay(daySlots[0].startEpochMin) : '06:00';
    daySlots.forEach((slot, sOrder) => {
      const slotStartMin = ((slot.startEpochMin % 1440) + 1440) % 1440;
      const slotHrs = slot.len / 60;
      if (sOrder > 0){
        const sepPct = ((sOrder / nSh) * 100).toFixed(3);
        hrGrid += '<div class="hr-grid shift-sep" style="left:' + sepPct + '%"></div>';
      }
      for (let h = 0; h < slotHrs - 1e-6; h += 2){
        const pct = ((sOrder + (h * 60) / slot.len) / nSh) * 100;
        const isStart = h === 0;
        const stylePos = pct < 0.1
          ? 'left:0%;transform:translateX(0)'
          : 'left:' + pct.toFixed(3) + '%';
        ticks += '<span class="' + (isStart ? 'boundary-06' : '') + '" style="' + stylePos + '">' + fmtMinOfDay(slotStartMin + h * 60) + '</span>';
      }
      for (let h = 1; h < slotHrs - 1e-6; h++){
        const pct = ((sOrder + (h * 60) / slot.len) / nSh) * 100;
        hrGrid += '<div class="hr-grid" style="left:' + pct.toFixed(3) + '%"></div>';
      }
      if (sOrder === nSh - 1){
        ticks += '<span class="boundary-06" style="left:100%;transform:translateX(-100%)">' + fmtMinOfDay(slotStartMin + slot.len) + '</span>';
      }
    });

    const stickyTop = '<div class="gantt-sticky-top">' + shBand +
      '<div class="axis-row"><div class="axis-corner">Mốc giờ (' + esc(firstStartStr) + ')</div><div class="axis">' + ticks + '</div></div></div>';

    let lanes = '';
    for (let mi = 1; mi <= R.P.machines; mi++){
      let bars = hrGrid;
      const mPlan = Math.round(R.segs.filter(g => g.ds === selectedDay && g.m === mi && g.type === 'run').reduce((s, g) => s + g.pcs, 0));
      let dayIdleMin = 0;
      daySlots.forEach((slot, sOrder) => {
        const segsInSlot = R.segs.filter(g => g.m === mi && g.slotIdx === slot.idx);
        for (const g of segsInSlot){
          const relS = ((sOrder + Math.max(0, g.s - slot.cum) / slot.len) / nSh) * 100;
          const relW = Math.max(0.35, ((g.e - g.s) / slot.len / nSh) * 100);
          const isCo = g.type === 'co';
          const famName = g.fam === 'C' ? 'CHISEL' : 'FINE';
          const stName = STAT[g.st] || g.st || '';
          const durMin = Math.round(g.e - g.s);
          const job = jobMap.get(g.fam + ':' + g.code);
          const isPoAlert = !isCo && job && (job.isLate || job.poRisk);
          const tip = isCo
            ? 'Đổi màu/dòng → ' + g.code + ' (' + famName + ') · Khung giờ: ' + (g.timeWin || slot.time) + ' · Thời gian đổi: ' + durMin + ' phút'
            : 'Mã chạy: ' + g.code + ' · SAP: ' + (g.sap || g.code) + ' | Họ: ' + famName + ' | ' + slot.shift + ' (' + (g.timeWin || slot.time) + ') | SL chạy trong ca: ' + N(g.pcs) + ' PC | Đổi màu: ' + (g.coMin || 0) + ' phút | Trạng thái: ' + g.st + ' (' + stName + ')';
          const richTt = buildRichTooltipHtml(g, job, slot.shift, slot.time, durMin);
          const hueBar = !isCo
            ? '<span class="seg-hue-bar" style="background:' + (g.hue >= 0 ? 'hsl(' + g.hue + ',75%,55%)' : '#94A3B8') + '"></span>'
            : '';
          let inLbl = '';
          if (isCo && relW >= 1.8){
            inLbl = '<span class="seg-lbl">' + durMin + 'p</span>';
          } else if (!isCo && relW >= 6.5){
            inLbl = '<span class="seg-lbl">' + esc(g.code) + ' · ' + N(g.pcs) + '</span>';
          } else if (!isCo && relW >= 2.6){
            inLbl = '<span class="seg-lbl">' + esc(g.code) + '</span>';
          }
          const cls = 'seg' + (isCo ? ' co' : ' fam-' + g.fam + (isPoAlert ? ' po-alert' : ''));
          bars += '<div class="' + cls + '" style="left:' + relS.toFixed(3) + '%;width:' + relW.toFixed(3) + '%" title="' + esc(tip) + '" data-tt="' + esc(richTt) + '">' + inLbl + hueBar + '</div>';
        }
        // Khoảng máy rảnh trong ca (cắt theo ranh giới ca) + lý do ngắn gọn không tràn
        for (const idl of (R.idles || [])){
          if (idl.m !== mi) continue;
          const s = Math.max(idl.s, slot.cum), e = Math.min(idl.e, slot.endCum);
          if (e - s < 1e-6) continue;
          dayIdleMin += e - s;
          const relS = ((sOrder + (s - slot.cum) / slot.len) / nSh) * 100;
          const relW = ((e - s) / slot.len / nSh) * 100;
          const lbl = idl.kind === 'campaign' ? 'Chờ file trước' : (idl.kind === 'btp' ? 'Chờ BTP (W)' : (idl.kind === 'tail' ? 'Dời ca <20p' : 'Rảnh'));
          const idleMinRound = Math.round(e - s);
          const tip = 'Máy rảnh ' + idleMinRound + ' phút trong ' + slot.shift + ' · ' + idl.reason;
          const richIdle = '<div class="tt-hd"><span>Máy M' + mi + ' nghỉ ' + idleMinRound + ' phút</span><span class="tt-tag idle">' + esc(lbl) + '</span></div>' +
            '<div><b>Ca:</b> ' + esc(selectedDay + ' · ' + slot.shift + ' (' + slot.time + ')') + '</div>' +
            '<div><b>Nguyên nhân:</b> ' + esc(idl.reason) + '</div>';
          bars += '<div class="seg idle" style="left:' + relS.toFixed(3) + '%;width:' + relW.toFixed(3) + '%" title="' + esc(tip) + '" data-tt="' + esc(richIdle) + '">' +
            (relW >= 7.5 ? '<span class="seg-lbl">' + lbl + '</span>' : '') + '</div>';
        }
      });
      const mLabel = '<span>' + (mi === 4 ? 'M4 (Dự phòng)' : 'Máy M' + mi) + '</span>' +
        '<span style="font-size:11px;color:var(--mut);font-weight:500">' + N(mPlan) + ' PC</span>' +
        (dayIdleMin >= 1 ? '<span class="idle-txt">Rảnh ' + (dayIdleMin / 60).toFixed(1) + 'h</span>' : '');
      lanes += '<div class="lane"><div class="lane-hdr">' + mLabel + '</div><div class="track intraday">' + bars + '</div></div>';
    }

    $('gantt').innerHTML = stickyTop + lanes;
    $('legend').innerHTML =
      '<span><i class="sw fine"></i>Dòng FINE (Teal)</span>' +
      '<span><i class="sw chisel"></i>Dòng CHISEL (Blue)</span>' +
      '<span><i class="sw po-late"></i>Viền đỏ = Mã Trễ / Nguy cơ PO</span>' +
      '<span><i class="sw co"></i>Đổi màu / Đổi dòng (9p, 15p, 60p)</span>' +
      '<span><i class="sw idle"></i>Ô gạch đỏ = Máy rảnh (Chờ BTP W / Chờ file trước)</span>';
    renderDailyTracker(R, selectedDay);
    return;
  }

  // Tab B: Tổng quan toàn đợt (Đa ngày) - click vào cột ngày để nhảy sang Chi tiết ngày đó
  const firstStartAll = R.slots.length ? fmtMinOfDay(R.slots[0].startEpochMin) : '06:00';
  let dayCols = '', sunHatches = '';
  days.forEach((d, idx) => {
    const nextCum = idx + 1 < days.length ? days[idx + 1].cum : H;
    const l = (d.cum / H * 100).toFixed(3);
    const w = Math.max(0.5, (nextCum - d.cum) / H * 100).toFixed(3);
    dayCols += '<div class="day-col" data-jump-day="' + esc(d.ds) + '" style="left:' + l + '%;width:' + w + '%" title="Click để phóng to chi tiết ngày ' + esc(d.dow + ' ' + d.ds) + ' (' + N(d.pcs) + ' PC)"></div>';
    if (idx > 0 && d.dayIdx - days[idx - 1].dayIdx > 1){
      const sunTt = '<div class="tt-hd"><span>Nghỉ Chủ Nhật</span><span class="tt-tag idle">06:00 CN → 06:00 T2</span></div>' +
        '<div>Ca 3 Thứ Bảy chạy tới 06:00 sáng CN; toàn xưởng nghỉ từ 06:00 CN đến 06:00 sáng Thứ Hai (' + esc(d.ds) + ').</div>';
      sunHatches += '<div class="sun-hatch" style="left:' + l + '%" title="Nghỉ Chủ nhật (06:00 CN → 06:00 T2)" data-tt="' + esc(sunTt) + '"></div>';
    }
  });

  const every = Math.max(1, Math.ceil(days.length / 14));
  let axis = '';
  days.forEach((s, i) => {
    if (i % every === 0){
      axis += '<span class="boundary-06" style="left:' + (s.cum / H * 100).toFixed(3) + '%;cursor:pointer" data-jump-day="' + esc(s.ds) + '">' + esc(s.dow + ' ' + s.ds.slice(0, 5)) + '</span>';
    }
  });
  const stickyTopAll = '<div class="gantt-sticky-top">' +
    '<div class="axis-row"><div class="axis-corner">Ngày (' + esc(firstStartAll) + ')</div><div class="axis">' + axis + '</div></div></div>';

  let lanes = '';
  for (let mi = 1; mi <= R.P.machines; mi++){
    let bars = '';
    for (const g of R.segs){
      if (g.m !== mi) continue;
      const l = (g.s / H * 100).toFixed(3), w = Math.max(0.14, (g.e - g.s) / H * 100).toFixed(3);
      const isCo = g.type === 'co';
      const durMin = Math.round(g.e - g.s);
      const job = jobMap.get(g.fam + ':' + g.code);
      const isPoAlert = !isCo && job && (job.isLate || job.poRisk);
      const tip = isCo ? 'Đổi màu → ' + g.code + ' · ' + durMin + ' phút (' + g.ds + ' ' + g.shift + ')'
                       : g.code + ' · ' + g.ds + ' ' + g.shift + ' (' + (g.timeWin || '') + ') · ' + N(g.pcs) + ' PC';
      const richTt = buildRichTooltipHtml(g, job, g.shift, g.timeWin || '', durMin);
      const hueBar = !isCo
        ? '<span class="seg-hue-bar" style="background:' + (g.hue >= 0 ? 'hsl(' + g.hue + ',75%,55%)' : '#94A3B8') + '"></span>'
        : '';
      const cls = 'seg' + (isCo ? ' co' : ' fam-' + g.fam + (isPoAlert ? ' po-alert' : ''));
      bars += '<div class="' + cls + '" style="left:' + l + '%;width:' + w + '%" title="' + esc(tip) + '" data-tt="' + esc(richTt) + '">' + hueBar + '</div>';
    }
    for (const idl of (R.idles || [])){
      if (idl.m !== mi) continue;
      const s = idl.s, e = Math.min(idl.e, H);
      if (e - s < 1e-6) continue;
      const lbl = idl.kind === 'campaign' ? 'Chờ file trước' : (idl.kind === 'btp' ? 'Chờ BTP (W)' : (idl.kind === 'tail' ? 'Dời ca <20p' : 'Rảnh'));
      const richIdle = '<div class="tt-hd"><span>Máy M' + mi + ' rảnh (' + ((e - s) / 60).toFixed(1) + 'h)</span><span class="tt-tag idle">' + esc(lbl) + '</span></div>' +
        '<div><b>Nguyên nhân:</b> ' + esc(idl.reason) + '</div>';
      bars += '<div class="seg idle" style="left:' + (s / H * 100).toFixed(3) + '%;width:' + ((e - s) / H * 100).toFixed(3) + '%" title="' + esc('Máy rảnh · ' + idl.reason) + '" data-tt="' + esc(richIdle) + '"></div>';
    }
    const mLabel = mi === 4 ? 'M4 (Dự phòng)' : 'Máy M' + mi;
    lanes += '<div class="lane"><div class="lane-hdr">' + mLabel + '</div><div class="track">' + bars + sunHatches + dayCols + '</div></div>';
  }

  $('gantt').innerHTML = stickyTopAll + lanes;
  $('legend').innerHTML =
    '<span><i class="sw fine"></i>FINE (Teal)</span>' +
    '<span><i class="sw chisel"></i>CHISEL (Blue)</span>' +
    '<span><i class="sw po-late"></i>Viền đỏ = Trễ / Nguy cơ PO</span>' +
    '<span><i class="sw co"></i>Đổi màu</span>' +
    '<span><i class="sw idle"></i>Máy rảnh (Chờ BTP)</span>' +
    '<span><i class="sw sun"></i>Vạch sọc = Nghỉ CN (06:00 CN → 06:00 T2)</span>' +
    '<span>Tổng: <b>' + days.length + ' ngày lịch</b></span>';
  renderDailyTracker(R, selectedDay);
}

// Trạng thái hạn PO của 1 mã: short = nhãn bảng, long = text xuất Excel, warn = tô đỏ
function poStatus(j){
  const why = j.excluded ? 'không lập lịch' : 'chưa xong trong lịch';
  if (j.isLate && j.poRisk) return { warn: true, short: 'Trễ ≥' + j.lateDays + ' ng (' + why + ')', long: 'Trễ ít nhất ' + j.lateDays + ' ngày (' + why + ')' };
  if (j.isLate) return { warn: true, short: 'Trễ ' + j.lateDays + ' ng', long: 'Trễ ' + j.lateDays + ' ngày' };
  if (j.poRisk) return { warn: true, short: j.excluded ? 'Không lập lịch' : 'Chưa xong trong lịch', long: 'Có hạn PO nhưng ' + why };
  return { warn: false, short: j.dueIso ? 'Đúng hạn' : '', long: j.dueIso ? 'Đúng hạn' : '' };
}

function getMinLotTransfer(){
  return (typeof DTM_SPECS !== 'undefined' && DTM_SPECS.minLotTransfer) ? DTM_SPECS.minLotTransfer : 5000;
}

function syncFilterUi(){
  if ($('skuSearch') && $('skuSearch').value !== SKU_FILTER.q) $('skuSearch').value = SKU_FILTER.q;
  if ($('topFamFilter') && $('topFamFilter').value !== SKU_FILTER.fam) $('topFamFilter').value = SKU_FILTER.fam;
  if ($('topStFilter') && $('topStFilter').value !== SKU_FILTER.st) $('topStFilter').value = SKU_FILTER.st;
  if ($('skuFilters')){
    $('skuFilters').querySelectorAll('[data-f]').forEach(btn => {
      const f = btn.dataset.f;
      const active = (f === 'all')
        ? (SKU_FILTER.fam === 'all' && SKU_FILTER.st === 'all')
        : (f === 'F' || f === 'C' ? SKU_FILTER.fam === f : SKU_FILTER.st === f);
      btn.className = 'sm' + (active ? ' pri' : '');
    });
  }
}

function getFilteredJobs(R){
  const allOrder = R.queue.concat(R.jobs.filter(j => j.excluded));
  const q = SKU_FILTER.q.trim().toUpperCase();
  const order = allOrder.filter(j => {
    if (q){
      const matchCode = String(j.code).toUpperCase().includes(q);
      const matchSap = String(j.sap).toUpperCase().includes(q);
      const matchDue = String(j.dueDateStr || j.dueIso || '').toUpperCase().includes(q);
      if (!matchCode && !matchSap && !matchDue) return false;
    }
    if (SKU_FILTER.fam !== 'all' && j.fam !== SKU_FILTER.fam) return false;
    if (SKU_FILTER.st === 'ry' && !(j.st === 'R' || j.st === 'Y')) return false;
    if (SKU_FILTER.st === 'late' && !(j.isLate || j.poRisk)) return false;
    if (SKU_FILTER.st === 'risk' && !j.poRisk) return false;
    if (SKU_FILTER.st === 'small' && !j.isSmallLot) return false;
    if ((SKU_FILTER.st === 'R' || SKU_FILTER.st === 'Y' || SKU_FILTER.st === 'W') && j.st !== SKU_FILTER.st) return false;
    return true;
  });
  return { allOrder, order };
}

function getSmallLotTargets(R){
  const thRaw = $('smallLotThreshold') ? numVal($('smallLotThreshold').value) : 1000;
  const threshold = Number.isFinite(thRaw) && thRaw > 0 ? Math.round(thRaw) : 0;
  const keepR = $('keepRunningOnPurge') ? $('keepRunningOnPurge').checked : true;
  const onlyFiltered = $('purgeFilteredOnly') ? $('purgeFilteredOnly').checked : false;
  if (!R || threshold <= 0){
    return { threshold, keepR, onlyFiltered, matches: [], totalPcs: 0 };
  }
  const { allOrder, order } = getFilteredJobs(R);
  const pool = onlyFiltered ? order : allOrder;
  const matches = pool.filter(j => j.rem0 < threshold && !(keepR && j.st === 'R'));
  const totalPcs = matches.reduce((s, j) => s + j.rem0, 0);
  return { threshold, keepR, onlyFiltered, matches, totalPcs };
}

function renderSmallLotControls(R){
  const prevEl = $('smallLotPreview');
  const purgeBtn = $('btnPurgeSmallLots');
  const undoBtn = $('btnUndoDelete');
  const presetsEl = $('smallLotPresets');
  const { threshold, keepR, matches, totalPcs } = getSmallLotTargets(R);

  if (presetsEl){
    presetsEl.querySelectorAll('[data-sl-preset]').forEach(btn => {
      btn.className = 'sm' + (Number(btn.dataset.slPreset) === threshold ? ' pri' : '');
    });
  }
  if (prevEl){
    if (!R || !R.jobs.length){
      prevEl.className = 'purge-preview';
      prevEl.textContent = 'Chưa có dữ liệu';
    } else if (threshold <= 0){
      prevEl.className = 'purge-preview';
      prevEl.textContent = 'Nhập ngưỡng > 0 PC';
    } else if (!matches.length){
      prevEl.className = 'purge-preview';
      prevEl.textContent = 'Không có mã nào < ' + N(threshold) + ' PC' + (keepR ? ' (trừ mã R)' : '');
    } else {
      prevEl.className = 'purge-preview has-match';
      prevEl.textContent = 'Tìm thấy ' + matches.length + ' mã · ' + N(totalPcs) + ' PC';
    }
  }
  if (purgeBtn){
    purgeBtn.disabled = matches.length === 0;
    purgeBtn.title = matches.length
      ? 'Xóa ' + matches.length + ' mã (' + N(totalPcs) + ' PC) và tự động tính lại lịch'
      : 'Không có mã thỏa điều kiện để xóa';
  }
  if (undoBtn){
    if (DELETE_UNDO){
      undoBtn.disabled = false;
      undoBtn.className = 'sm warn-soft';
      undoBtn.textContent = '↩ Hoàn tác xóa (' + DELETE_UNDO.removedCount + ' mã)';
      undoBtn.title = 'Khôi phục ' + DELETE_UNDO.removedCount + ' mã (' + N(DELETE_UNDO.removedPcs) + ' PC) vừa xóa';
    } else {
      undoBtn.disabled = true;
      undoBtn.className = 'sm';
      undoBtn.textContent = '↩ Hoàn tác xóa';
      undoBtn.title = 'Chưa có thao tác xóa nào để hoàn tác';
    }
  }
}

function removeSkusByKeys(keysToRemove, reasonLabel){
  if (!keysToRemove || !keysToRemove.size) return;
  const removedRows = WORK_SKUS.filter(r => keysToRemove.has(r[4] + ':' + r[0]));
  if (!removedRows.length) return;
  const removedPcs = removedRows.reduce((s, r) => s + Number(r[2] || 0), 0);

  DELETE_UNDO = {
    skus: WORK_SKUS.map(r => r.slice()),
    meta: JSON.parse(JSON.stringify(WORK_META)),
    note: dataNote,
    sources: JSON.parse(JSON.stringify(DATA_SRC)),
    track: JSON.parse(JSON.stringify({ a: ACTUAL_PROD, s: ACTUAL_SRC })),
    removedCount: removedRows.length,
    removedPcs
  };

  WORK_SKUS = WORK_SKUS.filter(r => !keysToRemove.has(r[4] + ':' + r[0]));
  keysToRemove.forEach(k => delete WORK_META[k]);

  if (!WORK_SKUS.length){
    DATA_SRC = {};
    dataNote = EMPTY_DATA_NOTE;
  } else {
    ['F', 'C'].forEach(fam => {
      if (!WORK_SKUS.some(r => r[4] === fam)) delete DATA_SRC[fam];
    });
    const remPcs = WORK_SKUS.reduce((s, r) => s + Number(r[2] || 0), 0);
    const cntR = WORK_SKUS.filter(r => r[5] === 'R').length;
    const cntY = WORK_SKUS.filter(r => r[5] === 'Y').length;
    const cntW = WORK_SKUS.filter(r => r[5] === 'W').length;
    dataNote = 'Đã xóa ' + removedRows.length + ' mã (' + N(removedPcs) + ' PC' + (reasonLabel ? ' · ' + reasonLabel : '') + '). ' +
      'Còn lại: ' + WORK_SKUS.length + ' mã · ' + N(remPcs) + ' PC (R:' + cntR + ' · Y:' + cntY + ' · W:' + cntW + ').';
  }

  run();
  if (!lastRunError){
    saveStoredData();
    showToast('Đã xóa ' + removedRows.length + ' mã (' + N(removedPcs) + ' PC).', true);
  }
}

function purgeSmallLots(){
  if (!lastRes) return;
  const { threshold, keepR, onlyFiltered, matches, totalPcs } = getSmallLotTargets(lastRes);
  if (!matches.length) return;
  const sample = matches.slice(0, 6).map(j => j.code + ' (' + N(j.rem0) + ')').join(', ') +
    (matches.length > 6 ? ', ...' : '');
  const msg = 'Xác nhận xóa ' + matches.length + ' mã có SL < ' + N(threshold) + ' PC (tổng ' + N(totalPcs) + ' PC)?\n' +
    'Phạm vi: ' + (onlyFiltered ? 'Theo bộ lọc hiện tại' : 'Toàn bộ kế hoạch') +
    ' · ' + (keepR ? 'Giữ lại mã đang chạy (R)' : 'Bao gồm cả mã đang chạy (R)') + '.\n' +
    'Ví dụ: ' + sample + '\n' +
    'Lịch điều độ và phiếu lệnh SX sẽ được cập nhật tự động ngay sau khi xóa (có thể Hoàn tác 1 lần).';
  if (!confirm(msg)) return;
  const keys = new Set(matches.map(j => j.fam + ':' + j.code));
  removeSkusByKeys(keys, 'lô nhỏ < ' + N(threshold) + ' PC');
}

function undoLastDelete(){
  if (!DELETE_UNDO) return;
  const snap = DELETE_UNDO;
  DELETE_UNDO = null;
  hideToast();
  WORK_SKUS = snap.skus.map(r => r.slice());
  WORK_META = JSON.parse(JSON.stringify(snap.meta));
  dataNote = snap.note;
  DATA_SRC = JSON.parse(JSON.stringify(snap.sources));
  ACTUAL_PROD = JSON.parse(JSON.stringify(snap.track.a));
  ACTUAL_SRC = JSON.parse(JSON.stringify(snap.track.s));
  run();
  if (!lastRunError) saveStoredData();
}

function renderSkus(R){
  const { allOrder, order } = getFilteredJobs(R);
  const totPcs = R.jobs.reduce((s, j) => s + j.rem0, 0);
  const minLot = getMinLotTransfer();

  if ($('skuFilters')){
    const counts = {
      all: allOrder.length,
      ry: allOrder.filter(j => j.st === 'R' || j.st === 'Y').length,
      R: allOrder.filter(j => j.st === 'R').length,
      Y: allOrder.filter(j => j.st === 'Y').length,
      W: allOrder.filter(j => j.st === 'W').length,
      F: allOrder.filter(j => j.fam === 'F').length,
      C: allOrder.filter(j => j.fam === 'C').length,
      small: allOrder.filter(j => j.isSmallLot).length,
      late: allOrder.filter(j => j.isLate || j.poRisk).length,
      risk: allOrder.filter(j => j.poRisk).length
    };
    const labels = {
      all: 'Tất cả', ry: 'Chỉ R+Y', R: 'Đang chạy (R)', Y: 'Đủ BTP (Y)', W: 'Chờ BTP (W)',
      F: 'FINE', C: 'CHISEL', small: 'Lô nhỏ (< ' + N(minLot) + ')', late: 'Trễ PO', risk: 'Nguy cơ PO'
    };
    $('skuFilters').querySelectorAll('[data-f]').forEach(btn => {
      const f = btn.dataset.f;
      if (labels[f]) btn.textContent = labels[f] + ' (' + (counts[f] ?? 0) + ')';
    });
  }
  syncFilterUi();

  const shownPcs = order.reduce((s, j) => s + j.rem0, 0);
  $('skuTitle').textContent = (order.length !== allOrder.length)
    ? 'Bảng điều độ & Tiến độ từng mã (lọc ' + order.length + '/' + allOrder.length + ' mã · ' + N(shownPcs) + '/' + N(totPcs) + ' PC)'
    : 'Bảng điều độ & Tiến độ từng mã (' + R.jobs.length + ' mã · ' + N(totPcs) + ' PC)';
  // Mã gắn máy đang tắt (vd gắn M3 khi chỉ bật 2 máy) -> engine bỏ ràng buộc; báo để planner biết
  const fixOff = WORK_SKUS.filter(r => {
    const fm = WORK_META[r[4] + ':' + r[0]] && Number(WORK_META[r[4] + ':' + r[0]].fixedMachine);
    return fm > R.P.machines;
  }).map(r => r[0] + '→M' + WORK_META[r[4] + ':' + r[0]].fixedMachine);
  $('dataInfo').textContent = dataNote + (fixOff.length
    ? ' ⚠ ' + fixOff.length + ' mã gắn máy đang tắt (chỉ bật ' + R.P.machines + ' máy) nên được xếp máy khác: ' + fixOff.slice(0, 6).join(', ') + (fixOff.length > 6 ? ', …' : '') + '.'
    : '');
  const head = '<thead><tr><th>#</th><th>Mã chạy</th><th>Mã SAP</th><th class="n">STT mã</th><th class="n">SL cần SX</th><th class="n">Còn thiếu</th><th>Trạng thái BTP</th><th>Ngày đủ BTP</th><th class="n">UT</th><th>Dòng</th><th>Hạn PO</th><th>Gắn máy</th><th class="n">Máy</th><th>Bắt đầu</th><th>Hoàn thành</th><th>Cảnh báo PO</th><th class="c" style="width:46px">Xóa</th></tr></thead>';
  const rows = order.map((j, i) => {
    const left = j.excluded ? '–' : N(Math.max(0, j.rem));
    const start = j.start ? j.start.ds + ' ' + j.start.shift : '–';
    const end = j.excluded ? 'Không đưa vào' : (j.end ? j.end.ds + ' ' + j.end.shift : 'Chưa xong');
    const key = j.fam + ':' + j.code;
    const sttIn = '<input type="number" min="0" step="1" class="cell-in' + (j.sttCustom ? ' is-edited' : '') + '" style="width:66px;min-width:60px;text-align:right" data-act="stt" data-key="' + esc(key) + '" value="' + esc(j.stt) + '" title="STT mã (0–216) dùng khi xếp theo STT mã">';
    const defSt = DEFAULT_ST_MAP.get(key);
    const stEdited = defSt && defSt !== j.st;
    const stSel = '<select class="cell-in' + (stEdited ? ' is-edited' : '') + '" data-act="st" data-key="' + esc(key) + '">' +
      ['R', 'Y', 'W'].map(s => '<option value="' + s + '"' + (j.st === s ? ' selected' : '') + '>' + s + ' · ' + STAT[s] + '</option>').join('') +
      '</select>';
    const btpIn = j.st === 'W'
      ? '<input type="date" class="cell-in' + (j.btpCustom ? ' is-edited' : '') + '" data-act="btp" data-key="' + esc(key) + '" value="' + esc(j.btpReadyStr) + '" title="' + (j.btpCustom ? 'Ngày đủ BTP đã chỉnh tay / cố định' : 'Ngày đủ BTP suy luận theo giả định') + '">' +
        (j.pulledEarly ? ' <span class="badge-late" title="Mã W được kéo chạy trước ngày đủ BTP do bật tùy chọn kéo sớm">Kéo sớm</span>' : '')
      : '–';
    const poIn = '<input type="date" class="cell-in' + (j.dueIso ? ' is-edited' : '') + '" data-act="due" data-key="' + esc(key) + '" value="' + esc(j.dueIso) + '">';
    const savedFix = (WORK_META[key] && WORK_META[key].fixedMachine) ? Number(WORK_META[key].fixedMachine) : null;
    const fmSel = '<select class="cell-in' + (savedFix ? ' is-edited' : '') + '" data-act="fix" data-key="' + esc(key) + '">' +
      '<option value="">Tự động</option>' +
      [1, 2, 3].map(m => {
        const inactive = m > R.P.machines;
        return '<option value="' + m + '"' + (savedFix === m ? ' selected' : '') + (inactive && savedFix !== m ? ' disabled' : '') + '>M' + m + (inactive ? ' (đang tắt)' : '') + '</option>';
      }).join('') +
      '</select>';
    const po = poStatus(j);
    const poBadge = po.warn
      ? '<span class="badge-late">' + esc(po.short) + '</span>'
      : (po.short ? '<span class="badge-ok">' + esc(po.short) + '</span>' : '–');
    const famBadge = '<span class="fam-pill ' + esc(j.fam) + '">' + (j.fam === 'F' ? 'FINE' : 'CHISEL') + '</span>';
    const delBtn = '<button type="button" class="sm danger-soft btn-del-sku" data-del-sku="' + esc(key) + '" title="Xóa mã ' + esc(j.code) + ' (' + N(j.rem0) + ' PC) và tự động cập nhật lịch">✕</button>';
    return '<tr class="' + (po.warn ? 'late-row' : '') + '"><td class="n">' + (i + 1) + '</td><td>' + esc(j.code) + '</td><td>' + esc(j.sap) + '</td><td class="n">' + sttIn + '</td><td class="n"><b>' + N(j.rem0) +
      '</b></td><td class="n">' + left + '</td><td>' + stSel + '</td><td>' + btpIn + '</td><td class="n">' + j.pri +
      '</td><td>' + famBadge + '</td><td>' + poIn + '</td><td>' + fmSel +
      '</td><td class="n"><b>' + (j.owner ? 'M' + j.owner : '–') + '</b></td><td>' + start + '</td><td>' + end + '</td><td>' + poBadge + '</td><td class="c">' + delBtn + '</td></tr>';
  }).join('');
  const emptyMsg = R.jobs.length === 0
    ? EMPTY_DATA_NOTE
    : 'Không có mã nào khớp bộ lọc hiện tại.';
  $('skus').innerHTML = head + '<tbody>' + (rows || '<tr><td colspan="17" class="note">' + esc(emptyMsg) + '</td></tr>') + '</tbody>';
  renderSmallLotControls(R);
}

function renderRuns(){
  const head = '<thead><tr><th>Kịch bản</th><th class="n">Máy</th><th>Giờ các ca</th><th>Xong toàn bộ</th><th class="n">Đã làm (PC)</th><th class="n">Còn thiếu (PC)</th><th class="n">Giờ đổi màu</th><th class="n">Hiệu suất</th><th class="n">Giờ rảnh</th><th></th></tr></thead>';
  const rows = RUNS.map((r, i) => '<tr><td>' + esc(r.name) + '</td><td class="n">' + r.machines + '</td><td>' + r.hours +
    '</td><td>' + r.finish + '</td><td class="n">' + N(r.done) + '</td><td class="n">' + N(r.left) + '</td><td class="n">' + r.coH +
    '</td><td class="n">' + r.util + '</td><td class="n">' + r.idleH + '</td><td><button class="sm" data-del="' + i + '">Xóa</button></td></tr>').join('');
  $('cmp').innerHTML = head + '<tbody>' + (rows || '<tr><td colspan="10" class="note">Chưa có kịch bản. Chỉnh tham số rồi bấm “Thêm vào so sánh”.</td></tr>') + '</tbody>';
}

function saveRun(){
  const R = lastRes;
  if (!R) return;
  const finish = (!R.jobs || !R.jobs.length) ? '–' : (R.ok && R.lastJ ? R.lastJ.end.ds : 'Chưa xong');
  RUNS.push({
    name: $('scName').value.trim() || 'Kịch bản ' + (RUNS.length + 1),
    machines: R.P.machines,
    hours: R.P.shifts.filter(s => s.on).map(s => s.h).join(' + ') || '–',
    finish,
    done: R.doneTot,
    left: Math.max(0, R.need - R.doneTot),
    coH: R.coH.toFixed(1),
    util: (R.util * 100).toFixed(1) + '%',
    idleH: R.idleH.toFixed(1)
  });
  if (RUNS.length > 8) RUNS.shift();
  $('scName').value = 'Kịch bản ' + (RUNS.length + 1);
  renderRuns();
}

const DOW_LONG = {
  CN: 'Chủ nhật',
  T2: 'Thứ 2',
  T3: 'Thứ 3',
  T4: 'Thứ 4',
  T5: 'Thứ 5',
  T6: 'Thứ 6',
  T7: 'Thứ 7'
};

function buildHandoverNote(x, curSlotIdx, curDs){
  const curPcs = Math.round(x.pcs);
  const totPcs = Math.round(x.rem0);
  if (!x.rem0 || curPcs >= totPcs) return '';
  const doneBefore = Math.round(x.rem0 - (x.beforeRem ?? x.rem0));
  const rawAfter = Number(x.afterRem ?? 0);
  const leftAfter = rawAfter > 1e-6 ? Math.max(0, totPcs - doneBefore - curPcs) : 0;
  const slices = (x.jobRef && Array.isArray(x.jobRef.shiftSlices)) ? x.jobRef.shiftSlices : [];
  let curIdx = slices.findIndex(s => s.slotIdx === curSlotIdx);
  if (curIdx < 0) curIdx = slices.findIndex(s => s.ds === curDs);

  if (leftAfter > 0){
    const nextSl = (curIdx >= 0 && curIdx + 1 < slices.length) ? slices[curIdx + 1] : null;
    const nextTarget = nextSl
      ? ((nextSl.ds !== curDs ? nextSl.ds.slice(0, 5) + ' ' : '') + nextSl.shift)
      : 'Ca sau';
    const nextWin = (nextSl && nextSl.timeWin) ? ' (' + nextSl.timeWin + ')' : '';
    return 'Lô ' + N(x.rem0) + ' PC — Chuyển ' + nextTarget + ' chạy tiếp ' + N(leftAfter) + ' PC' + nextWin;
  }
  if (doneBefore > 0){
    const prevSl = curIdx > 0 ? slices[curIdx - 1] : null;
    const prevSrc = prevSl
      ? ((prevSl.ds !== curDs ? prevSl.ds.slice(0, 5) + ' ' : '') + prevSl.shift)
      : 'Ca trước';
    return 'Lô ' + N(x.rem0) + ' PC — Nhận từ ' + prevSrc + ' chạy hoàn tất ' + N(x.pcs) + ' PC';
  }
  return '';
}

function fmtShiftHandover(x, curDs, curSlotIdx){
  const parts = [];
  if (x.jobRef && x.jobRef.pulledEarly) parts.push('Kéo sớm BTP');
  const hNote = buildHandoverNote(x, curSlotIdx ?? -1, curDs);
  if (hNote) parts.push(hNote);
  return parts.length ? parts.join(' · ') : '-';
}

function renderFloorNoteHtml(x, o){
  const tags = [];
  if (x.jobRef && x.jobRef.pulledEarly) tags.push('<span class="ord-tag pull">Kéo sớm BTP</span>');
  const hTxt = buildHandoverNote(x, o.slot.idx, o.slot.ds);
  if (!tags.length && !hTxt) return '<span style="color:#64748B">-</span>';
  return tags.join('') + (hTxt ? '<span class="handover-txt">' + esc(hTxt) + '</span>' : '');
}

function fmtOrderDocMeta(o, L){
  const dsParts = String(o.slot.ds || '').split('/');
  const defIso = defaultStartIso().replace(/-/g, '').slice(2);
  const yymmdd = dsParts.length === 3 ? (dsParts[2].slice(-2) + dsParts[1] + dsParts[0]) : defIso;
  const shNum = String(o.slot.shift || '').replace(/\D/g, '') || '1';
  const docCode = 'LSX-' + yymmdd + '-M' + o.m + '-C' + shNum;

  const hasF = L.some(x => x.fam === 'F');
  const hasC = L.some(x => x.fam === 'C');
  const lineName = (hasF && hasC) ? 'Chuyền FINE + CHISEL' : (hasC ? 'Chuyền CHISEL' : 'Chuyền FINE');
  const mLabel = 'M' + o.m + (o.m === 4 ? ' - Dự phòng' : '');
  const dowLong = DOW_LONG[o.slot.dow] || o.slot.dow;

  const defaultRate = (typeof DTM_SPECS !== 'undefined' && DTM_SPECS.ratePerHour) ? DTM_SPECS.ratePerHour : 3360;
  const P = (lastRes && lastRes.P) ? lastRes.P : { rate: defaultRate, co: 15 };
  const rateDot = String(Math.round(P.rate || defaultRate)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const coMin = Math.round(P.co ?? 15);
  const stdSpec = rateDot + ' PC/giờ · Đổi màu: ' + coMin + ' phút/lần';

  const readyCnt = L.filter(x => !(x.jobRef && x.jobRef.pulledEarly)).length;
  const btpStatus = 'Đủ BTP ' + readyCnt + '/' + L.length + ' mã' +
    (readyCnt < L.length ? ' (Kéo sớm ' + (L.length - readyCnt) + ' mã W)' : '');

  const coCount = lastRes
    ? lastRes.segs.filter(g => g.m === o.m && g.slotIdx === o.slot.idx && g.type === 'co').length
    : (o.co > 0 ? Math.max(1, L.length - 1) : 0);

  return { docCode, lineName, mLabel, dowLong, stdSpec, btpStatus, coCount };
}

function fmtKgCell(v){
  if (v !== null && v !== undefined && Number.isFinite(Number(v))){
    return '<div class="n" style="font-weight:600">' + esc(Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })) + ' kg</div>';
  }
  return '<div class="write-box"></div>';
}

function orderHtml(o){
  const L = Object.values(o.lines);
  // Cộng trên từng dòng đã làm tròn để Tổng mục tiêu ca luôn khớp 100% với tổng các dòng trên phiếu in
  const tot = L.reduce((s, x) => s + Math.round(x.pcs), 0);
  const meta = fmtOrderDocMeta(o, L);
  const rows = L.map((x, i) => {
    const durMin = Math.max(1, Math.round(x.min));
    const durHr = (x.min / 60).toFixed(2) + 'h';
    return '<tr>' +
      '<td class="c">' + (i + 1) + '</td>' +
      '<td class="col-code">' + esc(x.code) + '</td>' +
      '<td class="col-sap">' + esc(x.sap) + '</td>' +
      '<td><div class="time-slot">' + esc(x.timeWin || o.slot.time) + '</div><div class="time-dur">' + durMin + ' phút · ' + durHr + '</div></td>' +
      '<td class="n col-target">' + N(x.pcs) + '</td>' +
      '<td class="write-cell"><div class="write-box"></div></td>' +
      '<td class="write-cell">' + fmtKgCell(x.scrapKg) + '</td>' +
      '<td class="write-cell">' + fmtKgCell(x.inkStockKg) + '</td>' +
      '<td class="write-cell">' + fmtKgCell(x.capEraserStockKg) + '</td>' +
      '<td class="note-cell">' + renderFloorNoteHtml(x, o) + '</td>' +
      '</tr>';
  }).join('');

  return '<div class="order">' +
    '<div class="oh-grid">' +
      '<div class="oh-left">' +
        '<div class="oh-org">BỘ PHẬN ĐIỀU ĐỘ SẢN XUẤT</div>' +
        '<div class="oh-title">LỆNH SẢN XUẤT THEO CA &amp; MÁY</div>' +
        '<div class="oh-meta">Máy: ' + esc(meta.mLabel + ' (' + meta.lineName + ') · ' + o.slot.shift + ' (' + o.slot.time + ') · ' + meta.dowLong + ', ' + o.slot.ds) + '</div>' +
      '</div>' +
      '<div class="oh-docbox">' +
        '<div><span class="lbl">Mã phiếu:</span><b>' + esc(meta.docCode) + '</b></div>' +
        '<div><span class="lbl">Định mức chuẩn:</span><b>' + esc(meta.stdSpec) + '</b></div>' +
        '<div><span class="lbl">Trạng thái cấp BTP:</span><b>' + esc(meta.btpStatus) + '</b></div>' +
      '</div>' +
    '</div>' +
    '<table><thead><tr>' +
      '<th class="c" style="width:4%">STT</th>' +
      '<th style="width:9%">Mã chạy</th>' +
      '<th style="width:10%">Mã SAP</th>' +
      '<th style="width:14%">Khung giờ &amp; Thời lượng</th>' +
      '<th class="n" style="width:9%">SL mục tiêu (PC)</th>' +
      '<th style="width:9%">SL đạt thực tế (PC)</th>' +
      '<th style="width:9%">NG / Phế phẩm (kg)</th>' +
      '<th style="width:9%">Vật tư chính tồn (kg)</th>' +
      '<th style="width:9%">Phụ kiện tồn (kg)</th>' +
      '<th style="width:18%">Ghi chú kỹ thuật &amp; Bàn giao ca</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="ofoot-summary">' +
      '<span>Tổng số mã chạy: <b>' + L.length + ' mã (' + meta.coCount + ' lần đổi màu = ' + Math.round(o.co) + ' phút)</b></span>' +
      '<span>Tổng mục tiêu ca: <b>' + N(tot) + ' PC</b></span>' +
      '<span>Tổng đạt thực tế: <b>.................... PC</b></span>' +
      '<span>Tổng NG: <b>............ kg</b></span>' +
    '</div>' +
    '<div class="ofoot-sign">' +
      '<div class="ofoot-sign-col"><div><div class="ofoot-sign-title">Người lập lệnh (Điều độ)</div><div class="ofoot-sign-sub">(Ký và ghi rõ họ tên)</div></div><div class="ofoot-sign-space"></div></div>' +
      '<div class="ofoot-sign-col"><div><div class="ofoot-sign-title">Tổ trưởng ca nhận lệnh</div><div class="ofoot-sign-sub">(Ký và ghi rõ họ tên)</div></div><div class="ofoot-sign-space"></div></div>' +
      '<div class="ofoot-sign-col"><div><div class="ofoot-sign-title">Quản lý sản xuất duyệt</div><div class="ofoot-sign-sub">(Ký và ghi rõ họ tên)</div></div><div class="ofoot-sign-space"></div></div>' +
    '</div>' +
  '</div>';
}

function orderText(o){
  const L = Object.values(o.lines);
  const tot = L.reduce((s, x) => s + Math.round(x.pcs), 0);
  const meta = fmtOrderDocMeta(o, L);
  const fmtKgTxt = v => (v !== null && v !== undefined && Number.isFinite(Number(v))) ? (Number(v) + ' kg') : '...... kg';
  return 'LỆNH SẢN XUẤT THEO CA & MÁY · Mã phiếu: ' + meta.docCode + '\n' +
    'Máy: ' + meta.mLabel + ' (' + meta.lineName + ') · ' + o.slot.shift + ' (' + o.slot.time + ') · ' + meta.dowLong + ', ' + o.slot.ds + '\n' +
    'Định mức chuẩn: ' + meta.stdSpec + ' · ' + meta.btpStatus + '\n' +
    L.map((x, i) => {
      const durMin = Math.max(1, Math.round(x.min));
      const durHr = (x.min / 60).toFixed(2) + 'h';
      return (i + 1) + '. ' + x.code + ' | SAP ' + x.sap + ' | ' + (x.timeWin || o.slot.time) + ' (' + durMin + ' phút · ' + durHr + ') | Mục tiêu: ' + N(x.pcs) + ' PC' +
        ' | SL đạt thực tế (PC): ...... | NG / Phế phẩm (kg): ' + fmtKgTxt(x.scrapKg) +
        ' | Vật tư chính tồn (kg): ' + fmtKgTxt(x.inkStockKg) + ' | Phụ kiện tồn (kg): ' + fmtKgTxt(x.capEraserStockKg) +
        ' | Ghi chú: ' + fmtShiftHandover(x, o.slot.ds, o.slot.idx);
    }).join('\n') +
    '\nTổng số mã chạy: ' + L.length + ' mã (' + meta.coCount + ' lần đổi màu = ' + Math.round(o.co) + ' phút) · Tổng mục tiêu ca: ' + N(tot) + ' PC · Tổng đạt thực tế: ...... PC · Tổng NG: ...... kg';
}

function renderOrders(R){
  const days = getActiveDays(R).map(d => d.ds);
  const sel = $('dayPick'), cur = selectedDay || sel.value;
  sel.innerHTML = days.map(d => '<option value="' + esc(d) + '">' + esc(d) + '</option>').join('');
  if (days.includes(cur)) sel.value = cur;
  const day = sel.value || days[0] || '';
  selectedDay = day;
  const list = Object.values(R.orders)
    .filter(o => o.slot.ds === day && Object.keys(o.lines || {}).length > 0)
    .sort((a, b) => a.slot.idx - b.slot.idx || a.m - b.m);
  if (!list.length){
    const msg = (!R.slots || !R.slots.length)
      ? 'Chưa bật ca làm việc nào (Ca 1/2/3 đều tắt) nên không có lệnh sản xuất.'
      : ((!R.jobs || !R.jobs.length) ? EMPTY_DATA_NOTE : 'Không có lệnh cho ngày này.');
    $('orders').innerHTML = '<p class="note">' + esc(msg) + '</p>';
    lastTxt = '';
    return;
  }
  $('orders').innerHTML = list.map(o => orderHtml(o)).join('');
  lastTxt = list.map(o => orderText(o)).join('\n\n');
}

function selectDayAndSync(day, forceDayTab){
  if (!lastRes || !day) return;
  selectedDay = day;
  if (forceDayTab) ganttMode = 'day';
  if ($('dayPick')) $('dayPick').value = day;
  renderOrders(lastRes);
  renderGantt(lastRes);
  syncControlStates(lastRes);
}

function run(){
  try {
    lastRes = simulate(readParams());
    lastRunError = '';
  } catch (e) {
    // Giữ nguyên dữ liệu hiện tại nếu mô phỏng gặp lỗi
    console.error(e);
    const msg = 'Lỗi lập lịch: ' + ((e && e.message) || e) + '. Dữ liệu hiện tại được GIỮ NGUYÊN — hãy kiểm tra lại file nhập hoặc bấm "Xóa dữ liệu".';
    if (msg !== lastRunError){
      lastRunError = msg;
      alert(msg);
    }
    if ($('dataInfo')) $('dataInfo').textContent = '⚠ ' + msg;
    syncControlStates(lastRes);
    return;   // giữ nguyên kết quả hợp lệ gần nhất trên màn hình
  }
  renderSourceBadges();
  renderSidebarMachines(lastRes);
  renderKpis(lastRes);
  renderOrders(lastRes);
  renderGantt(lastRes);
  renderSkus(lastRes);
  syncControlStates(lastRes);
}

const PRE = {
  two:   {m: 3, on: [1, 1, 0], ready: false},
  cur:   {m: 3, on: [1, 1, 1], ready: false},
  four:  {m: 4, on: [1, 1, 1], ready: false},
  ready: {m: 3, on: [1, 1, 1], ready: true}
};
function applyPreset(k){
  const p = PRE[k];
  if (!p) return;
  $('machines').value = p.m;
  [1, 2, 3].forEach(i => { $('on' + i).checked = !!p.on[i - 1]; });
  $('onlyReady').checked = p.ready;
  // Đồng bộ bộ lọc bảng SKU với nút preset "Chỉ R+Y"
  if (p.ready){
    SKU_FILTER.st = 'ry';
  } else if (SKU_FILTER.st === 'ry'){
    SKU_FILTER.st = 'all';
  }
  syncFilterUi();
  saveUiPrefs();
  run();
}

function normTxt(v){
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/\s+/g, ' ').toUpperCase().trim();
}

function parseNumStrict(v){
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = String(v ?? '').trim().replace(/\s+/g, '');
  if (!s) return NaN;
  const hasDot = s.includes('.'), hasComma = s.includes(',');
  if (hasDot && hasComma){
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (hasComma){
    s = /^-?[1-9]\d{0,2}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (hasDot && /^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)){
    s = s.replace(/\./g, '');
  }
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function numVal(v){
  const n = parseNumStrict(v);
  return Number.isFinite(n) ? n : 0;
}

function addDaysIso(iso, days){
  const d = new Date((iso || defaultStartIso()) + 'T00:00:00');
  const skipSun = $('skipSun') ? $('skipSun').checked : true;
  let rem = Math.max(0, Math.round(days));
  // Khớp với addWorkingDaysOffset trong engine.js khi ngày bắt đầu là Chủ nhật (nghỉ)
  if (skipSun && d.getDay() === 0){
    d.setDate(d.getDate() + 1);
  }
  while (rem > 0){
    d.setDate(d.getDate() + 1);
    if (skipSun && d.getDay() === 0) continue;
    rem--;
  }
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

function isValidYmd(y, m, d){
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d;
}

function toIsoDate(v){
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())){
    const y = v.getFullYear(), m = v.getMonth() + 1, d = v.getDate();
    return isValidYmd(y, m, d)
      ? y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')
      : null;
  }
  if (typeof v === 'number' && typeof XLSX !== 'undefined' && XLSX.SSF){
    // Chỉ chấp nhận số serial Excel hợp lệ từ năm 2000 (36526) đến năm 2100 (73415), tránh số rác như 15 -> 1900-01-15
    if (!Number.isFinite(v) || v < 36526 || v > 73415) return null;
    const d = XLSX.SSF.parse_date_code(v);
    if (d && isValidYmd(d.y, d.m, d.d)){
      return d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0');
    }
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  // ISO YYYY-MM-DD hoặc YYYY-MM-DD HH:mm:ss / YYYY-MM-DDTHH:mm:ss (kiểm tra ngày lịch thật, chặn 2026-02-31, 2026-13-45)
  const isoM = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+\-]\d{2}:?\d{2})?)?$/);
  if (isoM){
    const y = Number(isoM[1]), mo = Number(isoM[2]), da = Number(isoM[3]);
    return isValidYmd(y, mo, da)
      ? y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0')
      : null;
  }
  // Hỗ trợ dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (SAP) kèm tùy chọn giờ phía sau
  const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2}|\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (m){
    const da = Number(m[1]), mo = Number(m[2]);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isValidYmd(y, mo, da)
      ? y + '-' + String(mo).padStart(2, '0') + '-' + String(da).padStart(2, '0')
      : null;
  }
  return null;
}

function matchColInRows(rows, startRow, endRow, patterns, fallback, exclude){
  const hi = Math.min(endRow, rows.length - 1);
  for (const p of patterns){
    for (let r = hi; r >= startRow; r--){
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++){
        const txt = normTxt(row[c]);
        if (!txt) continue;
        if (exclude && exclude.some(ex => txt.includes(ex))) continue;
        if (p.startsWith('=') ? txt === p.slice(1) : txt.includes(p)) return c;
      }
    }
  }
  return fallback;
}

function findColByHeader(rows, headerEndRow, patterns, fallback){
  return matchColInRows(rows, 0, headerEndRow, patterns, fallback);
}

function isInvalidCodeCell(code){
  if (!code) return true;
  const t = normTxt(code);
  return t.startsWith('#') || /^(TONG|TOTAL|CONG|SUBTOTAL|STT|MA CHAY|MA MAU|GHI CHU)/.test(t);
}

function inferStatusAndDelay(stTxt, btpTxt, doneQty){
  const a = normTxt(stTxt), b = normTxt(btpTxt);
  const full = (a + ' ' + b).trim();
  if (/^R$|\bR\b|2\.\s*DANG CHAY|DANG CHAY/.test(a) || /^2\./.test(a)){
    return { st: 'R', delay: 0, hasExplicitDelay: false, known: true, fromDone: false };
  }
  // Ghi rõ chờ BTP (W / Chờ BTP / Thiếu / 4A-4C) luôn thắng "đã SX > 0": mã chạy dở nhưng hết BTP vẫn phải chờ
  if (/^W$|\bW\b|4\.\s*CHO|CHO DONG BO|CHO BTP|4[A-C]\.|^THIEU/.test(full) || /^4\b/.test(a)){
    let delay = 0, hasExplicitDelay = false;
    if (/4A\.|CHO RUT/.test(b)){ delay = 1; hasExplicitDelay = true; }
    else if (/4B\.|4C\.|CHO IN|CHO DONG NAP/.test(b)){ delay = 2; hasExplicitDelay = true; }
    else if (/CAN|IC|INCOMING/.test(b)){ delay = 3; hasExplicitDelay = true; }
    else if (/TAY|NAP|IR/.test(b)){ delay = 2; hasExplicitDelay = true; }
    else if (/MUC|NGOI/.test(b)){ delay = 1; hasExplicitDelay = true; }
    return { st: 'W', delay, hasExplicitDelay, known: true };
  }
  // Đã lắp được một phần và không ghi chờ BTP -> đang chạy dở
  if (doneQty > 0){
    return { st: 'R', delay: 0, hasExplicitDelay: false, known: true, fromDone: true };
  }
  // known = false: ô trạng thái trống hoặc ghi nội dung app không nhận ra -> coi là Đủ BTP (Y).
  // Quy ước xưởng (21/11/2026): file có cột "SL còn phải lắp" = đã đủ BTP, nên mã không ghi chờ BTP được đưa vào lịch.
  const knownY = /^Y$|\bY\b|DU BTP|SAN SANG|^3\./.test(a);
  return { st: 'Y', delay: 0, hasExplicitDelay: false, known: knownY };
}

// ===== File kế hoạch sản xuất (1 dòng = 1 mã chạy). Cột bắt buộc: Mã chạy, SL còn phải lắp. File không có dòng tiêu đề đọc theo thứ tự: Mã chạy, Mã SAP, SL, Cấp ưu tiên, Dòng bút, Trạng thái, Ngày đủ BTP, Hạn PO, Gắn máy, (Ghi chú), STT =====
function parseSttCell(v){
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
  const s = String(v ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= 0 ? n : null;
}

function parseBtpSheet(ws){
  const map = {};
  if (!ws) return map;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const colCode = findColByHeader(rows, 5, ['MA CHAY', 'MA MAU'], 1);
  const colSt = findColByHeader(rows, 5, ['TRANG THAI', 'TINH TRANG', 'DU BTP'], -1);
  const cIc = findColByHeader(rows, 5, ['CAN', 'IC'], -1);
  const cIn = findColByHeader(rows, 5, ['INCOMING', 'CHUA VE'], -1);
  const cSub = findColByHeader(rows, 5, ['TAY', 'NAP', 'IR'], -1);
  const cMat = findColByHeader(rows, 5, ['MUC', 'NGOI', 'ONG TO'], -1);
  for (let r = 6; r < rows.length; r++){
    const row = rows[r] || [];
    const code = String(row[colCode] ?? '').trim();
    if (isInvalidCodeCell(code)) continue;
    const rowText = normTxt(row.join(' '));
    let ready = true, delay = 0;
    const isLack = col => col >= 0 && (numVal(row[col]) < 0 || /THIEU|NO|CHUA|\bW\b|^#/.test(normTxt(row[col])));
    if (colSt >= 0 && (/\bW\b|THIEU|CHUA|^#/.test(normTxt(row[colSt])))) ready = false;
    if (isLack(cIc) || isLack(cIn)){ ready = false; delay = Math.max(delay, 3); }
    if (isLack(cSub)){ ready = false; delay = Math.max(delay, 2); }
    if (isLack(cMat)){ ready = false; delay = Math.max(delay, 1); }
    if (!ready && delay === 0){
      delay = /CAN|IC|INCOMING/.test(rowText) ? 3 : (/TAY|NAP|IR/.test(rowText) ? 2 : 1);
    }
    map[code] = { ready, delay };
  }
  return map;
}

// Bộ gom dòng kế hoạch + kết quả kiểm tra file (hiện trong dòng ghi chú sau khi nhập)
function newPlanAcc(){
  return { list: [], metas: {}, index: new Map(), issues: { finished: 0, dup: new Set(), badDate: [], badQty: [], badStt: [], missingCols: [], unknownSt: [], noSt: 0, assumedY: 0, layout: [], badFix: [] } };
}

const ST_RANK = { R: 0, Y: 1, W: 2 };

// Trùng mã trong cùng dòng bút (vd nhiều PO): cộng SL, lấy ưu tiên cao hơn, hạn PO sớm hơn,
// trạng thái kém sẵn sàng hơn (W > Y > R) để không xếp chạy khi chưa đủ BTP.
function addPlanRow(acc, row, meta){
  const k = row[4] + ':' + row[0];
  const prev = acc.index.get(k);
  if (!prev){
    acc.index.set(k, row);
    acc.list.push(row);
    acc.metas[k] = meta;
    return;
  }
  acc.issues.dup.add(row[0]);
  const pm = acc.metas[k];
  prev[2] += row[2];
  prev[3] = Math.min(prev[3], row[3]);
  if (meta.due_date && (!pm.due_date || meta.due_date < pm.due_date)) pm.due_date = meta.due_date;
  if (meta.fixedMachine && !pm.fixedMachine) pm.fixedMachine = meta.fixedMachine;
  if (meta.stt != null && (pm.stt == null || meta.stt < pm.stt)) pm.stt = meta.stt;
  const lessReady = ST_RANK[row[5]] > ST_RANK[prev[5]];
  const bothW = row[5] === 'W' && prev[5] === 'W';
  if (lessReady){
    prev[5] = row[5];
    pm.btp_ready_date = meta.btp_ready_date;
    pm.btp_delay = meta.btp_delay;
    pm.btp_custom = meta.btp_custom;
  } else if (bothW){
    // Không bao giờ để giả định/suy luận ghi đè ngày đủ BTP đã chỉ định rõ (btp_custom = true)
    if (meta.btp_custom && !pm.btp_custom){
      pm.btp_ready_date = meta.btp_ready_date;
      pm.btp_delay = 0;
      pm.btp_custom = true;
    } else if (meta.btp_custom && pm.btp_custom){
      if ((meta.btp_ready_date || '') > (pm.btp_ready_date || '')){
        pm.btp_ready_date = meta.btp_ready_date;
      }
    } else if (!meta.btp_custom && !pm.btp_custom){
      if ((meta.btp_delay || 0) > (pm.btp_delay || 0) || (meta.btp_ready_date || '') > (pm.btp_ready_date || '')){
        pm.btp_ready_date = meta.btp_ready_date;
        pm.btp_delay = meta.btp_delay;
      }
    }
  }
}

// Số dòng Excel (1-based) của phần tử rows[r] lấy từ sheet_to_json
function excelRowNo(ws, r){
  try { return XLSX.utils.decode_range(ws['!ref']).s.r + r + 1; } catch (e) { return r + 1; }
}

// Ô ngày có nội dung nhưng không đọc được -> ghi nhận để cảnh báo
function checkDateCell(acc, raw, iso, label, ws, r){
  if (raw !== '' && raw != null && !iso) acc.issues.badDate.push('dòng ' + excelRowNo(ws, r) + ' ' + label);
}

function parsePlanSheet(ws, fam, btpMap, startIso){
  const acc = newPlanAcc();
  if (!ws) return { list: acc.list, metas: acc.metas, has: { due: false, fix: false, stt: false }, issues: acc.issues };
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const colStt = findColByHeader(rows, 2, ['=STT', 'STT MA', 'STT (0', 'SO THU TU'], 0);
  const colRem = findColByHeader(rows, 2, ['SL CON PHAI LAP', 'CON PHAI LAP', 'CON LAI'], 9);
  const colDue = findColByHeader(rows, 2, ['DUE DATE', 'NGAY GIAO', 'HAN PO'], -1);
  const colAlert = findColByHeader(rows, 2, ['CANH BAO TIEN DO', 'HANH DONG UU TIEN'], -1);
  const colSt = findColByHeader(rows, 2, ['=TRANG THAI', '=STATUS', 'TRANG THAI VAT TU', 'TRANG THAI', 'STATUS'], -1);
  const colDone = findColByHeader(rows, 2, ['LUY KE DA SX', 'SL DA LAP', 'DA LAP', 'DA SX'], -1);
  const colPriNum = findColByHeader(rows, 2, ['THU TU UU TIEN', 'CAP UU TIEN'], -1);
  const remHdrFound = findColByHeader(rows, 2, ['SL CON PHAI LAP', 'CON PHAI LAP', 'CON LAI'], -1) >= 0;
  // has: file có cột nào (cột không có -> giữ thông tin đã nhập trong app khi gộp)
  const has = { due: colDue >= 0, fix: false, stt: colStt >= 0 };
  let seqStt = 0;
  for (let r = 3; r < rows.length; r++){
    const row = rows[r] || [];
    const code = String(row[1] ?? '').trim();
    const sap = String(row[2] ?? '').trim();
    const pri1 = numVal(row[4]);
    const pri2 = numVal(row[5]);
    if (isInvalidCodeCell(code) || sap.startsWith('#')) continue;
    const rawRemCell = row[colRem];
    const remRaw = parseNumStrict(rawRemCell);
    if (Number.isNaN(remRaw)){
      if (String(rawRemCell ?? '').trim() !== '') acc.issues.badQty.push(code + ' (' + String(rawRemCell).trim() + ')');
      continue;
    }
    const rem = Math.round(remRaw);
    if (rem < 0){ acc.issues.badQty.push(code + ' (' + rem + ')'); continue; }
    if (rem === 0){ acc.issues.finished++; continue; }
    const rawSttCell = colStt >= 0 ? row[colStt] : '';
    const parsedStt = colStt >= 0 ? parseSttCell(rawSttCell) : null;
    if (colStt >= 0 && parsedStt === null && String(rawSttCell ?? '').trim() !== ''){
      acc.issues.badStt.push(code + ' (' + String(rawSttCell).trim() + ')');
    }
    const stt = parsedStt !== null ? parsedStt : seqStt;
    seqStt++;
    const pNum = colPriNum >= 0 ? Math.round(numVal(row[colPriNum])) : 0;
    const pri = (pNum >= 1 && pNum <= 3) ? pNum : (pri1 > 0 ? 1 : (pri2 > 0 ? 2 : 2));
    const alertTxt = colAlert >= 0 ? String(row[colAlert] ?? '') : '';
    const stCellTxt = colSt >= 0 ? String(row[colSt] ?? '') : '';
    const doneQty = colDone >= 0 ? numVal(row[colDone]) : 0;
    const inf = inferStatusAndDelay(alertTxt || stCellTxt, stCellTxt, doneQty);
    let st = inf.st, btpDate = null, btpDelay = 0;
    if (st === 'R' && !inf.fromDone){
      btpDate = null;
    } else if (btpMap[code] && !btpMap[code].ready){
      // Sheet đồng bộ BTP báo thiếu -> chờ BTP, kể cả mã đã lắp dở (chỉ mã ghi rõ "Đang chạy" mới giữ R)
      st = 'W';
      btpDelay = btpMap[code].delay || 0;
      btpDate = btpDelay > 0 ? addDaysIso(startIso, btpDelay) : null;
    } else if (st === 'W' && inf.hasExplicitDelay && inf.delay > 0){
      btpDelay = inf.delay;
      btpDate = addDaysIso(startIso, btpDelay);
    }
    const dueIso = colDue >= 0 ? toIsoDate(row[colDue]) : null;
    if (colDue >= 0) checkDateCell(acc, row[colDue], dueIso, 'Hạn PO', ws, r);
    addPlanRow(acc, [code, sap || code, rem, pri, fam, st],
      { stt, sttCustom: false, btp_ready_date: btpDate, btp_delay: btpDelay, btp_custom: false, due_date: dueIso, fixedMachine: null });
  }
  // Sheet tên LR BÚT FINE/CHISEL nhưng khác bố cục (vd file điều độ dạng STT | Mã sản phẩm | Sản lượng cần sản xuất):
  // không đọc được mã nào và không có tiêu đề "SL còn phải lắp" -> báo rõ thay vì lỗi chung chung
  if (!acc.list.length && !remHdrFound){
    acc.issues.layout.push('Sheet ' + (fam === 'C' ? 'LR BÚT CHISEL' : 'LR BÚT FINE') + ' không có cột "SL còn phải lắp" ở dòng tiêu đề (3 dòng đầu) — không đọc được');
  }
  return { list: acc.list, metas: acc.metas, has, issues: acc.issues };
}

function parseFlatCsvSheet(ws, fileName, startIso, forcedFam){
  const acc = newPlanAcc();
  if (!ws) return { list: acc.list, metas: acc.metas, has: { due: false, fix: false, stt: false }, issues: acc.issues };
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  let hdrRow = -1;
  for (let r = 0; r <= Math.min(5, rows.length - 1); r++){
    const line = normTxt((rows[r] || []).join(' | '));
    if ((line.includes('MA CHAY') || line.includes('MA MAU') || line.includes('MA SAN PHAM') || line.includes('CODE')) &&
        (line.includes('SL') || line.includes('CON PHAI LAP') || line.includes('CON LAI') || line.includes('SAP'))){
      hdrRow = r;
      break;
    }
  }
  const noHdr = hdrRow < 0;
  const colAt = (patterns, fb, exclude) => noHdr ? fb : matchColInRows(rows, hdrRow, hdrRow, patterns, fb, exclude);
  const cStt    = colAt(['=STT', 'STT MA', 'STT (0', 'SO THU TU'], noHdr ? 10 : -1);
  // Khi file có dòng tiêu đề, KHÔNG rơi về vị trí 0/1/2 nếu thiếu cột (tránh đọc nhầm STT/Ngày thành Mã SAP hoặc SL)
  const cCode   = colAt(['MA CHAY', 'MA MAU', 'MA SAN PHAM', 'CODE', '=SKU'], noHdr ? 0 : -1);
  const cSap    = colAt(['MA SAP', '=SAP', 'SAP CODE', 'SAP_CODE'], noHdr ? 1 : -1, ['SAP XEP', 'SAP_XEP']);
  const cName   = colAt(['TEN BUT', 'TEN SAN PHAM', 'TEN MA'], -1);
  const cRem    = colAt(['SL CON PHAI LAP', 'CON PHAI LAP', 'CON LAI', 'SL (PC)', '=SL', 'QTY', 'SO LUONG'], noHdr ? 2 : -1, ['TON']);
  const cDone   = colAt(['LUY KE DA SX', 'SL DA LAP', 'DA LAP', 'DA SX'], -1);
  // Cột cấp ưu tiên 1/2/3 (bao gồm "Ưu tiên", "Pri", "Priority" và cột 3 khi không tiêu đề)
  const cPriNum = colAt(['THU TU UU TIEN', 'CAP UU TIEN', 'MUC UU TIEN', '=UU TIEN', '=UT', '=PRI', 'PRIORITY'], noHdr ? 3 : -1);
  // Cột sản lượng kế hoạch ưu tiên (tương thích bảng tính có cột KH ưu tiên dạng số lượng)
  const cPri1   = noHdr ? -1 : colAt(['KE HOACH UU TIEN', 'KH UU TIEN'], -1, ['BTP CHUNG']);
  const cPri2   = noHdr ? -1 : colAt(['KE HOACH CHUAN', 'KH CHUAN'], -1);
  const cFam    = colAt(['=DONG', '=DONG BUT', 'DONG BUT', 'DONG SAN PHAM', 'LOAI BUT', 'FAMILY', '=HO', '=FAM'], noHdr ? 4 : -1, ['DONG BO', 'BTP CHUNG']);
  const cAlert  = colAt(['CANH BAO TIEN DO', 'HANH DONG UU TIEN'], -1);
  const cSt     = colAt(['=TRANG THAI', '=TINH TRANG', '=STATUS', '=ST', 'TRANG THAI VAT TU', 'TRANG THAI', 'TINH TRANG', 'STATUS'], noHdr ? 5 : -1);
  const cBtp    = colAt(['NGAY DU BTP', 'BTP_READY', 'NGAY BTP'], noHdr ? 6 : -1);
  const cDue    = colAt(['HAN PO', 'DUE DATE', 'DUE_DATE', 'NGAY GIAO'], noHdr ? 7 : -1);
  const cFix    = colAt(['GAN MAY', 'MAY CO DINH', 'FIXED'], noHdr ? 8 : -1);

  if (!noHdr && (cCode < 0 || cRem < 0)){
    if (cCode < 0) acc.issues.missingCols.push('Mã chạy');
    if (cRem < 0) acc.issues.missingCols.push('SL còn phải lắp');
    return { list: acc.list, metas: acc.metas, has: { due: false, fix: false, stt: false }, issues: acc.issues };
  }
  // Quy ước xưởng: file có cột "SL còn phải lắp" = các mã trong file đã đủ BTP (trừ mã ghi rõ chờ BTP)
  const remIsConPhaiLap = !noHdr && normTxt((rows[hdrRow] || [])[cRem]).includes('CON PHAI LAP');

  const bannerTxt = normTxt(fileName + ' ' + rows.slice(0, Math.max(1, hdrRow)).map(r => (r || []).join(' ')).join(' '));
  const defFam = forcedFam || (bannerTxt.includes('CHISEL') && !bannerTxt.includes('LR BUT FINE') ? 'C' : (normTxt(fileName).includes('CHISEL') ? 'C' : 'F'));

  const seqByFam = { F: 0, C: 0 };
  for (let r = (noHdr ? 0 : hdrRow + 1); r < rows.length; r++){
    const row = rows[r] || [];
    const code = String(row[cCode] ?? '').trim();
    const rawSap = cSap >= 0 ? String(row[cSap] ?? '').trim() : '';
    // Bỏ qua dòng có lỗi công thức Excel (#N/A, #REF!, #VALUE!) ở cột Mã chạy hoặc Mã SAP
    if (isInvalidCodeCell(code) || rawSap.startsWith('#')) continue;
    const sap = rawSap || code;
    const rawRemCell = row[cRem];
    const remRaw = parseNumStrict(rawRemCell);
    if (Number.isNaN(remRaw)){
      if (String(rawRemCell ?? '').trim() !== '') acc.issues.badQty.push(code + ' (' + String(rawRemCell).trim() + ')');
      continue;
    }
    const rem = Math.round(remRaw);
    if (rem < 0){ acc.issues.badQty.push(code + ' (' + rem + ')'); continue; }
    if (rem === 0){ acc.issues.finished++; continue; }

    let pri = 2;
    const pNum = cPriNum >= 0 ? Math.round(numVal(row[cPriNum])) : 0;
    if (pNum >= 1 && pNum <= 3){
      pri = pNum;
    } else if (cPri1 >= 0){
      const v1 = numVal(row[cPri1]);
      if (v1 > 0) pri = 1;
      else if (cPri2 >= 0 && numVal(row[cPri2]) > 0) pri = 2;
    }

    const famTxt = cFam >= 0 ? normTxt(row[cFam]) : '';
    const nameTxt = cName >= 0 ? normTxt(row[cName]) : '';
    let fam = defFam;
    if (/^C|CHISEL/.test(famTxt)){
      fam = 'C';
    } else if (/^F|FINE/.test(famTxt)){
      fam = 'F';
    } else if (nameTxt.includes('CHISEL')){
      fam = 'C';
    } else if (nameTxt.includes('FINE')){
      fam = 'F';
    }

    const rawSttCell = cStt >= 0 ? row[cStt] : '';
    const parsedStt = cStt >= 0 ? parseSttCell(rawSttCell) : null;
    if (cStt >= 0 && parsedStt === null && String(rawSttCell ?? '').trim() !== ''){
      acc.issues.badStt.push(code + ' (' + String(rawSttCell).trim() + ')');
    }
    const stt = parsedStt !== null ? parsedStt : seqByFam[fam];
    seqByFam[fam]++;

    const doneQty = cDone >= 0 ? numVal(row[cDone]) : 0;
    const alertTxt = cAlert >= 0 ? String(row[cAlert] ?? '') : '';
    const stCellTxt = cSt >= 0 ? String(row[cSt] ?? '') : '';
    const inf = inferStatusAndDelay(alertTxt || stCellTxt, stCellTxt, doneQty);
    const st = inf.st;
    if (!inf.known){
      if (remIsConPhaiLap) acc.issues.assumedY++;
      else if (normTxt(alertTxt || stCellTxt)) acc.issues.unknownSt.push(code);
      else acc.issues.noSt++;
    }
    const explicitBtp = cBtp >= 0 ? toIsoDate(row[cBtp]) : null;
    if (cBtp >= 0) checkDateCell(acc, row[cBtp], explicitBtp, 'Ngày đủ BTP', ws, r);
    // Chỉ lưu btp_delay khi file có mã trì hoãn rõ ràng (4A/4B/4C/cấu phần); mã W mặc định để trống để tự chạy theo ô #waitDays
    let btpDelay = 0, btpDate = null, btpCustom = false;
    if (st === 'W'){
      if (explicitBtp){
        btpDate = explicitBtp;
        btpCustom = true;
      } else if (inf.hasExplicitDelay && inf.delay > 0){
        btpDelay = inf.delay;
        btpDate = addDaysIso(startIso, btpDelay);
      }
    }
    const dueIso = cDue >= 0 ? toIsoDate(row[cDue]) : null;
    if (cDue >= 0) checkDateCell(acc, row[cDue], dueIso, 'Hạn PO', ws, r);
    // Gắn máy: nhận M1 / M 1 / M01 / Máy 1 / Máy số 1 / 1. M4 (dự phòng) và ô không đọc được -> bỏ qua NHƯNG có cảnh báo
    const fixTxt = cFix >= 0 ? normTxt(row[cFix]) : '';
    const fmMatch = fixTxt.match(/^(?:M|MAY)?\s*(?:SO\s*)?0?([1-4])$/);
    let fixedMachine = null;
    if (fmMatch && fmMatch[1] !== '4') fixedMachine = Number(fmMatch[1]);
    else if (fmMatch) acc.issues.badFix.push(code + ' (M4 là máy dự phòng, không gắn cố định)');
    else if (fixTxt) acc.issues.badFix.push(code + ' ("' + String(row[cFix]).trim() + '")');
    addPlanRow(acc, [code, sap || code, rem, pri, fam, st],
      { stt, sttCustom: false, btp_ready_date: btpDate, btp_delay: btpDelay, btp_custom: btpCustom, due_date: dueIso, fixedMachine });
  }
  // File không có dòng tiêu đề -> app đọc theo vị trí cột. Nếu dữ liệu không giống file kế hoạch
  // (cột Mã chạy toàn số như STT, hoặc SL > 1 triệu PC như mã SAP) thì từ chối để không lập lịch trên dữ liệu rác.
  if (noHdr && acc.list.length){
    const numericCodes = acc.list.filter(r => /^\d+$/.test(String(r[0]))).length;
    const hugeQty = acc.list.filter(r => r[2] > 1000000).length;
    if (numericCodes > acc.list.length / 2 || hugeQty > 0){
      acc.issues.layout.push('Không thấy dòng tiêu đề (Mã chạy, SL còn phải lắp) và dữ liệu không giống file kế hoạch (' +
        [numericCodes ? numericCodes + ' mã chỉ toàn số' : '', hugeQty ? hugeQty + ' dòng SL > 1.000.000 PC' : ''].filter(Boolean).join(', ') +
        ') — đã hủy nhập');
      acc.list.length = 0;
      acc.metas = {};
      acc.index.clear();
    }
  }
  return { list: acc.list, metas: acc.metas, has: { due: cDue >= 0, fix: cFix >= 0, stt: cStt >= 0 }, issues: acc.issues };
}

// Tóm tắt kết quả kiểm tra file để người lập kế hoạch biết app đã hiểu file thế nào
function summarizeIssues(list){
  const all = { finished: 0, dup: new Set(), badDate: [], badQty: [], badStt: [], missingCols: [], unknownSt: [], noSt: 0, assumedY: 0, layout: [], badFix: [] };
  for (const is of list){
    if (!is) continue;
    all.finished += is.finished || 0;
    all.assumedY += is.assumedY || 0;
    if (is.layout) all.layout.push(...is.layout);
    if (is.badFix) all.badFix.push(...is.badFix);
    if (is.dup) is.dup.forEach(c => all.dup.add(c));
    if (is.badDate) all.badDate.push(...is.badDate);
    if (is.badQty) all.badQty.push(...is.badQty);
    if (is.badStt) all.badStt.push(...is.badStt);
    if (is.missingCols) all.missingCols.push(...is.missingCols);
    if (is.unknownSt) all.unknownSt.push(...is.unknownSt);
    all.noSt += is.noSt || 0;
  }
  const head = (arr, n) => arr.slice(0, n).join(', ') + (arr.length > n ? ', …' : '');
  const warn = [], info = [];
  if (all.layout.length) warn.push(...all.layout);
  if (all.missingCols.length) warn.push('Thiếu cột bắt buộc: ' + [...new Set(all.missingCols)].join(', '));
  if (all.badQty.length) warn.push(all.badQty.length + ' dòng SL âm/lỗi bị bỏ qua (' + head(all.badQty, 4) + ')');
  if (all.badStt.length) warn.push(all.badStt.length + ' mã có STT không hợp lệ, dùng thứ tự dòng (' + head(all.badStt, 4) + ')');
  if (all.unknownSt.length) warn.push(all.unknownSt.length + ' mã ghi trạng thái không rõ → coi là Y (' + head(all.unknownSt, 5) + ')');
  if (all.noSt) warn.push(all.noSt + ' mã trống trạng thái → coi là Y');
  if (all.badDate.length) warn.push(all.badDate.length + ' ô ngày sai định dạng, cần dd/mm/yyyy (' + head(all.badDate, 3) + ')');
  if (all.badFix.length) warn.push(all.badFix.length + ' ô Gắn máy không dùng được, mã sẽ tự phân máy (' + head(all.badFix, 4) + ')');
  if (all.dup.size) info.push(all.dup.size + ' mã trùng đã gộp SL (' + head([...all.dup], 5) + ')');
  if (all.finished) info.push(all.finished + ' dòng SL = 0 (đã xong) bỏ qua');
  if (all.assumedY) info.push(all.assumedY + ' mã không ghi chờ BTP → coi là đủ BTP (file có cột SL còn phải lắp)');
  return { warn, info };
}

// Tìm sheet theo tên, không phân biệt hoa/thường, dấu tiếng Việt, khoảng trắng thừa ('LR BÚT FINE ' = 'LR BUT FINE')
function findSheet(wb, name){
  const want = normTxt(name);
  const hit = (wb.SheetNames || []).find(n => normTxt(n) === want);
  return hit ? wb.Sheets[hit] : null;
}

const FAM_NAME = { F: 'FINE', C: 'CHISEL' };
const sumPcs = rows => rows.reduce((s, r) => s + Number(r[2] || 0), 0);

function fmtStamp(d){
  const p = n => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// So sánh mã cũ / mới của 1 dòng bút để báo file mới đã thay đổi gì
function diffFamRows(oldRows, newRows){
  const oldMap = new Map(oldRows.map(r => [r[0], r]));
  const newMap = new Map(newRows.map(r => [r[0], r]));
  let added = 0, removed = 0, qty = 0, st = 0;
  newMap.forEach((r, code) => {
    const o = oldMap.get(code);
    if (!o){ added++; return; }
    if (Number(o[2]) !== Number(r[2])) qty++;
    if (o[5] !== r[5]) st++;
  });
  oldMap.forEach((_, code) => { if (!newMap.has(code)) removed++; });
  return { added, removed, qty, st };
}

function importWorkbook(wb, fileName, forcedFam){
  const prevSkus = WORK_SKUS.map(r => r.slice());
  const prevMeta = JSON.parse(JSON.stringify(WORK_META));
  const prevNote = dataNote;
  const prevTrack = JSON.stringify({ a: ACTUAL_PROD, s: ACTUAL_SRC, src: DATA_SRC });
  lastImportError = '';
  try {
    const startIso = $('start').value || defaultStartIso();
    const emptyPlan = () => ({ list: [], metas: {}, has: { due: false, fix: false, stt: false } });
    const plan = { F: emptyPlan(), C: emptyPlan() };
    // Dòng bút có trong file này -> được THAY bằng dữ liệu mới nhất; dòng không có trong file -> GIỮ NGUYÊN
    const covered = new Set();
    const warnings = [];
    const fileIssues = [];
    const shF = findSheet(wb, 'LR BUT FINE');
    const shC = findSheet(wb, 'LR BUT CHISEL');
    if (shF || shC){
      if (forcedFam === 'F' && !shF){
        lastImportError = 'Bạn đang chọn "Nạp FINE", nhưng file "' + fileName + '" không có sheet LR BÚT FINE. Đã hủy để bảo vệ dữ liệu hiện tại.';
        return false;
      }
      if (forcedFam === 'C' && !shC){
        lastImportError = 'Bạn đang chọn "Nạp CHISEL", nhưng file "' + fileName + '" không có sheet LR BÚT CHISEL. Đã hủy để bảo vệ dữ liệu hiện tại.';
        return false;
      }
      if (shF && (!forcedFam || forcedFam === 'F')){
        const btpWs = findSheet(wb, 'DONG_BO_BTP_FINE');
        if (!btpWs) warnings.push('Thiếu sheet DONG_BO_BTP_FINE');
        plan.F = parsePlanSheet(shF, 'F', parseBtpSheet(btpWs), startIso);
        fileIssues.push(plan.F.issues);
        // Sheet sai bố cục -> KHÔNG thay dữ liệu FINE hiện có bằng danh sách rỗng
        if (plan.F.list.length || !plan.F.issues.layout.length) covered.add('F');
      }
      if (shC && (!forcedFam || forcedFam === 'C')){
        const btpWs = findSheet(wb, 'DONG_BO_BTP_CHISEL');
        if (!btpWs) warnings.push('Thiếu sheet DONG_BO_BTP_CHISEL');
        plan.C = parsePlanSheet(shC, 'C', parseBtpSheet(btpWs), startIso);
        fileIssues.push(plan.C.issues);
        if (plan.C.list.length || !plan.C.issues.layout.length) covered.add('C');
      }
    } else if (wb.SheetNames && wb.SheetNames.length){
      const flat = parseFlatCsvSheet(wb.Sheets[wb.SheetNames[0]], fileName, startIso, forcedFam);
      flat.list.forEach(r => {
        const fam = r[4] === 'C' ? 'C' : 'F';
        // Bảo vệ tuyệt đối dòng còn lại khi người dùng chủ động bấm "Nạp FINE" hoặc "Nạp CHISEL"
        if (forcedFam && fam !== forcedFam) return;
        plan[fam].list.push(r);
        plan[fam].metas[fam + ':' + r[0]] = flat.metas[r[4] + ':' + r[0]];
        covered.add(fam);
      });
      if (forcedFam && !plan[forcedFam].list.length){
        const otherFam = forcedFam === 'F' ? 'C' : 'F';
        if (flat.list.length > 0){
          lastImportError = 'Bạn đang chọn "Nạp ' + FAM_NAME[forcedFam] + '", nhưng file "' + fileName + '" không có mã nào thuộc ' + FAM_NAME[forcedFam] + ' (file chỉ chứa dòng ' + FAM_NAME[otherFam] + '). Đã hủy để bảo vệ dữ liệu hiện tại.';
        } else {
          const chkFail = summarizeIssues([flat.issues]);
          lastImportError = chkFail.warn.length
            ? chkFail.warn.join('; ')
            : ('Không tìm thấy mã ' + FAM_NAME[forcedFam] + ' hợp lệ có SL > 0 trong file "' + fileName + '".');
        }
        return false;
      }
      plan.F.has = plan.C.has = flat.has;
      fileIssues.push(flat.issues);
    }
    if (!plan.F.list.length && !plan.C.list.length){
      const chkFail = summarizeIssues(fileIssues);
      if (chkFail.warn.length) lastImportError = chkFail.warn.join('; ');
      return false;
    }

    const combined = [], newMeta = {}, notes = [];
    const stamp = fmtStamp(new Date());
    // Thứ tự tải file: dòng bút nạp trước chạy trước. File có cả 2 dòng: dòng xuất hiện trước trong file chạy trước.
    const baseSeq = Math.max(famSeqOf('F'), famSeqOf('C')) + 1;
    const famOrderInFile = [...covered];
    for (const fam of ['F', 'C']){
      const oldRows = WORK_SKUS.filter(r => r[4] === fam);
      if (!covered.has(fam)){
        // Dòng bút không có trong file: giữ nguyên dữ liệu mới nhất đã nạp trước đó (kể cả chỉnh sửa trong app)
        combined.push(...oldRows);
        for (const [k, v] of Object.entries(WORK_META)) if (k.startsWith(fam + ':')) newMeta[k] = v;
        if (oldRows.length){
          const src = DATA_SRC[fam];
          notes.push(FAM_NAME[fam] + ' giữ nguyên ' + (src ? 'từ "' + src.file + '" (' + src.at + ')' : 'từ kế hoạch hiện tại') +
            ': ' + oldRows.length + ' mã · ' + N(sumPcs(oldRows)) + ' PC');
        }
        continue;
      }
      const p = plan[fam];
      combined.push(...p.list);
      for (const [k, v] of Object.entries(p.metas)){
        const old = WORK_META[k];
        const m = Object.assign({}, v);
        // File không có cột này -> giữ thông tin đã nhập trong app cho mã vẫn còn trong kế hoạch
        if (!p.has.fix && old && old.fixedMachine) m.fixedMachine = old.fixedMachine;
        if (!p.has.due && old && old.due_date) m.due_date = old.due_date;
        if (!p.has.stt && old && old.sttCustom && old.stt != null){
          m.stt = old.stt;
          m.sttCustom = true;
        }
        newMeta[k] = m;
      }
      const d = diffFamRows(oldRows, p.list);
      DATA_SRC[fam] = { file: fileName, at: stamp, seq: baseSeq + famOrderInFile.indexOf(fam) * 0.5 };
      notes.push('Cập nhật ' + FAM_NAME[fam] + ' từ "' + fileName + '": ' + p.list.length + ' mã · ' + N(sumPcs(p.list)) + ' PC' +
        ' (mới ' + d.added + ' · hết ' + d.removed + ' · đổi SL ' + d.qty + ' · đổi trạng thái ' + d.st + ')');
    }

    const fReadyCodes = new Set(combined.filter(r => r[4] === 'F' && r[5] === 'Y').map(r => r[0]));
    const dupShared = combined.filter(r => r[4] === 'C' && r[5] === 'Y' && fReadyCodes.has(r[0])).map(r => r[0]);
    if (dupShared.length){
      warnings.push('Lưu ý kiểm tra 4 BTP dùng chung cho ' + dupShared.length + ' mã trùng FINE+CHISEL (' + dupShared.slice(0, 5).join(', ') + ')');
    }
    WORK_SKUS = combined;
    WORK_META = newMeta;
    ensureStableStt();
    DELETE_UNDO = null;
    hideToast();
    RUNS.length = 0;
    renderRuns();
    // Giữ lại SL thực tế nhập tay của tổ trưởng; xóa các bản ghi không phải nhập tay (nếu còn từ phiên cũ)
    for (const k of Object.keys(ACTUAL_PROD)){
      if (ACTUAL_SRC[k] !== 'manual'){
        delete ACTUAL_PROD[k];
        delete ACTUAL_SRC[k];
      }
    }
    const tot = combined.reduce((s, r) => s + r[2], 0);
    const cntR = combined.filter(r => r[5] === 'R').length;
    const cntY = combined.filter(r => r[5] === 'Y').length;
    const cntW = combined.filter(r => r[5] === 'W').length;
    const chk = summarizeIssues(fileIssues);
    warnings.push(...chk.warn);
    const infoTxt = chk.info.length ? ' Kiểm tra file: ' + chk.info.join(' · ') + '.' : '';
    const warnTxt = warnings.length ? ' ⚠ ' + warnings.join('; ') + '.' : '';
    dataNote = notes.join(' | ') + '. Tổng lịch: ' + combined.length + ' mã · ' + N(tot) + ' PC (R:' + cntR + ' · Y:' + cntY + ' · W:' + cntW + ').' + infoTxt + warnTxt;
    run();
    if (!lastRunError) saveStoredData();
    return true;
  } catch (err) {
    WORK_SKUS = prevSkus;
    WORK_META = prevMeta;
    dataNote = prevNote;
    const t = JSON.parse(prevTrack);
    ACTUAL_PROD = t.a; ACTUAL_SRC = t.s; DATA_SRC = t.src;
    run();
    return false;
  }
}

function importExcelFile(file, forcedFam){
  if (!file) return;
  if (typeof XLSX === 'undefined'){
    alert('Không tìm thấy thư viện SheetJS (lib/xlsx.full.min.js). Vui lòng kiểm tra thư mục lib/.');
    return;
  }
  const isCsv = /\.csv$/i.test(file.name);
  const reader = new FileReader();
  reader.onload = e => {
    try {
      // CSV lưu kiểu "CSV (Comma delimited)" (mã ANSI) bị đọc như UTF-8 sinh ký tự lỗi U+FFFD:
      // tiêu đề và trạng thái tiếng Việt hỏng (Chờ BTP -> không nhận ra) -> từ chối, giữ nguyên dữ liệu cũ.
      if (isCsv && String(e.target.result || '').includes(String.fromCharCode(0xFFFD))){
        alert('File CSV "' + file.name + '" không phải UTF-8 nên tiếng Việt bị lỗi. Trong Excel chọn Lưu thành → "CSV UTF-8 (Comma delimited)" rồi nhập lại (hoặc nhập trực tiếp file .xlsx). Dữ liệu hiện tại được giữ nguyên.');
        return;
      }
      // CSV: raw = true giữ nguyên text -> SheetJS không tự đổi dd/mm/yyyy theo kiểu Mỹ (mm/dd/yyyy),
      // không cắt số 0 đầu mã tham chiếu; số lượng & ngày do numVal / toIsoDate tự phân tích.
      const wb = isCsv
        ? XLSX.read(String(e.target.result || '').replace(/^\uFEFF/, ''), { type: 'string', raw: true })
        : XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      if (!importWorkbook(wb, file.name, forcedFam)){
        alert(lastImportError || 'Không đọc được mã nào có SL > 0 từ file đã chọn (hoặc dữ liệu chứa lỗi công thức).');
      }
    } catch (err) {
      alert('File Excel/CSV bị lỗi định dạng hoặc công thức hỏng (#REF!, #N/A). Hệ thống đã giữ nguyên dữ liệu an toàn trước đó.');
    }
  };
  reader.onerror = () => {
    alert('Không thể đọc file đã chọn.');
  };
  if (isCsv) reader.readAsText(file, 'utf-8');
  else reader.readAsArrayBuffer(file);
}

function buildScheduleWorkbook(R){
  const wb = XLSX.utils.book_new();
  const sheet1 = [['Ngày', 'Thứ', 'Ca', 'Khung giờ ca', 'Khung giờ dự kiến', 'Máy', 'STT', 'Mã chạy', 'Mã SAP', 'Dòng', 'SL mục tiêu ca (PC)', 'Thời gian (h)', 'Đổi màu (phút)', 'Ưu tiên', 'Trạng thái', 'Nghiệm thu & Bàn giao']];
  Object.values(R.orders).sort((a, b) => a.slot.idx - b.slot.idx || a.m - b.m).forEach(o => {
    Object.values(o.lines).forEach((ln, idx) => {
      const fam = ln.fam === 'C' ? 'CHISEL' : 'FINE';
      sheet1.push([o.slot.ds, o.slot.dow, o.slot.shift, o.slot.time, ln.timeWin || o.slot.time, 'M' + o.m, idx + 1, ln.code, ln.sap, fam, Math.round(ln.pcs), Number((ln.min / 60).toFixed(2)), Math.round(ln.coMin || 0), ln.pri, STAT[ln.st], fmtShiftHandover(ln, o.slot.ds, o.slot.idx)]);
    });
  });
  const sheet2 = [['STT', 'Mã chạy', 'Mã SAP', 'Dòng', 'SL (PC)', 'Trạng thái', 'Ngày đủ BTP', 'Hạn PO', 'Gắn máy', 'Máy chạy', 'Bắt đầu', 'Hoàn thành', 'Cảnh báo PO']];
  R.queue.concat(R.jobs.filter(j => j.excluded)).forEach((j, i) => {
    sheet2.push([i + 1, j.code, j.sap, j.fam === 'F' ? 'FINE' : 'CHISEL', j.rem0, STAT[j.st], j.btpReadyStr || '', j.dueIso || '', j.fixedMachine ? 'M' + j.fixedMachine : 'Tự động', j.owner ? 'M' + j.owner : '', j.start ? j.start.ds + ' ' + j.start.shift : '', j.end ? j.end.ds + ' ' + j.end.shift : '', poStatus(j).long]);
  });
  const finStr = (!R.jobs || !R.jobs.length) ? '–' : (R.ok && R.lastJ ? R.lastJ.end.ds + ' ' + R.lastJ.end.shift : 'Chưa xong');
  const sheet3 = [['Chỉ tiêu', 'Giá trị'], ['Cần sản xuất (PC)', R.need], ['Đã phân bổ (PC)', Math.round(R.doneTot)], ['Số mã hoàn thành', R.fin.length + '/' + R.incl.length], ['Ngày xong toàn bộ', finStr], ['Giờ đổi màu (h)', Number(R.coH.toFixed(2))], ['Hiệu suất máy (%)', Number((R.util * 100).toFixed(1))], ['Giờ máy rảnh (h)', Number(R.idleH.toFixed(2))], ['Số mã trễ PO', R.lateCount]];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet1), 'Lich_Theo_May_Ca');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet2), 'Tien_Do_Ma');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet3), 'Tong_Hop_KPI');
  return wb;
}

function exportScheduleXlsx(R){
  if (!R || typeof XLSX === 'undefined'){
    alert('Không tìm thấy thư viện SheetJS (lib/xlsx.full.min.js).');
    return;
  }
  const wb = buildScheduleWorkbook(R);
  XLSX.writeFile(wb, 'Lich_Dieu_Do_SX_' + ($('start').value || defaultStartIso()) + '.xlsx');
}

function bindGanttTooltip(){
  const tt = $('ganttTooltip');
  const ganttEl = $('gantt');
  if (!tt || !ganttEl) return;
  ganttEl.addEventListener('mousemove', e => {
    const seg = e.target.closest('[data-tt]');
    if (!seg){
      tt.style.display = 'none';
      return;
    }
    tt.innerHTML = seg.dataset.tt;
    tt.style.display = 'block';
    const pad = 14;
    let x = e.clientX + pad, y = e.clientY + pad;
    const rect = tt.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - 10) x = Math.max(8, e.clientX - rect.width - pad);
    if (y + rect.height > window.innerHeight - 10) y = Math.max(8, e.clientY - rect.height - pad);
    tt.style.left = x + 'px';
    tt.style.top = y + 'px';
  });
  ganttEl.addEventListener('mouseleave', () => {
    tt.style.display = 'none';
  });
}

function syncHeaderHeight(){
  const hdr = document.querySelector('.app-header');
  if (!hdr) return;
  const h = Math.ceil(hdr.getBoundingClientRect().height);
  if (h > 0) document.documentElement.style.setProperty('--header-h', h + 'px');
}

function copyTextWithFallback(txt){
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function'){
    return navigator.clipboard.writeText(txt).catch(() => copyTextExecCommand(txt));
  }
  return copyTextExecCommand(txt);
}

function copyTextExecCommand(txt){
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) resolve(); else reject(new Error('copy failed'));
  });
}

function triggerPrintOrders(){
  const hasDayOrders = Boolean(lastRes && selectedDay && Object.values(lastRes.orders || {}).some(o => o.slot.ds === selectedDay));
  if (!hasDayOrders){
    showToast('Chưa có lệnh sản xuất cho ngày đang chọn để in.', false);
    return;
  }
  window.print();
}

function init(){
  loadStoredData();
  if (typeof XLSX === 'undefined'){
    dataNote += ' ⚠ Không tìm thấy lib/xlsx.full.min.js — tính năng Nhập/Xuất Excel tạm khóa.';
  }

  // Đo động chiều cao thanh đầu trang để sidebar sticky không bao giờ bị che khi wrap ở 1366px
  syncHeaderHeight();
  const appHdr = document.querySelector('.app-header');
  if (typeof ResizeObserver !== 'undefined' && appHdr){
    new ResizeObserver(syncHeaderHeight).observe(appHdr);
  }
  window.addEventListener('resize', syncHeaderHeight);

  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => applyPreset(b.dataset.preset)));
  const sidebarEl = document.querySelector('aside');
  sidebarEl.addEventListener('input', () => {
    syncControlStates(lastRes);
    run();
  });
  sidebarEl.addEventListener('change', e => {
    clampSidebarInputs();
    if (e.target && e.target.id === 'onlyReady'){
      if (e.target.checked) SKU_FILTER.st = 'ry';
      else if (SKU_FILTER.st === 'ry') SKU_FILTER.st = 'all';
      syncFilterUi();
    }
    saveUiPrefs();
    if (e.target && (e.target.id === 'start' || e.target.id === 'prioritizeUrgent')){
      if (localStorage.getItem(STORE_KEY)) saveStoredData();
    }
    run();
  });
  sidebarEl.addEventListener('focusout', e => {
    if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'number'){
      clampSidebarInputs();
      saveUiPrefs();
      run();
    }
  });
  if ($('btnToggleSidebar')){
    $('btnToggleSidebar').addEventListener('click', () => {
      document.body.classList.toggle('sidebar-collapsed');
    });
  }
  if ($('btnDensity')){
    $('btnDensity').addEventListener('click', () => {
      const compact = document.body.classList.toggle('density-compact');
      $('btnDensity').textContent = compact ? 'Mật độ: Gọn' : 'Mật độ: Chuẩn';
    });
  }
  if ($('btnPrintOrders')) $('btnPrintOrders').addEventListener('click', triggerPrintOrders);
  if ($('btnPrintSlip')) $('btnPrintSlip').addEventListener('click', triggerPrintOrders);

  $('dayPick').addEventListener('change', () => {
    if (lastRes) selectDayAndSync($('dayPick').value, false);
  });
  if ($('ganttTabs')){
    $('ganttTabs').addEventListener('click', e => {
      const btn = e.target.closest('[data-gtab]');
      if (!btn) return;
      ganttMode = btn.dataset.gtab || 'day';
      if (lastRes) renderGantt(lastRes);
    });
  }
  if ($('dayPills')){
    $('dayPills').addEventListener('click', e => {
      const btn = e.target.closest('[data-day]');
      if (!btn) return;
      selectDayAndSync(btn.dataset.day, false);
    });
  }
  $('gantt').addEventListener('click', e => {
    const jump = e.target.closest('[data-jump-day]');
    if (!jump) return;
    selectDayAndSync(jump.dataset.jumpDay, true);
  });
  bindGanttTooltip();

  if ($('dailyTracker')){
    $('dailyTracker').addEventListener('change', e => {
      const inp = e.target.closest('[data-trk-key]');
      if (!inp || !lastRes) return;
      const key = inp.dataset.trkKey;
      if (String(inp.value).trim() === ''){
        delete ACTUAL_PROD[key];
        delete ACTUAL_SRC[key];
      } else {
        ACTUAL_PROD[key] = Math.max(0, Math.round(numVal(inp.value)));
        ACTUAL_SRC[key] = 'manual';
      }
      // Xóa snapshot hoàn tác cũ để tránh hoàn tác làm mất số thực tế vừa nhập tay
      DELETE_UNDO = null;
      hideToast();
      saveStoredData();
      renderDailyTracker(lastRes, selectedDay);
      renderSmallLotControls(lastRes);
    });
    $('dailyTracker').addEventListener('click', e => {
      const btn = e.target.closest('[data-trk-fill]');
      if (!btn || !lastRes) return;
      ACTUAL_PROD[btn.dataset.trkFill] = Math.max(0, Math.round(numVal(btn.dataset.plan)));
      ACTUAL_SRC[btn.dataset.trkFill] = 'manual';
      DELETE_UNDO = null;
      hideToast();
      saveStoredData();
      renderDailyTracker(lastRes, selectedDay);
      renderSmallLotControls(lastRes);
    });
  }

  $('btnImportXlsx').addEventListener('click', () => {
    pendingImportFam = null;
    $('xlsxIn').click();
  });
  if ($('btnImportFine')){
    $('btnImportFine').addEventListener('click', () => {
      pendingImportFam = 'F';
      $('xlsxIn').click();
    });
  }
  if ($('btnImportChisel')){
    $('btnImportChisel').addEventListener('click', () => {
      pendingImportFam = 'C';
      $('xlsxIn').click();
    });
  }
  $('xlsxIn').addEventListener('change', e => {
    const f = e.target.files[0];
    const famHint = pendingImportFam;
    pendingImportFam = null;
    if (f) importExcelFile(f, famHint);
    e.target.value = '';
  });
  $('btnExportXlsx').addEventListener('click', () => exportScheduleXlsx(lastRes));
  if ($('btnClearData')) $('btnClearData').addEventListener('click', clearAllData);

  if ($('skuSearch')){
    $('skuSearch').addEventListener('input', e => {
      SKU_FILTER.q = e.target.value || '';
      if (lastRes) renderSkus(lastRes);
    });
  }
  if ($('topFamFilter')){
    $('topFamFilter').addEventListener('change', e => {
      SKU_FILTER.fam = e.target.value || 'all';
      syncFilterUi();
      if (lastRes) renderSkus(lastRes);
    });
  }
  if ($('topStFilter')){
    $('topStFilter').addEventListener('change', e => {
      SKU_FILTER.st = e.target.value || 'all';
      syncFilterUi();
      if (lastRes) renderSkus(lastRes);
    });
  }
  if ($('skuFilters')){
    $('skuFilters').addEventListener('click', e => {
      const btn = e.target.closest('[data-f]');
      if (!btn) return;
      const f = btn.dataset.f || 'all';
      if (f === 'all'){
        SKU_FILTER.fam = 'all';
        SKU_FILTER.st = 'all';
      } else if (f === 'F' || f === 'C'){
        SKU_FILTER.fam = (SKU_FILTER.fam === f) ? 'all' : f;
      } else {
        SKU_FILTER.st = (SKU_FILTER.st === f) ? 'all' : f;
      }
      syncFilterUi();
      if (lastRes) renderSkus(lastRes);
    });
  }
  if ($('smallLotThreshold')){
    const refreshSl = () => { if (lastRes) renderSmallLotControls(lastRes); };
    $('smallLotThreshold').addEventListener('input', refreshSl);
    $('smallLotThreshold').addEventListener('change', refreshSl);
  }
  if ($('keepRunningOnPurge')){
    $('keepRunningOnPurge').addEventListener('change', () => { if (lastRes) renderSmallLotControls(lastRes); });
  }
  if ($('purgeFilteredOnly')){
    $('purgeFilteredOnly').addEventListener('change', () => { if (lastRes) renderSmallLotControls(lastRes); });
  }
  if ($('smallLotPresets')){
    $('smallLotPresets').addEventListener('click', e => {
      const btn = e.target.closest('[data-sl-preset]');
      if (!btn || !$('smallLotThreshold')) return;
      $('smallLotThreshold').value = btn.dataset.slPreset;
      if (lastRes) renderSmallLotControls(lastRes);
    });
  }
  if ($('btnPurgeSmallLots')) $('btnPurgeSmallLots').addEventListener('click', purgeSmallLots);
  if ($('btnUndoDelete')) $('btnUndoDelete').addEventListener('click', undoLastDelete);

  $('skus').addEventListener('click', e => {
    const btn = e.target.closest('[data-del-sku]');
    if (!btn) return;
    const key = btn.dataset.delSku;
    if (!key) return;
    const row = WORK_SKUS.find(r => (r[4] + ':' + r[0]) === key);
    if (!row) return;
    const famLbl = row[4] === 'C' ? 'CHISEL' : 'FINE';
    if (!confirm('Xác nhận xóa mã ' + row[0] + ' (' + famLbl + ' · ' + N(row[2]) + ' PC) khỏi kế hoạch hiện tại?')) return;
    removeSkusByKeys(new Set([key]), 'xóa thủ công 1 mã');
  });
  $('skus').addEventListener('change', e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const key = el.dataset.key, act = el.dataset.act;
    const [fam, ...rest] = key.split(':'), code = rest.join(':');
    if (!WORK_META[key]) WORK_META[key] = { btp_ready_date: null, due_date: null, fixedMachine: null };
    if (act === 'st'){
      const row = WORK_SKUS.find(r => r[4] === fam && r[0] === code);
      if (row) row[5] = el.value;
      if (el.value !== 'W'){
        WORK_META[key].btp_ready_date = null;
        WORK_META[key].btp_delay = 0;
        WORK_META[key].btp_custom = false;
      }
    } else if (act === 'btp'){
      WORK_META[key].btp_ready_date = el.value || null;
      WORK_META[key].btp_custom = Boolean(el.value);
      if (!el.value) WORK_META[key].btp_delay = 0;
    } else if (act === 'due'){
      WORK_META[key].due_date = el.value || null;
    } else if (act === 'fix'){
      WORK_META[key].fixedMachine = el.value ? Number(el.value) : null;
    } else if (act === 'stt'){
      const n = parseSttCell(el.value);
      if (n === null){
        const curIdx = WORK_SKUS.findIndex(r => r[4] === fam && r[0] === code);
        WORK_META[key].stt = curIdx >= 0 ? curIdx : 0;
        WORK_META[key].sttCustom = false;
      } else {
        WORK_META[key].stt = n;
        WORK_META[key].sttCustom = true;
      }
    }
    // Xóa snapshot hoàn tác cũ để tránh nhấn Hoàn tác làm mất chỉnh sửa vừa nhập
    DELETE_UNDO = null;
    hideToast();
    run();
    if (!lastRunError) saveStoredData();
  });
  $('saveRun').addEventListener('click', saveRun);
  $('clearRuns').addEventListener('click', () => { RUNS.length = 0; renderRuns(); });
  $('cmp').addEventListener('click', e => {
    const b = e.target.closest('[data-del]');
    if (b){ RUNS.splice(+b.dataset.del, 1); renderRuns(); }
  });
  $('copyTxt').addEventListener('click', () => {
    if (!lastTxt){
      showToast('Không có lệnh sản xuất để sao chép.', false);
      return;
    }
    copyTextWithFallback(lastTxt).then(() => {
      $('copyTxt').textContent = 'Đã sao chép';
      setTimeout(() => { $('copyTxt').textContent = 'Sao chép văn bản'; }, 1500);
    }).catch(() => {
      showToast('Trình duyệt chặn sao chép tự động — hãy bôi đen và Ctrl+C.', false);
    });
  });
  renderRuns();
  run();
}
init();
