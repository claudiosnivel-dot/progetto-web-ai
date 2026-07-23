'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { hasLocale } from 'next-intl';
import { createServerSupabaseClient } from '@/data/supabase-ssr';
import { generateUniqueSlug } from '@/domain/sites/slug';
import { routing } from '@/i18n/routing';

// T-101 — Server action createSite/listSites per il segnaposto sito.
//
// Sicurezza (security_notes del blueprint / OWASP 2025):
//  - R1/R4 (A01:2025): l'isolamento cross-tenant NON è affidato al codice
//    applicativo ma alla RLS di sites (appartenenza account via
//    is_account_member(account_id)). Si usa il client Supabase legato alla
//    SESSIONE dell'utente (RLS attiva), MAI la service_role (R7): nessun bypass.
//  - account_id è DERIVATO dall'identità (auth.uid() → accounts.owner_id), mai
//    fidato da input del client (validazione identità sempre server-side).
//  - A05:2025 (injection, incl. PostgREST filter injection): solo metodi tipati
//    .eq()/.insert()/.select(); mai .or()/.filter() con input interpolato. Lo
//    slug è ristretto a [a-z0-9-] alla fonte (T-104) prima di finire in query/URL.
//  - Validazione name server-side (non vuoto/non solo spazi, entro lunghezza max).

// Lunghezza massima del name accettata dalla validazione server-side.
const MAX_SITE_NAME_LENGTH = 100;

// name valido: stringa non vuota una volta rimossi gli spazi ai bordi, entro la
// lunghezza massima. `.trim()` normalizza prima dei controlli di lunghezza, così
// un name di soli spazi diventa '' e fallisce .min(1).
const siteNameSchema = z.string().trim().min(1).max(MAX_SITE_NAME_LENGTH);

export type SiteSummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

export type CreateSiteResult =
  | { ok: true; id: string }
  | { ok: false; status: 400 | 401 | 500 };

export type ListSitesResult =
  | { ok: true; sites: SiteSummary[] }
  | { ok: false; status: 401 | 500 };

export type MutateSiteResult = { ok: true } | { ok: false; status: 400 | 401 | 500 };

// Stato della Server Action del form "crea sito", consumato via useActionState.
export type CreateSiteFormState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

// Crea un sito nell'account dell'utente autenticato. account_id è risolto
// dall'identità (owner_id = auth.uid()), lo slug è reso unico per-account.
export async function createSite(name: string): Promise<CreateSiteResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const parsed = siteNameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, status: 400 };
  const cleanName = parsed.data;

  // Account derivato dall'identità: mai un account_id arbitrario dal client.
  // UNIQUE(owner_id) su accounts rende .single() sicuro per costruzione.
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('id')
    .eq('owner_id', user.id)
    .single();
  if (accountError || !account) return { ok: false, status: 500 };
  const accountId = account.id as string;

  // Slug unico per-account: il predicato exists interroga sites con metodi tipati.
  const slug = await generateUniqueSlug(cleanName, async (candidate) => {
    const { data, error } = await supabase
      .from('sites')
      .select('id')
      .eq('account_id', accountId)
      .eq('slug', candidate)
      .limit(1);
    if (error) throw error;
    return (data?.length ?? 0) > 0;
  });

  const { data: inserted, error } = await supabase
    .from('sites')
    .insert({ account_id: accountId, name: cleanName, slug })
    .select('id')
    .single();
  if (error || !inserted) return { ok: false, status: 500 };

  return { ok: true, id: inserted.id as string };
}

// Elenca i siti dell'account dell'utente autenticato. La RLS di sites vincola già
// il risultato ai soli account di cui l'utente è membro: nessun filtro applicativo
// per account è necessario (né sarebbe sufficiente da solo, R1/R4).
export async function listSites(): Promise<ListSitesResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const { data, error } = await supabase
    .from('sites')
    .select('id, name, slug, status, created_at')
    .order('created_at', { ascending: true });
  if (error) return { ok: false, status: 500 };

  const sites: SiteSummary[] = (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    slug: r.slug as string,
    status: r.status as string,
  }));
  return { ok: true, sites };
}

// T-103 — Rinomina un sito. Il name è ri-validato server-side (non ci si fida del
// client). Grazie alla RLS di sites (UPDATE vincolata all'appartenenza account),
// l'update è efficace solo sui siti del proprio account: un tentativo cross-tenant
// filtra a 0 righe senza errore (AC-103-4). Filtro con .eq() tipato, nessun .or().
export async function renameSite(
  siteId: string,
  newName: string,
): Promise<MutateSiteResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const parsed = siteNameSchema.safeParse(newName);
  if (!parsed.success) return { ok: false, status: 400 };

  const { error } = await supabase
    .from('sites')
    .update({ name: parsed.data })
    .eq('id', siteId);
  if (error) return { ok: false, status: 500 };

  return { ok: true };
}

// T-103 — Elimina un sito. La RLS di sites (DELETE vincolata all'appartenenza
// account) rende l'eliminazione efficace solo sui siti del proprio account: un
// tentativo cross-tenant filtra a 0 righe. Filtro con .eq() tipato, nessun .or().
export async function deleteSite(siteId: string): Promise<MutateSiteResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const { error } = await supabase.from('sites').delete().eq('id', siteId);
  if (error) return { ok: false, status: 500 };

  return { ok: true };
}

// T-102 — Adattatore per useActionState del form "crea sito": estrae il name dal
// FormData, delega a createSite (che valida e deriva l'account server-side) e, in
// caso di successo, invalida la cache della dashboard così il nuovo sito compare
// al re-render. Il locale (legato dalla pagina) è vincolato all'allowlist prima di
// comporre il path da rivalidare — nessuna interpolazione di input libero.
export async function createSiteForm(
  locale: string,
  _prevState: CreateSiteFormState,
  formData: FormData,
): Promise<CreateSiteFormState> {
  const raw = formData.get('name');
  const res = await createSite(typeof raw === 'string' ? raw : '');
  if (!res.ok) {
    return { status: 'error' };
  }
  const lc = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  revalidatePath(`/${lc}/dashboard`);
  return { status: 'success' };
}
