# Báo cáo kiểm tra bản public trước khi dùng thực tế dưới xưởng

- **Phiên bản kiểm tra:** repo `Production_Scheduler`, nhánh `main`, commit `54292ef` (trùng khớp thư mục `deploy-vercel/`)
- **Ngày kiểm tra:** 21/11/2026
- **Phạm vi:** `engine.js` (logic lập lịch), `ui.js` (đọc file, lưu dữ liệu, KPI, lệnh SX), chạy thử trên trình duyệt
- **Dữ liệu dùng để kiểm thử:** dữ liệu giả lập. File Excel điều độ thật chỉ dùng để đếm số dòng; báo cáo không ghi mã sản phẩm thật nào.
- **Cập nhật lần 2 (21/11/2026), theo 2 quyết định của planner:**
  - File có cột "SL còn phải lắp" được coi là đã đủ BTP.
  - Năng suất xưởng là **3.360 PC/h** (56 PC/phút).
  - Đã sửa L01, L02, L04, L05 trong `deploy-vercel/` (**chưa commit / chưa push**: trang Vercel vẫn là bản cũ). L03 đóng theo quy ước mới.
- **Cập nhật lần 3 (21/11/2026), theo quyết định của planner:**
  - Gỡ thẻ "bộ túi" (L06).
  - Ô Gắn máy nhận thêm cách ghi và có cảnh báo (L07).
  - Bỏ "FINE trước CHISEL", thay bằng **file tải lên trước chạy trước** (thay L08).
  - Độ đậm màu đọc theo bảng **Tổng màu**.
  - Gỡ nút "File mẫu" và "Xuất .csv".

## 1. Kết luận

**Chạy song song: GO có điều kiện.** **Thay thế cách lập kế hoạch hiện tại: chưa** (cần chạy song song đạt yêu cầu, và planner xác nhận phút đổi màu đo thực tế ở mục 4).

1. **Lõi lập lịch đúng và ổn định.**
   - Đúng các quy tắc: ca, Chủ nhật, cổng BTP, thứ tự file tải lên, máy cố định, máy dự phòng, cảnh báo PO.
   - Độ đậm màu nay đọc đúng theo bảng Tổng màu: phần số sau chữ số đầu, càng lớn càng đậm.
   - Chạy 3.072 tổ hợp tham số: không treo, không vi phạm bất biến nào.
   - 432 mã: tính và vẽ xong trong khoảng 130 ms.
2. **Hai lỗi P0 ở khâu nhập file đã sửa:**
   - Mã ghi rõ "Chờ BTP" / W luôn được giữ là W, kể cả mã đã lắp dở.
   - File khác định dạng mẫu (gồm cả file điều độ hiện tại) bị từ chối, kèm lý do rõ ràng. Dữ liệu cũ được giữ nguyên.
3. **Năng suất mặc định nay là 3.360 PC/h.** Máy đã lưu số cũ (2.000 / 2.520) tự chuyển sang 3.360 một lần. Năng suất planner tự chỉnh sau đó vẫn được giữ.
4. **File CSV không phải UTF-8 bị từ chối** và có hướng dẫn lưu lại. Mã không ghi chờ BTP được tính là đủ BTP theo quy ước, ghi thành một dòng thông tin.

**Điều kiện để chạy song song:**
- Commit và push bản sửa lên GitHub, chờ Vercel cập nhật, rồi kiểm tra ô năng suất trên trang hiển thị 3.360.
- File kế hoạch phải có dòng tiêu đề với cột **"Mã chạy"** (hoặc "Mã sản phẩm") và **"SL còn phải lắp"**. Lưu dạng `.xlsx` hoặc **CSV UTF-8**.
- Nạp file theo đúng thứ tự muốn chạy: dòng bút nào cần chạy trước thì nạp trước. Kiểm tra nhãn "Chạy trước / Chạy sau" trên đầu trang.
- Mã thật sự chờ BTP phải ghi `W` hoặc "Chờ BTP", kèm ngày đủ BTP.
- Đọc dòng cảnh báo sau mỗi lần nhập file.
- Đối chiếu lệnh SX của app với lệnh SX hiện tại trước khi phát xuống chuyền.

## 2. Danh sách lỗi

Mức lỗi:
- **P0:** có thể làm xưởng chạy sai, mất dữ liệu hoặc treo app.
- **P1:** số liệu sai hoặc thiếu cảnh báo quan trọng.
- **P2:** khó dùng, hoặc thiếu chức năng cho vận hành.
- **P3:** nhỏ, hiện chưa xảy ra được qua giao diện.

