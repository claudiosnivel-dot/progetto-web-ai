import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// SEAM DELLA PROVA DI COMPORTAMENTO (clausola A di AC-235-5, piu' sotto). Per provare che un
// redirect NOMINA davvero /preview — e non che la sottostringa esista sulla riga che CALCOLA il
// path — si invoca la `selectVariant` REALE (T-233) coi soli seam di dato mockati: getGeneration
// (lo stato), getBrief e readHomePools (le letture). La COMPOSIZIONE del documento
// (resolveVariantHome) resta REALE, e `redirect` e' spiato invece di navigare.
const { redirectSpy } = vi.hoisted(() => ({ redirectSpy: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: redirectSpy }));

const { getGenerationSpy, chooseVariantSpy, genHolder, chooseHolder } = vi.hoisted(() => {
  const genHolder = { current: null as unknown };
  const chooseHolder = { current: { ok: true } as unknown };
  return {
    genHolder,
    chooseHolder,
    getGenerationSpy: vi.fn(async () => genHolder.current),
    chooseVariantSpy: vi.fn(async () => chooseHolder.current),
  };
});
vi.mock('@/data/generations', () => ({
  getGeneration: getGenerationSpy,
  chooseVariant: chooseVariantSpy,
}));

const { getBriefSpy, briefHolder } = vi.hoisted(() => {
  const holder = { current: null as unknown };
  return { briefHolder: holder, getBriefSpy: vi.fn(async () => holder.current) };
});
vi.mock('@/data/briefs', () => ({ getBrief: getBriefSpy }));

const { readHomePoolsSpy, poolsHolder } = vi.hoisted(() => {
  const holder = { current: null as unknown };
  return { poolsHolder: holder, readHomePoolsSpy: vi.fn(async () => holder.current) };
});
vi.mock('@/data/generation-pools', () => ({ readHomePools: readHomePoolsSpy }));

// Import DOPO i mock (vi.mock e' hoisted).
import { selectVariant } from '@/data/generation-choose';
import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';

// T-235 (macrotask generation-ui, P2) — AC-235-5: il deliverable dell'anteprima e'
// RAGGIUNGIBILE dall'applicazione, non solo presente nel sorgente. E' la lezione di T-151:
// `npm run build` passava mentre i componenti erano ASSENTI dagli asset e l'analisi statica
// (knip) li elencava come inutilizzati — un deliverable che esiste nel sorgente e non
// nell'applicazione non e' un deliverable.
//
// L'AC ha due clausole, e questo file le verifica STATICAMENTE (nessun render):
//  A. esiste almeno un href/redirect dell'applicazione che NOMINA la rotta /preview, cioe' un
//     punto da cui l'anteprima si raggiunge (la scelta di T-233 vi reindirizza dopo la scelta;
//     la dashboard di T-236 vi linka);
//  B. i componenti dell'anteprima NON sono orfani per l'analisi statica: la pagina (che il
//     plugin Next di knip tratta come ENTRY) importa il renderer di WF1 (SiteView, il target
//     esatto di T-231: "la card e l'anteprima lo importeranno") e la navigazione, quindi
//     entrambi hanno un consumatore di rotta reale.
//
// Perche' statico e non `knip` in-process: knip analizzerebbe l'INTERO progetto (anche il lavoro
// in corso dei task fratelli) e potrebbe segnalare orfani estranei a questo task — un rosso non
// dovuto a questo codice. L'import-graph dell'ENTRY dell'anteprima e' la prova diretta e stabile
// dell'assenza di orfani per QUESTI file.

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));
const PREVIEW_DIR = join(SRC_DIR, 'app', '[locale]', 'preview');
const PAGE = join(PREVIEW_DIR, '[siteId]', 'page.tsx');
const NAVIGATION = join(PREVIEW_DIR, '[siteId]', 'PreviewNavigation.tsx');
const SOURCE = /\.(ts|tsx)$/;

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else if (SOURCE.test(full)) found.push(full);
  }
  return found;
}

