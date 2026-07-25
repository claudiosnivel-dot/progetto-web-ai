'use server';

import { createServerSupabaseClient } from '@/data/supabase-ssr';
import {
  BriefUpdateSchema,
  applyBriefUpdate,
  isBriefComplete,
  emptyBrief,
  type Brief,
} from '@/domain/onboarding/brief';

// T-123 (macrotask brief-model, P1) — Server action get/upsert/confirm del Business
// Brief. Eseguite solo server-side, usano il client Supabase legato alla SESSIONE
// (RLS attiva), MAI la service_role (R7).
//
// Sicurezza (security_notes del blueprint / OWASP 2025):
//  - R1/R4 (A01:2025): l'isolamento cross-tenant e imposto dalla RLS di site_briefs
//    (appartenenza account via is_account_member(account_id)); nessun bypass.
//  - account_id DERIVATO dall'identita (auth.uid() → accounts.owner_id), mai fidato
//    dal client. Il site_id viene accettato solo se appartiene all'account dell'utente.
//  - A05:2025 (validation + PostgREST filter injection): l'update e ri-validato con
//    BriefUpdateSchema (input NON FIDATO: output del modello / HTML importato) e si
//    usano solo metodi tipati .eq()/.select()/.upsert()/.update(), mai .or()/.filter()
//    con input interpolato.

type BriefRow = {
  account_id: string;
  site_id: string;
  business_name: string | null;
  vertical: string | null;
  description: string | null;
  address: string | null;
  geo: unknown;
  hours: unknown;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  primary_goal: string | null;
  locale: string;
  content: unknown;
  status: string;
};

export type BriefStatus = 'draft' | 'confirmed';

export type GetBriefResult =
  | { ok: true; brief: Brief | null; status: BriefStatus | null; complete: boolean }
  | { ok: false; status: 401 | 500 };

export type UpsertBriefResult =
  | { ok: true; complete: boolean }
  | { ok: false; status: 400 | 401 | 404 | 500 };

export type MutateBriefResult = { ok: true } | { ok: false; status: 401 | 404 | 500 };

// Converte una riga DB nel Brief di dominio: applica i valori presenti (null →
// undefined) sopra un brief vuoto del locale della riga, cosi i default del content
// sono garantiti e i null spariscono. content jsonb → shape del content.
//
// La LETTURA passa dallo stesso gate della scrittura (P1-D17), e questo ha una
// conseguenza da dichiarare: un valore GIA' in tabella che sfonda un tetto — scritto
// prima dell'emendamento, o da fuori queste azioni — viene SCARTATO in lettura, quindi
// quel campo torna vuoto nel Brief mentre tutti gli altri sopravvivono. Il `rejected`
// di applyBriefUpdate e' volutamente ignorato: GetBriefResult non ha un canale per
// riportarlo e l'UI non avrebbe nulla da farne. ACCETTATO perche' e' fail-closed e
// coerente con lo scarto in scrittura: un valore fuori scala non entra mai nel Brief.
//
// NON e' vero, invece, che "la riga non viene toccata, il dato resta in tabella ed e'
// solo non mostrato": la PERDITA E' PERMANENTE al primo upsertBrief su quel sito,
// chiunque lo chiami e qualunque campo la patch nomini. Il motivo e' qui sotto: la base
// dell'update e' `rowToBrief(existing)`, che ha GIA' scartato quel valore, e briefToRow
// riscrive OGNI colonna — quindi il campo torna in tabella come NULL. Con T-150 accade
// al PRIMO turno di chat, perche' la route chiama upsertBrief a ogni turno.
//
// RISCHIO LATENTE, non incidente: la situazione e' oggi IRRAGGIUNGIBILE. Gli unici
// writer di public.site_briefs sono upsertBrief (che valida con BriefUpdateSchema e
// fonde con applyBriefUpdate: non scrive mai oltre il tetto) e confirmBrief (che tocca
// solo status), e non esistono dati preesistenti perche' i tetti sono arrivati prima del
// primo brief. Ci si arriva solo scrivendo la tabella da FUORI queste azioni (SQL
// diretto, service_role, un task futuro): allora il primo salvataggio cancella il campo.
// Comportamento PINNATO da tests/brief-length-caps.test.ts: cambiarlo deve essere una
// decisione, non una svista.
function rowToBrief(row: BriefRow): Brief {
  const base = emptyBrief(row.locale === 'es' ? 'es' : 'it');
  const contentUpdate =
    row.content && typeof row.content === 'object' ? (row.content as Record<string, unknown>) : {};
  const { brief } = applyBriefUpdate(base, {
    business_name: row.business_name ?? undefined,
    vertical: row.vertical ?? undefined,
    description: row.description ?? undefined,
    address: row.address ?? undefined,
    geo: row.geo ?? undefined,
    hours: row.hours ?? undefined,
    phone: row.phone ?? undefined,
    whatsapp: row.whatsapp ?? undefined,
    email: row.email ?? undefined,
    primary_goal: row.primary_goal ?? undefined,
    locale: row.locale === 'es' ? 'es' : 'it',
    offerings: (contentUpdate.offerings as unknown) ?? undefined,
    social_links: (contentUpdate.social_links as unknown) ?? undefined,
    highlights: (contentUpdate.highlights as unknown) ?? undefined,
    brand_hints: (contentUpdate.brand_hints as unknown) ?? undefined,
  });
  return brief;
}