| ID | Mức | Chỗ trong code | Cách tái hiện | Mong đợi | Thực tế | Ảnh hưởng dưới xưởng | Đề xuất sửa | Xác minh |
|---|---|---|---|---|---|---|---|---|
| L01 | **P0** | `ui.js:1464` (`inferStatusAndDelay`), dùng ở `:1637`, `:1752`; `:1639` | File có cột "Lũy kế đã SX" > 0 và trạng thái "Chờ BTP" / W, ngày đủ BTP 30/11 | Giữ W, chạy từ 30/11 | Thành **R**, bỏ ngày BTP, xếp chạy ngay. Sheet DONG_BO_BTP báo thiếu cũng bị bỏ qua | Lệnh SX bảo chạy mã đang thiếu cấu phần. Mã chạy dở rồi hết BTP là chuyện thường gặp | **✅ Đã sửa:** W / Chờ BTP luôn thắng. "Đã SX > 0" chỉ nâng mã không ghi W lên R. Sheet BTP báo thiếu thì vẫn là W | Test C3, C7 (PASS) |
| L02 | **P0** | `ui.js:1662–1671` (nhận dạng tiêu đề), `parsePlanSheet` `:1595` | Lấy file điều độ hiện tại (cột: STT \| Mã sản phẩm \| Mã SAP \| Tên sản phẩm \| Sản lượng cần sản xuất) | Đọc đúng, hoặc từ chối kèm lý do rõ ràng | **Nhập `.xlsm`:** 0 mã, báo lỗi chung chung. **Lưu sheet thành CSV:** app **nhận file**, lấy cột STT làm mã và mã SAP làm SL (70 mã, mỗi mã khoảng 40 triệu PC, tổng 2,8 tỷ PC) | Kế hoạch rác vẫn được lưu và in lệnh. File thật của xưởng không dùng được trực tiếp | **✅ Đã sửa:** nhận tiêu đề "Mã sản phẩm". Không có cột "SL còn phải lắp" → báo "Thiếu cột bắt buộc". File không có tiêu đề mà mã toàn số hoặc SL > 1 triệu PC → hủy nhập. Sheet LR BÚT sai bố cục → báo rõ và không xóa dữ liệu dòng bút đó. (Chưa làm: bảng xem trước tổng SL) | Test C11–C14 (PASS), trình duyệt |
| L03 | P1 | `ui.js:1476–1478` | Trạng thái "Chờ vật tư", "Chờ", ô trống | W, hoặc chặn nhập | Thành **Y (đủ BTP)**, chỉ ghi 1 dòng cảnh báo | Mã chưa đủ vật tư được xếp chạy | **Đóng theo quy ước xưởng 21/11/2026:** file có cột "SL còn phải lắp" = đủ BTP. Mã không ghi W thành Y, kèm dòng thông tin "N mã không ghi chờ BTP → coi là đủ BTP" | Test C3, C4.7 (PASS) |
| L04 | P1 | `ui.js:1998`, `:2010` | Excel lưu "CSV (Comma delimited)" (mã ANSI) thay vì "CSV UTF-8" | Báo lỗi bảng mã | Chữ tiếng Việt bị hỏng, "Chờ BTP" thành **Y**. Dòng tiêu đề bị coi là dữ liệu lỗi | Mã chờ BTP thành mã sẵn sàng | **✅ Đã sửa:** thấy ký tự lỗi (U+FFFD) → từ chối, hướng dẫn lưu "CSV UTF-8 (Comma delimited)", giữ nguyên dữ liệu | Test C6 (PASS), trình duyệt |
| L05 | P1 | `data.js:8`, `index.html` (ô `rate` = 2000), `ui.js:239`, `:310` | Mở app trên trình duyệt / máy mới | 3.360 PC/h (định mức xưởng cập nhật 21/11/2026) | 2.000 PC/h. Có lưu lại sau khi sửa, nhưng mỗi máy, mỗi trình duyệt mới lại về 2.000 | Ngày xong và tải máy lệch nhiều so với thực tế | **✅ Đã sửa:** mặc định 3.360 ở `data.js`, `index.html`, `ui.js`. Tham số lưu bản cũ (chưa có `v: 2`) bỏ qua ô năng suất một lần | Test B6 (PASS), trình duyệt |
| L06 | P1 | `ui.js:441–473` (`calcBagSetKpi`) | Nhập file chỉ có 8 mã | Không kết luận được khi thiếu số tồn kho | Hiện "**Đạt bộ 217 (217/217 màu)**", coi 209 màu không có trong file là "đã đủ tồn kho". Gộp FINE và CHISEL làm một | Quản lý có thể tin nhầm là đủ bộ | **✅ Đã gỡ thẻ** (quyết định planner 21/11/2026) | Trình duyệt (lần 3) |
| L07 | P1 | `ui.js:1773`; `engine.js:350` | Ô gắn máy "M 2", "M02", "M4"; hoặc gắn M3 khi chỉ bật 2 máy | Nhận đúng, hoặc cảnh báo | Bỏ qua **không cảnh báo**, mã được xếp máy bất kỳ. Trường hợp M3 khi chỉ bật 2 máy: chỉ hiện "(đang tắt)" trong bảng mã | Mã cần máy riêng bị chạy máy khác | **✅ Đã sửa:** nhận M1 / M 1 / M01 / Máy 1 / Máy số 1 / 1. Ô M4 hoặc không đọc được → cảnh báo khi nhập file. Mã gắn máy đang tắt → cảnh báo ở dòng ghi chú dưới bảng mã | Test C4.4, C4.5, C10, B2.7b (PASS), trình duyệt |
| L08 | P1 (cần planner quyết) | `engine.js:276`, `:486–497` | 2 máy, 1 mã CHISEL đang chạy (R) cùng 3 mã FINE Y | Mã đang chạy được chạy tiếp trên máy hiện tại | CHISEL R bị xếp **sau** FINE (sang Ca 2), có thể sang máy khác, thêm 60 phút đổi dòng | Lệnh SX bảo dừng mã đang chạy dở | **Thay bằng quy tắc mới (planner 21/11/2026):** bỏ "FINE trước CHISEL"; dòng bút có file tải lên trước chạy trước, nhãn "Chạy trước / Chạy sau" trên đầu trang. Muốn mã CHISEL đang chạy dở được chạy tiếp thì nạp file CHISEL trước. (Mã R vẫn chưa gắn được "máy đang chạy") | Test B2.5d–g (PASS), trình duyệt |
| L09 | P2 | `engine.js:678` | Mã chạy Ca 3 ngày đến hạn, xong lúc 5h sáng hôm sau | Trễ 1 ngày | Không trễ (điểm mở đã biết) | Cảnh báo PO lạc quan | Tính trễ theo giờ kết thúc thực | Test B2.9d |
| L10 | P2 | `ui.js:155`, `:178` | Mở app vào tuần sau | Ngày bắt đầu là hôm nay, hoặc có cảnh báo | Giữ ngày bắt đầu cũ, không cảnh báo | Lệnh SX ghi ngày đã qua | Cảnh báo khi ngày bắt đầu < hôm nay | Trình duyệt |
| L11 | P2 | `ui.js:2264–2292` | Nhập SL thực tế rồi chạy lại | Rõ ràng việc lịch có thay đổi hay không | SL thực tế chỉ để theo dõi, **không trừ** vào SL còn lại | Muốn lập lại kế hoạch phải nhập lại file đã cập nhật | Ghi rõ quy trình, hoặc thêm nút "trừ SL thực tế" | Đọc code |
| L12 | P2 | `engine.js:81–113` | Tuần có ngày lễ / Tết | Ngày nghỉ không có ca | Chỉ nghỉ Chủ nhật | Lịch xếp việc vào ngày nghỉ | Thêm danh sách ngày nghỉ | Đọc code |
| L13 | P2 | `ui.js:133–175` | Dữ liệu lưu trên trình duyệt có 1 dòng hỏng | Giữ phần còn lại, có bản sao lưu | **Xóa toàn bộ** dữ liệu đã lưu | Mất kế hoạch, mất SL thực tế đã nhập tay | Giữ bản sao trước khi xóa. Xuất file hằng ngày | Đọc code |
| L14 | P3 | `engine.js:344`, `:539` | Mã SL = 0 lọt vào lịch | Bỏ qua | Vẫn tính 25 phút đổi màu | Hiện chưa xảy ra được qua giao diện (nhập file đã bỏ SL 0) | Lọc `rem0 = 0` trong engine | Test B2.10 |
| L15 | P3 | `engine.js:711–715` | Lịch có mã W chờ BTP xa | — | "Hiệu suất máy 7,5%", "Giờ máy rảnh 268 h" | KPI dễ hiểu nhầm | Tách riêng giờ chờ BTP cuối lịch | Trình duyệt |
| L16 | P3 (cần planner quyết) | `engine.js:443` | 4 máy, tải nặng | M4 chỉ là máy dự phòng | Sau 480 phút M4 nhận việc như một máy chính | Đúng code, cần xem có đúng ý muốn | Planner xác nhận | Test B2.6b |

