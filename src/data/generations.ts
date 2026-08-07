'use server';

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuthedClient } from '@/data/authed-client';
import { createServerSupabaseClient } from '@/data/supabase-ssr';
import { DOCUMENT_LIMITS, parseDocument } from '@/domain/generation/document';
import { parsePool } from '@/domain/generation/pool';
import type { PageRole } from '@/domain/generation/slots';
import { GENERATION_TIMEOUTS } from '@/domain/generation/timeouts';

// T-203 (macrotask generation-model, P2) — Server action di CREAZIONE e LETTURA delle
// generazioni. Eseguite solo server-side, usano il client Supabase legato alla SESSIONE
// (RLS attiva), MAI la service_role (R7).
//
// Sicurezza (security_notes del blueprint / OWASP 2025):
//  - R1/R4 (A01:2025): l'isolamento cross-tenant NON e affidato al codice applicativo ma
//    alla RLS di site_generations e sites (appartenenza account via
//    is_account_member(account_id)). Qui non esiste alcun client privilegiato.
//  - account_id DERIVATO dall'identita (auth.uid() -> accounts.owner_id), mai fidato dal
//    client, esattamente come sites (T-101) e briefs (T-123). Il site_id e accettato solo
//    se il sito appartiene all'account dell'utente.
//  - A05:2025 (injection, incl. PostgREST filter injection): solo metodi tipati
//    .eq()/.is()/.lt()/.select()/.insert()/.update(); mai .or()/.filter() con input
//    interpolato. maxPages e input del client e viene validato server-side.
//
// ── PERCHE' QUESTO MODULO ESISTE (P2-D15) ────────────────────────────────────────────
// L'indice UNIQUE parziale su site_generations(site_id) WHERE status='generating'
// (T-200) rende IRRAPPRESENTABILE la doppia generazione in volo — ed e per la stessa
// ragione il modo in cui il prodotto si INCASTRA: se il processo che ha scritto quella
// riga muore, nessun `finally` gira, la riga resta 'generating' e quel sito non e piu
// generabile PER SEMPRE. La RICONCILIAZIONE qui sotto e il secondo meccanismo, e serve
// proprio perche il primo non puo essere disfatto da codice che non viene eseguito.
// Un utente il cui sito non e piu generabile non vede un errore di sicurezza: vede un
// prodotto rotto.

// ── le due decisioni dichiarate del modulo ───────────────────────────────────────────
//
// (1) `updated_at` E' MANTENUTO DALLE SCRITTURE, NON DA UN TRIGGER.
// La colonna ha `default now()` ma NESSUN trigger la aggiorna (accertato su T-200):
// un UPDATE che non la nomina la lascia al valore vecchio. Siccome la riconciliazione
// poggia sull'eta della riga, l'invariante e dichiarata qui e vale per OGNI scrittura di
// questo modulo: `updated_at` e sempre impostato ESPLICITAMENTE (INSERT compreso, dove il
// default basterebbe: cosi l'invariante e una riga di codice e non una proprieta dello
// schema che qualcuno potrebbe cambiare). Chi scrivera le altre transizioni di stato
// (T-204, fase 2) deve fare lo stesso, altrimenti una generazione che avanza sembrerebbe
// ferma e verrebbe riconciliata mentre e viva. In lettura l'eta si calcola sul SOLO
// `updated_at`, senza alcun ripiego: una riga priva di riferimento temporale non sarebbe
// MAI stantia e bloccherebbe il sito per sempre — proprio il guasto che questo modulo
// esiste per evitare — ma dall'EMENDAMENTO P2-D22 `created_at` e `updated_at` sono NOT
// NULL nello schema, quindi quella riga non e piu rappresentabile. Il ripiego che c'era
// qui e stato rimosso perche nessun test poteva piu esercitarlo: il posto giusto per quel
// guasto e il vincolo, non un ramo di codice.
//
// (2) LA RICONCILIAZIONE E' UNA SCRITTURA DENTRO UNA FUNZIONE DI LETTURA, E LO E' PER
//     NECESSITA'.
// La tensione: la DoD chiede di riportare 'failed' SENZA cancellare, ma l'indice UNIQUE
// parziale libera il sito solo se la riga smette DAVVERO di essere `status='generating'`
// nel DB. Derivare lo stato in memoria e lasciare la riga com'e soddisferebbe la prima
// meta di AC-203-5 ("lo stato riportato e 'failed'") e renderebbe FALSA la seconda ("una
// successiva createGeneration riesce"): l'insert successivo continuerebbe a sbattere
// contro l'indice. Quindi `getGeneration` PERSISTE la transizione — un UPDATE mirato che
// cambia status/failure_reason/updated_at e nient'altro. Non e una cancellazione: id,
// created_at, max_pages e il documento gia congelato restano intatti e la riga resta
// leggibile e verificabile (lo asserisce AC-203-5 con l'oracolo service_role).
// La scrittura e un COMPARE-AND-SET (vedi `riconcilia`): riesce solo se la riga e ancora
// nello stato in cui l'abbiamo letta, cosi una lettura concorrente non puo mai rovinare
// il lavoro di una generazione che nel frattempo e avanzata.
// `listGenerationStatuses`, che e un REPORT e non la lettura autorevole, DERIVA soltanto:
// non scrive nulla (vedi la sua nota).

/** Il vocabolario della macchina a stati di P2-D13, vincolato anche dal CHECK di T-200. */
export type GenerationStatus = 'generating' | 'ready' | 'chosen' | 'complete' | 'failed';

/** Quel che una lettura puntuale riporta di una generazione. */
export type GenerationSummary = {
  id: string;
  site_id: string;
  status: GenerationStatus;
  // La variante scelta (0..4), o `null` finche' l'utente non ha scelto. La legge l'azione
  // di fase 2 (T-234): scrive i pool 'inner' e le pagine sotto QUELLA variante, e senza
  // questo campo dovrebbe rileggere la riga per conto proprio.
  chosen_variant: number | null;
  max_pages: number;
  failure_reason: string | null;
  updated_at: string | null;
};

/** Lo stato corrente di UN sito. `null` = quel sito non e mai stato generato. */
export type SiteGenerationStatus = {
  site_id: string;
  status: GenerationStatus | null;
};

export type CreateGenerationResult =
  | { ok: true; id: string }
  // 409 = generazione GIA' IN VOLO su questo sito: e un rifiuto riconoscibile e
  // distinto da 400/404, perche chi chiama deve poterlo raccontare all'utente
  // ("stiamo gia generando") invece di trattarlo come un errore.
  | { ok: false; status: 400 | 401 | 404 | 409 | 500 };

export type GetGenerationResult =
  | { ok: true; generation: GenerationSummary | null }
  | { ok: false; status: 401 | 500 };

export type ListGenerationStatusesResult =
  | { ok: true; statuses: SiteGenerationStatus[] }
  | { ok: false; status: 401 | 500 };

// I tempi della riconciliazione (P2-D15) NON stanno piu qui: vivono in
// src/domain/generation/timeouts.ts, importati sopra. Questo modulo e 'use server' e puo
// esportare SOLO funzioni async, quindi finche erano un `const` locale nessun test puro
// poteva leggerli e l'invariante che li dimensiona — ogni timeout SOPRA la vita massima
// della richiesta — restava una frase in un commento. Misurato dal verifier: scambiare
// phase1 e phase2, o portarli entrambi a un minuto, lasciava questa suite tutta verde.
// L'EMENDAMENTO P2-D22 li sposta in un modulo di dominio puro perche AC-203-7 possa
// asserire la RELAZIONE (non il numero). Qui restano solo i loro USI.

// Il testo scritto in failure_reason dalla riconciliazione. E' NOSTRO — nessuna
// interpolazione di input non fidato in una colonna che qualcuno loggera (stessa cura
// del ramo di errore di parsePool/parseDocument, P2-D20).
const MOTIVO_RICONCILIAZIONE: Record<keyof typeof GENERATION_TIMEOUTS.phases, string> = {
  phase1: 'riconciliazione: nessun avanzamento entro il timeout della fase 1',
  phase2: 'riconciliazione: fase 2 non conclusa entro il suo timeout',
};

