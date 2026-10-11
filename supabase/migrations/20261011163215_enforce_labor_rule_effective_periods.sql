-- A company has one unambiguous active labor rule set on any local work date.
create or replace function private.guard_labor_rule_period_overlap()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text, 0));
  if exists (
    select 1 from public.labor_rule_sets r
    where r.company_id = new.company_id
      and r.id is distinct from new.id
      and r.effective_from <= coalesce(new.effective_to, 'infinity'::date)
      and new.effective_from <= coalesce(r.effective_to, 'infinity'::date)
  ) then
    raise exception 'labor rule effective period overlaps another company rule set'
      using errcode = '23P01';
  end if;
  return new;
end
$$;

create trigger labor_rule_sets_no_overlap
  before insert or update of company_id, effective_from, effective_to
  on public.labor_rule_sets
  for each row execute function private.guard_labor_rule_period_overlap();
