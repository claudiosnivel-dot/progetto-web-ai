// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import itMessages from '../messages/it.json';
import esMessages from '../messages/es.json';

// T-237 (macrotask generation-ui, P2) — blocchi di DATI, meta' OSTILE. E' la superficie di
// rendering piu' larga di P2, dove il testo non fidato del brief diventa pagina e dove nascono
// i link costruiti da campi liberi:
// AC-237-1 (i link whatsapp/telefono/email/social escono da campi VALIDATI su schema: nessun
//   href fuori dall'allowlist https/tel/mailto, nessun 'javascript:', un valore non valido non
//   produce alcun link);
// AC-237-2 (un photo_ref con un URL di terzi non compare in alcun src/href: lo slot immagine e'
//   theme-placeholder e non porta URL, T-202);
// AC-237-4 (un nome con <script> e una descrizione con <iframe srcdoc> compaiono come TESTO,
//   nessun elemento script o iframe nasce dal testo).
// Blocchi Server Component asincroni, invocati come funzione; etichette dal catalogo REALE via
// il mock di next-intl/server.

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => {
    const cat = (locale === 'es' ? esMessages : itMessages) as Record<string, unknown>;
    const ns = (cat[namespace] ?? {}) as Record<string, unknown>;
    return (key: string) => {
      const value = key
        .split('.')
        .reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], ns);
      return typeof value === 'string' ? value : `${namespace}.${key}`;
    };
  },
}));

import { Contatti } from '@/ui/site/blocks/Contatti';
import { Offerte } from '@/ui/site/blocks/Offerte';
import type { SiteBlock } from '@/domain/generation/document';

const ALLOWED_SCHEMES = ['https:', 'tel:', 'mailto:'];

afterEach(() => cleanup());

function schemeOf(href: string): string {
  const match = href.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:/);
  return match ? match[0].toLowerCase() : '';
}

// ── AC-237-1 — i link escono SOLO da campi validati su schema ─────────────────

describe('T-237 AC-237-1 — nessun href fuori allowlist, nessun link da un valore non valido', () => {
  it('valori ostili (javascript:, caratteri non ammessi, schema non ammesso) non producono alcun link', async () => {
    // Fixture con PIU DI UN canale e valori DISCORDANTI; fra i social la trappola del prefisso
    // ('.../belora' e' prefisso di '.../belora-studio') e un valore ostile mescolato ai validi.
    const block: SiteBlock = {
      id: 'contatti',
      content: { contact_title: 'Come raggiungerci', contact_intro: 'Scrivici o passa a trovarci' },
      data: {
        address: 'Via Roma 1, Napoli',
        phone: '+1-800-JAVASCRIPT', // caratteri non ammessi -> nessun link tel
        email: 'javascript:alert(document.cookie)', // schema non ammesso -> nessun link mailto
        whatsapp: 'javascript:alert(1)', // -> nessun link wa
        social_links: [
          'javascript:alert(2)', // schema non https -> nessun link
          'http://ig.example.com/x', // http (in chiaro): safeHttpsHref ammette SOLO https -> nessun link
          'https://ig.example.com/belora', // https valido -> link
          'https://ig.example.com/belora-studio', // https valido, prefisso di sopra -> link
        ],
      },
      brief_fields_rendered: ['address', 'phone', 'email', 'whatsapp', 'social_links'],
      images: [{ source: 'theme-placeholder', token: 'contatti' }],
    };
    const container = render(await Contatti({ block, locale: 'it' })).container;

    const hrefs = [...container.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '');

    // Ogni href prodotto ha uno schema dell'ALLOWLIST, e nessuno e' 'javascript:'.
    for (const href of hrefs) {
      expect(ALLOWED_SCHEMES).toContain(schemeOf(href)); // covers: AC-237-1
      expect(href.toLowerCase()).not.toContain('javascript:'); // covers: AC-237-1
    }

    // I tre canali con valore NON valido non rendono alcun link (restano come solo testo).
    expect(container.querySelector('.site-contact__phone a')).toBeNull(); // covers: AC-237-1
    expect(container.querySelector('.site-contact__email a')).toBeNull(); // covers: AC-237-1
    expect(container.querySelector('.site-contact__whatsapp a')).toBeNull(); // covers: AC-237-1

    // I due social ostili (javascript: e http:) non sono link; i due https lo sono: quattro
    // voci, due link. Rilassare safeHttpsHref ad accettare anche http: farebbe salire i link a
    // tre — e l'href 'http:' cadrebbe pure fuori dall'allowlist del ciclo qui sopra.
    expect(container.querySelectorAll('.site-contact__social')).toHaveLength(4); // covers: AC-237-1
    expect(container.querySelectorAll('.site-contact__social a')).toHaveLength(2); // covers: AC-237-1
  });

  it('e FALSIFICABILE: i valori validi PRODUCONO il link con lo schema atteso', async () => {
    // Multi-canale, discordante, con la trappola del prefisso fra i due social validi.
    const block: SiteBlock = {
      id: 'contatti',
      content: { contact_title: 'Contatti', contact_intro: 'A presto' },
      data: {
        phone: '+39 055 123 4567',
        email: 'info@belora.it',
        whatsapp: '+39 320 1112223',
        social_links: ['https://instagram.com/belora', 'https://instagram.com/belora-official'],
      },
      brief_fields_rendered: ['phone', 'email', 'whatsapp', 'social_links'],
      images: [{ source: 'theme-placeholder', token: 'contatti' }],
    };
    const container = render(await Contatti({ block, locale: 'it' })).container;

    expect(container.querySelector('.site-contact__phone a')?.getAttribute('href')).toBe(
      'tel:+390551234567',
    ); // covers: AC-237-1
    expect(container.querySelector('.site-contact__email a')?.getAttribute('href')).toBe(
      'mailto:info@belora.it',
    ); // covers: AC-237-1
    expect(container.querySelector('.site-contact__whatsapp a')?.getAttribute('href')).toBe(
      'https://wa.me/393201112223',
    ); // covers: AC-237-1
    const socialHrefs = [...container.querySelectorAll('.site-contact__social a')].map((a) =>
      a.getAttribute('href'),
    );
    expect(socialHrefs).toEqual([
      'https://instagram.com/belora',
      'https://instagram.com/belora-official',
    ]); // covers: AC-237-1
    // Ogni href resta nell'allowlist: la falsificabilita' non apre l'allowlist.
    for (const a of container.querySelectorAll('a[href]')) {
      expect(ALLOWED_SCHEMES).toContain(schemeOf(a.getAttribute('href') ?? '')); // covers: AC-237-1
    }
  });
});

