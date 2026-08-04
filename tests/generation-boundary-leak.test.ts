import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runGenerationTurn } from '@/data/anthropic';
import {
  PROJECTION_ALLOWLIST,
  briefProjection,
  type ProjectionProfile,
} from '@/domain/generation/projection';
import { buildPoolTool } from '@/domain/generation/tool';
import { buildGenerationPayload } from '@/domain/generation/prompt';
import { GENERATION_BUDGET } from '@/domain/generation/budget';
import {
  BriefUpdateSchema,
  applyBriefUpdate,
  emptyBrief,
  type Brief,
} from '@/domain/onboarding/brief';
import type { SlotId } from '@/domain/generation/slots';

// T-224 (macrotask generation-llm, P2) — L'ASSERZIONE ANTI-FUGA DEFINITIVA (AC-224-5).
//
// PERCHE' QUESTA E DEFINITIVA e le altre due no. T-220 guarda la PROIEZIONE e T-223 il
// PAYLOAD ASSEMBLATO: sono due intermedi, e fra ciascuno di essi e il modello resta del
// codice. Qui si guarda l'oggetto REALMENTE passato a messages.create — l'ultimo punto in
// cui una fuga e ancora osservabile da questo lato — catturandolo dal doppio del client.
// Un confine che rileggesse il brief, o che aggiungesse un campo "di comodo" ai params,
// sarebbe verde in entrambi gli altri file e rosso solo qui.
//
// LIMITE DICHIARATO, ereditato dalle security_notes di T-220 (e da P1 §6-bis p.6-bis): e un
// match per SOTTOSTRINGA su una serializzazione. Prova che QUESTO confine non perde, NON che
// nessun confine possa perdere — una fuga TRASFORMATA (base64, percent-encoding, collasso
// degli spazi) le sfuggirebbe. E fra il Brief e cio che parte non esiste barriera di TIPO:
// la promessa e tenuta da questo oracolo, non dal design.

/**
 * Il token in testa a OGNI valore fuori allowlist delle fixture. Non compare in nessun
 * valore ammesso, quindi la sua sola presenza nel payload catturato e una fuga — ed e anche
 * il PREFISSO COMUNE che l'asserzione cerca per prendere le fughe TRONCATE, quelle in cui
 * nessun marcatore INTERO comparirebbe mai.
 */
const MARCA = 'Krendaviol';

/**
 * QUANTI CARATTERI di una fuga TRONCATA questo oracolo prende, ed e' il verso opposto di
 * quello che il commento diceva prima. Il prefisso comune dei marcatori e' CALCOLATO e vale
 * 10 caratteri ('krendaviol'), perche' tutti condividono la marca intera: cercarlo INTERO
 * significa prendere le fughe troncate a 10 caratteri e lasciar passare quelle piu' corte.
 * Misurato in verifica avversariale: iniettando 'Krendav' — SETTE caratteri — nei messages
 * passati al confine, QUESTO file restava VERDE, e il rosso arrivava per caso dal confronto di
 * intattezza di un ALTRO file. Si cercano percio' i primi 6 caratteri del prefisso: il limite
 * resta (una fuga troncata a meno di 6 sfugge ancora), ma si ferma dove si ferma per una
 * ragione dichiarata — sotto i 6 il confronto comincerebbe a colpire testo legittimo e
 * l'oracolo diventerebbe rumore — invece che per il caso di quanto e' lunga la marca.
 */
const GRANULARITA_DEL_PREFISSO = 6;

/** I campi della patch del brief (T-121) che l'allowlist di P2-D4 NON ammette, derivati. */
const CAMPI_FUORI_ALLOWLIST: readonly string[] = Object.keys(BriefUpdateSchema.shape).filter(
  (campo) => !(PROJECTION_ALLOWLIST as readonly string[]).includes(campo),
);

// ---------------------------------------------------------------------------
// LE DUE FIXTURE, a RUOLI INVERTITI fra loro: cio che l'una valorizza l'altra lo lascia
// vuoto. Serve l'UNIONE delle due perche ogni campo fuori allowlist abbia un valore da
// perdere — un campo lasciato vuoto non e sorvegliato da nulla — e la copertura non e
// dichiarata a parole ma ASSERITA sotto, campo per campo, contro l'elenco derivato.
// Ogni collezione ha PIU' DI UN elemento con valori DISCORDANTI, e almeno una chiave che e
// PREFISSO di un'altra (gli orari, i social, le sezioni delle offerte): un raggruppamento o
// un dedup scritti con startsWith invece che con uguaglianza sbaglierebbero qui.