// Colonne nominate, mai select('*') (DoD 4). `chosen_variant` serve all'azione di fase 2
// (T-234), che scrive pool e pagine sotto la variante scelta. Il `document` NON e' piu' fra
// le colonne: dall'EMENDAMENTO P2-D32 la riconciliazione della fase 2 non guarda piu' le
// pagine parziali (una fase 2 conclusa sarebbe 'complete'), quindi non c'e' piu' un predicato
// che lo legga qui — il documento resta materia di T-204/T-214/T-235.
const COLONNE_GENERAZIONE =
  'id, site_id, status, chosen_variant, max_pages, failure_reason, created_at, updated_at';

// maxPages e input del CLIENT: validato server-side entro il tetto del documento
// (DOCUMENT_LIMITS.max_pages, P2-D13) — derivato, mai ricopiato. Il minimo e 1 perche la
// home esiste sempre, ed e lo stesso vincolo del CHECK di T-200: qui e un 400 esplicito
// invece di un errore del DB.
const maxPagesSchema = z.number().int().min(1).max(DOCUMENT_LIMITS.max_pages);

const STATI: readonly GenerationStatus[] = [
  'generating',
  'ready',
  'chosen',
  'complete',
  'failed',
];

// La home e l'unico ruolo NON interno: il valore viene dal vocabolario dei ruoli di
// pagina (slots.ts), cosi se quel vocabolario cambia il typecheck lo dice qui.
const RUOLO_HOME: PageRole = 'home';

type RigaGenerazione = {
  id: string;
  site_id: string;
  status: string;
  chosen_variant: number | null;
  max_pages: number;
  failure_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
};

// Uno status fuori dal vocabolario del CHECK di T-200 e irrappresentabile; se comparisse
// (scrittura da fuori queste azioni) lo si legge come 'failed': e la lettura fail-closed,
// mai "sembra che stia ancora generando".
//
// RAMO DIFENSIVO DICHIARATO: finche quel CHECK vincola il vocabolario, il ripiego su
// 'failed' e IRRAGGIUNGIBILE — il valore fuori vocabolario non puo esistere in tabella,
// quindi nessuna fixture puo produrlo e nessun test lo copre. Resta perche e la difesa
// contro un futuro allentamento del CHECK, dove il fail-closed farebbe lavoro vero.
// Dichiararlo e cio che lo distingue da un ramo dimenticato.
function comeStato(valore: unknown): GenerationStatus {
  return STATI.includes(valore as GenerationStatus) ? (valore as GenerationStatus) : 'failed';
}

// Eta della riga in ms, sul SOLO `updated_at` (vedi decisione 1). Nessun ripiego su
// `created_at`: dopo P2-D22 entrambe le colonne sono NOT NULL, quindi quel ramo non
// sarebbe piu esercitabile da nulla. La guardia qui sotto e sulla FORMA del payload — il
// tipo di riga e dichiarato a mano su un `unknown` che viene da PostgREST, non dal DB —
// non su uno stato che il DB possa ancora produrre.
function etaMs(riga: { updated_at: string | null }): number | null {
  if (!riga.updated_at) return null;
  const istante = Date.parse(riga.updated_at);
  return Number.isFinite(istante) ? Date.now() - istante : null;
}

/**
 * Quale timeout di P2-D15 ha superato questa riga, o `null` se non e stantia.
 *  - 'generating' oltre phase1: il processo che la possedeva non c'e piu.
 *  - 'chosen' oltre phase2: la fase 2 non si e conclusa. E' stantia A PRESCINDERE dalle
 *    pagine parziali (EMENDAMENTO P2-D32): la fase 2 e' a CHUNK e ogni chunk lascia la riga
 *    in 'chosen' estendendo il documento, quindi una riga 'chosen' con pagine interne
 *    parziali e' una fase 2 morta a meta' esattamente come una senza — una fase 2 CONCLUSA
 *    sarebbe 'complete'. Guardare le pagine parziali qui la lascerebbe bloccata per sempre.
 * Gli altri stati (ready/complete/failed) sono di riposo: nessuno li possiede, quindi
 * non c'e nulla da riconciliare.
 */
function motivoStantio(riga: RigaGenerazione): keyof typeof GENERATION_TIMEOUTS.phases | null {
  const eta = etaMs(riga);
  if (eta === null) return null;
  if (riga.status === 'generating' && eta > GENERATION_TIMEOUTS.phases.phase1) return 'phase1';
  if (riga.status === 'chosen' && eta > GENERATION_TIMEOUTS.phases.phase2) return 'phase2';
  return null;
}

function sommario(riga: RigaGenerazione): GenerationSummary {
  return {
    id: riga.id,
    site_id: riga.site_id,
    status: comeStato(riga.status),
    chosen_variant: riga.chosen_variant,
    max_pages: riga.max_pages,
    failure_reason: riga.failure_reason,
    updated_at: riga.updated_at,
  };
}

/**
 * Porta a 'failed' una riga stantia. E' la scrittura dichiarata nella decisione (2), e ha
 * tre proprieta che vanno lette insieme:
 *  - NON CANCELLA: cambia status, failure_reason e updated_at; id, created_at, max_pages
 *    e document restano dove sono.
 *  - E' UN COMPARE-AND-SET: il filtro ripete il predicato di staleness (stesso status,
 *    updated_at ancora oltre la soglia) valutato dal DB al momento dell'UPDATE. Se nel
 *    frattempo la generazione e avanzata, l'UPDATE tocca 0 righe e non rovina nulla.
 *    Serve perche fra la SELECT e questa UPDATE puo passare del tempo, e il proprietario
 *    della riga potrebbe non essere morto affatto.
 *  - PERDE IN SILENZIO: se il CAS non trova la riga (l'ha cambiata qualcun altro) si
 *    riporta la riga COME LETTA. Una lettura e una fotografia di un istante; mentire
 *    dicendo 'failed' su una riga che qualcun altro ha appena portato avanti sarebbe
 *    peggio. Un errore dell'UPDATE (RLS, rete) segue la stessa strada: la lettura non
 *    fallisce per colpa della riconciliazione.
 */
async function riconcilia(
  supabase: SupabaseClient,
  riga: RigaGenerazione,
  motivo: keyof typeof GENERATION_TIMEOUTS.phases,
): Promise<RigaGenerazione> {
  const soglia = new Date(Date.now() - GENERATION_TIMEOUTS.phases[motivo]).toISOString();
  // Il confronto con la soglia e l'UNICO ramo del CAS. Il ramo che ancorava il filtro a un
  // `updated_at` nullo era la coda del ripiego rimosso in etaMs — si arriva qui solo se
  // etaMs ha saputo leggere `updated_at`, e dopo P2-D22 quella colonna e comunque NOT
  // NULL — quindi nessuna fixture poteva piu esercitarlo. Metodo tipato, nessun filtro a
  // stringa libera.
  const { data, error } = await supabase
    .from('site_generations')
    .update({
      status: 'failed',
      failure_reason: MOTIVO_RICONCILIAZIONE[motivo],
      updated_at: new Date().toISOString(),
    })
    .eq('id', riga.id)
    .eq('status', riga.status)
    .lt('updated_at', soglia)
    .select(COLONNE_GENERAZIONE)
    .maybeSingle();
  if (error || !data) return riga;
  return data as RigaGenerazione;
}

/**
 * Crea la generazione di un sito dell'account dell'utente autenticato.
 *
 * Due difese contro la doppia generazione, e servono entrambe: il pre-controllo qui
 * sotto (che sa distinguere "in volo" da "stantia" e da un errore riconoscibile) e
 * l'indice UNIQUE parziale del DB, che vince le corse che nessun pre-controllo puo
 * vedere — per questo il 23505 e tradotto nello STESSO 409 invece che in un 500.
 */
