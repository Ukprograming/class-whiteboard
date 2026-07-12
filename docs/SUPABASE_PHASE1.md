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

For a local-only trial, create `public/js/app-config.local.js` instead. It is
loaded after the default config and ignored by Git, so the trial project is not
accidentally published as the shared default. It may contain only the public
project URL and publishable key.

Edit `public/js/app-config.js` only when deliberately publishing a Supabase
configuration to GitHub Pages:

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
2. Run the SQL migrations in order:
   - `supabase/migrations/0001_class_whiteboard_core.sql`
   - `supabase/migrations/0002_realtime_class_channels.sql`
3. Deploy Edge Functions:
   - `teacher-signup`
   - `create-class`
   - `create-student`
   - `reset-student-password`
   - `copy-board-to-class`
4. Set Edge Function secrets.
5. Fill `public/js/app-config.js`.
6. Publish `public/` with GitHub Pages.

## Local Trial Flow

1. Start the app with `npm.cmd start` and open `http://localhost:3000/teacher-login`.
2. Choose teacher account creation, enter a teacher email/password and the
   temporary teacher invite code, then sign in.
3. In the teacher page, open **File → クラス・生徒管理**. Create one test
   class, then create one or two test students with individual passwords.
4. Start the class using its class code, then open `http://localhost:3000/student.html`
   in another tab and sign in as a test student. Authentication is tab-scoped,
   so teacher and multiple student accounts can be tested in separate tabs.

The teacher's student-screen view shows only students who are currently signed
in and connected. The complete registered roster remains available under
**File → クラス・生徒管理**. After an auth-storage update, reload every open
teacher/student tab and sign in again once.

The management panel never saves student passwords locally. For an initial
free-tier test, keep board snapshots small and use screen-monitoring only when
needed.

Student login field mapping:

| Teacher management field | Student login field |
| --- | --- |
| Selected class's class code | クラスコード |
| 生徒ID（ログイン用） | 生徒ID |
| 初期パスワード | パスワード |
| 表示名（画面表示用） | Not entered at login |

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

See `docs/SUPABASE_PHASE2.md`.

Phase 2 adds a Supabase Realtime bridge for the existing class-session events:

- student presence in each class
- chat
- screen/board monitoring
- notebook-image updates
- shared-board publishing, action sync, and periodic snapshots

The remaining Phase 2 polish items are reconnect recovery and clearer
shared-board status controls.
