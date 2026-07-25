// T-121 / T-122 (macrotask brief-model, P1) — schema di dominio del Business Brief
// e logica PURA di fusione/completamento. Nessun accesso al DB, nessun side-effect.
//
// E' il gate di validazione dell'input NON FIDATO (output del modello LLM, HTML
// importato) PRIMA di ogni scrittura (A05:2025 / ASVS Validation & Business Logic):
// le allowlist (vertical/primary_goal/locale) sono enum chiusi, e lo schema e strict
// (nessuna chiave sconosciuta puo passare). La forma di UPDATE e una patch FLAT
// (campi core + offerings/social_links/highlights/brand_hints al top level): la
// stessa che il tool `update_brief` (T-132, strict) e la server action upsertBrief
// (T-123) consumano.

import { z } from 'zod';

const VERTICALS = ['ristorazione', 'fitness', 'salone_studio', 'negozio_artigiano', 'altro'] as const;
const PRIMARY_GOALS = ['prenota', 'ordina', 'contatta'] as const;
const LOCALES = ['it', 'es'] as const;

// P1-D17 — tetti di lunghezza (in caratteri) e di numero di voci. Stanno in UNA
// definizione perche' i campi core sono dichiarati TRE volte (BriefSchema,
// BriefUpdateSchema, CORE_FIELD_SCHEMAS): copie divergenti dei numeri sarebbero un
// buco di validazione silenzioso. Il tool update_brief (T-132) li rideclara al
// modello derivandoli da qui.
// PERCHE' il tetto: misurato, una pagina importata di poche centinaia di KB produce
// un description da centinaia di migliaia di caratteri che attraversa
// applyBriefUpdate -> upsertBrief -> DB. Vale per ENTRAMBE le sorgenti (chat e
// import), quindi il tetto vive qui e non nei chiamanti.
// UNITA' DI MISURA: sono CODE UNIT UTF-16 (String.prototype.length, cio' che .max()
// conta), non "caratteri". Un'emoji o un carattere fuori dal BMP pesa due, quindi un
// testo di emoji esaurisce il tetto a meta' dei simboli che l'utente vede. I numeri
// restano questi: e' il conteggio che vedono anche il textarea di T-152 e la colonna
// del DB, e passare ai code point vorrebbe dire un refine a mano su ogni campo.
// PESO GARANTITO, misurato: una riga con OGNI campo e OGNI collezione esattamente al
// tetto pesa ~405 KB di JSON (405.417 byte), di cui 383.694 dalle sole offerings al
// tetto e ~22 KB da tutto il resto. E' il bound reale dell'emendamento e NON e' zero:
// il tetto impedisce il singolo campo da centinaia di migliaia di caratteri, non rende
// la riga piccola.
export const BRIEF_LIMITS = {
  business_name: 200,
  description: 2000,
  address: 300,
  phone: 40,
  whatsapp: 40,
  email: 320,
  brand_hints: 500,
  highlight: 200,
  highlights_items: 20,
  social_link: 500,
  social_links_items: 20,
  offering_name: 200,
  offering_description: 1000,
  offering_price: 50,
  offering_section: 100,
  offering_photo_ref: 500,
  offerings_items: 200,
  hours_key: 20,
  hours_value: 100,
  hours_keys: 32,
} as const;

// Una voce dell'offerta (menu/servizio/catalogo/portfolio): name obbligatorio.
const OfferingSchema = z
  .object({
    name: z.string().trim().min(1).max(BRIEF_LIMITS.offering_name),
    description: z.string().max(BRIEF_LIMITS.offering_description).optional(),
    price: z.string().max(BRIEF_LIMITS.offering_price).optional(),
    photo_ref: z.string().max(BRIEF_LIMITS.offering_photo_ref).optional(),
    section: z.string().max(BRIEF_LIMITS.offering_section).optional(),
  })
  .strict();

const GeoSchema = z.object({ lat: z.number(), lng: z.number() }).strict();

// Gli orari sono una mappa a CHIAVI LIBERE (P1-D13): senza un tetto anche sul
// numero di chiavi la mappa crescerebbe quanto vuole l'input non fidato, e un tetto
// sui soli valori non basterebbe.
const HoursSchema = z
  .record(z.string().max(BRIEF_LIMITS.hours_key), z.string().max(BRIEF_LIMITS.hours_value))
  .refine((hours) => Object.keys(hours).length <= BRIEF_LIMITS.hours_keys);

