import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/ui/lib/cn';

type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;

// Label: <label> nativa. htmlFor è inoltrato per l'associazione con l'Input
// (accessibilità). Testo dai token (dimensione e colore semantici).
export function Label({ className, ...props }: LabelProps) {
  return (
    <label
      className={cn('text-sm font-medium text-foreground', className)}
      {...props}
    />
  );
}
