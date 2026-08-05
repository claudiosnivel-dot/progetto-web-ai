'use server';

import { hasLocale } from 'next-intl';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readHomePools } from '@/data/generation-pools';
import { loadOwnBrief, loadOwnGeneration } from '@/data/generation-action-reads';
import { chooseVariant, type GenerationStatus } from '@/data/generations';
import { createServerSupabaseClient } from '@/data/supabase-ssr';
import { parseDocument } from '@/domain/generation/document';
import { RECIPES } from '@/domain/generation/recipes';
import { routing } from '@/i18n/routing';
import { poolForVariant, resolveVariantHome } from '@/domain/generation/variant-document';

// T-233 (macrotask generation-ui, P2) — SCEGLI & CONGELA. L'azione con cui l'utente ferma UNA
// delle cinque direzioni: costruisce il documento della SOLA home dalla variante scelta
// (`resolveVariantHome`, lo STESSO compositore delle card di T-232 — mai un secondo renderer),
// registra `chosen_variant`, porta la generazione a 'chosen' e reindirizza all'anteprima, dove
// la home e' subito visibile.
//
// PERCHE' SI CONGELA — L'INTEGRITA' DELL'ARTEFATTO DEL CLIENTE (security_note di AC-233-6). Il
// documento e' l'artefatto che P3 modifichera' e P4 pubblichera': una volta scelto, e' DATO e
// non si ricalcola piu' dalla ricetta. Se restasse derivato, migliorare una ricetta cambierebbe
// il sito di un cliente pagante senza che nessuno lo abbia chiesto — per questo l'anteprima
// (T-235) rende dal DOCUMENTO e non dal pool, e per questo qui il documento si SCRIVE, non si
// tiene come funzione. `resolve` registra gia' gli id VERSIONATI di ricetta e tema (T-214,
// AC-233-2), che sono cio' che a P3 dice con quale versione un sito e' stato generato.
//
// TRE MOMENTI DELLA MACCHINA A STATI, e la differenza fra loro e' il costo:
//  - da 'ready': la PRIMA scelta. Usa `chooseVariant` (T-204, CAS ready->chosen) — la scrittura
//    che gia' esiste, pretende il pool della variante e congela la sola home. Qui non si
//    reinventa quella transizione: la si chiama.
//  - da 'chosen' (riscelta PRIMA della fase 2): il documento e' ancora la sola home, quindi
//    ricomporlo dalla nuova variante e' PURO — ZERO chiamate al confine (P2-D3, AC-233-3). E' la
//    riscelta libera e gratuita: si SOSTITUISCE il documento e si aggiorna `chosen_variant`, la
//    generazione resta 'chosen'. `chooseVariant` (T-204) e' CAS ready->chosen e non copre questo
//    passo: la riscelta in 'chosen' ha percio' un percorso DEDICATO (`applyRechoose`).
//  - da 'complete' (riscelta DOPO la fase 2): rifare la scelta significa rifare la fase 2, cioe'
//    un COSTO REALE in chiamate al modello. Non puo' essere un gesto silenzioso (security_note di
//    AC-233-4): senza una conferma ESPLICITA l'azione NON procede. Solo con la conferma la
//    generazione torna a 'chosen' con la sola home della nuova variante — lo stato da cui la fase
//    2 (T-234) verra' rifatta.
//
// SCADENZA DICHIARATA (security_note): quando P3 esistera', riscegliere DISTRUGGERA' le modifiche
// dell'utente all'editor. E' una decisione di P3 e una guardia di P3 (out_of_scope qui), ma e'
// registrata qui perche' non ce ne accorgiamo dopo: la conferma di AC-233-4 copre oggi il costo
// in chiamate, non ancora la perdita di lavoro editoriale.
//
// Sicurezza (OWASP 2025):
//  - A01:2025 — nessuna transizione poggia sul codice applicativo per l'isolamento cross-tenant:
//    ogni scrittura passa dal client con SESSIONE (RLS `is_account_member`), MAI la service_role
//    (R7). `chosen_variant`/`document` non arrivano da un account_id del client; il site_id e la
//    generazione sono visibili solo se appartengono all'utente, e un id altrui filtra a insieme
//    vuoto (getGeneration/readHomePools). L'indice di variante e' validato PRIMA di qualunque
//    round-trip.
//  - La destinazione dell'anteprima NON interpola il locale grezzo del path (difetto T-102/T-153):
//    passa dall'allowlist di routing, e il site_id e' codificato. Nessun testo del brief finisce
//    in un href.
//  - A05:2025 — cio' che si scrive e' la COPIA validata da `parseDocument`, mai l'input: il
//    documento e' input non fidato (incorpora la prosa del modello e i dati del brief) e non
//    raggiunge la colonna jsonb OPACA senza passare dal gate. E' la stessa disciplina di T-204.

