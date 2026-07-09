# Supabase Phase 1 Migration

This phase keeps the existing whiteboard UI and adds the foundation for moving
auth, classes, students, and board storage to Supabase while GitHub Pages serves
the static frontend.

## Architecture

- Frontend: GitHub Pages static files from `public/`.
- Public frontend config: `public/js/app-config.js`.
- Auth: Supabase Auth for teachers and students.
- Database: Postgres tables and RLS from `supabase/migrations/0001_class_whiteboard_core.sql`.
- Heavy board snapshots: private Supabase Storage bucket `class-whiteboard`.
- Admin-only actions: Supabase Edge Functions.
- Existing Render/Socket.IO flow: still works when Supabase config is empty.

## Public Config

Edit `public/js/app-config.js` before publishing to GitHub Pages:

```js
window.CLASS_WHITEBOARD_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_PUBLIC_ANON_KEY",
  storageBucket: "class-whiteboard",
  edgeFunctionBaseUrl: "https://YOUR_PROJECT.supabase.co/functions/v1",
};
```

The anon key is public by design. Do not put service role keys or invite codes
in this file.

## Supabase Secrets

Set these as Edge Function secrets:

```bash
supabase secrets set TEACHER_INVITE_CODE="change-me"
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="..."
supabase secrets set SUPABASE_ANON_KEY="..."
```

`SUPABASE_URL` is normally available automatically in hosted Edge Functions, but
set it explicitly if your local or deployment environment needs it.

## Deploy Order

1. Create a Supabase project.
2. Run the SQL migration in `supabase/migrations/0001_class_whiteboard_core.sql`.
3. Deploy Edge Functions:
   - `teacher-signup`
   - `create-class`
   - `create-student`
   - `reset-student-password`
   - `copy-board-to-class`
4. Set Edge Function secrets.
5. Fill `public/js/app-config.js`.
6. Publish `public/` with GitHub Pages.

## Login Model

- Teachers sign in with email and password.
- New teacher signup requires the teacher invite code.
- Students are created by a teacher for a specific class.
- Students sign in with class code, student ID, and password.
- The browser stores only class code and student ID hints for students.
- Student passwords are never stored locally and must be typed every time.

## Storage Model

- Board metadata lives in `public.board_files`.
- Board snapshots are JSON files in Supabase Storage.
- Teacher-owned snapshots use `teachers/{teacherAuthUserId}/{boardId}.json`.
- Student-owned snapshots use `students/{studentRowId}/{boardId}.json`.

This keeps Postgres small and makes it easier to stay inside the free database
quota. Images currently remain embedded in the board snapshot JSON, but the
path-based storage layout leaves room to deduplicate image assets later.

## Phase 2

Phase 2 should move active classroom realtime features from Socket.IO to
Supabase Realtime:

- student presence in each class
- chat
- screen/board monitoring
- one shared collaborative board per class
- periodic shared-board snapshots

Keep full edit-history replay and per-user layers out of scope until the basic
shared board is stable.
