'use server';

import { hasLocale } from 'next-intl';
import { createServerSupabaseClient } from '@/data/supabase-ssr';
import { routing } from '@/i18n/routing';

// T-083 — Persistenza della preferenza di lingua su profiles.locale, oltre al
// cookie NEXT_LOCALE (T-082).
//
// Sicurezza (security_notes del blueprint / OWASP 2025):
//  - A01:2025 / RLS: la scrittura passa dal client Supabase con la SESSIONE
//    dell'utente (RLS attiva), MAI la service_role (R7): la policy UPDATE su
//    profiles è vincolata a id = (select auth.uid()), quindi ogni utente può
//    aggiornare SOLO la propria riga (isolamento provato a runtime, AC-083-2).
//  - Validazione input SEMPRE server-side: il locale è confrontato con l'allowlist
//    routing.locales (['it','es']) PRIMA della scrittura; fuori allowlist → 400,
//    senza sessione → 401. L'identità (id) è derivata da auth.uid(), mai dal client.
//  - A05:2025: filtro con metodo tipato .eq('id', userId); mai .or()/.filter() con
//    input interpolato.

export type UpdateProfileLocaleResult =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 500 };

// Aggiorna profiles.locale per l'utente autenticato. L'ordine dei controlli è:
// prima l'autenticazione (401 senza sessione), poi la validazione del valore
// (400 fuori allowlist), infine la scrittura vincolata alla propria riga.
export async function updateProfileLocale(
  nextLocale: string,
): Promise<UpdateProfileLocaleResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  if (!hasLocale(routing.locales, nextLocale)) return { ok: false, status: 400 };

  const { error } = await supabase
    .from('profiles')
    .update({ locale: nextLocale })
    .eq('id', user.id);
  if (error) return { ok: false, status: 500 };

  return { ok: true };
}

// Legge la preferenza di lingua persistita dell'utente autenticato (RLS: solo la
// propria riga). Usata al bootstrap del layout per inizializzare il locale quando
// il cookie NEXT_LOCALE è assente. Best-effort: qualunque errore (nessuna sessione,
// nessuna riga, errore DB) → null, così il chiamante ricade sul default. Mai la
// service_role.
export async function getProfileLocale(): Promise<string | null> {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('profiles')
      .select('locale')
      .eq('id', user.id)
      .single();
    if (error || !data) return null;

    return (data.locale as string) ?? null;
  } catch {
    return null;
  }
}
