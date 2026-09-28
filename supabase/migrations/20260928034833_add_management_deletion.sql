-- Service-only durable deletion. Auth and Storage APIs run after this transaction.
create table public.management_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null,
  target_kind text not null check (target_kind in ('class', 'teacher')),
  target_id uuid not null,
  remaining_storage jsonb not null default '[]',
  remaining_users uuid[] not null default '{}',
  state text not null default 'queued' check (state in ('queued', 'running', 'completed')),
  lease_id uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (teacher_id, target_kind, target_id)
);
alter table public.management_deletion_jobs enable row level security;
revoke all on public.management_deletion_jobs from public, anon, authenticated;
grant select, insert, update on public.management_deletion_jobs to service_role;
create index management_deletion_pending_idx on public.management_deletion_jobs(updated_at)
  where state <> 'completed';

-- A deleted profile must not retain Storage access through an unexpired JWT.
create policy storage_require_live_profile on storage.objects as restrictive
for all to authenticated
using (bucket_id <> 'class-whiteboard' or exists (
  select 1 from public.profiles p where p.id = (select auth.uid())
))
with check (bucket_id <> 'class-whiteboard' or exists (
  select 1 from public.profiles p where p.id = (select auth.uid())
));
-- Direct class DELETE would bypass Auth/Storage cleanup and password verification.
revoke delete on public.classes from authenticated;

create or replace function app_private.storage_path_has_reference(p_path text, p_kind text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from (
      select snapshot_path as path from public.board_files
      union all select thumbnail_path from public.board_files
      union all select current_snapshot_path from public.shared_boards
      union all select image_path from public.form_template_questions
      union all select image_path from public.form_run_questions
      union all select object_path from public.board_asset_references
    ) refs where path = p_path or (p_kind = 'prefix' and starts_with(path, p_path || '/'))
  ) or exists (
    select 1 from public.students s where p_kind = 'prefix' and p_path = 'students/' || s.id::text
  );
$$;

