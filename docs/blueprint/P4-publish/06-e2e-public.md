# 06-e2e-public — Macrotask `e2e-public`

> Modulo del blueprint P4 (Pubblicazione, serving pubblico & media) di Belora. Un
> modulo = un macrotask (`L-COL-018`, `L-COL-024`). Task atomici secondo lo schema
> trueline (`L-COL-019`). È l'**ultimo** macrotask del sotto-progetto e la sua **prova
> di punta**: chiude il DAG di P4 esercitando insieme la rotta pubblica (M2), la SEO
> (M3) e i media (M4/M5). DAG: `public-serving` + `seo-base` + `media-editor-render` →
> `e2e-public`. Identificatori in inglese, prosa in italiano.

## Obiettivo del macrotask

Portare la **prova sull'EFFETTO** (Chromium, `assertNoInjectionEffect` + canary) sulla
**superficie a più alto rischio** finora: la rotta pubblica `/s/<slug>`, letta da **anon**,
fuori dall'area autenticata. È l'estensione di T-241 (anteprima) e T-317 (editor) al primo
punto in cui un artefatto di Belora **esce nel mondo** (P4-D3, P4-D9): lo **stesso** oracolo
condiviso di T-240, la **stessa** disciplina "leggi ciò che il browser HA FATTO" (contatore,
richieste col loro host, navigazioni, errori di console), applicata a un documento **pubblicato
ostile** che stavolta porta anche **due superfici nuove**: un **asset caricato** reso da
`SiteImage source:'uploaded'` (la prova che `asset_id → URL nostro` tiene, P2-D12/P4-D7) e il
**JSON-LD `LocalBusiness`** iniettato nella pagina (la prova che l'escaping anti-breakout dallo
`<script>` tiene sull'effetto, P4-D8). Il verde vale **solo** perché lo stesso oracolo, montato
sul canary insicuro, sa diventare **ROSSO**.

## Task atomici

```yaml
- id: T-417
  title: "e2e ostile Chromium su /s/<slug>: documento pubblicato ostile + asset caricato -> assertNoInjectionEffect (effetto nullo, payload come testo) + canary ROSSO"
  macrotask: "e2e-public"
  depends_on: [T-405, T-409, T-410, T-416]

  objective: >
    Esercitare i payload ostili sulla rotta pubblica /s/<slug> letta da anon e provare
    sull'EFFETTO (Chromium) che un documento PUBBLICATO ostile — inclusi un asset caricato
    (ImageSlot source:'uploaded') e il JSON-LD LocalBusiness — non produce iniezione: il
    testo non fidato resta TESTO, l'src dell'immagine è il nostro URL costruito da asset_id
    (mai testo libero, mai host attaccante), il JSON-LD non fa breakout dallo script tag; col
    canary che dimostra che lo stesso oracolo condiviso sa diventare rosso sulla stessa superficie.

  definition_of_done:
    - "Uno spec e2e Chromium (e2e/public-hostile.spec.ts) naviga la rotta PUBBLICA /s/<slug> da un contesto ANON (nessuna sessione), su una riga site_publications seminata con is_published=true, public_slug assegnato e document = buildHostileDocument() esteso con un ImageSlot source:'uploaded' (asset_id reale: riga assets + oggetto Storage re-encodato) — il tutto passato da parseDocument"
    - "L'oracolo condiviso assertNoInjectionEffect (T-240) gira sulla pagina pubblica con un'ALLOWLIST degli host DICHIARATA nel test che include l'app host e l'host Storage pubblico ed ESCLUDE l'host attaccante (ATTACKER_HOST)"
    - "Tutti e sei i payload ostili di HOSTILE_PAYLOADS compaiono come CONTENUTO TESTUALE della pagina pubblica (anti-placebo); la risposta è 200 servita ad anon"
    - "L'<img> dello slot 'uploaded' ha src verso il nostro host Storage costruito da asset_id (P2-D12), mai verso ATTACKER_HOST né testo libero; la fixture asset ha >1 elemento con asset_id DISCORDANTI e un asset_id PREFISSO di un altro, e l'src reso corrisponde all'asset_id ESATTO"
    - "Il <script type=\"application/ld+json\"> del LocalBusiness è reso con i campi brief ostili escaped (nessun breakout dal tag: nessun secondo script eseguito, JSON.parse del contenuto riesce come singolo oggetto)"
    - "Il canary insicuro (e2e/canary/insecure-canary.ts, montato via page.setContent, mai una rotta app) fa FALLIRE lo STESSO assertNoInjectionEffect con la STESSA allowlist; canary confinato (il suo marker letterale mai in src/ né nel bundle .next, presente solo sotto e2e/, Chromium-only, suite vitest/e2e disgiunte)"

  acceptance_criteria:
    - id: AC-417-1
      given: "la rotta pubblica /s/<slug> caricata da anon su un documento PUBBLICATO ostile (buildHostileDocument + asset 'uploaded'), con le osservabili agganciate PRIMA della navigazione"
      when: "si asserisce l'effetto sulla pagina pubblica (assertNoInjectionEffect con l'allowlist dichiarata)"
      then: "window.__belora_pwned uguale a 0, nessuna richiesta verso host fuori allowlist (in particolare nessuna verso ATTACKER_HOST), nessuna navigazione del frame principale oltre l'URL /s/<slug>, nessun errore di console attribuibile a codice iniettato e nessuna eccezione non catturata"
    - id: AC-417-2
      given: "il documento pubblicato ostile con i sei payload nei campi esatti (offerte >1, DISCORDANTI, con 'Tagliere' PREFISSO di 'Tagliere della casa')"
      when: "anon carica /s/<slug> e si legge document.body.textContent"
      then: "la risposta è 200 e tutti e sei i payload (HOSTILE_PAYLOADS, length 6) compaiono come TESTO byte-per-byte, nessuno come markup — prova che la superficie pubblica esercita davvero i payload e non passa per scarto a monte"
    - id: AC-417-3
      given: "il documento pubblicato contiene un ImageSlot source:'uploaded' con un asset_id reale, accanto a un tentativo di URL ostile in un campo testuale (ATTACKER_HOST), e la fixture assets ha >1 riga con asset_id DISCORDANTI di cui uno PREFISSO di un altro"
      when: "SiteImage rende lo slot sulla pagina pubblica"
      then: "l'<img> ha src verso il nostro host Storage costruito dall'asset_id ESATTO (nell'allowlist), mai verso ATTACKER_HOST né da testo libero, e nessuna richiesta di rete parte verso ATTACKER_HOST"
    - id: AC-417-4
      given: "un brief ostile i cui campi alimentano il JSON-LD LocalBusiness con una sequenza di breakout </script> e i caratteri < > & U+2028 U+2029"
      when: "la pagina pubblica rende il <script type=\"application/ld+json\">"
      then: "il payload NON esce dal tag script (nessun secondo script eseguibile iniettato, window.__belora_pwned resta 0), la sequenza </script> è escaped e JSON.parse del contenuto del blocco riesce come un singolo oggetto"
    - id: AC-417-5
      given: "il canary insicuro montato via page.setContent con lo stesso payload ostile (HOSTILE_PAYLOADS.eventAttribute), le osservabili agganciate"
      when: "gira lo STESSO assertNoInjectionEffect con la STESSA allowlist dichiarata"
      then: "l'oracolo diventa ROSSO (throw /effetto d'iniezione rilevato/) mentre readInjectionCounter è maggiore di 0 (sanity: l'iniezione è avvenuta), a prova che il verde di AC-417-1 non è un placebo"

  target_tests:
    - file: "e2e/public-hostile.spec.ts"
      covers: [AC-417-1, AC-417-2, AC-417-3, AC-417-4, AC-417-5]

  security_notes:
    - "Prova sull'EFFETTO in Chromium (non sulla FORMA jsdom): estende T-241 (anteprima) e T-317 (editor) alla superficie PUBBLICA e ANON /s/<slug>, la più esposta di P4 (P4-D3, P4-D9)"
    - "OWASP A03:2025 (injection/XSS): testo non fidato reso come children React dal renderer UNICO SiteView (escaping preservato, nessun dangerouslySetInnerHTML); JSON-LD LocalBusiness serializzato con escaping di < > & U+2028/2029 anti-breakout dallo <script> (P4-D8), provato sull'effetto — non decorativo, i campi sono non fidati"
    - "P2-D12/P4-D7 preservati: l'src dell'immagine è costruito da noi da asset_id -> URL del nostro host Storage (nell'allowlist), MAI da testo libero; nessuna richiesta di rete raggiunge ATTACKER_HOST"
    - "OWASP A01:2025 (RLS anon-published): il documento è servito ad anon solo perché is_published=true; account_id/source_generation_id non sono nel document reso (colonne private mai esposte); service_role mai nel browser — il render pubblico usa il client anon"
    - "gate parseDocument (A05:2025) su ciò che è pubblicato e reso: la fixture del documento ostile passa dal percorso reale (parseDocument) o il seed fallisce — così i payload provati sono quelli che il gate lascia passare, non ne più permissivi"
    - "Allowlist degli host DICHIARATA nel test (non implicita): include l'app host e l'host Storage pubblico, esclude ATTACKER_HOST; la raccolta delle richieste è non vacua (anon ha chiesto almeno il documento e l'asset), così 'nessun host esterno' non è vero per raccolta vuota"
    - "Canary confinato (L-COL-006): il suo marker letterale mai in src/ né nel bundle .next, presente solo sotto e2e/ (garanzia in tests/e2e-canary-confinement.test.ts), montato SOLO via page.setContent mai una rotta app, Chromium-only, suite vitest/e2e disgiunte — un canary in produzione sarebbe una vulnerabilità introdotta per provarne l'assenza"

  out_of_scope:
    - "notFound anti-enumerazione per slug ignoto/non pubblicato (T-405) e prova RLS runtime che anon non legge il non-pubblicato né di altri tenant (T-407)"
    - "Prova sull'effetto del re-encode upload (raster pulito / SVG rifiutato / EXIF strippato) (T-413)"
    - "Checkpoint monolitico 4/4 al confine del macrotask (dead-code · security incl. RLS · regressioni · conformità), operativo su stato pulito (rm -rf .next + db:reset) — non è un task del blueprint"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir `docs/blueprint/P4-publish`
  — atteso exit 0 / tutti i controlli OK (`11` §5.1). Ogni AC di T-417 è tracciato dal target_test
  `e2e/public-hostile.spec.ts` (tag `// covers` nel file in BUILD `--blueprint`); nessun AC orfano.
- **Semantico** (checklist guidata): `self-check-checklist.md` punti 6–10 sul task; i rilievi vanno
  all'human-in-the-loop (`11` §5.2–§5.3).
