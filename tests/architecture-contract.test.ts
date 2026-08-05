import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// architecture-hardening / T-AH6 — GATE DI ALTITUDINE `architecture:` REPO-WIDE.
//
// Storia: T-312 (P3) ha ATTIVATO il contratto, ma con SCOPE ONESTO sulla sola superficie
// editor-core, perche' il repo portava 7 archi legacy `domain->data` (auth/login, auth/signup,
// generation/phase1|2, import/fromUrl, onboarding/interview, setLocale) fuori dallo scope di P3.
// Il macrotask 'architecture-hardening' li ha BONIFICATI (relayer in src/app / src/data +
// dependency inversion della porta LLM di onboarding), e questo file ora ENFORCA il contratto
// REPO-WIDE: zero archi vietati su TUTTI i sorgenti, non piu' filtrato alla superficie.
//
// Il blocco `architecture:` (strati + dipendenze vietate) resta dichiarato UNA VOLTA in
// docs/blueprint/P3-editor/00-INDEX.md §1bis (fonte di verita' del layering). Questo test lo
// pinna contro il GRAFO IMPORT REALE. L'oracolo trueline `arch_check.mjs` vive in una plugin-cache
// immutabile FUORI dal repo e gira madge SENZA --ts-config (cieco sugli alias @/, quindi
// blind-green su questo repo alias-heavy): l'enforcement REALE e' percio' QUESTO test versionato e
// alias-aware, non l'oracolo. Se un giorno l'oracolo upstream risolvesse gli alias, si potra'
// estrarre questa logica in un modulo condiviso; oggi non c'e' nulla da cui importare.
//
// TRE PROPRIETA' che il gate mantiene, e ognuna sa diventare rossa:
// (1) ALIAS-AWARE. Il grafo si costruisce con madge risolvendo `@/…` via i `paths` di tsconfig
//     (`@/*` -> `./src/*`). 318/318 import del repo usano `@/…`: senza risoluzione il grafo e'
//     cieco (~20 archi relativi, 0 cross-layer). Con essa ha centinaia di archi reali.
// (2) REPO-WIDE ZERO. evaluateContract sul grafo alias-aware non trova ALCUNA violazione delle 4
//     regole forbidden (domain->ui/data/app, data->ui), su tutti i sorgenti. I 7 archi legacy non
//     esistono piu'.
// (3) TESTIMONE DI NON-VACUITA' POSITIVO (sostituisce l'ex "esattamente 7"). Provato che il resolver
//     NON e' cieco: il grafo alias-aware VEDE archi cross-layer @/ LECITI (es. app->data, che il
//     contratto permette e che esistono in abbondanza), mentre il grafo cieco ne vede molti meno /
//     zero. Se la risoluzione alias regredisse, quel conteggio collasserebbe e questa guardia
//     diventerebbe rossa: nessun verde vacuo puo' passare. L'ex testimone contava le 7 violazioni
//     legacy, che la bonifica ha rimosso — un testimone POSITIVO su archi leciti e' quello che
//     sopravvive alla bonifica.
//
// FALSIFICABILITA' (AC-AH6-2): il gate vale solo se sa diventare rosso. Il test SCRIVE una fixture
// temporanea in src/data/ che importa `@/ui/…` — un arco vietato `data->ui` via ALIAS, risolto solo
// perche' il grafo e' alias-aware. Poiche' il repo e' altrimenti PULITO, quella fixture diventa
// l'UNICA violazione repo-wide: il gate la segnala (rosso) e nessun'altra violazione compare. La
// fixture e' rimossa nel finally/afterEach/afterAll: nessuna violazione reale resta nell'albero.

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

// La fixture di falsificabilita': un modulo DATI che importa la UI per via ALIAS.
// src/ui/lib/cn.ts esiste ed e' il bersaglio; `@/ui/lib/cn` vi risolve SOLO col grafo
// alias-aware (il punto della proprieta' 1).
const FIXTURE_PATH = resolve(SRC, 'data', '__arch_contract_fixture__.ts');
const FIXTURE_KEY = 'src/data/__arch_contract_fixture__.ts';
const FIXTURE_TARGET = 'src/ui/lib/cn.ts';
const FIXTURE_SOURCE =
  '// FIXTURE TEMPORANEA scritta e rimossa da tests/architecture-contract.test.ts (T-AH6).\n' +
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
// (L-COL-006), mai findings:[] nudo.
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

