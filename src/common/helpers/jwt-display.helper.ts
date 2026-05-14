/** Derive a sensible display username from JWT / Supabase-style claims (no DB). */
export function displayNameFromJwtClaims(
  payload: Record<string, unknown> | undefined,
): string | undefined {
  if (!payload) return undefined;
  const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
  const email = payload.email;
  const fromEmail =
    typeof email === 'string' && email.includes('@')
      ? email.split('@')[0]
      : undefined;
  const pick = (v: unknown) =>
    typeof v === 'string' && v.length > 0 ? v : undefined;
  return (
    pick(payload.username) ||
    pick(payload.preferred_username) ||
    pick(meta.username) ||
    pick(meta.preferred_username) ||
    pick(meta.full_name) ||
    pick(meta.name) ||
    fromEmail
  );
}
