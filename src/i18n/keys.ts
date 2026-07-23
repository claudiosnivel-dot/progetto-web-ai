// Utility di supporto ai test di parità i18n: appiattisce un oggetto di
// messaggi annidato nell'insieme dei path puntati delle sue chiavi FOGLIA
// (es. { a: { b: 'x' } } → Set { 'a.b' }). Una foglia è qualunque valore che
// non sia un oggetto annidato; la ricorsione scende solo negli oggetti.
export function flattenKeys(
  obj: Record<string, unknown>,
  prefix = '',
): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const nested of flattenKeys(value as Record<string, unknown>, path)) {
        keys.add(nested);
      }
    } else {
      keys.add(path);
    }
  }
  return keys;
}