export async function createGeneration(
  siteId: string,
  maxPages: number,
): Promise<CreateGenerationResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const parsed = maxPagesSchema.safeParse(maxPages);
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

  // Il sito deve appartenere all'account dell'utente. La RLS di sites lascia vedere solo
  // i propri siti: un site_id di un altro tenant filtra a null -> 404. Il confronto
  // esplicito con accountId e difesa in profondita, OGGI RIDONDANTE con quella RLS, e non
  // promette di piu: `accountId` viene da .eq('owner_id', user.id).single(), cioe
  // dall'account POSSEDUTO (la convenzione di T-101/T-123). Un membro non proprietario non
  // arriverebbe fin qui — fallirebbe prima, nella derivazione stessa — quindi questo
  // confronto NON e cio che reggerebbe una membership multipla.
  const { data: site, error: siteError } = await supabase
    .from('sites')
    .select('id, account_id')
    .eq('id', siteId)
    .maybeSingle();
  if (siteError) return { ok: false, status: 500 };
  if (!site || (site.account_id as string) !== accountId) return { ok: false, status: 404 };

  // Una sola generazione in volo PER SITO (non per account): e il predicato dell'indice
  // UNIQUE parziale, quindi qui al piu una riga.
  const { data: inVolo, error: inVoloError } = await supabase
    .from('site_generations')
    .select(COLONNE_GENERAZIONE)
    .eq('site_id', siteId)
    .eq('status', 'generating')
    .maybeSingle();
  if (inVoloError) return { ok: false, status: 500 };

  if (inVolo) {
    const riga = inVolo as RigaGenerazione;
    const motivo = motivoStantio(riga);
    // Viva: rifiuto riconoscibile, e la riga esistente non viene toccata.
    if (motivo === null) return { ok: false, status: 409 };
    // Stantia: la si riconcilia e si prosegue. La riconciliazione vive in getGeneration
    // (AC-203-5), ma ripeterla qui non e ridondanza: e cio che rende il sito generabile
    // anche per un chiamante che non passi mai dalla lettura. Se il CAS perde, la riga e
    // di nuovo viva e vale il rifiuto.
    const riconciliata = await riconcilia(supabase, riga, motivo);
    if (comeStato(riconciliata.status) !== 'failed') return { ok: false, status: 409 };
  }

  const { data: inserted, error } = await supabase
    .from('site_generations')
    .insert({
      account_id: accountId,
      site_id: siteId,
      status: 'generating',
      max_pages: parsed.data,
      // Esplicito anche se il default coprirebbe l'INSERT: vedi decisione (1).
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) {
    // 23505 = l'indice UNIQUE parziale: un'altra generazione e partita fra il
    // pre-controllo e questo insert. E' lo stesso esito, non un guasto.
    if (error.code === '23505') return { ok: false, status: 409 };
    return { ok: false, status: 500 };
  }

  return { ok: true, id: inserted.id as string };
}

/**
 * La generazione CORRENTE del sito, cioe la PIU RECENTE: la relazione col sito e 1:N nel
 * tempo (T-200), quindi "la generazione del sito" va scelta, non trovata. L'ordine e
 * `created_at desc, id desc`: il secondo criterio non e decorativo, e cio che rende la
 * scelta deterministica quando due righe condividono l'istante di creazione.
 *
 * E' la lettura AUTOREVOLE: applica la riconciliazione di P2-D15 e ne PERSISTE l'esito
 * (vedi la decisione (2) in testa al modulo). Nessun filtro per account: la RLS di
 * site_generations vincola gia il risultato agli account di cui l'utente e membro, e un
 * site_id di un altro tenant filtra a insieme vuoto -> null, mai un errore.
 */
export async function getGeneration(siteId: string): Promise<GetGenerationResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const { data, error } = await supabase
    .from('site_generations')
    .select(COLONNE_GENERAZIONE)
    .eq('site_id', siteId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: true, generation: null };

  const riga = data as RigaGenerazione;
  const motivo = motivoStantio(riga);
  const corrente = motivo === null ? riga : await riconcilia(supabase, riga, motivo);

  return { ok: true, generation: sommario(corrente) };
}

// Forma della riga restituita dall'embed PostgREST qui sotto. Il documento NON e fra le
// colonne: la lista e un report di stato e non deve trascinare N documenti jsonb.
type RigaGenerazioneInLista = {
  id: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
};
type RigaSitoConGenerazioni = {
  id: string;
  site_generations: RigaGenerazioneInLista[] | null;
};

// Ordine DETERMINISTICO, lo stesso di getGeneration: piu recente prima, id come
// spareggio. Ordinare in memoria e possibile perche l'embed porta gia tutte le righe.
function piuRecentePrima(a: RigaGenerazioneInLista, b: RigaGenerazioneInLista): number {
  const istanteA = Date.parse(a.created_at ?? '');
  const istanteB = Date.parse(b.created_at ?? '');
  const va = Number.isFinite(istanteA) ? istanteA : 0;
  const vb = Number.isFinite(istanteB) ? istanteB : 0;
  if (va !== vb) return vb - va;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Lo stato di TUTTI i siti dell'account in UNA chiamata: un sito mai generato compare
 * con `status: null`, altrimenti compare lo stato della sua generazione piu recente.
 *
 * UNA QUERY, NON N+1: l'embed PostgREST `sites -> site_generations` (risolto attraverso
 * la FK COMPOSITA di T-200) porta siti e generazioni in una sola richiesta, e resta una
 * sola al crescere di N — che e la proprieta che AC-203-6 misura, non il valore assoluto.
 * Colonne nominate, mai select('*'). Nessun filtro per account: la RLS di sites e quella
 * di site_generations scopano gia il risultato agli account di cui l'utente e membro
 * (stessa scelta di listSites, T-101), e aggiungere un filtro applicativo costerebbe una
 * SECONDA query per risolvere l'account — cioe romperebbe proprio la proprieta richiesta.
 *
 * QUI LA RICONCILIAZIONE E' SOLO DERIVATA, E LA DIFFERENZA E' VOLUTA: questa e una vista
 * di riepilogo, non la lettura autorevole di un sito. Riportare 'failed' su una riga
 * stantia evita che una dashboard mostri "sto generando" per sempre; PERSISTERE la
 * transizione per N siti in un colpo solo sarebbe una scrittura di massa innescata da una
 * pagina in sola lettura, e non e cio che serve — l'indice si libera quando quel sito
 * viene davvero letto (getGeneration) o ri-generato (createGeneration).
 * Vale il solo timeout della fase 1: il predicato della fase 2 richiede il documento, che
 * qui deliberatamente non si legge.
 */
export async function listGenerationStatuses(): Promise<ListGenerationStatusesResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const { data, error } = await supabase
    .from('sites')
    .select('id, site_generations(id, status, created_at, updated_at)');
  if (error) return { ok: false, status: 500 };

  const righe = (data ?? []) as unknown as RigaSitoConGenerazioni[];
  const statuses: SiteGenerationStatus[] = righe.map((sito) => {
    const generazioni = [...(sito.site_generations ?? [])].sort(piuRecentePrima);
    const corrente = generazioni[0];
    if (!corrente) return { site_id: sito.id, status: null };
    const stato = comeStato(corrente.status);
    const eta = etaMs(corrente);
    const stantia =
      stato === 'generating' && eta !== null && eta > GENERATION_TIMEOUTS.phases.phase1;
    return { site_id: sito.id, status: stantia ? 'failed' : stato };
  });

  return { ok: true, statuses };
}

export type CountGenerationsResult =
  | { ok: true; count: number }
  | { ok: false; status: 401 | 500 };

/**
 * (deploy pass) T-4 — Quante generazioni dell'account dell'utente sono state CREATE da `sinceIso`
 * in poi. E' il conteggio del CAP GIORNALIERO di costo: la rotta /api/generate lo confronta col
 * tetto (getDailyGenerationCap) PRIMA di creare la riga e spendere una chiamata al modello.
 *
 * Client di SESSIONE (RLS attiva, mai service_role — R7): la RLS di site_generations scopa gia' il
 * conteggio agli account di cui l'utente e' membro, quindi non serve — ne' si deve — filtrare per
 * account nel codice (un site_id/account_id dal client non entra mai qui). `count:'exact', head:true`
 * conta senza scaricare le righe; `.gte('created_at', sinceIso)` e' un metodo TIPATO (A05:2025: mai
 * un filtro a stringa libera). L'assenza di sessione e' 401, un guasto di lettura 500 — il chiamante
 * tratta il 500 come fail-open (il freno hard resta lo spending cap di Anthropic).
 */
