// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { assetPublicUrl } from '@/config/storage';
import type { ImageSlot } from '@/domain/generation/document';
import { SiteImage } from '@/ui/site/SiteImage';

// T-415 (macrotask media-editor-render, P4) — ORACOLO del RENDER di uno slot immagine
// `uploaded`. Le asserzioni DERIVANO da AC-415-1..4 (blueprint 05-media-editor-render),
// taggate `// covers: AC-415-<n>` sulla riga dell'EXPECT.
//
// PROVA COSA: per un ImageSlot { source:'uploaded', asset_id } SiteImage rende un <img> il cui
// `src` e' ESATTAMENTE l'URL del NOSTRO builder (`assetPublicUrl`), costruito dal solo asset_id
// (P2-D12: mai da testo libero — l'unione non ha alcun campo url/src/href). La variante
// `theme-placeholder` NON regredisce: resta un riquadro decorativo (<div data-image-token>),
// nessun <img>.
//
// ANTI-DRIFT: il src atteso NON e' un template scritto a mano ma `assetPublicUrl(asset_id)` — lo
// STESSO builder che il componente usa, letto con la STESSA sorgente d'ambiente (process.env di
// default). Se il componente costruisse l'URL in un altro modo, il confronto cadrebbe; se il
// builder cambiasse forma, entrambi i lati si muoverebbero insieme (nessun falso rosso).

afterEach(() => cleanup());

// ── fixture: PIU' di un elemento, valori DISCORDANTI, una NEAR-COLLISION di prefisso ──────────────
// HERO e SIBLING condividono un prefisso di 35 caratteri e differiscono SOLO nell'ultima cifra:
// un uuid ha lunghezza FISSA (36), quindi un vero prefisso proprio e' irrappresentabile fra due
// uuid validi. Chi selezionasse per prefisso invece che per identita' esatta li confonderebbe.
const ASSET_HERO = '11111111-1111-4111-8111-111111111111';
const ASSET_SIBLING = '11111111-1111-4111-8111-111111111112'; // near-collision (35 char condivisi)
const ASSET_OTHER = '22222222-2222-4222-8222-222222222222'; // forma del tutto discordante

const uploaded = (assetId: string): ImageSlot => ({ source: 'uploaded', asset_id: assetId });

// Il src atteso costruito con lo STESSO builder e la STESSA sorgente env del componente.
const expectedSrc = (assetId: string) => assetPublicUrl(assetId);

// ═══════════════════════════════════════════════════════════════════════════════
// AC-415-1 — uno slot uploaded rende un <img> col src ESATTO dal nostro builder.
// ═══════════════════════════════════════════════════════════════════════════════

