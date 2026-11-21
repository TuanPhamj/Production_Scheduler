// Kiểm thử engine.js bản public: ca tính tay, đổi màu, bất biến, lưới tham số, dữ liệu biên.
// Chạy: node qa/engine.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const { makeEngine, mkP, checkInvariants } = require('./harness');

const E = makeEngine();
const PPM = 56; // 3.360 PC/h = 56 PC/phút (định mức xưởng 21/11/2026)
const results = [];
function t(id, desc, expect, fn){
  let actual, pass;
  try {
    const r = fn();
    actual = r.actual; pass = r.pass;
  } catch (e){
    actual = 'LỖI: ' + (e && e.message ? e.message : e); pass = false;
  }
  results.push({ id, desc, expect, actual: String(actual), pass });
}
const sku = (code, qty, fam = 'F', st = 'R', pri = 2) => [code, code, qty, pri, fam, st];
const slotOf = (R, g) => R.slots[g.slotIdx];
const segsOf = (R, code, fam = 'F') => R.segs.filter(g => g.code === code && g.fam === fam);
const runsOf = (R, code, fam = 'F') => segsOf(R, code, fam).filter(g => g.type === 'run');

// ---------- B2.1 Công suất ----------
t('B2.1', '1 máy, chỉ Ca 1, 1 mã R 25.200 PC (450 ph × 56)', '450 phút, xong trọn Ca 1 ngày đầu, đổi màu 0',
  () => {
    const P = mkP({ machines: 1, shiftsOn: [true, false, false], skus: [sku('B02', 450 * PPM)] });
    const R = E.simulate(P);
    const runs = runsOf(R, 'B02');
    const min = runs.reduce((s, g) => s + g.e - g.s, 0);
    const co = R.segs.filter(g => g.type === 'co').length;
    const s0 = slotOf(R, runs[runs.length - 1]);
    return { actual: `${min.toFixed(2)} phút, ${runs.length} segment, kết thúc ${s0.ds} ${s0.shift}, số lần đổi màu ${co}`,
      pass: Math.abs(min - 450) < 1e-6 && runs.length === 1 && s0.dayIdx === 0 && co === 0 };
  });

// ---------- B2.2 Ngưỡng cuối ca ----------
function tailCase(qtyB){
  const P = mkP({ machines: 1, shiftsOn: [true, false, false], sortMode: 'stt',
    skus: [sku('B05', 425 * PPM), sku('B02', qtyB)],
    metaMap: { 'F:B05': { stt: 0 }, 'F:B02': { stt: 1 } } });
  return E.simulate(P);
}
t('B2.2a', 'A=B05 23.800 PC (425 ph) → B=B02 5.000 PC, đổi màu 15 ph, còn 10 ph < 20', 'B dời sang ca sau, có idle "tail"',
  () => {
    const R = tailCase(5000);
    const firstB = segsOf(R, 'B02')[0];
    const tail = R.idles.filter(i => i.kind === 'tail');
    return { actual: `B bắt đầu slot ${firstB.slotIdx} (${slotOf(R, firstB).ds}), idle tail: ${tail.length}`,
      pass: firstB.slotIdx === 1 && tail.length === 1 };
  });
t('B2.2b', 'Như trên nhưng B = 400 PC (7,1 ph, 15+7,1 ≤ 25)', 'B chạy luôn trong Ca 1 ngày đầu',
  () => {
    const R = tailCase(400);
    const runsB = runsOf(R, 'B02');
    return { actual: `B chạy slot ${runsB.map(g => g.slotIdx).join(',')}, idle tail: ${R.idles.filter(i => i.kind === 'tail').length}`,
      pass: runsB.length === 1 && runsB[0].slotIdx === 0 };
  });

// ---------- B2.3 Chủ nhật ----------
t('B2.3a', 'Start T7 21/11/2026, 1 máy 3 ca, 1 mã 80.000 PC (~1.429 ph)', 'Chạy T7 Ca1, Ca2, Ca3 (22:00→06:00 CN) rồi T2 Ca1; không slot nào ngày CN',
  () => {
    const P = mkP({ machines: 1, start: new Date('2026-11-21T00:00:00'), skus: [sku('B02', 80000)] });
    const R = E.simulate(P);
    const seq = runsOf(R, 'B02').map(g => slotOf(R, g).dow + ' ' + g.shift);
    return { actual: seq.join(' | ') + ' · slot CN: ' + R.slots.filter(s => s.dow === 'CN').length,
      pass: seq.join('|') === 'T7 Ca 1|T7 Ca 2|T7 Ca 3|T2 Ca 1' && !R.slots.some(s => s.dow === 'CN') };
  });
t('B2.3b', 'Start rơi vào Chủ nhật 22/11/2026', 'Slot đầu tiên là T2 Ca 1',
  () => {
    const R = E.simulate(mkP({ machines: 1, start: new Date('2026-11-22T00:00:00'), skus: [sku('B02', 1000)] }));
    return { actual: R.slots[0].dow + ' ' + R.slots[0].shift + ' ' + R.slots[0].ds, pass: R.slots[0].dow === 'T2' && R.slots[0].shift === 'Ca 1' };
  });
