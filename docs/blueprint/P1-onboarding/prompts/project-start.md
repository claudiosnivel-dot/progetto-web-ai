# project-start — Belora · P1 (Onboarding)

> Da incollare **una volta**, all'avvio del sotto-progetto P1, per orientare l'agente al
> blueprint P1, alle decisioni chiuse, al piano di macrotask e alle invarianti. Con la
> skill trueline presente e **BUILD** a eseguire questa disciplina; questo prompt e il
> ponte di portabilita cross-tool.

```
Stai per costruire il sotto-progetto **P1 (Onboarding)** di **Belora** (supabase-jsts;
JS/TS + Supabase). P0 (fondamenta) e COMPLETO e verde su main. Il PIANO E IL BLUEPRINT P1:
da qui si scrive codice secondo i task, non si reinventa il design.

PRIMA DI TUTTO — leggi, in quest'ordine:
  1. docs/blueprint/P1-onboarding/SESSION-STATE.md → fonte di verita sullo STATO VIVO di P1.
     Leggila prima di qualunque azione, sempre.
  2. docs/blueprint/P1-onboarding/ → il PIANO: 00-INDEX (mappa, piano di build, decision
     ledger) + i moduli 01-brief-model … 04-onboarding-ui, ognuno un macrotask coi suoi task
     atomici. Ogni task porta definition_of_done + acceptance_criteria + target_tests: sono
     questi i criteri contro cui si misura "fatto", non un'impressione.
  3. docs/superpowers/specs/2026-07-24-p1-onboarding-design.md → il design a monte (intento).
  4. Substrato gia costruito: docs/blueprint/P0-foundations/ (sites, tenancy, auth, i18n,
     AppShell) — referenziato in prosa nei moduli P1, NON nel DAG P1.

DECISIONI BLOCCATE (ledger di 00-INDEX, P1-D1..P1-D11 — CHIUSE salvo emendamento esplicito):
  scope interview-core (import GBP/IG → P1.x); flusso chat-led + pannello brief live; Brief
  core+offerings flessibili+tag vertical; modello Haiku 4.5 via ANTHROPIC_MODEL_ONBOARDING;
  import-URL come prefill opzionale; DAG interno a P1; confine LLM server-only mockabile
  (src/data/anthropic.ts); site_briefs 1:1 con site (RLS clonata da sites); media = solo
  riferimenti (hosting → P4); contratto di altitudine ANCORA RINVIATO (P1-D11). In dubbio,
  fermati e chiedi.

PIANO DI MACROTASK (rispetta il DAG interno):
  - brief-model    (dipendenze P1: nessuna) — la spina dorsale (site_briefs + dominio + RLS)
  - ai-onboarding  (usa brief-model per merge/complete) — confine LLM + intervista
  - url-import     (usa brief-model + confine LLM) — SSRF-safe + estrazione
  - onboarding-ui  (usa brief-model + ai-onboarding + url-import) — flusso, chat, conferma
  Ordine consigliato: brief-model → ai-onboarding & url-import → onboarding-ui.
  Un macrotask e l'unita al cui confine gira il CHECKPOINT ed e l'unita di commit atomico.

SUPERFICI DI SICUREZZA NUOVE IN P1 (oltre alla RLS gia nota da P0):
  • SEGRETO ANTHROPIC_API_KEY: server-only, mai NEXT_PUBLIC, mai nel sorgente → gitleaks 0.
  • SSRF (import-URL): bloccare IP privati/riservati + metadata cloud (169.254.169.254),
    re-check a ogni redirect (OWASP A01:2025, CWE-918).
  • INPUT NON FIDATO: l'output del modello e l'HTML importato vanno validati server-side
    (BriefSchema) prima di ogni scrittura.

INVARIANTI NON NEGOZIABILI (regole della casa):
  • ORACLE-AS-JUDGE, MAI LLM-AS-JUDGE. Il confine LLM e mockato nei test → la
    non-determinazione del modello NON entra negli oracoli.
  • LOOP DI VERIFICA DELLA FIX OBBLIGATORIO (applica → riesegui STESSO oracolo → riesegui
    test → accetta solo se sparito e nulla rotto).
  • HUMAN-IN-THE-LOOP SULLE FIX; DEAD-CODE MAI CANCELLATO IN AUTONOMIA.
  • GIT A STRATI: branch autonomo; merge su main GATED dal verde; distruttive mai autonome;
    DEPLOY NON SUPERVISIONATO BLOCCATO (override deploy-coupling false da riconfermare).
  • NESSUN FALSO "VIA LIBERA"; COPERTURA SEMPRE DICHIARATA.

Conferma di aver letto SESSION-STATE e il blueprint P1, riepiloga in poche righe lo stato e
il primo macrotask eseguibile (brief-model), segnala incoerenze, e ATTENDI il mio via prima
di scrivere codice.
```
