import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { runOnboardingTurn } from '@/data/anthropic';
import {
  BRIEF_LIMITS,
  BriefUpdateSchema,
  applyBriefUpdate,
  type Brief,
} from '@/domain/onboarding/brief';

// T-132 (macrotask ai-onboarding, P1) — orchestrazione di UN turno dell'intervista:
// costruisce il system prompt localizzato, dichiara i tool, chiama il confine LLM
// (T-131) e interpreta le tool-call della risposta.
//
// Sicurezza (A05:2025): la risposta del modello e input NON FIDATO. L'input di ogni
// tool-call update_brief passa da BriefUpdateSchema (T-121) PRIMA di essere fuso, e la
// fusione usa applyBriefUpdate (T-122), che scarta campo per campo senza lanciare.
// Un input che non supera lo schema viene ignorato: il brief resta quello di partenza.
// Nessun segreto qui: chiave e modello vivono nel confine server-only.

// Gli ENUM del tool sono derivati dalle allowlist di T-121, cosi i valori dichiarati
// al modello non possono divergere da quelli che la validazione accetta.
// I TETTI di lunghezza invece NON stanno nel JSON Schema (P1-D20, che annulla la
// clausola 4 di P1-D17): `maxLength` e `maxItems` sono FUORI dal sottoinsieme JSON
// Schema che lo strict tool use supporta, e questo e' un `Anthropic.Tool` scritto a
// mano passato a messages.create — nessun helper zod li rimuove per noi, quindi
// arriverebbero all'API verbatim e la prima chiamata reale rischierebbe un 400 in
// compilazione dello schema. Il motivo della clausola resta valido (la chat scarta
// l'INTERA tool-call su un solo campo invalido, quindi un tetto non dichiarato brucia
// il turno): percio' i tetti si dichiarano al modello nella `description` del tool,
// che e' prosa e non e' vincolata dal sottoinsieme (vedi CAPS_HINT).
// L'elenco delle properties resta scritto a mano (JSON Schema, non zod) e va tenuto
// allineato a BriefUpdateSchema: oggi `hours` e' l'unica divergenza, voluta (vedi
// sotto). Nessuna derivazione automatica: sarebbe un generatore zod->JSON Schema,
// astrazione che nessun task richiede.
const updateShape = BriefUpdateSchema.shape;
const VERTICAL_VALUES = updateShape.vertical.unwrap().options;
const PRIMARY_GOAL_VALUES = updateShape.primary_goal.unwrap().options;
const LOCALE_VALUES = updateShape.locale.unwrap().options;

// Wrapper dell'input del tool: la patch sta sotto l'unica chiave obbligatoria
// `updates` (strict tool use vuole un `required` valorizzato, mentre la patch ha
// tutti i campi opzionali). strict anche qui: chiavi extra = input scartato.
const UpdateBriefInputSchema = z.object({ updates: BriefUpdateSchema }).strict();

// Le voci dell'offerta (menu/servizi/catalogo), stessa forma di OfferingSchema (T-121).
const OFFERING_JSON_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    price: { type: 'string' },
    photo_ref: { type: 'string' },
    section: { type: 'string' },
  },
  required: ['name'],
  additionalProperties: false,
};

// I tetti dichiarati in PROSA (P1-D20). Solo i campi di testo libero, dove il modello
// puo' davvero sforare: elencarli tutti e venti riempirebbe il prompt di numeri che
// non cambiano nulla (un nome di attivita' non arriva a 200 caratteri, un telefono a
// 40). I numeri vengono da BRIEF_LIMITS, non riscritti a mano: una copia divergente
// direbbe al modello un limite che la validazione non applica.
const CAPS_HINT =
  `Limiti di lunghezza in caratteri, oltre i quali il campo viene scartato: ` +
  `description ${BRIEF_LIMITS.description}, brand_hints ${BRIEF_LIMITS.brand_hints}, ` +
  `description di ogni voce dell offerta ${BRIEF_LIMITS.offering_description}.`;

