-- Keep teacher-uploaded form images in the existing private Storage bucket.
-- Template rows retain the current authoring reference, while run questions
-- snapshot the reference so later template edits do not alter past forms.

alter table public.form_template_questions
  add column image_path text,
  add column image_mime_type text,
  add column image_width integer,
  add column image_height integer;

alter table public.form_run_questions
  add column image_path text,
  add column image_mime_type text,
  add column image_width integer,
  add column image_height integer;

alter table public.form_template_questions
  add constraint form_template_questions_image_shape check (
    (
      image_path is null
      and image_mime_type is null
      and image_width is null
      and image_height is null
    )
    or (
      char_length(image_path) between 1 and 500
      and image_mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
      and image_width is not null
      and image_height is not null
      and image_width between 1 and 12000
      and image_height between 1 and 12000
    )
  );

alter table public.form_run_questions
  add constraint form_run_questions_image_shape check (
    (
      image_path is null
      and image_mime_type is null
      and image_width is null
      and image_height is null
    )
    or (
      char_length(image_path) between 1 and 500
      and image_mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
      and image_width is not null
      and image_height is not null
      and image_width between 1 and 12000
      and image_height between 1 and 12000
    )
  );

create index form_run_questions_image_path_idx
  on public.form_run_questions (image_path)
  where image_path is not null;

-- Students can download only images referenced by a form run in their class.
-- Teacher write/delete access is already covered by storage_board_teacher_access
-- for teachers/{auth.uid()}/... paths.
drop policy if exists storage_form_student_read on storage.objects;
create policy storage_form_student_read on storage.objects
for select to authenticated
using (
  bucket_id = 'class-whiteboard'
  and exists (
    select 1
    from public.form_run_questions frq
    join public.form_runs fr on fr.id = frq.run_id
    where frq.image_path = storage.objects.name
      and (select app_private.is_student_in_class(fr.class_id))
  )
);

