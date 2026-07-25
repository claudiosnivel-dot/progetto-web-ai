import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/data/supabase-ssr';
import { listSites } from '@/data/sites';
import { getBrief, upsertBrief } from '@/data/briefs';
import { runInterviewTurn } from '@/domain/onboarding/interview';
import { emptyBrief, type Brief } from '@/domain/onboarding/brief';
import { routing } from '@/i18n/routing';

// T-150 (macrotask onboarding-ui, P1) — endpoint di UN turno della chat di
// onboarding: same-origin -> identita' -> proprieta' del sito -> tetto sui byte del
// body -> validazione del body -> getBrief -> runInterviewTurn -> flush del testo ->
// upsertBrief -> flush del brief.
//
// PERCHE' sotto /api e NON sotto /[locale]: il matcher del middleware esclude /api
// del tutto, quindi nessun rewrite di locale next-intl interferisce con una POST, e un
// endpoint chiamato via fetch puo' rispondere 401 JSON invece di un 307 verso il
// login (che per un fetch sarebbe illeggibile). Il locale non serve nell'URL: viene
// dal BRIEF (un sito = una lingua, T-121).
//
// Sicurezza (OWASP 2025):
//  - A01:2025 (CSRF). Un route handler custom NON eredita il controllo d'origine che
//    Next applica alle Server Action, e i cookie Supabase sono SameSite=Lax: una POST
//    cross-site partirebbe autenticata. Per un endpoint che MUTA STATO la same-origin
//    va quindi verificata ESPLICITAMENTE, con DUE gate entrambi fail-CLOSED
//    (`Sec-Fetch-Site` PRETESO uguale a 'same-origin', poi `Origin`) → 403 se uno dei
//    due non combacia. Difesa in profondita'.
//  - A05:2025 (dimensione). Il tetto sui byte del body (MAX_BODY_BYTES) sta PRIMA della
//    lettura del corpo: senza, `await request.json()` materializza in memoria qualunque
//    cosa il client spedisca prima che zod possa rifiutarla.
//  - A01:2025 (cross-tenant, P1-D21). getBrief ritorna brief:null sia per "sito mio
//    senza brief" sia per "sito di un altro tenant" (filtrato dalla RLS): null non
//    distingue i due casi e non puo' fare da gate. La proprieta' si accerta con
//    listSites, RLS-backed; un siteId che non e' fra i propri siti riceve la STESSA
//    risposta di un sito inesistente (404), cosi' l'endpoint non diventa un oracolo di
//    enumerazione (stessa logica di P1-D16).
//  - A05:2025 (validation). Il body arriva dal BROWSER: input NON FIDATO. Schema
//    strict con cap su numero e lunghezza dei turni; l'update del brief e' ri-validato
//    a valle da upsertBrief (T-123) e dall'orchestrazione (T-132).
//  - A07/A02:2025 (segreti). La chiave Anthropic resta dietro il confine server-only
//    (T-131), raggiunto solo via src/domain: nulla di segreto attraversa questa rotta.
//  - R7. Nessuna service_role: getBrief/upsertBrief/listSites usano il client con
//    sessione (RLS attiva).

// P1-D22 (attuazione concreta del cap che P1-D19 impone) — tetti sulla history, che
// arriva dal browser ed e' input non fidato. Senza
// tetto un client ostile spedisce megabyte di finti turni assistente, che finiscono
// nel prompt (e nel costo) del modello. 40 turni ≈ 20 scambi: oltre, un'intervista di
// onboarding non va. 4000 code unit per turno ≈ 1000 token, abbondanti per una
// risposta d'intervista e sopra il piu' lungo campo che un turno puo' trasportare
// (description, tetto 2000 in BRIEF_LIMITS).
//
// COSTO DI UNA SOLA RICHIESTA, dichiarato qui perche' e' cio' che questi due numeri
// AMMETTONO, non cio' che impediscono: una POST valida al massimo porta al modello
// 40x4000 + 4000 = 164.000 code unit di input (~41.000 token), e il client SDK usa
// `maxRetries` di default 2 (@anthropic-ai/sdk 0.115.0), quindi fino a 3 chiamate
// upstream per UNA POST. Nulla qui limita la FREQUENZA: il singolo turno e' limitato, la
// raffica no (P1-D22, fuori dallo scope di T-150).
const MAX_HISTORY_TURNS = 40;
const MAX_TURN_CHARS = 4000;

