const SUPPORTED_TEAMS_HOSTNAMES = new Set([
  "teams.microsoft.com",
  "teams.cloud.microsoft",
  "teams.live.com",
]);

export function isSupportedTeamsHostname(hostname: string): boolean {
  return SUPPORTED_TEAMS_HOSTNAMES.has(String(hostname).toLowerCase());
}
