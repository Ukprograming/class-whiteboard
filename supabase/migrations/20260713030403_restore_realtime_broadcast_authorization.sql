-- Restore Broadcast publishing for authenticated class members.
--
-- Supabase Realtime evaluates and caches private-channel permissions when a
-- client subscribes. Message-specific checks against realtime.messages.event
-- and realtime.messages.payload therefore prevent Broadcast write permission
-- from being granted, even though Presence continues to work.
--
-- Application event allowlists remain enforced by the receiving clients in
-- public/js/supabase-api.js. For database-enforced per-role event publishing,
-- use separate teacher/student topics so authorization can be based on the
-- cached topic and JWT claims.

drop policy if exists "class members can write realtime class channels"
on realtime.messages;

create policy "class members can write realtime class channels"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension in ('broadcast', 'presence')
  and exists (
    select 1
    from public.classes c
    left join public.students s
      on s.class_id = c.id
      and s.active = true
      and s.auth_user_id = (select auth.uid())
    where (select realtime.topic()) = ('class:' || c.class_code)
      and (
        c.teacher_id = (select auth.uid())
        or s.auth_user_id = (select auth.uid())
      )
  )
);