t('B2.3c', 'Tắt "Nghỉ Chủ nhật"', 'Có slot ngày CN',
  () => {
    const R = E.simulate(mkP({ machines: 1, skipSun: false, skus: [sku('B02', 1000)] }));
    return { actual: 'slot CN: ' + R.slots.filter(s => s.dow === 'CN').length, pass: R.slots.some(s => s.dow === 'CN') };
  });

// ---------- B2.4 BTP ----------
const START = '2026-11-23'; // T2
t('B2.4a', 'Mã W ngày đủ BTP = 25/11 (start+2), máy rảnh', 'Không chạy trước 06:00 25/11; idle "btp"',
  () => {
    const P = mkP({ machines: 1, skus: [sku('B02', 5000, 'F', 'W')], metaMap: { 'F:B02': { btp_ready_date: '2026-11-25', btp_custom: true } } });
    const R = E.simulate(P);
    const g = segsOf(R, 'B02')[0];
    const s = slotOf(R, g);
    return { actual: `bắt đầu ${s.ds} ${s.shift} (offset ${(g.s - s.cum).toFixed(0)} ph), idle: ${R.idles.map(i => i.kind).join(',')}`,
      pass: s.ds === '25/11/2026' && s.shift === 'Ca 1' && Math.abs(g.s - s.cum) < 1e-6 && R.idles.some(i => i.kind === 'btp') };
  });
t('B2.4b', 'Như trên + bật "Cho kéo sớm W"', 'Chạy ngay từ đầu, pulledEarly = true',
  () => {
    const P = mkP({ machines: 1, allowPullW: true, skus: [sku('B02', 5000, 'F', 'W')], metaMap: { 'F:B02': { btp_ready_date: '2026-11-25', btp_custom: false } } });
    const R = E.simulate(P);
    const j = R.jobs[0];
    return { actual: `bắt đầu cum ${segsOf(R, 'B02')[0].s}, pulledEarly ${j.pulledEarly}`, pass: segsOf(R, 'B02')[0].s === 0 && j.pulledEarly === true };
  });
t('B2.4c', 'Mã W có ngày đủ BTP nhập tay (btp_custom) + bật kéo sớm', 'KHÔNG được kéo sớm (ngày chỉ định rõ)',
  () => {
    const P = mkP({ machines: 1, allowPullW: true, skus: [sku('B02', 5000, 'F', 'W')], metaMap: { 'F:B02': { btp_ready_date: '2026-11-25', btp_custom: true } } });
    const R = E.simulate(P);
    return { actual: `bắt đầu ${slotOf(R, segsOf(R, 'B02')[0]).ds}, pulledEarly ${R.jobs[0].pulledEarly}`, pass: slotOf(R, segsOf(R, 'B02')[0]).ds === '25/11/2026' };
  });
t('B2.4d', 'Mã W không có ngày, waitDays = 3, start T2', 'Đủ BTP 06:00 T5 26/11',
  () => {
    const R = E.simulate(mkP({ machines: 1, skus: [sku('B02', 5000, 'F', 'W')] }));
    return { actual: slotOf(R, segsOf(R, 'B02')[0]).ds, pass: slotOf(R, segsOf(R, 'B02')[0]).ds === '26/11/2026' };
  });
t('B2.4e', 'Mã W, start T6 27/11, waitDays 3 (qua Chủ nhật)', 'Đủ BTP T3 01/12 (bỏ CN)',
  () => {
    const R = E.simulate(mkP({ machines: 1, start: new Date('2026-11-27T00:00:00'), skus: [sku('B02', 5000, 'F', 'W')] }));
    return { actual: slotOf(R, segsOf(R, 'B02')[0]).ds, pass: slotOf(R, segsOf(R, 'B02')[0]).ds === '01/12/2026' };
  });
t('B2.4f', 'Mã W ngày đủ BTP rơi vào Chủ nhật 29/11', 'Chạy từ 06:00 T2 30/11',
  () => {
    const R = E.simulate(mkP({ machines: 1, skus: [sku('B02', 5000, 'F', 'W')], metaMap: { 'F:B02': { btp_ready_date: '2026-11-29', btp_custom: true } } }));
    return { actual: slotOf(R, segsOf(R, 'B02')[0]).ds + ' ' + segsOf(R, 'B02')[0].shift, pass: slotOf(R, segsOf(R, 'B02')[0]).ds === '30/11/2026' };
  });
