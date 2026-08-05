import { readGenerationDocument } from '@/data/generation-document';
import { getGeneration } from '@/data/generations';
import { parseDocument } from '@/domain/generation/document';
import { THEMES } from '@/domain/generation/themes';
import { SiteView } from '@/ui/site/SiteView';
import { EditorClient } from '@/ui/editor/EditorClient';
import { composeAddableBlocks } from './addable-blocks';
import { enterEditor } from './guard';

// T-311 (macrotask editor-core, P3) — ROTTA PROTETTA /{locale}/editor/{siteId}: l'EDITOR INLINE
// che rende a PIENA PAGINA il DOCUMENTO CORRENTE in modalita EDITABLE, avvolto dal chrome client.
//
// RENDE IL DOCUMENTO CORRENTE (T-304, "ultima revisione else baseline"): `readGenerationDocument`
// restituisce la revisione con seq massimo se l'utente ha gia' editato, altrimenti la baseline
// congelata `site_generations.document`. La lettura gira sul client di SESSIONE (RLS attiva), MAI
// la chiave di servizio: un sito di un altro tenant filtra a insieme vuoto — la guardia l'ha
// comunque gia' negato con notFound (P1-D21). Il documento passa SEMPRE da `parseDocument` (T-202)
// prima di essere reso, come ovunque nel progetto.
//
// UN SOLO RENDERER (P2-D8 / P3-D5): `SiteView` con `editable` — lo STESSO modulo dell'anteprima
// (T-235) e delle card (T-232), qui in modalita editable. Non nasce un secondo renderer client che
// possa divergere: gli slot di testo diventano isole <EditableText> (T-305), il testo resta
// children React (escaping preservato), nessuna iniezione di HTML grezzo e nessun href/src da testo
// libero. La struttura e il tema sono identici al render read-only: cambia solo l'involucro del testo.
//
// COMPOSIZIONE END-TO-END (FX-EDITOR-2, T-319): SiteView e' reso QUI (server) UNA volta e passato a
// `EditorClient` (client) come children — la shell aggiunge il chrome (switch tema, Salva/autosave,
// storia revisioni, riscelta soft) e ATTIVA le isole client-side, senza mai ri-renderizzare i blocchi.
// La RISCELTA soft (T-310) richiede la generazione corrente (id + variante scelta): la si legge con
// `getGeneration` (client di sessione, RLS). Non e' un confine di sicurezza — selectVariant riverifica
// ownership e stato lato server — ma abilita il chiamante di PRODUZIONE del percorso fromEditor.
//
// Sicurezza (A01:2025): la rotta e' protetta dal `getUser` server-side dentro ./guard, l'UNICA
// difesa per un siteId con un punto (il matcher del middleware esclude quei pathname). Ownership e
// anti-enumerazione vivono in `enterSiteRoute` (AC-311-2/-3). Il locale e' vincolato all'allowlist
// PRIMA di scendere nel render (AC-311-4): a valle non entra mai il valore grezzo del segmento.

type EditorPageProps = {
  params: Promise<{ locale: string; siteId: string }>;
};

export default async function EditorPage({ params }: EditorPageProps) {
  const { locale: rawLocale, siteId } = await params;
  const { locale, t } = await enterEditor({ locale: rawLocale, siteId });

  // IL DOCUMENTO CORRENTE (ultima revisione else baseline, T-304). Il gate e' `parseDocument`.
  const result = await readGenerationDocument(siteId);
  const parsed = result.ok && result.document !== null ? parseDocument(result.document) : null;
  const document = parsed && parsed.ok ? parsed.document : null;
  // Il tema del documento, per UGUAGLIANZA ESATTA dell'id versionato (mai per prefisso): e' cio' che
  // SiteView proietta in var(--site-...). Il ramo `undefined` e' una difesa dichiarata (cataloghi
  // futuri disallineati); per un documento reale il tema c'e' sempre (AC-212-1).
  const theme = document ? THEMES.find((candidate) => candidate.id === document.theme_id) : undefined;

  // NESSUN documento valido (sito non ancora generato, tema fuori catalogo): stato ESPLICITO, mai
  // un notFound — il sito esiste ed e' tuo, la guardia l'ha gia' accertato. Copy dal namespace
  // 'editor' DEDICATO (T-311/D4), non piu' un riuso di preview.unavailable.
  if (document === null || theme === undefined) {
    return (
      <main className="site-editor">
        <p data-editor-empty>{t('unavailable')}</p>
      </main>
    );
  }

  // LA GENERAZIONE CORRENTE (id + variante scelta) per la riscelta soft (T-310). Abilitata solo
  // quando il sito e' gia' scelto ('chosen'/'complete') e ha una variante: da 'ready' non c'e' nulla
  // da riscegliere. Un guasto di lettura o un sito non ancora scelto lascia semplicemente la riscelta
  // fuori dal chrome — l'editing dei contenuti resta pienamente disponibile.
  const generationRead = await getGeneration(siteId);
  const generation = generationRead.ok ? generationRead.generation : null;
  const rechoose =
    generation !== null &&
    generation.chosen_variant !== null &&
    (generation.status === 'chosen' || generation.status === 'complete')
      ? { generationId: generation.id, variantIndex: generation.chosen_variant }
      : undefined;

  // LA LIBRERIA BLOCCHI (T-314): l'offerta dei blocchi aggiungibili alla home (la pagina che esiste
  // sempre, P2-D13; altrimenti la prima), gia' filtrata per precondizione+ruolo ed etichettata i18n.
  // Composta lato server (app), che puo' toccare data+domain+ui; il pannello la riceve serializzabile.
  const offerPage = document.pages.find((candidate) => candidate.role === 'home') ?? document.pages[0];
  const offer = await composeAddableBlocks(siteId, offerPage.slug, locale);

  // SiteView e' un Server Component ASINCRONO: lo si esegue e si incorpora l'albero gia' pronto, in
  // modalita EDITABLE (isole EditableText attorno agli slot di testo, T-305), poi lo si affida a
  // EditorClient come children (renderer UNICO, nessuna copia client dei blocchi).
  const view = await SiteView({ document, theme, locale, editable: true });

  return (
    <main className="site-editor">
      <EditorClient
        document={document}
        siteId={siteId}
        locale={locale}
        rechoose={rechoose}
        offer={offer}
        offerPageSlug={offerPage.slug}
        addBlockTitle={t('addBlock')}
        reorderTitle={t('reorderBlocks')}
        moveUpLabel={t('moveBlockUp')}
        moveDownLabel={t('moveBlockDown')}
        replaceTitle={t('replaceBlock')}
        labels={{
          revisionsTitle: t('revisions'),
          restore: t('restore'),
          rechoose: t('rechoose'),
          rechooseConfirm: t('rechooseConfirm'),
          rechooseConfirmYes: t('rechooseConfirmYes'),
          rechooseCancel: t('rechooseCancel'),
        }}
      >
        {view}
      </EditorClient>
    </main>
  );
}
