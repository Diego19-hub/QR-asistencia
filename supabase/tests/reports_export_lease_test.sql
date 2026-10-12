begin;
select plan(13);

select has_table('private', 'report_export_leases', 'global export lease is stored in private schema');
select ok((select relrowsecurity from pg_class where oid = 'private.report_export_leases'::regclass), 'lease table has RLS enabled');
select ok(not has_table_privilege('anon', 'private.report_export_leases', 'select'), 'anon cannot read lease table');
select ok(not has_table_privilege('authenticated', 'private.report_export_leases', 'select'), 'authenticated cannot read lease table');
select ok(not has_table_privilege('service_role', 'private.report_export_leases', 'select'), 'service_role has no direct table grant');
select ok(not exists (
  select 1 from pg_constraint c
  where c.conrelid = 'private.report_export_leases'::regclass
    and c.contype = 'f' and c.confdeltype = 'c'
), 'deleting an Auth user or company cannot cascade-delete the global mutex');

select ok(has_function_privilege('authenticated', 'public.acquire_report_export_lease(uuid,uuid,integer)', 'execute'), 'authenticated can call the guarded acquire RPC');
select ok(has_function_privilege('authenticated', 'public.renew_report_export_lease(uuid,uuid,integer)', 'execute'), 'authenticated can call the guarded renew RPC');
select ok(has_function_privilege('authenticated', 'public.release_report_export_lease(uuid,uuid)', 'execute'), 'authenticated can call the guarded release RPC');
select ok(not has_function_privilege('anon', 'public.acquire_report_export_lease(uuid,uuid,integer)', 'execute'), 'anon cannot acquire');
select ok(not has_function_privilege('anon', 'public.renew_report_export_lease(uuid,uuid,integer)', 'execute'), 'anon cannot renew');
select ok(not has_function_privilege('anon', 'public.release_report_export_lease(uuid,uuid)', 'execute'), 'anon cannot release');
select ok(not has_function_privilege('service_role', 'public.acquire_report_export_lease(uuid,uuid,integer)', 'execute'), 'service_role does not receive an unnecessary grant');

select * from finish();
rollback;
