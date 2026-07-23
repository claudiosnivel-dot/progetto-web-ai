import type { HTMLAttributes } from 'react';
import { cn } from '@/ui/lib/cn';

type DivProps = HTMLAttributes<HTMLDivElement>;

// Card e sotto-parti (CardHeader, CardContent): contenitori <div> con classi dai
// token (raggio, bordo, sfondo e testo semantici). Nessun colore hardcoded.
export function Card({ className, ...props }: DivProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-background text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: DivProps) {
  return (
    <div className={cn('flex flex-col gap-xs p-lg', className)} {...props} />
  );
}

export function CardContent({ className, ...props }: DivProps) {
  return <div className={cn('p-lg', className)} {...props} />;
}