const PATCH_DA_IMPORT: Record<string, unknown> = {
  business_name: 'Pasticceria Aurora',
  vertical: 'ristorazione',
  description: 'Lievitati e torte da forno, tutte le mattine.',
  primary_goal: 'ordina',
  brand_hints: 'Pastello, tondo, luce calda.',
  highlights: ['Lievito madre dal 1998', 'Senza glutine il giovedì'],
  phone: `${MARCA}-telefono-4401`,
  email: `${MARCA}-email-4402`,
  hours: {
    [`${MARCA}-mar`]: `${MARCA} 07:00-13:30`,
    [`${MARCA}-mart`]: `${MARCA} 07:30-19:00`,
  },
  social_links: [`${MARCA}-social-alfa`, `${MARCA}-social-alfa-bis`],
  offerings: [
    {
      name: 'Cornetto vuoto',
      section: 'Colazione',
      description: `${MARCA} descrizione del cornetto`,
      price: `${MARCA} 1,40`,
      photo_ref: `${MARCA}-foto-cornetto`,
    },
    {
      name: 'Cornetto vuoto integrale',
      section: 'Colazione Salata',
      description: `${MARCA} altra descrizione`,
      price: `${MARCA} 1,80`,
      photo_ref: `${MARCA}-foto-cornetto-due`,
    },
  ],
};

const PATCH_RUOLI_INVERTITI: Record<string, unknown> = {
  business_name: 'Falegnameria Dodici',
  vertical: 'negozio_artigiano',
  description: 'Arredi su misura, legni di recupero.',
  primary_goal: 'contatta',
  address: `${MARCA} Vicolo del Torchio 3`,
  whatsapp: `${MARCA}-whatsapp-4403`,
  geo: { lat: 44.404040404, lng: 8.909090909 },
};

/**
 * La fixture E i suoi marcatori, in una volta sola.
 *
 * La patch passa dallo schema del brief (T-121) e il rifiuto e RUMOROSO: una patch scartata
 * lascerebbe il brief senza il campo che il caso deve provare, e ogni asserzione di assenza
 * qui sotto sarebbe verde per il motivo sbagliato.
 *
 * I MARCATORI sono ESTRATTI dal brief appena costruito e mai riscritti a mano: un elenco di
 * letterali proverebbe che quelle STRINGHE non compaiono, mentre cosi si prova che non
 * compare cio che il brief CONTIENE DAVVERO. Le coordinate di `geo` entrano a parte perche
 * sono l'unico valore fuori allowlist che non e testo — senza, la sua fuga sarebbe
 * inosservabile.
 */
function fixtura(locale: Brief['locale'], patch: Record<string, unknown>) {
  const applicata = applyBriefUpdate(emptyBrief(locale), patch);
  expect(applicata.rejected, `patch scartata dallo schema del brief (${locale})`).toEqual([]);
  const marcati = [
    ...JSON.stringify(applicata.brief).matchAll(new RegExp(`"([^"]*${MARCA}[^"]*)"`, 'g')),
  ].map((trovato) => trovato[1]);
  const geo = applicata.brief.geo;
  const coordinate = geo === undefined ? [] : [`${geo.lat}`, `${geo.lng}`];
  return { brief: applicata.brief, marcatori: [...new Set([...marcati, ...coordinate])] };
}

/**
 * Il PREFISSO COMUNE dei marcatori TESTUALI, CALCOLATO e non dichiarato: e cio che prende la
 * fuga TRONCATA, invisibile a un confronto per marcatore intero. I marcatori numerici sono
 * esclusi dal calcolo — azzererebbero il prefisso e l'asserzione diventerebbe vuota.
 *
 * In ordine lessicografico il prefisso comune di TUTTI e quello dei due estremi: e la stessa
 * risposta di un confronto a due a due, in un passaggio solo.
 */
function prefissoComune(marcatori: readonly string[]): string {
  const ordinati = marcatori
    .filter((marcatore) => /^[A-Za-z]/.test(marcatore))
    .map((marcatore) => marcatore.toLowerCase())
    .sort();
  expect(
    ordinati.length,
    'meno di due marcatori testuali: il prefisso non direbbe nulla',
  ).toBeGreaterThan(1);
  const primo = ordinati[0];
  const ultimo = ordinati[ordinati.length - 1];
  let comuni = 0;
  while (comuni < primo.length && primo[comuni] === ultimo[comuni]) comuni += 1;
  return primo.slice(0, comuni);
}

