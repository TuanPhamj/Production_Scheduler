// Kiểm thử phần đọc file kế hoạch của ui.js bản public (hàm parse thuần, không cần DOM).
// Chạy: node qa/import.test.js [đường-dẫn-file-xlsm-thật (tùy chọn)]
// Lưu ý: kết quả với file thật chỉ in SỐ ĐẾM, không in mã sản phẩm.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const XLSX = require(path.join(ROOT, 'lib', 'xlsx.full.min.js'));

// Nạp data.js + engine.js + đoạn hàm parse của ui.js (normTxt … findSheet)
const uiSrc = fs.readFileSync(path.join(ROOT, 'ui.js'), 'utf8');
const sliceFn = (from, to) => {
  const a = uiSrc.indexOf(from), b = uiSrc.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('Không tìm thấy đoạn ' + from);
  return uiSrc.slice(a, b);
};
const ctx = vm.createContext({
  console, XLSX,
  $: id => ({ checked: true, value: '2026-11-23' }),
  defaultStartIso: () => '2026-11-23'
});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'engine.js'), 'utf8'), ctx);
vm.runInContext(sliceFn('function normTxt(', 'const FAM_NAME'), ctx);
const call = (expr, args) => { ctx.__A = args; return vm.runInContext(expr, ctx); };

const results = [];
function t(id, desc, expect, fn){
  let actual, pass;
  try { const r = fn(); actual = r.actual; pass = r.pass; }
  catch (e){ actual = 'LỖI: ' + e.message; pass = false; }
  results.push({ id, desc, expect, actual: String(actual), pass });
}

// ---------- C1 Số ----------
const numCases = [
  ['12.000', 12000], ['1.500,5', 1500.5], ['12,000', 12000], ['1,5', 1.5], ['1.5', 1.5], [' 12 000 ', 12000],
  ['1.234.567', 1234567], ['1,234,567', 1234567], ['0,5', 0.5], ['abc', NaN], ['12000 PC', NaN], ['', NaN], ['-500', -500]
];
for (const [inp, exp] of numCases){
  t('C1 ' + JSON.stringify(inp), 'parseNumStrict', String(exp), () => {
    const v = call('parseNumStrict(__A)', inp);
    return { actual: String(v), pass: Number.isNaN(exp) ? Number.isNaN(v) : v === exp };
  });
}

// ---------- C2 Ngày ----------
const dateCases = [
  ['03/04/2026', '2026-04-03'], ['3/4/26', '2026-04-03'], ['31/02/2026', null], ['2026-12-15', '2026-12-15'],
  ['15.12.2026', '2026-12-15'], [46371, '2026-12-15'], [15, null], ['12/31/2026', null], ['', null]
];
for (const [inp, exp] of dateCases){
  t('C2 ' + JSON.stringify(inp), 'toIsoDate', String(exp), () => {
    const v = call('toIsoDate(__A)', inp);
    return { actual: String(v), pass: v === exp };
  });
}

