-- Form tables were created after the service-role grants were hardened.
-- Grant only the table privileges needed by the authenticated deletion Edge Function.

grant select on table
  public.form_templates,
  public.form_template_questions,
  public.form_runs,
  public.form_run_questions,
  public.form_responses
to service_role;

grant delete on table public.form_runs to service_role;
