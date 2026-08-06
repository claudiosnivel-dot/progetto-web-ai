# 03-seo-base — Macrotask `seo-base`

> Modulo del blueprint P4 (Pubblicazione, serving pubblico & media) di Belora. Un
> modulo = un macrotask (`L-COL-018`, `L-COL-024`). Task atomici secondo lo schema
> trueline (`L-COL-019`). Costruisce **sopra** `public-serving` (M2): usa la rotta
> pubblica standalone `/s/<slug>` e la lettura anon dello snapshot pubblicato
> (`site_publications`, colonne `document, public_slug, locale`). DAG:
> `publish-core` → `public-serving` → `seo-base`. Fonte dell'intento:
> `docs/superpowers/specs/2026-08-06-p4-publish-media-design.md` (§6, `P4-D8`,
> `P4-D9`). Identificatori in inglese, prosa in italiano.

## Obiettivo del macrotask

La **SEO di base** del sito pubblicato (§6 del design): rendere il sito servito a
`/s/<slug>` **indicizzabile e condivisibile** senza mai fidarsi del contenuto reso.
Tre superfici, tutte alimentate **solo dallo snapshot pubblicato** letto in anon via
RLS: (1) `generateMetadata` per pagina — `title`/`description`, **Open Graph** e
Twitter card, `canonical` a `/s/<slug>`, `<html lang>` nella locale del sito e
`og:image` = **URL Storage stabile** della hero solo se caricata; (2) **JSON-LD
`LocalBusiness`** costruito dai dati brief resi e iniettato con **serializzazione
sicura** (escaping di `<`, `>`, `&`, `U+2028/U+2029`) — un punto di **sicurezza**,
non decorativo, perché i campi sono non fidati; (3) **`sitemap.xml` per-sito** +
**`robots.txt`** che indicizza `/s/*` e tiene `noindex` su editor/preview.

Invarianti ereditate e riconquistate: **nessun `src`/`href` da testo libero** (gli
URL immagine li costruiamo da `asset_id`, `P2-D12`); **anon legge solo il
pubblicato** (mai righe non pubblicate o di altri tenant); **colonne private**
(`account_id`, `source_generation_id`) **mai esposte** nei metadata o nel JSON-LD;
slug ignoto/non pubblicato → `notFound` (anti-enumerazione `P1-D21`). `hreflang` con
alternate è **fuori scope** (siti v1 mono-locale).

## Task atomici

