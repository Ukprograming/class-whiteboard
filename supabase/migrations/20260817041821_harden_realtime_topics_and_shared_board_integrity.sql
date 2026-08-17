-- Split Realtime traffic by trust boundary. Authorization for private channels
-- is cached from the topic at subscription/send time, so application event
-- names and client-provided senderRole values must not be authorization inputs.

drop policy if exists "class members can read realtime class channels"
on realtime.messages;

drop policy if exists "class members can write realtime class channels"
on realtime.messages;

drop policy if exists "class members can read realtime presence"
on realtime.messages;

drop policy if exists "class members can write realtime presence"
on realtime.messages;

drop policy if exists "class members can read realtime announcements"
on realtime.messages;

drop policy if exists "class teachers can write realtime announcements"
on realtime.messages;

drop policy if exists "class members can read realtime shared board"
on realtime.messages;

drop policy if exists "class members can write realtime shared board"
on realtime.messages;

drop policy if exists "class students can read realtime student inbox"
on realtime.messages;

drop policy if exists "class teachers can write realtime student inbox"
on realtime.messages;

create policy "class members can read realtime presence"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'presence'
  and exists (
    select 1
    from public.classes c
    left join public.students s
      on s.class_id = c.id
      and s.active = true
      and s.auth_user_id = (select auth.uid())
    where (select realtime.topic()) = ('class:' || c.class_code || ':presence')
      and (
        c.teacher_id = (select auth.uid())
        or s.auth_user_id = (select auth.uid())
      )
  )
);

create policy "class members can write realtime presence"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'presence'
  and exists (
    select 1
    from public.classes c
    left join public.students s
      on s.class_id = c.id
      and s.active = true
      and s.auth_user_id = (select auth.uid())
    where (select realtime.topic()) = ('class:' || c.class_code || ':presence')
      and (
        c.teacher_id = (select auth.uid())
        or s.auth_user_id = (select auth.uid())
      )
  )
);

create policy "class members can read realtime announcements"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.classes c
    left join public.students s
      on s.class_id = c.id
      and s.active = true
      and s.auth_user_id = (select auth.uid())
    where (select realtime.topic()) = ('class:' || c.class_code || ':announcements')
      and (
        c.teacher_id = (select auth.uid())
        or s.auth_user_id = (select auth.uid())
      )
  )
);

create policy "class teachers can write realtime announcements"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.classes c
    where c.teacher_id = (select auth.uid())
      and (select realtime.topic()) = ('class:' || c.class_code || ':announcements')
  )
);

create policy "class members can read realtime shared board"
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.classes c
    left join public.students s
      on s.class_id = c.id
      and s.active = true
      and s.auth_user_id = (select auth.uid())
    where (select realtime.topic()) = ('class:' || c.class_code || ':shared')
      and (
        c.teacher_id = (select auth.uid())
        or s.auth_user_id = (select auth.uid())
      )
  )
);

create policy "class members can write realtime shared board"
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'broadcast'
  and exists (
    select 1
    from public.classes c
    left join public.students s
      on s.class_id = c.id
      and s.active = true
      and s.auth_user_id = (select auth.uid())
    where (select realtime.topic()) = ('class:' || c.class_code || ':shared')
      and (
        c.teacher_id = (select auth.uid())
        or s.auth_user_id = (select auth.uid())
      )
  )
);