// ---------------------------------------------------------------------------
// IL TURNO. Il doppio del client CATTURA i due argomenti di messages.create e risponde con
// una tool-call valida, cosi la cattura avviene sul cammino NORMALE — quello che riesce — e
// non su un ramo di errore in cui il payload potrebbe non essere nemmeno partito.

/**
 * La FASE del turno, DERIVATA dal budget come nel file gemello (tests/generation-turn.test.ts)
 * e non scritta come letterale: due modi di nominare la stessa cosa nello stesso task
 * divergono il giorno in cui le fasi cambiano nome, e qui il nome sbagliato non darebbe un
 * errore ma un tetto di uscita diverso.
 */
const FASE_DEL_TURNO = Object.keys(
  GENERATION_BUDGET.max_tokens,
)[0] as keyof (typeof GENERATION_BUDGET)['max_tokens'];

const SLOT_DEL_TURNO: readonly SlotId[] = ['hero_title_kicker', 'hero_title', 'about_body'];
const PAGINE_DEL_TURNO: readonly string[] = ['home', 'chi-siamo', 'chi-siamo-e-dove'];
const TOOL_DEL_TURNO = buildPoolTool(SLOT_DEL_TURNO, PAGINE_DEL_TURNO);

const POOL_DELLA_RISPOSTA = {
  pages: {
    home: { hero_title: 'Aurora', hero_title_kicker: 'Lievitati ogni mattina' },
    'chi-siamo-e-dove': { about_body: 'Un forno di quartiere, aperto presto.' },
  },
};

const RISPOSTA_DEL_MODELLO: Anthropic.Message = {
  id: 'msg_leak_t224',
  container: null,
  content: [
    {
      type: 'tool_use',
      id: 'toolu_leak_t224',
      caller: { type: 'direct' },
      name: TOOL_DEL_TURNO.name,
      input: POOL_DELLA_RISPOSTA,
    },
  ],
  model: 'claude-sonnet-5',
  role: 'assistant',
  stop_details: null,
  stop_reason: 'tool_use',
  stop_sequence: null,
  type: 'message',
  usage: {
    input_tokens: 3900,
    output_tokens: 900,
    cache_creation: null,
    cache_read_input_tokens: null,
    cache_creation_input_tokens: null,
    output_tokens_details: null,
    inference_geo: null,
    server_tool_use: null,
    service_tier: null,
  },
};

/**
 * Esegue il turno con un doppio che cattura, e restituisce la SERIALIZZAZIONE di cio che e
 * arrivato al confine: entrambi gli argomenti, params e request options.
 */
async function payloadCatturato(brief: Brief, profilo: ProjectionProfile): Promise<string> {
  const catturate: unknown[] = [];
  const client = {
    messages: {
      create(
        params: Anthropic.MessageCreateParamsNonStreaming,
        options?: Anthropic.RequestOptions,
      ): Promise<Anthropic.Message> {
        catturate.push({ params, options });
        return Promise.resolve(RISPOSTA_DEL_MODELLO);
      },
    },
  };

  const esito = await runGenerationTurn(
    {
      payload: buildGenerationPayload(briefProjection(brief, profilo), TOOL_DEL_TURNO, profilo),
      phase: FASE_DEL_TURNO,
      allowedSlugs: PAGINE_DEL_TURNO,
    },
    client,
  );

  // ANTI-VACUITA': il confine e stato davvero attraversato, una volta sola, e sul cammino
  // che RIESCE. Un turno che fallisse prima della chiamata non perderebbe nulla, e ogni
  // asserzione di assenza qui sotto sarebbe verde per il motivo sbagliato.
  expect(catturate, `nessuna chiamata al confine (${profilo})`).toHaveLength(1);
  expect(esito.ok, `il turno non e riuscito (${profilo})`).toBe(true);
  return JSON.stringify(catturate[0]);
}

const PROFILI: readonly ProjectionProfile[] = ['home', 'inner'];

// ---------------------------------------------------------------------------

