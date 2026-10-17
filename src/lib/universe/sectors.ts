export const SECTOR_PRIORITY: string[] = [
  "NIFTY_BANK", "NIFTY_FIN", "NIFTY_PVT_BANK", "NIFTY_PSU_BANK", "NIFTY_IT", "NIFTY_PHARMA",
  "NIFTY_HEALTHCARE", "NIFTY_AUTO", "NIFTY_FMCG", "NIFTY_METAL", "NIFTY_MEDIA",
];

export function primarySector(indexKeys: string[]): string | null {
  return SECTOR_PRIORITY.find((k) => indexKeys.includes(k)) ?? null;
}