// La forma con cui l'applicazione NOMINA la rotta: il segmento '/preview/' seguito dal siteId,
// esattamente cio' che `redirect(`/${locale}/preview/${…}`)` (T-233) e un href della dashboard
// (T-236) producono. Non e' la sola parola "preview" (che comparirebbe nei commenti): il segmento
// di percorso con le due barre.
const PREVIEW_ROUTE = '/preview/';

describe('T-235 AC-235-5 — l anteprima e raggiungibile dall applicazione', () => {
  // Anti-vacuita': lo scan deve trovare piu' di un file, altrimenti passerebbe a vuoto.
  it('lo scan del sorgente trova piu di un file', () => {
    expect(walk(SRC_DIR).length).toBeGreaterThan(1);
  });

  // covers: AC-235-5
  it('almeno un href/redirect FUORI dalla rotta anteprima nomina /preview (reachability dall app)', () => {
    // Si esclude la cartella dell'anteprima stessa: la reachability e' che vi si arrivi da
    // ALTROVE, non un'auto-referenza. I commenti dell'anteprima che citano "/preview" non contano.
    const external = walk(SRC_DIR)
      .filter((file) => !file.startsWith(PREVIEW_DIR))
      .filter((file) => readFileSync(file, 'utf8').includes(PREVIEW_ROUTE));

    expect(external.length).toBeGreaterThan(0); // covers: AC-235-5
    // Che il punto d'ingresso concreto (la scelta di T-233) REINDIRIZZI davvero all'anteprima non
    // e' piu' asserito come sottostringa qui — quella prova, un tempo `toContain('/preview/')` sul
    // sorgente della choose action, era vera-per-costruzione perche' la stringa vive comunque sulla
    // riga di `previewPath`, indipendente dai redirect. La prova di COMPORTAMENTO e' piu' sotto.
  });

  // covers: AC-235-5
  it('la pagina (entry di rotta) importa il renderer di WF1 e la navigazione: nessun orfano', () => {
    const page = readFileSync(PAGE, 'utf8');
    // Il renderer UNICO di WF1 (SiteView, T-231): la pagina gli da' un consumatore di rotta reale.
    expect(page).toContain("from '@/ui/site/SiteView'"); // covers: AC-235-5
    expect(page).toContain('SiteView'); // covers: AC-235-5
    // La navigazione dell'anteprima: importata dalla pagina, quindi non e' un file orfano.
    expect(page).toContain("from './PreviewNavigation'"); // covers: AC-235-5
    // La lettura del documento e la guardia: le altre due dipendenze dell'entry.
    expect(page).toContain("from '@/data/generation-document'"); // covers: AC-235-5
    expect(page).toContain("from './guard'"); // covers: AC-235-5
    // Il file della navigazione esiste ed esporta il componente che la pagina monta.
    expect(readFileSync(NAVIGATION, 'utf8')).toContain('export async function PreviewNavigation'); // covers: AC-235-5
  });

  // Falsificabilita': il rilevatore di import riconosce un import presente e non uno assente —
  // non passa per una stringa che comparirebbe comunque.
  it('il controllo e FALSIFICABILE: distingue un import presente da uno assente', () => {
    const page = readFileSync(PAGE, 'utf8');
    expect(page.includes("from '@/ui/site/SiteView'")).toBe(true); // covers: AC-235-5
    expect(page.includes("from '@/ui/generation/GenerationChooser'")).toBe(false); // covers: AC-235-5
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CLAUSOLA A di AC-235-5, come PROVA DI COMPORTAMENTO. Che "un redirect NOMINA /preview" non e'
// piu' `toContain('/preview/')` sul sorgente: quella stringa vive sulla riga che CALCOLA
// `previewPath` (generation-choose.ts), indipendente dai redirect, quindi sopravviverebbe alla
// rimozione di OGNI redirect. Qui si invoca la `selectVariant` REALE su stato 'ready' e si
// asserisce che il ramo di successo CHIAMI `redirect` verso /{locale}/preview/{siteId}.
// MUTAZIONE CHE LO RENDE ROSSO: sostituire `return redirect(previewPath)` del ramo 'ready' con un
// ritorno d'errore (lasciando la riga di previewPath) — `redirectSpy` non viene piu' chiamato.

// Brief RICCO, dominio REALE (come generation-choose.test): abbastanza da far comporre a
// resolveVariantHome un documento home valido, cosi' la scelta arriva davvero al redirect.
const RICH_BRIEF = applyBriefUpdate(emptyBrief('it'), {
  business_name: 'Trattoria Aurora',
  vertical: 'ristorazione',
  description: 'Cucina di mercato nel centro storico, aperta dal 1980.',
  whatsapp: '+39 333 4445566',
  phone: '+39 06 5551234',
  address: 'Via Verdi 12, Roma',
  hours: { 'lun-ven': '12:00-15:00', sab: '19:00-23:00' },
  offerings: [
    { name: 'Antipasto', section: 'Cucina' },
    { name: 'Antipasto della casa', section: 'Cucina' },
    { name: 'Dolce', section: 'Dessert' },
  ],
}).brief;

function homePool(firma: string): { pages: { home: Record<string, unknown> } } {
  return {
    pages: {
      home: {
        hero_title_kicker: `Occhiello ${firma}`,
        hero_title: `Titolo hero ${firma}`,
        hero_subtitle: `Sottotitolo hero ${firma}`,
        offerings_title: `Le nostre offerte ${firma}`,
        offerings_intro: `Introduzione alle offerte ${firma}`,
        about_title: `Chi siamo ${firma}`,
        about_body: `La nostra storia ${firma}`,
        about_points: [`Primo punto ${firma}`, `Secondo punto ${firma}`],
        hours_title: `I nostri orari ${firma}`,
        hours_intro: `Nota sugli orari ${firma}`,
        contact_title: `Contattaci ${firma}`,
        contact_intro: `Scrivici per informazioni ${firma}`,
        faq_title: `Domande frequenti ${firma}`,
        faq_items: [
          { question: `Prima domanda ${firma}?`, answer: `Prima risposta ${firma}` },
          { question: `Seconda domanda ${firma}?`, answer: `Seconda risposta ${firma}` },
        ],
        whatsapp_cta_title: `Scrivici su WhatsApp ${firma}`,
      },
    },
  };
}

const SHARED_POOL = homePool('condiviso');
const SITE_ID = 'site-di-a';
const GEN_ID = '11111111-1111-4111-8111-111111111111';

function generazione(status: string) {
  return {
    ok: true,
    generation: {
      id: GEN_ID,
      site_id: SITE_ID,
      status,
      max_pages: 10,
      failure_reason: null,
      updated_at: new Date().toISOString(),
    },
  };
}

describe('T-235 AC-235-5 clausola A — un redirect NOMINA /preview (comportamento, non sottostringa)', () => {
  beforeEach(() => {
    briefHolder.current = { ok: true, brief: RICH_BRIEF, status: 'confirmed', complete: true };
    poolsHolder.current = { ok: true, shared: SHARED_POOL, byVariant: {} };
    genHolder.current = generazione('ready');
    chooseHolder.current = { ok: true };
    getGenerationSpy.mockClear();
    chooseVariantSpy.mockClear();
    getBriefSpy.mockClear();
    readHomePoolsSpy.mockClear();
    redirectSpy.mockClear();
  });

  // covers: AC-235-5
  it('scegliere una variante da "ready" REINDIRIZZA a /{locale}/preview/{siteId}', async () => {
    const res = await selectVariant({
      siteId: SITE_ID,
      generationId: GEN_ID,
      locale: 'it',
      variantIndex: 0,
    });

    // then: la transizione ready->chosen e' avvenuta e il ramo di successo ha REINDIRIZZATO
    // all'anteprima — e' il punto da cui /preview si raggiunge. Non la sottostringa: la CHIAMATA.
    expect(chooseVariantSpy).toHaveBeenCalledTimes(1); // covers: AC-235-5
    expect(redirectSpy).toHaveBeenCalledWith(`/it/preview/${SITE_ID}`); // covers: AC-235-5
    // il ramo 'ready' non torna un oggetto d'errore: reindirizza (redirect mockato torna undefined).
    expect(res).toBeUndefined(); // covers: AC-235-5
  });
});
