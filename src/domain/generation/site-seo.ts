// T-409 (macrotask seo-base, P4) — DERIVAZIONE PURA dei metadati SEO da un SiteDocument gia'
// validato. Dominio PURO: nessun accesso all'ambiente, nessun I/O, nessuna costruzione di URL da
// env — chi ha bisogno di un URL assoluto (la base del sito, l'host dello Storage) glielo passa gia'
// costruito. Questo modulo estrae dai blocchi cio' che i metadati diranno e lo TRONCA ai tetti SEO,
// e nient'altro: sta a src/app (la rotta) montarlo su un oggetto Metadata con canonical, og:url e
// og:image assoluti.
//
// PERCHE' VIVE NEL DOMINIO: l'estrazione (quale campo del brief diventa il titolo, quale la
// descrizione, quale ImageSlot e' l'hero) e la troncatura sono LOGICA, oracolabile su un documento
// in memoria, senza sessione ne rete. Tenerla qui la rende testabile e la separa dalla decisione di
// serving (quale base, quale host), che e' di src/app + src/config.

import type { SiteDocument } from '@/domain/generation/document';

/**
 * I TETTI SEO, in code unit UTF-16 (come i .max di zod e come i tetti del documento). Scelti sui
 * valori che un motore di ricerca mostra davvero: ~60 per il titolo e ~155-160 per la descrizione.
 * Stanno SOTTO i tetti di forma del documento (page_title 120, meta_description 320): un titolo o
 * una descrizione legittimi possono superare la soglia SEO ed e' proprio per questo che si troncano,
 * mai perche' il documento fosse invalido.
 */
export const SEO_LIMITS = {
  /** Tetto in code unit di <title> / og:title. */
  title: 60,
  /** Tetto in code unit di meta description / og:description. */
  description: 160,
} as const;

/**
 * I dati d'attivita' raccolti dai blocchi, tutti opzionali (un brief incompleto non deve rompere i
 * metadati). `heroAssetId` e' l'id dell'asset CARICATO scelto come immagine sociale — vedi la regola
 * deterministica in `extractBusinessInfo` — e non un URL: l'indirizzo lo costruira' la rotta da
 * questo id (P2-D12), qui non c'e' alcun campo che possa portarne uno.
 */
export type BusinessInfo = {
  readonly name?: string;
  readonly description?: string;
  readonly address?: string;
  readonly geo?: { readonly lat: number; readonly lng: number };
  readonly phone?: string;
  readonly hours?: Readonly<Record<string, string>>;
  readonly heroAssetId?: string;
};

/**
 * Le pagine con la/le HOME davanti, conservando altrimenti l'ordine del documento. E' l'ordine di
 * scansione deterministico su cui poggiano sia la scelta dei campi (il primo valore trovato vince)
 * sia la scelta dell'hero: la home e' la sede naturale del nome e dell'immagine principale.
 */
function pagesHomeFirst(document: SiteDocument): SiteDocument['pages'] {
  const home = document.pages.filter((page) => page.role === 'home');
  const rest = document.pages.filter((page) => page.role !== 'home');
  return [...home, ...rest];
}

/**
 * Raccoglie i dati d'attivita' dai `data` dei blocchi (i campi del brief resi direttamente, P2-D4).
 *
 * REGOLA DETERMINISTICA — per ogni campo vince il PRIMO valore definito scandendo le pagine con la
 * HOME davanti, poi i blocchi in ordine. `business_name -> name`, `description -> description`
 * (la tagline), e cosi' per address/geo/phone/hours.
 *
 * REGOLA DELL'HERO (immagine sociale) — `heroAssetId` e' l'`asset_id` del PRIMO ImageSlot con
 * `source === 'uploaded'` incontrato nello STESSO ordine (home prima, poi il resto; dentro una
 * pagina: ordine dei blocchi, poi ordine delle immagini). Un `theme-placeholder` NON e' un hero: e'
 * imagery del tema, non una foto dell'attivita', e non ha comunque un asset_id da pubblicare. Se
 * nessun blocco porta un uploaded, `heroAssetId` resta `undefined` e la rotta omette og:image.
 */
export function extractBusinessInfo(document: SiteDocument): BusinessInfo {
  const ordered = pagesHomeFirst(document);
  const info: {
    name?: string;
    description?: string;
    address?: string;
    geo?: { lat: number; lng: number };
    phone?: string;
    hours?: Record<string, string>;
    heroAssetId?: string;
  } = {};

  for (const page of ordered) {
    for (const block of page.blocks) {
      const data = block.data;
      if (info.name === undefined && data.business_name !== undefined) info.name = data.business_name;
      if (info.description === undefined && data.description !== undefined) info.description = data.description;
      if (info.address === undefined && data.address !== undefined) info.address = data.address;
      if (info.geo === undefined && data.geo !== undefined) info.geo = data.geo;
      if (info.phone === undefined && data.phone !== undefined) info.phone = data.phone;
      if (info.hours === undefined && data.hours !== undefined) info.hours = data.hours;
      if (info.heroAssetId === undefined) {
        for (const image of block.images) {
          if (image.source === 'uploaded') {
            info.heroAssetId = image.asset_id;
            break;
          }
        }
      }
    }
  }

  return info;
}

/**
 * Tronca `text` a `max` code unit SENZA aggiungere nulla: cio' che esce e' sempre un PREFISSO
 * dell'ingresso (a meno di spazi finali potati), mai una stringa piu' lunga del tetto. Nessuna
 * ellissi, cosi' il risultato resta un prefisso verificabile e non introduce caratteri che non
 * venivano dal dato.
 */
function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max).trimEnd();
}

/**
 * Il titolo SEO: il nome dell'attivita' troncato al tetto, oppure il `brandName` come ripiego quando
 * il brief non porta un nome (una pagina pubblicata deve comunque avere un <title>). Il nome viene
 * PRIMA del ripiego proprio perche' e' il nome dell'attivita', non del builder, a dover comparire.
 */
export function seoTitle(info: BusinessInfo, brandName: string): string {
  const base = info.name !== undefined && info.name.trim() !== '' ? info.name : brandName;
  return truncate(base, SEO_LIMITS.title);
}

/**
 * La descrizione SEO: la tagline/descrizione troncata al tetto, oppure `undefined` quando il brief
 * non ne porta una — la rotta in quel caso omette del tutto description e og:description invece di
 * emettere una stringa vuota.
 */
export function seoDescription(info: BusinessInfo): string | undefined {
  if (info.description === undefined || info.description.trim() === '') return undefined;
  return truncate(info.description, SEO_LIMITS.description);
}
