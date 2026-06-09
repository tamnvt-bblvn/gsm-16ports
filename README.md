# GSM OTP Service (16 cổng)

Service Windows-native quản lý 16 modem GSM qua USB (COM3–COM18), nhận SMS realtime, tách OTP, lưu PostgreSQL và cung cấp REST API + dashboard hiện đại. Có thể gửi SMS, đẩy OTP qua webhook và bảo vệ API bằng API key.

## Tính năng

- Quản lý 16 modem GSM với auto-reconnect, health check, kết nối so le (stagger)
- Nhận SMS realtime qua `AT+CNMI=2,2,0,0,0` (không polling)
- Đồng bộ tin nhắn đã lưu trên SIM khi cắm lại (`AT+CMGL`)
- Tự động tách OTP (4–8 chữ số) + ưu tiên theo từ khóa
- **Gửi SMS** qua `AT+CMGS` từ API hoặc dashboard
- **OTP webhook**: POST JSON tới URL cấu hình mỗi khi có OTP mới
- PostgreSQL persistence + chống trùng (dedup)
- REST API có phân trang & tìm kiếm, Swagger/OpenAPI
- Long-poll `POST /api/wait-otp` cho automation
- Health check `GET /api/health` (database + đội modem)
- **Bảo mật**: API key guard (bật/tắt qua env), rate limit, Helmet, CORS cấu hình
- Web dashboard realtime (WebSocket): theme sáng/tối, tìm kiếm + phân trang SMS, chi tiết modem, gửi SMS, copy OTP, toast

## Yêu cầu

- Windows 10/11
- Node.js 20.19+ / 22.12+ / 24+ (khuyến nghị LTS mới nhất)
- pnpm 10+ (`corepack enable` rồi `corepack prepare pnpm@latest --activate`)
- PostgreSQL 15+ (native hoặc Docker)
- Thiết bị GSM 16 cổng với driver USB (COM3–COM18)

## Cài đặt nhanh

### 1. Cài dependency

```bash
cd gsm-16ports
pnpm install
```

### 2. Khởi động PostgreSQL

```bash
docker compose up -d
```

Hoặc dùng PostgreSQL cài sẵn trên Windows.

### 3. Cấu hình môi trường

```bash
copy .env.example .env
```

Các biến chính (xem đầy đủ trong `.env.example`):

| Biến | Mặc định | Mô tả |
|------|----------|-------|
| `DATABASE_URL` | — | Chuỗi kết nối PostgreSQL |
| `PORT` | `3000` | Cổng HTTP |
| `LOG_LEVEL` | `info` | `trace`…`fatal` |
| `API_AUTH_ENABLED` | `false` | Bật API key cho mọi `/api/*` |
| `API_KEYS` | — | Danh sách key, gửi qua header `x-api-key` |
| `CORS_ORIGINS` | `*` | Danh sách origin, phẩy ngăn cách |
| `THROTTLE_TTL` / `THROTTLE_LIMIT` | `60` / `120` | Rate limit (giây / số request) |
| `OTP_WEBHOOK_URL` | — | URL nhận OTP qua POST |
| `SWAGGER_ENABLED` | `true` | Bật/tắt `/api/docs` |

### 4. Chạy migration

```bash
pnpm exec prisma migrate deploy
```

### 5. Cấu hình COM port

Chỉnh [`config/modems.yaml`](config/modems.yaml):

```yaml
modems:
  autoDiscover: true
  portRange:
    from: COM3
    to: COM18
  connectionStaggerMs: 300     # mở từng cổng cách nhau 300ms
  logThrottleMs: 60000         # giảm log lặp khi reconnect
  syncSimInboxOnConnect: true  # đọc SMS đã lưu trên SIM khi kết nối
  smsSendTimeoutMs: 15000      # timeout khi gửi SMS
  entries:
    - port: COM3
      enabled: true
      phone: ""                # để trống = auto AT+CNUM / AT+CPBR
    - port: COM8
      enabled: false           # không cắm SIM → không kết nối, không spam log
      phone: ""
    - port: COM11
      enabled: true
      phone: "0865100016"      # override số SIM thủ công
```

### 6. Chạy service

Development:

```bash
pnpm run start:dev
```

Production:

```bash
pnpm run build
pnpm run start:prod
```

Chạy nền 24/7 với pm2:

```bash
pnpm add -g pm2
pnpm run build
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## API

Swagger: `http://localhost:3000/api/docs`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/health` | Health check (DB + modem) — public |
| GET | `/api/modems` | Danh sách modem + trạng thái |
| GET | `/api/modems/summary` | Tổng hợp số modem theo trạng thái |
| GET | `/api/modems/:port` | Chi tiết một modem |
| POST | `/api/modems/:port/send-sms` | Gửi SMS qua modem |
| GET | `/api/otp/latest?phone=098xxx` | OTP mới nhất theo số SIM |
| GET | `/api/otp/latest?port=COM3` | OTP mới nhất theo COM |
| GET | `/api/messages?page=1&pageSize=25&search=...&onlyOtp=true` | SMS có phân trang & tìm kiếm |
| POST | `/api/wait-otp` | Chờ OTP mới (long-poll) |

### Bảo mật API key

Khi `API_AUTH_ENABLED=true`, mọi `/api/*` (trừ dashboard và `/api/health`) yêu cầu header:

```
x-api-key: <key trong API_KEYS>
```

### Ví dụ wait-otp

```bash
curl -X POST http://localhost:3000/api/wait-otp ^
  -H "Content-Type: application/json" ^
  -d "{\"port\":\"COM3\",\"timeout\":60}"
```

### Ví dụ gửi SMS

```bash
curl -X POST http://localhost:3000/api/modems/COM3/send-sms ^
  -H "Content-Type: application/json" ^
  -d "{\"phone\":\"0987654321\",\"message\":\"Hello\"}"
```

### OTP webhook payload

Khi đặt `OTP_WEBHOOK_URL`, mỗi OTP mới được POST dạng:

```json
{
  "event": "otp.received",
  "port": "COM3",
  "phone": "0987654321",
  "otp": "123456",
  "message": "Your code is 123456",
  "receivedAt": "2026-06-09T07:00:00.000Z",
  "smsId": "42"
}
```

## Dashboard

Mở `http://localhost:3000/`:

- Tổng quan + trạng thái 16 modem (bấm vào modem để xem chi tiết & gửi SMS)
- Tìm kiếm/lọc SMS theo nội dung, cổng, chỉ OTP, có phân trang
- Feed OTP realtime, bấm để copy
- Toggle giao diện sáng/tối, toast thông báo

## Docker

`docker compose up -d` chỉ chạy PostgreSQL. Để chạy cả service trong container (chỉ trên Linux host, cần passthrough thiết bị serial):

```bash
docker compose --profile full up --build
```

Trên Windows nên chạy service native (`pnpm run start:prod`) vì truy cập COM port trong container Windows không khả dụng.

## CI

GitHub Actions (`.github/workflows/ci.yml`) chạy: install → prisma generate → lint → typecheck → test → build.

## Logging

Log ghi vào `logs/gsm-otp.log` (JSON) và console (pretty ở dev). Request tới `/api/health` được bỏ qua auto-logging để tránh nhiễu. Các lỗi AT command kỳ vọng (probe số điện thoại, init port lỗi) được giữ im lặng và gộp qua throttle.

## Kiến trúc

- NestJS + TypeScript
- `serialport` cho COM port Windows
- Prisma + PostgreSQL
- Event-driven nội bộ (`@nestjs/event-emitter`)
- WebSocket (`socket.io`) cho dashboard
- Guard/Filter/Interceptor toàn cục cho bảo mật & lỗi nhất quán

## Ghi chú vận hành

- Mỗi COM port chạy một `ModemInstance` độc lập
- Khi rút/cắm lại USB, service tự reconnect sau `reconnectIntervalMs`
- Nếu `AT+CNUM` không trả số, override `phone` trong `config/modems.yaml`
- Service cần chạy với quyền truy cập COM port (thường không cần admin)

## Bàn giao

- Source code đầy đủ + unit test
- `config/modems.yaml` — cấu hình COM
- `.env.example` — biến môi trường
- `docker-compose.yml` + `Dockerfile`
- CI pipeline, Swagger tại `/api/docs`
- Hướng dẫn deploy trong README này
```