```yaml
- id: T-409
  title: "generateMetadata: title/description/Open Graph/canonical/lang/og:image dallo snapshot"
  macrotask: "seo-base"
  depends_on: [T-405]

  objective: >
    Emettere i metadata SEO per pagina della rotta pubblica /s/<slug> a partire SOLO
    dallo snapshot pubblicato (document, public_slug, locale letti in anon via RLS):
    title e description dal brief reso, Open Graph (og:title/description/type=website/
    url/locale), Twitter card, <link rel="canonical"> assoluto a /s/<slug>, <html lang>
    nella locale del sito, e og:image = URL Storage stabile della hero SOLO se è un
    ImageSlot source:'uploaded' (costruito da asset_id, mai da testo libero).

  definition_of_done:
    - "generateMetadata per la rotta /s/<slug> che legge SOLO lo snapshot pubblicato (document, public_slug, locale) in anon via RLS, mai draft o revisioni"
    - "title e description derivati dal brief reso dello snapshot (nome attività / tagline), troncati a lunghezze massime configurate"
    - "Tag Open Graph presenti: og:title, og:description, og:type=website, og:url (URL assoluto di /s/<slug>), og:locale (locale del sito)"
    - "Twitter card (summary_large_image) emessa"
    - "<link rel=\"canonical\"> = URL assoluto di /s/<slug> (stessa base URL applicativa di og:url)"
    - "<html lang> della rotta pubblica riflette la locale del sito (it/es), non la locale della richiesta"
    - "og:image impostato all'URL Storage costruito da asset_id SOLO quando la hero dello snapshot è ImageSlot source:'uploaded'; assente altrimenti (nessun token placeholder come URL)"
    - "Slug ignoto o non pubblicato -> notFound: nessun metadata di un record non pubblicato"

  acceptance_criteria:
    - id: AC-409-1
      given: "uno snapshot pubblicato con nome attività e tagline noti"
      when: "gira generateMetadata"
      then: "title contiene il nome attività e description contiene il testo della tagline, entrambi troncati a <= lunghezza massima configurata (assert su stringa esatta e su lunghezza)"
    - id: AC-409-2
      given: "un sito pubblicato al public_slug X"
      when: "si generano i metadata"
      then: "og:url e canonical sono byte-uguali all'URL assoluto <base>/s/X e og:type = website"
    - id: AC-409-3
      given: "uno snapshot la cui hero e ImageSlot source:'uploaded' con asset_id A, in una fixture con piu di un asset, valori discordanti e un asset_id PREFISSO di un altro"
      when: "si generano i metadata"
      then: "og:image e l'URL costruito da asset_id A (quello della hero), non di un altro asset, ed e sotto l'host Storage nostro"
    - id: AC-409-4
      given: "uno snapshot SENZA hero caricata (solo placeholder di tema)"
      when: "si generano i metadata"
      then: "og:image e assente (nessun token theme-placeholder ne src da testo libero emesso come URL)"
    - id: AC-409-5
      given: "un sito con locale 'es' servito con locale di richiesta 'it'"
      when: "si generano i metadata e si rende la rotta pubblica"
      then: "og:locale = 'es' e l'attributo <html lang> = 'es' (locale del sito, non della richiesta)"
    - id: AC-409-6
      given: "uno slug ignoto oppure esistente ma con is_published=false"
      when: "gira generateMetadata"
      then: "innesca notFound e non emette title/description del record non pubblicato"

  target_tests:
    - file: "tests/seo-metadata.test.ts"
      covers: [AC-409-1, AC-409-2, AC-409-3, AC-409-4, AC-409-5, AC-409-6]

  security_notes:
    - "Lettura del solo snapshot pubblicato via anon RLS (is_published=true; colonne document/public_slug/locale); account_id e source_generation_id mai letti ne esposti nei metadata (OWASP A01:2025)"
    - "og:image e canonical/og:url costruiti da noi (asset_id -> URL Storage; base URL applicativa), MAI src/url da testo libero del brief (preserva P2-D12, invariante 'nessun src/href da testo libero')"
    - "Slug ignoto/non pubblicato -> notFound: nessun metadata di record non pubblicati (anti-enumerazione P1-D21, OWASP A01:2025)"
    - "generateMetadata gira lato server con client di sessione anon; service_role mai nel browser"

  out_of_scope:
    - "hreflang con alternate (siti v1 mono-locale) — rimandato"
    - "OG image dinamica / card generate (P5)"
    - "Ritocco o generazione AI dei campi del brief (P5)"

- id: T-410
  title: "JSON-LD LocalBusiness con serializzazione SICURA (escaping < > & U+2028/2029, anti-breakout script)"
  macrotask: "seo-base"
  depends_on: [T-405]

  objective: >
    Costruire un oggetto JSON-LD LocalBusiness dai dati brief resi dello snapshot
    pubblicato (name, address, geo, telephone, openingHours, image) e iniettarlo come
    <script type="application/ld+json"> con serializzazione SICURA: encoding JSON piu
    escaping di <, >, & e dei separatori U+2028/U+2029, per impedire il breakout dal
    tag script e la rottura del contesto JS. I campi del brief sono NON FIDATI: e un
    punto di sicurezza, non decorativo.

  definition_of_done:
    - "Builder puro (src/domain) che mappa i campi del brief reso dello snapshot a un oggetto LocalBusiness (@context, @type=LocalBusiness, name, address, geo, telephone, openingHours, image)"
    - "Serializzazione che fa escaping di <, >, & e dei code point U+2028/U+2029 nella stringa JSON prodotta"
    - "Lo <script type=\"application/ld+json\"> riceve la stringa gia escaped come testo (mai raw JSON senza escaping)"
    - "image, quando presente, e l'URL Storage stabile costruito da asset_id (mai da testo libero); assente se la hero non e caricata"
    - "Solo i campi presenti nello snapshot sono emessi (nessun undefined); nessuna colonna privata (account_id, source_generation_id)"

  acceptance_criteria:
    - id: AC-410-1
      given: "un brief il cui nome attivita contiene la sottostringa </script><script>alert(1)</script>"
      when: "si serializza il JSON-LD"
      then: "l'output non contiene la sequenza raw </script>: < e > sono escaped (\\u003c / \\u003e), quindi il tag script non puo essere chiuso"
    - id: AC-410-2
      given: "un campo del brief che contiene i code point U+2028 e U+2029"
      when: "si serializza"
      then: "quei code point compaiono escaped (\\u2028 / \\u2029) nell'output (nessuna rottura di string-literal JS / JSON-in-HTML)"
    - id: AC-410-3
      given: "un brief che contiene & e testo HTML-simile (es. <b>&amp;</b>)"
      when: "si serializza"
      then: "& e escaped e il payload compare SOLO come dato dentro il JSON, non come markup"
    - id: AC-410-4
      given: "un brief valido con name/address/geo/telephone/openingHours"
      when: "si costruisce il JSON-LD"
      then: "JSON.parse dell'output ricostruisce l'oggetto LocalBusiness con quei campi esatti (l'escaping e trasparente al parser JSON — round-trip)"
    - id: AC-410-5
      given: "uno snapshot la cui hero e ImageSlot source:'uploaded' con asset_id A (fixture con piu di un asset, valori discordanti, un asset_id prefisso di un altro); e uno snapshot senza hero caricata"
      when: "si emette il campo image del JSON-LD"
      then: "nel primo caso image = URL costruito da asset_id A (host Storage nostro), mai da testo libero; nel secondo caso image e assente"

  target_tests:
    - file: "tests/jsonld-localbusiness.test.ts"
      covers: [AC-410-1, AC-410-2, AC-410-3, AC-410-4, AC-410-5]

  security_notes:
    - "JSON-LD e un punto di sicurezza, non decorativo: i campi del brief sono NON FIDATI (OWASP A03:2025 injection). Escaping obbligatorio di <, >, & e U+2028/U+2029 contro il breakout dal tag <script type=application/ld+json> e la rottura del contesto JS"
    - "Prova sull'EFFETTO col brief ostile (</script>, U+2028/2029): l'output non contiene </script> raw; falsificabile — la variante senza escaping fa comparire </script> (l'oracolo sa diventare rosso)"
    - "image da asset_id -> URL Storage nostro, mai da testo libero (invariante P2-D12; nessun src/href da testo libero)"
    - "Nessun account_id/source_generation_id o altra colonna privata nel payload JSON-LD (OWASP A01:2025); solo campi del brief reso"
    - "Serializzatore puro in src/domain (nessun I/O, nessun service_role); l'iniezione avviene come testo escaped nel markup lato server"

  out_of_scope:
    - "Altri tipi schema.org oltre LocalBusiness — rimandato"
    - "Validazione/arricchimento AI dei campi (P5)"

- id: T-411
  title: "sitemap.xml per-sito + robots.txt (indicizza /s/*, editor/preview noindex)"
  macrotask: "seo-base"
  depends_on: [T-405]

  objective: >
    Emettere un sitemap.xml per-sito che elenca le pagine pubblicate del sito e un
    robots.txt che consente la scansione di /s/* tenendo noindex su editor/preview.
    Solo i siti pubblicati compaiono: righe non pubblicate o di altri tenant non
    trapelano mai; selezione per public_slug con match ESATTO (mai prefix/LIKE).

  definition_of_done:
    - "sitemap.xml per-sito (servito per uno slug pubblicato) che elenca gli URL assoluti delle pagine pubblicate di quel sito (<loc> = <base>/s/<slug>[+subpath], <lastmod> = published_at), XML valido secondo lo schema urlset"
    - "Solo siti pubblicati compaiono: slug ignoto o is_published=false -> notFound; mai elenca una riga non pubblicata o di un altro tenant"
    - "robots.txt che consente /s/ e fa Disallow delle rotte editor e preview, con riferimento Sitemap:"
    - "Le rotte editor/preview portano robots noindex (metadata) cosi da non essere indicizzate anche se raggiunte"
    - "Tutti gli URL costruiti da public_slug (base URL applicativa), mai da testo libero; valori inseriti nell'XML con escaping dei caratteri speciali XML"

  acceptance_criteria:
    - id: AC-411-1
      given: "un sito pubblicato allo slug X con published_at T"
      when: "si richiede il suo sitemap.xml"
      then: "contiene l'URL assoluto <base>/s/X con <lastmod> = T ed e XML valido (urlset)"
    - id: AC-411-2
      given: "una fixture con piu di un sito: uno pubblicato slug 'cafe', uno NON pubblicato slug 'cafe-2' (prefisso-discordante di 'cafe'), e uno pubblicato di un ALTRO tenant slug 'bar'"
      when: "si genera il sitemap per lo slug 'cafe'"
      then: "risolve con match ESATTO alla sola riga 'cafe' ed elenca SOLO <base>/s/cafe, mai il non pubblicato 'cafe-2' ne il 'bar' di altro tenant"
    - id: AC-411-3
      given: "robots.txt richiesto"
      when: "lo si analizza"
      then: "consente /s/ (assenza di Disallow su /s/), fa Disallow delle rotte editor e preview e contiene una riga Sitemap:"
    - id: AC-411-4
      given: "una rotta editor o preview"
      when: "si rende il suo metadata"
      then: "robots = noindex (la pagina non e indicizzabile)"
    - id: AC-411-5
      given: "uno slug ignoto oppure esistente ma non pubblicato"
      when: "si richiede il suo sitemap.xml"
      then: "risponde notFound (nessun sitemap per un record non pubblicato — anti-enumerazione)"

  target_tests:
    - file: "tests/sitemap-robots.test.ts"
      covers: [AC-411-1, AC-411-2, AC-411-3, AC-411-4, AC-411-5]

  security_notes:
    - "sitemap/robots leggono solo il pubblicato via anon RLS (is_published=true); mai enumerano righe non pubblicate o di altri tenant (OWASP A01:2025); slug ignoto/non pubblicato -> notFound (anti-enumerazione P1-D21)"
    - "Selezione per public_slug con match ESATTO (mai prefix/LIKE): fixture con uno slug prefisso di un altro come guardia d'identita (lezione P1/P2/P3)"
    - "URL costruiti da public_slug (base URL applicativa), mai da testo libero; escaping dei caratteri speciali XML (< > & ' \") nei valori inseriti nel sitemap"
    - "robots.txt fa Disallow di editor/preview + noindex sulle rotte editor/preview: nessun contenuto autenticato o di anteprima indicizzato; Allow /s/*"

  out_of_scope:
    - "sitemap index globale multi-sito / hosting dedicato (pass Cloudflare R2/Worker) — rimandato"
    - "Multi-pagina reale (T3) — rimandato a dopo P4/P5"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir
  `docs/blueprint/P4-publish` — atteso exit 0 / tutti i controlli OK (`11` §5.1).
  Ogni AC di T-409/T-410/T-411 e coperto da >=1 `target_test`, nessun AC orfano;
  `depends_on: [T-405]` risolve verso `02-public-serving.md` (M2).
- **Semantico** (checklist guidata): `self-check-checklist.md` punti 6–10 su ogni
  task; i rilievi vanno all'human-in-the-loop (`11` §5.2–§5.3).