describe('T-415 AC-415-1 — uno slot uploaded rende un <img> col src da assetPublicUrl(asset_id)', () => {
  it('il src dell img e ESATTAMENTE assetPublicUrl(asset_id), costruito dal solo id', () => {
    const { container } = render(<SiteImage image={uploaded(ASSET_HERO)} />);
    const img = container.querySelector('img');

    expect(img).not.toBeNull(); // covers: AC-415-1
    expect(img?.getAttribute('src')).toBe(expectedSrc(ASSET_HERO)); // covers: AC-415-1
    // E' il NOSTRO URL di Storage costruito dall'id (path del public object), non testo libero.
    expect(img?.getAttribute('src')?.endsWith(`/${ASSET_HERO}`)).toBe(true); // covers: AC-415-1
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC-415-2 — near-collision: ogni <img> nasce dal PROPRIO asset_id, per identita' esatta.
// ═══════════════════════════════════════════════════════════════════════════════

describe('T-415 AC-415-2 — due (piu uno) slot uploaded: ogni img dal PROPRIO asset_id, nessuno scambio', () => {
  it('near-collision di prefisso + un terzo discordante: src per uguaglianza esatta, mai per prefisso', () => {
    // Sanity: la coppia e' davvero una near-collision (35 char condivisi, differisce solo in coda).
    expect(ASSET_HERO.slice(0, 35)).toBe(ASSET_SIBLING.slice(0, 35)); // covers: AC-415-2

    const { container } = render(
      <>
        <SiteImage image={uploaded(ASSET_HERO)} />
        <SiteImage image={uploaded(ASSET_SIBLING)} />
        <SiteImage image={uploaded(ASSET_OTHER)} />
      </>,
    );
    const srcs = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));

    // Tre elementi resi, tutti con un src distinto (nessuna collisione).
    expect(srcs).toHaveLength(3); // covers: AC-415-2
    expect(new Set(srcs).size).toBe(3); // covers: AC-415-2

    // Ogni img ha il src del PROPRIO asset_id, per uguaglianza esatta.
    expect(srcs[0]).toBe(expectedSrc(ASSET_HERO)); // covers: AC-415-2
    expect(srcs[1]).toBe(expectedSrc(ASSET_SIBLING)); // covers: AC-415-2
    expect(srcs[2]).toBe(expectedSrc(ASSET_OTHER)); // covers: AC-415-2

    // La near-collision produce src DIVERSI e nessuno finisce col FRATELLO (no swap, no prefix match).
    expect(srcs[0]).not.toBe(srcs[1]); // covers: AC-415-2
    expect(srcs[0]?.endsWith(ASSET_SIBLING)).toBe(false); // covers: AC-415-2
    expect(srcs[1]?.endsWith(ASSET_HERO)).toBe(false); // covers: AC-415-2
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC-415-3 — la variante theme-placeholder resta INVARIATA: nessun <img>, data-image-token.
// ═══════════════════════════════════════════════════════════════════════════════

describe('T-415 AC-415-3 — theme-placeholder invariato: nessun img, data-image-token preservato', () => {
  it('un theme-placeholder non produce alcun img e resta un div con data-image-token (altra variante non regredita)', () => {
    const slot: ImageSlot = { source: 'theme-placeholder', token: 'hero' };
    const { container } = render(<SiteImage image={slot} />);

    // Nessun <img> nasce dalla variante placeholder.
    expect(container.querySelectorAll('img')).toHaveLength(0); // covers: AC-415-3

    // Resta il riquadro decorativo nominato dal token, senza alcun src.
    const box = container.querySelector('[data-image-token="hero"]');
    expect(box).not.toBeNull(); // covers: AC-415-3
    expect(box?.tagName).toBe('DIV'); // covers: AC-415-3
    expect(box?.hasAttribute('src')).toBe(false); // covers: AC-415-3
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AC-415-4 — il src nasce SOLO dall'asset_id: nessun javascript:/data:/terzi, emesso da React.
// ═══════════════════════════════════════════════════════════════════════════════

describe('T-415 AC-415-4 — src derivato dal solo uuid, nessuno schema pericoloso, attributo da React', () => {
  it('lo slot ha come solo dato l uuid: il src e l URL derivato dall id e nient altro', () => {
    const { container } = render(<SiteImage image={uploaded(ASSET_OTHER)} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull(); // covers: AC-415-4

    const src = img?.getAttribute('src') ?? '';
    // Uguale, byte per byte, all'URL derivato dall'asset_id — e nient'altro appeso.
    expect(src).toBe(expectedSrc(ASSET_OTHER)); // covers: AC-415-4
    expect(src.endsWith(`/${ASSET_OTHER}`)).toBe(true); // covers: AC-415-4
    // Nessuno schema pericoloso ne' URL di terzi: il src e' solo il nostro Storage URL costruito dall'id.
    expect(src.toLowerCase().startsWith('javascript:')).toBe(false); // covers: AC-415-4
    expect(src.toLowerCase().startsWith('data:')).toBe(false); // covers: AC-415-4
    // L'attributo e' emesso da React su un elemento <img> REALE (non innerHTML): tagName IMG, src presente.
    expect(img?.tagName).toBe('IMG'); // covers: AC-415-4
    expect(img?.hasAttribute('src')).toBe(true); // covers: AC-415-4
  });
});
