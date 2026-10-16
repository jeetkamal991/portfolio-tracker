/** True only for `Authorization: Bearer <CRON_SECRET>` with a non-empty configured secret. */
export function isAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  return header === `Bearer ${secret}`;
}
