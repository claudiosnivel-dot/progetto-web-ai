import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// T-312 — ATTIVAZIONE DEL CONTRATTO DI ALTITUDINE `architecture:` (P1-D11 / P3-D7).
//
// Il blocco `architecture:` (strati + dipendenze vietate) e' dichiarato UNA VOLTA in
// docs/blueprint/P3-editor/00-INDEX.md §1bis, ed e' la fonte di verita' del layering.
// Questo file lo pinna contro il GRAFO IMPORT REALE. Non esiste ancora un oracolo
// separato (`scripts/oracles/arch_check.mjs` e' pianificato nel blueprint ma NON e'
// implementato: cfr. il repo — nessuno script gira al checkpoint per l'altitudine, e le
// guardie ESLint sorvegliano SOLO i confini privilegiati service_role/Anthropic/tema, non
// l'altitudine fra strati). Percio' QUESTO test E' l'attivazione del contratto: la logica
// di valutazione e' embeddata qui. Se un giorno nasce l'oracolo di checkpoint, si estragga
// questa logica in un modulo condiviso per non far divergere i due — oggi non c'e' nulla da
// cui importare, e questo commento e' la nota di drift richiesta.
//
// ── FX-ARCH / D1 — TRE CORREZIONI RISPETTO ALLA PRIMA STESURA ─────────────────────────
//
// (1) ALIAS-AWARE. Il grafo si costruisce con `madge` RISOLVENDO gli alias `@/…` via i
//     `paths` di tsconfig.json (`@/*` -> `./src/*`). La prima stesura girava madge SENZA
//     tsConfig "per coincidere col gate": ma 318/318 import del repo usano `@/…`, che
//     madge-senza-tsConfig SCARTA — il grafo restava a ~20 archi relativi e ZERO archi
//     cross-layer, cioe' un gate CIECO, verde perche' non vede nulla (il RILIEVO 2).
//     Con la risoluzione alias il grafo ha 338 archi reali e le violazioni diventano
//     visibili. La copertura resta quella di un grafo import STATICO: cieco a reflection
//     e DI dinamica, ma NON piu' cieco agli alias.
//
// (2) SCOPE ONESTO — GATE SULLA SUPERFICIE P3, NON REPO-WIDE. Il repo ha oggi 7
//     violazioni legacy `domain->data` (auth/login, auth/signup, generation/phase1|2,
//     import/fromUrl, onboarding/interview, setLocale — tutte sotto src/domain/**). NON
//     appartengono a editor-core: sono debito del macrotask SUCCESSIVO
//     'architecture-hardening'. Un gate repo-wide sarebbe percio' rosso per cause
//     estranee a P3. Qui si asserisce quindi ZERO archi vietati ORIGINATI DALLA
//     SUPERFICIE editor-core (src/ui/editor/**, src/app/[locale]/editor/**, e i moduli
//     src/data toccati da editor-core) — pulita dopo FX-CHOOSE. Le 7 legacy restano
//     VISTE ma NON fanno fallire il gate: sono documentate e deferite.
//
// (3) VACUITY GUARD REALE (chiude il RILIEVO 2). Non basta contare i nodi per strato: un
//     resolver rotto darebbe strati pieni ma archi zero, e un futuro "verde" sarebbe
//     vacuo. Percio' si PROVA che il resolver NON e' cieco — il grafo alias-aware VEDE le
//     7 violazioni cross-layer legacy che l'oracolo madge-senza-tsConfig NON vede (0),
//     enumerate esattamente. Se la risoluzione alias regredisse, quel conteggio
//     collasserebbe a 0 e questa guardia diventerebbe rossa: nessun verde vacuo puo'
//     passare.
//
// FALSIFICABILITA' (AC-312-2): la guardia vale solo se sa diventare rossa. Il test SCRIVE
// una fixture temporanea in src/data/ che importa `@/ui/…` — un arco vietato `data->ui`
// via ALIAS (la classe di regressione che FX-CHOOSE ha chiuso), risolto solo perche' il
// grafo e' alias-aware. Trattata come un NUOVO modulo dati di editor-core (aggiunta alla
// superficie) fa diventare il gate ROSSO; con la superficie di produzione (fixture esclusa)
// lo STESSO arco NON viene segnalato — prova che il filtro di superficie filtra davvero, in
// entrambe le direzioni. La fixture e' PULITA nel finally + afterEach: nessuna violazione
// reale resta nell'albero.