// ── AC-237-2 — un photo_ref di terzi non diventa mai un src/href ──────────────

describe('T-237 AC-237-2 — lo slot immagine e theme-placeholder e non porta URL di terzi', () => {
  it('un URL di terzi presente nel testo non compare in alcun attributo src o href', async () => {
    const THIRD_PARTY = 'https://evil-cdn.example.com/track.png';
    // La voce dell'offerta nel documento NON ha `photo_ref` (rimosso da resolve, irrappresentabile
    // per T-202): qui l'URL di terzi e' messo nel TESTO di una descrizione, per provare che nemmeno
    // un URL gia' RESO diventa un attributo. Due offerte DISCORDANTI, con la trappola del prefisso.
    const block: SiteBlock = {
      id: 'offerte',
      content: { offerings_title: 'Catalogo', offerings_intro: 'Le nostre creazioni' },
      data: {
        vertical: 'negozio_artigiano',
        offerings: [
          { name: 'Vaso', description: `Foto originale: ${THIRD_PARTY}` },
          { name: 'Vaso grande', description: 'Senza foto' }, // 'Vaso' e' prefisso di 'Vaso grande'
        ],
      },
      brief_fields_rendered: ['offerings'],
      images: [{ source: 'theme-placeholder', token: 'offerte' }],
    };
    const container = render(await Offerte({ block, locale: 'it' })).container;

    // L'URL e' EFFETTIVAMENTE reso come testo: l'asserzione che segue non passa per vacuita'.
    expect(container.textContent).toContain(THIRD_PARTY); // covers: AC-237-2

    // Raccolti tutti gli attributi src e href: l'URL non compare in nessuno.
    const attrs = [...container.querySelectorAll('[src], [href]')].flatMap((el) => [
      el.getAttribute('src') ?? '',
      el.getAttribute('href') ?? '',
    ]);
    for (const value of attrs) {
      expect(value).not.toContain(THIRD_PARTY); // covers: AC-237-2
    }

    // Lo slot immagine e' un riquadro decorativo (data-image-token) senza <img> e senza src.
    const image = container.querySelector('[data-image-token="offerte"]');
    expect(image).not.toBeNull(); // covers: AC-237-2
    expect(image?.hasAttribute('src')).toBe(false); // covers: AC-237-2
    expect(container.querySelectorAll('img')).toHaveLength(0); // covers: AC-237-2
  });
});

// ── AC-237-4 — nome e descrizione ostili sono TESTO, non elementi ─────────────

describe('T-237 AC-237-4 — payload nel nome e nella descrizione resi come testo', () => {
  it('un <script> in un nome e un <iframe srcdoc> in una descrizione non generano elementi', async () => {
    const SCRIPT_PAYLOAD = '<script>window.__belora_pwned = 1</script>';
    const IFRAME_PAYLOAD = '<iframe srcdoc="<script>alert(1)</script>"></iframe>';
    // Due offerte DISCORDANTI nella STESSA sezione, con la trappola del prefisso ('Tagliere' e'
    // prefisso di 'Tagliere <script>...'): il payload script nel nome della prima, l'iframe nella
    // descrizione della seconda.
    const block: SiteBlock = {
      id: 'offerte',
      content: { offerings_title: 'Il menu', offerings_intro: 'Piatti del giorno' },
      data: {
        vertical: 'ristorazione',
        offerings: [
          { name: `Tagliere ${SCRIPT_PAYLOAD}`, price: '18 EUR', section: 'Taglieri' },
          { name: 'Tagliere', description: IFRAME_PAYLOAD, price: '9 EUR', section: 'Taglieri' },
        ],
      },
      brief_fields_rendered: ['offerings'],
      images: [{ source: 'theme-placeholder', token: 'offerte' }],
    };
    const container = render(await Offerte({ block, locale: 'it' })).container;

    // I due payload compaiono VERBATIM come testo nell'albero reso.
    expect(container.textContent).toContain(SCRIPT_PAYLOAD); // covers: AC-237-4
    expect(container.textContent).toContain(IFRAME_PAYLOAD); // covers: AC-237-4

    // Nessun elemento script o iframe nasce dal testo: il testo non fidato passa solo dall'escape
    // di React.
    expect(container.querySelectorAll('script')).toHaveLength(0); // covers: AC-237-4
    expect(container.querySelectorAll('iframe')).toHaveLength(0); // covers: AC-237-4
  });
});