**Đã sửa so với danh sách điểm mở trước đây (xác minh ở bản public):**
- Mã / SAP được escape ở lệnh SX, KPI nút thắt và tooltip.
- Phút đổi màu xuất Excel theo từng dòng.
- Tham số kịch bản được lưu.

## 3. Kết quả kiểm thử

| Bộ test | Kết quả | Lệnh chạy lại |
|---|---|---|
| Engine (`qa/engine.test.js`) | **89/90 PASS**, tính với 56 PC/phút (FAIL còn lại: B2.10 → L14) | `node qa/engine.test.js` |
| Nhập file (`qa/import.test.js`) | **57/57 PASS**; **58/58** khi chạy kèm file thật | `node qa/import.test.js [đường-dẫn-file.xlsm]` |
| Trình duyệt (lần 2) | Đạt: năng suất 3.360 và tự chuyển từ số cũ; từ chối CSV ANSI, file dạng điều độ, file không tiêu đề; dữ liệu cũ giữ nguyên; không lỗi console | Mở `index.html` qua server tĩnh |
| Trình duyệt (lần 3) | Đạt: nạp CHISEL trước rồi FINE → nhãn "Chạy trước · CHISEL / Chạy sau · FINE", CHISEL xếp trước, giữ sau khi tải lại; "M 3" nhận M3, "M4" có cảnh báo; bật 2 máy → cảnh báo mã gắn M3; đã gỡ thẻ bộ túi, nút File mẫu, nút Xuất .csv; không lỗi console | Mở `index.html` qua server tĩnh |