const require = createRequire(import.meta.url);

/** Superficie minima di madge che usiamo (il pacchetto non spedisce type e @types/madge e' assente). */
type MadgeGraph = Record<string, string[]>;
type Madge = (path: string, config?: Record<string, unknown>) => Promise<{ obj(): MadgeGraph }>;
const madge = require('madge') as Madge;

const ROOT = process.cwd();
const SRC = resolve(ROOT, 'src');
const TSCONFIG = resolve(ROOT, 'tsconfig.json');
const BLUEPRINT_INDEX = resolve(ROOT, 'docs/blueprint/P3-editor/00-INDEX.md');

// Le stesse estensioni che scansiona il codice sorgente del builder.
const MADGE_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'];

// --- Superficie editor-core (scope P3, non repo-wide) ----------------------------------
// I file src/data toccati da editor-core sono enumerati (non c'e' un glob che li isoli):
// e' l'unica forma onesta dello scope. generation-choose.ts e' incluso perche' e' il
// modulo dove FX-CHOOSE ha rimosso l'arco data->ui (variant-document spostato ui->domain):
// e' l'ancora di falsificabilita' reale — se qualcuno ri-importasse @/ui da qui, il gate
// tornerebbe rosso.
const SURFACE_GLOBS = ['src/ui/editor/**', 'src/app/[locale]/editor/**'];
const SURFACE_DATA = [
  'src/data/site-document-revisions.ts', // T-301: tabella + revisioni (nuovo)
  'src/data/generation-document.ts', // T-304: read-path ultima-revisione-else-baseline (modificato)
  'src/data/generation-choose.ts', // FX-CHOOSE: ex data->ui, ora data->domain (ancora del fix)
];

// Le 7 violazioni legacy `domain->data` presenti nel repo: debito del macrotask
// 'architecture-hardening', FUORI dallo scope di editor-core. Enumerate perche' sono la
// testimonianza che il resolver alias-aware vede archi cross-layer reali (vacuity guard).
const LEGACY_DOMAIN_DATA = [
  'src/domain/auth/login.ts',
  'src/domain/auth/signup.ts',
  'src/domain/generation/phase1.ts',
  'src/domain/generation/phase2.ts',
  'src/domain/import/fromUrl.ts',
  'src/domain/onboarding/interview.ts',
  'src/domain/setLocale.ts',
].sort();

// La fixture di falsificabilita': un modulo DATI che importa la UI per via ALIAS.
// src/ui/lib/cn.ts esiste ed e' il bersaglio; `@/ui/lib/cn` vi risolve SOLO col grafo
// alias-aware (il punto della correzione 1).
const FIXTURE_PATH = resolve(SRC, 'data', '__arch_contract_fixture__.ts');
const FIXTURE_KEY = 'src/data/__arch_contract_fixture__.ts';
const FIXTURE_TARGET = 'src/ui/lib/cn.ts';
const FIXTURE_SOURCE =
  '// FIXTURE TEMPORANEA scritta e rimossa da tests/architecture-contract.test.ts (T-312).\n' +
  '// Import ALIAS data->ui deliberato: prova che il gate di altitudine sa diventare rosso.\n' +
  "import '@/ui/lib/cn';\n" +
  'export {};\n';

// --- Contratto: caricato dal blueprint, non re-inventato -------------------------------

type Contract = { layers: Record<string, string>; forbidden: Array<{ from: string; to: string; mode?: string }> };