// Serializza il Brief nelle colonne della tabella (status escluso: gestito a parte;
// su INSERT il DB usa default 'draft', su UPDATE la colonna resta invariata).
function briefToRow(brief: Brief, accountId: string, siteId: string) {
  return {
    account_id: accountId,
    site_id: siteId,
    business_name: brief.business_name ?? null,
    vertical: brief.vertical,
    description: brief.description ?? null,
    address: brief.address ?? null,
    geo: brief.geo ?? null,
    hours: brief.hours ?? null,
    phone: brief.phone ?? null,
    whatsapp: brief.whatsapp ?? null,
    email: brief.email ?? null,
    primary_goal: brief.primary_goal ?? null,
    locale: brief.locale,
    content: brief.content,
    updated_at: new Date().toISOString(),
  };
}

// Legge il Brief del sito (RLS: solo se l'utente e membro dell'account). Ritorna
// null se non esiste o non e visibile (cross-tenant → insieme vuoto).
export async function getBrief(siteId: string): Promise<GetBriefResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const { data, error } = await supabase
    .from('site_briefs')
    .select('*')
    .eq('site_id', siteId)
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: true, brief: null, status: null, complete: false };

  const row = data as BriefRow;
  const brief = rowToBrief(row);
  const status: BriefStatus = row.status === 'confirmed' ? 'confirmed' : 'draft';
  return { ok: true, brief, status, complete: isBriefComplete(brief) };
}

// Crea/aggiorna il Brief del sito applicando una patch (input NON FIDATO). L'update
// e ri-validato con BriefUpdateSchema (invalid → 400); l'account e derivato
// dall'identita; il sito deve appartenere all'account dell'utente (altrimenti 404).
export async function upsertBrief(siteId: string, update: unknown): Promise<UpsertBriefResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const parsed = BriefUpdateSchema.safeParse(update);
  if (!parsed.success) return { ok: false, status: 400 };

  // Account derivato dall'identita: mai un account_id dal client. UNIQUE(owner_id)
  // rende .single() sicuro per costruzione.
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('id')
    .eq('owner_id', user.id)
    .single();
  if (accountError || !account) return { ok: false, status: 500 };
  const accountId = account.id as string;

  // Il sito deve appartenere all'account dell'utente. La RLS di sites lascia vedere
  // solo i propri siti: un site_id di un altro tenant filtra a null → 404.
  const { data: site, error: siteError } = await supabase
    .from('sites')
    .select('id, account_id')
    .eq('id', siteId)
    .maybeSingle();
  if (siteError) return { ok: false, status: 500 };
  if (!site || (site.account_id as string) !== accountId) return { ok: false, status: 404 };

  // Brief esistente (RLS) come base, altrimenti brief vuoto del locale della patch.
  const { data: existing, error: existingError } = await supabase
    .from('site_briefs')
    .select('*')
    .eq('site_id', siteId)
    .maybeSingle();
  if (existingError) return { ok: false, status: 500 };

  const base = existing
    ? rowToBrief(existing as BriefRow)
    : emptyBrief(parsed.data.locale ?? 'it');
  const { brief } = applyBriefUpdate(base, parsed.data);

  const { error: upsertError } = await supabase
    .from('site_briefs')
    .upsert(briefToRow(brief, accountId, siteId), { onConflict: 'site_id' });
  if (upsertError) return { ok: false, status: 500 };

  return { ok: true, complete: isBriefComplete(brief) };
}

// Porta il Brief del sito a status='confirmed' (l'artefatto che P2 consumera). La
// RLS vincola l'update ai soli brief dei propri account; .select() rende osservabili
// le righe toccate: 0 righe (nessun brief per quel sito, o tentativo cross-tenant
// filtrato dalla RLS) → 404, mai un falso successo (rilievo verifica avversariale).
export async function confirmBrief(siteId: string): Promise<MutateBriefResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const { data, error } = await supabase
    .from('site_briefs')
    .update({ status: 'confirmed', updated_at: new Date().toISOString() })
    .eq('site_id', siteId)
    .select('id');
  if (error) return { ok: false, status: 500 };
  if (!data || data.length === 0) return { ok: false, status: 404 };

  return { ok: true };
}
