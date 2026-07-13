-- Bind the application-declared sender role to the immutable Auth app_metadata
-- role. This prevents a student in the class from publishing teacher commands
-- on an otherwise-authorized private class channel.
update auth.users as u
set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object('role', p.role)
from public.profiles as p
where p.id = u.id
  and p.role in ('teacher', 'student')
  and coalesce(u.raw_app_meta_data ->> 'role', '') is distinct from p.role;

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
  and (
    realtime.messages.extension <> 'broadcast'
    or (
      realtime.messages.event = 'socket-event'
      and realtime.messages.payload ->> 'senderRole' in ('teacher', 'student')
      and realtime.messages.payload ->> 'senderRole' =
        coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '')
    )
  )
);
