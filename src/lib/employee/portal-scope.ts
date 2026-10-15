export type EmployeeMembership = { company_id: string; role: string; active: boolean };
export type LinkedEmployeeIdentity = { company_id: string; auth_user_id: string | null; active: boolean };

export function activeEmployeeCompanyIds(memberships: EmployeeMembership[]) {
  return [...new Set(memberships.filter((item) => item.active && item.role === "employee").map((item) => item.company_id))];
}

export function isOwnActiveEmployee(
  employee: LinkedEmployeeIdentity,
  userId: string,
  activeEmployeeCompanies: ReadonlySet<string>,
) {
  return employee.active && employee.auth_user_id === userId && activeEmployeeCompanies.has(employee.company_id);
}
