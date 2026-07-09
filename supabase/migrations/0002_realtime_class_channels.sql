-- Private Supabase Realtime channels for class sessions.
--
-- Client topic format: class:{CLASS_CODE}
-- Example: class:PHYSICS01

alter table realtime.messages enable row level security;

drop policy if exists "class members can read realtime class channels"
on realtime.messages;

drop policy if exists "class members can write realtime class channels"
on realtime.messages;

create policy "class members can read realtime class channels"
on realtime.messages
for select
to authenticated
using (
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
