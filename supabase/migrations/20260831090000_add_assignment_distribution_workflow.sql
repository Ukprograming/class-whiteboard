-- Distinguish reference materials from assignments while preserving the
-- existing immutable per-student board copy model.

alter table public.board_distributions
  add column if not exists distribution_kind text not null default 'material';

alter table public.board_distributions
  drop constraint if exists board_distributions_kind_check;

alter table public.board_distributions
  add constraint board_distributions_kind_check
  check (distribution_kind in ('material', 'assignment'));

alter table public.board_files
  add column if not exists distribution_id uuid
    references public.board_distributions(id) on delete set null,
  add column if not exists assignment_submitted_at timestamptz;

create index if not exists board_distributions_class_kind_created_idx
  on public.board_distributions(class_id, distribution_kind, created_at desc);

create index if not exists board_files_distribution_student_idx
  on public.board_files(distribution_id, student_id);

create index if not exists board_files_pending_assignment_idx
  on public.board_files(student_id, distribution_id)
  where assignment_submitted_at is null and distribution_id is not null;

-- Only a save made by the student who owns the distributed board counts as
-- submission. A teacher may edit and save the board without changing the
-- student's submission state.
create or replace function public.mark_assignment_submitted_on_student_save()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.assignment_submitted_at is not null then
    new.assignment_submitted_at := old.assignment_submitted_at;
    return new;
  end if;

  if new.distribution_id is not null
    and new.student_id = (select app_private.current_student_id())
    and exists (
      select 1
      from public.board_distributions d
      where d.id = new.distribution_id
        and d.distribution_kind = 'assignment'
    )
  then
    new.assignment_submitted_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists board_files_mark_assignment_submitted on public.board_files;
create trigger board_files_mark_assignment_submitted
before update on public.board_files
for each row
execute function public.mark_assignment_submitted_on_student_save();

create or replace function public.copy_board_to_class_atomic(
  p_teacher_id uuid,
  p_source_board_id uuid,
  p_class_id uuid,
  p_distribution_id uuid,
  p_snapshot_path text,
  p_title text,
  p_target_folder_path text,
  p_distribution_kind text
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
  inserted_count integer := 0;
  normalized_title text := btrim(coalesce(p_title, ''));
  normalized_folder text := btrim(coalesce(p_target_folder_path, ''));
  normalized_kind text := lower(btrim(coalesce(p_distribution_kind, 'material')));
begin
  if p_distribution_id is null then
    raise exception 'Distribution ID is required'
      using errcode = '22023';
  end if;

  if p_snapshot_path is distinct from (
    'shared/' || p_distribution_id::text || '/snapshot.json'
  ) then
    raise exception 'Invalid distribution snapshot path'
      using errcode = '22023';
  end if;

  if normalized_title = '' or length(normalized_title) > 120 then
    raise exception 'Distribution title must be between 1 and 120 characters'
      using errcode = '22023';
  end if;

  if normalized_kind not in ('material', 'assignment') then
    raise exception 'Distribution kind must be material or assignment'
      using errcode = '22023';
  end if;

  if length(normalized_folder) > 240
    or normalized_folder ~ '(^|/)\.\.(/|$)'
  then
    raise exception 'Invalid distribution folder path'
      using errcode = '22023';
  end if;

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
    and bf.teacher_id = p_teacher_id
    and bf.snapshot_path is not null;
  if not found then
    raise exception 'Source board not found'
      using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.students s
    where s.class_id = p_class_id
      and s.active = true
  ) then
    raise exception 'No active students in this class'
      using errcode = 'P0002';
  end if;

  insert into public.board_distributions (
    id,
    class_id,
    teacher_id,
    source_board_id,
    title,
    distribution_kind
  ) values (
    p_distribution_id,
    p_class_id,
    p_teacher_id,
    p_source_board_id,
    normalized_title,
    normalized_kind
  );

  insert into public.board_files (
    owner_kind,
    student_id,
    class_id,
    folder_path,
    name,
    snapshot_path,
    thumbnail_path,
    source_board_id,
    distribution_id,
    size_bytes
  )
  select
    'student',
    s.id,
    p_class_id,
    normalized_folder,
    normalized_title,
    p_snapshot_path,
    null,
    p_source_board_id,
    p_distribution_id,
    source_board.size_bytes
  from public.students s
  where s.class_id = p_class_id
    and s.active = true;

  get diagnostics inserted_count = row_count;
  return query select p_distribution_id, inserted_count;
end;
$$;

revoke all on function public.copy_board_to_class_atomic(
  uuid, uuid, uuid, uuid, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.copy_board_to_class_atomic(
  uuid, uuid, uuid, uuid, text, text, text, text
) to service_role;

-- Keep the previous Edge Function version working during a rolling deploy.
-- It continues to create reference materials until the new function version is
-- active and starts passing p_distribution_kind.
create or replace function public.copy_board_to_class_atomic(
  p_teacher_id uuid,
  p_source_board_id uuid,
  p_class_id uuid,
  p_distribution_id uuid,
  p_snapshot_path text,
  p_title text,
  p_target_folder_path text
)
returns table (
  distribution_id uuid,
  copied_count integer
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from public.copy_board_to_class_atomic(
    p_teacher_id,
    p_source_board_id,
    p_class_id,
    p_distribution_id,
    p_snapshot_path,
    p_title,
    p_target_folder_path,
    'material'
  );
$$;

revoke all on function public.copy_board_to_class_atomic(
  uuid, uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;

grant execute on function public.copy_board_to_class_atomic(
  uuid, uuid, uuid, uuid, text, text, text
) to service_role;

-- Postgres Changes is used only as a wake-up signal; RLS still restricts each
-- student to their own board rows.
do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'board_files'
  ) then
    alter publication supabase_realtime add table public.board_files;
  end if;
end
$$;
