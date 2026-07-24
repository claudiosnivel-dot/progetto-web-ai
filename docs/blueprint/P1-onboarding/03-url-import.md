# 03-url-import — Macrotask `url-import` · Import da sito (SSRF-safe)

> Modulo del blueprint P1 (Onboarding) di Belora. Un modulo = un macrotask.
> Task atomici secondo lo schema trueline.
>
> **Substrato P0:** convenzione di layering `src/domain`, confine LLM mockabile
> `src/data/anthropic.ts` (T-131, macrotask ai-onboarding) per la strutturazione AI.
> I `depends_on` qui referenziano solo task P1.
>
> **Superficie di sicurezza critica.** L'import scarica URL arbitrari forniti
> dall'utente: e SSRF per costruzione. La guardia (blocco IP privati/riservati,
> re-check sui redirect, limiti) e un requisito di sicurezza di prima classe
> (OWASP A01:2025 — SSRF assorbita in Broken Access Control; CWE-918).

## Obiettivo del macrotask

Trasformare un URL fornito dall'utente in un **brief proposto** (mai auto-confermato):
un fetch server-side SSRF-safe, e un'estrazione deterministica-prima (JSON-LD/schema.org
LocalBusiness, Open Graph, meta) con strutturazione AI del residuo dietro il confine
mockabile. Il risultato pre-riempie il pannello del brief; l'utente rivede sempre.

## Task atomici

