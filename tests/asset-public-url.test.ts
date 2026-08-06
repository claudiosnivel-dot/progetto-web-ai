import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { assetPublicUrl, SITE_ASSETS_BUCKET } from '@/config/storage';

// T-414 (macrotask media-storage, P4) — ORACOLO dell'URL pubblico dell'asset costruito dal SOLO
// asset_id (mai da testo libero, P2-D12). Le asserzioni DERIVANO da AC-414-1..4 (blueprint
// 04-media-storage, aggiornati all'emendamento P4-D6a), taggate `// covers: AC-414-<n>` sulla riga
// dell'EXPECT.
//
// PURO, NESSUN I/O: `assetPublicUrl` e' una funzione di config senza effetti; la sorgente d'ambiente
// e' passata ESPLICITA come secondo argomento ({ NEXT_PUBLIC_SUPABASE_URL }) — nessun process.env,
// nessuna rete, nessun DB. Rispecchia il consumo reale di M3 (tests/seo-metadata.test.ts,
// tests/jsonld-localbusiness.test.ts, src/app/s/[slug]/page.tsx), che gia' chiamano la funzione con
// la stessa firma.
//
// FALSIFICABILITA': l'URL pubblico e' quello CANONICO ESATTO del public object di Supabase Storage
// nel NOSTRO bucket; una variante che cambiasse forma, host, bucket, o che facesse entrare del testo
// libero nel path, andrebbe ROSSA.
//
// P4-D6a: la chiave dell'oggetto e' PIATTA = <asset_id> (uuid v4 opaco). La prova di P2-D12 e' PER
// FIRMA — la funzione prende SOLO l'asset_id (piu' la sorgente env di config), quindi filename,
// caption, URL assoluto, `javascript:` o `../` non hanno alcun parametro in cui entrare. NON tocco
// src/config/storage.ts (invariata da M3, VERDE): blast-radius zero.

// ── origine Storage (config pubblica, non un segreto) ────────────────────────────
const SUPA = 'https://xyzcompany.supabase.co';

// Percorso del modulo sotto esame per gli scan strutturali (prova P2-D12 per FIRMA). Costruito da
// process.cwd() (radice del repo), come in tests/seo-metadata.test.ts.
const STORAGE_SRC_PATH = resolve(process.cwd(), 'src/config/storage.ts');

// ── fixture: PIU' di un asset, valori DISCORDANTI, una NEAR-COLLISION di prefisso ─────────────────
// HERO e SIBLING condividono un prefisso di 35 caratteri e differiscono SOLO nell'ultima cifra: un
// uuid ha lunghezza FISSA (36), quindi un vero "prefisso proprio" e' irrappresentabile fra due uuid
// validi (un prefisso troncato NON passa z.string().uuid()); questa e' la stressatura piu' vicina —
// chi selezionasse per prefisso invece che per identita' esatta li confonderebbe.
const ASSET_HERO = '11111111-1111-4111-8111-111111111111';
const ASSET_SIBLING = '11111111-1111-4111-8111-111111111112'; // near-collision (35 char condivisi)
const ASSET_OTHER = '22222222-2222-4222-8222-222222222222';
const ASSET_DISCORD = 'a1c9f3e2-7b64-4d0a-9e15-0c2b6f8d4a37'; // forma del tutto discordante
const ASSETS = [ASSET_HERO, ASSET_SIBLING, ASSET_OTHER, ASSET_DISCORD];

// Helper LOCALI al file: URL costruito con sorgente env esplicita (puro), e forma canonica attesa.
const url = (assetId: string) => assetPublicUrl(assetId, { NEXT_PUBLIC_SUPABASE_URL: SUPA });
const canonical = (assetId: string) =>
  `${SUPA}/storage/v1/object/public/${SITE_ASSETS_BUCKET}/${assetId}`;

