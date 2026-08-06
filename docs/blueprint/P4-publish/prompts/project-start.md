# project-start — Belora · P4 (Pubblicazione, serving pubblico & media)

> Da incollare **una volta**, all'avvio del sotto-progetto P4, per orientare l'agente al
> blueprint P4, alle decisioni chiuse, al piano di macrotask e alle invarianti. Con la
> skill trueline presente è **BUILD** a eseguire questa disciplina; questo prompt è il
> ponte di portabilità cross-tool.

```
Stai per costruire il sotto-progetto **P4 (Pubblicazione, serving pubblico & media)** di
**Belora** (supabase-jsts; Next.js 16 + Supabase). P0 (fondamenta), P1 (onboarding), P2
(generazione) e P3 (editor) sono COMPLETI e verdi su main, più il pass trasversale
architecture-hardening (gate architecture: repo-wide). Il PIANO È IL BLUEPRINT P4: da qui si
scrive codice secondo i task, non si reinventa il design.

PRIMA DI TUTTO — leggi, in quest'ordine:
  1. docs/blueprint/P4-publish/SESSION-STATE.md → fonte di verità sullo STATO VIVO di P4.
     Leggila prima di qualunque azione, sempre. §6 (copertura dichiarata) e §7 (carry-over
     ereditati) sono i due che contano.
  2. docs/blueprint/P4-publish/ → il PIANO: 00-INDEX (mappa, piano di build, decision ledger
     P4-D1..P4-D9, contratto architecture: repo-wide in §1bis) + i moduli 01-publish-core …
     06-e2e-public, ognuno un macrotask coi suoi task atomici. Ogni task porta
     definition_of_done + acceptance_criteria + target_tests: sono questi i criteri contro
     cui si misura "fatto".
  3. docs/superpowers/specs/2026-08-06-p4-publish-media-design.md → il design a monte (intento).
  4. Substrato già costruito: docs/blueprint/P2-generation/ e P3-editor/ (site_generations.
     document, la persistenza a revisioni site_document_revisions + read-path "ultima revisione
     else baseline" T-304, SiteView + SiteImage, parseDocument, ImageSlot source:'uploaded'
     T-202, saveRevision T-302) — referenziati in prosa nei moduli P4, NON nel DAG P4.

CIÒ CHE P4 EREDITA — sono fatti, non opinioni:
  • L'artefatto che P4 pubblica: il DOCUMENTO CORRENTE di un sito = ultima revisione else
    baseline (P3-D9 / T-304). Pubblicare CONGELA uno snapshot validato in site_publications,
    disaccoppiato dall'editing e dalla POTATURA FIFO delle revisioni (P4-D2, T-303).
  • Il renderer UNICO SiteView. Il sito pubblicato passa SEMPRE da SiteView reale; MAI una
    ri-implementazione (P2-D8).
  • Ogni scrittura del documento passa da parseDocument (strict, ≤8 MiB, slug unici, una home):
    vale per lo snapshot pubblicato (publish) e per il draft con ImageSlot 'uploaded' (P3).
  • **Testo del brief e documento pubblicato = input NON FIDATO in RENDERING**, ora reso AL
    PUBBLICO. P2/P3 lo sanificano (escaping React, niente dangerouslySetInnerHTML, href/src
    solo da campi validati) e lo provano sull'EFFETTO (T-241 su generazione, T-317 su editor).
    P4 deve PRESERVARLO ed ESTENDERLO alla ROTTA PUBBLICA /s/<slug> (T-417, Chromium + canary).
  • NESSUN src/href da testo libero (P2-D12): gli URL asset si costruiscono da noi da asset_id
    (T-414), mai da stringhe del documento.
  • Contratto architecture: ATTIVO REPO-WIDE (P3-D7 + AH-D6): serving in src/app, logica pura
    (slug, forma snapshot, JSON-LD, URL asset) in src/domain, accesso dati + sharp (I/O) in
    src/data; gate tests/architecture-contract.test.ts. Nessun arco domain→{ui,data,app},
    nessun data→ui.
  • P4 introduce DUE TABELLE NUOVE (site_publications, assets), UN BUCKET Storage e una ROTTA
    PUBBLICA ANON: rls:0 e la copertura anti-XSS/effetto vanno RICONQUISTATI, non ereditati.

DECISIONI BLOCCATE (ledger di 00-INDEX §4, P4-D1..P4-D9 — CHIUSE salvo emendamento esplicito
registrato lì):
  serving dall'app Next.js path-based /s/<slug> (R2/sottodomini/domini custom RIMANDATI);
  "published" = snapshot separato in site_publications (gate parseDocument, disaccoppiato dalla
  potatura FIFO); rotta top-level standalone, lettura anon via RLS, notFound su slug ignoto;
  public_slug GLOBALE unico auto-generato dal nome attività + dedup + lista riservati;
  publish/unpublish GRATIS + badge "Made with Belora" (gating a pagamento = P5); media dentro
  v1, bucket a lettura pubblica per uuid, scrittura tenant-scoped via RLS; upload attraverso il
  server con magic-bytes + sharp re-encode/strip-EXIF/reject-SVG/resize (niente AI: ritocco =
  P5); SEO base (OG/canonical/JSON-LD LocalBusiness escaped/sitemap/robots); postura di
  sicurezza con oracolo per superficie.
  In dubbio, fermati e chiedi.

PIANO DI MACROTASK (rispetta il DAG interno a P4):
  - publish-core        (T-401..T-404) — il LAYER PUBBLICATO: tabella site_publications + RLS
    anon-published + UNIQUE public_slug, public_slug (dominio puro), publishSite/unpublishSite.
  - public-serving      (T-405..T-408) — il SERVING: rotta /s/<slug> standalone, middleware
    esclude /s/*, RLS pubblica provata a RUNTIME, badge.
  - seo-base            (T-409..T-411) — la SEO: generateMetadata, JSON-LD sicuro, sitemap/robots.
  - media-storage       (T-412..T-414) — la PIPELINE MEDIA: bucket+RLS+assets, uploadAsset
    re-encode, URL da asset_id.
  - media-editor-render (T-415..T-416) — RENDER & EDITOR foto: SiteImage uploaded, affordance upload.
  - e2e-public          (T-417) — la PROVA DI PUNTA: e2e ostile Chromium su /s/<slug> + canary rosso.
  Ordine: publish-core → public-serving → seo-base; media-storage → media-editor-render;
  e2e-public alla fine. Un macrotask è l'unità al cui confine gira il CHECKPOINT ed è l'unità
  di commit atomico. UN dynamic workflow di build PER MACROTASK.

SUPERFICI DI SICUREZZA NUOVE IN P4:
  • RLS su DUE TABELLE NUOVE (site_publications, assets) + bucket Storage: policy anon = SELECT
    solo su is_published=true; colonne private (account_id, source_generation_id) MAI esposte;
    scrittura tenant-scoped su storage.objects; client di SESSIONE, mai service_role nel browser.
    Provata A RUNTIME (T-407), mai nell'SQL editor.
  • DOCUMENTO PUBBLICATO reso AL PUBBLICO: parseDocument (in publish e in render) + escaping
    React del SiteView; slug ignoto/non pubblicato/sito altrui → notFound() (anti-enum P1-D21).
  • JSON-LD LocalBusiness: campi brief non fidati → serializzazione con escaping di < > & +
    U+2028/2029 (anti-breakout dal tag script, T-410).
  • UPLOAD NON FIDATO: il re-encode È la difesa (magic-bytes + sharp, strip EXIF, rifiuto SVG,
    resize) → raster pulito o rifiuto, MAI salvato grezzo (T-413). URL pubblico da asset_id (T-414).

INVARIANTI NON NEGOZIABILI (regole della casa):
  • ORACLE-AS-JUDGE, MAI LLM-AS-JUDGE.
  • LOOP DI VERIFICA DELLA FIX OBBLIGATORIO (applica → riesegui STESSO oracolo → riesegui
    test → accetta solo se sparito e nulla rotto).
  • HUMAN-IN-THE-LOOP SULLE FIX; DEAD-CODE MAI CANCELLATO IN AUTONOMIA.
  • GIT A STRATI: branch autonomo; merge su main GATED dal verde E dal deploy-coupling coupled
    (human-gated ANCHE SUL VERDE: P4 apre l'hosting pubblico); distruttive mai autonome; DEPLOY
    NON SUPERVISIONATO BLOCCATO.
  • RENDERER UNICO: il sito pubblicato passa da SiteView reale; PARSEDOCUMENT IN SCRITTURA E IN
    RENDER; TESTO NON FIDATO SOLO COME CHILDREN REACT; NESSUN src/href DA TESTO LIBERO.
  • NESSUN FALSO "VIA LIBERA"; COPERTURA SEMPRE DICHIARATA; PRIMA DI CREDERE A UN VERDE, PROVA
    CHE LO STRUMENTO SA DIVENTARE ROSSO (canary sulla superficie pubblica, T-417).

Conferma di aver letto SESSION-STATE e il blueprint P4, riepiloga in poche righe lo stato e il
primo macrotask eseguibile (publish-core), segnala incoerenze, e ATTENDI il mio via prima di
scrivere codice.
```
