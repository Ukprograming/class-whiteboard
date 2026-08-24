-- Use each student's private Realtime topic as a duplex channel.
--
-- Topic: class:{CLASS_CODE}:student:{STUDENT_UUID}
-- - the active student may read and publish on only their own topic
-- - the class teacher may read and publish on each active student's topic
--
-- This avoids subscribing students to the shared teacher-inbox topic, which
-- would either fail SELECT authorization or expose classmates' messages.

drop policy if exists "class teachers can read realtime student inbox"
on realtime.messages;

drop policy if exists "class students can write realtime student inbox"
on realtime.messages;

create policy "class teachers can read realtime student inbox"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.students s
    join public.classes c on c.id = s.class_id
    where c.teacher_id = (select auth.uid())
      and s.active = true
      and (select realtime.topic()) =
        ('class:' || c.class_code || ':student:' || s.id::text)
  )
);

create policy "class students can write realtime student inbox"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.students s
    join public.classes c on c.id = s.class_id
    where s.auth_user_id = (select auth.uid())
      and s.active = true
      and (select realtime.topic()) =
        ('class:' || c.class_code || ':student:' || s.id::text)
  )
);
