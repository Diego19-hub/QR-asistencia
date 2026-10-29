"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Send, UserPlus, UserRound, Shield, CircleAlert, X } from "lucide-react";

import { useAdminContext } from "@/components/admin/admin-context";
import { AccessLinksSection } from "@/components/admin/access-links-section";
import { copyTextToClipboard, createWhatsAppShareUrl } from "@/lib/access/access-links";

type Role = "owner" | "admin" | "supervisor" | "employee";
type AccessUser = { membershipId: string; userId: string; email: string | null; role: Role; active: boolean; emailConfirmed: boolean; branches: string[]; employeeId: string | null; employeeName: string | null };
type Invitation = { id: string; email: string; role: Exclude<Role, "owner">; employeeId: string | null; status: "pending" | "accepted" | "revoked" | "expired"; expiresAt: string; shareLinkCreated?: boolean };
type Employee = { id: string; name: string; email: string | null; employeeNumber: string };
type State = { users: AccessUser[]; invitations: Invitation[]; unlinkedEmployees: Employee[] };
type ErrorBody = { error?: { message?: string } };

const card = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_12px_rgba(24,39,75,.035)]";
const input = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
const label = "block text-xs font-semibold text-slate-700";
const roleName: Record<Role, string> = { owner: "Propietario", admin: "Administrador", supervisor: "Supervisor", employee: "Empleado" };

function matchingEmployees(email: string | null, employees: Employee[]) {
  const normalizedEmail = email?.trim().toLowerCase();
  return employees.filter((employee) => !employee.email || (normalizedEmail && employee.email.toLowerCase() === normalizedEmail));
}