/**
 * L'esito NEGATIVO della scelta. Il successo non ha forma: reindirizza (non ritorna). I motivi
 * sono NOMINATI e distinti perche' dicono a chi chiama cose diverse — 'conferma_richiesta' e' la
 * riscelta dopo la fase 2 che attende un si' esplicito (AC-233-4), 'indice_non_valido' e' l'indice
 * fuori 0..4 (AC-233-5), 'conflitto' e' una transizione non ammessa dallo stato corrente.
 */
export type SelectVariantResult = {
  ok: false;
  reason:
    | 'indice_non_valido'
    | 'non_autorizzato'
    | 'generazione_assente'
    | 'generazione_non_leggibile'
    | 'brief_non_leggibile'
    | 'brief_assente'
    | 'pool_non_leggibile'
    | 'documento_non_valido'
    | 'conferma_richiesta'
    | 'stato_non_valido'
    | 'conflitto'
    | 'non_scritto';
};

/**
 * Il dominio degli indici di variante e' quello del CATALOGO delle direzioni, non un 5 a mano:
 * una variante per ogni ricetta (P2-D13), e `resolveVariantHome` piu' sotto indicizza
 * `RECIPES[index]`. DERIVATO da `RECIPES.length` proprio perche' e' quell'array a essere
 * indicizzato: uno slegato dal catalogo si romperebbe da entrambi i lati — un massimo troppo
 * piccolo lascerebbe l'ULTIMA direzione non scegliibile, uno troppo grande ammetterebbe un indice
 * che punta a `RECIPES[length]` inesistente e fa lanciare `resolveVariantHome`. Oggi vale 5,
 * quindi resta lo stesso dominio del CHECK di T-200 e di `chooseVariant`; se il catalogo cambia,
 * il dominio lo segue senza che nessuno debba ricordarsi di questa riga.
 */
const VARIANTI_MOCKUP = RECIPES.length;

// L'indice di variante e' input come ogni altro: validato PRIMA di leggere brief, pool o stato,
// cosi' un indice fuori dal dominio del catalogo non costa alcun round-trip e non puo' toccare
// `chosen_variant`.
const variantIndexSchema = z.number().int().min(0).max(VARIANTI_MOCKUP - 1);

// Il ruolo della home, per contare le pagine home del documento congelato: la fase 1 congela la
// SOLA home (P2-D13), e la riscelta la SOSTITUISCE con un'altra sola home — mai un documento
// multi-pagina, che salterebbe la fase 2.
const RUOLO_HOME = 'home';

// Gli stati da cui una RISCELTA (documento gia' scritto) puo' ricongelare la home: 'chosen'
// (prima della fase 2) e 'complete' (dopo, solo con conferma). E' il verso della decisione (f) di
// T-204 portato qui: lo stato di partenza e' il FILTRO del CAS, mai un controllo-poi-scrivi.
type StatoRiscelta = Extract<GenerationStatus, 'chosen' | 'complete'>;

/**
 * LA RISCELTA COME COMPARE-AND-SET verso 'chosen'. Ricongela il documento della home e aggiorna
 * `chosen_variant`, ripartendo dallo stato ESATTO che il chiamante ha letto (`fromStatus`): se la
 * generazione e' avanzata nel frattempo (la fase 2 ha concluso mentre eravamo in 'chosen'), il
 * CAS tocca 0 righe e non ricongela nulla — cosi' una riscelta letta come gratuita non puo'
 * diventare un reset silenzioso di un sito gia' completo (la finestra TOCTOU sulla conferma di
 * AC-233-4). E' PRIVATA: non e' una server action indipendente, quindi `fromStatus` non arriva
 * mai da un client — lo deriva l'orchestratore da `getGeneration`.
 *
 * Cio' che si scrive e' `parsed.document`, la COPIA di `parseDocument`, mai l'input (A05:2025). La
 * home unica e' ri-verificata qui come in `chooseVariant` (T-204, decisione (i)): stessa
 * invariante, cosi' una riscelta non puo' congelare un documento che salta la fase 2.
 *
 * T-310 / FX-CHOOSE(D3) — RISCELTA SOFT NON DISTRUTTIVA. `site_generations.document` e' la baseline
 * CONGELATA (P3-D9); introdotto l'editing (site_document_revisions, T-301/T-302) il documento
 * CORRENTE e' l'ULTIMA revisione (read-path T-304), NON la baseline. Percio' la riscelta dall'EDITOR
 * (`snapshot`) NON sovrascrive la baseline — la renderebbe solo fresca ma SCHERMATA da una revisione
 * 'edited' precedente, e un insert della 'rechosen' poi fallito lascerebbe uno stato mezzo-cambiato
 * (baseline fresca e invisibile, contro P3-D9) — e appende invece, dopo il CAS, una revisione
 * `source='rechosen'` dal documento fresco (seq = max+1): diventa il corrente, mentre le 'edited'
 * precedenti restano LEGGIBILI in storia (append-only, mai mutate ne eliminate — ripristinabili da
 * T-318). Con `snapshot=false` (la riscelta del selettore pre-editing, T-233) non c'e' lavoro
 * editoriale da preservare e non esistono revisioni: la baseline E' il documento corrente, quindi il
 * CAS la congela col nuovo documento (semantica P2 invariata) e resta PURO, zero I/O sulle revisioni.
 * account_id NON arriva dal client: e' DERIVATO dalla riga aggiornata sotto RLS, cosi' la WITH CHECK
 * e la FK composita della tabella vedono solo l'account proprio.
 */