create function public.begin_management_deletion(p_teacher_id uuid, p_kind text, p_target_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_job uuid;
  v_classes uuid[];
  v_students uuid[];
  v_users uuid[];
  v_boards uuid[];
  v_storage jsonb;
begin
  -- Serializes concurrent requests, including account deletion versus class deletion.
  perform pg_advisory_xact_lock(hashtextextended('management-delete:' || p_teacher_id::text, 0));
  select id into v_job from public.management_deletion_jobs
    where teacher_id = p_teacher_id and target_kind = p_kind and target_id = p_target_id;
  if found then return v_job; end if;
  perform 1 from public.profiles where id = p_teacher_id and role = 'teacher' for update;
  if not found then raise exception 'Teacher account is required' using errcode = '42501'; end if;
  if p_kind not in ('class','teacher') or p_kind is null
    or (p_kind = 'teacher' and p_target_id is distinct from p_teacher_id) then
    raise exception 'Invalid deletion target' using errcode = '42501';
  end if;
  perform 1 from public.classes where teacher_id = p_teacher_id
    and (p_kind = 'teacher' or id = p_target_id) for update;
  select coalesce(array_agg(id), '{}') into v_classes from public.classes
    where teacher_id = p_teacher_id and (p_kind = 'teacher' or id = p_target_id);
  if p_kind = 'class' and cardinality(v_classes) <> 1 then
    raise exception 'Class is not owned by caller' using errcode = '42501';
  end if;
  select coalesce(array_agg(id), '{}'), coalesce(array_agg(auth_user_id), '{}')
    into v_students, v_users from public.students where class_id = any(v_classes);
  select coalesce(array_agg(b.id), '{}') into v_boards from public.board_files b
    where (b.student_id = any(v_students) or (b.teacher_id = p_teacher_id
      and (p_kind = 'teacher' or b.class_id = any(v_classes))))
    and not exists (select 1 from public.board_distributions d
      where d.source_board_id = b.id and not (d.class_id = any(v_classes)))
    and not exists (select 1 from public.shared_boards s
      where s.source_board_id = b.id and not (s.class_id = any(v_classes)));

  select coalesce(jsonb_agg(jsonb_build_object('object_path', path, 'path_kind', kind)), '[]')
  into v_storage from (
    select 'students/' || unnest(v_students)::text as path, 'prefix' as kind
    union select 'shared/' || id::text, 'prefix' from public.board_distributions where class_id = any(v_classes)
    union select 'shared/' || id::text, 'prefix' from public.shared_boards where class_id = any(v_classes)
    union select 'teachers/' || p_teacher_id::text, 'prefix' where p_kind = 'teacher'
    union select 'teachers/' || p_teacher_id::text || '/' || id::text, 'prefix'
      from public.board_files where id = any(v_boards) and owner_kind = 'teacher'
    union select snapshot_path, 'object' from public.board_files where id = any(v_boards)
    union select thumbnail_path, 'object' from public.board_files where id = any(v_boards)
    union select object_path, 'object' from public.board_asset_references where board_file_id = any(v_boards)
    union select q.image_path, 'object' from public.form_run_questions q
      join public.form_runs r on r.id = q.run_id where r.class_id = any(v_classes)
    union select object_path, path_kind from public.storage_cleanup_jobs
      where p_kind = 'teacher' and owner_id = p_teacher_id
        and app_private.storage_cleanup_responsible_owner(object_path, owner_id) = p_teacher_id
    union select t->>'object_path', t->>'path_kind' from public.management_deletion_jobs j,
      lateral jsonb_array_elements(j.remaining_storage) t
      where p_kind = 'teacher' and j.teacher_id = p_teacher_id
  ) targets where path is not null;

  -- Delete children explicitly before SET NULL FKs can trip board integrity triggers.
  delete from public.board_files where student_id = any(v_students);
  delete from public.board_distributions where class_id = any(v_classes);
  delete from public.shared_boards where class_id = any(v_classes);
  delete from public.board_files where id = any(v_boards);
  update public.board_files set class_id = null where class_id = any(v_classes);
  delete from public.students where id = any(v_students);
  delete from public.profiles where id = any(v_users);
  delete from public.classes where id = any(v_classes);
  if p_kind = 'teacher' then
    -- Existing class-deletion jobs may still hold Auth IDs after their rows disappeared.
    select array(select distinct x from (
      select unnest(v_users) x union all
      select unnest(remaining_users) from public.management_deletion_jobs where teacher_id = p_teacher_id
    ) ids where x <> p_teacher_id) into v_users;
    delete from public.profiles where id = p_teacher_id;
    v_users := array_append(v_users, p_teacher_id);
  end if;
  insert into public.management_deletion_jobs(teacher_id, target_kind, target_id, remaining_storage, remaining_users)
    values(p_teacher_id, p_kind, p_target_id, v_storage, v_users) returning id into v_job;
  return v_job;
end;
$$;

create function app_private.management_storage_path_available(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.storage_cleanup_jobs j
    where j.bucket_id = 'class-whiteboard' and j.reason = 'management-deletion'
      and j.state in ('claimed', 'deleted')
      and (j.object_path = p_path or (j.path_kind = 'prefix' and starts_with(p_path, j.object_path || '/'))));
$$;
revoke all on function app_private.management_storage_path_available(text) from public, anon;
grant execute on function app_private.management_storage_path_available(text) to authenticated;
create policy storage_management_deletion_write_guard on storage.objects as restrictive
for insert to authenticated with check (
  bucket_id <> 'class-whiteboard' or app_private.management_storage_path_available(name)
);
create policy storage_management_deletion_update_guard on storage.objects as restrictive
for update to authenticated using (
  bucket_id <> 'class-whiteboard' or app_private.management_storage_path_available(name)
) with check (
  bucket_id <> 'class-whiteboard' or app_private.management_storage_path_available(name)
);
revoke all on function public.begin_management_deletion(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.begin_management_deletion(uuid,text,uuid) to service_role;
grant delete on public.profiles, public.classes, public.students, public.board_files,
  public.board_distributions, public.shared_boards to service_role;

create function public.claim_management_deletion(p_job_id uuid, p_owner_id uuid default null)
returns setof public.management_deletion_jobs language sql security invoker set search_path = '' as $$
  update public.management_deletion_jobs set state = 'running', lease_id = gen_random_uuid(), updated_at = now()
  where id = p_job_id and (p_owner_id is null or teacher_id = p_owner_id)
    and (state = 'queued' or (state = 'running' and updated_at < now() - interval '15 minutes'))
  returning *;
$$;
revoke all on function public.claim_management_deletion(uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_management_deletion(uuid,uuid) to service_role;

create function public.prepare_management_storage_deletion(p_path text, p_kind text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('class-whiteboard:' || lock_path, 0))
    from (select distinct lock_path from (values
      (split_part(p_path,'/',1) || '/' || split_part(p_path,'/',2)), (p_path)
    ) paths(lock_path) order by lock_path) ordered_paths;
  if app_private.storage_path_has_reference(p_path, p_kind) then return false; end if;
  insert into public.storage_cleanup_jobs(bucket_id,object_path,path_kind,reason,state,not_before)
    values('class-whiteboard',p_path,p_kind,'management-deletion','claimed',now())
    on conflict(bucket_id,object_path) do update set
      state='claimed',path_kind=excluded.path_kind,reason=excluded.reason,updated_at=now(),not_before=now();
  return true;
end;
$$;
revoke all on function public.prepare_management_storage_deletion(text,text) from public, anon, authenticated;
grant execute on function public.prepare_management_storage_deletion(text,text) to service_role;
