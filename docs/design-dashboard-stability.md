# Design: Dashboard stability, light polish, unit tests

Date: 2026-07-27  
Status: Implemented (2026-07-27)  
Approach: Surgical fixes on existing Nest + vanilla dashboard stack

## Understanding summary

- Stabilize the existing GSM OTP ops cockpit (vanilla HTML/CSS/JS + Nest API); no major redesign.
- Fix auth breakage when `API_AUTH_ENABLED=true`, realtime SMS/OTP chip sync, and port-ops reliability; then light UI polish and unit tests.
- Primary users: internal operators monitoring up to 16 GSM ports, SMS/OTP, phone/enable config.
- Constraints: keep Nest + static dashboard; dashboard-used APIs are `@Public()`; bugs first, then light polish.
- Non-goals: no React/Vite; no new pages; no changes to `wait-otp` / OTP webhook; no visual overhaul.
- Allowed polish: Vietnamese copy consistency + remove dead CSS.
- Tests: backend coverage for changed behavior + extractable dashboard JS helpers.

## Assumptions

- App runs mainly on LAN/internal hosts; public dashboard APIs are an accepted risk.
- “Better looking” means cleaner and consistent, not a new aesthetic family.
- Jest (existing) is enough; no new e2e stack required this round.
- Socket.IO and REST event/endpoint names stay stable unless a fix requires a additive field (`otpCode` on `sms.received`).

## Decision log

| # | Decision | Alternatives considered | Why |
|---|----------|-------------------------|-----|
| 1 | Prioritize bugs + tests; light UI only | Full redesign / React SPA | User choice D |
| 2 | Mark dashboard APIs `@Public()` | localStorage API key / hybrid banner | User choice B — simple for internal ops |
| 3 | Surgical approach on current stack | Large JS modularization / restyle rewrite | YAGNI, lower regress risk |
| 4 | Enrich WS `sms.received` with `otpCode` | DOM-patch from `otp.received` only | Less fragile client sync |
| 5 | Port normalize + UI in-flight guards | Distributed locks / send queues | Enough for local 16-port service |
| 6 | VI copy + dead CSS cleanup | New theme / typography / layout | Matches agreed non-goals |
| 7 | Jest backend + helper JS unit tests | Broad e2e / full DOM tests | User choice B |

## Final design

### §1 Auth / dashboard API public

When `API_AUTH_ENABLED=true`, browser dashboard must work without an API key.

- Keep `@Public()` on dashboard static assets and `GET /api/health`.
- Add `@Public()` to dashboard-used surfaces:
  - `GET/PATCH/POST /api/modems…` (list, summary, detail, phone, enabled, send-sms)
  - `GET /api/messages`
- Keep automation endpoints private (`POST /api/wait-otp`, `GET /api/otp/latest`, webhook-related).
- Socket.IO gateway remains as today (not behind HTTP `ApiKeyGuard`).
- Do not add API-key UI or path-prefix middleware.

### §2 Realtime SMS / OTP

- In `DashboardGateway.handleSmsReceived`, after `decodeSmsBody`, run shared `OtpExtractor` and emit nullable `otpCode`.
- Client `sms.received` handler passes `sms.otpCode` into `buildSmsItem` (stop hard-coding `null`).
- Keep `otp.received` for OTP feed + toast.
- Keep live-only prepend when `smsMode === 'live'`.
- On WS disconnect polling fallback: also `loadLiveMessages()` when in live mode.

### §3 Port ops

- Backend: normalize COM port (`trim` + `toUpperCase`) in `sendSms` like other mutators; clear errors for missing instance / invalid phone / YAML write failures.
- Frontend: keep confirm modals; disable confirm/send during request; short `inFlight` guard against double-submit; keep map/drawer sync after success.
- No send queue or complex optimistic UI.

### §4 Light UI polish

- Prefer Vietnamese operator labels; keep technical terms (`COM`, `OTP`, `SIM`, `WebSocket`).
- Align mixed EN section titles to short VI equivalents.
- Reduce decorative emoji in favor of existing status/text patterns.
- Remove unused CSS after audit; keep current tokens/theme; bump cache-bust query on assets.
- Small a11y only (`aria-modal` / labels if missing). No focus-trap project, no new layout/system.

### §5 Unit tests

- Extend/add Jest specs for: public vs private auth behavior; gateway `otpCode` enrich; modem manager normalize / invalid phone / missing instance.
- Extract pure client helpers to `src/dashboard/public/dashboard-helpers.js` (browser global + `module.exports`) and cover with `dashboard-helpers.spec.ts`.
- No large HTML snapshots; no real SerialPort e2e in this pass.
- Done when `pnpm test` passes for the above.

## Risks

- Public dashboard APIs expose modem control to anyone who can reach the host — accepted for internal/LAN use.
- Dual OTP paths (`sms.received.otpCode` + `otp.received`) must not double-toast (toast stays on `otp.received` only).

## Implementation order (when kicked off)

1. Auth `@Public()` + tests  
2. Gateway `otpCode` + client live SMS/polling + helper extract/tests  
3. Port ops normalize + inFlight + tests  
4. Copy/CSS polish + cache-bust  
5. Run `pnpm test` / smoke `start:dev` dashboard  