async function applyRechoose(
  generationId: string,
  index: number,
  document: unknown,
  fromStatus: StatoRiscelta,
  snapshot: boolean,
): Promise<{ ok: true } | { ok: false; status: 400 | 401 | 409 | 500 }> {
  const supabase: SupabaseClient = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401 };

  // NIENTE E' SCRITTO GREZZO: il documento arriva gia' da `resolveVariantHome` (che passa da
  // `parseDocument`), ma la scrittura scrive comunque la copia validata — la stessa disciplina
  // con cui T-204 non fida dell'ingresso. Il gate e l'invariante home-unica valgono per ENTRAMBI
  // gli esiti (baseline e revisione 'rechosen'): cio' che raggiunge il jsonb e' sempre
  // `parsed.document`, mai `document` grezzo (security_note di T-310).
  const parsed = parseDocument(document);
  if (!parsed.ok) return { ok: false, status: 400 };
  const pagine = parsed.document.pages;
  if (pagine.length !== 1 || pagine.filter((p) => p.role === RUOLO_HOME).length !== 1) {
    return { ok: false, status: 400 };
  }

  // FX-CHOOSE(D3) / P3-D9 — `document` ENTRA nel CAS solo per la riscelta del SELETTORE
  // pre-editing (`snapshot=false`): li' non ci sono revisioni, la baseline E' il documento
  // corrente e va congelata col nuovo documento (semantica P2 invariata; i test P2 pretendono
  // `payload.document`). La riscelta dall'EDITOR (`snapshot=true`) NON tocca la baseline congelata
  // (P3-D9): il design fresco viaggia per la SOLA revisione 'rechosen' (read-path T-304), cosi' un
  // fallimento parziale dopo il CAS non lascia mai una baseline fresca ma schermata.
  const casPayload: Record<string, unknown> = {
    status: 'chosen',
    chosen_variant: index,
    updated_at: new Date().toISOString(),
  };
  if (!snapshot) casPayload.document = parsed.document;

  // ORDINE — il CAS resta il PRIMO e unico gate atomico. Anticipare la revisione 'rechosen'
  // significherebbe o derivare l'account_id da una lettura fuori dal CAS (una lettura-poi-scrittura
  // che RIAPRE la finestra TOCTOU che il CAS `.eq(status, fromStatus)` chiude, contro il
  // security_note) o appenderla su un CAS che poi tocca 0 righe (un RESET SILENZIOSO di un sito
  // avanzato, vietato da AC-310-3). Percio' il CAS aggancia PRIMA la riga (account_id + guardia di
  // conflitto), e SOLO allora si appende la revisione.
  const { data, error } = await supabase
    .from('site_generations')
    .update(casPayload)
    .eq('id', generationId)
    // IL VINCOLO DI PARTENZA, valutato dal DB insieme alla scrittura (decisione (f) di T-204):
    // ESATTAMENTE lo stato letto, non un insieme, cosi' la conferma non e' aggirabile per corsa.
    .eq('status', fromStatus)
    // account_id: DERIVATO dalla riga (sotto RLS) per l'eventuale snapshot rechosen — mai dal client.
    .select('id, account_id');
  if (error) return { ok: false, status: 500 };
  if (!data || data.length === 0) return { ok: false, status: 409 };

  // Solo la riscelta dall'EDITOR appende la revisione 'rechosen' (non distruttiva): la riscelta del
  // selettore pre-editing non ha revisioni e resta un CAS puro. La baseline congelata NON e' stata
  // toccata (P3-D9); un guasto qui e' un errore riconoscibile che lascia il read-path sull'ultima
  // revisione REALE dell'utente, mai un reset silenzioso ne una baseline fantasma.
  if (snapshot) {
    const { account_id: accountId } = data[0] as { account_id: string };
    return snapshotRechosen(supabase, generationId, accountId, parsed.document);
  }
  return { ok: true };
}

