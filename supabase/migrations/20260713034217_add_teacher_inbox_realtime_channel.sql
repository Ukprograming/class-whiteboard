-- Route student-to-teacher traffic through a private teacher inbox topic.
--
-- Topic: class:{CLASS_CODE}:teacher-inbox
-- - the class teacher may receive Broadcast messages
-- - active students in that class may publish Broadcast messages
-- - students have no SELECT policy, so images and chat are not fanned out to
--   classmates

drop policy if exists "class teachers can read realtime teacher inbox"
on realtime.messages;

drop policy if exists "class students can write realtime teacher inbox"
on realtime.messages;

create policy "class teachers can read realtime teacher inbox"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.classes c
    where c.teacher_id = (select auth.uid())
      and (select realtime.topic()) =
        ('class:' || c.class_code || ':teacher-inbox')
  )
);

create policy "class students can write realtime teacher inbox"
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
        ('class:' || c.class_code || ':teacher-inbox')
  )
);
