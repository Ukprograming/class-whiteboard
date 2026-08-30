-- Durable teacher-authored forms, class runs, per-question responses, and
-- teacher-only live aggregation for Class Whiteboard.

create table public.form_templates (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint form_templates_title_length
    check (char_length(trim(title)) between 1 and 120)
);

create table public.form_template_questions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.form_templates(id) on delete cascade,
  position integer not null,
  question_type text not null,
  prompt text not null,
  required boolean not null default true,
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint form_template_questions_position_positive check (position >= 1),
  constraint form_template_questions_type
    check (question_type in ('text', 'single_choice', 'multiple_choice')),
  constraint form_template_questions_prompt_length
    check (char_length(trim(prompt)) between 1 and 1000),
  constraint form_template_questions_options_array
    check (jsonb_typeof(options) = 'array'),
  constraint form_template_questions_template_position_key unique (template_id, position)
);

create table public.form_runs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.form_templates(id) on delete set null,
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  status text not null default 'open',
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint form_runs_title_length
    check (char_length(trim(title)) between 1 and 120),
  constraint form_runs_status check (status in ('open', 'closed')),
  constraint form_runs_status_dates check (
    (status = 'open' and closed_at is null)
    or (status = 'closed' and closed_at is not null)
  )
);

create table public.form_run_questions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.form_runs(id) on delete cascade,
  template_question_id uuid references public.form_template_questions(id) on delete set null,
  position integer not null,
  question_type text not null,
  prompt text not null,
  required boolean not null default true,
  options jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint form_run_questions_position_positive check (position >= 1),
  constraint form_run_questions_type
    check (question_type in ('text', 'single_choice', 'multiple_choice')),
  constraint form_run_questions_prompt_length
    check (char_length(trim(prompt)) between 1 and 1000),
  constraint form_run_questions_options_array
    check (jsonb_typeof(options) = 'array'),
  constraint form_run_questions_run_position_key unique (run_id, position),
  constraint form_run_questions_id_run_key unique (id, run_id)
);

create table public.form_responses (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.form_runs(id) on delete cascade,
  run_question_id uuid not null,
  student_id uuid not null references public.students(id) on delete cascade,
  answer_text text,
  selected_option_ids jsonb not null default '[]'::jsonb,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint form_responses_question_run_fkey
    foreign key (run_question_id, run_id)
    references public.form_run_questions(id, run_id)
    on delete cascade,
  constraint form_responses_selected_options_array
    check (jsonb_typeof(selected_option_ids) = 'array'),
  constraint form_responses_has_answer check (
    nullif(trim(answer_text), '') is not null
    or jsonb_array_length(selected_option_ids) > 0
  ),
  constraint form_responses_question_student_key unique (run_question_id, student_id)
);

create index form_templates_teacher_archived_updated_idx
  on public.form_templates (teacher_id, archived, updated_at desc);
create index form_template_questions_template_id_idx
  on public.form_template_questions (template_id);
create index form_runs_class_status_started_idx
  on public.form_runs (class_id, status, started_at desc);
create index form_runs_teacher_started_idx
  on public.form_runs (teacher_id, started_at desc);
create unique index form_runs_one_open_per_class_idx
  on public.form_runs (class_id)
  where status = 'open';
create index form_run_questions_run_id_idx
  on public.form_run_questions (run_id);
create index form_responses_run_question_idx
  on public.form_responses (run_id, run_question_id);
create index form_responses_student_run_idx
  on public.form_responses (student_id, run_id);

create or replace function public.validate_form_response()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_question_type text;
  v_options jsonb;
  v_selected_count integer;
  v_unique_selected_count integer;
