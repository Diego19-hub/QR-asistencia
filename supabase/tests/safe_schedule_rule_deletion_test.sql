BEGIN;
SELECT plan(19);

SELECT has_function('public', 'delete_schedule_template', ARRAY['uuid', 'uuid'], 'schedule deletion uses a company-scoped RPC');
SELECT has_function('public', 'delete_labor_rule_set', ARRAY['uuid', 'uuid'], 'labor rule deletion uses a company-scoped RPC');
SELECT ok(has_function_privilege('authenticated', 'public.delete_schedule_template(uuid,uuid)', 'EXECUTE'), 'authenticated users may call the guarded schedule deletion RPC');
SELECT ok(not has_function_privilege('anon', 'public.delete_schedule_template(uuid,uuid)', 'EXECUTE'), 'anonymous users cannot call schedule deletion');
SELECT ok(has_function_privilege('authenticated', 'public.delete_labor_rule_set(uuid,uuid)', 'EXECUTE'), 'authenticated users may call the guarded labor rule deletion RPC');
SELECT ok(not has_function_privilege('anon', 'public.delete_labor_rule_set(uuid,uuid)', 'EXECUTE'), 'anonymous users cannot call labor rule deletion');
SELECT ok(not has_table_privilege('authenticated', 'public.schedule_templates', 'DELETE'), 'schedule parent deletion cannot bypass its guarded RPC');
SELECT ok(not has_table_privilege('authenticated', 'public.labor_rule_sets', 'DELETE'), 'labor rule deletion cannot bypass its guarded RPC');

SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.delete_schedule_template(uuid,uuid)'::regprocedure), 'schedule deletion runs with its explicit authorization checks');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public.delete_labor_rule_set(uuid,uuid)'::regprocedure), 'labor rule deletion runs with its explicit authorization checks');
SELECT ok(position('role in (''owner'', ''admin'')' in pg_get_functiondef('public.delete_schedule_template(uuid,uuid)'::regprocedure)) > 0, 'schedule deletion requires an owner or admin membership');
SELECT ok(position('schedules.manage' in pg_get_functiondef('public.delete_schedule_template(uuid,uuid)'::regprocedure)) > 0, 'schedule deletion checks the schedule permission');
SELECT ok(position('for update' in lower(pg_get_functiondef('public.delete_schedule_template(uuid,uuid)'::regprocedure))) > 0, 'schedule deletion locks its row before checking references');
SELECT ok(position('schedule_assignments' in pg_get_functiondef('public.delete_schedule_template(uuid,uuid)'::regprocedure)) > 0, 'schedule assignments block permanent deletion');
SELECT ok(position('revision_of' in pg_get_functiondef('public.delete_schedule_template(uuid,uuid)'::regprocedure)) > 0, 'derived schedule revisions block permanent deletion');
SELECT ok(position('attendance_breaks' in pg_get_functiondef('public.delete_schedule_template(uuid,uuid)'::regprocedure)) > 0, 'recorded breaks block deletion of their schedule history');
SELECT ok(position('attendance_sessions' in pg_get_functiondef('public.delete_labor_rule_set(uuid,uuid)'::regprocedure)) > 0, 'attendance sessions block labor rule deletion');
SELECT ok(position('overtime_assessments' in pg_get_functiondef('public.delete_labor_rule_set(uuid,uuid)'::regprocedure)) > 0, 'overtime assessments block labor rule deletion');
SELECT has_trigger('public', 'schedule_templates', 'audit_schedule_templates', 'schedule deletion retains its audit trigger');

SELECT * FROM finish();
ROLLBACK;