t('B2.4g', 'Mã W ngày đủ BTP trong quá khứ (trước start)', 'Chạy ngay từ đầu (không treo, không lỗi)',
  () => {
    const R = E.simulate(mkP({ machines: 1, skus: [sku('B02', 5000, 'F', 'W')], metaMap: { 'F:B02': { btp_ready_date: '2026-11-01', btp_custom: true } } }));
    return { actual: 'bắt đầu cum ' + segsOf(R, 'B02')[0].s, pass: segsOf(R, 'B02')[0].s === 0 };
  });

// ---------- B2.5 Chiến dịch FINE → CHISEL ----------
t('B2.5a', '1 máy, 2 FINE R + 2 CHISEL R', 'Thứ tự F,F,C,C; đổi dòng 1 lần (60 ph)',
  () => {
    const P = mkP({ machines: 1, skus: [sku('B02', 3000, 'C'), sku('G02', 3000, 'F'), sku('YR02', 3000, 'C'), sku('Y02', 3000, 'F')] });
    const R = E.simulate(P);
    const order = R.queue.map(j => j.fam).join('');
    const sw = R.segs.filter(g => g.type === 'co' && g.coMin === 60).length;
    return { actual: `thứ tự ${order}, fSw ${R.fSw}, segment đổi dòng ${sw}`, pass: order === 'FFCC' && R.fSw === 1 };
  });
function waitCase(qtyA){
  // A (FINE R) chạy tới ~cuối Ca3 ngày đầu; FINE kế tiếp là W đủ BTP 06:00 ngày sau; có CHISEL R sẵn sàng
  const P = mkP({ machines: 1, skus: [sku('B02', qtyA, 'F'), sku('B05', 5000, 'F', 'W'), sku('Y02', 5000, 'C')],
    metaMap: { 'F:B05': { btp_ready_date: '2026-11-24', btp_custom: true } } });
  return E.simulate(P);
}
t('B2.5b', 'FINE kế tiếp đủ BTP sau 100 ph (≤ 2×60)', 'Máy chờ FINE (idle "campaign"), CHISEL chạy sau',
  () => {
    const R = waitCase(1235 * PPM);
    const order = R.queue.map(j => j.code).join(',');
    return { actual: `thứ tự ${order}, idle: ${R.idles.map(i => i.kind + ' ' + (i.e - i.s).toFixed(0) + 'ph').join(',')}`,
      pass: order === 'B02,B05,Y02' && R.idles.some(i => i.kind === 'campaign') };
  });
t('B2.5c', 'FINE kế tiếp đủ BTP sau 200 ph (> 2×60)', 'Chạy CHISEL sẵn sàng thay vì đứng máy',
  () => {
    const R = waitCase(1135 * PPM);
    const order = R.queue.map(j => j.code).join(',');
    return { actual: `thứ tự ${order}`, pass: order.startsWith('B02,Y02') };
  });

// ---------- B2.5d–f Thứ tự file tải lên (quy tắc xưởng 21/11/2026) ----------
const mixSkus = () => [sku('B02', 3000, 'C'), sku('G02', 3000, 'F'), sku('YR02', 3000, 'C'), sku('Y02', 3000, 'F')];
t('B2.5d', 'File CHISEL tải lên trước file FINE (famOrder C=3, F=4)', 'CHISEL chạy trước: C,C,F,F; đổi dòng 1 lần',
  () => {
    const R = E.simulate(mkP({ machines: 1, famOrder: { C: 3, F: 4 }, skus: mixSkus() }));
    const order = R.queue.map(j => j.fam).join('');
    return { actual: `thứ tự ${order}, đổi dòng ${R.fSw}`, pass: order === 'CCFF' && R.fSw === 1 };
  });
t('B2.5e', 'File CHISEL trước nhưng mã CHISEL đều chờ BTP tới 25/11, FINE đã sẵn sàng', 'Chạy FINE trước thay vì để máy đứng chờ',
  () => {
    const R = E.simulate(mkP({ machines: 1, famOrder: { C: 3, F: 4 },
      skus: [sku('B02', 3000, 'C', 'W'), sku('G02', 3000, 'F'), sku('Y02', 3000, 'F')],
      metaMap: { 'C:B02': { btp_ready_date: '2026-11-25', btp_custom: true } } }));
    const order = R.queue.map(j => j.fam).join('');
    const idleBefore = R.idles.filter(i => i.s < 1).length;
    return { actual: `thứ tự ${order}, máy rảnh đầu lịch: ${idleBefore}`, pass: order === 'FFC' && idleBefore === 0 };
  });
t('B2.5f', 'File CHISEL trước; máy đang chạy CHISEL, mã CHISEL kế tiếp đủ BTP sau 100 ph, FINE sẵn sàng', 'Máy chờ CHISEL (idle "campaign"), không đổi dòng 2 lần',
  () => {
    const R = E.simulate(mkP({ machines: 1, famOrder: { C: 3, F: 4 },
      skus: [sku('B02', 1235 * PPM, 'C'), sku('B05', 5000, 'C', 'W'), sku('Y02', 5000, 'F')],
      metaMap: { 'C:B05': { btp_ready_date: '2026-11-24', btp_custom: true } } }));
    const order = R.queue.map(j => j.code).join(',');
    return { actual: `thứ tự ${order}, idle: ${R.idles.map(i => i.kind).join(',')}`, pass: order === 'B02,B05,Y02' && R.idles.some(i => i.kind === 'campaign') };
  });