// ---------- C3 Suy luận trạng thái ----------
const stCases = [
  // [ô trạng thái, ô BTP/ghi chú, SL đã SX, kỳ vọng st, mô tả]
  ['R', '', 0, 'R', 'Chữ R'],
  ['Đang chạy', '', 0, 'R', 'Chữ "Đang chạy"'],
  ['Đủ BTP', '', 0, 'Y', 'Chữ "Đủ BTP"'],
  ['W', '', 0, 'W', 'Chữ W'],
  ['Chờ BTP', '', 0, 'W', 'Chữ "Chờ BTP"'],
  ['Thiếu BTP', '', 0, 'W', 'Chữ "Thiếu BTP"'],
  ['Chờ vật tư', '', 0, 'Y', 'Chữ "Chờ vật tư" → Y theo quy ước (file có SL còn phải lắp = đủ BTP)'],
  ['Chờ', '', 0, 'Y', 'Chữ "Chờ" → Y theo quy ước'],
  ['', '', 0, 'Y', 'Ô trống → Y'],
  ['Chờ BTP', '', 3000, 'W', 'QUAN TRỌNG: "Chờ BTP" nhưng đã SX 3.000 PC (đang dở, hết BTP)'],
  ['W', '', 1, 'W', 'QUAN TRỌNG: W nhưng đã SX 1 PC'],
  ['Đủ BTP', '', 500, 'R', 'Đủ BTP và đã SX 500 PC → đang chạy dở'],
  ['', '', 500, 'R', 'Trống trạng thái, đã SX 500 PC → đang chạy dở'],
  ['2. Đang chạy', 'Chờ BTP', 500, 'W', 'Cột cảnh báo ghi "2. Đang chạy" nhưng cột trạng thái ghi "Chờ BTP" → W thắng'],
];
for (const [a, b, done, exp, desc] of stCases){
  t('C3 ' + JSON.stringify(a) + (b ? ' + ' + JSON.stringify(b) : '') + (done ? ' + đã SX ' + done : ''), desc, exp, () => {
    const r = call('inferStatusAndDelay(__A[0], __A[1], __A[2])', [a, b || a, done]);
    return { actual: r.st + (r.known ? '' : ' (không nhận ra)'), pass: r.st === exp };
  });
}

