'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Input, Label } from '@/ui/primitives';
import { importBriefFromUrl } from '@/data/import';
import type { Brief } from '@/domain/onboarding/brief';

// T-151 (macrotask onboarding-ui, P1) — barra di import da URL: porta d'ingresso
// OPZIONALE (P1-D5) che pre-riempie il pannello brief con la proposta di fromUrl (T-141).
//
// La barra NON importa `fromUrl`: e' un componente client e `fromUrl` tira dentro il
// confine server-only (@/data/anthropic) e fetchSafe. Passa dalla Server Action
// importBriefFromUrl (src/data/import.ts), che pretende la sessione e valida l'input —
// e che, essendo una Server Action, eredita il controllo d'origine di Next.
//
// P1-D16 — messaggio d'errore UNICO. `fromUrl` risponde `address-blocked` sia per
// "indirizzo non risolvibile" sia per "IP interno", per negare l'enumerazione del DNS
// interno; la Server Action collassa ogni motivo in uno solo, e qui si rende UNA
// stringa. La UI non dice — e non puo' dire — quale dei due casi sia, ne' distingue il
// rifiuto per sessione assente: chi non ha sessione non deve nemmeno sapere che la
// distinzione esiste.
//
// La proposta NON viene salvata: si consegna a chi contiene la barra, che pre-riempie il
// pannello. La scrittura avviene solo se l'utente conferma (upsertBrief, T-123).

type UrlImportBarProps = {
  onProposal: (brief: Brief) => void;
};

export function UrlImportBar({ onProposal }: UrlImportBarProps) {
  const t = useTranslations('onboarding');
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (url.trim().length === 0) return;

    setPending(true);
    setFailed(false);
    // L'URL viaggia COSI' COM'E' (a meno degli spazi ai bordi): validarlo qui
    // sostituirebbe il giudizio di fetchSafe (T-140), che e' l'unico autorizzato a dire
    // se un indirizzo si puo' raggiungere. La UI non e' il gate.
    const result = await importBriefFromUrl(url.trim());
    setPending(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    onProposal(result.brief);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-sm">
      <Label htmlFor="import-url">{t('import.url')}</Label>
      <Input
        id="import-url"
        // type="url" e' volutamente assente: la validazione nativa del browser
        // rifiuterebbe input che fetchSafe deve poter giudicare (e viceversa
        // accetterebbe schemi che non sono http/https), e mascherarebbe il gate reale.
        value={url}
        onChange={(event) => setUrl(event.target.value)}
      />
      <Button type="submit" variant="secondary" disabled={pending}>
        {t('import.submit')}
      </Button>
      {failed && (
        <p role="alert" className="text-sm font-medium text-foreground">
          {t('import.error')}
        </p>
      )}
    </form>
  );
}