// La patch di T-121, sotto l'unica chiave obbligatoria `updates` (decisione P1-D12:
// la patch ha tutti i campi opzionali, quindi in forma flat non esiste un `required`
// valorizzato come pretende AC-132-2).
// `hours` e volutamente assente (decisione P1-D13): e una mappa a chiavi libere
// (record) e in strict tool use ogni oggetto deve chiudersi con additionalProperties:
// false, quindi non e esprimibile. LIMITE NOTO: l'intervista non puo raccogliere gli
// orari; li raccolgono il pannello brief editabile (T-151) e upsertBrief (T-123).
const UPDATE_BRIEF_TOOL: Anthropic.Tool = {
  name: 'update_brief',
  description: [
    'Registra nel brief i dati appresi dalla conversazione. Invia solo i campi che l utente ha comunicato davvero.',
    CAPS_HINT,
  ].join(' '),
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      updates: {
        type: 'object',
        properties: {
          business_name: { type: 'string' },
          vertical: { type: 'string', enum: VERTICAL_VALUES },
          description: { type: 'string' },
          address: { type: 'string' },
          geo: {
            type: 'object',
            properties: { lat: { type: 'number' }, lng: { type: 'number' } },
            required: ['lat', 'lng'],
            additionalProperties: false,
          },
          phone: { type: 'string' },
          whatsapp: { type: 'string' },
          email: { type: 'string' },
          primary_goal: { type: 'string', enum: PRIMARY_GOAL_VALUES },
          locale: { type: 'string', enum: LOCALE_VALUES },
          offerings: { type: 'array', items: OFFERING_JSON_SCHEMA },
          social_links: { type: 'array', items: { type: 'string' } },
          highlights: { type: 'array', items: { type: 'string' } },
          brand_hints: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    required: ['updates'],
    additionalProperties: false,
  },
};

// Nessun parametro: e solo il segnale di passaggio a Rivedi&conferma.
const MARK_READY_TOOL: Anthropic.Tool = {
  name: 'mark_ready_for_review',
  description:
    'Segnala che il brief ha i dati essenziali e si puo passare alla schermata Rivedi e conferma.',
  input_schema: { type: 'object', properties: {}, additionalProperties: false },
};

const TOOLS: Anthropic.ToolUnion[] = [UPDATE_BRIEF_TOOL, MARK_READY_TOOL];

// Un sito = una lingua (T-121): il prompt segue il locale del brief.
const SYSTEM_PROMPTS: Record<Brief['locale'], string> = {
  it: [
    "Sei l'assistente di onboarding di Belora: aiuti un micro-business locale a raccogliere i dati del suo sito.",
    'Parla in italiano, fai UNA domanda alla volta e rispondi breve.',
    "Quando l'utente comunica un dato, chiama il tool update_brief solo con i campi che hai appreso davvero: non inventare nulla.",
    "Quando conosci il nome dell'attivita, il tipo di attivita e l'obiettivo principale del sito, chiama il tool mark_ready_for_review.",
  ].join('\n'),
  es: [
    'Eres el asistente de onboarding de Belora: ayudas a un micro-negocio local a reunir los datos de su web.',
    'Habla en castellano, haz UNA pregunta a la vez y responde corto.',
    'Cuando la persona te da un dato, llama a la herramienta update_brief solo con los campos que has aprendido de verdad: no inventes nada.',
    'Cuando conozcas el nombre del negocio, el tipo de negocio y el objetivo principal de la web, llama a la herramienta mark_ready_for_review.',
  ].join('\n'),
};

/**
 * Esegue un turno dell'intervista: manda al modello i messaggi precedenti piu il
 * turno dell'utente e interpreta la risposta.
 * @param turn messaggi precedenti, brief corrente e messaggio dell'utente.
 * @returns testo assistente, brief aggiornato e flag di passaggio a Rivedi&conferma.
 */
export async function runInterviewTurn(turn: {
  messages: Anthropic.MessageParam[];
  brief: Brief;
  userMessage: string;
}): Promise<{ assistantText: string; brief: Brief; readyForReview: boolean }> {
  const reply = await runOnboardingTurn({
    system: SYSTEM_PROMPTS[turn.brief.locale],
    messages: [...turn.messages, { role: 'user', content: turn.userMessage }],
    tools: TOOLS,
  });

  const texts: string[] = [];
  let brief = turn.brief;
  let readyForReview = false;

  // I blocchi si applicano NELL'ORDINE della risposta: piu update_brief nello stesso
  // turno si fondono in sequenza (il merge di T-122 e deterministico).
  for (const block of reply.content) {
    if (block.type === 'text') {
      texts.push(block.text);
      continue;
    }
    if (block.type !== 'tool_use') continue;
    if (block.name === 'mark_ready_for_review') {
      readyForReview = true;
      continue;
    }
    if (block.name !== 'update_brief') continue;
    const parsed = UpdateBriefInputSchema.safeParse(block.input);
    if (!parsed.success) continue;
    brief = applyBriefUpdate(brief, parsed.data.updates).brief;
  }

  return { assistantText: texts.join('\n'), brief, readyForReview };
}
