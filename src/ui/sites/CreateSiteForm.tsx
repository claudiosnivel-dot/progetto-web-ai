'use client';

import { useActionState } from 'react';
import { Button, Input, Label } from '@/ui/primitives';
import type { CreateSiteFormState } from '@/data/sites';

// T-102 — Form "crea sito" (componente client). Invoca la Server Action iniettata
// via prop `action` (legata al locale dalla dashboard) tramite useActionState. Le
// etichette arrivano già localizzate (next-intl risolto server-side): il
// componente è puramente presentazionale. La validazione autoritativa del name è
// server-side dentro createSite (T-101): la UI non è l'unico gate.
type CreateSiteFormProps = {
  action: (
    state: CreateSiteFormState,
    formData: FormData,
  ) => Promise<CreateSiteFormState>;
  createLabel: string;
  nameLabel: string;
};

const initialState: CreateSiteFormState = { status: 'idle' };

export function CreateSiteForm({
  action,
  createLabel,
  nameLabel,
}: CreateSiteFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-md">
      <div className="flex flex-col gap-xs">
        <Label htmlFor="site-name">{nameLabel}</Label>
        <Input id="site-name" name="name" type="text" required />
      </div>
      <Button type="submit" disabled={pending}>
        {createLabel}
      </Button>
      {state.status === 'error' && (
        <p role="alert" className="text-sm font-medium text-foreground">
          {state.message ?? ''}
        </p>
      )}
    </form>
  );
}
