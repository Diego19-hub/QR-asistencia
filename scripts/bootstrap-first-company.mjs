#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const EXPECTED_PROJECT_REF = 'jawdrhewabqajxnswhkn';
const STATE_PATH = resolve('.supabase-bootstrap/first-company.json');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function usage() {
  console.log(`Uso:
  node --env-file=.env.local scripts/bootstrap-first-company.mjs \\
    --auth-user-id UUID --company-name NOMBRE [--legal-name RAZON_SOCIAL] [--rfc RFC]

La clave SUPABASE_SERVICE_ROLE_KEY debe estar disponible solo en el entorno de este proceso.
La clave de idempotencia se genera una vez y se conserva en ${STATE_PATH}.`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') return { help: true };
    if (!token.startsWith('--') || !['--auth-user-id', '--company-name', '--legal-name', '--rfc'].includes(token)) {
      throw new Error(`Parámetro desconocido: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Falta el valor de ${token}`);
    if (parsed[key] !== undefined) throw new Error(`Parámetro repetido: ${token}`);
    parsed[key] = value.trim();
  }
  return parsed;
}

function paramHash(params) {
  return createHash('sha256').update(JSON.stringify(params)).digest('hex');
}

async function saveState(state) {
  const tempPath = `${STATE_PATH}.${process.pid}.tmp`;
  const handle = await open(tempPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, STATE_PATH);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (!args['auth-user-id'] || !args['company-name']) {
    usage();
    throw new Error('Se requieren --auth-user-id y --company-name.');
  }
  if (!UUID_RE.test(args['auth-user-id'])) throw new Error('--auth-user-id debe ser un UUID válido.');
  if (!args['company-name'].trim()) throw new Error('--company-name no puede estar vacío.');

  const urlValue = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!urlValue || !serviceRoleKey) {
    throw new Error('Falta SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
  }
  let url;
  try { url = new URL(urlValue); } catch { throw new Error('La URL de Supabase configurada no es válida.'); }
  const projectRef = url.hostname.split('.')[0];
  if (url.protocol !== 'https:' || projectRef !== EXPECTED_PROJECT_REF) {
    throw new Error(`Proyecto rechazado: se requiere HTTPS y el ref ${EXPECTED_PROJECT_REF}; no se hizo ninguna llamada.`);
  }

  const params = {
    ownerUserId: args['auth-user-id'].toLowerCase(),
    companyName: args['company-name'].trim(),
    legalName: args['legal-name']?.trim() || null,
    rfc: args.rfc?.trim().toUpperCase() || null,
  };
  const dataHash = paramHash(params);
  await mkdir(dirname(STATE_PATH), { recursive: true, mode: 0o700 });
  await chmodDirectory(dirname(STATE_PATH));

  let state;
  try {
    state = JSON.parse(await readFile(STATE_PATH, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error('No se pudo leer el estado de idempotencia local.');
    state = { requestId: randomUUID(), dataHash, status: 'pending', createdAt: new Date().toISOString() };
    const handle = await open(STATE_PATH, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
      await handle.sync();
    } catch (writeError) {
      await rm(STATE_PATH, { force: true });
      throw writeError;
    } finally {
      await handle.close();
    }
  }
  if (!UUID_RE.test(state.requestId || '') || state.dataHash !== dataHash) {
    throw new Error(`El estado ${STATE_PATH} pertenece a otro conjunto de datos o está dañado; no se hizo ninguna llamada. Consérvelo para revisión.`);
  }
  if (state.status === 'complete') {
    console.log(`Este bootstrap ya figura completado. request_id=${state.requestId}; company_id=${state.companyId}`);
    return;
  }

  const supabase = createClient(url.toString(), serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: userResult, error: userError } = await supabase.auth.admin.getUserById(params.ownerUserId);
  if (userError || !userResult.user) throw new Error('El UUID no corresponde a un usuario Auth consultable; bootstrap cancelado.');

  const { data, error } = await supabase.rpc('bootstrap_first_company', {
    p_request_id: state.requestId,
    p_owner_user_id: params.ownerUserId,
    p_company_name: params.companyName,
    p_legal_name: params.legalName,
    p_rfc: params.rfc,
  });
  if (error) throw new Error(`La RPC rechazó la operación (${error.code || 'sin código'}): ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.company_id || row.owner_user_id?.toLowerCase() !== params.ownerUserId || row.role !== 'owner') {
    throw new Error('La RPC respondió sin la membresía owner esperada. Conserva el estado y revisa Supabase.');
  }

  state = { ...state, status: 'complete', companyId: row.company_id, completedAt: new Date().toISOString() };
  await saveState(state);

  const { data: membership, error: membershipError } = await supabase
    .from('company_memberships')
    .select('company_id,user_id,role,active')
    .eq('company_id', row.company_id)
    .eq('user_id', params.ownerUserId)
    .eq('role', 'owner')
    .eq('active', true)
    .maybeSingle();
  if (membershipError || !membership) {
    throw new Error('La RPC devolvió owner, pero la comprobación posterior de membresía no coincidió. Revisa Supabase antes de reintentar.');
  }

  console.log(`Bootstrap confirmado en proyecto ${EXPECTED_PROJECT_REF}.`);
  console.log(`company_id=${row.company_id}; owner_user_id=${params.ownerUserId}; role=owner; active=true`);
  console.log(`request_id=${state.requestId} (conservado en ${STATE_PATH})`);
}

async function chmodDirectory(path) {
  const { chmod } = await import('node:fs/promises');
  await chmod(path, 0o700);
}

main().catch((error) => {
  console.error(`Bootstrap cancelado: ${error.message}`);
  process.exitCode = 1;
});
