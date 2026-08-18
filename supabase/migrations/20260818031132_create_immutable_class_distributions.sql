-- Freeze each class distribution at its own immutable Storage path. Student
-- board rows remain separate files and detach to their own Storage prefixes on
-- the first save.

drop function if exists public.copy_board_to_class_atomic(
  uuid, uuid, uuid, text, text
);

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
language plpgsql
security invoker
set search_path = ''
as $$
declare
  source_board public.board_files%rowtype;
  inserted_count integer := 0;
  normalized_title text := btrim(coalesce(p_title, ''));
  normalized_folder text := btrim(coalesce(p_target_folder_path, ''));
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
    title
  ) values (
    p_distribution_id,
    p_class_id,
    p_teacher_id,
    p_source_board_id,
    normalized_title
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
    source_board.size_bytes
  from public.students s
  where s.class_id = p_class_id
    and s.active = true;

  get diagnostics inserted_count = row_count;
  return query select p_distribution_id, inserted_count;
end;
$$;

revoke all on function public.copy_board_to_class_atomic(
  uuid, uuid, uuid, uuid, text, text, text
) from public, anon, authenticated;

grant execute on function public.copy_board_to_class_atomic(
  uuid, uuid, uuid, uuid, text, text, text
) to service_role;

-- A class teacher may inspect distributed student boards even while their
-- immutable snapshot still lives under shared/{distribution_id}/.
drop policy if exists storage_board_teacher_board_reference_read on storage.objects;
create policy storage_board_teacher_board_reference_read
on storage.objects
for select
to authenticated
using (
  bucket_id = 'class-whiteboard'
  and exists (
    select 1
    from public.board_files bf
    where bf.owner_kind = 'student'
      and bf.class_id is not null
      and (select app_private.is_class_teacher(bf.class_id))
      and bf.snapshot_path is not null
      and (
        storage.objects.name = bf.snapshot_path
        or storage.objects.name like (
          case
            when right(bf.snapshot_path, 5) = '.json'
              then left(bf.snapshot_path, length(bf.snapshot_path) - 5)
            else bf.snapshot_path
          end || '/assets/%'
        )
      )
  )
);
