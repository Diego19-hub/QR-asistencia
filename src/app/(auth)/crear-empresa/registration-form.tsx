"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

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
  return <div role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">
    <p>{state.message}</p>
  </div>;
}

function CompanyFields({ pending }: { pending: boolean }) {
  const [taxpayerType, setTaxpayerType] = useState("physical_person_business");
  const rfcLength = taxpayerType === "physical_person_business" ? 13 : 12;
  return <>
    <fieldset className="space-y-2">
      <legend className="block text-sm font-medium text-slate-800">¿A nombre de quién opera el negocio? *</legend>
      <label className="flex items-start gap-2 text-sm text-slate-800"><input type="radio" name="taxpayerType" value="physical_person_business" checked={taxpayerType === "physical_person_business"} onChange={() => setTaxpayerType("physical_person_business")} required disabled={pending} />Persona física con actividad empresarial</label>
      <label className="flex items-start gap-2 text-sm text-slate-800"><input type="radio" name="taxpayerType" value="legal_entity" checked={taxpayerType === "legal_entity"} onChange={() => setTaxpayerType("legal_entity")} required disabled={pending} />Persona moral</label>
    </fieldset>
    <label className="block text-sm font-medium text-slate-800">Nombre de la empresa
      <input name="companyName" type="text" autoComplete="organization" maxLength={180} required disabled={pending} className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 disabled:bg-slate-100" />
    </label>
    <label className="block text-sm font-medium text-slate-800">Razón social *
      <input name="legalName" type="text" autoComplete="organization-title" maxLength={240} required disabled={pending} className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 disabled:bg-slate-100" />
    </label>
    <label className="block text-sm font-medium text-slate-800">Domicilio de la empresa *
      <textarea name="address" autoComplete="street-address" maxLength={500} required disabled={pending} className="mt-1.5 min-h-24 w-full rounded-xl border border-slate-300 px-3.5 py-3 text-base text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 disabled:bg-slate-100" />
    </label>
    <label className="block text-sm font-medium text-slate-800">RFC *
      <input name="rfc" type="text" autoComplete="off" maxLength={rfcLength} minLength={rfcLength} required disabled={pending} className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base uppercase text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 disabled:bg-slate-100" placeholder={`${rfcLength} caracteres`} />
    </label>
    <p className="text-xs leading-5 text-slate-600">Aceptamos letras minúsculas y las convertimos a mayúsculas. La aplicación valida el formato del RFC, no su vigencia ante el SAT.</p>
    <label className="block text-sm font-medium text-slate-800">Número de registro patronal *
      <input name="employerRegistrationNumber" type="text" autoComplete="off" maxLength={64} required disabled={pending} className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 px-3.5 text-base text-slate-950 outline-none focus:border-blue-600 focus:ring-4 focus:ring-blue-600/10 disabled:bg-slate-100" />
    </label>
  </>;
}

export function OwnerRegistrationForm({ fullName = "" }: { fullName?: string }) {
  const [state, action, pending] = useActionState(registerOwner, initialState);
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
    <p className="text-xs leading-5 text-slate-600">Al crear la cuenta, iniciarás sesión automáticamente. No necesitas confirmar tu correo; la empresa y la membresía Owner se guardan juntas.</p>
    <button type="submit" disabled={pending} className="min-h-12 w-full rounded-xl bg-blue-700 px-5 text-sm font-semibold text-white transition hover:bg-blue-800 active:bg-blue-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-wait disabled:opacity-60">{pending ? "Creando cuenta…" : "Crear cuenta y empresa"}</button>
    <p className="text-center text-sm text-slate-600">¿Ya tienes cuenta? <Link href="/login" className="font-semibold text-blue-700 underline underline-offset-2">Inicia sesión</Link></p>
  </form>;
}

export function FirstCompanyCompletionForm({ fullName = "" }: { fullName?: string }) {
  const [state, action, pending] = useActionState(completeFirstCompany, initialState);
  return <form action={action} className="space-y-4">
    {fullName ? <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-950">Sesión lista para <strong>{fullName}</strong>. El nombre solo se usa como dato de presentación.</p> : null}
    <Message state={state} />
    <CompanyFields pending={pending} />
    <p className="text-xs leading-5 text-slate-600">La empresa y la primera membresía Owner se crean juntas con tu sesión autenticada.</p>
    <button type="submit" disabled={pending} className="min-h-12 w-full rounded-xl bg-blue-700 px-5 text-sm font-semibold text-white transition hover:bg-blue-800 active:bg-blue-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-wait disabled:opacity-60">{pending ? "Completando alta…" : "Crear empresa como Owner"}</button>
    <p className="text-center text-sm text-slate-600"><Link href="/login" className="font-semibold text-blue-700 underline underline-offset-2">Volver al inicio de sesión</Link></p>
  </form>;
}
