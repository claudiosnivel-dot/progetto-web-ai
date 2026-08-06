# 01-publish-core — Macrotask `publish-core`

> Modulo del blueprint P4 (Pubblicazione, serving pubblico & media) di Belora. Un
> modulo = un macrotask: l'unità al cui confine gira il checkpoint (`L-COL-018`) e
> l'unità di commit atomico su git (`L-COL-024`). Task atomici secondo lo schema
> trueline (`L-COL-019`): definition_of_done + acceptance_criteria + target_tests.
> Identificatori in inglese, prosa in italiano. Design a monte:
> `docs/superpowers/specs/2026-08-06-p4-publish-media-design.md` (ledger P4-D1…P4-D9).

## Obiettivo del macrotask

Costruire il **layer pubblicato** (P4-D2) e le **azioni di pubblicazione**: la tabella
`site_publications` con la **RLS riconquistata** — membri dell'account in CRUD, `anon`
in SELECT **solo sul pubblicato** — e l'**UNIQUE globale** su `public_slug` (P4-D4); la
logica **pura di dominio** per generare/deduplicare/validare `public_slug` con la lista
dei riservati; e le due server action `publishSite`/`unpublishSite` che congelano il
documento corrente dietro il gate **`parseDocument`** in uno **snapshot** disaccoppiato
dalla potatura FIFO delle revisioni (T-303) e assegnano l'identità pubblica. È il primo
punto in cui un artefatto di Belora diventa **leggibile da `anon`**: la sicurezza è
riconquistata sulla superficie nuova, non ereditata.

Ripartizione di altitudine (gate repo-wide, P4-D9 §6): la **migrazione** vive in
`supabase/migrations`, la logica **pura** dello slug in `src/domain` (nessun accesso DB,
predicato `exists` iniettato), l'**orchestrazione** publish/unpublish e il read-path in
`src/data`/`src/app`. `public-serving` (M2) leggerà questo snapshot via `anon` RLS.

## Task atomici

