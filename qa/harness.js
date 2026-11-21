// Bộ khung kiểm thử: nạp data.js + engine.js (bản public) vào 1 vm context, gọi simulate(P).
// Chỉ dùng dữ liệu giả lập — không chứa dữ liệu sản xuất nội bộ.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

function makeEngine(){
  const ctx = vm.createContext({ console, Math, Date, JSON, Number, String, Array, Object, Set, Map, Infinity, NaN, isFinite, parseInt, parseFloat });
  for (const f of ['data.js', 'engine.js']){
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f, timeout: 5000 });
  }
  return {
    ctx,
    simulate(P, timeoutMs = 5000){
      ctx.__P = P;
      return vm.runInContext('simulate(__P)', ctx, { timeout: timeoutMs });
    },
    call(expr, args){
      ctx.__A = args;
      return vm.runInContext(expr, ctx, { timeout: 5000 });
    },
    get(name){ return vm.runInContext(name, ctx); }
  };
}

// Tham số mặc định giống readParams() trong ui.js, nhưng rate = 3360 PC/h = 56 PC/phút (định mức xưởng 21/11/2026)
function mkP(over = {}){
  const base = {
    machines: 3,
    backupDelayMin: 480,
    shifts: [
      { name: 'Ca 1', on: true, h: 7.5 },
      { name: 'Ca 2', on: true, h: 7.5 },
      { name: 'Ca 3', on: true, h: 7.25 }
    ],
    rate: 3360,
    coMode: 'heijunka',
    co: 15, coSame: 9, cuGroup: 10, cuSwitch: 60,
    start: new Date('2026-11-23T00:00:00'), // Thứ Hai
    skipSun: true,
    waitDays: 3,
    onlyReady: false,
    allowPullW: false,
    campaign: true,
    sortMode: 'hue',
    prioritizeUrgent: false,
    minShiftTailMin: 20,
    maxDays: 60,
    skus: [],
    metaMap: {}
  };
  const P = Object.assign(base, over);
  if (over.shiftsOn){
    P.shifts = P.shifts.map((s, i) => Object.assign({}, s, { on: over.shiftsOn[i] }));
    delete P.shiftsOn;
  }
  return P;
}

// Kiểm tra bất biến trên 1 kết quả; trả về danh sách vi phạm (rỗng = đạt)
function checkInvariants(R, P){
  const v = [];
  const slots = R.slots;
  const ratePerMin = P.rate / 60;
  // 1. Không chồng lấn trên cùng máy
  const byM = {};
  for (const g of R.segs) (byM[g.m] = byM[g.m] || []).push(g);
  for (const [m, list] of Object.entries(byM)){
    list.sort((a, b) => a.s - b.s);
    for (let i = 1; i < list.length; i++){
      if (list[i].s < list[i - 1].e - 1e-6) v.push(`M${m} chồng lấn ${list[i - 1].code}→${list[i].code} @${list[i].s.toFixed(1)}`);
    }
  }
  // 2. Segment nằm gọn trong slot ca của nó
  for (const g of R.segs){
    const s = slots[g.slotIdx];
    if (!s || g.s < s.cum - 1e-6 || g.e > s.endCum + 1e-6) v.push(`Segment ${g.code} ngoài slot ${g.slotIdx}`);
  }
  // 3. Nghỉ Chủ nhật
  if (P.skipSun && slots.some(s => s.dow === 'CN')) v.push('Có slot ngày Chủ nhật khi skipSun bật');
  // 4. Không chia lô: mỗi mã chạy trên đúng 1 máy
  const owners = {};
  for (const g of R.segs){
    const k = g.fam + ':' + g.code;
    (owners[k] = owners[k] || new Set()).add(g.m);
  }
  for (const [k, set] of Object.entries(owners)) if (set.size > 1) v.push(`Mã ${k} chạy trên ${set.size} máy`);
  // 5. Tổng PC của mã đã xong = SL; thời gian chạy = SL / rate
  for (const j of R.fin){
    const runs = R.segs.filter(g => g.type === 'run' && g.fam === j.fam && g.code === j.code);
    const pcs = runs.reduce((s, g) => s + g.pcs, 0);
    const min = runs.reduce((s, g) => s + (g.e - g.s), 0);
    if (Math.abs(pcs - j.rem0) > 1e-3) v.push(`Mã ${j.code}: tổng PC ${pcs} ≠ SL ${j.rem0}`);
    if (Math.abs(min - j.rem0 / ratePerMin) > 1e-3) v.push(`Mã ${j.code}: phút chạy ${min.toFixed(2)} ≠ ${(j.rem0 / ratePerMin).toFixed(2)}`);
  }
  // 6. Cổng BTP: mã W không có segment (kể cả đổi màu) trước mốc đủ BTP, trừ khi bị kéo sớm
  for (const j of R.jobs){
    if (j.st !== 'W' || j.pulledEarly) continue;
    const first = R.segs.filter(g => g.fam === j.fam && g.code === j.code).reduce((mn, g) => Math.min(mn, g.s), Infinity);
    if (first < j.origReadyCum - 1e-6) v.push(`Mã W ${j.code} chạy lúc ${first.toFixed(1)} trước mốc BTP ${j.origReadyCum}`);
  }
  if (!P.allowPullW && R.jobs.some(j => j.pulledEarly)) v.push('Có mã pulledEarly khi allowPullW tắt');
  // 7. Máy cố định
  for (const j of R.jobs){
    if (j.fixedMachine && j.owner && j.owner !== j.fixedMachine) v.push(`Mã ${j.code} gắn M${j.fixedMachine} nhưng chạy M${j.owner}`);
  }
  // 8. Mã có hạn PO mà chưa xong / bị loại phải có poRisk
  for (const j of R.jobs){
    if (Number.isFinite(j.dueMs) && (j.excluded || j.rem > 1e-6) && !j.poRisk) v.push(`Mã ${j.code} chưa xong nhưng không có poRisk`);
  }
  // 9. ok khớp thực tế
  const allDone = R.incl.every(j => j.rem <= 1e-6);
  if (R.ok !== allDone) v.push(`R.ok=${R.ok} nhưng tất cả xong=${allDone}`);
  // 10. Idle có lý do
  for (const i of R.idles) if (!i.reason) v.push('Idle không có lý do');
  // 11. M4 (dự phòng) không bắt đầu trước backupDelay
  if (P.machines >= 4){
    const m4 = R.segs.filter(g => g.m === 4);
    const minS = m4.reduce((mn, g) => Math.min(mn, g.s), Infinity);
    if (minS < Math.min(P.backupDelayMin, R.slots.length ? R.slots[R.slots.length - 1].endCum : 0) - 1e-6) v.push(`M4 chạy lúc ${minS} < backupDelay ${P.backupDelayMin}`);
  }
  return v;
}

module.exports = { makeEngine, mkP, checkInvariants, ROOT };
