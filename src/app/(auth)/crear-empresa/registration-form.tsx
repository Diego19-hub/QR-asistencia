"use client";

import Link from "next/link";
import { useActionState } from "react";

import {
  COMPANY_REGISTRATION_FULL_NAME_MAX_LENGTH,
  COMPANY_REGISTRATION_FULL_NAME_MIN_LENGTH,
  COMPANY_REGISTRATION_PASSWORD_MAX_LENGTH,
  COMPANY_REGISTRATION_PASSWORD_MIN_LENGTH,
  type CompanyRegistrationActionState,
} from "@/lib/access/company-registration";
import { completeFirstCompany, registerOwner } from "./actions";

const initialState: CompanyRegistrationActionState = { status: "idle" };

function Message({ state }: { state: CompanyRegistrationActionState }) {
  if (state.status === "idle" || !state.message) return null;
  const success = state.status === "verification-pending";
  return <div role={success ? "status" : "alert"} className={`rounded-xl px-4 py-3 text-sm leading-6 ${success ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-800"}`}>
    <p>{state.message}</p>
    {state.status === "email-registered" ? <Link href="/login" className="mt-2 inline-block font-semibold underline underline-offset-2">Ir a iniciar sesión</Link> : null}
  </div>;
}

function CompanyFields({ pending }: { pending: boolean }) {
  return <>
    <label className="block text-sm font-medium text-slate-800">Nombre de la empresa
      <input name="companyName" type="text" autoComplete="organization" maxLength={180} required disabled={pending} className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 disabled:bg-slate-100" />
    </label>
    <label className="block text-sm font-medium text-slate-800">Razón social *
      <input name="legalName" type="text" autoComplete="organization-title" maxLength={240} required disabled={pending} className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 disabled:bg-slate-100" />
    </label>
    <label className="block text-sm font-medium text-slate-800">Domicilio de la empresa *
      <textarea name="address" autoComplete="street-address" maxLength={500} required disabled={pending} className="mt-1.5 min-h-24 w-full rounded-xl border border-slate-300 px-3.5 py-3 text-base text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 disabled:bg-slate-100" />
    </label>
    <label className="block text-sm font-medium text-slate-800">RFC de persona moral *
      <input name="rfc" type="text" autoComplete="off" maxLength={12} minLength={12} required disabled={pending} className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base uppercase text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 disabled:bg-slate-100" placeholder="12 caracteres" />
    </label>
    <label className="block text-sm font-medium text-slate-800">Número de registro patronal *
      <input name="employerRegistrationNumber" type="text" autoComplete="off" maxLength={64} required disabled={pending} className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 disabled:bg-slate-100" />
    </label>
  </>;
}

export function OwnerRegistrationForm({ fullName = "" }: { fullName?: string }) {
  const [state, action, pending] = useActionState(registerOwner, initialState);
  if (state.status === "verification-pending") {
    return <div className="space-y-4"><Message state={state} /><Link href="/login" className="inline-flex min-h-11 items-center rounded-xl bg-blue-700 px-5 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30">Volver a iniciar sesión</Link></div>;
  }
  return <form action={action} className="space-y-4">
    <Message state={state} />
    <label className="block text-sm font-medium text-slate-800">Nombre completo del propietario
      <input name="fullName" type="text" autoComplete="name" minLength={COMPANY_REGISTRATION_FULL_NAME_MIN_LENGTH} maxLength={COMPANY_REGISTRATION_FULL_NAME_MAX_LENGTH} defaultValue={fullName} required disabled={pending} className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 disabled:bg-slate-100" />
    </label>
    <label className="block text-sm font-medium text-slate-800">Correo electrónico
      <input name="email" type="email" autoComplete="email" maxLength={254} required disabled={pending} className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 disabled:bg-slate-100" />
    </label>
    <label className="block text-sm font-medium text-slate-800">Contraseña
      <input name="password" type="password" autoComplete="new-password" minLength={COMPANY_REGISTRATION_PASSWORD_MIN_LENGTH} maxLength={COMPANY_REGISTRATION_PASSWORD_MAX_LENGTH} required disabled={pending} className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 disabled:bg-slate-100" />
    </label>
    <label className="block text-sm font-medium text-slate-800">Confirmar contraseña
      <input name="confirmation" type="password" autoComplete="new-password" minLength={COMPANY_REGISTRATION_PASSWORD_MIN_LENGTH} maxLength={COMPANY_REGISTRATION_PASSWORD_MAX_LENGTH} required disabled={pending} className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 disabled:bg-slate-100" />
    </label>
    <CompanyFields pending={pending} />
    <p className="text-xs leading-5 text-slate-600">La cuenta se crea con Supabase Auth. Si el correo requiere confirmación, primero confirma tu identidad; la empresa se creará después de iniciar sesión.</p>
    <button type="submit" disabled={pending} className="min-h-12 w-full rounded-xl bg-blue-700 px-5 text-sm font-semibold text-white transition hover:bg-blue-800 active:bg-blue-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-wait disabled:opacity-60">{pending ? "Creando cuenta…" : "Crear cuenta y empresa"}</button>
    <p className="text-center text-sm text-slate-600">¿Ya tienes cuenta? <Link href="/login" className="font-semibold text-blue-700 underline underline-offset-2">Inicia sesión</Link></p>
  </form>;
}

export function FirstCompanyCompletionForm({ fullName = "" }: { fullName?: string }) {
  const [state, action, pending] = useActionState(completeFirstCompany, initialState);
  return <form action={action} className="space-y-4">
    {fullName ? <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-950">Cuenta confirmada para <strong>{fullName}</strong>. El nombre solo se usa como dato de presentación.</p> : null}
    <Message state={state} />
    <CompanyFields pending={pending} />
    <p className="text-xs leading-5 text-slate-600">La empresa y la primera membresía Owner se crean juntas después de verificar tu sesión y correo.</p>
    <button type="submit" disabled={pending} className="min-h-12 w-full rounded-xl bg-blue-700 px-5 text-sm font-semibold text-white transition hover:bg-blue-800 active:bg-blue-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-wait disabled:opacity-60">{pending ? "Completando alta…" : "Crear empresa como Owner"}</button>
    <p className="text-center text-sm text-slate-600"><Link href="/login" className="font-semibold text-blue-700 underline underline-offset-2">Volver al inicio de sesión</Link></p>
  </form>;
}