// ---------- C4 File CSV theo mẫu chuẩn ----------
const HEAD = 'Mã chạy,Mã SAP,SL còn phải lắp (PC),Cấp ưu tiên,Dòng bút,Trạng thái,Ngày đủ BTP,Hạn PO,Gắn máy,Ghi chú,STT (0–216)';
const ROWS = [
  'B02,000123,12.000,1,FINE,R,,15/12/2026,M1,,0',
  'G05,000124,"1.500,5",2,FINE,Đủ BTP,,03/04/2027,,,1',
  'Y02,000125,8000,2,FINE,Chờ BTP,25/11/2026,,M 2,,2',
  'YR05,000126,5000,2,FINE,Chờ vật tư,,,,,3',
  'B05,000127,3000,3,CHISEL,W,,,,,4',
  'B02,000123,2000,3,FINE,W,28/11/2026,10/12/2026,,,5',
  'E01,000128,abc,2,FINE,Y,,,,,6',
  'V05,000129,0,2,FINE,Y,,,,,7',
  'RV05,000130,4000,2,FINE,Y,,31/02/2026,,,8',
  'BG05,000131,4000,2,FINE,Y,,,M4,,9',
  'BV05,000132,4000,2,FINE,Y,,,Máy 3,,10'
];
const CSV = [HEAD].concat(ROWS).join('\r\n');
fs.writeFileSync(path.join(__dirname, 'fixtures', 'plan_utf8.csv'), '﻿' + CSV);
function parseCsvText(text, fileName = 'ke_hoach.csv', forcedFam = null){
  const wb = XLSX.read(String(text).replace(/^﻿/, ''), { type: 'string', raw: true });
  ctx.__WS = wb.Sheets[wb.SheetNames[0]];
  ctx.__FN = fileName; ctx.__FF = forcedFam;
  const r = vm.runInContext('parseFlatCsvSheet(__WS, __FN, "2026-11-23", __FF)', ctx);
  ctx.__IS = r.issues;
  r.summary = vm.runInContext('summarizeIssues([__IS])', ctx);
  return r;
}
const P1 = parseCsvText(CSV);
const row = (r, code, fam = 'F') => r.list.find(x => x[0] === code && x[4] === fam);
const meta = (r, code, fam = 'F') => r.metas[fam + ':' + code];
t('C4.1', 'SL "12.000" và Mã SAP "000123"', 'SL 12000 (+2000 dòng trùng = 14000), SAP giữ "000123"', () => {
  const x = row(P1, 'B02');
  return { actual: `SL ${x[2]}, SAP "${x[1]}"`, pass: x[2] === 14000 && x[1] === '000123' };
});
t('C4.2', 'Mã trùng B02 (R ưu tiên 1 + W ưu tiên 3)', 'Gộp: ưu tiên 1, hạn sớm nhất 10/12, trạng thái W, ngày BTP 28/11', () => {
  const x = row(P1, 'B02'), m = meta(P1, 'B02');
  return { actual: `pri ${x[3]}, st ${x[5]}, hạn ${m.due_date}, BTP ${m.btp_ready_date}`, pass: x[3] === 1 && x[5] === 'W' && m.due_date === '2026-12-10' && m.btp_ready_date === '2026-11-28' };
});
t('C4.3', 'SL "1.500,5" và hạn "03/04/2027"', 'SL 1501 (làm tròn), hạn 2027-04-03', () => {
  const x = row(P1, 'G05'), m = meta(P1, 'G05');
  return { actual: `SL ${x[2]}, hạn ${m.due_date}`, pass: x[2] === 1501 && m.due_date === '2027-04-03' };
});
t('C4.4', 'Ô gắn máy "M 2" (có dấu cách)', 'Nhận M2 hoặc cảnh báo ô không đọc được', () => {
  const m = meta(P1, 'Y02');
  const warned = P1.summary.warn.some(w => /máy/i.test(w));
  return { actual: `fixedMachine ${m.fixedMachine}, cảnh báo: ${warned ? 'có' : 'không'}`, pass: m.fixedMachine === 2 || warned };
});
t('C4.5', 'Ô gắn máy "M4"', 'Không gắn M4 nhưng phải có cảnh báo', () => {
  const m = meta(P1, 'BG05');
  const warned = P1.summary.warn.some(w => /máy|M4/i.test(w));
  return { actual: `fixedMachine ${m.fixedMachine}, cảnh báo: ${warned ? 'có' : 'không'}`, pass: m.fixedMachine == null && warned };
});
t('C4.6', 'Ô gắn máy "Máy 3"', 'fixedMachine = 3', () => {
  const m = meta(P1, 'BV05');
  return { actual: `fixedMachine ${m.fixedMachine}`, pass: m.fixedMachine === 3 };
});
t('C4.7', 'Trạng thái "Chờ vật tư" trong file có cột SL còn phải lắp', 'Y theo quy ước, ghi chú "coi là đủ BTP" (không phải cảnh báo)', () => {
  const x = row(P1, 'YR05');
  const warned = P1.summary.warn.some(w => w.includes('YR05') || w.includes('trạng thái'));
  const info = P1.summary.info.some(w => w.includes('coi là đủ BTP'));
  return { actual: `st ${x[5]}, cảnh báo trạng thái: ${warned ? 'có' : 'không'}, ghi chú quy ước: ${info ? 'có' : 'không'}`, pass: x[5] === 'Y' && !warned && info };
});
t('C4.11', 'Mã ghi "Chờ BTP" kèm ngày 25/11 trong file có cột SL còn phải lắp', 'Giữ W, ngày đủ BTP 25/11', () => {
  const x = row(P1, 'Y02'), m = meta(P1, 'Y02');
  return { actual: `st ${x[5]}, BTP ${m.btp_ready_date}`, pass: x[5] === 'W' && m.btp_ready_date === '2026-11-25' };
});
t('C4.8', 'SL "abc", SL 0, ngày 31/02/2026', 'Có cảnh báo SL lỗi + ngày sai; dòng SL 0 ghi "đã xong"', () => {
  const s = P1.summary;
  return { actual: 'warn: ' + s.warn.join(' | ') + ' · info: ' + s.info.join(' | '),
    pass: s.warn.some(w => w.includes('SL')) && s.warn.some(w => w.includes('ngày')) && s.info.some(w => w.includes('SL = 0')) };
});
t('C4.9', 'Dòng CHISEL trong file chung', 'B05 thuộc CHISEL', () => {
  const x = row(P1, 'B05', 'C');
  return { actual: x ? 'C ' + x[2] : 'không thấy', pass: Boolean(x) };
});
t('C4.10', 'Tổng SL đọc được', '14000 + 1501 + 8000 + 5000 + 3000 + 4000 + 4000 + 4000 = 43.501', () => {
  const tot = P1.list.reduce((s, r) => s + r[2], 0);
  return { actual: String(tot), pass: tot === 43501 };
});