// Archi DIRETTI src->dep dove src e' nello strato `from` e dep nello strato `to`. E' la misura del
// TESTIMONE POSITIVO di non-vacuita': gli archi cross-layer @/ LECITI (es. app->data) che il grafo
// alias-aware vede e il grafo cieco perde. Se scendessero al livello del grafo cieco, il resolver
// sarebbe regredito.
function crossLayerEdges(
  graph: MadgeGraph,
  layers: Record<string, string>,
  fromLayer: string,
  toLayer: string,
): string[] {
  const edges: string[] = [];
  for (const [src, deps] of Object.entries(graph)) {
    if (layerOf(src, layers) !== fromLayer) continue;
    for (const dep of deps) {
      if (layerOf(dep, layers) === toLayer) edges.push(`${src} -> ${dep}`);
    }
  }
  return edges;
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

describe('contratto di altitudine architecture: repo-wide (architecture-hardening / T-AH6)', () => {
  let contract: Contract | null;
  let cleanGraph: MadgeGraph; // alias-aware, repo-wide
  let noAliasGraph: MadgeGraph; // senza tsConfig: la cecita' del gate upstream

  beforeAll(async () => {
    removeFixture(); // nessun residuo di run precedenti prima di misurare il grafo pulito
    contract = loadContract(BLUEPRINT_INDEX);
    cleanGraph = await buildGraph(true);
    noAliasGraph = await buildGraph(false);
  }, 60000);

  afterEach(() => { removeFixture(); }); // la fixture di falsificabilita' non sopravvive mai a un test
  afterAll(() => { removeFixture(); });

  // covers: AC-AH6-1
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

  // covers: AC-AH6-3
  it('il resolver alias-aware NON e cieco: vede archi cross-layer @/ leciti che madge-senza-alias non vede', () => {
    const c = contract as Contract;
    expect(c).not.toBeNull();

    // Il grafo alias-aware ha molti piu' archi di quello cieco: la risoluzione degli alias `@/…`
    // produce archi reali. Soglie robuste, non conteggi esatti.
    expect(edgeCount(cleanGraph), 'grafo alias-aware troppo scarno: la risoluzione @/ potrebbe essere regredita').toBeGreaterThan(200);
    expect(edgeCount(noAliasGraph), 'grafo senza-alias inatteso: dovrebbe avere pochissimi archi (solo relativi)').toBeLessThan(50);

    // CECITA' del grafo senza-tsConfig (la stessa dell'oracolo upstream): scarta i 318 import @/ e
    // non vede ALCUNA violazione — un gate cosi' e' verde perche' cieco, mai perche' pulito.
    const evalNoAlias = evaluateContract(noAliasGraph, c);
    expect(evalNoAlias.degraded, `grafo senza-alias degradato: ${evalNoAlias.detail}`).toBe(false);
    expect(
      evalNoAlias.violations,
      'atteso 0 violazioni dal grafo CIECO (la prova che senza alias non vede nulla)',
    ).toHaveLength(0);

    // TESTIMONE POSITIVO DI NON-VACUITA': il grafo alias-aware VEDE archi cross-layer LECITI
    // `app->data` (la rotta/azione legge e scrive i dati: permesso dal contratto e abbondante),
    // mentre il grafo cieco ne vede molti meno (gli import sono tutti via alias `@/data/…`). Se la
    // risoluzione alias regredisse, questo conteggio collasserebbe e il test diventerebbe rosso:
    // prova che un "verde repo-wide" non e' vacuo. Sostituisce l'ex testimone che contava le 7
    // violazioni legacy, rimosse da architecture-hardening.
    const appToDataAlias = crossLayerEdges(cleanGraph, c.layers, 'app', 'data');
    const appToDataBlind = crossLayerEdges(noAliasGraph, c.layers, 'app', 'data');
    expect(
      appToDataAlias.length,
      'nessun arco app->data alias-risolto: la risoluzione @/ e regredita o app non tocca piu i dati',
    ).toBeGreaterThan(0);
    expect(
      appToDataBlind.length,
      `il grafo cieco vede tanti archi app->data quanto quello alias-aware (${appToDataBlind.length} vs ${appToDataAlias.length}): la risoluzione alias non aggiunge nulla, sospetto regressione`,
    ).toBeLessThan(appToDataAlias.length);
  });

  // covers: AC-AH6-1
  it('gate REPO-WIDE: zero archi vietati su TUTTI i sorgenti (verde, non vacuo)', () => {
    const c = contract as Contract;
    expect(c).not.toBeNull();
    const evalAlias = evaluateContract(cleanGraph, c);
    expect(evalAlias.degraded, `contratto degradato: ${evalAlias.detail}`).toBe(false);

    // IL GATE: zero violazioni delle 4 regole forbidden su TUTTO il repo (non piu' filtrato alla
    // superficie P3). I 7 archi legacy domain->data sono stati bonificati da architecture-hardening;
    // la non-vacuita' e' garantita da vacuity guard (ogni regola mappa moduli reali) + testimone
    // positivo (il resolver vede archi cross-layer leciti).
    expect(
      evalAlias.violations,
      `violazioni di altitudine repo-wide: ${evalAlias.violations.map((v) => `${v.source_module} -> ${v.target_module} [${v.from}->${v.to}]`).join('; ')}`,
    ).toHaveLength(0);
  });

  // covers: AC-AH6-2
  it('e falsificabile: un arco vietato data->ui deliberato diventa ROSSO ed e l UNICA violazione', async () => {
    const c = contract as Contract;
    expect(c).not.toBeNull();
    try {
      writeFileSync(FIXTURE_PATH, FIXTURE_SOURCE, 'utf8');
      const dirtyGraph = await buildGraph(true);

      // La fixture e il suo arco ALIAS esistono davvero nel grafo (altrimenti la prova sarebbe
      // vacua): l'arco data->ui via `@/ui/lib/cn` e' stato risolto dal grafo alias-aware — se non
      // lo fosse, la proprieta' (1) sarebbe regredita.
      expect(dirtyGraph[FIXTURE_KEY], 'la fixture non e stata scansionata da madge').toBeDefined();
      expect(dirtyGraph[FIXTURE_KEY], `alias @/ui/lib/cn non risolto: atteso arco a ${FIXTURE_TARGET}`).toContain(FIXTURE_TARGET);

      const evalDirty = evaluateContract(dirtyGraph, c);
      expect(evalDirty.degraded, `atteso non-degradato con violazioni: ${evalDirty.detail}`).toBe(false);

      // ROSSO: il gate segnala l'arco vietato data->ui della fixture.
      expect(
        evalDirty.violations.some((v) => v.from === 'data' && v.to === 'ui' && v.source_module === FIXTURE_KEY),
        'un import vietato deliberato non ha prodotto ROSSO',
      ).toBe(true);

      // E IL REPO E' ALTRIMENTI PULITO: la fixture e' l'UNICA violazione repo-wide. Prova insieme
      // che il gate sa diventare rosso E che nessun altro arco vietato si nasconde nel repo (se
      // ce ne fosse uno, comparirebbe qui come violazione con source_module != fixture).
      expect(
        evalDirty.violations.every((v) => v.source_module === FIXTURE_KEY),
        `violazioni repo-wide oltre la fixture: ${evalDirty.violations.filter((v) => v.source_module !== FIXTURE_KEY).map((v) => `${v.source_module} [${v.from}->${v.to}]`).join('; ')}`,
      ).toBe(true);
    } finally {
      removeFixture();
    }
    // La fixture e' stata rimossa: nessuna violazione reale resta nell'albero.
    expect(existsSync(FIXTURE_PATH)).toBe(false);
  }, 60000);
});
