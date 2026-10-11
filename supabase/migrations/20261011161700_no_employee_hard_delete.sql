-- Employee records are archived through the active flag. API roles cannot
-- physically delete them, which protects employment and attendance history.
revoke delete on public.employees from authenticated;
drop policy if exists employees_delete on public.employees;