// ---------- C5 Dấu phân cách ; ----------
t('C5', 'CSV dùng dấu ";" (Excel máy Việt Nam)', 'Đọc đúng như file dấu ","', () => {
  const semi = [HEAD.replace(/,/g, ';')].concat(ROWS.map(r => r.replace('"1.500,5"', '1.500,5').replace(/,/g, ';').replace('1.500;5', '"1.500,5"'))).join('\r\n');
  const r = parseCsvText(semi);
  return { actual: `${r.list.length} mã, tổng ${r.list.reduce((s, x) => s + x[2], 0)}`, pass: r.list.length === P1.list.length };
});

// ---------- C6 CSV lưu kiểu ANSI (Windows-1258) bị đọc như UTF-8 ----------
t('C6', 'CSV lưu "CSV (Comma delimited)" (mã ANSI tiếng Việt) thay vì "CSV UTF-8"', 'App từ chối file, hướng dẫn lưu lại bằng CSV UTF-8', () => {
  const p = path.join(__dirname, 'fixtures', 'plan_cp1258.csv');
  if (!fs.existsSync(p)) return { actual: 'thiếu fixture plan_cp1258.csv', pass: false };
  const text = new TextDecoder('utf-8').decode(fs.readFileSync(p)); // giống FileReader.readAsText(file, 'utf-8')
  const bad = text.includes(String.fromCharCode(0xFFFD));
  const guard = /includes\(String\.fromCharCode\(0xFFFD\)\)/.test(uiSrc) && uiSrc.includes('CSV UTF-8 (Comma delimited)');
  return { actual: `file có ký tự lỗi: ${bad ? 'có' : 'không'}; importExcelFile có chặn: ${guard ? 'có' : 'không'}`, pass: bad && guard };
});

// ---------- C7 Cột "Lũy kế đã SX" ----------
t('C7', 'File có cột "Lũy kế đã SX": mã "Chờ BTP" ngày 30/11 nhưng đã SX 3.000', 'Giữ W, ngày đủ BTP 30/11', () => {
  const csv = 'Mã chạy,Mã SAP,SL còn phải lắp (PC),Lũy kế đã SX,Dòng bút,Trạng thái,Ngày đủ BTP\r\nB02,1,5000,3000,FINE,Chờ BTP,30/11/2026';
  const r = parseCsvText(csv);
  const x = row(r, 'B02'), m = meta(r, 'B02');
  return { actual: `st ${x[5]}, ngày BTP ${m.btp_ready_date}`, pass: x[5] === 'W' && m.btp_ready_date === '2026-11-30' };
});

// ---------- C8 File không có tiêu đề ----------
t('C8', 'CSV không có dòng tiêu đề (theo thứ tự cột chuẩn)', 'Đọc theo vị trí cột', () => {
  const r = parseCsvText(ROWS.slice(0, 2).join('\r\n'));
  return { actual: `${r.list.length} mã: ${r.list.map(x => x[0] + '/' + x[2]).join(', ')}`, pass: r.list.length === 2 };
});

// ---------- C9 Thiếu cột bắt buộc ----------
t('C9', 'File có tiêu đề nhưng thiếu cột SL', 'Báo "Thiếu cột bắt buộc", không nạp', () => {
  const r = parseCsvText('Mã chạy,Mã SAP,Trạng thái\r\nB02,1,R');
  return { actual: `${r.list.length} mã; ${r.summary.warn.join(' | ')}`, pass: r.list.length === 0 && r.summary.warn.some(w => w.includes('Thiếu cột')) };
});