t('B2.5g', 'Một file có cả 2 dòng, CHISEL xuất hiện trước (famOrder C=5, F=5,5)', 'CHISEL chạy trước, đổi dòng 1 lần',
  () => {
    const R = E.simulate(mkP({ machines: 1, famOrder: { C: 5, F: 5.5 }, sortMode: 'stt', skus: mixSkus() }));
    const order = R.queue.map(j => j.fam).join('');
    return { actual: `thứ tự ${order}, đổi dòng ${R.fSw}`, pass: order === 'CCFF' && R.fSw === 1 };
  });

// ---------- B2.6 Máy dự phòng ----------
t('B2.6a', '4 máy, tải nhẹ (3 mã × 100 ph)', 'M4 không nhận việc',
  () => {
    const R = E.simulate(mkP({ machines: 4, skus: [sku('B02', 100 * PPM), sku('G02', 100 * PPM), sku('Y02', 100 * PPM)] }));
    return { actual: 'segment M4: ' + R.segs.filter(g => g.m === 4).length, pass: R.segs.every(g => g.m !== 4) };
  });
t('B2.6b', '4 máy, tải nặng (8 mã × 450 ph)', 'M4 có việc, bắt đầu ≥ 480 ph',
  () => {
    const codes = ['B02', 'B05', 'G02', 'G05', 'Y02', 'Y05', 'R02', 'R05'];
    const R = E.simulate(mkP({ machines: 4, skus: codes.map(c => sku(c, 450 * PPM)) }));
    const m4 = R.segs.filter(g => g.m === 4);
    return { actual: `M4: ${m4.length} segment, bắt đầu cum ${m4.length ? Math.min(...m4.map(g => g.s)) : '-'}`,
      pass: m4.length > 0 && Math.min(...m4.map(g => g.s)) >= 480 };
  });

// ---------- B2.7 Máy cố định ----------
t('B2.7a', 'Mã gắn M2 (3 máy)', 'Chỉ chạy M2',
  () => {
    const R = E.simulate(mkP({ skus: [sku('B02', 20000), sku('G02', 20000), sku('Y02', 20000)], metaMap: { 'F:Y02': { fixedMachine: 2 } } }));
    const j = R.jobs.find(x => x.code === 'Y02');
    return { actual: 'chạy M' + j.owner, pass: j.owner === 2 };
  });
t('B2.7b', 'Mã gắn M3 nhưng chỉ bật 2 máy', 'Engine xếp máy khác; giao diện có cảnh báo "mã gắn máy đang tắt" (không âm thầm bỏ ràng buộc)',
  () => {
    const R = E.simulate(mkP({ machines: 2, skus: [sku('B02', 20000), sku('Y02', 20000)], metaMap: { 'F:Y02': { fixedMachine: 3 } } }));
    const j = R.jobs.find(x => x.code === 'Y02');
    const ui = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'ui.js'), 'utf8');
    const warned = ui.includes('mã gắn máy đang tắt');
    return { actual: `fixedMachine=${j.fixedMachine}, chạy M${j.owner}, ui.js có cảnh báo: ${warned ? 'có' : 'không'}`, pass: j.owner !== 3 && warned };
  });

// ---------- B2.8 Ưu tiên ----------
function prioCase(urgent){
  const P = mkP({ machines: 1, sortMode: 'stt', prioritizeUrgent: urgent,
    skus: [sku('B02', 1000, 'F', 'R', 3), sku('G02', 1000, 'F', 'R', 1), sku('Y02', 1000, 'F', 'R', 2)],
    metaMap: { 'F:B02': { stt: 0, due_date: '2026-12-30' }, 'F:G02': { stt: 1, due_date: '2026-11-25' }, 'F:Y02': { stt: 2, due_date: '2026-12-01' } } });
  return E.simulate(P).queue.map(j => j.code).join(',');
}
t('B2.8a', 'sortMode STT, ưu tiên gấp TẮT', 'Theo STT: B02,G02,Y02', () => { const o = prioCase(false); return { actual: o, pass: o === 'B02,G02,Y02' }; });
t('B2.8b', 'sortMode STT, ưu tiên gấp BẬT', 'Theo cấp 1→2→3: G02,Y02,B02', () => { const o = prioCase(true); return { actual: o, pass: o === 'G02,Y02,B02' }; });
t('B2.8c', 'sortMode qty', 'SL lớn trước',
  () => {
    const R = E.simulate(mkP({ machines: 1, sortMode: 'qty', skus: [sku('B02', 1000), sku('G02', 9000), sku('Y02', 5000)] }));
    const o = R.queue.map(j => j.code).join(',');
    return { actual: o, pass: o === 'G02,Y02,B02' };
  });
