'use client';

import { useActionState } from 'react';
import { Button, Card, CardContent, CardHeader, Input, Label } from '@/ui/primitives';
import { signup } from '@/domain/auth/signup';
import type { SignupState } from '@/domain/auth/validation';

const initialState: SignupState = { status: 'idle' };

// Pagina di registrazione (componente client): il form invoca la Server Action
// `signup` tramite useActionState. La validazione e la creazione utente avvengono
// interamente server-side nell'azione; qui si raccolgono solo i campi e si mostra
// l'esito. Nessun campo privilegio nel form: solo email e password.
export default function SignupPage() {
  const [state, formAction, pending] = useActionState(signup, initialState);

  return (
    <main className="mx-auto max-w-md p-lg">
      <Card>
        <CardHeader>
          <h1 className="text-lg font-semibold text-foreground">Crea il tuo account</h1>
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
                autoComplete="new-password"
                required
              />
            </div>
            <Button type="submit" disabled={pending}>
              Registrati
            </Button>
            {state.status === 'error' && (
              <p role="alert" className="text-sm font-medium text-foreground">
                {state.message}
              </p>
            )}
            {state.status === 'success' && (
              <p role="status" className="text-sm text-muted-foreground">
                {state.message}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
