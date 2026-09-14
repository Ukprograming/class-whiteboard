-- Keep cleanup ownership aligned with the teacher currently responsible for a
-- student's class. Maintenance calls with p_owner_id = null remain unscoped.

-- SECURITY INVOKER cleanup RPCs call private reference/ownership helpers.
-- EXECUTE alone is insufficient without schema USAGE for the worker role.
grant usage on schema app_private to service_role;

create or replace function app_private.storage_cleanup_responsible_owner(
  p_object_path text,
  p_fallback_owner_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select c.teacher_id
      from public.students s
      join public.classes c on c.id = s.class_id
      where p_object_path = ('students/' || s.id::text)
         or p_object_path like ('students/' || s.id::text || '/%')
      limit 1
    ),
    p_fallback_owner_id
  );
$$;

revoke all on function app_private.storage_cleanup_responsible_owner(text, uuid)
  from public, anon, authenticated;
grant execute on function app_private.storage_cleanup_responsible_owner(text, uuid)
  to service_role;

create or replace function public.claim_storage_cleanup_jobs(
  p_limit integer default 100,
  p_owner_id uuid default null
)
returns table (bucket_id text, object_path text, path_kind text, attempts integer)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with candidates as (
    select
      j.bucket_id,
      j.object_path,
      app_private.storage_cleanup_responsible_owner(j.object_path, j.owner_id) as responsible_owner_id
    from public.storage_cleanup_jobs j
    where j.not_before <= now()
      and (j.state = 'queued' or (j.state = 'claimed' and j.updated_at < now() - interval '15 minutes'))
      and (
        p_owner_id is null
        or app_private.storage_cleanup_responsible_owner(j.object_path, j.owner_id) = p_owner_id
      )
    order by j.created_at
    for update of j skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ), unreferenced as (
    select j.*, c.responsible_owner_id
    from public.storage_cleanup_jobs j
    join candidates c using (bucket_id, object_path)
    where not app_private.storage_path_has_reference(j.object_path, j.path_kind)
  ), cancelled as (
    delete from public.storage_cleanup_jobs j
    using candidates c
    where j.bucket_id = c.bucket_id and j.object_path = c.object_path
      and app_private.storage_path_has_reference(j.object_path, j.path_kind)
  ), claimed as (
    update public.storage_cleanup_jobs j
    set state = 'claimed',
        owner_id = u.responsible_owner_id,
        attempts = j.attempts + 1,
        updated_at = now(),
        last_error = null
    from unreferenced u
    where j.bucket_id = u.bucket_id and j.object_path = u.object_path
    returning j.bucket_id, j.object_path, j.path_kind, j.attempts
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_storage_cleanup_jobs(integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_storage_cleanup_jobs(integer, uuid)
  to service_role;

create or replace function public.commit_board_file_revision(
  p_row jsonb,
  p_expected_snapshot_path text,
  p_asset_paths text[]
)
returns public.board_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result public.board_files;
  v_existing public.board_files;
  v_old_path text;
  v_old_asset text;
  v_asset text;
  v_uid uuid := (select auth.uid());
  v_cleanup_owner uuid;
begin
  if p_row->>'id' is null then raise exception 'Board ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('board-file:' || (p_row->>'id'), 0));

  if v_uid is null or (
    (p_row->>'owner_kind' = 'teacher' and nullif(p_row->>'teacher_id', '')::uuid = v_uid)
    or (p_row->>'owner_kind' = 'student' and (
      nullif(p_row->>'student_id', '')::uuid = (select app_private.current_student_id())
      or exists (
        select 1
        from public.students s
        join public.classes c on c.id = s.class_id
        where s.id = nullif(p_row->>'student_id', '')::uuid
          and c.teacher_id = v_uid
      )
    ))
  ) is not true then
    raise exception 'Board owner is not accessible to caller' using errcode = '42501';
  end if;

  select * into v_existing
  from public.board_files
  where id = (p_row->>'id')::uuid
  for update;

  if found then
    if (
      (v_existing.owner_kind = 'teacher' and v_existing.teacher_id = v_uid)
      or (v_existing.owner_kind = 'student' and (
        v_existing.student_id = (select app_private.current_student_id())
        or exists (
          select 1
          from public.students s
          join public.classes c on c.id = s.class_id
          where s.id = v_existing.student_id and c.teacher_id = v_uid
        )
      ))
    ) is not true then
      raise exception 'Existing board is not accessible to caller' using errcode = '42501';
    end if;
    v_old_path := v_existing.snapshot_path;
    if v_old_path is distinct from p_expected_snapshot_path then
      raise exception 'Board was changed by another save' using errcode = '40001';
    end if;
  end if;

  insert into public.board_files(
    id, owner_kind, teacher_id, student_id, class_id, folder_path, name,
    snapshot_path, thumbnail_path, source_board_id, shared_board_id, distribution_id,
    assignment_submitted_at, size_bytes, updated_at
  )
  values (
    (p_row->>'id')::uuid, p_row->>'owner_kind', nullif(p_row->>'teacher_id', '')::uuid,
    nullif(p_row->>'student_id', '')::uuid, nullif(p_row->>'class_id', '')::uuid,
    coalesce(p_row->>'folder_path', ''), p_row->>'name', p_row->>'snapshot_path',
    nullif(p_row->>'thumbnail_path', ''), nullif(p_row->>'source_board_id', '')::uuid,
    nullif(p_row->>'shared_board_id', '')::uuid, nullif(p_row->>'distribution_id', '')::uuid,
    nullif(p_row->>'assignment_submitted_at', '')::timestamptz,
    coalesce((p_row->>'size_bytes')::bigint, 0), now()
  )
  on conflict (id) do update set
    folder_path = excluded.folder_path,
    name = excluded.name,
    snapshot_path = excluded.snapshot_path,
    thumbnail_path = excluded.thumbnail_path,
    distribution_id = excluded.distribution_id,
    assignment_submitted_at = excluded.assignment_submitted_at,
    size_bytes = excluded.size_bytes,
    updated_at = now()
  returning * into v_result;

  if v_result.owner_kind = 'teacher' then
    v_cleanup_owner := v_result.teacher_id;
  else
    select c.teacher_id into v_cleanup_owner
    from public.classes c
    where c.id = v_result.class_id;
  end if;
  if v_cleanup_owner is null then
    raise exception 'Board cleanup owner could not be resolved';
  end if;

  foreach v_asset in array coalesce(p_asset_paths, array[]::text[]) loop
    if v_asset not like (
      case
        when v_result.owner_kind = 'teacher' then 'teachers/' || v_result.teacher_id::text || '/'
        else 'students/' || v_result.student_id::text || '/'
      end || '%'
    ) then
      raise exception 'Asset path is outside board owner prefix';
    end if;
    perform app_private.assert_storage_path_available(v_asset);
  end loop;

  for v_old_asset in
    select object_path
    from public.board_asset_references
    where board_file_id = v_result.id
      and not (object_path = any(coalesce(p_asset_paths, array[]::text[])))
  loop
    insert into public.storage_cleanup_jobs(
      bucket_id, object_path, path_kind, owner_id, reason
    ) values (
      'class-whiteboard', v_old_asset, 'object', v_cleanup_owner, 'unreferenced-board-asset'
    )
    on conflict (bucket_id, object_path) do update set
      owner_id = excluded.owner_id,
      not_before = greatest(public.storage_cleanup_jobs.not_before, now() + interval '24 hours'),
      updated_at = now()
    where public.storage_cleanup_jobs.state = 'queued';
  end loop;

  delete from public.board_asset_references where board_file_id = v_result.id;
  insert into public.board_asset_references(board_file_id, object_path)
    select v_result.id, x
    from unnest(coalesce(p_asset_paths, array[]::text[])) x
    on conflict do nothing;

  if v_old_path is not null
     and v_old_path <> v_result.snapshot_path
     and v_old_path not like 'shared/%' then
    insert into public.storage_cleanup_jobs(
      bucket_id, object_path, path_kind, owner_id, reason
    ) values (
      'class-whiteboard', v_old_path, 'object', v_cleanup_owner, 'superseded-board-revision'
    )
    on conflict (bucket_id, object_path) do update set
      owner_id = excluded.owner_id,
      not_before = greatest(public.storage_cleanup_jobs.not_before, now() + interval '24 hours'),
      updated_at = now()
    where public.storage_cleanup_jobs.state = 'queued';
  end if;

  return v_result;
end;
$$;

revoke all on function public.commit_board_file_revision(jsonb, text, text[])
  from public, anon;
grant execute on function public.commit_board_file_revision(jsonb, text, text[])
  to authenticated;

create or replace function public.enqueue_owned_board_cleanup(p_paths text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  p text;
  n integer := 0;
  uid uuid := (select auth.uid());
  cleanup_owner uuid;
begin
  if uid is null or coalesce(array_length(p_paths, 1), 0) > 100 then
    raise exception 'Invalid cleanup request';
  end if;

  foreach p in array p_paths loop
    cleanup_owner := null;
    if p like ('teachers/' || uid::text || '/%') then
      cleanup_owner := uid;
    else
      select c.teacher_id into cleanup_owner
      from public.students s
      join public.classes c on c.id = s.class_id
      where p like ('students/' || s.id::text || '/%')
        and (s.auth_user_id = uid or c.teacher_id = uid);
    end if;

    if cleanup_owner is null then
      raise exception 'Cleanup path is outside caller ownership';
    end if;

    insert into public.storage_cleanup_jobs(
      bucket_id, object_path, path_kind, owner_id, reason
    ) values (
      'class-whiteboard', p, 'object', cleanup_owner, 'abandoned-board-upload'
    )
    on conflict (bucket_id, object_path) do update set
      owner_id = excluded.owner_id,
      not_before = greatest(public.storage_cleanup_jobs.not_before, now() + interval '24 hours'),
      updated_at = now()
    where public.storage_cleanup_jobs.state = 'queued';
    n := n + 1;
  end loop;

  return n;
end;
$$;

revoke all on function public.enqueue_owned_board_cleanup(text[]) from public, anon;
grant execute on function public.enqueue_owned_board_cleanup(text[]) to authenticated;

-- Repair queued student-path jobs using each student's current class membership.
-- Claimed jobs are left untouched because a worker may already be deleting them;
-- stale claims are re-resolved when claim_storage_cleanup_jobs reclaims them.
with resolved as (
  select
    j.bucket_id,
    j.object_path,
    c.teacher_id
  from public.storage_cleanup_jobs j
  join public.students s
    on j.object_path = ('students/' || s.id::text)
    or j.object_path like ('students/' || s.id::text || '/%')
  join public.classes c on c.id = s.class_id
  where j.state = 'queued'
)
update public.storage_cleanup_jobs j
set owner_id = r.teacher_id,
    updated_at = now()
from resolved r
where j.bucket_id = r.bucket_id
  and j.object_path = r.object_path
  and j.owner_id is distinct from r.teacher_id;
