import type { ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/ui/lib/cn';

// Varianti del Button in stile shadcn/ui, gestite con cva. Solo classi basate sui
// token del design system (colori semantici, spaziature e raggi dai token): nessun
// colore esadecimale hardcoded e nessun valore arbitrario Tailwind. Lo stato di
// focus è gestito dal browser (focus-visible) con il colore primary del tema.
const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md px-md py-sm text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

// Button: <button> nativo (stato disabled nativo incluso). Il resto delle props
// è inoltrato all'elemento; className del chiamante ha precedenza tramite cn.
export function Button({ className, variant, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant }), className)} {...props} />
  );
}
