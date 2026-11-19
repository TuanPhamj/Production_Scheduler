// ===== Bộ máy điều độ sản xuất Heijunka & Gantt (chạy thuần trình duyệt) =====
const STAT = {
  R: 'Đang chạy',
  Y: 'Đủ BTP',
  W: 'Chờ BTP'
};

const DOW_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const SHIFT_WINDOWS = [
  { name: 'Ca 1', startMin: 6 * 60,  time: '06:00–14:00' },
  { name: 'Ca 2', startMin: 14 * 60, time: '14:00–22:00' },
  { name: 'Ca 3', startMin: 22 * 60, time: '22:00–06:00' }
];

// Ngưỡng góc vòng tròn màu xác định 2 nhóm kề nhau (độ) · giả định
const ADJACENT_HUE_DEG = 55;
// Ngưỡng phút chạy thực tế tối thiểu ở cuối ca trước khi dời mã + đổi màu sang ca sau
const MIN_SHIFT_TAIL_MIN = 20;

function fmtDate(d){
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return dd + '/' + mm + '/' + d.getFullYear();
}

function fmtIsoDate(d){
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function fmtClockWindow(slot, startOffMin, endOffMin){
  const baseMin = (slot.startEpochMin != null ? (((slot.startEpochMin % 1440) + 1440) % 1440) : 360);
  const len = Math.max(1, slot.len || 450);
  const sOff = Math.max(0, Math.min(len, startOffMin));
  const eOff = Math.max(sOff, Math.min(len, endOffMin));
  const sMin = baseMin + Math.round(sOff);
  const eMin = baseMin + Math.round(eOff);
  const fmt = m => {
    const norm = ((m % 1440) + 1440) % 1440;
    const hh = String(Math.floor(norm / 60)).padStart(2, '0');
    const mm = String(norm % 60).padStart(2, '0');
    return hh + ':' + mm;
  };
  return fmt(sMin) + '–' + fmt(eMin);
}

function parseIsoDate(iso){
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function diffCalendarDays(targetDate, baseDate){
  const a = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
  const b = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  return Math.round((a - b) / 86400000);
}

function addWorkingDaysOffset(baseDate, workDays, skipSun){
  let rem = Math.max(0, Math.round(workDays));
  let offset = 0;
  // Nếu ngày bắt đầu rơi vào Chủ nhật (nghỉ), dịch mốc làm việc đầu tiên sang Thứ 2 trước khi cộng số ngày làm việc
  if (skipSun && baseDate.getDay() === 0){
    offset = 1;
  }
  while (rem > 0){
    offset++;
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + offset);
    if (skipSun && d.getDay() === 0) continue;
    rem--;
  }
  return offset;
}

/**
 * Tạo danh sách ca làm việc hợp lệ trong chân trời maxDays ngày.
 * Quy tắc nghỉ Chủ nhật: Ca 3 Thứ Bảy vẫn làm từ 22:00 T7 đến 06:00 sáng Chủ nhật;
 * nghỉ từ 06:00 sáng Chủ nhật đến 06:00 sáng Thứ Hai (bỏ các ca của ngày Chủ nhật).
 */
function buildSlots(P){
  const slots = [];
  let cum = 0;
  for (let dayIdx = 0; dayIdx < P.maxDays; dayIdx++){
    const d = new Date(P.start.getFullYear(), P.start.getMonth(), P.start.getDate() + dayIdx);
    const dowIdx = d.getDay();
    const ds = fmtDate(d);
    const dow = DOW_NAMES[dowIdx];
    for (let si = 0; si < P.shifts.length; si++){
      const sh = P.shifts[si];
      if (!sh.on || sh.h <= 0) continue;
      if (P.skipSun && dowIdx === 0) continue;
      // Mỗi ca nằm trong khung 8 giờ cố định -> giới hạn 8h để không tính công suất ảo (> 24h/ngày)
      const len = Math.round(Math.min(8, sh.h) * 60);
      const win = SHIFT_WINDOWS[si];
      slots.push({
        idx: slots.length,
        dayIdx,
        date: d,
        ds,
        dow,
        shift: sh.name,
        time: win.time,
        len,
        cum,
        endCum: cum + len,
        startEpochMin: dayIdx * 1440 + win.startMin
      });
      cum += len;
    }
  }
  return slots;
}

/**
 * Xây dựng bảng tra tiền tố màu (sắp theo độ dài giảm dần để BGY khớp trước BG, GG trước G).
 */
function buildColorLookup(){
  const entries = [];
  COLOR_GROUPS.forEach((grp, groupIdx) => {
    grp.prefixes.forEach((prefix, orderInGroup) => {
      entries.push({ prefix, groupIdx, groupId: grp.id, orderInGroup });
    });
  });
  entries.sort((a, b) => b.prefix.length - a.prefix.length);
  return entries;
}

const COLOR_LOOKUP = buildColorLookup();

/**
 * Phân tích mã màu thành nhóm vòng tròn màu và thứ tự nhạt → đậm.
 * Giả định độ đậm nhạt theo chữ số đầu sau tiền tố, rồi tới phần số còn lại.
 */
function parseColor(code){
  const raw = String(code || '').trim().toUpperCase();
  let matched = null;
  for (const e of COLOR_LOOKUP){
    if (e.prefix === '0' || e.prefix === '120'){
      if (raw === e.prefix || raw.startsWith(e.prefix + '-')){ matched = e; break; }
    } else if (raw.startsWith(e.prefix)){
      // Yêu cầu chữ số ngay sau tiền tố màu (^[A-Z]+\d) để tên như BLACK không khớp nhầm nhóm Blue (B)
      const after = raw.slice(e.prefix.length);
      if (/^\d/.test(after)){
        matched = e;
        break;
      }
    }
  }
  if (!matched){
    return {
      prefix: '', groupIdx: 99, groupId: 'unknown', orderInGroup: 99,
      firstDigit: 5, restNum: 0, toneScore: 5000,
      hue: -1, isDark: false, isVeryLight: false, rank: 9999999
    };
  }
  const rest = raw.slice(matched.prefix.length).replace(/\D/g, '');
  const firstDigit = matched.prefix === '0' ? 0 : (matched.prefix === '120' ? 9 : (rest.length ? parseInt(rest[0], 10) : 0));
  const restNum = rest.length > 1 ? parseInt(rest.slice(1), 10) : 0;
  const toneScore = firstDigit * 1000 + restNum;
  const hue = Object.prototype.hasOwnProperty.call(HUE, matched.prefix) ? HUE[matched.prefix] : -1;
  const isDark = matched.prefix === '120' || firstDigit >= 6;
  const isVeryLight = matched.prefix === '0' || firstDigit === 0;
  const rank = matched.groupIdx * 1000000 + matched.orderInGroup * 10000 + toneScore;
  return {
    prefix: matched.prefix,
    groupIdx: matched.groupIdx,
    groupId: matched.groupId,
    orderInGroup: matched.orderInGroup,
    firstDigit,
    restNum,
    toneScore,
    hue,
    isDark,
    isVeryLight,
    rank
  };
}

/**
 * Tính thời gian đổi màu (phút) giữa mã trước và mã sau trên cùng 1 máy.
 */
function calcChangeover(prev, next, P){
  if (!prev){
    return { min: 0, isTrans: false, isSwitch: false };
  }
  if (prev.fam !== next.fam){
    // Đổi dòng FINE <-> CHISEL tính trọn cuSwitch (60 phút), kể cả khi trùng mã màu
    return { min: Math.max(0, P.cuSwitch), isTrans: true, isSwitch: true };
  }
  if (prev.code === next.code){
    return { min: 0, isTrans: false, isSwitch: false };
  }
  if (P.coMode !== 'heijunka'){
    return { min: Math.max(0, P.co), isTrans: true, isSwitch: false };
  }

  const a = prev.color, b = next.color;
  const baseCo = Math.max(0, P.co);
  const sameCo = Math.max(0, P.coSame);
  const farCo = baseCo + Math.max(0, P.cuGroup);

  // Mã ngoài bảng màu chuẩn (unknown) -> tính định mức đổi màu chuẩn SOP (P.co), không gộp nhầm cùng nhóm 9 phút
  if (a.groupIdx === 99 || b.groupIdx === 99){
    return { min: baseCo, isTrans: true, isSwitch: false };
  }

  // Chuyển từ màu đậm/đen sang màu nhạt hoặc 0-Blender: phải súc rửa kỹ
  if (a.isDark && (b.isVeryLight || b.firstDigit <= 1)){
    return { min: farCo, isTrans: true, isSwitch: false };
  }
  // Cùng nhóm màu
  if (a.groupIdx === b.groupIdx){
    const min = b.toneScore >= a.toneScore ? sameCo : baseCo;
    return { min, isTrans: true, isSwitch: false };
  }
  // Từ nhóm màu có sắc tố quay về nhóm xám/trung tính: cần rửa sâu
  if (a.groupIdx !== 0 && b.groupIdx === 0){
    return { min: farCo, isTrans: true, isSwitch: false };
  }
  // Từ nhóm trung tính sang màu: kề nhóm (trừ khi xám đậm -> màu rất nhạt đã xử lý ở trên)
  if (a.groupIdx === 0 && b.groupIdx !== 0){
    return { min: baseCo, isTrans: true, isSwitch: false };
  }
  // Giữa 2 nhóm có sắc tố: so sánh góc trên vòng tròn màu
  if (a.hue >= 0 && b.hue >= 0){
    const diff = Math.abs(a.hue - b.hue);
    const dHue = Math.min(diff, 360 - diff);
    return { min: dHue <= ADJACENT_HUE_DEG ? baseCo : farCo, isTrans: true, isSwitch: false };
  }
  return { min: farCo, isTrans: true, isSwitch: false };
}

function mapEpochToCum(slots, epochMin){
  if (!slots.length) return Infinity;
  if (epochMin <= slots[0].startEpochMin) return 0;
  for (const s of slots){
    if (s.startEpochMin >= epochMin) return s.cum;
  }
  return Infinity;
}

function findSlotIdxAt(slots, clock){
  let lo = 0, hi = slots.length - 1;
  while (lo <= hi){
    const mid = (lo + hi) >> 1;
    const s = slots[mid];
    if (clock < s.cum) hi = mid - 1;
    else if (clock >= s.endCum) lo = mid + 1;
    else return mid;
  }
  return slots.length;
}

function compareBySortMode(a, b, machine, P){
  if (P.sortMode === 'stt'){
    if (a.stt !== b.stt) return a.stt - b.stt;
    return 0;
  }
  if (P.sortMode === 'qty'){
    if (b.rem0 !== a.rem0) return b.rem0 - a.rem0;
    return 0;
  }
  // Chế độ 'hue': vòng tròn màu Heijunka (nhạt -> đậm); khi bật SMED Heijunka ưu tiên đổi màu nhỏ nhất từ mã trước trên máy
  if (machine.lastJob && P.coMode === 'heijunka'){
    const coA = calcChangeover(machine.lastJob, a, P).min;
    const coB = calcChangeover(machine.lastJob, b, P).min;
    if (coA !== coB) return coA - coB;
  }
  if (a.color.rank !== b.color.rank) return a.color.rank - b.color.rank;
  return 0;
}

function compareJobs(a, b, machine, P){
  // Cấp 1: dòng bút FINE trước, CHISEL sau (khi bật campaign)
  if (P.campaign && a.fam !== b.fam){
    return a.fam === 'F' ? -1 : 1;
  }

  // Cấp 2: trạng thái sẵn sàng R -> Y -> W (trong nhóm W ưu tiên mã có BTP sẵn sàng sớm hơn)
  const stRank = { R: 0, Y: 1, W: 2 };
  const sA = stRank[a.st] ?? 2;
  const sB = stRank[b.st] ?? 2;
  if (sA !== sB) return sA - sB;
  if (a.origReadyCum !== b.origReadyCum) return a.origReadyCum - b.origReadyCum;

  // Cấp 3: ưu tiên mã gắn cố định đúng máy đang xét
  const fA = a.fixedMachine === machine.id ? 0 : 1;
  const fB = b.fixedMachine === machine.id ? 0 : 1;
  if (fA !== fB) return fA - fB;

  if (P.prioritizeUrgent){
    // Khi bật: ưu tiên đơn gấp (1->2->3) & hạn giao PO trước, rồi mới xếp theo sortMode
    if (a.pri !== b.pri) return a.pri - b.pri;
    if (a.dueMs !== b.dueMs) return a.dueMs - b.dueMs;
    const sm = compareBySortMode(a, b, machine, P);
    if (sm !== 0) return sm;
  } else {
    // Mặc định: áp dụng sortMode (hue/qty/stt) trước, rồi mới xét cấp ưu tiên & hạn PO
    const sm = compareBySortMode(a, b, machine, P);
    if (sm !== 0) return sm;
    if (a.pri !== b.pri) return a.pri - b.pri;
    if (a.dueMs !== b.dueMs) return a.dueMs - b.dueMs;
  }

  // Phá đồng hạng cuối cùng
  if (a.stt !== b.stt) return a.stt - b.stt;
  if (b.rem0 !== a.rem0) return b.rem0 - a.rem0;
  return a.color.rank - b.color.rank;
}

function getOrCreateOrder(orders, slot, machineId){
  const key = slot.idx + '_' + machineId;
  if (!orders[key]){
    orders[key] = { m: machineId, slot, co: 0, coByLine: {}, lines: {} };
  }
  return orders[key];
}

function markPoRisks(jobs, slots, startDate){
  const horizonEndDate = slots.length ? slots[slots.length - 1].date : startDate;
  for (const j of jobs){
    if (!(j.excluded || j.rem > 1e-6) || !Number.isFinite(j.dueMs)) continue;
    j.poRisk = true;
    // - Mã có lập lịch nhưng chưa xong tới cuối horizon: chắc chắn xong sau horizonEndDate
    // - Mã không đưa vào lịch hoặc không có ca nào bật: kiểm tra so với ngày bắt đầu
    const refDate = (j.excluded || !slots.length) ? startDate : horizonEndDate;
    const d = diffCalendarDays(refDate, new Date(j.dueMs));
    if (d > 0){
      j.isLate = true;
      j.lateDays = d;   // trễ ít nhất d ngày
    }
  }
}

function simulate(P){
  const slots = buildSlots(P);
  const maxHorizon = slots.length ? slots[slots.length - 1].endCum : 0;
  const srcSkus = Array.isArray(P.skus) ? P.skus : SKUS;
  const metaMap = P.metaMap || (typeof SKU_META === 'object' && SKU_META ? SKU_META : {});

  const jobs = srcSkus.map((row, idx) => {
    const [code, sap, rawRem, rawPri, fam, st] = row;
    const rem0 = Math.max(0, Number(rawRem) || 0);
    const pri = [1, 2, 3].includes(Number(rawPri)) ? Number(rawPri) : 2;
    const key = fam + ':' + code;
    const meta = metaMap[key] || metaMap[code] || {};
    const btpDate = parseIsoDate(meta.btp_ready_date);
    const dueDate = parseIsoDate(meta.due_date);
    const fixedMachine = (meta.fixedMachine >= 1 && meta.fixedMachine <= P.machines) ? Number(meta.fixedMachine) : null;
    const sttRaw = meta.stt;
    const stt = (sttRaw !== null && sttRaw !== undefined && sttRaw !== '' && Number.isFinite(Number(sttRaw)) && Number(sttRaw) >= 0)
      ? Math.round(Number(sttRaw))
      : idx;
    const color = parseColor(code);

    let readyCum = 0;
    let btpReadyStr = meta.btp_ready_date || '';
    if (st === 'W'){
      let offsetDays;
      if (meta.btp_custom && btpDate){
        offsetDays = Math.max(0, diffCalendarDays(btpDate, P.start));
      } else if (meta.btp_delay > 0){
        offsetDays = addWorkingDaysOffset(P.start, meta.btp_delay, P.skipSun);
        const autoD = new Date(P.start.getFullYear(), P.start.getMonth(), P.start.getDate() + offsetDays);
        btpReadyStr = fmtIsoDate(autoD);
      } else if (btpDate){
        offsetDays = Math.max(0, diffCalendarDays(btpDate, P.start));
      } else {
        offsetDays = addWorkingDaysOffset(P.start, P.waitDays, P.skipSun);
      }
      const readyEpochMin = offsetDays * 1440 + SHIFT_WINDOWS[0].startMin;
      readyCum = mapEpochToCum(slots, readyEpochMin);
    }

    const excluded = P.onlyReady && st === 'W';
    return {
      idx,
      code,
      sap,
      rem0,
      rem: excluded ? 0 : rem0,
      pri,
      fam,
      st,
      color,
      hue: color.hue,
      readyCum,
      origReadyCum: readyCum,
      btpCustom: Boolean(meta.btp_custom && btpDate),
      btpReadyStr,
      dueMs: dueDate ? dueDate.getTime() : Infinity,
      dueIso: meta.due_date || '',
      dueDateStr: dueDate ? fmtDate(dueDate) : '',
      fixedMachine,
      stt,
      sttCustom: Boolean(meta.sttCustom),
      excluded,
      isSmallLot: rem0 < (typeof DTM_SPECS !== 'undefined' ? DTM_SPECS.minLotTransfer : 5000),
      owner: null,
      start: null,
      end: null,
      endDay: 0,
      endClock: 0,
      shiftSlices: [],
      isLate: false,
      lateDays: 0,
      poRisk: false,       // có hạn PO nhưng chưa xong trong lịch / không đưa vào lịch
      pulledEarly: false   // mã W bị kéo chạy trước ngày đủ BTP (chỉ khi P.allowPullW)
    };
  });

  const incl = jobs.filter(j => !j.excluded);
  const need = incl.reduce((s, j) => s + j.rem0, 0);

  if (!slots.length || !incl.length || P.rate <= 0){
    // Vẫn đánh giá rủi ro/trễ hạn PO khi tất cả các ca đang tắt hoặc mã bị loại khỏi lịch
    markPoRisks(jobs, slots, P.start);
    const lateCount = jobs.filter(j => j.isLate || j.poRisk).length;
    return {
      P, ok: incl.length === 0, lastJ: null, need, doneTot: 0,
      incl, fin: [], coH: 0, trans: 0, fSw: 0, util: 0, idleH: 0, lateCount,
      horizon: 0, slots, segs: [], idles: [], queue: incl, jobs, orders: {}
    };
  }

  // Máy dự phòng (M4 theo DTM_SPECS.backupMachines) chỉ kích hoạt khi các máy chính vượt ngưỡng P.backupDelayMin phút
  const backupIds = new Set(
    ((typeof DTM_SPECS !== 'undefined' && Array.isArray(DTM_SPECS.backupMachines)) ? DTM_SPECS.backupMachines : ['M4'])
      .map(s => parseInt(String(s).replace(/\D/g, ''), 10))
      .filter(Number.isFinite)
  );
  const backupDelay = Math.max(0, Number(P.backupDelayMin) || 0);

  const machines = Array.from({ length: P.machines }, (_, i) => {
    const id = i + 1;
    const isBackup = backupIds.has(id);
    return {
      id,
      isBackup,
      activated: !isBackup,
      activatedAt: 0,
      clock: isBackup ? Math.min(backupDelay, maxHorizon) : 0,
      lastJob: null
    };
  });

  const remaining = incl.slice();
  const queue = [];
  const fin = [];
  const segs = [];
  const orders = {};
  const ratePerMin = P.rate / 60;

  let doneTot = 0;
  let coMinTot = 0;
  let runMinTot = 0;
  let trans = 0;
  let fSw = 0;
  let lastJ = null;
  let lastSlotIdxUsed = -1;

  // Khoảng máy rảnh kèm lý do (vẽ lên Gantt để người lập kế hoạch biết vì sao máy nghỉ)
  const idles = [];
  const slotLabelAt = c => {
    const s = slots[findSlotIdxAt(slots, c)];
    return s ? s.dow + ' ' + s.ds.slice(0, 5) + ' ' + s.shift : 'ngoài lịch';
  };
  const addIdle = (mach, from, to, kind, reason) => {
    if (to - from > 1e-6) idles.push({ m: mach.id, s: from, e: Math.min(to, maxHorizon), kind, reason });
  };
  // Máy đang ở dòng FINE chỉ chờ FINE kế tiếp (thay vì đổi sang CHISEL) nếu thời gian chờ ≤ 2 lần đổi dòng
  const switchWait = 2 * Math.max(0, Number(P.cuSwitch) || 0);
  const fits = (j, x) => !j.fixedMachine || j.fixedMachine === x.id;

  while (remaining.length > 0){
    machines.sort((a, b) => a.clock - b.clock || a.id - b.id);

    // Máy rảnh sớm nhất còn mã có thể làm (máy không còn mã phù hợp giữ nguyên clock, không bị loại vĩnh viễn)
    const m = machines.find(x => x.clock < maxHorizon && remaining.some(j => fits(j, x)));
    if (!m) break;
    const poolForM = remaining.filter(j => fits(j, m));

    // Cuốn chiếu FINE trước: chỉ ưu tiên FINE trong số mã CHẠY ĐƯỢC NGAY.
    // Không còn FINE chạy được thì chạy CHISEL đã sẵn sàng thay vì để máy nằm chờ.
    const pickReady = () => {
      const ready = poolForM.filter(j => j.readyCum <= m.clock);
      if (P.campaign && ready.length){
        const readyF = ready.filter(j => j.fam === 'F');
        if (readyF.length) return { ready: readyF };
        const nextF = poolForM.filter(j => j.fam === 'F').sort((a, b) => a.readyCum - b.readyCum)[0];
        if (nextF && m.lastJob && m.lastJob.fam === 'F' && nextF.readyCum < maxHorizon && nextF.readyCum - m.clock <= switchWait){
          return { ready: [], waitFor: nextF };
        }
      }
      return { ready };
    };

    let pick = pickReady();
    let pulledCandidate = null;
    if (!pick.ready.length && !pick.waitFor && P.allowPullW){
      // Mặc định KHÔNG kéo sớm mã W (tôn trọng ngày đủ BTP). Chỉ chọn DUY NHẤT 1 mã ứng viên khi bật P.allowPullW.
      let pullable = poolForM.filter(j => !j.btpCustom && j.readyCum > m.clock);
      if (P.campaign && pullable.some(j => j.fam === 'F')) pullable = pullable.filter(j => j.fam === 'F');
      if (pullable.length){
        const minReady = Math.min(...pullable.map(j => j.readyCum));
        const tied = pullable.filter(j => j.readyCum === minReady);
        tied.sort((a, b) => compareJobs(a, b, m, P));
        pulledCandidate = tied[0];
        pick = { ready: [pulledCandidate] };
      }
    }

    if (!pick.ready.length){
      // Không có mã chạy được ngay -> máy rảnh tới khi mã kế tiếp sẵn sàng; ghi lại lý do
      const nextJob = pick.waitFor || poolForM.slice().sort((a, b) => a.readyCum - b.readyCum)[0];
      const target = Math.min(maxHorizon, nextJob.readyCum);
      if (m.isBackup && !m.activated){
        // Máy dự phòng chưa kích hoạt: không ghi giờ rảnh chờ BTP, giữ khoảng trễ backupDelay sau mốc BTP mới
        m.clock = Math.min(maxHorizon, Math.max(target + backupDelay, m.clock + 1e-6));
        continue;
      }
      if (pick.waitFor){
        addIdle(m, m.clock, target, 'campaign',
          'Chờ mã FINE ' + nextJob.code + ' sẵn sàng (' + slotLabelAt(target) + ') để tránh đổi dòng FINE↔CHISEL 2 lần');
      } else if (nextJob.readyCum >= maxHorizon){
        addIdle(m, m.clock, target, 'none', 'Không còn mã nào chạy được trong ' + P.maxDays + ' ngày lịch (chờ BTP)');
      } else {
        addIdle(m, m.clock, target, 'btp',
          'Chờ BTP: mã sớm nhất ' + nextJob.code + (nextJob.fam === 'C' ? ' (CHISEL)' : '') + ' đủ BTP lúc ' + slotLabelAt(target));
      }
      m.clock = target;
      continue;
    }
    const eligible = pick.ready;

    eligible.sort((a, b) => compareJobs(a, b, m, P));
    const job = eligible[0];
    const coInfo = calcChangeover(m.lastJob, job, P);

    // Ngưỡng cuối ca tối thiểu 20 phút: không chẻ lô nhỏ cuối ca nếu không chạy hết được trong ca và phần chạy thực tế < 20 phút
    const minTail = Number.isFinite(Number(P.minShiftTailMin)) ? Math.max(0, Number(P.minShiftTailMin)) : MIN_SHIFT_TAIL_MIN;
    const curSlotIdx = findSlotIdxAt(slots, m.clock);
    const curSlot = slots[curSlotIdx];
    if (curSlot && minTail > 0){
      const nextSlot = slots[curSlotIdx + 1];
      const isNearShiftEnd = m.clock > curSlot.cum + 1e-6 || (nextSlot && nextSlot.len > curSlot.len);
      const remShiftMin = curSlot.endCum - m.clock;
      const needRunMin = job.rem / ratePerMin;
      const availRunMin = remShiftMin - coInfo.min;
      const canFinishInShift = (coInfo.min + needRunMin) <= remShiftMin + 1e-7;
      if (isNearShiftEnd && !canFinishInShift && availRunMin < minTail - 1e-7){
        const target = curSlot.endCum;
        if (!m.isBackup || m.activated){
          const tailTxt = availRunMin > 0
            ? 'còn ' + Math.round(availRunMin) + ' phút chạy (< ' + minTail + ' phút)'
            : 'còn ' + Math.round(remShiftMin) + ' phút (không đủ ' + Math.round(coInfo.min) + ' phút đổi màu)';
          addIdle(m, m.clock, target, 'tail',
            'Cuối ' + curSlot.shift + ' ' + tailTxt + ' — dời mã ' + job.code + ' sang ca sau để tránh chia lô nhỏ');
        }
        m.clock = target;
        continue;
      }
    }

    // Chỉ đánh dấu kéo sớm trên ĐÚNG 1 mã vừa được chốt chạy thực tế (sau khi qua kiểm tra cuối ca)
    if (pulledCandidate && job === pulledCandidate && m.clock < job.origReadyCum){
      job.pulledEarly = true;
      job.readyCum = m.clock;
    }

    if (!m.activated){
      m.activated = true;
      m.activatedAt = m.clock;
    }

    remaining.splice(remaining.indexOf(job), 1);
    queue.push(job);
    job.owner = m.id;

    // 1. Tiêu thụ thời gian đổi màu (nếu có)
    if (coInfo.isTrans) trans++;
    if (coInfo.isSwitch) fSw++;

    const lKey = job.fam + ':' + job.code;
    let coLeft = coInfo.min;
    let sIdx = findSlotIdxAt(slots, m.clock);
    while (coLeft > 1e-9 && sIdx < slots.length){
      const slot = slots[sIdx];
      const startC = Math.max(m.clock, slot.cum);
      const take = Math.min(coLeft, slot.endCum - startC);
      if (take > 1e-9){
        const offS = startC - slot.cum, offE = (startC + take) - slot.cum;
        segs.push({
          m: m.id, s: startC, e: startC + take,
          type: 'co', code: job.code, sap: job.sap, fam: job.fam, st: job.st,
          ds: slot.ds, shift: slot.shift, slotIdx: slot.idx,
          pcs: 0, coMin: Math.round(coInfo.min), timeWin: fmtClockWindow(slot, offS, offE), hue: job.hue
        });
        const coOrd = getOrCreateOrder(orders, slot, m.id);
        coOrd.co += take;
        coOrd.coByLine[lKey] = (coOrd.coByLine[lKey] || 0) + take;
        coMinTot += take;
        m.clock = startC + take;
        coLeft -= take;
        if (sIdx > lastSlotIdxUsed) lastSlotIdxUsed = sIdx;
      }
      if (m.clock >= slot.endCum - 1e-9) sIdx++;
    }

    // 2. Tiêu thụ thời gian sản xuất toàn bộ SL còn lại của mã
    let runLeft = job.rem / ratePerMin;
    sIdx = findSlotIdxAt(slots, m.clock);
    while (runLeft > 1e-9 && sIdx < slots.length){
      const slot = slots[sIdx];
      const startC = Math.max(m.clock, slot.cum);
      const take = Math.min(runLeft, slot.endCum - startC);
      if (take > 1e-9){
        const isFinalSlice = take >= runLeft - 1e-7;
        const pcsDone = isFinalSlice ? job.rem : take * ratePerMin;
        if (!job.start) job.start = { ds: slot.ds, shift: slot.shift };
        job.end = { ds: slot.ds, shift: slot.shift };
        job.endDay = slot.dayIdx;
        job.endClock = startC + take;

        const ord = getOrCreateOrder(orders, slot, m.id);
        const offS = startC - slot.cum;
        const offE = (startC + take) - slot.cum;
        const tWin = fmtClockWindow(slot, offS, offE);

        segs.push({
          m: m.id, s: startC, e: startC + take,
          type: 'run', code: job.code, sap: job.sap, fam: job.fam, st: job.st,
          ds: slot.ds, shift: slot.shift, slotIdx: slot.idx,
          pcs: pcsDone, coMin: Math.round(coInfo.min), timeWin: tWin, hue: job.hue
        });

        if (!ord.lines[lKey]){
          ord.lines[lKey] = {
            code: job.code, sap: job.sap, fam: job.fam, rem0: job.rem0,
            beforeRem: job.rem, afterRem: job.rem, pcs: 0, min: 0,
            coMin: Math.round((ord.coByLine && ord.coByLine[lKey]) || 0),
            pri: job.pri, st: job.st,
            offS, offE, timeWin: tWin, jobRef: job,
            // Các cột ghi nhận phế phẩm và vật tư tồn kho cuối ca (đơn vị: kg)
            scrapKg: null, inkStockKg: null, capEraserStockKg: null, stockUnit: 'kg'
          };
        }
        ord.lines[lKey].pcs += pcsDone;
        ord.lines[lKey].min += take;
        ord.lines[lKey].offE = offE;
        ord.lines[lKey].timeWin = fmtClockWindow(slot, ord.lines[lKey].offS, offE);
        ord.lines[lKey].afterRem = Math.max(0, job.rem - pcsDone);

        const lastSl = job.shiftSlices[job.shiftSlices.length - 1];
        if (lastSl && lastSl.slotIdx === slot.idx && lastSl.m === m.id){
          lastSl.pcs += pcsDone;
          lastSl.timeWin = ord.lines[lKey].timeWin;
        } else {
          job.shiftSlices.push({ slotIdx: slot.idx, ds: slot.ds, shift: slot.shift, m: m.id, pcs: pcsDone, timeWin: ord.lines[lKey].timeWin });
        }

        job.rem -= pcsDone;
        doneTot += pcsDone;
        runMinTot += take;
        m.clock = startC + take;
        runLeft -= take;
        if (sIdx > lastSlotIdxUsed) lastSlotIdxUsed = sIdx;
      }
      if (m.clock >= slot.endCum - 1e-9) sIdx++;
    }

    if (job.rem <= 1e-6){
      job.rem = 0;
      fin.push(job);
      lastJ = job;
      if (Number.isFinite(job.dueMs)){
        const endCal = new Date(P.start.getFullYear(), P.start.getMonth(), P.start.getDate() + job.endDay);
        const late = diffCalendarDays(endCal, new Date(job.dueMs));
        if (late > 0){
          job.isLate = true;
          job.lateDays = late;
        }
      }
    }
    m.lastJob = job;
  }

  // Loại bỏ phiếu lệnh ca chỉ có đổi màu mà không có dòng chạy nào (lines rỗng)
  for (const k of Object.keys(orders)){
    if (!Object.keys(orders[k].lines).length) delete orders[k];
  }

  // Bổ sung các mã chưa kịp bắt đầu (nếu bị cắt bởi maxDays) vào cuối queue để hiển thị
  for (const j of remaining){
    queue.push(j);
  }

  // Cảnh báo PO cho mã chưa xong trong lịch hoặc không được đưa vào lịch
  markPoRisks(jobs, slots, P.start);

  // Sắp xếp lastJ theo thời điểm kết thúc thực tế muộn nhất (dùng endClock trực tiếp, tránh trùng mã giữa FINE/CHISEL)
  if (fin.length){
    lastJ = fin.reduce((best, cur) => (!best || cur.endClock >= best.endClock ? cur : best), null);
  }

  // Makespan thực tế = điểm kết thúc segment cuối cùng (clock máy có thể bị đẩy tới maxHorizon khi chờ BTP)
  const maxClock = segs.reduce((mx, g) => Math.max(mx, g.e), 0);
  const horizon = lastSlotIdxUsed >= 0 ? slots[lastSlotIdxUsed].endCum : maxClock;
  // Loại trừ giờ máy dự phòng (M4) đang chờ tải chưa kích hoạt (0 PC) khỏi tổng giờ khả dụng để không kéo tụt hiệu suất xưởng
  const availMin = machines.reduce((sum, mach) => {
    if (!mach.activated) return sum;
    return sum + Math.max(0, maxClock - mach.activatedAt);
  }, 0);
  const idleMin = Math.max(0, availMin - runMinTot - coMinTot);
  const lateCount = jobs.filter(j => j.isLate || j.poRisk).length;

  return {
    P,
    ok: fin.length === incl.length && Math.abs(doneTot - need) < 1e-3,
    lastJ,
    need,
    doneTot,
    incl,
    fin,
    coH: coMinTot / 60,
    trans,
    fSw,
    util: availMin > 0 ? runMinTot / availMin : 0,
    idleH: idleMin / 60,
    lateCount,
    horizon,
    slots,
    segs,
    idles,
    queue,
    jobs,
    orders
  };
}
