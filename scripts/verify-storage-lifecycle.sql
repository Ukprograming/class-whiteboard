-- Run against a migrated database. Every fixture is rolled back; no Storage API
-- object is created or removed.
begin;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,created_at,updated_at)
values
('00000000-0000-0000-0000-000000000000','11000000-0000-4000-8000-000000000001','authenticated','authenticated','storage-test-t1@example.invalid','',now(),now()),
('00000000-0000-0000-0000-000000000000','11000000-0000-4000-8000-000000000002','authenticated','authenticated','storage-test-t2@example.invalid','',now(),now()),
('00000000-0000-0000-0000-000000000000','22000000-0000-4000-8000-000000000001','authenticated','authenticated','storage-test-s1@example.invalid','',now(),now()),
('00000000-0000-0000-0000-000000000000','22000000-0000-4000-8000-000000000002','authenticated','authenticated','storage-test-s2@example.invalid','',now(),now());
insert into public.profiles(id,role,display_name) values
('11000000-0000-4000-8000-000000000001','teacher','T1'),('11000000-0000-4000-8000-000000000002','teacher','T2'),
('22000000-0000-4000-8000-000000000001','student','S1'),('22000000-0000-4000-8000-000000000002','student','S2');
insert into public.classes(id,teacher_id,class_code,name) values
('33000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','ZZT10001','C1'),
('33000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','ZZT20002','C2');
insert into public.students(id,auth_user_id,class_id,student_login_id,display_name,auth_email,created_by) values
('44000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','s1','S1','storage-test-s1@example.invalid','11000000-0000-4000-8000-000000000001'),
('44000000-0000-4000-8000-000000000002','22000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000002','s2','S2','storage-test-s2@example.invalid','11000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
insert into public.board_files(id,owner_kind,teacher_id,class_id,name,snapshot_path)
values('55000000-0000-4000-8000-000000000001','teacher','11000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','own','teachers/11000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001/revisions/66000000-0000-4000-8000-000000000001.json');
select (public.commit_board_file_revision(
  jsonb_build_object('id','55000000-0000-4000-8000-000000000001','owner_kind','teacher',
    'teacher_id','11000000-0000-4000-8000-000000000001','class_id','33000000-0000-4000-8000-000000000001',
    'folder_path','','name','own-2','snapshot_path','teachers/11000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001/revisions/66000000-0000-4000-8000-000000000002.json','size_bytes',10),
  'teachers/11000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001/revisions/66000000-0000-4000-8000-000000000001.json',
  array['teachers/11000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001/assets/a.png']
)).id as committed_board_id;
select public.enqueue_owned_board_cleanup(array['students/44000000-0000-4000-8000-000000000001/orphan.json']);
do $$ begin
  begin
    perform public.enqueue_owned_board_cleanup(array['students/44000000-0000-4000-8000-000000000002/orphan.json']);
    raise exception 'foreign cleanup path unexpectedly succeeded';
  exception when insufficient_privilege or raise_exception then
    if sqlerrm='foreign cleanup path unexpectedly succeeded' then raise; end if;
  end;
end $$;

do $$ begin
  begin
    insert into public.board_files(owner_kind,student_id,class_id,name,snapshot_path)
    values('student','44000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000001','forged','students/44000000-0000-4000-8000-000000000002/x.json');
    raise exception 'foreign student/class write unexpectedly succeeded';
  exception when insufficient_privilege or check_violation or raise_exception then
    if sqlerrm='foreign student/class write unexpectedly succeeded' then raise; end if;
  end;
end $$;
do $$ begin
  begin
    perform public.commit_board_file_revision(
      jsonb_build_object('id','55000000-0000-4000-8000-000000000099','owner_kind','student',
        'student_id','44000000-0000-4000-8000-000000000002','class_id','33000000-0000-4000-8000-000000000002',
        'folder_path','','name','foreign-rpc','snapshot_path','students/44000000-0000-4000-8000-000000000002/55000000-0000-4000-8000-000000000099/revisions/66000000-0000-4000-8000-000000000099.json','size_bytes',1),
      null,array[]::text[]);
    raise exception 'foreign student RPC unexpectedly succeeded';
  exception when insufficient_privilege or raise_exception then
    if sqlerrm='foreign student RPC unexpectedly succeeded' then raise; end if;
  end;
end $$;

reset role;
insert into public.board_distributions(id,class_id,teacher_id,source_board_id,title,distribution_kind)
values('77000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','55000000-0000-4000-8000-000000000001','D','material');
update public.board_distributions set distribution_kind='assignment'
where id='77000000-0000-4000-8000-000000000001';
insert into public.board_files(id,owner_kind,student_id,class_id,name,snapshot_path,source_board_id,distribution_id)
values('55000000-0000-4000-8000-000000000002','student','44000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','D','shared/77000000-0000-4000-8000-000000000001/snapshot.json','55000000-0000-4000-8000-000000000001','77000000-0000-4000-8000-000000000001');
insert into public.board_files(id,owner_kind,teacher_id,class_id,name,snapshot_path)
values('55000000-0000-4000-8000-000000000003','teacher','11000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000002','foreign-source','teachers/11000000-0000-4000-8000-000000000002/55000000-0000-4000-8000-000000000003.json');
insert into public.board_distributions(id,class_id,teacher_id,source_board_id,title,distribution_kind)
values('77000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','55000000-0000-4000-8000-000000000003','Foreign','material');
insert into public.board_files(id,owner_kind,student_id,class_id,name,snapshot_path,source_board_id,distribution_id)
values('55000000-0000-4000-8000-000000000004','student','44000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000002','Foreign','shared/77000000-0000-4000-8000-000000000002/snapshot.json','55000000-0000-4000-8000-000000000003','77000000-0000-4000-8000-000000000002');
insert into storage.objects(id,bucket_id,name) values
('aa000000-0000-4000-8000-000000000001','class-whiteboard','shared/77000000-0000-4000-8000-000000000001/snapshot.json'),
('aa000000-0000-4000-8000-000000000002','class-whiteboard','shared/77000000-0000-4000-8000-000000000002/snapshot.json');
set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
do $$ begin
  if not exists(select 1 from storage.objects where name='shared/77000000-0000-4000-8000-000000000001/snapshot.json') then
    raise exception 'own class distribution object was not readable';
  end if;
  if exists(select 1 from storage.objects where name='shared/77000000-0000-4000-8000-000000000002/snapshot.json') then
    raise exception 'foreign class distribution object was readable';
  end if;
end $$;
reset role;

insert into public.form_templates(id,teacher_id,title) values
('88000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','F1'),
('88000000-0000-4000-8000-000000000002','11000000-0000-4000-8000-000000000002','F2');
do $$ begin
  begin
    insert into public.form_template_questions(template_id,position,question_type,prompt,image_path,image_mime_type,image_width,image_height)
    values('88000000-0000-4000-8000-000000000001',1,'text','x','teachers/11000000-0000-4000-8000-000000000002/forms/99000000-0000-4000-8000-000000000001.jpg','image/jpeg',10,10);
    raise exception 'foreign form image unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm='foreign form image unexpectedly succeeded' then raise; end if;
  end;
end $$;
insert into public.form_template_questions(template_id,position,question_type,prompt,image_path,image_mime_type,image_width,image_height)
values('88000000-0000-4000-8000-000000000001',1,'text','cascade-image',
  'teachers/11000000-0000-4000-8000-000000000001/forms/99000000-0000-4000-8000-000000000010.jpg','image/jpeg',10,10);
delete from public.form_templates where id='88000000-0000-4000-8000-000000000001';
do $$ begin
  if not exists(
    select 1 from public.storage_cleanup_jobs
    where object_path='teachers/11000000-0000-4000-8000-000000000001/forms/99000000-0000-4000-8000-000000000010.jpg'
      and owner_id='11000000-0000-4000-8000-000000000001'
  ) then raise exception 'cascaded form image was not queued'; end if;
end $$;
insert into public.form_templates(id,teacher_id,title)
values('88000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-000000000001','F3');

insert into public.storage_cleanup_jobs(bucket_id,object_path,path_kind,owner_id,reason,not_before)
values('class-whiteboard','teachers/11000000-0000-4000-8000-000000000001/forms/99000000-0000-4000-8000-000000000002.jpg','object','11000000-0000-4000-8000-000000000001','fixture',now()-interval '1 minute');
do $$ declare n integer; begin
  select count(*) into n from public.claim_storage_cleanup_jobs(10,null);
  if n <> 1 then raise exception 'expected one due cleanup claim, got %',n; end if;
end $$;
do $$ begin
  begin
    insert into public.form_template_questions(template_id,position,question_type,prompt,image_path,image_mime_type,image_width,image_height)
    values('88000000-0000-4000-8000-000000000003',1,'text','x','teachers/11000000-0000-4000-8000-000000000001/forms/99000000-0000-4000-8000-000000000002.jpg','image/jpeg',10,10);
    raise exception 'claimed cleanup path unexpectedly became referenced';
  exception when object_not_in_prerequisite_state or raise_exception then
    if sqlerrm='claimed cleanup path unexpectedly became referenced' then raise; end if;
  end;
end $$;

insert into public.storage_cleanup_jobs(bucket_id,object_path,path_kind,owner_id,reason,not_before)
values
('class-whiteboard','teachers/11000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000001/assets/a.png','object','11000000-0000-4000-8000-000000000001','referenced-asset',now()-interval '1 minute'),
('class-whiteboard','teachers/11000000-0000-4000-8000-000000000001/forms/99000000-0000-4000-8000-000000000003.jpg','object','11000000-0000-4000-8000-000000000001','fresh-claim',now()-interval '1 minute')
on conflict do nothing;
update public.storage_cleanup_jobs set state='claimed',updated_at=now()
where object_path like '%000000000003.jpg';
do $$ declare n integer; begin
  select count(*) into n from public.claim_storage_cleanup_jobs(50,null)
    where object_path like '%000000000003.jpg';
  if n <> 0 then raise exception 'fresh claim was reclaimed'; end if;
end $$;
update public.storage_cleanup_jobs set updated_at=now()-interval '20 minutes'
where object_path like '%000000000003.jpg';
do $$ declare n integer; begin
  select count(*) into n from public.claim_storage_cleanup_jobs(50,null)
    where object_path like '%000000000003.jpg';
  if n <> 1 then raise exception 'stale claim was not reclaimed'; end if;
end $$;
do $$ begin
  if exists(select 1 from public.storage_cleanup_jobs where object_path like '%/assets/a.png' and state='claimed') then
    raise exception 'referenced board asset was claimed';
  end if;
end $$;

select jsonb_build_object(
  'teacher_board_ok',exists(select 1 from public.board_files where id='55000000-0000-4000-8000-000000000001'),
  'immutable_distribution_ok',exists(select 1 from public.board_files where id='55000000-0000-4000-8000-000000000002'),
  'cleanup_claimed',exists(select 1 from public.storage_cleanup_jobs where state='claimed')
) as pre_delete_summary;

insert into public.board_asset_references(board_file_id,object_path)
values('55000000-0000-4000-8000-000000000002','students/44000000-0000-4000-8000-000000000001/55000000-0000-4000-8000-000000000002/assets/detached.png');
select public.delete_teacher_history_records(
  '11000000-0000-4000-8000-000000000001','assignment','77000000-0000-4000-8000-000000000001'
) as delete_result;
do $$ begin
  if exists(select 1 from public.board_distributions where id='77000000-0000-4000-8000-000000000001') then
    raise exception 'assignment history was not deleted';
  end if;
  if not exists(select 1 from public.storage_cleanup_jobs where object_path='shared/77000000-0000-4000-8000-000000000001') then
    raise exception 'shared distribution prefix was not queued';
  end if;
  if not exists(select 1 from public.storage_cleanup_jobs where object_path like '%/assets/detached.png') then
    raise exception 'detached assignment asset was not queued';
  end if;
end $$;
select jsonb_build_object('all_assertions_passed',true) as verification_summary;
rollback;
