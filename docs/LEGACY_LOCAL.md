# Legacy local backend

The Supabase/GitHub Pages application does not use `server.js` for realtime or
board persistence. The Express, Socket.IO, and GAS paths remain only for local
compatibility and are disabled by default.

To enable the old local path, create `.env` values in the process environment
before starting the server:

```powershell
$env:SESSION_SECRET = "a-long-random-value"
$env:TEACHER_PASSWORD = "a-strong-local-password"
$env:ENABLE_LEGACY_REALTIME = "true"
$env:ENABLE_LEGACY_GAS_PROXY = "true"
npm.cmd start
```

Only enable the GAS proxy on a trusted network. The legacy student flow has no
per-student server credential, so Supabase Auth remains the production path.