// Tetto sui BYTE del body, applicato PRIMA di leggere il corpo. PERCHE' serve: i cap
// sopra li impone zod, ma zod vede il body solo DOPO `await request.json()`, che lo
// materializza tutto in memoria; e un route handler NON ha il `bodySizeLimit` che Next
// applica alle Server Action. Misurato su questo endpoint: un body da 64,66 MB viene
// letto per intero e solo poi rifiutato (574 ms), cioe' il lavoro lo fa il server e il
// costo lo paga il server.
//
// Il valore e' DERIVATO dai cap di P1-D22, non scelto a caso: il piu' grande body
// LEGITTIMO e' MAX_HISTORY_TURNS turni pieni piu' lo `userMessage` pieno (da cui il
// +1), ognuno di MAX_TURN_CHARS code unit, piu' l'overhead della sintassi JSON.
//  - 6 byte per code unit: una code unit costa fino a 3 byte in UTF-8 (BMP) e fino a 6
//    se il client la manda escapata (`\uXXXX`). Concedere il caso peggiore evita che il
//    tetto in byte rifiuti un turno che i cap in code unit ammettono (accentate, CJK,
//    emoji): i due tetti misurano cose diverse e questo non deve stringere quello.
//  - 64 byte per turno: `{"role":"assistant","text":""},` sono 31 byte, arrotondati.
//  - 256 byte di involucro: `{"messages":[],"userMessage":""}` piu' margine.
// Risultato: 41 × (4000×6 + 64) + 256 = 986.880 byte (≈0,94 MB) invece di 64 MB.
const JSON_BYTES_PER_TEXT_UNIT = 6;
const JSON_BYTES_PER_TURN = 64;
const JSON_BYTES_ENVELOPE = 256;
const MAX_BODY_BYTES =
  (MAX_HISTORY_TURNS + 1) * (MAX_TURN_CHARS * JSON_BYTES_PER_TEXT_UNIT + JSON_BYTES_PER_TURN) +
  JSON_BYTES_ENVELOPE;