// ---------- C10 Các cách ghi ô "Gắn máy" ----------
t('C10', 'Ô gắn máy "M02", "Máy số 3", "abc"', 'M02 → 2, Máy số 3 → 3, "abc" bị bỏ qua có cảnh báo', () => {
  const csv = [HEAD].concat([
    'B02,1,1000,2,FINE,Y,,,M02,,0',
    'G02,2,1000,2,FINE,Y,,,Máy số 3,,1',
    'Y02,3,1000,2,FINE,Y,,,abc,,2'
  ]).join('\r\n');
  const r = parseCsvText(csv);
  const fm = c => (meta(r, c) || {}).fixedMachine;
  const warned = r.summary.warn.some(w => w.includes('Gắn máy') && w.includes('Y02'));
  return { actual: `B02 ${fm('B02')}, G02 ${fm('G02')}, Y02 ${fm('Y02')}, cảnh báo: ${warned ? 'có' : 'không'}`, pass: fm('B02') === 2 && fm('G02') === 3 && fm('Y02') == null && warned };
});

// ---------- C15 Đã gỡ "File mẫu" và "Xuất .csv" (yêu cầu 21/11/2026) ----------
t('C15', 'Giao diện không còn nút File mẫu / Xuất .csv', 'Không còn nút và hàm tương ứng; vẫn còn Xuất .xlsx', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const left = ['btnTemplate', 'btnExportCsv', 'downloadPlanTemplate', 'exportScheduleCsv', 'buildPlanTemplateWorkbook'].filter(k => html.includes(k) || uiSrc.includes(k));
  const xlsx = html.includes('btnExportXlsx') && uiSrc.includes('exportScheduleXlsx');
  return { actual: left.length ? 'còn: ' + left.join(', ') : 'đã gỡ hết; Xuất .xlsx ' + (xlsx ? 'còn' : 'MẤT'), pass: !left.length && xlsx };
});

// ---------- C12–C14 File khác định dạng mẫu (dạng file điều độ: STT | Mã sản phẩm | Mã SAP | Tên | Sản lượng cần sản xuất) ----------
const OTHER_HEAD = 'STT,Mã sản phẩm,Mã SAP,Tên sản phẩm,Sản lượng cần sản xuất';
const OTHER_ROWS = ['1,XX01,40000001,Bút mẫu 1,3500', '2,XX02,40000002,Bút mẫu 2,956', '3,XX03,40000003,Bút mẫu 3,1200'];
t('C12', 'CSV dạng file điều độ (có tiêu đề, không có cột "SL còn phải lắp")', 'Từ chối: "Thiếu cột bắt buộc: SL còn phải lắp"', () => {
  const r = parseCsvText([OTHER_HEAD].concat(OTHER_ROWS).join('\r\n'), 'LR_BUT_FINE.csv');
  return { actual: `${r.list.length} mã; ${r.summary.warn.join(' | ')}`, pass: r.list.length === 0 && r.summary.warn.some(w => w.includes('SL còn phải lắp')) };
});
t('C13', 'Cùng dữ liệu nhưng không có dòng tiêu đề (STT ở cột mã, mã SAP ở cột SL)', 'Từ chối, không lập lịch trên dữ liệu rác', () => {
  const r = parseCsvText(OTHER_ROWS.join('\r\n'), 'khong_tieu_de.csv');
  return { actual: `${r.list.length} mã; ${r.summary.warn.join(' | ')}`, pass: r.list.length === 0 && r.summary.warn.some(w => w.includes('đã hủy nhập')) };
});
t('C13b', 'File không tiêu đề nhưng đúng thứ tự cột mẫu, có mã 0 và 120 (mã toàn số hợp lệ)', 'Vẫn nhận (chỉ 2/4 mã toàn số)', () => {
  const r = parseCsvText(['0,S0,1000,2,FINE,Y', '120,S1,1000,2,FINE,Y', 'B02,S2,1000,2,FINE,Y', 'G02,S3,1000,2,FINE,Y'].join('\r\n'), 'ok.csv');
  return { actual: `${r.list.length} mã`, pass: r.list.length === 4 };
});
t('C14', 'Workbook có sheet "LR BÚT FINE" theo dạng file điều độ', 'Báo rõ sheet không có cột "SL còn phải lắp"', () => {
  const ws = XLSX.utils.aoa_to_sheet([OTHER_HEAD.split(',')].concat(OTHER_ROWS.map(r => r.split(','))));
  ctx.__WS = ws;
  const p = vm.runInContext('parsePlanSheet(__WS, "F", {}, "2026-11-23")', ctx);
  ctx.__IS = p.issues;
  const s = vm.runInContext('summarizeIssues([__IS])', ctx);
  return { actual: `${p.list.length} mã; ${s.warn.join(' | ')}`, pass: p.list.length === 0 && s.warn.some(w => w.includes('LR BÚT FINE')) };
});
t('C14b', 'Sheet "LR BÚT FINE" thiếu cột "SL còn phải lắp" nhưng cột J (index 9) có số dương', 'Từ chối, không đọc nhầm cột J', () => {
  const rows10 = [
    ['STT', 'Mã sản phẩm', 'Mã SAP', 'Tên', 'C4', 'C5', 'C6', 'C7', 'C8', 'Số khác'],
    [], [],
    [1, 'B02', 'S1', 'Bút 1', 0, 0, 0, 0, 0, 12000]
  ];
  ctx.__WS = XLSX.utils.aoa_to_sheet(rows10);
  const p = vm.runInContext('parsePlanSheet(__WS, "F", {}, "2026-11-23")', ctx);
  ctx.__IS = p.issues;
  const s = vm.runInContext('summarizeIssues([__IS])', ctx);
  return { actual: `${p.list.length} mã; ${s.warn.join(' | ')}`, pass: p.list.length === 0 && s.warn.some(w => w.includes('LR BÚT FINE')) };
});