create or replace function public.save_form_template(
  p_template_id uuid,
  p_title text,
  p_questions jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_template_id uuid;
  v_question jsonb;
  v_question_type text;
  v_prompt text;
  v_options jsonb;
  v_position integer := 0;
  v_image_path text;
  v_image_mime_type text;
  v_image_width integer;
  v_image_height integer;
  v_teacher_prefix text;
begin
  if (select auth.uid()) is null or not (select app_private.is_teacher()) then
    raise exception 'Teacher login is required';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Form title must be between 1 and 120 characters';
  end if;
  if p_questions is null
     or jsonb_typeof(p_questions) <> 'array'
     or jsonb_array_length(p_questions) not between 1 and 30 then
    raise exception 'A form must contain between 1 and 30 questions';
  end if;

  if p_template_id is null then
    insert into public.form_templates (teacher_id, title)
    values ((select auth.uid()), trim(p_title))
    returning id into v_template_id;
  else
    update public.form_templates
    set title = trim(p_title), archived = false
    where id = p_template_id
      and teacher_id = (select auth.uid())
    returning id into v_template_id;
    if v_template_id is null then
      raise exception 'Form template not found';
    end if;
    delete from public.form_template_questions where template_id = v_template_id;
  end if;

  v_teacher_prefix := 'teachers/' || (select auth.uid())::text || '/forms/';

  for v_question in select value from jsonb_array_elements(p_questions)
  loop
    v_position := v_position + 1;
    v_question_type := coalesce(v_question ->> 'questionType', '');
    v_prompt := trim(coalesce(v_question ->> 'prompt', ''));
    v_options := coalesce(v_question -> 'options', '[]'::jsonb);
    v_image_path := nullif(trim(coalesce(v_question ->> 'imagePath', '')), '');
    v_image_mime_type := nullif(trim(coalesce(v_question ->> 'imageMimeType', '')), '');
    v_image_width := nullif(v_question ->> 'imageWidth', '')::integer;
    v_image_height := nullif(v_question ->> 'imageHeight', '')::integer;

    if v_question_type not in ('text', 'single_choice', 'multiple_choice') then
      raise exception 'Unsupported question type';
    end if;
    if char_length(v_prompt) not between 1 and 1000 then
      raise exception 'Question prompt must be between 1 and 1000 characters';
    end if;
    if v_question_type = 'text' then
      v_options := '[]'::jsonb;
    elsif jsonb_typeof(v_options) <> 'array'
       or jsonb_array_length(v_options) not between 2 and 10 then
      raise exception 'Choice questions require between 2 and 10 options';
    elsif exists (
      select 1
      from jsonb_array_elements(v_options) option_value
      where jsonb_typeof(option_value) <> 'object'
         or char_length(trim(coalesce(option_value ->> 'id', ''))) not between 1 and 80
         or char_length(trim(coalesce(option_value ->> 'label', ''))) not between 1 and 300
    ) then
      raise exception 'Each option requires a valid id and label';
    elsif (
      select count(distinct option_value ->> 'id')
      from jsonb_array_elements(v_options) option_value
    ) <> jsonb_array_length(v_options) then
      raise exception 'Option ids must be unique within a question';
    end if;

    if v_image_path is null then
      v_image_mime_type := null;
      v_image_width := null;
      v_image_height := null;
    elsif v_image_path not like (v_teacher_prefix || '%')
       or v_image_path !~ '^teachers/[0-9a-f-]{36}/forms/[0-9a-f-]{36}\.(jpg|png|webp|gif)$'
       or v_image_mime_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
       or v_image_width is null
       or v_image_height is null
       or v_image_width not between 1 and 12000
       or v_image_height not between 1 and 12000
       or (v_image_mime_type = 'image/jpeg' and v_image_path !~ '\.jpg$')
       or (v_image_mime_type = 'image/png' and v_image_path !~ '\.png$')
       or (v_image_mime_type = 'image/webp' and v_image_path !~ '\.webp$')
       or (v_image_mime_type = 'image/gif' and v_image_path !~ '\.gif$') then
      raise exception 'Question image reference is invalid';
    end if;

    insert into public.form_template_questions (
      template_id,
      position,
      question_type,
      prompt,
      required,
      options,
      image_path,
      image_mime_type,
      image_width,
      image_height
    ) values (
      v_template_id,
      v_position,
      v_question_type,
      v_prompt,
      coalesce((v_question ->> 'required')::boolean, true),
      v_options,
      v_image_path,
      v_image_mime_type,
      v_image_width,
      v_image_height
    );
  end loop;

  return v_template_id;
end;
$$;

create or replace function public.start_form_run(
  p_template_id uuid,
  p_class_code text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_class_id uuid;
  v_title text;
  v_run_id uuid;
begin
  if (select auth.uid()) is null or not (select app_private.is_teacher()) then
    raise exception 'Teacher login is required';
  end if;

  select c.id into v_class_id
  from public.classes c
  where c.class_code = upper(trim(p_class_code))
    and c.teacher_id = (select auth.uid())
    and c.archived = false;
  if v_class_id is null then
    raise exception 'Class not found';
  end if;

  select ft.title into v_title
  from public.form_templates ft
  where ft.id = p_template_id
    and ft.teacher_id = (select auth.uid())
    and ft.archived = false;
  if v_title is null then
    raise exception 'Form template not found';
  end if;

  insert into public.form_runs (template_id, class_id, teacher_id, title)
  values (p_template_id, v_class_id, (select auth.uid()), v_title)
  returning id into v_run_id;

  insert into public.form_run_questions (
    run_id,
    template_question_id,
    position,
    question_type,
    prompt,
    required,
    options,
    image_path,
    image_mime_type,
    image_width,
    image_height
  )
  select
    v_run_id,
    ftq.id,
    ftq.position,
    ftq.question_type,
    ftq.prompt,
    ftq.required,
    ftq.options,
    ftq.image_path,
    ftq.image_mime_type,
    ftq.image_width,
    ftq.image_height
  from public.form_template_questions ftq
  where ftq.template_id = p_template_id
  order by ftq.position;

  if not found then
    raise exception 'Form template has no questions';
  end if;

  return v_run_id;
end;
$$;

revoke all on function public.save_form_template(uuid, text, jsonb) from public, anon;
revoke all on function public.start_form_run(uuid, text) from public, anon;
grant execute on function public.save_form_template(uuid, text, jsonb) to authenticated;
grant execute on function public.start_form_run(uuid, text) to authenticated;