// P1-D19 — la history rigiocata al modello e' SOLO TESTO. Lo `.strict()` sull'oggetto
// messaggio e' il meccanismo su cui la decisione poggia: un messaggio con blocchi
// (`content: [{type:'tool_use'}]`) non e' FILTRATO, e' IRRAPPRESENTABILE. Cosi' il
// tool_result non serve mai e il 400 dell'API per tool_result mancante (04 §7 p.1) non
// e' "gestito": non puo' accadere.
//
// P1-D23 corregge la motivazione originale di P1-D19 su DUE punti, ed entrambi si
// leggono qui:
//  1. NON e' vero che "il brief e' passato a ogni turno ed e' la memoria vera": il
//     modello NON VEDE MAI il brief. Al confine arrivano SOLO tre cose: il system prompt
//     STATICO scelto per locale, i messaggi di TESTO (history + turno utente) e i tool;
//     `turn.brief` in runInterviewTurn serve solo a scegliere quel prompt e come base del
//     merge, e non entra nel payload. LIMITE CHE NE CONSEGUE: entro i 40 turni l'unica
//     memoria e' la trascrizione testuale, quindi il modello non sa quali campi sono gia'
//     compilati — ri-chiede dati che l'import da URL (T-141) o il pannello (T-151) hanno
//     gia' raccolto — e non puo' sapere cosa manca per completare il brief, che e'
//     l'obiettivo dell'intervista: `mark_ready_for_review` lo decide alla cieca. Inoltre
//     T-150 non persiste la history: al reload l'utente riparte da zero. Non risolto qui:
//     la sede e' T-132 e serve una decisione, perche' serializzare il brief nel prompt fa
//     entrare nell'intervista testo importato NON FIDATO (04 §7 p.4). Pinnato da un
//     test nell'oracolo di T-150.
//  2. L'irrappresentabilita' del 400 vale per la sola classe `tool_result`. L'API
//     pretende ANCHE che il primo messaggio sia `user`, e quel vincolo lo schema non lo
//     esprimeva: una history che inizia con `assistant` arrivava al confine e tornava
//     un 400 dell'API, che da qui sarebbe uscito come un 502 opaco. Ora e' rifiutata
//     server-side (refine sotto), dove il 400 e' onesto e non si spende un turno.
//
// TESTO NON VUOTO, alla stessa maniera nei due posti. `userMessage` e il `text` di ogni
// turno sono la STESSA classe di input (testo dal browser che finisce in `content` al
// confine) e ora hanno la stessa regola: una `content` vuota o di soli spazi non ha nulla
// da dire al modello, spende un turno e — per il primo messaggio — l'API la rifiuta.
//
// ORDINE DICHIARATO dei check: `.max()` PRIMA di `.trim()`, quindi i MAX_TURN_CHARS si
// misurano sulla stringa GREZZA, come l'ha spedita il client. E' la lettura coerente con
// P1-D22 ("4000 code unit per turno") e con MAX_BODY_BYTES, che conta byte trasmessi:
// il tetto limita cio' che il server riceve, non cio' che resta dopo la normalizzazione.
// Conseguenza voluta: 4000 caratteri con uno spazio attorno (4002 grezzi) sono rifiutati,
// non accettati-e-trimmati. `.min(1)` invece sta DOPO `.trim()`, altrimenti ' ' passerebbe.
//
// Uno SOLO schema usato nei due punti, non due catene gemelle: l'asimmetria che si sta
// correggendo (`.min(1)` su un lato e nulla sull'altro) e' nata proprio da due copie.
const TurnTextSchema = z.string().max(MAX_TURN_CHARS).trim().min(1);

const TurnRequestSchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            text: TurnTextSchema,
          })
          .strict(),
      )
      .max(MAX_HISTORY_TURNS)
      // Il primo messaggio, se la history non e' vuota, DEVE essere `user` (vincolo
      // dell'API, P1-D23 p.2). Il turno dell'utente viene appeso in coda, quindi una
      // history vuota resta valida: il payload comincia comunque con un `user`.
      //
      // Si vincola SOLO il primo ruolo, NON l'alternanza: l'API ammette turni
      // consecutivi dello stesso ruolo (li unisce), quindi rifiutarli sarebbe un
      // comportamento inventato che rompe un client legittimo — e un utente che scrive
      // due messaggi di fila prima che il modello risponda e' proprio quel caso.
      .refine((history) => history.length === 0 || history[0].role === 'user'),
    userMessage: TurnTextSchema,
  })
  .strict();

// P1-D18 — forma dei chunk NDJSON. Il chunk `error` esiste solo per i guasti che
// avvengono DOPO il primo flush, quando lo status HTTP e' gia' 200 e non c'e' altro
// canale: i guasti precedenti restano status HTTP onesti.
type TurnChunk =
  | { type: 'text'; text: string }
  | { type: 'brief'; brief: Brief; complete: boolean; readyForReview: boolean }
  | { type: 'error'; reason: string };

const encoder = new TextEncoder();

// Motivi GENERICI: nessun dettaglio interno, e la stessa risposta per "sito non tuo"
// e "sito inesistente" (P1-D21).
function jsonError(status: number, reason: string): NextResponse {
  return NextResponse.json({ error: reason }, { status });
}