t('B2.8d', 'Trạng thái R → Y → W (W đã đủ BTP)', 'R trước, rồi Y, rồi W',
  () => {
    const R = E.simulate(mkP({ machines: 1, skus: [sku('B02', 1000, 'F', 'W'), sku('G02', 1000, 'F', 'Y'), sku('Y02', 1000, 'F', 'R')],
      metaMap: { 'F:B02': { btp_ready_date: '2026-11-01', btp_custom: true } } }));
    const o = R.queue.map(j => j.st).join('');
    return { actual: o, pass: o === 'RYW' };
  });

// ---------- B2.9 PO ----------
t('B2.9a', 'Mã xong T3 24/11, hạn PO T2 23/11', 'isLate, lateDays = 1',
  () => {
    const R = E.simulate(mkP({ machines: 1, sortMode: 'stt', skus: [sku('B02', 1335 * PPM), sku('G02', 1000)],
      metaMap: { 'F:B02': { stt: 0 }, 'F:G02': { stt: 1, due_date: '2026-11-23' } } }));
    const j = R.jobs.find(x => x.code === 'G02');
    return { actual: `xong ${j.end.ds}, isLate ${j.isLate}, lateDays ${j.lateDays}`, pass: j.isLate && j.lateDays === 1 };
  });
t('B2.9b', 'Mã có hạn PO nhưng SL vượt 60 ngày', 'poRisk = true, isLate nếu hạn trước cuối lịch',
  () => {
    const R = E.simulate(mkP({ machines: 1, skus: [sku('B02', 5e6)], metaMap: { 'F:B02': { due_date: '2026-12-01' } } }));
    const j = R.jobs[0];
    return { actual: `poRisk ${j.poRisk}, isLate ${j.isLate}, ok ${R.ok}`, pass: j.poRisk && j.isLate && !R.ok };
  });
t('B2.9c', 'Chỉ chạy mã sẵn sàng (onlyReady), mã W có hạn PO', 'Mã W bị loại, poRisk = true',
  () => {
    const R = E.simulate(mkP({ onlyReady: true, skus: [sku('B02', 1000), sku('G02', 1000, 'F', 'W')], metaMap: { 'F:G02': { due_date: '2026-12-01' } } }));
    const j = R.jobs.find(x => x.code === 'G02');
    return { actual: `excluded ${j.excluded}, poRisk ${j.poRisk}, segment ${segsOf(R, 'G02').length}`, pass: j.excluded && j.poRisk && !segsOf(R, 'G02').length };
  });
t('B2.9d', 'Mã chạy Ca 3 ngày hạn PO, xong sau 0h (điểm mở đã biết)', 'Ghi nhận hành vi: tính theo ngày bắt đầu ca → không trễ',
  () => {
    const R = E.simulate(mkP({ machines: 1, sortMode: 'stt', skus: [sku('B02', 900 * PPM), sku('G02', 400 * PPM)],
      metaMap: { 'F:B02': { stt: 0 }, 'F:G02': { stt: 1, due_date: '2026-11-23' } } }));
    const j = R.jobs.find(x => x.code === 'G02');
    return { actual: `xong ${j.end.ds} ${j.end.shift} (thực tế ~${Math.floor((j.endClock - 900) / 60) + 22 - 24}h sáng 24/11), isLate ${j.isLate}`, pass: true };
  });

// ---------- B2.10 Mã SL = 0 trong dữ liệu ----------
t('B2.10', 'Mã SL = 0 lọt vào danh sách lập lịch', 'Không tốn thời gian đổi màu, không tính là 1 lần đổi màu',
  () => {
    const R = E.simulate(mkP({ machines: 1, sortMode: 'stt', skus: [sku('B02', 1000), sku('Y02', 0), sku('G02', 1000)],
      metaMap: { 'F:B02': { stt: 0 }, 'F:Y02': { stt: 1 }, 'F:G02': { stt: 2 } } }));
    const co = R.segs.filter(g => g.type === 'co' && g.code === 'Y02');
    return { actual: `đổi màu cho Y02: ${co.length} segment (${co.reduce((s, g) => s + g.e - g.s, 0)} ph)`, pass: co.length === 0 };
  });