// P1-D17 — UNO schema per campo: e' la sola sede in cui i tetti sono applicati, e
// lo referenziano tutte e tre le dichiarazioni dei campi (BriefSchema,
// BriefUpdateSchema e il lookup per-campo di applyBriefUpdate).
// CORE_FIELD_SCHEMAS serve ad applyBriefUpdate, che applica/scarta CAMPO PER CAMPO:
// un singolo campo invalido (vertical fuori allowlist, description fuori scala)
// viene SCARTATO — mai troncato, che sarebbe corruzione silenziosa — senza
// corrompere il resto del brief e senza lanciare (AC-122-3).
const CORE_FIELD_SCHEMAS = {
  business_name: z.string().trim().min(1).max(BRIEF_LIMITS.business_name),
  vertical: z.enum(VERTICALS),
  description: z.string().max(BRIEF_LIMITS.description),
  address: z.string().max(BRIEF_LIMITS.address),
  geo: GeoSchema,
  hours: HoursSchema,
  phone: z.string().max(BRIEF_LIMITS.phone),
  whatsapp: z.string().max(BRIEF_LIMITS.whatsapp),
  email: z.string().max(BRIEF_LIMITS.email),
  primary_goal: z.enum(PRIMARY_GOALS),
  locale: z.enum(LOCALES),
};

// I campi che nel Brief vivono sotto `content` ma nella patch stanno al top level.
const CONTENT_FIELD_SCHEMAS = {
  offerings: z.array(OfferingSchema).max(BRIEF_LIMITS.offerings_items),
  social_links: z
    .array(z.string().max(BRIEF_LIMITS.social_link))
    .max(BRIEF_LIMITS.social_links_items),
  highlights: z.array(z.string().max(BRIEF_LIMITS.highlight)).max(BRIEF_LIMITS.highlights_items),
  brand_hints: z.string().max(BRIEF_LIMITS.brand_hints),
};

// content: lista offerta flessibile + sezioni, social, highlights, brand hints.
const BriefContentSchema = z
  .object({
    offerings: CONTENT_FIELD_SCHEMAS.offerings.default([]),
    social_links: CONTENT_FIELD_SCHEMAS.social_links.default([]),
    highlights: CONTENT_FIELD_SCHEMAS.highlights.default([]),
    brand_hints: CONTENT_FIELD_SCHEMAS.brand_hints.optional(),
  })
  .strict();

// Il Business Brief completo. locale e richiesto (un sito = una lingua in v1);
// vertical ha default 'altro'; content ha default vuoto strutturato.
export const BriefSchema = z
  .object({
    business_name: CORE_FIELD_SCHEMAS.business_name.optional(),
    vertical: CORE_FIELD_SCHEMAS.vertical.default('altro'),
    description: CORE_FIELD_SCHEMAS.description.optional(),
    address: CORE_FIELD_SCHEMAS.address.optional(),
    geo: CORE_FIELD_SCHEMAS.geo.optional(),
    hours: CORE_FIELD_SCHEMAS.hours.optional(),
    phone: CORE_FIELD_SCHEMAS.phone.optional(),
    whatsapp: CORE_FIELD_SCHEMAS.whatsapp.optional(),
    email: CORE_FIELD_SCHEMAS.email.optional(),
    primary_goal: CORE_FIELD_SCHEMAS.primary_goal.optional(),
    locale: CORE_FIELD_SCHEMAS.locale,
    content: BriefContentSchema.default({ offerings: [], social_links: [], highlights: [] }),
  })
  .strict();

export type Brief = z.infer<typeof BriefSchema>;

// Patch FLAT di aggiornamento: tutti i campi opzionali; strict (nessuna chiave
// sconosciuta). E' il contratto del tool update_brief (T-132) e di upsertBrief (T-123).
export const BriefUpdateSchema = z
  .object({
    business_name: CORE_FIELD_SCHEMAS.business_name.optional(),
    vertical: CORE_FIELD_SCHEMAS.vertical.optional(),
    description: CORE_FIELD_SCHEMAS.description.optional(),
    address: CORE_FIELD_SCHEMAS.address.optional(),
    geo: CORE_FIELD_SCHEMAS.geo.optional(),
    hours: CORE_FIELD_SCHEMAS.hours.optional(),
    phone: CORE_FIELD_SCHEMAS.phone.optional(),
    whatsapp: CORE_FIELD_SCHEMAS.whatsapp.optional(),
    email: CORE_FIELD_SCHEMAS.email.optional(),
    primary_goal: CORE_FIELD_SCHEMAS.primary_goal.optional(),
    locale: CORE_FIELD_SCHEMAS.locale.optional(),
    offerings: CONTENT_FIELD_SCHEMAS.offerings.optional(),
    social_links: CONTENT_FIELD_SCHEMAS.social_links.optional(),
    highlights: CONTENT_FIELD_SCHEMAS.highlights.optional(),
    brand_hints: CONTENT_FIELD_SCHEMAS.brand_hints.optional(),
  })
  .strict();

// Brief vuoto valido per un dato locale (vertical 'altro', content vuoto).
export function emptyBrief(locale: (typeof LOCALES)[number]): Brief {
  return BriefSchema.parse({ locale });
}

export type ApplyBriefResult = { brief: Brief; rejected: string[] };

