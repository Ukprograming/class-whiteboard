# Supabase Phase 2 Realtime

Phase 2 moves the active classroom channel from Render Socket.IO to Supabase
Realtime when `public/js/app-config.js` contains Supabase settings. If the
Supabase config is empty, the app still falls back to the existing Socket.IO
server.

## What Changed

- `createRealtimeBridge()` now provides a Socket.IO-compatible wrapper backed by
  Supabase Realtime Broadcast and Presence.
- Teacher and student presence is tracked per class presence channel.
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
- Class Realtime channels are private by default and split by trust boundary.

## Channel Model

Each class uses several private channels. The topic itself is part of the
authorization boundary; the role declared in a client payload is not trusted.

```text
class:{CLASS_CODE}:presence
class:{CLASS_CODE}:announcements
class:{CLASS_CODE}:shared
class:{CLASS_CODE}:teacher-inbox
class:{CLASS_CODE}:student:{STUDENT_RECORD_UUID}
```

Examples:

```text
class:PHYSICS01:presence
class:PHYSICS01:announcements
class:2A-MATH:teacher-inbox
class:2A-MATH:student:123e4567-e89b-12d3-a456-426614174000
```

Teachers alone can write announcements. Only the class teacher can read the
teacher inbox. A per-student inbox can be read only by that active student and
written only by the class teacher. Presence and shared-board channels remain
available to active members of the class.

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

Apply every migration in `supabase/migrations/` in filename order. For an
existing deployment, use `supabase db push` so that the migration history is
recorded instead of copying only the original two SQL files manually.

The hardening migration
`20260817041821_harden_realtime_topics_and_shared_board_integrity.sql` must be
released together with the frontend that uses the split topics. Applying only
one side temporarily breaks Realtime communication.

Then in Supabase Realtime settings:

1. Disable public access for Realtime channels.
2. Keep Broadcast and Presence enabled.

The Realtime migrations enable RLS on `realtime.messages`. The latest policies
authorize each topic from the authenticated database membership and role.

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
- Add a durable operation log if edits must survive long offline periods; the
  current reconnect path reloads the latest snapshot and requests a resync.
- Add an optional manual "reload latest shared snapshot" command.