// ---------- C11 File thật của xưởng (tùy chọn, chỉ in số đếm) ----------
const realPath = process.argv[2];
if (realPath && fs.existsSync(realPath)){
  t('C11', 'File Excel thật của planner (chỉ in số đếm)', 'Đọc được, hoặc từ chối kèm lý do rõ ràng (không nạp dữ liệu rác)', () => {
    const wb = XLSX.read(fs.readFileSync(realPath), { type: 'buffer' });
    ctx.__WB = wb;
    const out = vm.runInContext(`(() => {
      const shF = findSheet(__WB, 'LR BUT FINE'), shC = findSheet(__WB, 'LR BUT CHISEL');
      const res = { sheets: __WB.SheetNames.length, hasF: !!shF, hasC: !!shC };
      const one = (sh, fam, btpName) => {
        if (!sh) return null;
        const p = parsePlanSheet(sh, fam, parseBtpSheet(findSheet(__WB, btpName)), '2026-11-23');
        const s = summarizeIssues([p.issues]);
        return { n: p.list.length, pcs: p.list.reduce((a, r) => a + r[2], 0),
          R: p.list.filter(r => r[5] === 'R').length, Y: p.list.filter(r => r[5] === 'Y').length, W: p.list.filter(r => r[5] === 'W').length,
          due: Object.values(p.metas).filter(m => m.due_date).length, warn: s.warn.length, info: s.info.length, layout: p.issues.layout.length };
      };
      res.F = one(shF, 'F', 'DONG_BO_BTP_FINE');
      res.C = one(shC, 'C', 'DONG_BO_BTP_CHISEL');
      if (!shF && !shC){
        const p = parseFlatCsvSheet(__WB.Sheets[__WB.SheetNames[0]], 'file.xlsm', '2026-11-23', null);
        res.flat = { n: p.list.length };
      }
      return res;
    })()`, ctx);
    const readOk = Boolean((out.F && out.F.n) || (out.C && out.C.n) || (out.flat && out.flat.n));
    const clearReject = Boolean((out.F && out.F.layout) && (!out.hasC || (out.C && out.C.layout)));
    return { actual: JSON.stringify(out), pass: readOk || clearReject };
  });
}

const pass = results.filter(r => r.pass).length;
for (const r of results){
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(22)} ${r.desc}\n        kỳ vọng: ${r.expect}\n        thực tế: ${r.actual}`);
}
console.log(`\nTổng: ${pass}/${results.length} PASS`);
fs.writeFileSync(path.join(__dirname, 'results-import.json'), JSON.stringify(results, null, 2));
