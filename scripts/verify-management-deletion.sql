-- Run with the migration installed, inside a transaction that is always rolled back.
do $$
declare
  t uuid := gen_random_uuid(); other_teacher uuid := gen_random_uuid();
  u uuid := gen_random_uuid(); c uuid := gen_random_uuid(); other_class uuid := gen_random_uuid();
  s uuid := gen_random_uuid(); b uuid := gen_random_uuid(); reusable uuid := gen_random_uuid();
  d uuid := gen_random_uuid(); f uuid := gen_random_uuid(); r uuid := gen_random_uuid();
  j uuid; j2 uuid; img text; d2 uuid := gen_random_uuid();
begin
  if has_function_privilege('authenticated','public.begin_management_deletion(uuid,text,uuid)','execute')
    or has_table_privilege('authenticated','public.management_deletion_jobs','select')
    or has_table_privilege('authenticated','public.classes','delete') then
    raise exception 'Deletion privileges are exposed';
  end if;
  insert into auth.users(id,email) values(t,t::text||'@example.invalid'),
    (other_teacher,other_teacher::text||'@example.invalid'),(u,u::text||'@example.invalid');
  insert into public.profiles(id,role) values(t,'teacher'),(other_teacher,'teacher'),(u,'student');
  insert into public.classes(id,teacher_id,class_code,name) values
    (c,t,'DEL_'||upper(left(replace(c::text,'-',''),24)),'C'),
    (other_class,t,'DEL_'||upper(left(replace(other_class::text,'-',''),24)),'Retained');
  insert into public.students(id,auth_user_id,class_id,student_login_id,display_name,auth_email,created_by)
    values(s,u,c,'s1','S',u::text||'@example.invalid',t);
  insert into public.board_files(id,teacher_id,class_id,owner_kind,name,snapshot_path) values
    (b,t,c,'teacher','B','teachers/'||t||'/'||b||'.json'),
    (reusable,t,c,'teacher','Reusable','teachers/'||t||'/'||reusable||'.json');
  insert into public.board_distributions(id,class_id,teacher_id,source_board_id,title)
    values(d,other_class,t,reusable,'Retained distribution');
  insert into public.board_distributions(id,class_id,teacher_id,source_board_id,title)
    values(d2,c,t,reusable,'Deleted distribution');
  insert into public.board_files(owner_kind,student_id,class_id,name,distribution_id,source_board_id,snapshot_path)
    values('student',s,c,'Student copy',d2,reusable,'shared/'||d2||'/snapshot.json');
  img := 'teachers/'||t||'/forms/'||gen_random_uuid()||'.png';
  insert into public.form_templates(id,teacher_id,title) values(f,t,'Template');
  insert into public.form_template_questions(template_id,position,question_type,prompt,image_path,image_mime_type,image_width,image_height)
    values(f,1,'text','Q',img,'image/png',10,10);
  insert into public.form_runs(id,template_id,class_id,teacher_id,title) values(r,f,c,t,'Run');
  insert into public.form_run_questions(run_id,position,question_type,prompt,image_path,image_mime_type,image_width,image_height)
    values(r,1,'text','Q',img,'image/png',10,10);
  begin
    perform public.begin_management_deletion(other_teacher,'class',c);
    raise exception 'Foreign class deletion allowed';
  exception when insufficient_privilege then null;
  end;
  set local role service_role;
  j := public.begin_management_deletion(t,'class',c);
  if public.begin_management_deletion(t,'class',c) <> j then raise exception 'Retry is not idempotent'; end if;
  if exists(select 1 from public.classes where id=c) or exists(select 1 from public.students where id=s)
    or exists(select 1 from public.profiles where id=u) or exists(select 1 from public.board_files where id=b)
    or exists(select 1 from public.form_runs where id=r) then raise exception 'Target data remained'; end if;
  if not exists(select 1 from public.board_files where id=reusable and class_id is null)
    or not exists(select 1 from public.board_distributions where id=d)
    or not exists(select 1 from public.classes where id=other_class) then raise exception 'Shared material was deleted'; end if;
  if not exists(select 1 from public.management_deletion_jobs where id=j and u=any(remaining_users)
    and remaining_storage @> jsonb_build_array(jsonb_build_object('object_path','students/'||s,'path_kind','prefix'))) then
    raise exception 'Deletion manifest incomplete'; end if;
  if public.prepare_management_storage_deletion(img,'object') then raise exception 'Live form image deletable'; end if;
  if public.prepare_management_storage_deletion('teachers/'||t,'prefix') then raise exception 'Live prefix deletable'; end if;
  if exists(select 1 from public.claim_management_deletion(j,other_teacher)) then raise exception 'Foreign job claimed'; end if;
  if not exists(select 1 from public.claim_management_deletion(j,t)) then raise exception 'Job not claimed'; end if;
  if exists(select 1 from public.claim_management_deletion(j,t)) then raise exception 'Duplicate lease'; end if;
  j2 := public.begin_management_deletion(t,'teacher',t);
  if exists(select 1 from public.profiles where id=t) or exists(select 1 from public.classes where teacher_id=t)
    or exists(select 1 from public.form_templates where teacher_id=t) then raise exception 'Teacher data remained'; end if;
  if not exists(select 1 from public.management_deletion_jobs where id=j2 and u=any(remaining_users)
    and remaining_users[cardinality(remaining_users)]=t) then raise exception 'Auth retry manifest/order incorrect'; end if;
  if not public.prepare_management_storage_deletion('teachers/'||t,'prefix') then raise exception 'Unused prefix not deletable'; end if;
  reset role;
  if app_private.management_storage_path_available('teachers/'||t||'/late.png') then raise exception 'Late upload allowed'; end if;
  if not exists(select 1 from auth.users where id=u) then raise exception 'Auth must be removed via API after Storage'; end if;
  if not exists(select 1 from public.profiles where id=other_teacher) then raise exception 'Unrelated teacher deleted'; end if;
  perform set_config('request.jwt.claim.sub', t::text, true);
  set local role authenticated;
  begin
    insert into storage.objects(bucket_id,name) values('class-whiteboard','teachers/'||t||'/late.png');
    raise exception 'Deleted teacher JWT could upload';
  exception when insufficient_privilege then null;
  end;
  reset role;
  set local role service_role;
  j := public.begin_management_deletion(other_teacher,'teacher',other_teacher);
  if not exists(select 1 from public.management_deletion_jobs where id=j
    and remaining_users=array[other_teacher]) then raise exception 'Empty teacher account deletion failed'; end if;
  reset role;
end $$;
select true as management_deletion_assertions_passed;
