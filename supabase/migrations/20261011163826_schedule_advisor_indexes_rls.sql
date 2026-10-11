create index schedule_templates_revision_idx
  on public.schedule_templates(company_id, revision_of)
  where revision_of is not null;

create index schedule_template_breaks_company_rule_idx
  on public.schedule_template_breaks(company_id, break_rule_id);

drop policy schedule_template_breaks_read on public.schedule_template_breaks;
drop policy schedule_template_breaks_manage on public.schedule_template_breaks;
create policy schedule_template_breaks_read on public.schedule_template_breaks
  for select to authenticated
  using (private.has_company_permission(company_id, 'company.read'));
create policy schedule_template_breaks_insert on public.schedule_template_breaks
  for insert to authenticated
  with check (private.has_company_permission(company_id, 'schedules.manage'));
create policy schedule_template_breaks_update on public.schedule_template_breaks
  for update to authenticated
  using (private.has_company_permission(company_id, 'schedules.manage'))
  with check (private.has_company_permission(company_id, 'schedules.manage'));
create policy schedule_template_breaks_delete on public.schedule_template_breaks
  for delete to authenticated
  using (private.has_company_permission(company_id, 'schedules.manage'));
