// T-231 (macrotask generation-ui, P2) — IL REGISTRY UNICO id-blocco -> componente, e il
// dispatcher `renderBlock`. E' la sede sola in cui un id del catalogo (T-210) diventa un
// componente reso: card (T-232) e anteprima (T-235) passano di qui, quindi non esistono due
// renderer che possano divergere (AC-232-1 lo verifica confrontando la sequenza di id resa
// dalle due strade). T-237 AGGIUNGE qui i blocchi di DATI (offerte, orari, contatti,
// recensioni) senza un secondo renderer: oggi il registry contiene i soli blocchi NARRATIVI.
//
// UN id non registrato rende `null`: una pagina che contenga un blocco di dati prima di T-237
// salta quel blocco invece di lanciare. E' la stessa politica con cui il resto della pipeline
// TRASPORTA cio' che non sa ancora comporre.

import type { ReactElement } from 'react';
import { Hero } from '@/ui/site/blocks/Hero';
import { ChiSiamo } from '@/ui/site/blocks/ChiSiamo';
import { Faq } from '@/ui/site/blocks/Faq';
import { CtaWhatsapp } from '@/ui/site/blocks/CtaWhatsapp';
import { Offerte } from '@/ui/site/blocks/Offerte';
import { Orari } from '@/ui/site/blocks/Orari';
import { Contatti } from '@/ui/site/blocks/Contatti';
import { Recensioni } from '@/ui/site/blocks/Recensioni';
import type { SiteBlockComponent } from '@/ui/site/types';
import type { SiteBlock } from '@/domain/generation/document';

/**
 * I componenti dei blocchi, per id del catalogo T-210. NARRATIVI (T-231) e DATI (T-237) nello
 * STESSO oggetto: e' l'unico punto di estensione del renderer, quindi card (T-232) e anteprima
 * (T-235) non possono divergere sui blocchi che rendono.
 */
export const SITE_BLOCK_COMPONENTS: Readonly<Record<string, SiteBlockComponent>> = {
  hero: Hero,
  'chi-siamo': ChiSiamo,
  faq: Faq,
  'cta-whatsapp': CtaWhatsapp,
  offerte: Offerte,
  orari: Orari,
  contatti: Contatti,
  recensioni: Recensioni,
};

/**
 * Rende UN blocco col componente registrato per il suo id, o `null` se nessuno lo copre. La
 * lettura del registry e' su proprieta' PROPRIE (`Object.hasOwn`): un id come 'constructor'
 * non deve risolvere un membro di Object.prototype al posto di "nessun componente".
 */
export function renderBlock(block: SiteBlock, locale: string): Promise<ReactElement> | null {
  if (!Object.hasOwn(SITE_BLOCK_COMPONENTS, block.id)) return null;
  const Component = SITE_BLOCK_COMPONENTS[block.id];
  return Component({ block, locale });
}