begin
  select question_type, options
  into v_question_type, v_options
  from public.form_run_questions
  where id = new.run_question_id
    and run_id = new.run_id;

  if not found then
    raise exception 'Form question was not found.';
  end if;

  v_selected_count := jsonb_array_length(new.selected_option_ids);

  if v_question_type = 'text' then
    if nullif(trim(new.answer_text), '') is null
       or char_length(trim(new.answer_text)) > 5000
       or v_selected_count <> 0 then
      raise exception 'Text responses must contain 1 to 5000 characters and no selected options.';
    end if;
  else
    if new.answer_text is not null
       or (v_question_type = 'single_choice' and v_selected_count <> 1)
       or (v_question_type = 'multiple_choice' and v_selected_count not between 1 and 10) then
      raise exception 'Choice response has an invalid answer shape.';
    end if;

    select count(distinct selected_id)
    into v_unique_selected_count
    from jsonb_array_elements_text(new.selected_option_ids) as selected(selected_id);

    if v_unique_selected_count <> v_selected_count
       or exists (
         select 1
         from jsonb_array_elements_text(new.selected_option_ids) as selected(selected_id)
         where not exists (
           select 1
           from jsonb_array_elements(v_options) as option_item(option_value)
           where option_item.option_value ->> 'id' = selected.selected_id
         )
       ) then
      raise exception 'Choice response contains an unknown or duplicate option.';
    end if;
  end if;

  new.answer_text := case
    when v_question_type = 'text' then trim(new.answer_text)
    else null
  end;
  new.submitted_at := now();
  return new;
end;
$$;

revoke all on function public.validate_form_response() from public, anon, authenticated;

create trigger form_responses_validate
before insert or update on public.form_responses
for each row execute function public.validate_form_response();

create trigger form_templates_touch_updated_at
before update on public.form_templates
for each row execute function public.touch_updated_at();

create trigger form_template_questions_touch_updated_at
before update on public.form_template_questions
for each row execute function public.touch_updated_at();

create trigger form_runs_touch_updated_at
before update on public.form_runs
for each row execute function public.touch_updated_at();

create trigger form_responses_touch_updated_at
before update on public.form_responses
for each row execute function public.touch_updated_at();

alter table public.form_templates enable row level security;
alter table public.form_template_questions enable row level security;
alter table public.form_runs enable row level security;
alter table public.form_run_questions enable row level security;
alter table public.form_responses enable row level security;

revoke all on table public.form_templates from anon, authenticated;
revoke all on table public.form_template_questions from anon, authenticated;
revoke all on table public.form_runs from anon, authenticated;
revoke all on table public.form_run_questions from anon, authenticated;
revoke all on table public.form_responses from anon, authenticated;

grant select, insert, update, delete on table public.form_templates to authenticated;
grant select, insert, update, delete on table public.form_template_questions to authenticated;
grant select, insert, update on table public.form_runs to authenticated;
grant select, insert on table public.form_run_questions to authenticated;
grant select, insert, update on table public.form_responses to authenticated;

create policy form_templates_teacher_select
on public.form_templates for select to authenticated
using (teacher_id = (select auth.uid()));

create policy form_templates_teacher_insert
on public.form_templates for insert to authenticated
with check (teacher_id = (select auth.uid()) and (select app_private.is_teacher()));

create policy form_templates_teacher_update
on public.form_templates for update to authenticated
using (teacher_id = (select auth.uid()))
with check (teacher_id = (select auth.uid()) and (select app_private.is_teacher()));

create policy form_templates_teacher_delete
on public.form_templates for delete to authenticated
using (teacher_id = (select auth.uid()));

create policy form_template_questions_teacher_select
on public.form_template_questions for select to authenticated
using (
  exists (
    select 1 from public.form_templates ft
    where ft.id = template_id
      and ft.teacher_id = (select auth.uid())
  )
);

create policy form_template_questions_teacher_insert
on public.form_template_questions for insert to authenticated
with check (
  exists (
    select 1 from public.form_templates ft
    where ft.id = template_id
      and ft.teacher_id = (select auth.uid())
  )
);

create policy form_template_questions_teacher_update
on public.form_template_questions for update to authenticated
using (
  exists (
    select 1 from public.form_templates ft
    where ft.id = template_id
      and ft.teacher_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.form_templates ft
    where ft.id = template_id
      and ft.teacher_id = (select auth.uid())
  )
);

