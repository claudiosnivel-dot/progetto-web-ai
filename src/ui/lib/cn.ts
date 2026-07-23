import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// cn: unisce classi condizionali (clsx) risolvendo i conflitti di utility
// Tailwind (tailwind-merge), così l'override via prop className vince in modo
// deterministico. Utility del design system: nessun valore/colore hardcoded qui.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
