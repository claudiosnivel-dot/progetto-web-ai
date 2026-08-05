'use client';

import { useActionState } from 'react';
import { useLocale } from 'next-intl';
import { Button, Card, CardContent, CardHeader, Input, Label } from '@/ui/primitives';
import { login, signInWithGoogle } from './actions';
import type { LoginState } from '@/domain/auth/validation';

const initialState: LoginState = { status: 'idle' };

// Pagina di login (componente client): il form email/password invoca la Server
// Action `login` tramite useActionState; il pulsante "Accedi con Google" invoca
// l'azione `signInWithGoogle`. Entrambe le azioni sono associate al locale
// corrente (bind) così il redirect resta interno e coerente col locale, senza
// mai derivare la destinazione da input libero. La validazione e lo scambio
// credenziali avvengono interamente server-side nelle azioni.
export default function LoginPage() {
  const locale = useLocale();
  const boundLogin = login.bind(null, locale);
  const [state, formAction, pending] = useActionState(boundLogin, initialState);

  return (
    <main className="mx-auto max-w-md p-lg">
      <Card>
        <CardHeader>
          <h1 className="text-lg font-semibold text-foreground">Accedi</h1>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="flex flex-col gap-md">
            <div className="flex flex-col gap-xs">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </div>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" disabled={pending}>
              Accedi
            </Button>
            {state.status === 'error' && (
              <p role="alert" className="text-sm font-medium text-foreground">
                {state.message}
              </p>
            )}
          </form>

          <form action={signInWithGoogle.bind(null, locale)} className="mt-md">
            <Button type="submit" variant="secondary" className="w-full">
              Accedi con Google
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