### Đã đạt

- **Ca và lịch:**
  - 25.200 PC chạy đúng 450 phút (56 PC/phút), vừa trọn Ca 1.
  - T7 có Ca 3 (22:00 → 06:00 CN), ngày Chủ nhật không có ca.
  - Bắt đầu vào Chủ nhật thì lịch tính từ T2. Tắt "Nghỉ Chủ nhật" thì có thêm ca ngày CN.
- **Ngưỡng cuối ca:** chỉ còn 10 phút chạy thì dời mã sang ca sau. Mã chạy xong được trong ca thì cho chạy.
- **Cổng BTP trong engine:**
  - Ngày đủ BTP nhập tay; số ngày chờ mặc định (`waitDays`), kể cả khi qua Chủ nhật; ngày đủ BTP rơi vào CN thì chạy từ T2; ngày đủ BTP đã qua thì chạy ngay.
  - Kéo sớm mã W có gắn cờ.
  - Mã có ngày BTP nhập tay không bị kéo sớm.
- **Thứ tự file tải lên:**
  - Dòng bút nạp trước chạy trước, chỉ đổi dòng 1 lần. Một file có cả 2 dòng thì dòng xuất hiện trước chạy trước.
  - Mã của file trước chưa đủ BTP thì máy chạy mã của file sau thay vì đứng chờ.
  - Máy chờ mã kế tiếp của file trước nếu ≤ 120 phút.
- **Máy:** M4 không nhận việc khi tải nhẹ. Mã gắn máy chạy đúng máy.
- **Thứ tự và PO:**
  - Ưu tiên gấp, xếp theo STT / theo SL, thứ tự R → Y → W đều đúng.
  - Trễ PO, chưa xong trong 60 ngày, bị loại khỏi lịch: đều được cảnh báo.
- **Đổi màu:**
  - 19 cặp mã, 18 tiền tố màu, 9 mã kiểm tra độ đậm đều đúng theo quy tắc đọc từ bảng Tổng màu.
  - Cả 217 mã trong bảng đều nhận được nhóm màu (đã thêm nhóm xám `YGY`).
- **Độ bền:**
  - 3.072 tổ hợp tham số × 60 mã: 0 lỗi, 0 vi phạm bất biến, lâu nhất 10 ms.
  - Kết quả tất định (chạy lại ra y hệt).
  - Dữ liệu biên: danh sách rỗng, SL âm hoặc chữ, tắt hết ca, năng suất 60 PC/h, đổi màu 0 phút.
- **Nhập file:**
  - Số `12.000`, `1.500,5`, `12,000`, `1,5`. Ngày `03/04/2026` hiểu là 3/4; ngày sai bị báo.
  - Mã SAP giữ số 0 ở đầu. Mã trùng được gộp đúng quy tắc.
  - CSV dấu `;`, CSV không có tiêu đề, file thiếu cột bắt buộc.
  - Ô Gắn máy: `M 2`, `M02`, `Máy số 3` nhận đúng; `M4` và chữ lạ có cảnh báo.
