-- Harden board ownership/reference integrity and make Storage deletion durable.

create table if not exists public.storage_cleanup_jobs (
  bucket_id text not null,
  object_path text not null,
  path_kind text not null default 'object' check (path_kind in ('object', 'prefix')),
  owner_id uuid,
  reason text not null,
  not_before timestamptz not null default (now() + interval '24 hours'),
  state text not null default 'queued' check (state in ('queued', 'claimed', 'deleted')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (bucket_id, object_path)
);

alter table public.storage_cleanup_jobs enable row level security;
revoke all on table public.storage_cleanup_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.storage_cleanup_jobs to service_role;

create index if not exists storage_cleanup_jobs_due_idx
  on public.storage_cleanup_jobs (not_before, created_at)
  where state in ('queued', 'claimed');

create table if not exists public.board_asset_references (
  board_file_id uuid not null references public.board_files(id) on delete cascade,
  object_path text not null,
  created_at timestamptz not null default now(),
  primary key (board_file_id, object_path)
);
alter table public.board_asset_references enable row level security;
revoke all on table public.board_asset_references from public, anon, authenticated;
grant select, insert, update, delete on table public.board_asset_references to service_role;

create or replace function app_private.board_has_asset_reference(p_board_id uuid,p_path text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.board_asset_references ar
    where ar.board_file_id=p_board_id and ar.object_path=p_path);
$$;
revoke all on function app_private.board_has_asset_reference(uuid,text) from public,anon;
grant execute on function app_private.board_has_asset_reference(uuid,text) to authenticated,service_role;

create or replace function app_private.storage_path_has_reference(p_path text, p_kind text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.board_files bf
    where bf.snapshot_path = p_path or bf.thumbnail_path = p_path
      or (p_kind = 'prefix' and (
        bf.snapshot_path = p_path or bf.snapshot_path like (p_path || '/%')
        or bf.thumbnail_path = p_path or bf.thumbnail_path like (p_path || '/%')
      ))
  ) or exists (
    select 1 from public.shared_boards sb
    where sb.current_snapshot_path = p_path
       or (p_kind = 'prefix' and (sb.current_snapshot_path = p_path or sb.current_snapshot_path like (p_path || '/%')))
  ) or exists (
    select 1 from public.form_template_questions q where q.image_path = p_path
  ) or exists (
    select 1 from public.form_run_questions q where q.image_path = p_path
  ) or exists (
    select 1 from public.board_asset_references ar where ar.object_path = p_path
  ) or exists (
    select 1 from public.students s
    where p_kind = 'prefix' and p_path = ('students/' || s.id::text)
  );
$$;

revoke all on function app_private.storage_path_has_reference(text, text) from public, anon, authenticated;
grant execute on function app_private.storage_path_has_reference(text, text) to service_role;

create or replace function public.claim_storage_cleanup_jobs(p_limit integer default 100, p_owner_id uuid default null)
returns table (bucket_id text, object_path text, path_kind text, attempts integer)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with candidates as (
    select j.bucket_id, j.object_path
    from public.storage_cleanup_jobs j
    where j.not_before <= now()
      and (j.state = 'queued' or (j.state = 'claimed' and j.updated_at < now() - interval '15 minutes'))
      and (p_owner_id is null or j.owner_id = p_owner_id)
    order by j.created_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ), unreferenced as (
    select j.*
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
    set state = 'claimed', attempts = j.attempts + 1, updated_at = now(), last_error = null
    from unreferenced u
    where j.bucket_id = u.bucket_id and j.object_path = u.object_path
    returning j.bucket_id, j.object_path, j.path_kind, j.attempts
  )
  select * from claimed;
end;
$$;

create or replace function app_private.serialize_cleanup_claim()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.state = 'claimed' then
    perform pg_advisory_xact_lock(hashtextextended(new.bucket_id || ':' || new.object_path, 0));
    if app_private.storage_path_has_reference(new.object_path, new.path_kind) then
      return null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists storage_cleanup_jobs_serialize_claim on public.storage_cleanup_jobs;
create trigger storage_cleanup_jobs_serialize_claim before update of state on public.storage_cleanup_jobs
for each row execute function app_private.serialize_cleanup_claim();

create or replace function public.complete_storage_cleanup_job(
  p_bucket_id text, p_object_path text, p_error text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_error is null then
    update public.storage_cleanup_jobs
    set state = 'deleted', updated_at = now(), last_error = null
    where bucket_id = p_bucket_id and object_path = p_object_path and state = 'claimed';
  else
    update public.storage_cleanup_jobs
    set last_error = left(p_error, 1000),
        not_before = now() + least(interval '24 hours', interval '5 minutes' * power(2, least(attempts, 8))),
        updated_at = now()
    where bucket_id = p_bucket_id and object_path = p_object_path and state = 'claimed';
  end if;
end;
$$;

revoke all on function public.claim_storage_cleanup_jobs(integer,uuid) from public, anon, authenticated;
revoke all on function public.complete_storage_cleanup_job(text, text, text) from public, anon, authenticated;
grant execute on function public.claim_storage_cleanup_jobs(integer,uuid) to service_role;
grant execute on function public.complete_storage_cleanup_job(text, text, text) to service_role;

create or replace function app_private.assert_storage_path_available(p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_path is not null then
    -- Prefix cleanup jobs use the first two path segments (students/{id},
    -- shared/{id}). Lock that ancestor before the exact object everywhere.
    perform pg_advisory_xact_lock(hashtextextended('class-whiteboard:' || lock_path, 0))
    from (
      select distinct lock_path from (values
        (split_part(p_path,'/',1) || '/' || split_part(p_path,'/',2)),
        (p_path)
      ) paths(lock_path)
      where lock_path <> ''
      order by lock_path
    ) ordered_paths;
  end if;
  if p_path is not null and exists (
    select 1 from public.storage_cleanup_jobs j
    where j.bucket_id = 'class-whiteboard'
      and (
        j.state = 'claimed'
        or (j.state = 'deleted' and not exists (
          select 1 from storage.objects o
          where o.bucket_id=j.bucket_id and o.name=p_path
            and coalesce(o.updated_at,o.created_at) > j.updated_at
        ))
      )
      and (j.object_path = p_path or (j.path_kind = 'prefix' and p_path like (j.object_path || '/%')))
  ) then
    raise exception 'Storage object is pending deletion' using errcode = '55000';
  end if;
end;
$$;

create or replace function app_private.validate_board_file_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student_class uuid;
  v_class_teacher uuid;
  v_distribution public.board_distributions%rowtype;
begin
  perform app_private.assert_storage_path_available(new.snapshot_path);
  perform app_private.assert_storage_path_available(new.thumbnail_path);

  if new.class_id is not null then
    select c.teacher_id into v_class_teacher from public.classes c where c.id = new.class_id;
    if v_class_teacher is null then raise exception 'Board class does not exist'; end if;
  end if;

  if new.owner_kind = 'teacher' then
    if new.teacher_id is null or new.student_id is not null or new.distribution_id is not null
       or new.source_board_id is not null or new.shared_board_id is not null
       or (new.class_id is not null and v_class_teacher <> new.teacher_id)
       or (new.snapshot_path is not null and new.snapshot_path not like ('teachers/' || new.teacher_id::text || '/%'))
       or (new.thumbnail_path is not null and new.thumbnail_path not like ('teachers/' || new.teacher_id::text || '/%')) then
      raise exception 'Invalid teacher board ownership';
    end if;
  elsif new.owner_kind = 'student' then
    if new.student_id is null or new.teacher_id is not null then raise exception 'Invalid student board ownership'; end if;
    select s.class_id into v_student_class from public.students s where s.id = new.student_id;
    if v_student_class is null or new.class_id is distinct from v_student_class then
      raise exception 'Student board class does not match student membership';
    end if;
    if new.distribution_id is null then
      if new.source_board_id is not null or new.shared_board_id is not null
         or (new.snapshot_path is not null and new.snapshot_path not like ('students/' || new.student_id::text || '/%'))
         or (new.thumbnail_path is not null and new.thumbnail_path not like ('students/' || new.student_id::text || '/%')) then
        raise exception 'Invalid private student board reference';
      end if;
    else
      select d.* into v_distribution from public.board_distributions d where d.id = new.distribution_id;
      if new.source_board_id is null and found then
        new.source_board_id := v_distribution.source_board_id;
      end if;
      if new.shared_board_id is not null or not found or v_distribution.class_id <> new.class_id or v_distribution.teacher_id <> v_class_teacher
         or new.source_board_id is distinct from v_distribution.source_board_id
         or (new.snapshot_path is not null and new.snapshot_path <> ('shared/' || new.distribution_id::text || '/snapshot.json')
             and new.snapshot_path not like ('students/' || new.student_id::text || '/%')) then
        raise exception 'Invalid distributed board reference';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists board_files_validate_integrity on public.board_files;
create trigger board_files_validate_integrity
before insert or update on public.board_files
for each row execute function app_private.validate_board_file_integrity();

drop policy if exists board_files_owner_all on public.board_files;
create policy board_files_owner_all on public.board_files for all to authenticated
using (
  (owner_kind = 'teacher' and teacher_id = (select auth.uid()))
  or (owner_kind = 'student' and student_id = (select app_private.current_student_id()))
  or (owner_kind = 'student' and exists (
    select 1 from public.students s join public.classes c on c.id = s.class_id
    where s.id = board_files.student_id and s.class_id = board_files.class_id
      and c.teacher_id = (select auth.uid())
  ))
)
with check (
  (owner_kind = 'teacher' and teacher_id = (select auth.uid()))
  or (owner_kind = 'student' and student_id = (select app_private.current_student_id()))
  or (owner_kind = 'student' and exists (
    select 1 from public.students s join public.classes c on c.id = s.class_id
    where s.id = board_files.student_id and s.class_id = board_files.class_id
      and c.teacher_id = (select auth.uid())
  ))
);

drop policy if exists storage_board_teacher_board_reference_read on storage.objects;
create policy storage_board_teacher_board_reference_read on storage.objects for select to authenticated
using (
  bucket_id = 'class-whiteboard' and exists (
    select 1 from public.board_files bf
    join public.students s on s.id = bf.student_id and s.class_id = bf.class_id
    join public.classes c on c.id = s.class_id
    where bf.owner_kind = 'student' and c.teacher_id = (select auth.uid())
      and bf.snapshot_path is not null
      and (storage.objects.name = bf.snapshot_path
        or storage.objects.name like (regexp_replace(bf.snapshot_path, '\.json$', '') || '/assets/%')
        or (select app_private.board_has_asset_reference(bf.id,storage.objects.name)))
  )
);

create or replace function app_private.validate_form_image_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_teacher_id uuid;
begin
  if new.image_path is null then return new; end if;
  if tg_table_name = 'form_template_questions' then
    select ft.teacher_id into v_teacher_id from public.form_templates ft where ft.id = new.template_id;
  else
    select fr.teacher_id into v_teacher_id from public.form_runs fr where fr.id = new.run_id;
  end if;
  if v_teacher_id is null or new.image_path !~ ('^teachers/' || v_teacher_id::text || '/forms/[0-9a-f-]{36}\.(jpg|png|webp|gif)$') then
    raise exception 'Question image is not owned by the form teacher';
  end if;
  perform app_private.assert_storage_path_available(new.image_path);
  return new;
end;
$$;

drop trigger if exists form_template_questions_validate_image on public.form_template_questions;
create trigger form_template_questions_validate_image before insert or update of image_path, template_id
on public.form_template_questions for each row execute function app_private.validate_form_image_reference();
drop trigger if exists form_run_questions_validate_image on public.form_run_questions;
create trigger form_run_questions_validate_image before insert or update of image_path, run_id
on public.form_run_questions for each row execute function app_private.validate_form_image_reference();

create or replace function app_private.enqueue_deleted_form_image()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_teacher_id uuid;
begin
  if old.image_path is null then return old; end if;
  if tg_table_name='form_template_questions' then
    select teacher_id into v_teacher_id from public.form_templates where id=old.template_id;
  else
    select teacher_id into v_teacher_id from public.form_runs where id=old.run_id;
  end if;
  if v_teacher_id is null
     and old.image_path ~ '^teachers/[0-9a-f-]{36}/forms/[0-9a-f-]{36}\.(jpg|png|webp|gif)$' then
    v_teacher_id := split_part(old.image_path,'/',2)::uuid;
  end if;
  if v_teacher_id is not null then
    insert into public.storage_cleanup_jobs(bucket_id,object_path,path_kind,owner_id,reason)
    values('class-whiteboard',old.image_path,'object',v_teacher_id,'unreferenced-form-image')
    on conflict(bucket_id,object_path) do update set
      not_before=greatest(public.storage_cleanup_jobs.not_before,now()+interval '24 hours'),updated_at=now()
      where public.storage_cleanup_jobs.state='queued';
  end if;
  return old;
end $$;
drop trigger if exists form_template_questions_enqueue_deleted_image on public.form_template_questions;
create trigger form_template_questions_enqueue_deleted_image before delete on public.form_template_questions
for each row execute function app_private.enqueue_deleted_form_image();
drop trigger if exists form_run_questions_enqueue_deleted_image on public.form_run_questions;
create trigger form_run_questions_enqueue_deleted_image before delete on public.form_run_questions
for each row execute function app_private.enqueue_deleted_form_image();

create or replace function public.commit_board_file_revision(p_row jsonb, p_expected_snapshot_path text, p_asset_paths text[])
returns public.board_files
language plpgsql security definer set search_path = ''
as $$
declare v_result public.board_files; v_existing public.board_files; v_old_path text; v_old_asset text; v_asset text; v_uid uuid := (select auth.uid());
begin
  if p_row->>'id' is null then raise exception 'Board ID is required'; end if;
  perform pg_advisory_xact_lock(
    hashtextextended('board-file:' || (p_row->>'id'), 0)
  );
  if v_uid is null or (
    (p_row->>'owner_kind'='teacher' and nullif(p_row->>'teacher_id','')::uuid=v_uid)
    or (p_row->>'owner_kind'='student' and (
      nullif(p_row->>'student_id','')::uuid=(select app_private.current_student_id())
      or exists(select 1 from public.students s join public.classes c on c.id=s.class_id
        where s.id=nullif(p_row->>'student_id','')::uuid and c.teacher_id=v_uid)
    ))
  ) is not true then raise exception 'Board owner is not accessible to caller' using errcode='42501'; end if;
  select * into v_existing from public.board_files where id = (p_row->>'id')::uuid for update;
  if found then
    if (
      (v_existing.owner_kind='teacher' and v_existing.teacher_id=v_uid)
      or (v_existing.owner_kind='student' and (
        v_existing.student_id=(select app_private.current_student_id())
        or exists(select 1 from public.students s join public.classes c on c.id=s.class_id where s.id=v_existing.student_id and c.teacher_id=v_uid)
      ))
    ) is not true then raise exception 'Existing board is not accessible to caller' using errcode='42501'; end if;
    v_old_path := v_existing.snapshot_path;
    if v_old_path is distinct from p_expected_snapshot_path then
      raise exception 'Board was changed by another save' using errcode = '40001';
    end if;
  end if;
  insert into public.board_files(id, owner_kind, teacher_id, student_id, class_id, folder_path, name,
    snapshot_path, thumbnail_path, source_board_id, shared_board_id, distribution_id,
    assignment_submitted_at, size_bytes, updated_at)
  values ((p_row->>'id')::uuid, p_row->>'owner_kind', nullif(p_row->>'teacher_id','')::uuid,
    nullif(p_row->>'student_id','')::uuid, nullif(p_row->>'class_id','')::uuid,
    coalesce(p_row->>'folder_path',''), p_row->>'name', p_row->>'snapshot_path',
    nullif(p_row->>'thumbnail_path',''), nullif(p_row->>'source_board_id','')::uuid,
    nullif(p_row->>'shared_board_id','')::uuid, nullif(p_row->>'distribution_id','')::uuid,
    nullif(p_row->>'assignment_submitted_at','')::timestamptz,
    coalesce((p_row->>'size_bytes')::bigint,0), now())
  on conflict (id) do update set folder_path=excluded.folder_path, name=excluded.name,
    snapshot_path=excluded.snapshot_path, thumbnail_path=excluded.thumbnail_path,
    distribution_id=excluded.distribution_id, assignment_submitted_at=excluded.assignment_submitted_at,
    size_bytes=excluded.size_bytes, updated_at=now()
  returning * into v_result;
  foreach v_asset in array coalesce(p_asset_paths, array[]::text[]) loop
    if v_asset not like (case when v_result.owner_kind='teacher' then 'teachers/'||v_result.teacher_id::text||'/' else 'students/'||v_result.student_id::text||'/' end || '%') then
      raise exception 'Asset path is outside board owner prefix';
    end if;
    perform app_private.assert_storage_path_available(v_asset);
  end loop;
  for v_old_asset in select object_path from public.board_asset_references where board_file_id=v_result.id and not (object_path=any(coalesce(p_asset_paths,array[]::text[]))) loop
    insert into public.storage_cleanup_jobs(bucket_id,object_path,path_kind,owner_id,reason)
    values('class-whiteboard',v_old_asset,'object',(select auth.uid()),'unreferenced-board-asset')
    on conflict(bucket_id,object_path) do update set not_before=greatest(public.storage_cleanup_jobs.not_before,now()+interval '24 hours'),updated_at=now()
      where public.storage_cleanup_jobs.state='queued';
  end loop;
  delete from public.board_asset_references where board_file_id=v_result.id;
  insert into public.board_asset_references(board_file_id,object_path)
    select v_result.id,x from unnest(coalesce(p_asset_paths,array[]::text[])) x on conflict do nothing;
  if v_old_path is not null and v_old_path <> v_result.snapshot_path
     and v_old_path not like 'shared/%' then
    insert into public.storage_cleanup_jobs(bucket_id, object_path, path_kind, owner_id, reason)
    values ('class-whiteboard', v_old_path, 'object', (select auth.uid()), 'superseded-board-revision')
    on conflict (bucket_id, object_path) do update set not_before=greatest(public.storage_cleanup_jobs.not_before, now()+interval '24 hours'), updated_at=now()
      where public.storage_cleanup_jobs.state='queued';
  end if;
  return v_result;
end;
$$;
revoke all on function public.commit_board_file_revision(jsonb,text,text[]) from public, anon;
grant execute on function public.commit_board_file_revision(jsonb,text,text[]) to authenticated;

create or replace function public.enqueue_owned_board_cleanup(p_paths text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare p text; n integer := 0; uid uuid := (select auth.uid()); cleanup_owner uuid;
begin
  if uid is null or coalesce(array_length(p_paths,1),0) > 100 then raise exception 'Invalid cleanup request'; end if;
  foreach p in array p_paths loop
    cleanup_owner := null;
    if p like ('teachers/'||uid::text||'/%') then
      cleanup_owner := uid;
    else
      select c.teacher_id into cleanup_owner
      from public.students s join public.classes c on c.id=s.class_id
      where p like ('students/'||s.id::text||'/%')
        and (s.auth_user_id=uid or c.teacher_id=uid);
    end if;
    if cleanup_owner is not null then
      insert into public.storage_cleanup_jobs(bucket_id,object_path,path_kind,owner_id,reason)
      values('class-whiteboard',p,'object',cleanup_owner,'abandoned-board-upload')
      on conflict(bucket_id,object_path) do update set not_before=greatest(public.storage_cleanup_jobs.not_before,now()+interval '24 hours'),updated_at=now()
        where public.storage_cleanup_jobs.state='queued';
      n:=n+1;
    else raise exception 'Cleanup path is outside caller ownership'; end if;
  end loop; return n;
end $$;
revoke all on function public.enqueue_owned_board_cleanup(text[]) from public,anon;
grant execute on function public.enqueue_owned_board_cleanup(text[]) to authenticated;

create or replace function public.delete_teacher_history_records(p_teacher_id uuid,p_history_kind text,p_history_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_deleted_files integer:=0; v_deleted_history integer:=0; v_cleanup_queued integer:=0; v_row_count integer:=0; r record;
begin
  if p_history_kind='assignment' then
    if not exists(select 1 from public.board_distributions where id=p_history_id and teacher_id=p_teacher_id and distribution_kind='assignment') then
      return jsonb_build_object('deleted',false,'deletedHistoryCount',0,'deletedBoardFileCount',0);
    end if;
    insert into public.storage_cleanup_jobs(bucket_id,object_path,path_kind,owner_id,reason)
    values('class-whiteboard','shared/'||p_history_id::text,'prefix',p_teacher_id,'deleted-assignment')
    on conflict(bucket_id,object_path) do update set updated_at=now() where public.storage_cleanup_jobs.state='queued';
    get diagnostics v_row_count=row_count; v_cleanup_queued := v_cleanup_queued + v_row_count;
    insert into public.storage_cleanup_jobs(bucket_id,object_path,path_kind,owner_id,reason)
      select distinct 'class-whiteboard',ar.object_path,'object',p_teacher_id,'deleted-assignment-asset'
      from public.board_asset_references ar join public.board_files bf on bf.id=ar.board_file_id
      where bf.distribution_id=p_history_id
      on conflict(bucket_id,object_path) do nothing;
    get diagnostics v_row_count=row_count; v_cleanup_queued:=v_cleanup_queued+v_row_count;
    for r in select snapshot_path,thumbnail_path from public.board_files where distribution_id=p_history_id loop
      if r.snapshot_path like 'students/%' then insert into public.storage_cleanup_jobs(bucket_id,object_path,path_kind,owner_id,reason) values('class-whiteboard',r.snapshot_path,'object',p_teacher_id,'deleted-assignment') on conflict do nothing; get diagnostics v_row_count=row_count; v_cleanup_queued:=v_cleanup_queued+v_row_count; end if;
      if r.thumbnail_path like 'students/%' then insert into public.storage_cleanup_jobs(bucket_id,object_path,path_kind,owner_id,reason) values('class-whiteboard',r.thumbnail_path,'object',p_teacher_id,'deleted-assignment') on conflict do nothing; get diagnostics v_row_count=row_count; v_cleanup_queued:=v_cleanup_queued+v_row_count; end if;
    end loop;
    delete from public.board_files where distribution_id=p_history_id; get diagnostics v_deleted_files=row_count;
    delete from public.board_distributions where id=p_history_id and teacher_id=p_teacher_id; get diagnostics v_deleted_history=row_count;
  elsif p_history_kind='form' then
    insert into public.storage_cleanup_jobs(bucket_id,object_path,path_kind,owner_id,reason)
      select distinct 'class-whiteboard',q.image_path,'object',p_teacher_id,'deleted-form-run'
      from public.form_run_questions q join public.form_runs fr on fr.id=q.run_id
      where fr.id=p_history_id and fr.teacher_id=p_teacher_id and q.image_path is not null
      on conflict(bucket_id,object_path) do update set updated_at=now() where public.storage_cleanup_jobs.state='queued';
    get diagnostics v_cleanup_queued=row_count;
    delete from public.form_runs where id=p_history_id and teacher_id=p_teacher_id; get diagnostics v_deleted_history=row_count;
  else raise exception 'History kind must be assignment or form'; end if;
  return jsonb_build_object('deleted',v_deleted_history=1,'deletedHistoryCount',v_deleted_history,'deletedBoardFileCount',v_deleted_files,'cleanupQueuedCount',v_cleanup_queued);
end $$;
revoke all on function public.delete_teacher_history_records(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.delete_teacher_history_records(uuid,text,uuid) to service_role;

create or replace function public.enqueue_student_storage_cleanup(p_teacher_id uuid,p_student_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.students s join public.classes c on c.id=s.class_id where s.id=p_student_id and c.teacher_id=p_teacher_id) then raise exception 'Student not owned by teacher'; end if;
  insert into public.storage_cleanup_jobs(bucket_id,object_path,path_kind,owner_id,reason)
  values('class-whiteboard','students/'||p_student_id::text,'prefix',p_teacher_id,'deleted-student')
  on conflict(bucket_id,object_path) do update set updated_at=now() where public.storage_cleanup_jobs.state='queued';
end $$;
revoke all on function public.enqueue_student_storage_cleanup(uuid,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_student_storage_cleanup(uuid,uuid) to service_role;

-- Maintenance entry point for uploads whose client disappeared before it could
-- enqueue cleanup. Existing legacy board assets are excluded until that board
-- has successfully saved once through the revision/reference protocol.
create or replace function public.enqueue_stale_storage_uploads(
  p_older_than interval default interval '48 hours', p_limit integer default 500
)
returns integer language plpgsql security invoker set search_path='' as $$
declare v_count integer := 0;
begin
  with candidates as (
    select o.bucket_id, o.name,
      case
        when o.name like 'teachers/%' then nullif(split_part(o.name,'/',2),'')::uuid
        else c.teacher_id
      end as owner_id
    from storage.objects o
    left join public.students s on o.name like ('students/'||s.id::text||'/%')
    left join public.classes c on c.id=s.class_id
    where o.bucket_id='class-whiteboard'
      and coalesce(o.updated_at,o.created_at) < now() - greatest(p_older_than, interval '24 hours')
      and (
        o.name ~ '^teachers/[0-9a-f-]{36}/forms/[0-9a-f-]{36}\.(jpg|png|webp|gif)$'
        or o.name ~ '^(teachers|students)/[0-9a-f-]{36}/[0-9a-f-]{36}/revisions/[0-9a-f-]{36}\.json$'
        or (
          o.name ~ '^(teachers|students)/[0-9a-f-]{36}/[0-9a-f-]{36}/assets/[^/]+$'
          and (
            not exists (select 1 from public.board_files bf where bf.id=split_part(o.name,'/',3)::uuid)
            or exists (
              select 1 from public.board_files bf
              where bf.id=split_part(o.name,'/',3)::uuid
                and bf.snapshot_path like (split_part(o.name,'/',1)||'/'||split_part(o.name,'/',2)||'/'||split_part(o.name,'/',3)||'/revisions/%')
            )
          )
        )
      )
      and not app_private.storage_path_has_reference(o.name,'object')
    order by coalesce(o.updated_at,o.created_at),o.name
    limit least(greatest(coalesce(p_limit,500),1),2000)
  )
  insert into public.storage_cleanup_jobs(bucket_id,object_path,path_kind,owner_id,reason)
  select bucket_id,name,'object',owner_id,'stale-uncommitted-upload' from candidates
  on conflict(bucket_id,object_path) do nothing;
  get diagnostics v_count=row_count;
  return v_count;
end $$;
revoke all on function public.enqueue_stale_storage_uploads(interval,integer) from public,anon,authenticated;
grant execute on function public.enqueue_stale_storage_uploads(interval,integer) to service_role;