create policy form_template_questions_teacher_delete
on public.form_template_questions for delete to authenticated
using (
  exists (
    select 1 from public.form_templates ft
    where ft.id = template_id
      and ft.teacher_id = (select auth.uid())
  )
);

create policy form_runs_teacher_select
on public.form_runs for select to authenticated
using (teacher_id = (select auth.uid()));

create policy form_runs_student_select_open
on public.form_runs for select to authenticated
using (status = 'open' and (select app_private.is_student_in_class(class_id)));

create policy form_runs_teacher_insert
on public.form_runs for insert to authenticated
with check (
  teacher_id = (select auth.uid())
  and (select app_private.is_class_teacher(class_id))
);

create policy form_runs_teacher_update
on public.form_runs for update to authenticated
using (teacher_id = (select auth.uid()) and (select app_private.is_class_teacher(class_id)))
with check (teacher_id = (select auth.uid()) and (select app_private.is_class_teacher(class_id)));

create policy form_run_questions_teacher_select
on public.form_run_questions for select to authenticated
using (
  exists (
    select 1 from public.form_runs fr
    where fr.id = run_id
      and fr.teacher_id = (select auth.uid())
  )
);

create policy form_run_questions_student_select_open
on public.form_run_questions for select to authenticated
using (
  exists (
    select 1 from public.form_runs fr
    where fr.id = run_id
      and fr.status = 'open'
      and (select app_private.is_student_in_class(fr.class_id))
  )
);

create policy form_run_questions_teacher_insert
on public.form_run_questions for insert to authenticated
with check (
  exists (
    select 1 from public.form_runs fr
    where fr.id = run_id
      and fr.teacher_id = (select auth.uid())
      and (select app_private.is_class_teacher(fr.class_id))
  )
);

create policy form_responses_teacher_select
on public.form_responses for select to authenticated
using (
  exists (
    select 1 from public.form_runs fr
    where fr.id = run_id
      and fr.teacher_id = (select auth.uid())
  )
);

create policy form_responses_student_select_own
on public.form_responses for select to authenticated
using (student_id = (select app_private.current_student_id()));

create policy form_responses_student_insert_open
on public.form_responses for insert to authenticated
with check (
  student_id = (select app_private.current_student_id())
  and exists (
    select 1
    from public.form_runs fr
    join public.form_run_questions fq
      on fq.run_id = fr.id
     and fq.id = run_question_id
    where fr.id = run_id
      and fr.status = 'open'
      and (select app_private.is_student_in_class(fr.class_id))
  )
);

create policy form_responses_student_update_open
on public.form_responses for update to authenticated
using (
  student_id = (select app_private.current_student_id())
  and exists (
    select 1 from public.form_runs fr
    where fr.id = run_id and fr.status = 'open'
  )
)
with check (
  student_id = (select app_private.current_student_id())
  and exists (
    select 1
    from public.form_runs fr
    join public.form_run_questions fq
      on fq.run_id = fr.id
     and fq.id = run_question_id
    where fr.id = run_id
      and fr.status = 'open'
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

  for v_question in select value from jsonb_array_elements(p_questions)
  loop
    v_position := v_position + 1;
    v_question_type := coalesce(v_question ->> 'questionType', '');
    v_prompt := trim(coalesce(v_question ->> 'prompt', ''));
    v_options := coalesce(v_question -> 'options', '[]'::jsonb);

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

    insert into public.form_template_questions (
      template_id,
      position,
      question_type,
      prompt,
      required,
      options
    ) values (
      v_template_id,
      v_position,
      v_question_type,
      v_prompt,
      coalesce((v_question ->> 'required')::boolean, true),
      v_options
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
    options
  )
  select
    v_run_id,
    ftq.id,
    ftq.position,
    ftq.question_type,
    ftq.prompt,
    ftq.required,
    ftq.options
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

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'form_responses'
  ) then
    alter publication supabase_realtime add table public.form_responses;
  end if;
end;
$$;
