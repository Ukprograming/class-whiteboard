# Supabase Phase 2 Realtime

Phase 2 moves the active classroom channel from Render Socket.IO to Supabase
Realtime when `public/js/app-config.js` contains Supabase settings. If the
Supabase config is empty, the app still falls back to the existing Socket.IO
server.

## What Changed

- `createRealtimeBridge()` now provides a Socket.IO-compatible wrapper backed by
  Supabase Realtime Broadcast and Presence.
- Teacher and student presence is tracked per class channel.
- Existing chat, thumbnails, high-resolution requests, screen monitoring,
  notebook-image updates, and whiteboard action events are routed through the
  same `socket.emit` / `socket.on` names the UI already uses.
- Teachers can start/stop a class-wide shared board from the file menu.
- Shared-board edits are sent as action events, while initial loads and refresh
  operations are sent as snapshots.
- Shared-board snapshots are periodically saved to Supabase Storage and tracked
  in `shared_boards`.
- Shared-board events use:
  - `shared-board-action`
  - `shared-board-snapshot`
- Class Realtime channels are private by default.

## Channel Model

Each class uses one private channel:

```text
class:{CLASS_CODE}
```

Examples:

```text
class:PHYSICS01
class:2A-MATH
```

Presence metadata is intentionally small:

```json
{
  "socketId": "...",
  "role": "student",
  "classCode": "PHYSICS01",
  "nickname": "s001",
  "studentId": "s001",
  "mode": "whiteboard"
}
```

Broadcast messages carry only the event name and payload needed by the existing
UI. Full whiteboard snapshots are still sent only when the existing monitoring
flow asks for them.

## Required Supabase Setup

Run both migrations in order:

1. `supabase/migrations/0001_class_whiteboard_core.sql`
2. `supabase/migrations/0002_realtime_class_channels.sql`

Then in Supabase Realtime settings:

1. Disable public access for Realtime channels.
2. Keep Broadcast and Presence enabled.

The second migration enables RLS on `realtime.messages` and allows only the
teacher who owns a class, or active students in that class, to read or write
Broadcast/Presence messages for `class:{CLASS_CODE}`.

## Frontend Config

```js
window.CLASS_WHITEBOARD_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_PUBLIC_ANON_KEY",
  storageBucket: "class-whiteboard",
  edgeFunctionBaseUrl: "https://YOUR_PROJECT.supabase.co/functions/v1",
  realtimePrivateChannels: true,
};
```

Set `realtimePrivateChannels` to `false` only for a temporary local experiment
against a test Supabase project. Do not use public channels for real classes.

## Traffic Notes

- Presence and chat are lightweight.
- Whiteboard collaboration sends actions, not full files, for normal edits.
- Monitoring mode can still send image data URLs. Use it only while the teacher
  is actively checking student screens.
- Board save/load remains snapshot-based through Supabase Storage, so normal
  file management does not create Realtime traffic.

## Remaining Phase 2 Work

- Add a clearer in-app shared-board status indicator for students.
- Add conflict recovery for reconnects during a burst of edits.
- Add an optional manual "reload latest shared snapshot" command.