/**
 * APPENDE una revisione `source='rechosen'` del documento fresco alla storia della generazione, cosi'
 * il design riscelto diventa il CORRENTE (read-path "ultima revisione else baseline", T-304) SENZA
 * distruggere le revisioni 'edited' precedenti (tabella append-only, T-301). E' la STESSA disciplina
 * di `saveRevision` (T-302): seq = max(seq)+1 letto sotto RLS, e lo UNIQUE (site_generation_id, seq)
 * a rendere la corsa sicura — due scritture concorrenti che calcolano lo stesso seq collidono e la
 * perdente prende 23505 (409). Il documento e' la COPIA gia' validata da `parseDocument` a monte
 * (mai l'input); `source` e' fissato a 'rechosen', account_id DERIVATO dalla riga della generazione.
 */
async function snapshotRechosen(
  supabase: SupabaseClient,
  siteGenerationId: string,
  accountId: string,
  document: unknown,
): Promise<{ ok: true } | { ok: false; status: 409 | 500 }> {
  const { data: ultima, error: seqErr } = await supabase
    .from('site_document_revisions')
    .select('seq')
    .eq('site_generation_id', siteGenerationId)
    .order('seq', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (seqErr) return { ok: false, status: 500 };
  const seq = (ultima ? Number((ultima as { seq: number | string }).seq) : 0) + 1;

  const { error: insErr } = await supabase.from('site_document_revisions').insert({
    account_id: accountId,
    site_generation_id: siteGenerationId,
    source: 'rechosen',
    seq,
    document,
  });
  // 23505 = corsa persa sullo UNIQUE (un altro save ha preso questo seq): conflitto, non guasto.
  if (insErr) return { ok: false, status: (insErr as { code?: string }).code === '23505' ? 409 : 500 };
  return { ok: true };
}

/**
 * SCEGLIE E CONGELA la variante `variantIndex` di una generazione, poi reindirizza all'anteprima.
 *
 * Ricompone il documento della SOLA home dalla variante scelta (puro, T-232) e lo congela con la
 * transizione adatta allo stato corrente (vedi l'intestazione). ZERO chiamate al confine: la
 * ricomposizione e' pura (P2-D3), e questa azione non importa nemmeno il modello.
 *
 * @param input `siteId` per leggere brief e stato (RLS), `generationId` per la scrittura, `locale`
 *   per la destinazione (allowlist, mai grezzo), `variantIndex` 0..4, `confirm` per la riscelta
 *   dopo la fase 2 (AC-233-4), `fromEditor` per la RISCELTA SOFT NON DISTRUTTIVA (T-310): quando la
 *   riscelta parte dall'editor (dove il lavoro editoriale vive come revisioni), appende una
 *   revisione `source='rechosen'` dal design fresco cosi' che diventi il documento corrente lasciando
 *   leggibili in storia le 'edited' precedenti. Assente per il selettore pre-editing (T-233), dove
 *   non ci sono revisioni e il CAS resta puro. Gli id e il locale sono derivati server-side, non dal
 *   browser; `fromEditor` non e' un confine di sicurezza (lo snapshot e' server-composto, validato da
 *   `parseDocument` e scritto sotto RLS): al piu' decide SE appendere la revisione.
 */
export async function selectVariant(input: {
  readonly siteId: string;
  readonly generationId: string;
  readonly locale: string;
  readonly variantIndex: number;
  readonly confirm?: boolean;
  readonly fromEditor?: boolean;
}): Promise<SelectVariantResult> {
  // AC-233-5: indice fuori 0..4 respinto PRIMA di ogni round-trip; `chosen_variant` resta intatto
  // perche' nessuna scrittura parte.
  const variante = variantIndexSchema.safeParse(input.variantIndex);
  if (!variante.success) return { ok: false, reason: 'indice_non_valido' };
  const index = variante.data;

  // LO STATO CORRENTE, dalla lettura AUTOREVOLE condivisa (loadOwnGeneration -> getGeneration, che
  // applica la riconciliazione di P2-D15). Un id di un altro tenant filtra a null:
  // 'generazione_assente', mai un errore che riveli l'esistenza altrui.
  const gen = await loadOwnGeneration(input.siteId, input.generationId, 'generazione_assente');
  if (!gen.ok) return gen;
  const status = gen.generation.status;

  // IL BRIEF: un GUASTO di lettura non e' un brief assente (P2-D16). Serve a ricomporre la home.
  const briefResult = await loadOwnBrief(input.siteId);
  if (!briefResult.ok) return briefResult;

  // I POOL 'home' della generazione, in UNA lettura (T-232): la copia-su-scrittura di P2-D3 sceglie
  // il pool proprio della variante o quello condiviso.
  const pools = await readHomePools(input.generationId);
  if (!pools.ok) {
    return { ok: false, reason: pools.status === 401 ? 'non_autorizzato' : 'pool_non_leggibile' };
  }

  // IL DOCUMENTO DELLA SOLA HOME, dallo STESSO compositore delle card (resolveVariantHome): resolve
  // sul solo homeSpec + parseDocument. `null` = tema assente o documento non valido (pool troppo
  // incompleto per la home): non si congela un albero non validato.
  const resolved = resolveVariantHome(
    poolForVariant({ shared: pools.shared, byVariant: pools.byVariant }, index),
    RECIPES[index],
    briefResult.brief,
  );
  if (resolved === null) return { ok: false, reason: 'documento_non_valido' };

  // LA DESTINAZIONE: locale dall'ALLOWLIST (mai il grezzo, difetto T-102/T-153) e site_id
  // codificato. Costruita da noi, nessun testo del brief.
  const locale = hasLocale(routing.locales, input.locale) ? input.locale : routing.defaultLocale;
  const previewPath = `/${locale}/preview/${encodeURIComponent(input.siteId)}`;

  // T-310: la riscelta dall'EDITOR e' non distruttiva — appende una revisione 'rechosen'. Quella del
  // selettore pre-editing (T-233) no: nessuna revisione da preservare, il CAS resta puro.
  const snapshot = input.fromEditor === true;

  if (status === 'ready') {
    // LA PRIMA SCELTA: la transizione che gia' esiste (T-204, CAS ready->chosen). Pretende il pool
    // e congela la sola home.
    const written = await chooseVariant(input.generationId, index, resolved.document);
    if (!written.ok) return { ok: false, reason: esitoTransizione(written.status) };
    return redirect(previewPath);
  }

  if (status === 'chosen') {
    // RISCELTA PRIMA DELLA FASE 2 (AC-233-3): pura, ZERO confine. Si sostituisce il documento; se la
    // riscelta viene dall'editor, si appende anche la revisione 'rechosen' (T-310).
    const written = await applyRechoose(input.generationId, index, resolved.document, 'chosen', snapshot);
    if (!written.ok) return { ok: false, reason: esitoTransizione(written.status) };
    return redirect(previewPath);
  }

  if (status === 'complete') {
    // RISCELTA DOPO LA FASE 2 (AC-233-4): rifara' la fase 2, cioe' un costo. Senza conferma
    // ESPLICITA l'azione non procede e NON scrive nulla.
    if (input.confirm !== true) return { ok: false, reason: 'conferma_richiesta' };
    // Con la conferma: la generazione torna a 'chosen' con la sola home della nuova variante — lo
    // stato da cui la fase 2 (T-234) verra' rifatta. La rimessa in moto della fase 2 e' di T-234. Dal
    // l'editor la riscelta e' non distruttiva: si appende la revisione 'rechosen' (T-310).
    const written = await applyRechoose(input.generationId, index, resolved.document, 'complete', snapshot);
    if (!written.ok) return { ok: false, reason: esitoTransizione(written.status) };
    return redirect(previewPath);
  }

  // 'generating' / 'failed': non c'e' nulla da scegliere finche' le cinque varianti non sono
  // pronte (o la generazione non e' stata ritentata). Rifiuto riconoscibile, nessuna scrittura.
  return { ok: false, reason: 'stato_non_valido' };
}

/**
 * Traduce lo status di una transizione (T-204/qui) nel motivo NOMINATO dell'azione: 401 e' la
 * sessione assente, 409 una transizione non ammessa dallo stato corrente, 404 la generazione
 * sparita, 400 un documento che il gate rifiuta (non dovrebbe accadere: `resolveVariantHome` lo ha
 * gia' validato), 500 una scrittura non riuscita.
 */
function esitoTransizione(status: 400 | 401 | 404 | 409 | 500): SelectVariantResult['reason'] {
  switch (status) {
    case 401:
      return 'non_autorizzato';
    case 404:
      return 'generazione_assente';
    case 409:
      return 'conflitto';
    case 400:
      return 'documento_non_valido';
    default:
      return 'non_scritto';
  }
}