function unquote(v: string): string {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

/**
 * Parsa il SOLO sotto-schema `architecture:` dal primo blocco ```yaml di 00-INDEX che lo
 * contiene. Ritorna null se assente: i test lo trattano come premessa fallita (rosso
 * rumoroso), mai come verde vacuo.
 */
function loadContract(indexPath: string): Contract | null {
  const text = readFileSync(indexPath, 'utf8');
  const blocks = [...text.matchAll(/```ya?ml\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const block = blocks.find((b) => /^architecture:\s*$/m.test(b));
  if (!block) return null;
  const lines = block.replace(/\r\n/g, '\n').split('\n');
  const indentOf = (l: string) => l.length - l.trimStart().length;
  let i = 0;
  while (i < lines.length && !/^architecture:\s*$/.test(lines[i])) i++;
  if (i >= lines.length) return null;
  i++;
  const layers: Record<string, string> = {};
  const forbidden: Array<{ from: string; to: string; mode?: string }> = [];
  let section: 'layers' | 'forbidden' | 'allow' | null = null;
  for (; i < lines.length; i++) {
    const rawLine = lines[i];
    const ind = indentOf(rawLine);
    const t = rawLine.replace(/(^|\s)#.*$/, '$1').trim(); // commento inline # (il blocco non ne ha)
    if (t === '') continue;
    if (ind === 0) break; // fine del blocco architecture
    const sec = t.match(/^(layers|forbidden|allow):\s*$/);
    if (sec && ind <= 2) { section = sec[1] as 'layers' | 'forbidden' | 'allow'; continue; }
    if (section === 'layers') {
      const kv = t.match(/^([A-Za-z_][\w-]*):\s*(.+)$/);
      if (kv) layers[kv[1]] = unquote(kv[2]);
    } else if (section === 'forbidden') {
      const item = t.match(/^-\s*\{(.*)\}\s*$/);
      if (item) {
        const obj: Record<string, string> = {};
        for (const part of item[1].split(',')) {
          const idx = part.indexOf(':');
          if (idx < 0) continue;
          const k = part.slice(0, idx).trim();
          if (k) obj[k] = unquote(part.slice(idx + 1));
        }
        if (obj.from && obj.to) forbidden.push(obj as { from: string; to: string; mode?: string });
      }
    }
  }
  return { layers, forbidden };
}

// --- Grafo e valutazione ---------------------------------------------------------------

// glob -> RegExp: ** = qualunque (incl. /); * = qualunque tranne /.
function globToRegExp(glob: string): RegExp {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if ('/.+?^${}()|[]\\'.includes(c)) { re += '\\' + c; }
    else re += c;
  }
  return new RegExp(re + '$');
}

// Strato di un modulo: fra i glob che matchano vince il PIU' SPECIFICO (prefisso letterale
// piu' lungo); nessun match -> null.
function layerOf(modulePath: string, layers: Record<string, string>): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const [name, glob] of Object.entries(layers)) {
    if (globToRegExp(String(glob)).test(modulePath)) {
      const litLen = String(glob).split('*')[0].length;
      if (litLen > bestLen) { best = name; bestLen = litLen; }
    }
  }
  return best;
}

function allNodes(graph: MadgeGraph): string[] {
  const all = new Set<string>(Object.keys(graph));
  for (const deps of Object.values(graph)) for (const d of deps) all.add(d);
  return [...all];
}

// Moduli (chiavi + valori del grafo) assegnati a ciascuno strato.
function modulesByLayer(graph: MadgeGraph, layers: Record<string, string>): Record<string, string[]> {
  const byLayer: Record<string, string[]> = {};
  for (const name of Object.keys(layers)) byLayer[name] = [];
  for (const m of allNodes(graph)) { const L = layerOf(m, layers); if (L) byLayer[L].push(m); }
  return byLayer;
}

// Un modulo di `toSet` e' raggiungibile da `src` traversando gli archi? (BFS transitivo:
// il contratto vieta la dipendenza anche indiretta quando la regola non fissa mode:'direct').
function reachTo(graph: MadgeGraph, src: string, toSet: Set<string>): { target: string; path: string[] } | null {
  const prev = new Map<string, string | null>([[src, null]]);
  const queue = [src];
  const hits: string[] = [];
  while (queue.length) {
    const node = queue.shift() as string;
    for (const dep of graph[node] || []) {
      if (prev.has(dep)) continue;
      prev.set(dep, node);
      if (toSet.has(dep)) hits.push(dep);
      queue.push(dep);
    }
  }
  if (!hits.length) return null;
  const target = hits.sort()[0];
  const path: string[] = [];
  for (let n: string | null = target; n != null; n = prev.get(n) ?? null) path.unshift(n);
  return { target, path };
}

type Violation = { from: string; to: string; source_module: string; target_module: string };
type Evaluation = { degraded: boolean; detail: string; violations: Violation[] };

// Valuta il contratto sul grafo (REPO-WIDE: sorgenti = tutti i moduli). Vacuity (grafo
// vuoto / 0 regole / regola con uno strato a 0 moduli) => degraded=true: NON verde
// (L-COL-006), mai findings:[] nudo. Il filtro di superficie (gate P3) si applica DOPO,
// sulle violazioni.
function evaluateContract(graph: MadgeGraph, contract: Contract): Evaluation {
  const layers = contract.layers || {};
  const rules = contract.forbidden || [];
  if (!graph || Object.keys(graph).length === 0) return { degraded: true, detail: 'grafo vuoto', violations: [] };
  if (rules.length === 0) return { degraded: true, detail: '0 regole forbidden (contratto vacuo)', violations: [] };
  const byLayer = modulesByLayer(graph, layers);
  for (const r of rules) {
    if ((byLayer[r.from] || []).length === 0 || (byLayer[r.to] || []).length === 0) {
      return { degraded: true, detail: `regola ${r.from}->${r.to}: uno strato mappa 0 moduli (regola morta)`, violations: [] };
    }
  }
  const violations: Violation[] = [];
  const seen = new Set<string>();
  for (const r of rules) {
    const toSet = new Set(byLayer[r.to]);
    for (const src of byLayer[r.from].slice().sort()) {
      let hit: { target: string; path: string[] } | null = null;
      if (r.mode === 'direct') {
        const t = (graph[src] || []).filter((d) => toSet.has(d)).sort()[0];
        if (t) hit = { target: t, path: [src, t] };
      } else {
        hit = reachTo(graph, src, toSet);
      }
      if (!hit) continue;
      const key = `${r.from}|${r.to}|${src}`;
      if (seen.has(key)) continue;
      seen.add(key);
      violations.push({ from: r.from, to: r.to, source_module: src, target_module: hit.target });
    }
  }
  return { degraded: false, detail: `${violations.length} violazioni`, violations };
}

// Gate di superficie: le sole violazioni la cui SORGENTE e' sulla superficie editor-core.
function surfaceViolations(violations: Violation[], isSurfaceFn: (m: string) => boolean): Violation[] {
  return violations.filter((v) => isSurfaceFn(v.source_module));
}

function isSurface(m: string): boolean {
  for (const g of SURFACE_GLOBS) if (globToRegExp(g).test(m)) return true;
  return SURFACE_DATA.includes(m);
}

// Costruisce il grafo import REALE. path ri-prefissati a `src/` cosi' i glob del contratto
// ("src/ui/**") agganciano i moduli. Con tsConfig -> alias `@/…` risolti (grafo reale);
// senza -> alias scartati (grafo cieco, usato solo per PROVARE la cecita').
async function buildGraph(withAlias: boolean): Promise<MadgeGraph> {
  const cfg: Record<string, unknown> = { baseDir: SRC, fileExtensions: MADGE_EXTENSIONS };
  if (withAlias) cfg.tsConfig = TSCONFIG;
  const res = await madge(SRC, cfg);
  const raw = res.obj();
  const out: MadgeGraph = {};
  for (const [k, deps] of Object.entries(raw)) out['src/' + k] = (deps || []).map((d) => 'src/' + d);
  return out;
}

function edgeCount(graph: MadgeGraph): number {
  let n = 0;
  for (const deps of Object.values(graph)) n += deps.length;
  return n;
}

function removeFixture(): void {
  if (existsSync(FIXTURE_PATH)) rmSync(FIXTURE_PATH);
}

// --- Suite -----------------------------------------------------------------------------

describe('contratto di altitudine architecture: (T-312)', () => {
  let contract: Contract | null;
  let cleanGraph: MadgeGraph; // alias-aware, superficie pulita
  let noAliasGraph: MadgeGraph; // senza tsConfig: la cecita' della prima stesura

  beforeAll(async () => {
    removeFixture(); // nessun residuo di run precedenti prima di misurare il grafo pulito
    contract = loadContract(BLUEPRINT_INDEX);
    cleanGraph = await buildGraph(true);
    noAliasGraph = await buildGraph(false);
  }, 60000);

  afterEach(() => { removeFixture(); }); // la fixture di falsificabilita' non sopravvive mai a un test
  afterAll(() => { removeFixture(); });

  // covers: AC-312-3
  it('vacuity guard: il contratto ha la forma attesa e ogni regola mappa >=1 modulo reale', () => {
    // Premessa rumorosa: il contratto e' stato letto e ha la forma attesa. Un parse vuoto
    // renderebbe vacui i controlli sotto — qui fallisce forte invece di passare in silenzio.
    expect(contract, 'blocco architecture: assente/illeggibile in 00-INDEX §1bis').not.toBeNull();
    const c = contract as Contract;
    expect(Object.keys(c.layers).sort()).toEqual(['app', 'data', 'domain', 'ui']);
    expect(c.layers).toMatchObject({
      ui: 'src/ui/**', domain: 'src/domain/**', data: 'src/data/**', app: 'src/app/**',
    });
    const rulePairs = c.forbidden.map((r) => `${r.from}->${r.to}`).sort();
    expect(rulePairs).toEqual(['data->ui', 'domain->app', 'domain->data', 'domain->ui']);

    // Vacuity vera: ciascuna regola dichiarata deve agganciare moduli reali, o e' morta.
    const byLayer = modulesByLayer(cleanGraph, c.layers);
    for (const r of c.forbidden) {
      expect(byLayer[r.from]?.length ?? 0, `strato from="${r.from}" mappa 0 moduli reali (regola morta ${r.from}->${r.to})`).toBeGreaterThan(0);
      expect(byLayer[r.to]?.length ?? 0, `strato to="${r.to}" mappa 0 moduli reali (regola morta ${r.from}->${r.to})`).toBeGreaterThan(0);
    }
  });

  // covers: AC-312-3
  it('il resolver alias-aware NON e cieco: vede le 7 violazioni cross-layer che madge-senza-alias non vede', () => {
    const c = contract as Contract;
    expect(c).not.toBeNull();

    // Il grafo alias-aware ha molti piu' archi di quello cieco (338 vs 20 alla misura): la
    // risoluzione degli alias `@/…` produce archi reali. Soglie robuste, non conteggi esatti.
    expect(edgeCount(cleanGraph), 'grafo alias-aware troppo scarno: la risoluzione @/ potrebbe essere regredita').toBeGreaterThan(200);
    expect(edgeCount(noAliasGraph), 'grafo senza-alias inatteso: dovrebbe avere pochissimi archi (solo relativi)').toBeLessThan(50);

    // CECITA' DELLA PRIMA STESURA: madge-senza-tsConfig scarta i 318 import @/ e non vede
    // ALCUNA violazione — un gate cosi' e' verde perche' cieco, mai perche' pulito.
    const evalNoAlias = evaluateContract(noAliasGraph, c);
    expect(evalNoAlias.degraded, `grafo senza-alias degradato: ${evalNoAlias.detail}`).toBe(false);
    expect(
      evalNoAlias.violations,
      'atteso 0 violazioni dal grafo CIECO (la prova che senza alias non vede nulla)',
    ).toHaveLength(0);

    // TESTIMONIANZA ANTI-VACUITA': il grafo alias-aware vede ESATTAMENTE le 7 violazioni
    // legacy domain->data. Sono FUORI SCOPE (macrotask 'architecture-hardening') e NON
    // fanno fallire il gate — ma la loro presenza prova che un futuro "verde" di superficie
    // non puo' essere vacuo: se la risoluzione alias regredisse, questo insieme si
    // svuoterebbe e il test diventerebbe rosso. Quando architecture-hardening le bonifica,
    // questa lista (e lo scope del gate) si aggiornano di conseguenza.
    const evalAlias = evaluateContract(cleanGraph, c);
    const seen = evalAlias.violations.map((v) => `${v.from}->${v.to}|${v.source_module}`).sort();
    const expected = LEGACY_DOMAIN_DATA.map((m) => `domain->data|${m}`).sort();
    expect(
      seen,
      `debito legacy domain->data inatteso (atteso esattamente le 7 note): ${seen.join('; ')}`,
    ).toEqual(expected);
  });

  // covers: AC-312-1
  it('gate P3: la superficie editor-core non origina alcun arco vietato (verde, non vacuo)', () => {
    const c = contract as Contract;
    expect(c).not.toBeNull();
    const evalAlias = evaluateContract(cleanGraph, c);
    expect(evalAlias.degraded, `contratto degradato: ${evalAlias.detail}`).toBe(false);

    // NON vacuo #1: il grafo VEDE violazioni reali (le 7 legacy). Il filtro di superficie
    // non sta girando su un grafo vuoto.
    expect(evalAlias.violations.length, 'il grafo alias-aware non vede alcuna violazione: sospetto grafo cieco').toBeGreaterThan(0);

    // NON vacuo #2: la superficie editor-core aggancia moduli reali (6 ui/editor + 2
    // app/editor + 3 data = 11 alla misura). Un "verde" con superficie vuota sarebbe finto.
    const surfaceNodes = allNodes(cleanGraph).filter(isSurface);
    expect(surfaceNodes.length, `superficie editor-core vuota nel grafo: ${surfaceNodes.join(', ')}`).toBeGreaterThanOrEqual(8);
    for (const f of SURFACE_DATA) {
      expect(surfaceNodes, `file dati di superficie assente dal grafo: ${f}`).toContain(f);
    }

    // IL GATE: zero violazioni ORIGINATE dalla superficie. Le 7 legacy (sorgenti
    // src/domain/**) sono fuori scope e restano fuori dal filtro.
    const surf = surfaceViolations(evalAlias.violations, isSurface);
    expect(
      surf,
      `violazioni di altitudine dalla superficie P3: ${surf.map((v) => `${v.source_module} -> ${v.target_module} [${v.from}->${v.to}]`).join('; ')}`,
    ).toHaveLength(0);

    // Coerenza dello scope: ogni violazione vista e' fuori-superficie (debito legacy).
    expect(
      evalAlias.violations.every((v) => !isSurface(v.source_module)),
      'una violazione legacy risulta erroneamente sulla superficie editor-core',
    ).toBe(true);
  });

  // covers: AC-312-2
  it('e falsificabile: un arco vietato data->ui dalla superficie diventa ROSSO (e il filtro filtra)', async () => {
    const c = contract as Contract;
    expect(c).not.toBeNull();
    try {
      writeFileSync(FIXTURE_PATH, FIXTURE_SOURCE, 'utf8');
      const dirtyGraph = await buildGraph(true);

      // La fixture e il suo arco ALIAS esistono davvero nel grafo (altrimenti la prova sotto
      // sarebbe vacua): l'arco data->ui via `@/ui/lib/cn` e' stato risolto dal grafo
      // alias-aware — se non lo fosse, la correzione (1) sarebbe regredita.
      expect(dirtyGraph[FIXTURE_KEY], 'la fixture non e stata scansionata da madge').toBeDefined();
      expect(dirtyGraph[FIXTURE_KEY], `alias @/ui/lib/cn non risolto: atteso arco a ${FIXTURE_TARGET}`).toContain(FIXTURE_TARGET);

      const evalDirty = evaluateContract(dirtyGraph, c);
      expect(evalDirty.degraded, `atteso non-degradato con violazioni: ${evalDirty.detail}`).toBe(false);

      // ROSSO: trattando la fixture come un NUOVO modulo dati di editor-core (sorgente sulla
      // superficie), il gate segnala l'arco vietato data->ui.
      const isSurfaceWithFixture = (m: string) => isSurface(m) || m === FIXTURE_KEY;
      const flagged = surfaceViolations(evalDirty.violations, isSurfaceWithFixture);
      expect(
        flagged.some((v) => v.from === 'data' && v.to === 'ui' && v.source_module === FIXTURE_KEY),
        'un import vietato deliberato dalla superficie non ha prodotto ROSSO',
      ).toBe(true);

      // IL FILTRO FILTRA: con la superficie di PRODUZIONE (fixture esclusa) lo STESSO arco
      // vietato NON viene segnalato — il gate non e' "sempre rosso", dipende davvero dalla
      // membership di superficie. Le 3 sorgenti dati reali restano pulite.
      const notFlagged = surfaceViolations(evalDirty.violations, isSurface);
      expect(
        notFlagged,
        `il filtro di superficie ha segnalato una sorgente fuori-superficie: ${notFlagged.map((v) => v.source_module).join(', ')}`,
      ).toHaveLength(0);
    } finally {
      removeFixture();
    }
    // La fixture e' stata rimossa: nessuna violazione reale resta nell'albero.
    expect(existsSync(FIXTURE_PATH)).toBe(false);
  }, 60000);
});