```yaml
- id: T-401
  title: "Tabella site_publications + RLS (anon-published, owner CRUD) + UNIQUE public_slug"
  macrotask: "publish-core"
  depends_on: []

  objective: >
    Creare la tabella per-sito del layer pubblicato (site_publications) con Row Level
    Security riconquistata — membri dell'account in CRUD, anon in SELECT solo sulle righe
    is_published=true e sulle sole colonne pubbliche — UNIQUE globale su public_slug e FK
    composite verso sites/site_generations come difesa in profondità cross-tenant.

  definition_of_done:
    - "Migration che crea public.site_publications (id uuid, account_id, site_id, source_generation_id, document jsonb, public_slug text, locale, is_published boolean not null default false, published_at timestamptz, created_at, updated_at)"
    - "ENABLE ROW LEVEL SECURITY applicato sulla tabella"
    - "Policy SELECT/INSERT/UPDATE/DELETE TO authenticated ancorate a public.is_account_member(account_id) con account_id ESPLICITO nel testo di ogni policy; nessuna USING (true)"
    - "Policy SELECT TO anon ristretta a is_published = true (anon legge SOLO il pubblicato)"
    - "UNIQUE globale su public_slug e UNIQUE su site_id (uno snapshot per-sito, upsert-abile)"
    - "FK COMPOSITA (account_id, site_id) verso sites (account_id, id) e (account_id, source_generation_id) verso site_generations (account_id, id)"
    - "REVOKE ALL FROM anon, authenticated, service_role, poi GRANT preciso: authenticated CRUD; anon SELECT column-level SOLO su (public_slug, document, locale) — mai account_id/source_generation_id/site_id"

  acceptance_criteria:
    - id: AC-401-1
      given: "la migration è applicata sul DB di test"
      when: "si interroga il catalogo pg per la tabella site_publications"
      then: "row level security risulta abilitata (relrowsecurity = true)"
    - id: AC-401-2
      given: "due account distinti con una publication ciascuno (fixture con più di un account, public_slug discordanti, un account_id che è prefisso di un altro)"
      when: "l'account A interroga/aggiorna/cancella site_publications"
      then: "vede e muta solo le proprie righe, mai quelle dell'account B (RLS membro isola)"
    - id: AC-401-3
      given: "una riga is_published=true e una is_published=false di tenant diversi (fixture con più di una riga, valori discordanti)"
      when: "il ruolo anon interroga site_publications"
      then: "riceve SOLO la riga is_published=true, mai quella non pubblicata né di altri tenant"
    - id: AC-401-4
      given: "una riga pubblicata"
      when: "anon tenta di leggere le colonne account_id o source_generation_id"
      then: "quelle colonne non sono concesse ad anon (GRANT column-level): solo public_slug, document, locale sono leggibili"
    - id: AC-401-5
      given: "una publication già esistente con un dato public_slug e un dato site_id"
      when: "si inserisce una seconda riga con lo stesso public_slug, oppure una seconda riga per lo stesso site_id"
      then: "il vincolo UNIQUE (public_slug globale / site_id) rifiuta la riga"
    - id: AC-401-6
      given: "una publication il cui (account_id, site_id) o (account_id, source_generation_id) punta a un sito/generazione di un ALTRO tenant"
      when: "si tenta l'insert col proprio account_id"
      then: "la FK composita rifiuta la riga (nessuno snapshot cross-tenant)"

  target_tests:
    - file: "tests/site-publications.schema.test.ts"
      covers: [AC-401-1, AC-401-2, AC-401-3, AC-401-4, AC-401-5, AC-401-6]

  security_notes:
    - "RLS RICONQUISTATA (non ereditata) su superficie DB nuova e pubblica (OWASP A01:2025); policy authenticated ancorate a public.is_account_member(account_id) con account_id esplicito nel testo, mai USING (true)"
    - "Policy SELECT TO anon ristretta a is_published = true: anon legge SOLO il pubblicato, mai righe non pubblicate né di altri tenant (P4-D3/P4-D9)"
    - "Colonne private non esposte: GRANT SELECT column-level ad anon limitato a (public_slug, document, locale); account_id/source_generation_id/site_id NON concessi ad anon — difesa a livello DB oltre la SELECT applicativa mirata della rotta (T-405)"
    - "REVOKE ALL FROM anon, authenticated, service_role poi ri-GRANT preciso: le default privileges Supabase concedono REFERENCES/TRIGGER/TRUNCATE (TRUNCATE BYPASSA la RLS) — astenersi non basta (lezione P2-D19)"
    - "FK composite (account_id, site_id) e (account_id, source_generation_id) come difesa in profondità anti cross-tenant oltre la RLS (lezione T-120/T-301)"
    - "service_role bypassa la RLS: mai nel browser, confinata server-side (oracolo/setup)"
    - "UNIQUE globale su public_slug è l'ancora autorevole dell'identità pubblica (P4-D4); UNIQUE su site_id impone lo snapshot per-sito"

  out_of_scope:
    - "Generazione/dedup/riservati di public_slug (T-402)"
    - "publishSite / unpublishSite (T-403 / T-404)"
    - "Prova RLS anon a runtime end-to-end sulla rotta pubblica (T-407)"

- id: T-402
  title: "public_slug: generazione da business_name + dedup globale + slug riservati (dominio puro)"
  macrotask: "publish-core"
  depends_on: []

  objective: >
    Fornire la logica PURA di dominio (nessun accesso DB) che deriva un public_slug dal
    nome attività riusando slugify, evita una lista di slug riservati, deduplica in modo
    deterministico tramite un predicato exists globale iniettato, e valida la forma di uno
    slug editato dall'utente.

  definition_of_done:
    - "Modulo di dominio PURO (nessun import di client DB) che produce un public_slug dal business_name riusando slugify (NFKD, [a-z0-9-], SLUG_MAX_LENGTH)"
    - "Costante RESERVED_PUBLIC_SLUGS con almeno: s, api, admin, auth, login, logout, signup, dashboard, editor, preview, sitemap, robots, static, _next, www"
    - "isReservedSlug(slug) a MATCH ESATTO (non substring): 'admin' è riservato, 'administrator' no"
    - "generateUniquePublicSlug(name, exists) con exists (sync o async) iniettato dal chiamante (legato in T-403 a una query GLOBALE su site_publications): base se libera e non riservata, altrimenti base-2, base-3, …"
    - "Uno slug base che coincide con un riservato è trattato come occupato (mai restituito nudo)"
    - "validatePublicSlug(slug) valida la forma di uno slug editato: ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$, entro SLUG_MAX_LENGTH, non riservato — rifiuta altrimenti"

  acceptance_criteria:
    - id: AC-402-1
      given: "un business_name con diacritici, spazi e simboli (fixture con valori discordanti)"
      when: "si chiama generateUniquePublicSlug con un exists che ritorna sempre false"
      then: "il risultato rispetta ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ entro SLUG_MAX_LENGTH (riuso di slugify, T-104)"
    - id: AC-402-2
      given: "uno slug base già occupato globalmente e anche base-2 occupato (fixture con uno slug occupato che è PREFISSO di un altro slug occupato)"
      when: "si chiama generateUniquePublicSlug"
      then: "ritorna base-3 (dedup ascendente deterministico, per match ESATTO non per prefisso)"
    - id: AC-402-3
      given: "un name che slugifica esattamente a un riservato (es. 'Admin', 'API', 'S')"
      when: "si genera il public_slug"
      then: "il valore riservato non è MAI restituito nudo; è restituita un'alternativa suffissata non riservata"
    - id: AC-402-4
      given: "ogni parola della lista riservati e una parola più lunga che la contiene come prefisso (es. 'admin' vs 'administrator')"
      when: "si valuta isReservedSlug"
      then: "è true SOLO per il match esatto, false per la parola più lunga (nessun blocco per substring)"
    - id: AC-402-5
      given: "slug editati non validi (maiuscole, spazi/simboli, oltre SLUG_MAX_LENGTH, trattino di bordo, un riservato) e uno slug valido non riservato"
      when: "si chiama validatePublicSlug"
      then: "i non validi sono rifiutati e il valido è accettato"

  target_tests:
    - file: "tests/public-slug.test.ts"
      covers: [AC-402-1, AC-402-2, AC-402-3, AC-402-4, AC-402-5]

  security_notes:
    - "Slug ristretto a [a-z0-9-] alla FONTE, prima di finire in URL o query (OWASP A05:2025 — output encoding, no path/filter injection); riuso di slugify (T-104)"
    - "Lista riservati a match ESATTO: impedisce di rivendicare rotte di sistema (s, api, admin, sitemap, robots, _next) — evita clash di routing e spoofing di percorso; falsificabile (ogni riservato provato)"
    - "Dominio PURO, nessun accesso DB: il dedup globale è delegato al predicato exists iniettato (legato in T-403 a site_publications sotto RLS); l'unicità AUTOREVOLE resta il vincolo UNIQUE del DB (T-401), qui è cortesia di generazione, non il gate"
    - "Nessuna fiducia nel client sullo slug editato: validatePublicSlug applica la forma server-side (P4-D4)"

  out_of_scope:
    - "Persistenza/assegnazione dello slug e binding del predicato exists (T-403)"
    - "Vincolo UNIQUE a livello DB (T-401)"

- id: T-403
  title: "publishSite(siteId): gate parseDocument sul documento corrente -> upsert snapshot + is_published=true + assegna public_slug"
  macrotask: "publish-core"
  depends_on: [T-401, T-402]

  objective: >
    Esporre una server action che pubblica un sito posseduto: legge il documento corrente
    (ultima revisione else baseline), lo valida col gate parseDocument, ne congela una
    copia in site_publications con is_published=true e published_at, e assegna/conferma un
    public_slug unico e non riservato — su client di sessione, mai service_role, gratis.

  definition_of_done:
    - "Server action publishSite(siteId) su client di SESSIONE con RLS, mai service_role"
    - "Legge il documento corrente via read-path (ultima revisione else baseline, T-304)"
    - "parseDocument(document) chiamato PRIMA di ogni scrittura dello snapshot (gate strict, <=8 MiB, slug unici, una home); documento invalido -> nessuna pubblicazione"
    - "Upsert in site_publications: document = COPIA validata, source_generation_id impostato, locale del sito, is_published=true, published_at=now"
    - "public_slug: al primo publish generato con generateUniquePublicSlug legato a un exists GLOBALE su site_publications (T-402), evitando i riservati; al re-publish il public_slug esistente è PRESERVATO (identità stabile)"
    - "Ownership verificata: sito non posseduto o inesistente -> notFound (anti-enumerazione); azione GRATIS (0 crediti); ritorna public_slug e l'URL /s/<slug>"

  acceptance_criteria:
    - id: AC-403-1
      given: "un sito posseduto con un documento corrente (ultima revisione else baseline)"
      when: "si chiama publishSite"
      then: "esiste una riga site_publications con is_published=true, document uguale alla copia validata del documento corrente, source_generation_id e published_at impostati"
    - id: AC-403-2
      given: "un documento corrente che non supera parseDocument (due home, oltre 8 MiB, slug duplicato)"
      when: "si chiama publishSite"
      then: "è rifiutato e NESSUNA riga di publication è scritta o aggiornata (gate prima della scrittura)"
    - id: AC-403-3
      given: "il primo publish di un sito il cui business_name slugifica a uno slug già occupato globalmente (fixture con uno slug occupato prefisso di un altro)"
      when: "si chiama publishSite"
      then: "il public_slug assegnato è libero, deduplicato e non riservato, mai una parola riservata"
    - id: AC-403-4
      given: "un sito già pubblicato con public_slug X"
      when: "si chiama di nuovo publishSite (re-publish) dopo nuove modifiche"
      then: "lo stesso slug X è preservato e il document dello snapshot è aggiornato al documento corrente"
    - id: AC-403-5
      given: "un sito non posseduto dall'utente o inesistente"
      when: "si chiama publishSite"
      then: "risponde notFound (anti-enumerazione P1-D21), nessuna riga per quel tenant, mai un errore distinguibile per esistenza"
    - id: AC-403-6
      given: "un sito appena pubblicato, poi nuove revisioni scritte con potatura FIFO (T-303) che elimina le più vecchie"
      when: "si rilegge site_publications.document"
      then: "lo snapshot pubblicato è invariato (congelato, disaccoppiato dalla potatura delle revisioni — P4-D2)"

  target_tests:
    - file: "tests/publish-site.test.ts"
      covers: [AC-403-1, AC-403-2, AC-403-3, AC-403-4, AC-403-5, AC-403-6]

  security_notes:
    - "Gate parseDocument PRIMA di ogni scrittura dello snapshot (OWASP A05:2025): nessun documento non validato pubblicato; si persiste una COPIA validata, non un riferimento mutabile"
    - "Client di SESSIONE con RLS, mai service_role; ownership verificata; sito altrui/inesistente -> notFound (anti-enumerazione P1-D21)"
    - "Snapshot CONGELATO disaccoppiato dalla potatura FIFO delle revisioni (P4-D2): la publication non è cancellabile da T-303"
    - "public_slug assegnato dal SERVER (generazione + dedup globale + riservati, T-402), ancorato dal UNIQUE del DB (T-401) contro la race di dedup; slug stabile al re-publish"
    - "Nessun src/href da testo libero introdotto nello snapshot (P2-D12): è la copia validata del documento reso dal renderer unico"
    - "Pubblicazione GRATIS (0 crediti) in v1 (P4-D5)"

  out_of_scope:
    - "unpublishSite (T-404)"
    - "Serving pubblico /s/<slug> e metadata (T-405, M3)"
    - "Modifica manuale del public_slug editato (validazione forma in T-402)"

- id: T-404
  title: "unpublishSite(siteId): is_published=false, snapshot preservato"
  macrotask: "publish-core"
  depends_on: [T-401]

  objective: >
    Esporre una server action che ritira dalla pubblicazione un sito posseduto portando
    is_published=false senza distruggere lo snapshot né il public_slug, così che il sito
    sparisca dalla vista anon ma possa essere ri-pubblicato con la STESSA identità.

  definition_of_done:
    - "Server action unpublishSite(siteId) su client di SESSIONE con RLS, mai service_role"
    - "Porta is_published=false sulla publication del sito; document (snapshot) e public_slug sono PRESERVATI (riga NON cancellata)"
    - "Ownership verificata: sito non posseduto o senza publication -> notFound (anti-enumerazione)"
    - "Dopo l'unpublish la riga non è più leggibile da anon (RLS anon-published); un publishSite successivo ripubblica con lo stesso public_slug"

  acceptance_criteria:
    - id: AC-404-1
      given: "un sito posseduto e pubblicato"
      when: "si chiama unpublishSite"
      then: "is_published=false e document + public_slug restano invariati (la riga non è eliminata)"
    - id: AC-404-2
      given: "un sito appena ritirato dalla pubblicazione"
      when: "il ruolo anon interroga quella riga"
      then: "non è più restituita (RLS anon-published: is_published=false invisibile ad anon)"
    - id: AC-404-3
      given: "un sito ritirato e poi ripubblicato"
      when: "si chiama di nuovo publishSite"
      then: "è riusato lo stesso public_slug (identità pubblica preservata al re-publish)"
    - id: AC-404-4
      given: "un sito non posseduto o senza publication (fixture con più di un tenant, un account_id prefisso di un altro)"
      when: "si chiama unpublishSite"
      then: "risponde notFound (anti-enumerazione P1-D21) e nessuna riga di un altro tenant è toccata"

  target_tests:
    - file: "tests/unpublish-site.test.ts"
      covers: [AC-404-1, AC-404-2, AC-404-3, AC-404-4]

  security_notes:
    - "Client di SESSIONE con RLS, mai service_role; ownership verificata; sito altrui -> notFound (anti-enumerazione P1-D21)"
    - "Unpublish NON distruttivo: snapshot e public_slug preservati (ri-pubblicazione con stesso slug); nessun DELETE della riga"
    - "RLS anon-published (OWASP A01:2025): portato is_published=false, la riga sparisce dalla vista anon senza alterarne il contenuto"

  out_of_scope:
    - "Cancellazione definitiva della publication / rilascio dello slug (fuori scope v1)"
    - "Serving pubblico e SEO (M2/M3)"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir `docs/blueprint/P4-publish`
  — atteso exit 0 / tutti i controlli OK (`11` §5.1).
- **Semantico** (checklist guidata): `self-check-checklist.md` punti 6–10 su ogni task; i
  rilievi vanno all'human-in-the-loop (`11` §5.2–§5.3).