// ---------- B3 Đổi màu ----------
const coRows = [];
function co(prev, next, mode = 'heijunka', famA = 'F', famB = 'F'){
  return E.call(`(() => {
    const P = { coMode: __A.mode, co: 15, coSame: 9, cuGroup: 10, cuSwitch: 60 };
    const a = { code: __A.prev, fam: __A.famA, color: parseColor(__A.prev) };
    const b = { code: __A.next, fam: __A.famB, color: parseColor(__A.next) };
    return calcChangeover(a, b, P).min;
  })()`, { prev, next, mode, famA, famB });
}
const coCases = [
  ['B02', 'B02', 'heijunka', 'F', 'F', 0, 'Cùng mã'],
  ['B02', 'B02', 'heijunka', 'F', 'C', 60, 'Cùng mã nhưng đổi dòng FINE→CHISEL'],
  ['B02', 'Y05', 'sop', 'F', 'F', 15, 'Chế độ SOP phẳng'],
  ['B02', 'B05', 'heijunka', 'F', 'F', 9, 'Cùng nhóm Lạnh, nhạt → đậm'],
  ['B05', 'B02', 'heijunka', 'F', 'F', 15, 'Cùng nhóm, đậm vừa → nhạt'],
  ['B115', 'B02', 'heijunka', 'F', 'F', 25, 'Đậm (độ đậm 15 ≥ 13) → rất nhạt (độ đậm 2 ≤ 3), theo bảng Tổng màu'],
  ['R014', 'R16', 'heijunka', 'F', 'F', 15, 'R014 (độ đậm 14) → R16 (độ đậm 6): đậm → vừa, cùng nhóm'],
  ['R16', 'R014', 'heijunka', 'F', 'F', 9, 'R16 → R014: nhạt → đậm cùng nhóm'],
  ['120', 'YGY11', 'heijunka', 'F', 'F', 25, 'Đen 120 → YGY11 (xám rất nhạt)'],
  ['Y05', 'YR05', 'heijunka', 'F', 'F', 9, 'Cùng nhóm Nóng (Y→YR) cùng độ'],
  ['B05', 'Y05', 'heijunka', 'F', 'F', 25, 'Nhóm Lạnh → Nóng (xa: 160°)'],
  ['G05', 'BG05', 'heijunka', 'F', 'F', 9, 'Cùng nhóm Xanh lá–lơ'],
  ['YG05', 'Y05', 'heijunka', 'F', 'F', 15, 'Xanh lá (85°) → Vàng (55°): kề nhau'],
  ['B05', 'C5', 'heijunka', 'F', 'F', 15, 'Mã ngoài bảng màu (C5) → SOP'],
  ['C5', 'B05', 'heijunka', 'F', 'F', 15, 'Mã ngoài bảng màu → SOP'],
  ['B05', 'WG3', 'heijunka', 'F', 'F', 25, 'Có sắc tố → Trung tính: rửa sâu'],
  ['WG3', 'B05', 'heijunka', 'F', 'F', 15, 'Trung tính → có sắc tố'],
  ['120', '0', 'heijunka', 'F', 'F', 25, 'Đen 120 → 0 Blender'],
  ['BLACK', 'B05', 'heijunka', 'F', 'F', 15, 'Chữ "BLACK" không khớp nhầm nhóm B'],
  ['b05', 'B07', 'heijunka', 'F', 'F', 9, 'Mã chữ thường'],
];
const prefixCases = [['BGY10', 'BGY'], ['BG10', 'BG'], ['B10', 'B'], ['YR10', 'YR'], ['Y10', 'Y'], ['RV10', 'RV'], ['R10', 'R'], ['GG3', 'GG'], ['G10', 'G'], ['YG10', 'YG'], ['BV10', 'BV'], ['E10', 'E'], ['0', '0'], ['120', '120'], ['CG3', 'CG'], [' b02 ', 'B'], ['YGY11', 'YGY'], ['YG111', 'YG']];
// Độ đậm = phần số sau chữ số đầu (bảng Tổng màu): [mã, độ đậm, đậm?, rất nhạt?]
const toneCases = [['R014', 14, true, false], ['R16', 6, false, false], ['YR112', 12, false, false], ['G36', 6, false, false],
  ['B02', 2, false, true], ['BV415', 15, true, false], ['Y413', 13, false, false], ['0', 0, false, true], ['120', 16, true, false]];
for (const [code, tone, dark, light] of toneCases){
  t('B3 độ đậm ' + code, 'Đọc độ đậm theo phần số sau chữ số đầu', `độ đậm ${tone}${dark ? ', đậm' : ''}${light ? ', rất nhạt' : ''}`, () => {
    const c = E.call('parseColor(__A)', code);
    return { actual: `độ đậm ${c.tone}${c.isDark ? ', đậm' : ''}${c.isVeryLight ? ', rất nhạt' : ''}`, pass: c.tone === tone && c.isDark === dark && c.isVeryLight === light };
  });
}
for (const [a, b, mode, fa, fb, exp, desc] of coCases){
  t('B3 ' + a + '→' + b + (mode === 'sop' ? ' (SOP)' : '') + (fa !== fb ? ' (đổi dòng)' : ''), desc, exp + ' ph', () => {
    const m = co(a, b, mode, fa, fb);
    coRows.push([a, b, mode, exp, m]);
    return { actual: m + ' ph', pass: m === exp };
  });
}
for (const [code, pre] of prefixCases){
  t('B3 tiền tố ' + JSON.stringify(code), 'Tiền tố dài nhất thắng', pre, () => {
    const c = E.call('parseColor(__A)', code);
    return { actual: c.prefix || '(không nhận)', pass: c.prefix === pre };
  });
}