// Il Brief di dominio ha `content` annidato, la patch di upsertBrief e' FLAT e strict
// (BriefUpdateSchema): senza questa conversione la scrittura tornerebbe 400. Si
// riscrive lo stato completo del brief, non un diff, perche' runInterviewTurn
// restituisce il brief FUSO e non la patch; il merge di T-122 e' idempotente sui
// campi core e per `name` sulle offerings, quindi riscrivere lo stesso stato non lo
// duplica.
function briefToUpdate(brief: Brief) {
  return {
    business_name: brief.business_name,
    vertical: brief.vertical,
    description: brief.description,
    address: brief.address,
    geo: brief.geo,
    hours: brief.hours,
    phone: brief.phone,
    whatsapp: brief.whatsapp,
    email: brief.email,
    primary_goal: brief.primary_goal,
    locale: brief.locale,
    offerings: brief.content.offerings,
    social_links: brief.content.social_links,
    highlights: brief.content.highlights,
    brand_hints: brief.content.brand_hints,
  };
}

type TurnContext = { params: Promise<{ siteId: string }> };

export async function POST(request: NextRequest, context: TurnContext): Promise<Response> {
  // 1) Same-origin (CSRF, vedi sopra), DUE gate entrambi fail-CLOSED.
  //
  //    Gate 1 — `Sec-Fetch-Site` PRETESO uguale a 'same-origin': assente → 403, non
  //    "controllalo se c'e'". Trattare l'assenza come un permesso era un fail-OPEN:
  //    bastava NON mandare l'header per scavalcare questo gate e restare col solo gate
  //    2, che poggia su un origin ricostruito. Preteso, invece, questo gate vale ANCHE
  //    se `nextUrl.origin` diverge da quello vero: e' l'unico dei due indipendente
  //    dalla ricostruzione.
  //    COSTO REALE, non nullo: i metadata Fetch non sono in ogni browser mai esistito
  //    (Chrome 76+, Firefox 90+, Safari 16.4+), quindi un browser piu' vecchio si vede
  //    rifiutare la propria chat pur essendo legittimo — prima lo copriva il gate 2. Il
  //    baratto e' accettato consapevolmente: e' un endpoint che MUTA STATO, e per la
  //    fascia di browser che manda l'header (tutti quelli in supporto) il gate diventa
  //    solido invece che aggirabile. Il solo client legittimo e' il fetch di T-151.
  if (request.headers.get('sec-fetch-site') !== 'same-origin') {
    return jsonError(403, 'forbidden');
  }
  //    Gate 2 — `Origin` confrontato con l'origin della richiesta; i browser lo inviano
  //    sempre su POST, quindi assente = 403. BASELINE NON CANONICA, limite dichiarato:
  //    `nextUrl.origin` e' l'origin che Next RICOSTRUISCE dalla richiesta (host/
  //    x-forwarded-*), non un origin configurato, quindi dietro un reverse proxy mal
  //    configurato puo' divergere da quello reale. E' il motivo per cui il gate 1 e'
  //    stato reso indipendente da esso.
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return jsonError(403, 'forbidden');
  }

  // 2) Identita' server-side VALIDATA (getUser rivalida il token), mai un flag client.
  const user = await getUser();
  if (!user) {
    return jsonError(401, 'unauthorized');
  }

  const { siteId } = await context.params;

  // 3) Proprieta' del sito (P1-D21), prima di leggere o scrivere qualunque brief.
  const sitesResult = await listSites();
  if (!sitesResult.ok) {
    return jsonError(sitesResult.status === 401 ? 401 : 500, 'unavailable');
  }
  if (!sitesResult.sites.some((site) => site.id === siteId)) {
    return jsonError(404, 'not-found');
  }

  // 4) Tetto sui BYTE del body (MAX_BODY_BYTES), PRIMA di leggerlo: e' l'unico punto in
  //    cui rifiutare costa quanto leggere un header invece che materializzare il corpo.
  //    NON COPERTO (limite dichiarato): un client che omette `Content-Length` — una POST
  //    in `Transfer-Encoding: chunked`, che nessun browser produce per un body di
  //    stringa ma un client scritto a mano si — non e' fermato da questa guardia e resta
  //    limitato dai soli cap di zod, dopo la lettura. Fermarlo davvero vorrebbe dire
  //    contare i byte mentre si consuma lo stream, che e' un'altra forma della route.
  //    Nessun `Number.isFinite` nella condizione, ed e' voluto: un header assente da'
  //    NaN e `NaN > cap` e' falso (passa, come dichiarato sopra), mentre 'Infinity'
  //    da' Infinity e `Infinity > cap` e' VERO (413). Filtrare i non-finiti prima del
  //    confronto avrebbe fatto passare proprio 'Infinity'.
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    return jsonError(413, 'payload-too-large');
  }

  // 5) Body: input NON FIDATO dal browser.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, 'invalid-body');
  }
  const parsed = TurnRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, 'invalid-body');
  }

  // 6) Stato corrente del brief (RLS). Se il brief non esiste ancora si parte da uno
  //    vuoto: il locale non e' nel body (P1-D19) e la rotta di pagina non e' in questo
  //    percorso, quindi l'unico valore disponibile e' il default del routing. Dal
  //    primo update_brief in avanti il locale del brief e' quello persistito.
  const briefResult = await getBrief(siteId);
  if (!briefResult.ok) {
    return jsonError(briefResult.status === 401 ? 401 : 500, 'unavailable');
  }
  const brief = briefResult.brief ?? emptyBrief(routing.defaultLocale);

  // 7) Il turno di intervista (T-132 → confine T-131). AWAIT PRIMA di aprire lo
  //    stream: finche' lo status HTTP e' scrivibile, un guasto del modello resta un
  //    errore onesto (502) invece di un 200 con un chunk d'errore. Nulla c'e' da
  //    flushare prima che il modello abbia risposto, quindi l'ordine di P1-D18 non
  //    cambia.
  let turn: Awaited<ReturnType<typeof runInterviewTurn>>;
  try {
    turn = await runInterviewTurn({
      messages: parsed.data.messages.map((message) => ({
        role: message.role,
        content: message.text,
      })),
      brief,
      userMessage: parsed.data.userMessage,
    });
  } catch {
    return jsonError(502, 'turn-failed');
  }

  // 8) I DUE flush ordinati (P1-D18). Lo stream e' di TRASPORTO: il confine T-131
  //    resta non-streaming. Serve a nascondere il round-trip al DB dietro la lettura
  //    della risposta, non a mostrare i token uno a uno — LIMITE DICHIARATO.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: TurnChunk) => {
        // NDJSON: una riga JSON per chunk, '\n' come separatore.
        controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
      };

      // FLUSH 1 — il testo assistente, PRIMA che la scrittura sul DB sia completata.
      // Si emette ANCHE se vuoto: con Haiku un turno di sole tool-call produce
      // assistantText vuota (§7 p.2), e il protocollo deve restare uniforme perche'
      // la UI di T-151 possa decidere cosa mostrare invece di indovinare.
      send({ type: 'text', text: turn.assistantText });

      try {
        const saved = await upsertBrief(siteId, briefToUpdate(turn.brief));
        if (saved.ok) {
          // FLUSH 2 — solo DOPO che la persistenza e' andata a buon fine: il chunk
          // `brief` afferma che il brief e' salvato, non solo calcolato.
          send({
            type: 'brief',
            brief: turn.brief,
            complete: saved.complete,
            readyForReview: turn.readyForReview,
          });
        } else {
          send({ type: 'error', reason: 'brief-not-saved' });
        }
      } catch {
        send({ type: 'error', reason: 'brief-not-saved' });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
