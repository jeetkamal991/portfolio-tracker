function matches(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + "/");
}

export function isPublicPath(pathname: string): boolean {
  return matches(pathname, "/login") || matches(pathname, "/api/cron");
}

export function isApiPath(pathname: string): boolean {
  return matches(pathname, "/api");
}
