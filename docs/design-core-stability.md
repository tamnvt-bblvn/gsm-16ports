# Design: Core stability (discover / unplug / normalize)

Date: 2026-07-27  
Status: Implemented  
Approach: `modem.removed` event + RunQueue + COM normalize

## Understanding

- Fix ghost offline rows after USB unplug, overlapping discover races, and COM casing misses.
- Unplug UX: remove row immediately + short Vietnamese toast.
- Discover: mutex with queue (run again when busy tick arrives).
- Also: normalize `getState` / `getEntry`; document public dashboard APIs in `.env.example`.

## Decision log

| Decision | Alternatives | Why |
|----------|--------------|-----|
| Scope A+B+C docs/tests | Core-only / UX polish | User D |
| Unplug = delete + toast | Keep row / silent delete | User C |
| Discover = queue follow-up | Skip / longer interval | User B |
| New `modem.removed` WS event | REST reconcile | Realtime, matches delete UX |

## Implementation notes

- Event: `MODEM_REMOVED_EVENT` / WS `modem.removed` `{ port }`
- `RunQueue` serializes `discoverAndSync`
- Auto-discover emits removed for any port leaving `knownSystemPorts`
- Client deletes Map entry, closes drawer if open, toasts `Cổng {port} đã ngắt`