describe('T-224 nessun campo fuori allowlist raggiunge il confine', () => {
  // Senza questa riga l'intero file potrebbe essere verde per omissione: se le due fixture
  // non marcassero qualche campo fuori allowlist, quel campo non avrebbe alcun valore da
  // perdere e nessuna asserzione lo sorveglierebbe. La copertura e verificata sull'UNIONE
  // delle due, contro l'elenco DERIVATO dallo schema del brief.
  it('le due fixture insieme marcano OGNI campo fuori allowlist', () => {
    const unione = { ...PATCH_DA_IMPORT, ...PATCH_RUOLI_INVERTITI };
    const scoperti = CAMPI_FUORI_ALLOWLIST.filter(
      (campo) => !JSON.stringify(unione[campo] ?? null).includes(MARCA),
    );
    // `geo` non porta la MARCA (e fatto di numeri): e sorvegliato dalle sue coordinate,
    // estratte a parte da `marcatoriDi`.
    expect(scoperti).toEqual(['geo']); // covers: AC-224-5
    expect(CAMPI_FUORI_ALLOWLIST.length, 'nessun campo fuori allowlist').toBeGreaterThan(1); // covers: AC-224-5
  });

  // covers: AC-224-5
  // IL PRODOTTO {it, es} x {import, ruoli invertiti}, e per ciascuna combinazione ENTRAMBI i
  // profili: una fuga presente nel solo ramo 'es', o nella sola forma raggruppata del
  // campione (fase 2), sarebbe invisibile a un oracolo che prova un caso solo. E una fuga in
  // una lingua e una fuga.
  for (const locale of ['it', 'es'] as const) {
    for (const [caso, patch] of [
      ['import', PATCH_DA_IMPORT],
      ['ruoli invertiti', PATCH_RUOLI_INVERTITI],
    ] as const) {
      it(`nessun marcatore nel payload passato al confine (${locale}, ${caso})`, async () => {
        const { brief, marcatori } = fixtura(locale, patch);

        // CONTRO-PROVA: i marcatori sono DAVVERO nel brief che il turno riceve.
        const briefSerializzato = JSON.stringify(brief).toLowerCase();
        expect(marcatori.length, `troppo pochi marcatori in ${caso}`).toBeGreaterThanOrEqual(4); // covers: AC-224-5
        expect(
          marcatori.filter((marcatore) => !briefSerializzato.includes(marcatore.toLowerCase())),
          `marcatori assenti dal brief ${caso}/${locale}`,
        ).toEqual([]); // covers: AC-224-5

        const prefisso = prefissoComune(marcatori);
        // Il prefisso CALCOLATO dev'essere lungo almeno quanto cio' che si cerca, altrimenti
        // il troncamento qui sotto cercherebbe meno di quanto dichiara e la granularita'
        // sarebbe decisa dalla fixture invece che da questa costante.
        expect(prefisso.length, `prefisso comune troppo corto: '${prefisso}'`).toBeGreaterThanOrEqual(
          GRANULARITA_DEL_PREFISSO,
        ); // covers: AC-224-5
        const prefissoTroncato = prefisso.slice(0, GRANULARITA_DEL_PREFISSO).toLowerCase();

        for (const profilo of PROFILI) {
          const catturato = await payloadCatturato(brief, profilo);
          const pagliaio = catturato.toLowerCase();
          const dove = `${caso}/${locale}/${profilo}`;

          // Per marcatore INTERO, cosi il fallimento dice QUALE valore e uscito...
          expect(
            marcatori.filter((marcatore) => pagliaio.includes(marcatore.toLowerCase())),
            `marcatori INTERI trovati nel payload di ${dove}`,
          ).toEqual([]); // covers: AC-224-5
          // ...e sui primi caratteri del PREFISSO COMUNE, che e' cio' che chiude la fuga
          // TRONCATA — quella in cui nessun marcatore intero comparirebbe mai. Entrambe
          // CASE-INSENSITIVE: un valore passato in maiuscolo e la stessa fuga.
          expect(
            pagliaio.includes(prefissoTroncato),
            `prefisso troncato '${prefissoTroncato}' trovato nel payload di ${dove}`,
          ).toBe(false); // covers: AC-224-5

          // ANTI-VACUITA' sul payload: cio che l'allowlist AMMETTE c'e davvero. Un payload
          // vuoto — o assemblato su un brief vuoto — non perderebbe nulla.
          expect(catturato, dove).toContain(String(brief.business_name)); // covers: AC-224-5
          expect(catturato, dove).toContain(String(brief.description)); // covers: AC-224-5
        }
      });
    }
  }
});
