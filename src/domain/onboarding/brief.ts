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

// Una voce dell'offerta (menu/servizio/catalogo/portfolio): name obbligatorio.
const OfferingSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().optional(),
    price: z.string().optional(),
    photo_ref: z.string().optional(),
    section: z.string().optional(),
  })
  .strict();

const GeoSchema = z.object({ lat: z.number(), lng: z.number() }).strict();
const HoursSchema = z.record(z.string(), z.string());

// content: lista offerta flessibile + sezioni, social, highlights, brand hints.
const BriefContentSchema = z
  .object({
    offerings: z.array(OfferingSchema).default([]),
    social_links: z.array(z.string()).default([]),
    highlights: z.array(z.string()).default([]),
    brand_hints: z.string().optional(),
  })
  .strict();

// Il Business Brief completo. locale e richiesto (un sito = una lingua in v1);
// vertical ha default 'altro'; content ha default vuoto strutturato.
export const BriefSchema = z
  .object({
    business_name: z.string().trim().min(1).optional(),
    vertical: z.enum(VERTICALS).default('altro'),
    description: z.string().optional(),
    address: z.string().optional(),
    geo: GeoSchema.optional(),
    hours: HoursSchema.optional(),
    phone: z.string().optional(),
    whatsapp: z.string().optional(),
    email: z.string().optional(),
    primary_goal: z.enum(PRIMARY_GOALS).optional(),
    locale: z.enum(LOCALES),
    content: BriefContentSchema.default({ offerings: [], social_links: [], highlights: [] }),
  })
  .strict();

export type Brief = z.infer<typeof BriefSchema>;

// Patch FLAT di aggiornamento: tutti i campi opzionali; strict (nessuna chiave
// sconosciuta). E' il contratto del tool update_brief (T-132) e di upsertBrief (T-123).
export const BriefUpdateSchema = z
  .object({
    business_name: z.string().trim().min(1).optional(),
    vertical: z.enum(VERTICALS).optional(),
    description: z.string().optional(),
    address: z.string().optional(),
    geo: GeoSchema.optional(),
    hours: HoursSchema.optional(),
    phone: z.string().optional(),
    whatsapp: z.string().optional(),
    email: z.string().optional(),
    primary_goal: z.enum(PRIMARY_GOALS).optional(),
    locale: z.enum(LOCALES).optional(),
    offerings: z.array(OfferingSchema).optional(),
    social_links: z.array(z.string()).optional(),
    highlights: z.array(z.string()).optional(),
    brand_hints: z.string().optional(),
  })
  .strict();

// Brief vuoto valido per un dato locale (vertical 'altro', content vuoto).
export function emptyBrief(locale: (typeof LOCALES)[number]): Brief {
  return BriefSchema.parse({ locale });
}

// Schemi per-campo: applyBriefUpdate applica/scarta CAMPO PER CAMPO, cosi un
// singolo campo invalido (es. vertical fuori allowlist) viene scartato senza
// corrompere il resto del brief e senza lanciare (AC-122-3).
const CORE_FIELD_SCHEMAS: Record<string, z.ZodTypeAny> = {
  business_name: z.string().trim().min(1),
  vertical: z.enum(VERTICALS),
  description: z.string(),
  address: z.string(),
  geo: GeoSchema,
  hours: HoursSchema,
  phone: z.string(),
  whatsapp: z.string(),
  email: z.string(),
  primary_goal: z.enum(PRIMARY_GOALS),
  locale: z.enum(LOCALES),
};

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

  if (update && typeof update === 'object' && !Array.isArray(update)) {
    for (const [key, value] of Object.entries(update as Record<string, unknown>)) {
      if (key === 'offerings') {
        const parsed = z.array(OfferingSchema).safeParse(value);
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
        out.content = { ...out.content, offerings: merged };
        continue;
      }
      if (key === 'social_links' || key === 'highlights') {
        const parsed = z.array(z.string()).safeParse(value);
        if (!parsed.success) {
          rejected.push(key);
          continue;
        }
        out.content = { ...out.content, [key]: parsed.data };
        continue;
      }
      if (key === 'brand_hints') {
        const parsed = z.string().safeParse(value);
        if (!parsed.success) {
          rejected.push('brand_hints');
          continue;
        }
        out.content = { ...out.content, brand_hints: parsed.data };
        continue;
      }
      const schema = CORE_FIELD_SCHEMAS[key];
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
