"use client";

import { createContext, useContext, type ReactNode } from "react";

export type CompanyOption = { membershipId: string; companyId: string; companyName: string; role: "owner" | "admin" };
type AdminContextValue = { company: CompanyOption; companies: CompanyOption[]; setCompanyId: (companyId: string) => void };

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminContextProvider({ value, children }: { value: AdminContextValue; children: ReactNode }) {
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdminContext() {
  const context = useContext(AdminContext);
  if (!context) throw new Error("useAdminContext debe usarse dentro del panel administrativo.");
  return context;
}
