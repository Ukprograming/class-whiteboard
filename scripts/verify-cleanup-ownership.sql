-- Run after the ownership migration. Synthetic records and claims are rolled
-- back. No Storage object is uploaded/deleted, and no existing job is claimed.
begin;
do $$
declare
  teacher_a uuid := gen_random_uuid();
  teacher_b uuid := gen_random_uuid();
  student_user uuid := gen_random_uuid();
  class_a uuid := gen_random_uuid();
  student_a uuid := gen_random_uuid();
  board_a uuid := gen_random_uuid();
  root_path text;
  old_path text;
  new_path text;
  asset_path text;
  abandoned_path text;
  payload jsonb;
  n integer;
begin
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,created_at,updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid,id,'authenticated','authenticated',
    id::text || '@cleanup-verification.invalid','',now(),now()
  from unnest(array[teacher_a,teacher_b,student_user]) as t(id);
  insert into public.profiles(id,role,display_name) values
    (teacher_a,'teacher','Cleanup fixture A'),(teacher_b,'teacher','Cleanup fixture B'),
    (student_user,'student','Cleanup fixture student');
  insert into public.classes(id,teacher_id,class_code,name)
  values(class_a,teacher_a,'ZZ' || upper(substr(replace(class_a::text,'-',''),1,20)),'Cleanup fixture');
  insert into public.students(id,auth_user_id,class_id,student_login_id,display_name,auth_email,created_by)
  values(student_a,student_user,class_a,'fixture','Cleanup fixture',student_user::text || '@cleanup-verification.invalid',teacher_a);

  root_path := 'students/' || student_a::text || '/' || board_a::text;
  old_path := root_path || '/revisions/' || gen_random_uuid()::text || '.json';
  new_path := root_path || '/revisions/' || gen_random_uuid()::text || '.json';
  asset_path := root_path || '/assets/old.png';
  abandoned_path := root_path || '/assets/abandoned.png';
  payload := jsonb_build_object('id',board_a,'owner_kind','student','student_id',student_a,
    'class_id',class_a,'folder_path','','name','Fixture','snapshot_path',old_path,'size_bytes',10);
  perform set_config('request.jwt.claim.sub',student_user::text,true);
  execute 'set local role authenticated';
  perform public.commit_board_file_revision(payload,null,array[asset_path]);
  perform public.commit_board_file_revision(jsonb_set(payload,'{snapshot_path}',to_jsonb(new_path)),old_path,array[]::text[]);
  perform public.enqueue_owned_board_cleanup(array[abandoned_path]);
  begin
    perform public.enqueue_owned_board_cleanup(array['teachers/' || teacher_b::text || '/foreign.png']);
    raise exception 'Foreign cleanup enqueue was accepted';
  exception when raise_exception then
    if sqlerrm = 'Foreign cleanup enqueue was accepted' then raise; end if;
  end;
  execute 'reset role';

  select count(*) into n from public.storage_cleanup_jobs
  where object_path in(old_path,asset_path,abandoned_path) and owner_id=teacher_a and state='queued';
  if n <> 3 then raise exception 'Expected three teacher-owned cleanup jobs, got %',n; end if;
  if exists(select 1 from public.storage_cleanup_jobs where object_path in(old_path,asset_path,abandoned_path)
    and not_before < now()+interval '23 hours') then raise exception 'Grace period was lost'; end if;
  if has_function_privilege('authenticated','public.claim_storage_cleanup_jobs(integer,uuid)','EXECUTE') then
    raise exception 'Client can directly claim cleanup jobs';
  end if;

  -- Simulate one legacy student-owned reservation and make only our fixtures due.
  update public.storage_cleanup_jobs set owner_id=student_user where object_path=old_path;
  update public.storage_cleanup_jobs set not_before=now()-interval '1 minute'
    where object_path in(old_path,asset_path,abandoned_path);
  -- A still-referenced snapshot must be cancelled rather than claimed.
  insert into public.storage_cleanup_jobs(bucket_id,object_path,path_kind,owner_id,reason,not_before)
  values('class-whiteboard',new_path,'object',teacher_a,'fixture-reference',now()-interval '1 minute');

  execute 'set local role service_role';
  select count(*) into n from public.claim_storage_cleanup_jobs(100,teacher_b);
  if n <> 0 then raise exception 'Other teacher claimed fixture jobs'; end if;
  select count(*) into n from public.claim_storage_cleanup_jobs(100,teacher_a);
  if n <> 3 then raise exception 'Expected three claims for class teacher, got %',n; end if;
  execute 'reset role';
  if exists(select 1 from public.storage_cleanup_jobs where object_path=new_path and state='claimed') then
    raise exception 'Current snapshot was claimed';
  end if;
  if not exists(select 1 from public.board_files where id=board_a and snapshot_path=new_path) then
    raise exception 'Current board changed';
  end if;
  if exists(select 1 from public.storage_cleanup_jobs where object_path=old_path and owner_id<>teacher_a) then
    raise exception 'Legacy student owner not repaired';
  end if;

  -- Reassignment resolves against current membership, not a stale owner ID.
  update public.classes set teacher_id=teacher_b where id=class_a;
  update public.storage_cleanup_jobs set state='queued',not_before=now()-interval '1 minute' where object_path=old_path;
  execute 'set local role service_role';
  select count(*) into n from public.claim_storage_cleanup_jobs(100,teacher_a);
  if n <> 0 then raise exception 'Former teacher claimed transferred student job'; end if;
  select count(*) into n from public.claim_storage_cleanup_jobs(100,teacher_b);
  if n <> 1 then raise exception 'Current teacher could not claim transferred student job'; end if;
  execute 'reset role';
end;
$$;
select jsonb_build_object('cleanup_ownership_verified',true,'fixtures_rolled_back',true) as result;
rollback;
