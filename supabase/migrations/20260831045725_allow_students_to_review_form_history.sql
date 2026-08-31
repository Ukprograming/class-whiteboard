-- Students may review form runs from their own current class after the teacher
-- closes response collection. Response bodies remain protected by the existing
-- form_responses_student_select_own policy, so students can only read their own
-- answers.

drop policy if exists form_runs_student_select_open on public.form_runs;

create policy form_runs_student_select_class
on public.form_runs for select to authenticated
using ((select app_private.is_student_in_class(class_id)));

drop policy if exists form_run_questions_student_select_open on public.form_run_questions;

create policy form_run_questions_student_select_class
on public.form_run_questions for select to authenticated
using (
  exists (
    select 1
    from public.form_runs fr
    where fr.id = run_id
      and (select app_private.is_student_in_class(fr.class_id))
  )
);
