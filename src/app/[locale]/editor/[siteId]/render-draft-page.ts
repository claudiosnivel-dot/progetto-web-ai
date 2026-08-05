'use server';

import type { ReactElement } from 'react';
import { getGeneration } from '@/data/generations';
import { parseDocument } from '@/domain/generation/document';
import { THEMES } from '@/domain/generation/themes';
import { SitePageView } from '@/ui/site/SiteView';

// T-313 (macrotask editor-blocks, P3) — ANTEPRIMA STRUTTURALE server di un DRAFT: valida il
// documento in volo e ne rende UNA pagina col RENDERER UNICO, mai una ri-implementazione client.
//
// ALTITUDINE (gate architecture: repo-wide, T-AH6/T-312). Questo modulo IMPORTA ui (SitePageView),
// data (getGeneration) e domain (parseDocument, THEMES): l'unico strato senza archi vietati in
// uscita e' APP. Vive percio' in src/app/** — CO-LOCATO con la rotta editor (stessa altitudine di
// page.tsx), che compone gia' data + domain + ui allo stesso modo. Metterlo in src/data lo
// costringerebbe a importare src/ui, cioe' l'arco vietato data->ui che renderebbe rosso il gate.
//
// SICUREZZA, nell'ordine (fail-closed):
//  1. OWNERSHIP sotto RLS, PRIMA di tutto: `getGeneration` gira sul client di SESSIONE (mai
//     service_role, R7). Un sito non posseduto o inesistente filtra a `generation: null`
//     (anti-enumerazione P1-D21), senza sessione e' un 401: in entrambi i casi si rifiuta senza
//     rendere nulla e senza rivelare l'esistenza del sito (AC-313-4). Non si valida nemmeno il
//     draft di chi non possiede il sito.
//  2. GATE parseDocument (T-202) PRIMA del render: il draft e' input NON FIDATO (un edit in volo,
//     con testo del modello e di siti terzi). Un draft che non passa il gate e' rifiutato, nulla
//     reso (AC-313-2). Cio' che si rende e' la COPIA validata dal gate (`parsed.document`), mai
//     l'input.
//  3. TEMA per UGUAGLIANZA ESATTA dell'id versionato (mai per prefisso): il ramo `undefined` e' una
//     difesa DICHIARATA (tema fuori catalogo) -> rifiuto. Per un documento reale il tema c'e'
//     sempre (AC-212-1).
//  4. PAGINA per UGUAGLIANZA ESATTA dello slug (mai per prefisso: 'chi-siamo' e 'chi-siamo-team'
//     sono due pagine distinte). Slug assente -> rifiuto.
//  5. RENDER con `SitePageView` — il renderer UNICO (P2-D8 / P3-D5), lo STESSO della rotta editor e
//     dell'anteprima. Il testo resta children React (escaping preservato), MAI dangerouslySetInnerHTML
//     e MAI href/src da testo libero (AC-313-3). renderDraftPage rende UNA pagina, quindi usa
//     SitePageView (non SiteView).
//
// DUE DEVIAZIONI MINIME DALLA FIRMA-SKETCH DELLA DoD, dichiarate perche' gli AC non le pinnano:
//  - LOCALE come 4o parametro: `SitePageView` lo richiede per le etichette dei landmark. Arriva dal
//    CHIAMANTE server (la rotta editor lo ha gia' vincolato all'allowlist), non e' derivato da
//    testo non fidato (feed solo di getTranslations, nessun rischio di iniezione).
//  - EDITABLE = true: parita' con la rotta editor (un solo modo di rendere il documento corrente).
//    L'escaping e' preservato in entrambe le modalita'; l'anteprima strutturale rende le isole
//    EditableText come la rotta, senza sdoppiare il renderer.

/**
 * Rende l'anteprima strutturale di UNA pagina di un DRAFT, o `null` se rifiutata.
 *
 * @param siteId il sito di cui si verifica la proprieta' (RLS, client di sessione).
 * @param draft il documento in volo, input NON FIDATO: passa dal gate `parseDocument`.
 * @param pageSlug lo slug della pagina da rendere (uguaglianza esatta).
 * @param locale il locale gia' vincolato dal chiamante (etichette dei landmark).
 * @returns l'elemento reso dal renderer unico, oppure `null` (ownership, gate, tema o pagina).
 */
export async function renderDraftPage(
  siteId: string,
  draft: unknown,
  pageSlug: string,
  locale: string,
): Promise<ReactElement | null> {
  // 1) OWNERSHIP sotto RLS: non posseduto/inesistente (generation null) o senza sessione -> rifiuto.
  const generazione = await getGeneration(siteId);
  if (!generazione.ok || generazione.generation === null) return null;

  // 2) GATE: il draft non fidato passa da parseDocument prima di qualunque render.
  const parsed = parseDocument(draft);
  if (!parsed.ok) return null;

  // 3) TEMA per id esatto; assente -> rifiuto (difesa dichiarata, tema fuori catalogo).
  const theme = THEMES.find((candidate) => candidate.id === parsed.document.theme_id);
  if (theme === undefined) return null;

  // 4) PAGINA per slug esatto; assente -> rifiuto.
  const page = parsed.document.pages.find((candidate) => candidate.slug === pageSlug);
  if (page === undefined) return null;

  // 5) RENDER col renderer UNICO, modalita editable per parita' con la rotta editor.
  return await SitePageView({ page, theme, locale, editable: true });
}