create policy "class students can read realtime student inbox"
on realtime.messages
for select
to authenticated
using (
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

create policy "class teachers can write realtime student inbox"
on realtime.messages
for insert
to authenticated
with check (
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

-- Keep at most one active shared board per class. Resolve any historical
-- duplicates deterministically before adding the invariant.
with ranked_active_boards as (
  select
    id,
    row_number() over (
      partition by class_id
      order by updated_at desc, created_at desc, id desc
    ) as active_rank
  from public.shared_boards
  where active = true
)
update public.shared_boards as sb
set active = false,
    updated_at = now()
from ranked_active_boards as ranked
where sb.id = ranked.id
  and ranked.active_rank > 1;

create unique index if not exists shared_boards_one_active_per_class_idx
on public.shared_boards (class_id)
where active = true;

create or replace function public.finalize_shared_board_snapshot(
  p_shared_board_id uuid,
  p_class_id uuid,
  p_title text,
  p_source_board_id uuid,
  p_snapshot_path text,
  p_active boolean
)
returns table (
  shared_board_id uuid,
  board_title text,
  board_updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected_rows integer := 0;
begin
  if not exists (
    select 1
    from public.classes c
    where c.id = p_class_id
      and c.teacher_id = (select auth.uid())
  ) then
    raise exception 'Class not found for this teacher'
      using errcode = '42501';
  end if;

  if p_active then
    update public.shared_boards
    set active = false,
        updated_at = now()
    where class_id = p_class_id
      and id <> p_shared_board_id
      and active = true;
  end if;

  return query
  update public.shared_boards
  set title = p_title,
      source_board_id = p_source_board_id,
      current_snapshot_path = p_snapshot_path,
      active = p_active,
      updated_at = now()
  where id = p_shared_board_id
    and class_id = p_class_id
    and teacher_id = (select auth.uid())
  returning id, title, updated_at;

  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception 'Shared board not found for this teacher'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.finalize_shared_board_snapshot(
  uuid, uuid, text, uuid, text, boolean
) from public;

grant execute on function public.finalize_shared_board_snapshot(
  uuid, uuid, text, uuid, text, boolean
) to authenticated;

-- Avoid recursive profile-policy evaluation and enforce the immutable role at
-- the privilege layer. Browser users may update only their display name.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- A browser-owned board row may authorize only the owner's Storage prefix.
-- Distribution rows that point at teacher assets are created by the service
-- role; the first student save detaches the copy to the student's own path.
drop policy if exists board_files_owner_all on public.board_files;
create policy board_files_owner_all
on public.board_files
for all
to authenticated
using (
  (owner_kind = 'teacher' and teacher_id = (select auth.uid()))
  or (
    owner_kind = 'student'
    and student_id = (select app_private.current_student_id())
  )
  or (
    owner_kind = 'student'
    and class_id is not null
    and (select app_private.is_class_teacher(class_id))
  )
)
with check (
  (
    owner_kind = 'teacher'
    and teacher_id = (select auth.uid())
    and student_id is null
    and source_board_id is null
    and shared_board_id is null
    and (
      snapshot_path is null
      or snapshot_path like ('teachers/' || (select auth.uid())::text || '/%')
    )
    and (
      thumbnail_path is null
      or thumbnail_path like ('teachers/' || (select auth.uid())::text || '/%')
    )
  )
  or (
    owner_kind = 'student'
    and student_id = (select app_private.current_student_id())
    and source_board_id is null
    and shared_board_id is null
    and (
      snapshot_path is null
      or snapshot_path like ('students/' || student_id::text || '/%')
    )
    and (
      thumbnail_path is null
      or thumbnail_path like ('students/' || student_id::text || '/%')
    )
  )
  or (
    owner_kind = 'student'
    and student_id is not null
    and class_id is not null
    and (select app_private.is_class_teacher(class_id))
    and source_board_id is null
    and shared_board_id is null
    and (
      snapshot_path is null
      or snapshot_path like ('students/' || student_id::text || '/%')
    )
    and (
      thumbnail_path is null
      or thumbnail_path like ('students/' || student_id::text || '/%')
    )
  )
);

alter table public.classes
  drop constraint if exists classes_code_safe_format;
alter table public.classes
  add constraint classes_code_safe_format
  check (class_code ~ '^[A-Z0-9_-]{4,32}$');

alter table public.students
  drop constraint if exists students_login_id_safe_format;
alter table public.students
  add constraint students_login_id_safe_format
  check (student_login_id ~ '^[a-z0-9_-]{1,24}$');

create or replace function public.copy_board_to_class_atomic(
  p_teacher_id uuid,
  p_source_board_id uuid,
  p_class_id uuid,
  p_title text,
  p_target_folder_path text
)
returns table (
  distribution_id uuid,
  copied_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_board public.board_files%rowtype;
  new_distribution_id uuid;
  inserted_count integer := 0;
begin
  if not exists (
    select 1
    from public.classes c
    where c.id = p_class_id
      and c.teacher_id = p_teacher_id
  ) then
    raise exception 'Class not found for this teacher'
      using errcode = '42501';
  end if;

  select bf.*
  into source_board
  from public.board_files bf
  where bf.id = p_source_board_id
    and bf.owner_kind = 'teacher'
    and bf.teacher_id = p_teacher_id;
  if not found then
    raise exception 'Source board not found'
      using errcode = 'P0002';
  end if;

  insert into public.board_distributions (
    class_id,
    teacher_id,
    source_board_id,
    title
  ) values (
    p_class_id,
    p_teacher_id,
    p_source_board_id,
    p_title
  )
  returning id into new_distribution_id;

  insert into public.board_files (
    owner_kind,
    student_id,
    class_id,
    folder_path,
    name,
    snapshot_path,
    thumbnail_path,
    source_board_id,
    size_bytes
  )
  select
    'student',
    s.id,
    p_class_id,
    trim(coalesce(p_target_folder_path, '')),
    p_title,
    source_board.snapshot_path,
    source_board.thumbnail_path,
    p_source_board_id,
    source_board.size_bytes
  from public.students s
  where s.class_id = p_class_id
    and s.active = true;

  get diagnostics inserted_count = row_count;
  return query select new_distribution_id, inserted_count;
end;
$$;

revoke all on function public.copy_board_to_class_atomic(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.copy_board_to_class_atomic(
  uuid, uuid, uuid, text, text
) to service_role;
