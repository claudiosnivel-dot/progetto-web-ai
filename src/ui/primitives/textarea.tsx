import type { TextareaHTMLAttributes } from 'react';
import { cn } from '@/ui/lib/cn';

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

// Textarea: <textarea> nativa, con le STESSE classi da token dell'Input (bordo, sfondo,
// testo e anello di focus semantici) — nessun hex, nessuna misura arbitraria. Tutte le
// props (id, value, onChange, rows, aria-*, ...) sono inoltrate, cosi' accessibilita' e
// binding restano a carico del chiamante, come per Input.
//
// PERCHE' esiste (T-152, P1-D17): `description` ha un tetto di 2000 code unit e T-151
// l'aveva messa in un `Input` a riga singola, DICHIARANDO T-152 come sede del textarea.
// L'altezza si governa con l'attributo nativo `rows` invece che con una classe di
// dimensione, cosi' non si introduce nessuna misura fuori dai token.
export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        'w-full rounded-md border border-border bg-background px-md py-sm text-sm text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
