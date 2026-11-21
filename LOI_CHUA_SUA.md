# Lỗi và hạn chế chưa sửa

- **Cập nhật:** 21/11/2026.
- **Báo cáo kiểm tra đầy đủ:** [`qa/BAO_CAO_KIEM_TRA_TRUOC_TRIEN_KHAI.md`](qa/BAO_CAO_KIEM_TRA_TRUOC_TRIEN_KHAI.md).
- **Chạy lại bộ test:** `node qa/engine.test.js` và `node qa/import.test.js`.

Mức lỗi:
- **P2:** khó dùng hoặc thiếu chức năng cho vận hành.
- **P3:** nhỏ, hoặc hiện chưa xảy ra được qua giao diện.

## Lỗi chưa sửa

| ID | Mức | Vấn đề | Ảnh hưởng | Cách xử lý tạm | Chỗ trong code |
|---|---|---|---|---|---|
| L09 | P2 | Mã chạy Ca 3 xong sau 0h vẫn được tính là xong vào ngày bắt đầu ca | Mã xong lúc 5h sáng hôm sau hạn PO vẫn báo "đúng hạn" | Mã có hạn PO sát ngày thì kiểm tra tay giờ kết thúc Ca 3 | `engine.js` → `simulate` (tính trễ theo `endDay`) |
| L10 | P2 | Ngày bắt đầu lịch được giữ từ lần dùng trước, không tự lấy ngày hôm nay, cũng không cảnh báo khi đã cũ | Lệnh SX có thể ghi những ngày đã qua | Mỗi lần mở app, kiểm tra ô "Ngày bắt đầu" | `ui.js` → `loadStoredData`, `loadUiPrefs` |
| L11 | P2 | SL thực tế nhập ở ô theo dõi **không trừ** vào SL còn lại | Bấm chạy lại không làm lịch thay đổi theo sản lượng đã làm | Cập nhật cột "SL còn phải lắp" trong file rồi nạp lại | `ui.js` → `renderDailyTracker` |
| L12 | P2 | Chưa có lịch nghỉ lễ / Tết, chỉ nghỉ Chủ nhật | Lịch vẫn xếp việc vào ngày lễ | Tuần có ngày lễ thì tắt ca hoặc đổi ngày bắt đầu | `engine.js` → `buildSlots` |
| L13 | P2 | Dữ liệu lưu trên trình duyệt chỉ cần hỏng 1 dòng là bị **xóa toàn bộ**, không có bản sao | Mất kế hoạch và SL thực tế nhập tay | Cuối ngày bấm "Xuất .xlsx" để sao lưu | `ui.js` → `loadStoredData` |
| L14 | P3 | Engine vẫn tính đổi màu cho mã có SL = 0 | Hiện chưa xảy ra được (khi nhập file, dòng SL = 0 đã bị bỏ) | Không cần | `engine.js` → `simulate` |
| L15 | P3 | KPI "Hiệu suất máy" và "Giờ máy rảnh" bị kéo lệch khi có mã chờ BTP xa | KPI dễ hiểu nhầm (hiệu suất thấp bất thường) | Xem Gantt để biết máy rảnh vì sao | `engine.js` → `simulate` (`availMin`) |
| L16 | P3 | Tải nặng thì sau 480 phút M4 nhận việc như một máy chính | Cần planner xác nhận có đúng ý muốn không | Không bật M4 nếu không dùng | `engine.js` → `simulate` (`backupDelay`) |

## Hạn chế đã biết (chưa làm)

- **Mã đang chạy (R):** chưa biết mã đang nằm trên máy nào. Muốn mã đang chạy dở được chạy tiếp thì nạp file của dòng bút đó trước (quy tắc file tải lên trước chạy trước).
- **Độ đậm màu:** đọc theo phần số sau chữ số đầu của mã (≤ 3 rất nhạt, ≥ 14 đậm), đã đo trên bảng 217 màu. Màu vàng / vàng xanh tự nhiên sáng, nên vài mã độ đậm 9–12 (vd Y09, YG111) nhìn vẫn rất nhạt mà app không coi là "rất nhạt".
- **Phút đổi màu 9 / 15 / 25 / 60:** chưa đối chiếu với số đo thực tế (tài liệu SMED).
- **Hệ số OEE:** chưa có, nên kế hoạch luôn lạc quan hơn thực tế.
- **Lô chuyển tối thiểu 5.000 PC:** chưa áp dụng, chỉ đánh dấu "lô nhỏ".
- **Ngày đủ BTP suy ra từ mã 4A / 4B / 4C:** được tính lại theo ngày bắt đầu lịch mỗi lần đổi ngày bắt đầu.
- **Trục giờ của Gantt theo ngày:** luôn coi Ca 1 là ca đầu ngày.
- **File điều độ Excel hiện tại (cột "Sản lượng cần sản xuất"):** bị từ chối. App chỉ nhận file có cột **"SL còn phải lắp"**. Cần planner quyết có cho đọc thẳng file này không.
- **Ca 3:** mặc định tắt (tăng ca). Cần xác nhận có đúng với kế hoạch thường ngày không.
- **Dữ liệu chỉ nằm trong trình duyệt của từng máy:** máy khác không thấy, và xóa dữ liệu trình duyệt là mất.
- **Thay dữ liệu khi nhập file:** chưa có bảng xem trước tổng SL trước khi thay.
