// Unico punto di configurazione del nome del brand. Riutilizzato dalla UI
// (AppShell) e dai metadati. Il brand è una config PUBBLICA (NEXT_PUBLIC_*),
// non un segreto.
export function getBrandName(): string {
  const name = process.env.NEXT_PUBLIC_BRAND_NAME;
  return name && name.trim() !== '' ? name : 'Belora';
}