// Fonde una patch (anche non fidata) nel brief in modo DETERMINISTICO. I campi
// core validi sovrascrivono; le offerings si fondono per `name` (stesso name →
// aggiorna la voce, name nuovo → appende); social_links/highlights/brand_hints
// aggiornano il content. Ogni campo invalido finisce in `rejected` senza lanciare
// e senza toccare il brief. Funzione pura.
export function applyBriefUpdate(brief: Brief, update: unknown): ApplyBriefResult {
  const content = {
    offerings: [...(brief.content?.offerings ?? [])],
    social_links: [...(brief.content?.social_links ?? [])],
    highlights: [...(brief.content?.highlights ?? [])],
    ...(brief.content?.brand_hints !== undefined ? { brand_hints: brief.content.brand_hints } : {}),
  };
  const out: Brief = { ...brief, content };
  const rejected: string[] = [];
  // Vista indicizzabile degli schemi per-campo: la chiave arriva da input NON
  // FIDATO, mentre CORE_FIELD_SCHEMAS resta tipizzato per BriefSchema/BriefUpdateSchema.
  const coreSchemas: Record<string, z.ZodTypeAny | undefined> = CORE_FIELD_SCHEMAS;

  if (update && typeof update === 'object' && !Array.isArray(update)) {
    for (const [key, value] of Object.entries(update as Record<string, unknown>)) {
      if (key === 'offerings') {
        const parsed = CONTENT_FIELD_SCHEMAS.offerings.safeParse(value);
        if (!parsed.success) {
          rejected.push('offerings');
          continue;
        }
        const merged = [...content.offerings];
        for (const off of parsed.data) {
          const idx = merged.findIndex((o) => o.name === off.name);
          if (idx >= 0) merged[idx] = { ...merged[idx], ...off };
          else merged.push(off);
        }
        // P1-D17 — il tetto vale sul RISULTATO del merge, non solo sulla patch.
        // offerings e' il SOLO campo che si fonde per ACCUMULO (name nuovo → appende):
        // validare la sola patch lascia passare N patch conformi che insieme sfondano
        // offerings_items, e il valore scritto qui sarebbe un Brief che NON valida
        // contro BriefSchema — la funzione mentirebbe sul proprio tipo di ritorno.
        // Questo e' il solo punto in cui il valore in mano e' quello finale.
        // Oltre il tetto la patch e' SCARTATA come ogni altro campo fuori scala: il
        // brief conserva l'array PRECEDENTE, mai una versione troncata (troncare
        // sceglierebbe al posto dell'utente quali offerte perdere, in silenzio).
        const mergedParsed = CONTENT_FIELD_SCHEMAS.offerings.safeParse(merged);
        if (!mergedParsed.success) {
          rejected.push('offerings');
          continue;
        }
        out.content = { ...out.content, offerings: mergedParsed.data };
        continue;
      }
      if (key === 'social_links' || key === 'highlights') {
        const parsed = CONTENT_FIELD_SCHEMAS[key].safeParse(value);
        if (!parsed.success) {
          rejected.push(key);
          continue;
        }
        out.content = { ...out.content, [key]: parsed.data };
        continue;
      }
      if (key === 'brand_hints') {
        const parsed = CONTENT_FIELD_SCHEMAS.brand_hints.safeParse(value);
        if (!parsed.success) {
          rejected.push('brand_hints');
          continue;
        }
        out.content = { ...out.content, brand_hints: parsed.data };
        continue;
      }
      // Guardia di proprieta' PROPRIA: la chiave arriva da input non fidato e
      // JSON.parse produce `constructor`/`toString`/`valueOf`/`__proto__` come
      // proprieta' proprie della patch. Senza la guardia il lookup risolverebbe il
      // membro EREDITATO da Object.prototype — che non e' uno schema zod — e la
      // safeParse sotto LANCEREBBE un TypeError, mentre il contratto della funzione
      // (AC-122-3) e' scartare il campo e proseguire. Difetto PREESISTENTE
      // all'emendamento P1-D17, non introdotto da lui. I rami
      // offerings/social_links/highlights/brand_hints non sono esposti: la' la chiave
      // e' CONFRONTATA con letterali, non usata per indicizzare uno schema.
      const schema = Object.hasOwn(coreSchemas, key) ? coreSchemas[key] : undefined;
      if (!schema) {
        rejected.push(key);
        continue;
      }
      const r = schema.safeParse(value);
      if (r.success) (out as Record<string, unknown>)[key] = r.data;
      else rejected.push(key);
    }
  }

  return { brief: out, rejected };
}

// Il brief e "completo" (pronto per Rivedi&conferma / P2) quando i campi core
// richiesti sono valorizzati: business_name, vertical, primary_goal, locale.
export function isBriefComplete(brief: Brief): boolean {
  return Boolean(brief.business_name && brief.vertical && brief.primary_goal && brief.locale);
}
