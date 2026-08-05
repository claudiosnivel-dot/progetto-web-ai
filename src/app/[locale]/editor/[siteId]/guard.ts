import { getTranslations } from 'next-intl/server';
import { enterSiteRoute } from '@/app/[locale]/_shared/site-route-guard';
import { routing } from '@/i18n/routing';

// T-311 (macrotask editor-core, P3) — L'INGRESSO alla rotta /editor.
//
// STESSA CATENA DI SICUREZZA di /preview, /generate e /onboarding, in UNA sola sede
// (`enterSiteRoute`) e NON ricopiata: locale vincolato all'allowlist PRIMA di ogni destinazione,
// identita' server-side con `getUser` (che rivalida il token), proprieta' del sito via `listSites`
// sotto RLS. L'anti-enumerazione di P1-D21 (STESSO `notFound()` per "non tuo" e "inesistente", mai
// un errore distinguibile per esistenza) e il redirect al login FISSO vivono la' dentro, invariati.
//
// La rotta /editor NON e' fra i segmenti che il middleware protegge da se': ancora una ragione per
// cui questa guardia-pagina e' l'UNICA difesa nel percorso (il matcher del middleware esclude poi
// ogni pathname con un punto — per un siteId come 'a.b' resta solo il `getUser` qui sotto). Non si
// affida nulla al middleware.
//
// Cio' che e' PROPRIO di /editor e non condiviso e' il catalogo i18n dello stato vuoto: la
// generazione corrente potrebbe non avere ancora un documento (sito non generato), e la pagina lo
// dichiara con uno stato ESPLICITO — mai un notFound, il sito esiste ed e' tuo. La copia vive nel
// namespace 'editor' DEDICATO (T-311/D4), a parita' di chiavi it/es: /editor non riusa piu' la frase
// di 'preview', cosi' le due superfici possono divergere senza trascinarsi a vicenda.

type EditorEntry = {
  locale: (typeof routing.locales)[number];
  t: Awaited<ReturnType<typeof getTranslations>>;
};

/**
 * Apre la rotta /editor: vincola il locale, esige l'identita', accerta la proprieta' del sito
 * (catena comune `enterSiteRoute`) e carica il catalogo dello stato vuoto. Non legge il documento:
 * lo fa la pagina, col read-path corrente (ultima revisione else baseline, T-304).
 * @param params i segmenti di rotta, non fidati.
 * @returns locale vincolato e il traduttore per lo stato vuoto.
 */
export async function enterEditor(params: {
  locale: string;
  siteId: string;
}): Promise<EditorEntry> {
  const { locale } = await enterSiteRoute(params, {
    errorLabel: 'editor: elenco siti non disponibile',
  });

  const t = await getTranslations({ locale, namespace: 'editor' });

  return { locale, t };
}