// ═══════════════════════════════════════════════════════════════════════════════
describe('T-414 assetPublicUrl — URL pubblico canonico ESATTO dal solo asset_id (AC-414-1)', () => {
  // covers: AC-414-1
  it('ritorna <origin>/storage/v1/object/public/site-assets/<assetId>, byte-esatto', () => {
    // Il nome del bucket e' pinnato: la forma canonica dipende da 'site-assets' (M4/T-412 crea QUESTO
    // bucket). Un rename divergerebbe in silenzio senza questa ancora.
    expect(SITE_ASSETS_BUCKET).toBe('site-assets'); // covers: AC-414-1
    expect(url(ASSET_HERO)).toBe(
      `${SUPA}/storage/v1/object/public/site-assets/${ASSET_HERO}`,
    ); // covers: AC-414-1
    // Stessa forma via l'helper canonico (host + path del public object di Storage).
    expect(url(ASSET_HERO)).toBe(canonical(ASSET_HERO)); // covers: AC-414-1
    // Sotto il NOSTRO host Storage e il NOSTRO bucket pubblico, non altrove.
    expect(url(ASSET_HERO).startsWith(`${SUPA}/storage/v1/object/public/${SITE_ASSETS_BUCKET}/`)).toBe(true); // covers: AC-414-1
  });

  // covers: AC-414-1
  it('origine con spazi e slash in coda: nessun `//`, forma canonica preservata', () => {
    // Consumo reale (M3): la funzione ripulisce l'origine. La forma canonica resta identica.
    const dirty = assetPublicUrl(ASSET_HERO, { NEXT_PUBLIC_SUPABASE_URL: `  ${SUPA}//  ` });
    expect(dirty).toBe(canonical(ASSET_HERO)); // covers: AC-414-1
    expect(dirty.includes('//storage')).toBe(false); // covers: AC-414-1
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('T-414 P2-D12 per FIRMA — nessun testo libero puo entrare nell URL (AC-414-2)', () => {
  // covers: AC-414-2
  it('la funzione prende SOLO l asset_id: un uuid valido produce solo il path uuid, nulla appeso', () => {
    const out = url(ASSET_HERO);
    // Il singolo componente di path dopo il bucket e' ESATTAMENTE l'uuid: nessun `/` o `..` iniettato,
    // nessun testo appeso (path traversal impossibile — componente opaco singolo).
    const tail = out.split(`/${SITE_ASSETS_BUCKET}/`)[1];
    expect(tail).toBe(ASSET_HERO); // covers: AC-414-2
    expect(tail.includes('/')).toBe(false); // covers: AC-414-2
    expect(tail.includes('..')).toBe(false); // covers: AC-414-2
    expect(out).toBe(canonical(ASSET_HERO)); // covers: AC-414-2
  });

  // covers: AC-414-2
  it('per FIRMA: un solo argomento posizionale richiesto (asset_id); nessun parametro di testo libero', () => {
    // arity dichiarata = 1: il SOLO argomento richiesto e' l'asset_id. La sorgente env e' un parametro
    // opzionale di CONFIG (Record), non un campo di testo del brief. Non esiste uno slot per
    // filename/caption/URL: il testo libero e' strutturalmente escluso.
    expect(assetPublicUrl.length).toBe(1); // covers: AC-414-2

    // Scan strutturale del modulo (fonte): l'URL nasce SOLO da origine (env), nome bucket e assetId.
    const src = readFileSync(STORAGE_SRC_PATH, 'utf8');
    // Il path del public object interpola SOLO ${origin}, ${SITE_ASSETS_BUCKET}, ${assetId}.
    expect(src).toContain('${origin}/storage/v1/object/public/${SITE_ASSETS_BUCKET}/${assetId}'); // covers: AC-414-2
    // Nessun identificatore di campo di testo libero (P2-D12) e' letto/interpolato nel modulo.
    for (const freeText of ['filename', 'caption', 'href', 'originalName', 'javascript:']) {
      expect(src.includes(freeText)).toBe(false); // covers: AC-414-2
    }
  });

  // covers: AC-414-2
  it('un contesto con metadati ostili (URL assoluto, javascript:, ../) NON ha dove entrare', () => {
    // Nessuna di queste stringhe di testo libero e' un argomento accettato: l'URL prodotto dal solo
    // asset_id non le contiene (non c'e' parametro in cui possano essere passate).
    const HOSTILE = ['https://evil.example/x', 'javascript:alert(1)', '../../etc/passwd', 'file.png?a=1'];
    const out = url(ASSET_HERO);
    for (const h of HOSTILE) {
      expect(out.includes(h)).toBe(false); // covers: AC-414-2
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('T-414 near-collision di prefisso — ogni asset al proprio URL distinto (AC-414-3)', () => {
  // covers: AC-414-3
  it('fixture con >1 asset e una near-collision: URL tutti distinti, identita esatta, nessuna collisione da prefisso', () => {
    // Sanity: i due id della near-collision sono uuid PIENI e VALIDI (differiscono solo nell'ultima
    // cifra); un prefisso PROPRIO (troncato) NON passerebbe — cosi' la trappola e' una near-collision,
    // non un vero prefisso, come pretende parseDocument (z.string().uuid() su asset_id).
    const uuid = z.string().uuid();
    expect(uuid.safeParse(ASSET_HERO).success).toBe(true); // covers: AC-414-3
    expect(uuid.safeParse(ASSET_SIBLING).success).toBe(true); // covers: AC-414-3
    expect(ASSET_HERO.slice(0, 35)).toBe(ASSET_SIBLING.slice(0, 35)); // 35 char condivisi // covers: AC-414-3
    expect(uuid.safeParse(ASSET_HERO.slice(0, 35)).success).toBe(false); // prefisso proprio: NON valido // covers: AC-414-3

    // Ogni asset mappa al PROPRIO URL, tutti distinti (nessuna collisione).
    const urls = ASSETS.map(url);
    expect(new Set(urls).size).toBe(ASSETS.length); // covers: AC-414-3
    for (const id of ASSETS) {
      expect(url(id)).toBe(canonical(id)); // identita' esatta // covers: AC-414-3
      expect(url(id).endsWith(`/${id}`)).toBe(true); // covers: AC-414-3
    }

    // La near-collision produce URL DIVERSI e ciascuno finisce col PROPRIO id esatto (non col fratello).
    expect(url(ASSET_HERO)).not.toBe(url(ASSET_SIBLING)); // covers: AC-414-3
    expect(url(ASSET_HERO).endsWith(ASSET_SIBLING)).toBe(false); // covers: AC-414-3
    expect(url(ASSET_SIBLING).endsWith(ASSET_HERO)).toBe(false); // covers: AC-414-3
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('T-414 deterministico — byte-identico su chiamate ripetute (AC-414-4)', () => {
  // covers: AC-414-4
  it('due chiamate sullo stesso asset_id ritornano una stringa byte-identica (nessuno stato nascosto, nessun I/O)', () => {
    const a = url(ASSET_HERO);
    const b = url(ASSET_HERO);
    expect(a).toBe(b); // covers: AC-414-4
    // Byte-identica: stessa lunghezza e stesse code unit una a una.
    expect(a.length).toBe(b.length); // covers: AC-414-4
    expect([...a]).toEqual([...b]); // covers: AC-414-4

    // Nessuno stato nascosto: chiamare su altri asset in mezzo non altera il risultato.
    url(ASSET_OTHER);
    url(ASSET_SIBLING);
    expect(url(ASSET_HERO)).toBe(a); // covers: AC-414-4
  });
});