export async function countGenerationsSince(sinceIso: string): Promise<CountGenerationsResult> {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  const { count, error } = await supabase
    .from('site_generations')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', sinceIso);
  if (error) return { ok: false, status: 500 };
  return { ok: true, count: count ?? 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// T-204 — LE TRE SCRITTURE. Le azioni di sopra leggono e creano; queste CONGELANO:
// il documento che `chooseVariant` scrive e l'artefatto che P3 modifichera e P4
// pubblichera. Per questo la macchina a stati di P2-D13 e qui un VINCOLO e non una
// convenzione — una transizione accettata dallo stato sbagliato non produce un errore
// visibile, produce un documento incoerente che nessuno guardera finche non sara un
// sito pubblicato.
//
// LE DECISIONI DICHIARATE DI QUESTO BLOCCO (cio che gli AC impongono, e cio che invece
// e stato scelto qui — dichiararlo e cio che lo distingue da una svista):
//
// (a) NIENTE E' MAI SCRITTO GREZZO (A05:2025). `writePool` fa passare il content da
//     `parsePool` (T-201) e `chooseVariant`/`appendPages` fanno passare il documento da
//     `parseDocument` (T-202) PRIMA di toccare il DB, e cio che viene scritto e il
//     valore RESTITUITO dal gate (la copia validata), mai l'input. Le due colonne sono
//     jsonb OPACO: il DB non valida nulla, questi gate sono l'unica validazione che
//     esiste.
//     CHE SI SCRIVA LA COPIA E NON L'INPUT E' OGGI INDISTINGUIBILE, e dichiararlo vale
//     piu di un test che non puo fallire (rilievo V-204-06, misurato): i due schemi sono
//     strict e non hanno alcun `.default()`, `.transform()` o coercizione, quindi per un
//     input ACCETTATO la copia di zod e deep-equal all'ingresso e NESSUN oracolo potrebbe
//     distinguere le due scritture. Cio che un oracolo copre davvero vive in T-201/T-202:
//     che l'input rifiutato non passi, e che la copia non condivida oggetti con
//     l'ingresso. La proprieta diventerebbe osservabile il giorno in cui uno di quegli
//     schemi acquistasse un default o una trasformazione — e allora scrivere l'input
//     invece della copia sarebbe un difetto vero, silenzioso e a valle. Resta scritta
//     cosi perche quel giorno la riga da cambiare si trovi.
//
// (b) L'ERRORE DI VALIDAZIONE NON VIENE PERSISTITO. I commenti di pool.ts/document.ts
//     alludono a una traduzione dell'errore in `failure_reason`, ma la DoD e gli AC di
//     T-204 dicono soltanto "rifiutata, nessuna riga scritta": una funzione che gli AC
//     vogliono SENZA effetti non puo scriverne uno. `failure_reason` resta cio che la
//     riconciliazione (T-203) usa. Chi vorra un canale diagnostico dovra deciderlo,
//     non ereditarlo da qui.
//
// (c) L'INDICE DI VARIANTE E' VINCOLATO PRIMA DEL DB, ed e difesa in PROFONDITA: il
//     CHECK di T-200 lo vincola gia, ma un rifiuto che arriva dal DB e un round-trip in
//     piu e un errore che chi chiama non sa distinguere da un guasto. Il tetto qui e
//     dichiarato una volta (`VARIANTI_MOCKUP`) e vale per entrambe le azioni.
//
// (d) `updated_at` E' IMPOSTO DA TUTTE E TRE, MA SOLO SUL RAMO RIUSCITO (invariante di
//     T-203, decisione (1) in testa al modulo; EMENDAMENTO P2-D23 / AC-204-12). Per
//     `writePool` non e cerimonia: la fase 1 scrive pool per minuti, e senza questo tocco
//     la riga invecchierebbe MENTRE lavora e la riconciliazione la ucciderebbe da viva.
//     Il tocco e quindi la PROVA DI VITA della generazione — ed e proprio per questo che
//     NON puo essere la stessa richiesta che ne verifica l'esistenza, com'era prima.
//     MISURATO (rilievo V-204-03): `updated_at` veniva scritto PRIMA dell'insert e
//     nessuna transazione lo disfaceva quando l'insert falliva, quindi un secondo
//     writePool sulla stessa terna tornava 409 E RINGIOVANIVA comunque la riga. Un
//     chiamante che ritenta su una generazione 'generating' incastrata riceveva sempre
//     409 e continuava a rimetterla a nuovo: `motivoStantio` non scattava MAI, l'indice
//     UNIQUE parziale restava occupato e quel sito non era piu generabile — il prodotto
//     rotto descritto in testa al modulo, causato dal modulo stesso. Ora l'esistenza si
//     LEGGE (senza toccare nulla) e la prova di vita si scrive DOPO che l'insert e
//     riuscito: una richiesta in piu sul solo ramo riuscito, e ogni rifiuto torna senza
//     effetti. Se la prova di vita fallisse (RLS, rete) la scrittura resta riuscita e
//     l'esito lo dice: negarla farebbe ritentare il chiamante contro un 409 perpetuo su
//     un pool che c'e gia — la stessa scelta di "perdere in silenzio" di `riconcilia`.
//
// (e) L'ACCOUNT NON ARRIVA MAI DAL CLIENT (A01:2025). `writePool` prende `account_id`
//     dalla riga di `site_generations` che la RLS gli ha lasciato leggere: e derivato
//     dall'identita per costruzione (la policy e `is_account_member(account_id)`), e
//     coincide per forza con l'account della generazione — che e anche cio che la FK
//     COMPOSITA `(account_id, generation_id)` di T-200 impone comunque, difesa in
//     profondita OLTRE la RLS.
//
// (f) LE TRANSIZIONI SONO COMPARE-AND-SET. Lo stato di partenza non e controllato in
//     memoria e poi scritto: e il FILTRO dell'UPDATE, valutato dal DB nello stesso
//     istante della scrittura. Un controllo-poi-scrivi lascerebbe aperta la finestra in
//     cui due chiamate concorrenti leggono entrambe 'ready' e transizionano entrambe.
//     Zero righe toccate significa "non era nello stato di partenza", e allora una
//     lettura mirata distingue il 409 (c'e, ma in un altro stato) dal 404 (non c'e, o
//     non e visibile a questa identita).
//
// (g) `writePool` VINCOLA I SOLI STATI TERMINALI, e il resto e dichiarato invece che
//     indovinato (EMENDAMENTO P2-D23 / AC-204-9). MISURATO: un writePool su 'complete' e
//     su 'failed' tornava ok e scriveva la riga di pool. Su una generazione conclusa un
//     pool nuovo non e contenuto, e inquinamento: nessuno lo leggera piu e resta
//     attaccato a un artefatto gia congelato. Quei due stati sono ora un rifiuto
//     riconoscibile (409, vedi `WritePoolResult`), e `comeStato` ci fa cadere anche uno
//     status fuori vocabolario, che e il verso fail-closed giusto.
//     GLI STATI VIVI RESTANO TUTTI AMMESSI, e la MAPPA FINE scope->stato NON e
//     implementata qui di proposito: i pool si scrivono in DUE momenti diversi della
//     macchina (quelli 'home' durante 'generating', quelli 'inner' dopo la scelta) e la
//     rigenerazione copy-on-write di P2-D3 vive in T-230/T-232 — quale stato ammetta
//     quale scope e una PRECONDIZIONE su quei task, non una cosa da indovinare qui, dove
//     sbagliarla bloccherebbe una fase legittima. Cio che si sa e dichiarato: un pool NON
//     si sovrascrive (vedi (h)), quindi anche una scrittura tardiva su uno stato vivo non
//     puo cambiare un contenuto gia usato.
//
// (h) UN POOL NON SI SOVRASCRIVE IN SILENZIO. L'UNIQUE NULLS NOT DISTINCT di T-200
//     esiste perche due righe per lo stesso (generazione, scope, variante) sarebbero
//     due sorgenti di verita divergenti; qui la seconda scrittura e un 409 RICONOSCIBILE
//     e non un upsert, cosi il contenuto che una generazione sta gia usando non puo
//     essere cambiato sotto i piedi di chi lo sta rendendo. E' anche la stessa lettura
//     del 23505 che fa `createGeneration`.
//
// (i) LA FASE 1 CONGELA LA SOLA HOME (DoD 3), E LA FASE 2 NON LA DISFA. `chooseVariant`
//     non si limita a scrivere il documento che riceve: pretende che sia la one-pager
//     della fase 1 — UNA pagina, di ruolo 'home'. Senza, un chiamante potrebbe congelare
//     un documento gia multi-pagina e saltare del tutto la fase 2, cioe passare per
//     'chosen' senza che 'chosen' voglia dire quel che dice.
//     L'INVARIANTE E' SIMMETRICA (EMENDAMENTO P2-D23 / AC-204-11, rilievo V-204-02
//     misurato): `appendPages` accettava una pagina di ruolo 'home' e scriveva un
//     documento con DUE home. `parseDocument` non lo blocca ED E' GIUSTO CHE NON LO
//     FACCIA — document.ts dichiara che "esattamente una" non e richiesto dallo schema,
//     perche quel vincolo appartiene alla TRANSIZIONE e non alla forma. Le due azioni
//     contano percio le home con la STESSA funzione e la STESSA costante (`quanteHome`,
//     `RUOLO_HOME`): due controlli scritti a mano in due punti divergono, ed e
//     esattamente cosi che il secondo era nato mancante.
//
// (j) `appendPages` ESTENDE, E LA BASE E' LA RIGA, NON L'INGRESSO. Il documento esteso
//     si costruisce sul documento LETTO dal DB: chi chiama porta le pagine nuove e non
//     puo riscrivere quelle congelate. Una lista VUOTA e ammessa ed e voluto — la
//     one-pager e un esito legittimo di v1 (P2-D13), e rifiutarla lascerebbe quelle
//     generazioni per sempre in 'chosen'.
//     IL TETTO DELLA RIGA E' IMPOSTO QUI (EMENDAMENTO P2-D23 / AC-204-8): il documento
//     esteso non deve superare il `max_pages` DELLA GENERAZIONE, non solo il tetto
//     globale di DOCUMENT_LIMITS. MISURATO: una generazione creata con max_pages=2
//     accettava un appendPages di 5 pagine e ne conservava 6. La causa era strutturale —
//     `max_pages` non era nemmeno fra le colonne lette, quindi l'azione non poteva
//     vederlo. E' il giunto verso P5 dichiarato da P2-D13 (piano free -> una pagina):
//     sorvegliare l'INGRESSO del tetto (lo valida `createGeneration`) e non il suo USO lo
//     rende decorativo, cioe aggirabile da chiunque chiami la scrittura.
//
// (k) `generationId` E' VALIDATO PRIMA DEL DB, come ogni altro input esterno
//     (EMENDAMENTO P2-D23 / AC-204-12). MISURATO: un id malformato costava un round-trip
//     e tornava 500 — cioe un guasto — dove un uuid inesistente torna 404: due risposte
//     diverse per lo stesso "non c'e", che la rotta di T-230 avrebbe dovuto poi tradurre.
//     Ora e un 400 con ZERO richieste, coerente con la disciplina che il modulo gia
//     dichiara ("TUTTO cio che arriva da fuori e validato PRIMA di qualunque
//     round-trip"). Il controllo sta DOPO `auth.getUser()` e prima di ogni query: senza
//     sessione la risposta resta 401 qualunque cosa arrivi, che e l'ordine che non fa
//     trapelare nulla a chi non e autenticato.
//     NOTA POSITIVA DALLO STESSO PROBE, che vale conservare: un `generationId` che porta
//     un payload di PostgREST filter injection non ha prodotto alcun bypass di filtro, ma
//     solo un errore di TIPO dal DB. `.eq()` e parametrizzato e la difesa A05:2025 regge
//     sul percorso reale — il 400 qui e ergonomia e difesa in profondita, non il tappo di
//     un buco.
//
// (l) LA SCELTA PRETENDE IL POOL (EMENDAMENTO P2-D23 / AC-204-10). MISURATO: una
//     generazione 'ready' con ZERO righe di pool accettava `chooseVariant(G, 4)` e
//     scriveva chosen_variant=4 — un campo che puo cosi MENTIRE su quale mockup l'utente
//     abbia davvero visto, e su cui T-233 (la conferma sulla riscelta) si appoggera.
//     Sono ammessi ENTRAMBI i pool, quello della variante (generationId, 'home', index) e
//     quello CONDIVISO (generationId, 'home', NULL), e non e lassismo: per P2-D3 le
//     cinque varianti nascono NORMALMENTE dal pool condiviso e solo quella rigenerata ne
//     ha uno proprio, quindi un controllo che pretendesse il solo pool della variante
//     romperebbe il caso NORMALE. Il rifiuto passa dalla stessa distinzione degli altri
//     (`assenteOppureConflitto`), cosi un chiamante di un altro tenant continua a vedere
//     404 e non impara che quella generazione esiste.

export type WritePoolResult =
  | { ok: true; id: string }
  // 400 = il gate ha rifiutato (id, content, scope, indice, allowlist); 404 = la
  // generazione non esiste o non e visibile a questa identita; 409 = CONFLITTO con lo
  // stato corrente della risorsa, e sono due casi che chi chiama tratta allo stesso
  // modo (non riprovare con lo stesso input): quel pool esiste gia (decisione (h)),
  // oppure la generazione e in uno stato TERMINALE (decisione (g)).
  | { ok: false; status: 400 | 401 | 404 | 409 | 500 };

export type TransitionResult =
  | { ok: true }
  // 409 = TRANSIZIONE NON AMMESSA, ed e distinto da 400 e da 404 di proposito: chi
  // chiama deve poter dire "non da questo stato" senza confonderlo con "dato invalido"
  // ne con "non esiste".
  | { ok: false; status: 400 | 401 | 404 | 409 | 500 };

// 5 mockup ⇒ indici 0..4 (P2-D13). E' lo stesso dominio del CHECK di T-200: qui vive
// perche il rifiuto avvenga PRIMA del DB, non perche il CHECK sia superfluo.
const VARIANTI_MOCKUP = 5;

// IL VOCABOLARIO DELL'AMBITO VIVE IN UN SOLO POSTO. Accanto a questo schema c'era un
// `export type PoolScope = 'home' | 'inner'` scritto a mano: nessun consumatore — nemmeno
// la firma di `writePool`, che dichiara `scope: string` — e un secondo elenco che poteva
// divergere in silenzio da questo, cioe il difetto contro cui mette in guardia
// document.ts. E' stato RIMOSSO invece che derivato con `z.infer`: derivarlo avrebbe
// prodotto un export ancora senza consumatori (e knip non lo direbbe, perche src/data/**
// e in `entry`), e USARLO NELLA FIRMA sarebbe sbagliato — `scope` e input non fidato, il
// suo tipo stretto non esiste finche questo schema non l'ha accettato, e un parametro
// tipizzato 'home'|'inner' renderebbe impossibile scrivere al chiamante proprio il caso
// che AC-204-5 misura (uno scope inventato, rifiutato prima del DB).
const poolScopeSchema = z.enum(['home', 'inner']);
// L'ambito dei cinque mockup, DERIVATO dallo schema e non riscritto: e lo stesso
// vocabolario, quindi non puo divergere da quello che il gate accetta.
const AMBITO_HOME = poolScopeSchema.enum.home;
// NULL non e "sconosciuto": e il valore di dominio "pool CONDIVISO fra le varianti"
// (T-200). Va quindi ammesso esplicitamente, non trattato come assenza.
const variantIndexSchema = z.number().int().min(0).max(VARIANTI_MOCKUP - 1);
const sharedOrVariantIndexSchema = variantIndexSchema.nullable();
// L'identificatore della generazione e input esterno come ogni altro, e la sua FORMA e un
// uuid: e cio che permette il 400 senza alcun round-trip (decisione (k)).
const generationIdSchema = z.string().uuid();
// L'allowlist degli slug ammessi per QUESTA generazione: la deriva il chiamante
// server-side (T-213), non arriva dal browser. Validata comunque nella forma, perche una
// allowlist malformata renderebbe muto il gate invece di rifiutare.
const allowedSlugsSchema = z.array(z.string());

// `max_pages` E' FRA LE COLONNE LETTE perche il tetto della riga sia IMPOSTO e non solo
// dichiarato (decisione (j)): finche non lo era, `appendPages` non poteva nemmeno vederlo.
const COLONNE_TRANSIZIONE = 'id, status, document, max_pages';

// La forma della riga che le transizioni leggono. Dichiarata a mano su un `unknown` che
// viene da PostgREST, come `RigaGenerazione`: il DB non tipizza questo client.
type RigaTransizione = {
  id: string;
  status: string;
  document: unknown;
  max_pages: number;
};

// Gli stati in cui una generazione e CONCLUSA: nessuno la possiede piu (decisione (g)).
const STATI_TERMINALI: readonly GenerationStatus[] = ['complete', 'failed'];

/**
 * Quante pagine di ruolo home porta un documento. La costante e la funzione sono le
 * STESSE per la fase 1 e per la fase 2 (decisione (i)): l'invariante della home unica non
 * puo essere scritta due volte senza che le due copie divergano — ed e gia successo, la
 * fase 2 non l'aveva affatto.
 */
function quanteHome(pagine: readonly { readonly role: PageRole }[]): number {
  return pagine.filter((pagina) => pagina.role === RUOLO_HOME).length;
}

/**
 * Perche una scrittura non ha toccato nulla: 404 se la riga non esiste o la RLS non la
 * mostra a questa identita (nessuna informazione trapela sui tenant altrui), 409 se
 * esiste ma la precondizione non era soddisfatta.
 *
 * La domanda si pone SOLO dopo un rifiuto, e in due punti: quando un compare-and-set ha
 * toccato zero righe (non era nello stato di partenza ammesso) e quando manca il pool che
 * `chooseVariant` pretende (decisione (l)). In entrambi i casi la distinzione e la
 * stessa, e va fatta con una lettura mirata: dedurla dal rifiuto direbbe a un altro
 * tenant che quella generazione esiste.
 */
async function assenteOppureConflitto(
  supabase: SupabaseClient,
  generationId: string,
): Promise<{ ok: false; status: 404 | 409 | 500 }> {
  const { data, error } = await supabase
    .from('site_generations')
    .select('id')
    .eq('id', generationId)
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  return { ok: false, status: data ? 409 : 404 };
}

/**
 * IL CORPO COMUNE DELLE TRANSIZIONI COMPARE-AND-SET su `site_generations`: l'UPDATE di `patch`
 * filtrato per `id` E per lo stato di PARTENZA `fromStatus` — il CAS valutato dal DB nello stesso
 * istante della scrittura (decisione (f)), mai un controllo-poi-scrivi — con `updated_at` SEMPRE
 * toccato (prova di vita, decisione (1)) e la distinzione 404/409 sullo zero-righe
 * (`assenteOppureConflitto`, che NON deduce l'esistenza dal rifiuto: la rilegge). E' cio' che
 * `markReady`/`markFailed`/`failGenerationPhase2`/`chooseVariant`/`appendPages` ripetevano verbatim
 * (misurato come duplicazione dal controllo dead-code del checkpoint); il `patch` e lo stato di
 * partenza sono il solo punto che DIVERGE, e sono parametri. Semantica IDENTICA — `.eq('status',
 * fromStatus)` tiene il vincolo di partenza dentro la scrittura, cosi' due richieste concorrenti
 * non transizionano entrambe.
 */
/**
 * L'APERTURA COMUNE di ogni scrittura su una generazione: il client con SESSIONE (RLS attiva, mai
 * service_role — R7) piu' la VALIDAZIONE dell'id PRIMA di qualunque round-trip (decisione (k)).
 * writePool/chooseVariant/appendPages/markReady/markFailed/failGenerationPhase2 lo ripetevano
 * verbatim (misurato come duplicazione dal controllo dead-code del checkpoint). Ritorna il risultato
 * del parse (`id`) cosi' i chiamanti continuano a usare `id.data` senza cambi; l'assenza di sessione
 * e' 401, un id malformato 400 — entrambi PRIMA di toccare il DB, come nel codice inline.
 */
async function beginTransition(
  generationId: string,
): Promise<
  { ok: true; supabase: SupabaseClient; id: { readonly data: string } } | { ok: false; status: 400 | 401 }
> {
  const gate = await getAuthedClient();
  if (!gate.ok) return gate;
  const id = generationIdSchema.safeParse(generationId);
  if (!id.success) return { ok: false, status: 400 };
  return { ok: true, supabase: gate.supabase, id: { data: id.data } };
}

async function eseguiCas(
  supabase: SupabaseClient,
  idData: string,
  patch: Record<string, unknown>,
  fromStatus: GenerationStatus,
): Promise<TransitionResult> {
  const { data, error } = await supabase
    .from('site_generations')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', idData)
    .eq('status', fromStatus)
    .select('id');
  if (error) return { ok: false, status: 500 };
  if (!data || data.length === 0) return await assenteOppureConflitto(supabase, idData);
  return { ok: true };
}

/**
 * Scrive UN pool (uscita del modello) di una generazione dell'account dell'utente.
 *
 * `variantIndex` null = pool CONDIVISO fra le varianti; 0..4 = copia-su-scrittura di una
 * variante. `allowedSlugs` e l'allowlist delle pagine previste per questa generazione:
 * uno slug che non vi compare fa cadere l'intero pool (T-201), quindi nessun contenuto di
 * una pagina non prevista raggiunge il DB.
 *
 * NON scrive nulla se il gate rifiuta: la validazione precede ogni accesso al DB. E un
 * rifiuto non lascia NESSUNA traccia, `updated_at` compreso (decisione (d)).
 */
export async function writePool(
  generationId: string,
  scope: string,
  variantIndex: number | null,
  content: unknown,
  allowedSlugs: readonly string[],
): Promise<WritePoolResult> {
  // Apertura comune: client con sessione + id validato PRIMA di ogni round-trip (decisione (k)).
  // TUTTO cio' che arriva da fuori e' validato prima del DB; l'id non fa eccezione.
  const ctx = await beginTransition(generationId);
  if (!ctx.ok) return ctx;
  const { supabase, id } = ctx;

  const ambito = poolScopeSchema.safeParse(scope);
  if (!ambito.success) return { ok: false, status: 400 };
  const variante = sharedOrVariantIndexSchema.safeParse(variantIndex);
  if (!variante.success) return { ok: false, status: 400 };
  const slug = allowedSlugsSchema.safeParse(allowedSlugs);
  if (!slug.success) return { ok: false, status: 400 };

  // IL GATE sull'uscita del modello (T-201). Cio che verra scritto e `parsed.pool`, cioe
  // la copia validata: l'input non raggiunge mai la colonna.
  const parsed = parsePool(content, { allowedSlugs: slug.data });
  if (!parsed.ok) return { ok: false, status: 400 };

  // ESISTENZA E STATO, in una LETTURA che non tocca la riga (decisione (d)): prova che la
  // generazione esiste ed e visibile a questa identita (RLS). L'account_id restituito e
  // quello della generazione, mai un valore del client (decisione (e)).
  const { data: generazione, error: letturaError } = await supabase
    .from('site_generations')
    .select('id, account_id, status')
    .eq('id', id.data)
    .maybeSingle();
  if (letturaError) return { ok: false, status: 500 };
  if (!generazione) return { ok: false, status: 404 };
  // Stati TERMINALI: un pool scritto ora non lo leggera nessuno (decisione (g)).
  if (STATI_TERMINALI.includes(comeStato(generazione.status))) return { ok: false, status: 409 };

  const { data: inserito, error } = await supabase
    .from('generation_pools')
    .insert({
      account_id: generazione.account_id as string,
      generation_id: id.data,
      scope: ambito.data,
      variant_index: variante.data,
      content: parsed.pool,
    })
    .select('id')
    .single();
  if (error) {
    // 23505 = l'UNIQUE (generation_id, scope, variant_index) NULLS NOT DISTINCT: quel
    // pool esiste gia, e non lo si sovrascrive (decisione (h)).
    if (error.code === '23505') return { ok: false, status: 409 };
    return { ok: false, status: 500 };
  }

  // LA PROVA DI VITA, sul SOLO ramo riuscito (decisione (d)): la fase 1 scrive pool per
  // minuti e la riga non deve invecchiare mentre lavora. Un errore qui NON disfa la
  // scrittura ne la nega a chi chiama — il pool c'e, e negarlo lo farebbe ritentare
  // contro un 409 perpetuo; al peggio la riga resta vecchia quanto era, che e lo stato in
  // cui un rifiuto la lascia comunque.
  await supabase
    .from('site_generations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', id.data);

  return { ok: true, id: inserito.id as string };
}

/**
 * LA SCELTA DELL'UTENTE: 'ready' → 'chosen'. Scrive `chosen_variant` e CONGELA il
 * documento della fase 1 — la sola pagina home.
 *
 * Il documento arriva dal chiamante (lo costruira `resolve`, T-214) ed e input NON
 * FIDATO: passa da `parseDocument` e cio che si scrive e la copia validata. Un indice
 * fuori 0..4 e rifiutato prima del DB; una partenza diversa da 'ready' e un 409 e NON
 * modifica la riga. E la scelta pretende che il POOL della variante scelta — o quello
 * condiviso — esista davvero (decisione (l)): senza, `chosen_variant` potrebbe registrare
 * un mockup che nessuno ha mai visto.
 */
export async function chooseVariant(
  generationId: string,
  index: number,
  document: unknown,
): Promise<TransitionResult> {
  const ctx = await beginTransition(generationId);
  if (!ctx.ok) return ctx;
  const { supabase, id } = ctx;

  const variante = variantIndexSchema.safeParse(index);
  if (!variante.success) return { ok: false, status: 400 };

  const parsed = parseDocument(document);
  if (!parsed.ok) return { ok: false, status: 400 };

  // LA FASE 1 CONGELA LA SOLA HOME (decisione (i)). `parseDocument` pretende ALMENO una
  // home ma non che sia sola — e giusto cosi, quel vincolo appartiene a questa
  // transizione e non alla forma del documento, che dopo la fase 2 avra piu pagine.
  const pagine = parsed.document.pages;
  if (pagine.length !== 1 || quanteHome(pagine) !== 1) return { ok: false, status: 400 };

  // IL POOL DELLA SCELTA DEVE ESISTERE (decisione (l)): quello della variante, oppure
  // quello CONDIVISO da cui per P2-D3 le cinque varianti nascono normalmente. Le due
  // condizioni si valutano su un'unica lettura tipata delle righe di pool 'home' di
  // questa generazione — al piu sei — perche esprimerle in una sola query richiederebbe
  // un OR su un valore NULL, cioe un filtro a stringa libera (A05:2025, mai `.or()`).
  const { data: poolHome, error: poolError } = await supabase
    .from('generation_pools')
    .select('variant_index')
    .eq('generation_id', id.data)
    .eq('scope', AMBITO_HOME);
  if (poolError) return { ok: false, status: 500 };
  const visto = (poolHome ?? []).some(
    (riga: { variant_index: number | null }) =>
      riga.variant_index === null || riga.variant_index === variante.data,
  );
  if (!visto) return await assenteOppureConflitto(supabase, id.data);

  // IL VINCOLO DI PARTENZA e' 'ready', valutato dal DB insieme alla scrittura (decisione (f)):
  // corpo CAS condiviso (eseguiCas), col solo `patch` proprio della scelta.
  return eseguiCas(
    supabase,
    id.data,
    { status: 'chosen', chosen_variant: variante.data, document: parsed.document },
    'ready',
  );
}

/**
 * LA FASE 2: ESTENDE `document.pages` con le pagine interne. Con `opts.final` decide se
 * CHIUDERE la generazione o lasciarla aperta per il chunk successivo (EMENDAMENTO P2-D32,
 * fase 2 a chunk di T-234):
 *  - `final: true` (DEFAULT, retro-compatibile con le chiamate a 2 argomenti di T-204):
 *    'chosen' → 'complete'. E' l'ULTIMO chunk, o la one-pager, o l'append unico di T-204.
 *  - `final: false`: 'chosen' → 'chosen' (la riga RESTA aperta), document esteso. E' la
 *    persistenza INCREMENTALE di un chunk non finale: cosi' un troncamento del chunk
 *    successivo perde quel chunk e non le pagine gia' scritte (AC-234-3).
 * In ENTRAMBI i casi il CAS parte da 'chosen', gli STESSI vincoli sono imposti (parseDocument,
 * `max_pages` della RIGA, home unica) e `updated_at` e' toccato — la prova di vita che
 * impedisce alla riconciliazione (P2-D15/P2-D32) di uccidere una fase 2 viva a meta'.
 *
 * La base e il documento LETTO dalla riga, non un documento che il chiamante riporta: le
 * pagine gia congelate non sono riscrivibili da qui. Il documento ESTESO passa per intero
 * da `parseDocument` prima di essere scritto — e li che valgono il tetto GLOBALE di pagine
 * e quello di byte, che nessuna pagina da sola limita — e poi da due vincoli che
 * appartengono alla TRANSIZIONE e non alla forma: il `max_pages` della RIGA (decisione
 * (j)) e la home unica (decisione (i)).
 */
export async function appendPages(
  generationId: string,
  pages: unknown,
  opts: { readonly final?: boolean } = {},
): Promise<TransitionResult> {
  const ctx = await beginTransition(generationId);
  if (!ctx.ok) return ctx;
  const { supabase, id } = ctx;

  if (!Array.isArray(pages)) return { ok: false, status: 400 };

  // Serve il documento corrente per ESTENDERLO, quindi qui la lettura precede la
  // scrittura per necessita. Lo stato e comunque ri-verificato dal CAS piu sotto: questo
  // controllo produce il 409 leggibile, non e cio che protegge dalla corsa.
  const { data, error } = await supabase
    .from('site_generations')
    .select(COLONNE_TRANSIZIONE)
    .eq('id', id.data)
    .maybeSingle();
  if (error) return { ok: false, status: 500 };
  if (!data) return { ok: false, status: 404 };
  const riga = data as RigaTransizione;
  if (comeStato(riga.status) !== 'chosen') return { ok: false, status: 409 };

  // Il documento in tabella e stato scritto da `chooseVariant`, cioe e gia passato dal
  // gate. Se non validasse piu (scrittura da fuori queste azioni, o un gate che si e
  // stretto nel frattempo) non c'e nulla da estendere in modo coerente: 500, e la riga
  // resta dov'e. Rifiutare e l'unica risposta onesta — costruire sopra un documento che
  // il gate non riconosce e esattamente il documento incoerente che questo task esiste
  // per impedire.
  const corrente = parseDocument(riga.document);
  if (!corrente.ok) return { ok: false, status: 500 };

  const esteso = { ...corrente.document, pages: [...corrente.document.pages, ...pages] };
  const parsed = parseDocument(esteso);
  if (!parsed.ok) return { ok: false, status: 400 };

  // IL TETTO DELLA RIGA (decisione (j)): `DOCUMENT_LIMITS.max_pages` e il tetto di
  // SICUREZZA globale, `max_pages` e quello di QUESTA generazione — il giunto verso il
  // piano di P5. Imporlo dove si SCRIVE e cio che gli impedisce di essere decorativo.
  if (parsed.document.pages.length > riga.max_pages) return { ok: false, status: 400 };

  // LA HOME UNICA NON SI DISFA IN FASE 2 (decisione (i)): stessa funzione e stessa
  // costante che usa `chooseVariant`. `parseDocument` non lo controlla, e non deve.
  if (quanteHome(parsed.document.pages) !== 1) return { ok: false, status: 400 };

  // `final` DEFAULT true: un append a 2 argomenti (T-204) chiude la generazione, come prima.
  // `final: false` la lascia 'chosen' per il chunk successivo (P2-D32). Lo stato di ARRIVO
  // cambia; il CAS di PARTENZA resta 'chosen' in entrambi i casi.
  const nuovoStato: GenerationStatus = opts.final ?? true ? 'complete' : 'chosen';

  // Lo stato di ARRIVO cambia (`nuovoStato`), il CAS di PARTENZA resta 'chosen' in entrambi i casi:
  // corpo CAS condiviso (eseguiCas), col solo `patch` proprio dell'append.
  return eseguiCas(
    supabase,
    id.data,
    { status: nuovoStato, document: parsed.document },
    'chosen',
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// T-230 — LE DUE TRANSIZIONI DELLA FASE 1, chiamate dalla rotta POST /api/generate.
// La macchina a stati di P2-D13 non aveva alcuna transizione 'generating' → 'ready':
// `createGeneration` apre la riga a 'generating' e `chooseVariant` la porta da 'ready' a
// 'chosen', ma il passo intermedio — la fase 1 ha prodotto il pool CONDIVISO, le cinque
// varianti sono pronte da mostrare — non esisteva. Le due azioni qui lo aggiungono, e sono
// entrambe COMPARE-AND-SET da 'generating': lo stato di partenza e' il FILTRO dell'UPDATE
// (decisione (f) del blocco T-204), valutato dal DB nello stesso istante della scrittura,
// cosi' due richieste concorrenti non transizionano entrambe. Zero righe toccate → una
// lettura mirata (`assenteOppureConflitto`) distingue il 409 (c'e', ma in un altro stato)
// dal 404 (non c'e', o non e' visibile a questa identita': nessun oracolo di enumerazione).
//
// SONO IL DOPPIO ESITO DELL'ORDINE DURABILE della rotta (P2-D15, meta' 'route' di AC-230-7):
// createGeneration('generating') PRIMA della chiamata al confine → confine → writePool del
// pool condiviso → `markReady`. Se il confine FALLISCE o writePool fallisce, la rotta chiama
// `markFailed` invece: la riga non resta MAI 'generating' in modo incoerente. La meta'
// mancante — il processo che muore senza che nessun `finally` giri — la copre la
// riconciliazione in lettura di sopra (`getGeneration`), che porta a 'failed' una riga
// 'generating' stantia.
//
// `updated_at` E' IMPOSTO DA ENTRAMBE (invariante di decisione (1) in testa al modulo):
// senza il tocco la riga invecchierebbe e la riconciliazione la ucciderebbe da viva.

/**
 * IL VOCABOLARIO DEI MOTIVI DI FALLIMENTO scrivibili in `failure_reason` dalla rotta di
 * fase 1. E' un insieme CHIUSO e nostro (P2-D20): `failure_reason` e' una colonna che
 * qualcuno logghera', quindi non vi si interpola input non fidato — il motivo arriva sempre
 * da qui, non dal modello. I primi quattro RISPECCHIANO gli esiti nominati di
 * `runGenerationTurn` (T-224): sono duplicati come stringhe letterali di proposito, perche'
 * `markFailed` DEVE validare il proprio input (e' una server action) e l'unico modo di
 * rifiutare un motivo inventato prima del DB e' confrontarlo con un elenco che vive qui.
 */
const FAILURE_REASONS = [
  // esiti nominati del confine (T-224): il tetto di uscita sfondato, la tool-call assente,
  // uno stop_reason anomalo, il pool fuori contratto.
  'risposta_troncata',
  'tool_use_assente',
  'stop_reason_anomalo',
  'pool_non_valido',
  // il confine ha LANCIATO invece di ritornare un esito (rete, SDK).
  'confine_in_errore',
  // il confine ha prodotto un pool valido, ma la sua scrittura non e' riuscita.
  'pool_non_scritto',
  // il pool e' stato scritto, ma la transizione durabile 'generating'->'ready' e' andata PERSA:
  // la finestra P2-D15 ha riconciliato la riga a 'failed' durante la lunga chiamata al confine,
  // oppure l'UPDATE ha fallito. La generazione NON e' viva, quindi la rotta lo dice al client
  // con 'error' e non con un 'pool' di successo — simmetrico a 'pool_non_scritto'.
  'ready_non_scritto',
  // FASE 2 (T-234): un chunk delle pagine interne e' tornato TRONCATO dal confine. E' il
  // motivo con cui `failGenerationPhase2` chiude una fase 2 morta a meta' (AC-234-3), e sta
  // qui — non altrove — perche' `failure_reason` e' una colonna nostra e chiusa (P2-D20).
  'fase2_troncata',
] as const;

/** I motivi ammessi per `markFailed`. Derivato dall'elenco, mai riscritto. */
export type GenerationFailureReason = (typeof FAILURE_REASONS)[number];

const failureReasonSchema = z.enum(FAILURE_REASONS);

/**
 * 'generating' → 'ready'. La fase 1 ha scritto il pool CONDIVISO e le cinque varianti sono
 * pronte da mostrare. CAS da 'generating': una partenza diversa e' un 409 e NON modifica la
 * riga. `updated_at` e' toccato (prova di vita, decisione (1)).
 */
export async function markReady(generationId: string): Promise<TransitionResult> {
  const ctx = await beginTransition(generationId);
  if (!ctx.ok) return ctx;
  const { supabase, id } = ctx;

  // CAS da 'generating' (il vincolo di partenza, decisione (f)): corpo condiviso `eseguiCas`.
  return eseguiCas(supabase, id.data, { status: 'ready' }, 'generating');
}

/**
 * 'generating' → 'failed' con un `failure_reason` NOMINATO. La chiama la rotta quando il
 * confine fallisce o writePool non riesce, cosi' la riga non resta 'generating' in modo
 * incoerente (AC-230-7). CAS da 'generating' come `markReady`; il motivo e' validato contro
 * il vocabolario chiuso `FAILURE_REASONS` PRIMA del DB (nessun input non fidato in
 * `failure_reason`, P2-D20). `updated_at` e' toccato.
 */
/**
 * IL FALLIMENTO NOMINATO di una generazione: 'X' → 'failed' con `failure_reason` validato contro
 * il vocabolario chiuso `FAILURE_REASONS` PRIMA del DB (nessun input non fidato in `failure_reason`,
 * P2-D20). Lo stato di PARTENZA e' un PARAMETRO: `markFailed` (da 'generating') e
 * `failGenerationPhase2` (da 'chosen') sono la STESSA transizione con partenze diverse, quindi
 * delegano qui invece di ripeterla. NON tocca `document` (non e' nel patch): le pagine gia'
 * scritte restano dov'erano.
 */
async function failGeneration(
  generationId: string,
  reason: GenerationFailureReason,
  fromStatus: GenerationStatus,
): Promise<TransitionResult> {
  const ctx = await beginTransition(generationId);
  if (!ctx.ok) return ctx;

  const motivo = failureReasonSchema.safeParse(reason);
  if (!motivo.success) return { ok: false, status: 400 };

  return eseguiCas(
    ctx.supabase,
    ctx.id.data,
    { status: 'failed', failure_reason: motivo.data },
    fromStatus,
  );
}

export async function markFailed(
  generationId: string,
  reason: GenerationFailureReason,
): Promise<TransitionResult> {
  // CAS da 'generating': la riga non resta 'generating' in modo incoerente (AC-230-7).
  return failGeneration(generationId, reason, 'generating');
}

// ─────────────────────────────────────────────────────────────────────────────
// T-234 — IL FALLIMENTO DELLA FASE 2. Simmetrica a `markFailed`, ma la CAS parte da
// 'chosen' e non da 'generating': la fase 2 gira su una generazione GIA' scelta, e un suo
// chunk troncato deve chiuderla a 'failed' SENZA toccare il documento gia' persistito — la
// home piu' i chunk riusciti restano, e la generazione NON dichiara mai 'complete' (AC-234-3,
// "onesta' dello stato"). E' l'altra meta' di `appendPages({final:false})`: quella estende e
// tiene aperto, questa chiude in errore. `failure_reason` e' NOMINATO e validato contro il
// vocabolario chiuso `FAILURE_REASONS` prima del DB (nessun input non fidato, P2-D20).

/**
 * 'chosen' → 'failed' con un `failure_reason` NOMINATO. La chiama l'azione di fase 2 (T-234)
 * quando un chunk delle pagine interne non produce un pool (troncamento o altro esito
 * terminale del confine). CAS da 'chosen': una partenza diversa e' un 409 e NON modifica la
 * riga. NON tocca `document`: le pagine gia' scritte restano dov'erano.
 */
export async function failGenerationPhase2(
  generationId: string,
  reason: GenerationFailureReason,
): Promise<TransitionResult> {
  // CAS da 'chosen' (non 'generating'): e' la fase 2 che fallisce; `document` resta intatto.
  return failGeneration(generationId, reason, 'chosen');
}