export function UserAccessManagement({ publicOrigin }: { publicOrigin: string | null }) {
  const { company } = useAdminContext();
  const [data, setData] = useState<State>({ users: [], invitations: [], unlinkedEmployees: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [role, setRole] = useState<"admin" | "supervisor" | "employee">("supervisor");
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({});
  const [inviteEmail, setInviteEmail] = useState("");
  const [shareLinkState, setShareLinkState] = useState<{ companyId: string; links: Record<string, string> }>({ companyId: company.companyId, links: {} });
  const shareLinks = shareLinkState.companyId === company.companyId ? shareLinkState.links : {};

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/access?companyId=${encodeURIComponent(company.companyId)}`, { cache: "no-store" });
      const body = await response.json() as State & ErrorBody;
      if (!response.ok) throw new Error(body.error?.message ?? "No fue posible cargar los accesos.");
      setData({ users: body.users ?? [], invitations: body.invitations ?? [], unlinkedEmployees: body.unlinkedEmployees ?? [] });
    } catch (reason) { setData({ users: [], invitations: [], unlinkedEmployees: [] }); setError(reason instanceof Error ? reason.message : "No fue posible cargar los accesos."); }
    finally { setLoading(false); }
  }, [company.companyId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function sendInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy("invite"); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/access?companyId=${encodeURIComponent(company.companyId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), role, employeeId: role === "employee" ? form.get("employeeId") : null }),
      });
      const body = await response.json() as { invitationId?: string; delivery?: string; message?: string } & ErrorBody;
      if (!response.ok && response.status !== 202 && !body.invitationId) throw new Error(body.error?.message ?? "No fue posible enviar la invitación.");
      setNotice(body.delivery === "sent" ? "Invitación enviada por Supabase Auth." : body.message ?? "La invitación quedó pendiente.");
      formElement.reset(); setInviteEmail(""); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible enviar la invitación."); }
    finally { setBusy(""); }
  }

  async function mutate(body: object, key: string) {
    setBusy(key); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/access?companyId=${encodeURIComponent(company.companyId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as ErrorBody;
      if (!response.ok) throw new Error(result.error?.message ?? "No fue posible actualizar el acceso.");
      if ("action" in body && body.action === "revoke-invitation" && "invitationId" in body && typeof body.invitationId === "string") {
        setShareLinkState((current) => {
          const next = current.companyId === company.companyId ? { ...current.links } : {};
          delete next[body.invitationId as string];
          return { companyId: company.companyId, links: next };
        });
      }
      setNotice("Acceso actualizado y registrado en auditoría."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible actualizar el acceso."); }
    finally { setBusy(""); }
  }

  async function resend(invitation: Invitation) {
    setBusy(invitation.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/access/invitations/${invitation.id}/resend?companyId=${encodeURIComponent(company.companyId)}`, { method: "POST" });
      const result = await response.json() as ErrorBody;
      if (!response.ok) throw new Error(result.error?.message ?? "No fue posible reenviar la invitación.");
      setNotice("Invitación reenviada."); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible reenviar la invitación."); }
    finally { setBusy(""); }
  }

  async function generateShareLink(invitation: Invitation) {
    if (invitation.shareLinkCreated && !window.confirm("Generar un enlace nuevo invalidará el enlace de WhatsApp anterior. ¿Continuar?")) return;
    setBusy(`${invitation.id}:share`); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/access/invitations/${invitation.id}/share-link?companyId=${encodeURIComponent(company.companyId)}`, { method: "POST" });
      const result = await response.json() as { shareUrl?: string; expiresAt?: string } & ErrorBody;
      if (!response.ok || !result.shareUrl) throw new Error(result.error?.message ?? "No fue posible generar el enlace.");
      setShareLinkState((current) => ({ companyId: company.companyId, links: { ...(current.companyId === company.companyId ? current.links : {}), [invitation.id]: result.shareUrl! } }));
      setData((current) => ({ ...current, invitations: current.invitations.map((item) => item.id === invitation.id ? { ...item, shareLinkCreated: true } : item) }));
      setNotice(`Enlace disponible hasta ${new Date(result.expiresAt ?? invitation.expiresAt).toLocaleDateString("es-MX")}. Compártelo solo con la persona invitada.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No fue posible generar el enlace."); }
    finally { setBusy(""); }
  }

  async function copyShareLink(invitationId: string) {
    const value = shareLinks[invitationId];
    if (!value) return;
    const copied = await copyTextToClipboard(value, navigator.clipboard ?? null, document);
    if (copied) setNotice("Enlace de invitación copiado.");
    else setError("No se pudo copiar automáticamente. Selecciona y copia el enlace mostrado.");
  }



  const activeRole = company.role;
  return <section id="usuarios-accesos" className={`${card} overflow-hidden`}>
    <header className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700"><UserRound size={19} /></div>
        <div>
          <h2 className="font-semibold text-slate-900">Usuarios y accesos</h2>
          <p className="mt-0.5 text-xs text-slate-500">Invita y administra membresías de {company.companyName}; los empleados sin cuenta conservan su QR físico.</p>
        </div>
      </div>
      <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700 disabled:opacity-50">
        <RefreshCw size={14} className={loading ? "animate-spin" : ""} />Actualizar
      </button>
    </header>
    {notice ? <p role="status" className="mx-5 mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 sm:mx-6">{notice}</p> : null}
    {error ? <p role="alert" className="mx-5 mt-4 flex gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800 sm:mx-6"><CircleAlert size={17} className="shrink-0" />{error}</p> : null}
    <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.8fr)]">
      <MembershipList
        users={data.users}
        employees={data.unlinkedEmployees}
        loading={loading}
        busy={busy}
        activeRole={activeRole}
        linkTargets={linkTargets}
        onLinkTargetChange={(membershipId, employeeId) => setLinkTargets((current) => ({ ...current, [membershipId]: employeeId }))}
        onRoleChange={(member, nextRole) => void mutate({ action: "change-role", membershipId: member.membershipId, role: nextRole }, member.membershipId)}
        onDeactivate={(member) => {
          if (window.confirm(`¿Desactivar el acceso de ${member.email ?? "este usuario"} a ${company.companyName}? Su cuenta en otras empresas no cambiará.`)) {
            void mutate({ action: "deactivate", membershipId: member.membershipId }, member.membershipId);
          }
        }}
        onLink={(member, employeeId) => void mutate({ action: "link-employee", membershipId: member.membershipId, employeeId }, member.membershipId)}
      />
      <div>
        <div className="flex items-center gap-2"><UserPlus size={17} className="text-blue-700" /><h3 className="text-sm font-semibold text-slate-900">Invitar por correo</h3></div>
        <InviteForm
          role={role}
          activeRole={activeRole}
          inviteEmail={inviteEmail}
          employees={data.unlinkedEmployees}
          busy={busy}
          onRoleChange={setRole}
          onEmailChange={setInviteEmail}
          onSubmit={(event) => void sendInvite(event)}
        />
        <InvitationList
          invitations={data.invitations}
          shareLinks={shareLinks}
          activeRole={activeRole}
          busy={busy}
          onResend={(invitation) => void resend(invitation)}
          onRevoke={(invitation) => void mutate({ action: "revoke-invitation", invitationId: invitation.id }, invitation.id)}
          onGenerateShareLink={(invitation) => void generateShareLink(invitation)}
          onCopyShareLink={(invitationId) => void copyShareLink(invitationId)}
        />
      </div>
    </div>
    <div className="border-t border-slate-100 p-5 sm:p-6">
      <AccessLinksSection publicOrigin={publicOrigin} />
    </div>
  </section>;
}

