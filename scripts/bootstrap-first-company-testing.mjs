#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Deliberately separate from bootstrap-first-company.mjs, which remains pinned to Production.
const PROJECT_REF = 'llxyziffgtqnzlguxhyt';
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const COMPANY_NAME = 'DiegosCompany';
const STATE_PATH = resolve('.supabase-bootstrap/testing-first-company.json');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ownerIdFromArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Uso: node scripts/bootstrap-first-company-testing.mjs --auth-user-id UUID');
    return null;
  }
  if (argv.length !== 2 || argv[0] !== '--auth-user-id' || !UUID_RE.test(argv[1])) {
    throw new Error('Proporciona únicamente --auth-user-id con un UUID válido.');
  }
  return argv[1].toLowerCase();
}

function digest(ownerUserId) {
  return createHash('sha256').update(`${PROJECT_REF}\0${COMPANY_NAME}\0${ownerUserId}`).digest('hex');
}

async function loadOrCreateState(dataHash) {
  try {
    const state = JSON.parse(await readFile(STATE_PATH, 'utf8'));
    if (!UUID_RE.test(state.requestId || '') || state.dataHash !== dataHash) {
      throw new Error('El estado local de idempotencia pertenece a otros datos o está dañado; no se hizo ninguna llamada.');
    }
    return state;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const state = { requestId: randomUUID(), dataHash, status: 'pending', createdAt: new Date().toISOString() };
  const handle = await open(STATE_PATH, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  return state;
}

async function persistState(state) {
  const tempPath = `${STATE_PATH}.${process.pid}.tmp`;
  const handle = await open(tempPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, STATE_PATH);
  await chmod(STATE_PATH, 0o600);
}

async function assertOutcome(supabase, ownerUserId, companyId) {
  const [{ data: companies, error: companiesError, count: companyCount }, { data: memberships, error: membershipsError, count: ownerCount }] = await Promise.all([
    supabase.from('companies').select('id,name', { count: 'exact' }),
    supabase.from('company_memberships').select('company_id,user_id,role,active', { count: 'exact' }).eq('user_id', ownerUserId),
  ]);
  if (companiesError || membershipsError) throw new Error('No se pudo completar la verificación de solo lectura (consultas de empresa/membresía).');
  const company = companies?.find((item) => item.id === companyId && item.name === COMPANY_NAME);
  const owners = memberships?.filter((item) => item.company_id === companyId && item.role === 'owner' && item.active === true) ?? [];
  if (companyCount !== 1 || ownerCount !== 1 || !company || owners.length !== 1 || memberships?.length !== 1) {
    throw new Error('La verificación de solo lectura no confirmó una empresa y una única membresía owner; no repitas el bootstrap automáticamente.');
  }
}

async function main() {
  const ownerUserId = ownerIdFromArgs(process.argv.slice(2));
  if (!ownerUserId) return;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en el entorno seguro del proceso.');

  // Fixed URL + ref prevent accidental calls to Production; the Testing service key is checked by Auth.
  const url = new URL(SUPABASE_URL);
  if (url.protocol !== 'https:' || url.hostname !== `${PROJECT_REF}.supabase.co`) {
    throw new Error('La URL fija del proyecto no superó la validación; no se hizo ninguna llamada.');
  }

  const directory = dirname(STATE_PATH);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const state = await loadOrCreateState(digest(ownerUserId));
  await chmod(STATE_PATH, 0o600);
  const supabase = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: authResult, error: authError } = await supabase.auth.admin.getUserById(ownerUserId);
  if (authError || !authResult.user || authResult.user.id.toLowerCase() !== ownerUserId) {
    throw new Error(`No se confirmó el UUID en Auth del proyecto Testing (${PROJECT_REF}); bootstrap cancelado.`);
  }

  if (state.status === 'complete') {
    await assertOutcome(supabase, ownerUserId, state.companyId);
    console.log(`Verificado, sin escrituras, en Testing ${PROJECT_REF}: company_id=${state.companyId}; owner_user_id=${ownerUserId}; role=owner; active=true.`);
    return;
  }

  const { count: existingCompanies, error: preflightError } = await supabase.from('companies').select('id', { count: 'exact', head: true });
  const { count: existingOwners, error: ownerPreflightError } = await supabase.from('company_memberships').select('id', { count: 'exact', head: true }).eq('role', 'owner').eq('active', true);
  if (preflightError || ownerPreflightError) throw new Error('Falló la verificación previa de empresas/propietarios; no se llamó al bootstrap.');
  // The SQL RPC is the final atomic guard: it returns the existing result only for
  // this exact request ID + payload, and rejects any other prior initialization.
  if ((existingCompanies !== 0 || existingOwners !== 0) && state.status !== 'pending') {
    throw new Error('Testing ya no está vacío; bootstrap detenido para evitar crear otra empresa.');
  }

  const { data, error } = await supabase.rpc('bootstrap_first_company', {
    p_request_id: state.requestId,
    p_owner_user_id: ownerUserId,
    p_company_name: COMPANY_NAME,
    p_legal_name: null,
    p_rfc: null,
  });
  if (error) throw new Error(`bootstrap_first_company rechazó la solicitud (SQLSTATE ${error.code || 'desconocido'}); revisa el estado antes de reintentar.`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.company_id || row.owner_user_id?.toLowerCase() !== ownerUserId || row.role !== 'owner') {
    throw new Error('La RPC no devolvió la relación owner esperada; no repitas la operación automáticamente.');
  }

  const completed = { ...state, status: 'complete', companyId: row.company_id, completedAt: new Date().toISOString() };
  await persistState(completed);
  await assertOutcome(supabase, ownerUserId, row.company_id);
  console.log(`Bootstrap y verificaciones de solo lectura confirmados en Testing ${PROJECT_REF}.`);
  console.log(`company_id=${row.company_id}; owner_user_id=${ownerUserId}; role=owner; active=true.`);
  console.log(`auth_email_confirmed=${Boolean(authResult.user.email_confirmed_at)}.`);
  console.log(`La clave de idempotencia quedó conservada localmente en ${STATE_PATH}.`);
}

main().catch((error) => {
  // Only static/sanitized messages are emitted; never print credentials or API response bodies.
  console.error(`Bootstrap Testing detenido: ${error.message}`);
  process.exitCode = 1;
});
