import { getTranslations } from 'next-intl/server';
import type { SiteBlock } from '@/domain/generation/document';

// T-231 (macrotask generation-ui, P2) — LA MAPPA blocco -> CHIAVE i18n DELLA SUA ETICHETTA.
//
// P2-D10 COME PROPRIETA' VERIFICABILE: le etichette del sito generato sono NOSTRE e vengono
// dai cataloghi (messages/{it,es}.json, namespace 'site'), non dal modello, che scrive solo
// la prosa negli slot. Questa mappa e' la sede unica che lega ogni blocco del catalogo di
// T-210 alla chiave della sua etichetta, ed e' cio' che rende AC-231-2 TOTALE: un blocco
// aggiunto a T-210 senza la sua voce qui fa restituire `undefined` a `blockLabelKey`, e il
// controllo diventa rosso invece di lasciare una sezione senza etichetta.
//
// COPRE TUTTI E OTTO I BLOCCHI, narrativi (T-231) e di dati (T-237): le etichette di
// navigazione ('site.nav.*') e le varianti delle offerte ('site.offerings.*') vivono nei
// cataloghi ma non passano da qui — le prime le consuma la navigazione (T-235), le seconde
// `resolveOfferings` (T-210) e il blocco offerte (T-237). Qui c'e' la sola etichetta di
// SEZIONE, quella che ogni blocco usa come nome del proprio landmark.
//
// LE CHIAVI SONO RELATIVE AL NAMESPACE 'site': i componenti chiamano
// `getTranslations({ locale, namespace: 'site' })` e poi `t(blockLabelKey(id))`, quindi la
// chiave e' 'blocks.hero' e non 'site.blocks.hero'. Il controllo di parita' (AC-231-2)
// ricompone il path completo prependendo 'site.'.

/**
 * La chiave i18n (relativa a 'site') dell'etichetta di sezione di ogni blocco del catalogo
 * T-210. Il valore e' il path che deve esistere in ENTRAMBI i cataloghi. `as const` tiene i
 * valori come letterali, cosi' `t(...)` (next-intl, tipizzato sulle chiavi del catalogo) li
 * accetta senza cast: una chiave inesistente non compilerebbe.
 */
const BLOCK_LABEL_KEYS = {
  hero: 'blocks.hero',
  offerte: 'blocks.offerte',
  'chi-siamo': 'blocks.chiSiamo',
  orari: 'blocks.orari',
  contatti: 'blocks.contatti',
  recensioni: 'blocks.recensioni',
  faq: 'blocks.faq',
  'cta-whatsapp': 'blocks.ctaWhatsapp',
} as const satisfies Record<string, string>;

/** L'unione delle chiavi etichetta: il tipo che `t(...)` accetta come chiave valida. */
export type SiteBlockLabelKey = (typeof BLOCK_LABEL_KEYS)[keyof typeof BLOCK_LABEL_KEYS];

/**
 * La chiave dell'etichetta di un blocco, o `undefined` se il blocco non ne dichiara una.
 *
 * La lettura e' su proprieta' PROPRIE (`Object.hasOwn`) e non con un accesso nudo: un id come
 * 'constructor' risolverebbe altrimenti un membro di Object.prototype invece di dire "nessuna
 * etichetta". Gli id vengono dal nostro catalogo, ma la difesa costa una chiamata e non
 * dipende dalla forma dell'id.
 */
export function blockLabelKey(blockId: string): SiteBlockLabelKey | undefined {
  if (!Object.hasOwn(BLOCK_LABEL_KEYS, blockId)) return undefined;
  return (BLOCK_LABEL_KEYS as Record<string, SiteBlockLabelKey>)[blockId];
}

/**
 * L'ETICHETTA di SEZIONE risolta di un blocco: la stringa del catalogo del locale (namespace
 * 'site', P2-D10) per la chiave del blocco, con FALLBACK all'id del blocco quando il blocco non
 * dichiara un'etichetta (`blockLabelKey` -> undefined). E' il preambolo che OGNI componente di
 * blocco ripeteva identico (getTranslations 'site' + blockLabelKey + fallback), estratto in una
 * sola sede: le etichette del sito generato restano NOSTRE (dal catalogo, mai dal modello) e la
 * loro derivazione non puo' piu' divergere fra un blocco e l'altro.
 *
 * @param block il blocco RISOLTO; se ne legge il solo `id` per scegliere la chiave.
 * @param locale il locale del sito (sceglie il catalogo it/es).
 * @returns l'etichetta tradotta, o l'id del blocco se non ne ha una.
 */
export async function siteBlockLabel(block: SiteBlock, locale: string): Promise<string> {
  const t = await getTranslations({ locale, namespace: 'site' });
  const labelKey = blockLabelKey(block.id);
  return labelKey ? t(labelKey) : block.id;
}
