export function readLoginCredentials(formData: FormData) {
  const email = formData.get("email");
  const password = formData.get("password");
  if (typeof email !== "string" || typeof password !== "string") return null;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) return null;
  return { email: normalizedEmail, password };
}