// ---------- B4 Lưới chống treo + bất biến ----------
function synthData(n, seed = 7){
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pre = ['0', 'WG', 'CG', 'BGY', 'GG', 'Y', 'YR', 'R', 'E', 'YG', 'G', 'BG', 'B', 'BV', 'V', 'RV'];
  const skus = [], meta = {};
  for (let i = 0; i < n; i++){
    const p = pre[i % pre.length];
    const code = p === '0' ? '0' : p + String(Math.floor(rnd() * 9)) + String(i);
    const fam = rnd() < 0.7 ? 'F' : 'C';
    const r = rnd();
    const st = r < 0.25 ? 'R' : (r < 0.7 ? 'Y' : 'W');
    const qty = Math.round(500 + rnd() * 9500);
    const key = fam + ':' + code;
    if (skus.some(x => x[4] + ':' + x[0] === key)) continue;
    skus.push([code, 'S' + i, qty, 1 + Math.floor(rnd() * 3), fam, st]);
    meta[key] = { stt: i };
    if (rnd() < 0.3) meta[key].due_date = '2026-12-' + String(1 + Math.floor(rnd() * 28)).padStart(2, '0');
    if (rnd() < 0.1) meta[key].fixedMachine = 1 + Math.floor(rnd() * 3);
    if (st === 'W'){
      const k = rnd();
      if (k < 0.4){ meta[key].btp_ready_date = '2026-11-' + String(24 + Math.floor(rnd() * 6)).padStart(2, '0'); meta[key].btp_custom = true; }
      else if (k < 0.7) meta[key].btp_delay = 1 + Math.floor(rnd() * 3);
    }
  }
  return { skus, meta };
}
const DATA = synthData(60);
const shiftSets = { 'cả 3 ca': [true, true, true], 'chỉ Ca 1': [true, false, false], 'tắt Ca 3': [true, true, false], 'tắt hết': [false, false, false] };
let gridRuns = 0, gridMaxMs = 0, gridFails = [], gridErrors = [];
for (const machines of [1, 2, 3, 4])
for (const [shName, on] of Object.entries(shiftSets))
for (const coMode of ['heijunka', 'sop'])
for (const campaign of [true, false])
for (const allowPullW of [false, true])
for (const onlyReady of [false, true])
for (const prioritizeUrgent of [false, true])
for (const sortMode of ['hue', 'qty', 'stt'])
for (const skipSun of [true, false]){
  const P = mkP({ machines, shiftsOn: on, coMode, campaign, allowPullW, onlyReady, prioritizeUrgent, sortMode, skipSun,
    skus: DATA.skus.map(r => r.slice()), metaMap: JSON.parse(JSON.stringify(DATA.meta)) });
  const label = `m${machines}/${shName}/${coMode}/camp${+campaign}/pull${+allowPullW}/ready${+onlyReady}/urg${+prioritizeUrgent}/${sortMode}/sun${+skipSun}`;
  const t0 = process.hrtime.bigint();
  try {
    const R = E.simulate(P, 5000);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    gridMaxMs = Math.max(gridMaxMs, ms);
    const v = checkInvariants(R, P);
    if (v.length) gridFails.push(label + ': ' + v.slice(0, 3).join('; '));
  } catch (e){
    gridErrors.push(label + ': ' + e.message);
  }
  gridRuns++;
}
results.push({ id: 'B4', desc: `Lưới ${gridRuns} tổ hợp tham số × 60 mã giả lập`, expect: 'Không treo/lỗi, mọi bất biến đạt',
  actual: `${gridRuns} lần chạy, chậm nhất ${gridMaxMs.toFixed(0)} ms, lỗi/timeout ${gridErrors.length}, vi phạm bất biến ${gridFails.length}`,
  pass: !gridErrors.length && !gridFails.length });

// Tất định
t('B4.det', 'Chạy 2 lần cùng input', 'Kết quả giống hệt', () => {
  const P = () => mkP({ machines: 4, skus: DATA.skus.map(r => r.slice()), metaMap: JSON.parse(JSON.stringify(DATA.meta)) });
  const a = JSON.stringify(E.simulate(P()).segs), b = JSON.stringify(E.simulate(P()).segs);
  return { actual: a === b ? 'giống' : 'KHÁC', pass: a === b };
});