- **Trình duyệt:**
  - Mã chứa thẻ HTML không chạy được ở bất kỳ màn hình nào.
  - Nạp riêng CHISEL thì giữ nguyên FINE.
  - Tải lại trang vẫn còn dữ liệu, năng suất đã chỉnh và SL thực tế nhập tay.
  - 432 mã chiếm 71 KB bộ nhớ trình duyệt.

## 4. Giả định cần planner xác nhận

1. ~~Độ đậm màu~~ → **Đã xác định từ bảng Tổng màu**:
   - Mã = tiền tố + 1 chữ số dãy màu + **số độ đậm 0–16**, số càng lớn càng đậm. Ví dụ R014: dãy 0, độ đậm 14 (đỏ đậm); R16: dãy 1, độ đậm 6.
   - Đo màu đầu bút trên hình vẽ của bảng, đủ 217 mã: độ tương quan 0,60–0,96 trong từng nhóm (0,71 chung), trong khi chữ số đầu chỉ có 0,04.
   - Ngưỡng theo số đo: độ đậm ≤ 3 là rất nhạt (cả 35 mã đều sáng, L* ≥ 75); ≥ 14 là đậm (L* trung bình 41–50). Độ đậm 13 (L* trung bình 63) chưa tính là đậm. Nhóm xám `YGY` trước đây app chưa biết, nay đã thêm.
   - Giới hạn: màu vàng / vàng xanh tự nhiên sáng, nên vài mã độ đậm 9–12 (vd Y09, YG111) vẫn rất sáng mà app không coi là "rất nhạt".
2. ~~Năng suất~~ → **Đã chốt 3.360 PC/h** (21/11/2026). Còn lại: có đúng cho mọi mã, cả FINE lẫn CHISEL không?
3. **Phút đổi màu 9 / 15 / 25 / 60** đã được đo thực tế chưa? (Nên đối chiếu với tài liệu hướng dẫn đổi màu SMED của xưởng.)
4. ~~Mã đang chạy (R)~~ → **Đã chốt:** bỏ "FINE trước CHISEL", file tải lên trước chạy trước.
5. ~~Trạng thái không rõ~~ → **Đã chốt:** file có cột "SL còn phải lắp" = đủ BTP. Chỉ mã ghi rõ W / Chờ BTP mới phải chờ.
6. ~~Thẻ "bộ túi"~~ → **Đã gỡ.**
7. **Ca 3** mặc định tắt (tăng ca). Có đúng với kế hoạch thường ngày không?
8. **File đầu vào chính thức:** app bắt buộc có cột "SL còn phải lắp". File điều độ Excel hiện tại (cột "Sản lượng cần sản xuất") bị từ chối. Chỉ cần quyết nếu muốn nạp thẳng file đó.

## 5. Checklist trước khi dùng thật

- [x] Sửa L01, L02, L04, L05. Đóng L03 theo quy ước xưởng.
- [x] L06 (gỡ thẻ), L07 (sửa), L08 (thay bằng thứ tự file tải lên), độ đậm màu theo bảng Tổng màu.
- [ ] Commit và push `deploy-vercel/` lên GitHub, chờ Vercel cập nhật, mở trang kiểm tra ô năng suất = 3.360.
- [ ] Chạy lại `node qa/engine.test.js` và `node qa/import.test.js`: toàn bộ PASS, hoặc ghi rõ ca nào được chấp nhận (hiện chấp nhận B2.10 → L14, chưa xảy ra được qua giao diện).
- [ ] Gắn tag phiên bản trên GitHub. Ghi rõ link Vercel chính thức cho xưởng.
- [ ] Mỗi máy dùng app: kiểm tra năng suất 3.360, Ca 3, ngày bắt đầu.
- [ ] Chạy song song 1–2 tuần, so lệnh SX của app với lệnh SX hiện tại. Tiêu chí: không có mã chờ BTP nào bị xếp chạy; ngày xong lệch ≤ 1 ca.
- [ ] Sao lưu hằng ngày: bấm "Xuất .xlsx" cuối ngày (dữ liệu chỉ nằm trong trình duyệt của từng máy).
- [ ] Phương án dự phòng khi app lỗi: dùng lại file Excel / VBA hiện tại.
- [ ] Phân công người nhập file kế hoạch và người nhập SL thực tế. Đào tạo cách đọc dòng cảnh báo.
