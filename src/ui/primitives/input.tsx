import type { InputHTMLAttributes } from 'react';
import { cn } from '@/ui/lib/cn';

type InputProps = InputHTMLAttributes<HTMLInputElement>;

// Input: <input> nativo con classi dai token (bordo, sfondo e testo semantici).
// Tutte le props (id, type, value, onChange, aria-*, ...) sono inoltrate così
// l'accessibilità e il binding restano a carico del chiamante.
export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'w-full rounded-md border border-border bg-background px-md py-sm text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