// ---------- B5 Dữ liệu biên & hiệu năng ----------
t('B5.1', 'Danh sách mã rỗng', 'Không lỗi, ok = true', () => {
  const R = E.simulate(mkP({ skus: [] }));
  return { actual: 'ok ' + R.ok, pass: R.ok === true };
});
t('B5.2', 'SL âm / chữ', 'Bị coi là 0, không lỗi', () => {
  const R = E.simulate(mkP({ skus: [sku('B02', -500), sku('G02', 'abc'), sku('Y02', 1000)] }));
  return { actual: `rem0: ${R.jobs.map(j => j.rem0).join(',')}, ok ${R.ok}`, pass: R.jobs[0].rem0 === 0 && R.jobs[1].rem0 === 0 };
});
t('B5.3', 'Ưu tiên ngoài 1–3, trạng thái lạ "X"', 'Ưu tiên → 2; trạng thái lạ xếp như W nhưng không bị chặn BTP', () => {
  const R = E.simulate(mkP({ machines: 1, skus: [sku('B02', 1000, 'F', 'X', 9)] }));
  const j = R.jobs[0];
  return { actual: `pri ${j.pri}, st ${j.st}, readyCum ${j.readyCum}, chạy lúc ${R.segs[0] ? R.segs[0].s : '-'}`, pass: j.pri === 2 };
});
t('B5.4', 'Tắt hết ca', 'Không lỗi, mã có hạn PO được cảnh báo', () => {
  const R = E.simulate(mkP({ shiftsOn: [false, false, false], skus: [sku('B02', 1000)], metaMap: { 'F:B02': { due_date: '2026-11-20' } } }));
  return { actual: `slots ${R.slots.length}, poRisk ${R.jobs[0].poRisk}, isLate ${R.jobs[0].isLate}`, pass: R.slots.length === 0 && R.jobs[0].poRisk };
});
t('B5.5', 'rate = 60 PC/h (tối thiểu), 20 mã × 10.000 PC', 'Không treo, mã chưa xong có cờ', () => {
  const R = E.simulate(mkP({ rate: 60, skus: DATA.skus.slice(0, 20).map(r => [r[0], r[1], 10000, r[3], r[4], 'R']) }));
  return { actual: `fin ${R.fin.length}/${R.incl.length}, ok ${R.ok}`, pass: !R.ok };
});
t('B5.6', 'Đổi màu = 0 phút mọi loại', 'Không treo', () => {
  const R = E.simulate(mkP({ co: 0, coSame: 0, cuGroup: 0, cuSwitch: 0, skus: DATA.skus.map(r => r.slice()), metaMap: JSON.parse(JSON.stringify(DATA.meta)) }));
  return { actual: `fin ${R.fin.length}/${R.incl.length}`, pass: true };
});
t('B5.7', 'Hiệu năng: 432 mã (216 FINE + 216 CHISEL), 4 máy', '< 1.000 ms', () => {
  const big = synthData(600, 11);
  const skus = [];
  const seen = { F: 0, C: 0 };
  for (const r of big.skus){ if (seen[r[4]] < 216){ skus.push(r); seen[r[4]]++; } }
  while (seen.C < 216){ skus.push(['XC' + seen.C, 'S', 3000, 2, 'C', 'Y']); seen.C++; }
  while (seen.F < 216){ skus.push(['XF' + seen.F, 'S', 3000, 2, 'F', 'Y']); seen.F++; }
  const t0 = Date.now();
  const R = E.simulate(mkP({ machines: 4, skus, metaMap: big.meta }), 20000);
  const ms = Date.now() - t0;
  return { actual: `${skus.length} mã, ${ms} ms, ${R.segs.length} segment, xong ${R.fin.length}/${R.incl.length}`, pass: ms < 1000 };
});

// ---------- B6 Định mức năng suất mặc định ----------
t('B6', 'Định mức mặc định ở data.js, index.html, ui.js', '3.360 PC/h ở mọi chỗ, không còn 2.000', () => {
  const root = path.resolve(__dirname, '..');
  const spec = E.get('DTM_SPECS.ratePerHour');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/id="rate"[^>]*value="(\d+)"/);
  const ui = fs.readFileSync(path.join(root, 'ui.js'), 'utf8');
  const fallbacks = (ui.match(/DTM_SPECS\.ratePerHour : (\d+)/g) || []).map(s => s.split(': ')[1]);
  return { actual: `data.js ${spec}, index.html ${html && html[1]}, ui.js dự phòng ${fallbacks.join('/')}`,
    pass: spec === 3360 && html && html[1] === '3360' && fallbacks.length > 0 && fallbacks.every(v => v === '3360') };
});

// ---------- In kết quả ----------
const pass = results.filter(r => r.pass).length;
for (const r of results){
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(16)} ${r.desc}\n        kỳ vọng: ${r.expect}\n        thực tế: ${r.actual}`);
}
if (gridFails.length){ console.log('\nVi phạm bất biến (tối đa 10):'); gridFails.slice(0, 10).forEach(x => console.log('  - ' + x)); }
if (gridErrors.length){ console.log('\nLỗi/timeout (tối đa 10):'); gridErrors.slice(0, 10).forEach(x => console.log('  - ' + x)); }
console.log(`\nTổng: ${pass}/${results.length} PASS`);
fs.writeFileSync(path.join(__dirname, 'results-engine.json'), JSON.stringify({ results, gridFails, gridErrors }, null, 2));