```yaml
- id: T-140
  title: "Fetch SSRF-safe (guardia server-side)"
  macrotask: "url-import"
  depends_on: []
  objective: >
    Implementare in src/domain/import/fetchSafe.ts un fetcher server-side sicuro:
    accetta solo schemi http/https; risolve il DNS e BLOCCA gli IP privati/riservati/
    loopback/link-local (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16 incluso
    169.254.169.254 metadata cloud, ::1, fc00::/7); ri-controlla il target a OGNI hop
    di redirect; impone timeout, dimensione massima della risposta e numero massimo di
    redirect; accetta solo content-type text/html. Restituisce l'HTML o un risultato
    di errore/bloccato tipizzato. Nessun contenuto viene mai restituito per host interni.
  definition_of_done:
    - "Funzione server-side che dato un URL restituisce HTML testuale oppure un risultato tipizzato bloccato/errore"
    - "schemi diversi da http/https rifiutati prima di qualunque connessione"
    - "risoluzione DNS + blocco degli IP privati/riservati/loopback/link-local (inclusi 127.0.0.1, 10.x, 192.168.x, 169.254.169.254, ::1) prima di connettersi"
    - "ogni target di redirect e ri-validato con lo stesso blocco IP (nessun bypass via redirect)"
    - "timeout, dimensione massima della risposta e numero massimo di redirect applicati"
    - "solo content-type text/html accettato; altri content-type rifiutati"
  acceptance_criteria:
    - id: AC-140-1
      given: "un URL il cui host risolve a un IP privato/riservato (es. 127.0.0.1, 10.0.0.5, 169.254.169.254)"
      when: "chiamo il fetcher"
      then: "il risultato e 'bloccato' e nessun contenuto del target interno viene restituito"
    - id: AC-140-2
      given: "un URL con schema non http/https (es. file://, ftp://, gopher://)"
      when: "chiamo il fetcher"
      then: "il risultato e 'rifiutato' senza effettuare alcuna richiesta di rete"
    - id: AC-140-3
      given: "un URL pubblico valido che risponde con un redirect verso un IP privato"
      when: "chiamo il fetcher e si segue il redirect"
      then: "il redirect verso l'IP privato e bloccato all'hop di redirect e nessun contenuto interno viene restituito"
    - id: AC-140-4
      given: "un URL pubblico (mockato) la cui risposta supera la dimensione massima"
      when: "chiamo il fetcher"
      then: "la risposta e troncata/rifiutata secondo il limite e non restituisce un body oltre il massimo"
    - id: AC-140-5
      given: "un URL pubblico (mockato) che risponde 200 con content-type text/html"
      when: "chiamo il fetcher"
      then: "il risultato contiene il body HTML della pagina"
    - id: AC-140-6
      given: "un URL pubblico (mockato) che risponde con content-type application/octet-stream (non text/html)"
      when: "chiamo il fetcher"
      then: "il risultato e rifiutato per content-type non ammesso"
  target_tests:
    - file: "tests/fetch-safe.test.ts"
      covers: [AC-140-1, AC-140-2, AC-140-3, AC-140-4, AC-140-5, AC-140-6]
  security_notes:
    - "OWASP A01:2025 (SSRF, assorbita in Broken Access Control) / CWE-918: la guardia blocca gli IP privati/riservati e i metadata endpoint cloud (169.254.169.254) prima della connessione e a ogni redirect (verificato in AC-140-1, AC-140-3), impedendo che l'import raggiunga risorse interne."
    - "Limiti di timeout/dimensione/redirect e allowlist di schema/content-type riducono la superficie d'abuso (DoS, esfiltrazione, redirect chain)."
  out_of_scope:
    - "Parsing/estrazione dei dati dal brief (T-141)"
    - "Rispetto robots/ToS oltre lo User-Agent identificabile (best-effort, dichiarato)"

- id: T-141
  title: "Estrazione brief da HTML (deterministica-prima, AI-poi mockata)"
  macrotask: "url-import"
  depends_on: [T-140, T-121]
  objective: >
    Implementare src/domain/import/fromUrl.ts che orchestra l'import: scarica via
    fetchSafe (T-140), estrae in modo DETERMINISTICO i dati strutturati (JSON-LD/
    schema.org LocalBusiness -> name/address/hours/telephone/geo; Open Graph -> title/
    description; meta description; <title>; heading) in un brief parziale; opzionalmente
    passa il testo ripulito al confine LLM (T-131, structured-outputs) per strutturare il
    residuo — mockato nei test. L'output e un BRIEF PROPOSTO, validato con BriefSchema
    (T-121), mai persistito (nessuna scrittura DB).
  definition_of_done:
    - "Funzione fromUrl(url) -> brief parziale PROPOSTO (non persistito)"
    - "estrazione deterministica da JSON-LD LocalBusiness (name, address, telephone, opening hours) e da Open Graph/meta, senza chiamata al modello quando i dati strutturati bastano"
    - "la strutturazione AI del residuo passa per il confine mockabile (T-131) ed e opzionale"
    - "l'output e validato con BriefSchema (T-121); output invalido dell'AI scartato"
    - "la funzione NON scrive sul DB: restituisce una proposta (status non 'confirmed')"
  acceptance_criteria:
    - id: AC-141-1
      given: "HTML con un blocco JSON-LD schema.org LocalBusiness (name, address, telephone, openingHours)"
      when: "chiamo fromUrl (fetch mockato che restituisce quell'HTML)"
      then: "il brief proposto ha business_name, address, phone e hours valorizzati dai dati JSON-LD, in modo deterministico e senza invocare il confine LLM"
    - id: AC-141-2
      given: "HTML privo di JSON-LD ma con tag Open Graph (og:title, og:description)"
      when: "chiamo fromUrl (fetch mockato)"
      then: "business_name deriva da og:title e description da og:description"
    - id: AC-141-3
      given: "un confine LLM mockato che, per il residuo non strutturato, ritorna un campo invalido (vertical fuori allowlist)"
      when: "chiamo fromUrl"
      then: "l'output AV invalido e scartato dalla validazione (T-121) e non finisce nel brief proposto"
    - id: AC-141-4
      given: "un HTML valido"
      when: "chiamo fromUrl"
      then: "il valore restituito e una proposta con status diverso da 'confirmed' e la funzione non effettua alcuna scrittura sul DB"
  target_tests:
    - file: "tests/import-fromurl.test.ts"
      covers: [AC-141-1, AC-141-2, AC-141-3, AC-141-4]
  security_notes:
    - "OWASP A01:2025 (SSRF): il fetch passa esclusivamente per fetchSafe (T-140); fromUrl non apre connessioni proprie."
    - "OWASP A05:2025 (validation): l'HTML e l'output del modello sono input NON FIDATO — il brief proposto e validato con BriefSchema (T-121) prima di essere restituito; nessun auto-commit (l'utente rivede sempre)."
    - "OWASP A07:2025/A02:2025 (segreti): la strutturazione AI usa solo il confine server-only (T-131); nessun segreto nel sorgente."
  out_of_scope:
    - "Persistenza del brief (T-123)"
    - "UI della barra di import (T-151)"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir del blueprint P1 — atteso exit 0.
- **Semantico** (checklist guidata): punti 6–10 su ogni task; i rilievi vanno all'human-in-the-loop.
