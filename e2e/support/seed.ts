import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import './env';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './env';

// T-240 (macrotask generation-e2e, P2) — SEEDING dell'end-to-end con un client service_role
// costruito da env (rispecchia adminClient di tests/helpers/supabase-test.ts): SOLO setup dello
// stato del DB, mai dentro cio' che si esercita nel browser. Le shape sono COPIATE dai test
// runtime gia' verdi del progetto (tests/generation-phase2-db.test.ts, tests/briefs-actions.test.ts,
// tests/generations-write-actions.test.ts): sites{account_id,name,slug};
// site_briefs{account_id,site_id,business_name,vertical,locale,status,content};
// site_generations{account_id,site_id,status,max_pages,document,chosen_variant,created_at,updated_at
// (entrambi NOT NULL)}; generation_pools{account_id,generation_id,scope,variant_index,content}.
//
// Il service_role BYPASSA la RLS: e' corretto per il setup (disporre righe che una macchina a
// stati non permetterebbe), e volutamente separato dal browser, che invece parla con l'app come
// utente autenticato (RLS attiva) attraverso i cookie catturati dal globalSetup.

/** Client service_role: SOLO per setup/teardown dell'e2e. Bypassa la RLS. */
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Un sito dell'account. Ritorna il suo id. */
export async function seedSite(opts: {
  accountId: string;
  name: string;
  slug: string;
}): Promise<string> {
  const { data, error } = await adminClient()
    .from('sites')
    .insert({ account_id: opts.accountId, name: opts.name, slug: opts.slug })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

/** Un brief CONFERMATO per un sito (FK composita (account_id, site_id) -> sites, UNIQUE(site_id)). */
export async function seedConfirmedBrief(opts: {
  accountId: string;
  siteId: string;
  businessName: string;
  vertical?: 'ristorazione' | 'fitness' | 'salone_studio' | 'negozio_artigiano' | 'altro';
  content?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await adminClient().from('site_briefs').insert({
    account_id: opts.accountId,
    site_id: opts.siteId,
    business_name: opts.businessName,
    vertical: opts.vertical ?? 'ristorazione',
    locale: 'it',
    status: 'confirmed',
    content: opts.content ?? {},
  });
  if (error) throw error;
}

/**
 * Una generazione GIA' CONGELATA (document NOT NULL): il GIVEN diretto dell'anteprima, che legge
 * la riga site_generations piu' recente con un documento (readGenerationDocument). `created_at` e
 * `updated_at` sono ENTRAMBI valorizzati (NOT NULL, P2-D22). Ritorna il generation id.
 */
export async function seedGenerationWithDocument(opts: {
  accountId: string;
  siteId: string;
  document: unknown;
  status?: 'chosen' | 'complete';
  maxPages?: number;
  chosenVariant?: number | null;
}): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await adminClient()
    .from('site_generations')
    .insert({
      account_id: opts.accountId,
      site_id: opts.siteId,
      status: opts.status ?? 'complete',
      max_pages: opts.maxPages ?? 1,
      document: opts.document,
      chosen_variant: opts.chosenVariant ?? 0,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

/**
 * Il DOPPIO DETERMINISTICO del confine LLM per il percorso genera -> scegli -> anteprima (T-241,
 * AC-241-5): una generazione `status='ready'` piu' un pool `scope='home'` con `variant_index=null`
 * (il pool CONDIVISO, letto da tutte e cinque le varianti, P2-D3). Nessuna chiamata al modello.
 * Ritorna il generation id.
 */
export async function seedReadyGeneration(opts: {
  accountId: string;
  siteId: string;
  homePoolContent: Record<string, unknown>;
  maxPages?: number;
}): Promise<string> {
  const now = new Date().toISOString();
  const admin = adminClient();
  const { data, error } = await admin
    .from('site_generations')
    .insert({
      account_id: opts.accountId,
      site_id: opts.siteId,
      status: 'ready',
      max_pages: opts.maxPages ?? 10,
      document: null,
      chosen_variant: null,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();
  if (error) throw error;
  const generationId = data.id as string;

  const { error: poolError } = await admin.from('generation_pools').insert({
    account_id: opts.accountId,
    generation_id: generationId,
    scope: 'home',
    variant_index: null,
    content: opts.homePoolContent,
  });
  if (poolError) throw poolError;
  return generationId;
}

/**
 * Ripulisce un sito seminato: la cancellazione del sito CASCADE su site_generations e
 * generation_pools (e sul brief). Il teardown globale cancella comunque l'intero utente di test
 * (che cascata fino ai pool), quindi questo serve agli spec che vogliano isolarsi tra un caso e
 * l'altro.
 */
export async function cleanupSite(siteId: string): Promise<void> {
  const { error } = await adminClient().from('sites').delete().eq('id', siteId);
  if (error) throw error;
}