type MembershipListProps = {
  users: AccessUser[];
  employees: Employee[];
  loading: boolean;
  busy: string;
  activeRole: Role;
  linkTargets: Record<string, string>;
  onLinkTargetChange: (membershipId: string, employeeId: string) => void;
  onRoleChange: (member: AccessUser, role: Exclude<Role, "owner">) => void;
  onDeactivate: (member: AccessUser) => void;
  onLink: (member: AccessUser, employeeId: string) => void;
};

function MembershipList(props: MembershipListProps) {
  return (
    <div>
      <div className="flex items-center gap-2"><Shield size={17} className="text-blue-700" /><h3 className="text-sm font-semibold text-slate-900">Membresías de la empresa</h3></div>
      {props.loading ? <p className="mt-4 text-sm text-slate-500">Cargando usuarios…</p> : !props.users.length ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Aún no hay membresías.</p> : (
        <div className="mt-3 space-y-3">
          {props.users.map((member) => (
            <MembershipCard key={member.membershipId} member={member} {...props} />
          ))}
        </div>
      )}
    </div>
  );
}

type MembershipCardProps = Omit<MembershipListProps, "users" | "loading"> & { member: AccessUser };

function MembershipCard({ member, employees, busy, activeRole, linkTargets, onLinkTargetChange, onRoleChange, onDeactivate, onLink }: MembershipCardProps) {
  const canManageAdmin = activeRole === "owner";
  const matching = matchingEmployees(member.email, employees);
  const canChangeMembership = member.active && member.role !== "owner" && (member.role !== "admin" || canManageAdmin);

  return (
    <article className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{member.email ?? "Cuenta sin correo visible"}</p>
          <p className="mt-1 text-xs text-slate-500">{member.emailConfirmed ? "Correo confirmado" : "Invitación/correo pendiente"}{member.employeeName ? ` · ${member.employeeName}` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${member.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{member.active ? "Acceso activo" : "Inactivo"}</span>
          {member.role === "owner" ? <RoleBadge role={member.role} /> : member.active ? (
            <RoleSelector member={member} activeRole={activeRole} busy={busy} onChange={onRoleChange} />
          ) : <RoleBadge role={member.role} />}
          {canChangeMembership ? (
            <button type="button" disabled={Boolean(busy)} onClick={() => onDeactivate(member)} className="grid size-8 place-items-center rounded-lg border border-rose-100 text-rose-600 disabled:opacity-40" aria-label={`Desactivar ${member.email ?? "usuario"}`}>
              <X size={15} />
            </button>
          ) : null}
        </div>
      </div>
      {member.active && member.role === "employee" && !member.employeeId ? (
        <EmployeeLinkControl member={member} employees={matching} busy={busy} selected={linkTargets[member.membershipId] ?? ""} onSelect={(id) => onLinkTargetChange(member.membershipId, id)} onLink={onLink} />
      ) : null}
    </article>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const owner = role === "owner";
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${owner ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600"}`}>{roleName[role]}</span>;
}

function RoleSelector({ member, activeRole, busy, onChange }: { member: AccessUser; activeRole: Role; busy: string; onChange: MembershipListProps["onRoleChange"] }) {
  return (
    <select
      aria-label={`Rol de ${member.email ?? "usuario"}`}
      value={member.role}
      disabled={Boolean(busy) || (member.role === "admin" && activeRole !== "owner")}
      onChange={(event) => onChange(member, event.target.value as Exclude<Role, "owner">)}
      className="h-8 rounded-lg border border-slate-200 px-2 text-xs"
    >
      <option value="admin" disabled={activeRole !== "owner"}>Administrador</option>
      <option value="supervisor">Supervisor</option>
      <option value="employee">Empleado</option>
    </select>
  );
}

function EmployeeLinkControl({ member, employees, busy, selected, onSelect, onLink }: { member: AccessUser; employees: Employee[]; busy: string; selected: string; onSelect: (id: string) => void; onLink: MembershipListProps["onLink"] }) {
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row">
      {!member.emailConfirmed ? <p className="text-xs text-amber-700">Confirma el correo de Auth antes de vincular un expediente.</p> : employees.length ? (
        <>
          <select aria-label={`Expediente para ${member.email ?? "empleado"}`} value={selected} onChange={(event) => onSelect(event.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-xs">
            <option value="">Selecciona un expediente sin cuenta</option>
            {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber} · {employee.name}</option>)}
          </select>
          <button type="button" disabled={Boolean(busy) || !selected} onClick={() => onLink(member, selected)} className="h-9 rounded-lg border border-blue-200 px-3 text-xs font-semibold text-blue-800 disabled:opacity-40">Vincular expediente</button>
        </>
      ) : <p className="text-xs text-slate-500">No hay expediente activo con un correo coincidente para vincular.</p>}
    </div>
  );
}

type InviteFormProps = {
  role: "admin" | "supervisor" | "employee";
  activeRole: Role;
  inviteEmail: string;
  employees: Employee[];
  busy: string;
  onRoleChange: (role: "admin" | "supervisor" | "employee") => void;
  onEmailChange: (email: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

function InviteForm({ role, activeRole, inviteEmail, employees, busy, onRoleChange, onEmailChange, onSubmit }: InviteFormProps) {
  const matching = matchingEmployees(inviteEmail, employees);
  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-4 rounded-xl bg-slate-50 p-4">
      <label className={label}>Correo de trabajo
        <input name="email" type="email" autoComplete="email" required maxLength={254} value={inviteEmail} onChange={(event) => onEmailChange(event.target.value)} className={`${input} mt-1`} placeholder="persona@empresa.com" />
      </label>
      <label className={label}>Acceso
        <select value={role} onChange={(event) => onRoleChange(event.target.value as InviteFormProps["role"])} className={`${input} mt-1`}>
          <option value="supervisor">Supervisor</option>
          <option value="employee">Empleado</option>
          {activeRole === "owner" ? <option value="admin">Administrador</option> : null}
        </select>
      </label>
      {role === "employee" ? (
        <label className={label}>Expediente a vincular (opcional)
          <select name="employeeId" className={`${input} mt-1`} defaultValue="">
            <option value="">Sin vincular: se podrá usar credencial QR física</option>
            {matching.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeNumber} · {employee.name}{employee.email ? ` · ${employee.email}` : ""}</option>)}
          </select>
          <span className="mt-1 block font-normal text-slate-500">El vínculo se activa solo cuando la persona acepta desde la cuenta autenticada con ese correo.</span>
        </label>
      ) : null}
      <button disabled={Boolean(busy)} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 text-xs font-semibold text-white disabled:opacity-50">
        <Send size={15} />{busy === "invite" ? "Enviando invitación…" : "Enviar invitación"}
      </button>
      <p className="text-[11px] leading-5 text-slate-500">No se crean ni muestran contraseñas. La persona establece su acceso mediante Supabase Auth.</p>
    </form>
  );
}

type InvitationListProps = { invitations: Invitation[]; shareLinks: Record<string, string>; activeRole: Role; busy: string; onResend: (invitation: Invitation) => void; onRevoke: (invitation: Invitation) => void; onGenerateShareLink: (invitation: Invitation) => void; onCopyShareLink: (invitationId: string) => void };

function InvitationList({ invitations, shareLinks, activeRole, busy, onResend, onRevoke, onGenerateShareLink, onCopyShareLink }: InvitationListProps) {
  if (!invitations.length) return null;
  return (
    <div className="mt-5">
      <h3 className="text-sm font-semibold text-slate-900">Invitaciones</h3>
      <div className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200">
        {invitations.map((invitation) => (
          <InvitationRow key={invitation.id} invitation={invitation} shareUrl={shareLinks[invitation.id]} activeRole={activeRole} busy={busy} onResend={onResend} onRevoke={onRevoke} onGenerateShareLink={onGenerateShareLink} onCopyShareLink={onCopyShareLink} />
        ))}
      </div>
    </div>
  );
}

function InvitationRow({ invitation, shareUrl, activeRole, busy, onResend, onRevoke, onGenerateShareLink, onCopyShareLink }: { invitation: Invitation; shareUrl?: string; activeRole: Role; busy: string; onResend: InvitationListProps["onResend"]; onRevoke: InvitationListProps["onRevoke"]; onGenerateShareLink: InvitationListProps["onGenerateShareLink"]; onCopyShareLink: InvitationListProps["onCopyShareLink"] }) {
  const status = invitation.status === "pending"
    ? `Pendiente hasta ${new Date(invitation.expiresAt).toLocaleDateString("es-MX")}`
    : invitation.status === "accepted" ? "Aceptada" : invitation.status === "expired" ? "Vencida" : "Revocada";
  const canManage = invitation.status === "pending" && (invitation.role !== "admin" || activeRole === "owner");
  return (
    <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-slate-800">{invitation.email}</p>
        <p className="mt-1 text-[11px] text-slate-500">{roleName[invitation.role]} · {invitation.shareLinkCreated ? "Correo y WhatsApp disponibles" : "Correo"} · {status}</p>
      </div>
      {canManage ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(busy)} onClick={() => onResend(invitation)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-[11px] font-semibold text-slate-700"><RefreshCw size={12} />Reenviar correo</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => onGenerateShareLink(invitation)} className="h-8 rounded-lg border border-emerald-200 px-2 text-[11px] font-semibold text-emerald-800">{invitation.shareLinkCreated ? "Regenerar enlace WhatsApp" : "Crear enlace WhatsApp"}</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => onRevoke(invitation)} className="h-8 rounded-lg border border-rose-100 px-2 text-[11px] font-semibold text-rose-700">Revocar</button>
          </div>
          {shareUrl ? <div className="w-full space-y-2 sm:max-w-lg">
            <input aria-label="Enlace individual de invitación" readOnly value={shareUrl} className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs text-slate-600" />
            <div className="flex gap-2">
              <button type="button" onClick={() => onCopyShareLink(invitation.id)} className="h-8 rounded-lg border border-slate-200 px-3 text-[11px] font-semibold text-slate-700">Copiar enlace</button>
              <a href={createWhatsAppShareUrl("Te invitaron a Asistencia QR. Inicia sesión con el correo confirmado de la invitación y acepta el acceso.", shareUrl)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-lg bg-emerald-700 px-3 text-[11px] font-semibold text-white">Compartir por WhatsApp</a>
            </div>
          </div> : invitation.shareLinkCreated ? <p className="max-w-lg text-[11px] text-amber-700">El enlace se muestra solo una vez. Regénéralo para copiar o compartir; el anterior dejará de funcionar.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
