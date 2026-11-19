// Bản triển khai tĩnh không chứa dữ liệu sản xuất nội bộ.
// Người dùng nạp kế hoạch trực tiếp từ file Excel / CSV (lưu cục bộ trên trình duyệt).
// Cấu trúc mỗi dòng: [mã chạy, mã tham chiếu, SL còn lại (PC), ưu tiên (1-3), dòng ('F' | 'C'), trạng thái ('R' | 'Y' | 'W')]
const SKUS = [];

// Thông số cấu hình mặc định chung (người dùng có thể chỉnh trực tiếp trên giao diện)
const DTM_SPECS = {
  ratePerHour: 2000,
  activeMachines: ['M1', 'M2', 'M3'],
  backupMachines: ['M4'],
  minLotTransfer: 5000,
  setSizes: [25, 49, 73, 121, 169, 217],
  totalMasterColors: 217
};

// Vị trí màu dùng để tô thanh Gantt (HSL hue; -1 = nhóm xám/trung tính)
const HUE = {
  '0': -1, WG: -1, CG: -1, BGY: -1, GG: -1, '120': -1,
  Y: 55, YR: 25, R: 0, E: 30,
  YG: 85, G: 120, BG: 165,
  B: 215, BV: 245, V: 275, RV: 330
};

// Thứ tự vòng tròn màu (4 nhóm, khớp theo tiền tố dài nhất trước: BGY trước BG, GG trước G)
const COLOR_GROUPS = [
  { id: 'NEUTRAL_GRAY', name: 'Trung tính / Xám',  prefixes: ['0', 'WG', 'CG', 'BGY', 'GG', '120'] },
  { id: 'WARM',         name: 'Nhóm Nóng',         prefixes: ['Y', 'YR', 'R', 'E'] },
  { id: 'GREEN_CYAN',   name: 'Xanh lá – Xanh lơ', prefixes: ['YG', 'G', 'BG'] },
  { id: 'COOL_VIOLET',  name: 'Nhóm Lạnh – Tím',   prefixes: ['B', 'BV', 'V', 'RV'] }
];

// Thuộc tính mở rộng theo khóa 'F:CODE' hoặc 'C:CODE': { btp_ready_date, due_date, fixedMachine, stt }
const skuKey = (fam, code) => fam + ':' + code;
const SKU_META = {};
