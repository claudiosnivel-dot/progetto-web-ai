# Audit degli oracoli — Superfici 4 e 5: SITI ACCOUNT-SCOPED e BRIEF 1:1

> Piano `AUDIT-ORACOLI-P0-P1.md` §3. Data: 2026-07-29.
> **Scostamento dichiarato**: le due superfici sono state auditate in un ciclo solo.
> `sites` e `site_briefs` sono strutturalmente gemelle — stesso ancoraggio `account_id`,
> stesse quattro policy `is_account_member(account_id)`, stesse server action con lo stesso
> preambolo — e le mutazioni si applicano identiche a entrambe. E una scelta di efficienza,
> non una riduzione di copertura: entrambe hanno ricevuto la propria batteria.
>
> Baseline: **5 file, 35 test, 0 falliti, 0 skippati**.
> **10 mutazioni applicate, 10 esiti registrati, 10 ripristini verificati per hash.**

## 1. Le mutazioni applicate

### 1a. Prese (5)

| ID | Mutazione | Esito |
|---|---|---|
| SB2 | tutte le policy di scrittura di `sites` a `false` (**nessuno** puo scrivere) | **ROSSO** (8 test) |
| SB4 | FK **composita** `(account_id, site_id)` declassata a FK semplice su `site_id` | **ROSSO** — con un test cross-tenant a runtime |
| SB5 | `UNIQUE (site_id)` rimosso: il brief non e piu 1:1 | **ROSSO** (8 test) |
| SB7 | `sites_select_member` allargata a `account_id is not null` | **ROSSO** |
| SC2 | guardia `401` rimossa da `createSite` | **ROSSO** |

### 1b. NON prese — buchi d'oracolo (3)

| ID | Mutazione | Esito |
|---|---|---|
| SB1 | `sites_delete_member` neutralizzata: `using (account_id is not null)` | **VERDE 35/35** |
| SB6 | `site_briefs_delete_member` neutralizzata, idem | **VERDE 35/35** |
| SC1 | `deleteSite` cancella **tutti** i siti visibili invece del solo `siteId` | **VERDE 35/35** |

### 1c. Prove di equivalenza (2) — entrambe VERDI, gli oracoli non sono rigidi
`SB8` predicato avvolto in un `(select ...)` · `SC3` `if (!user)` → `if (user == null)`.

## 2. Rilievi

Nessun **difetto attivo**.

### S45-01 — HIGH · le policy DELETE di `sites` e `site_briefs` non hanno oracolo
Entrambe possono essere neutralizzate in `using (account_id is not null)` — che consente a
**qualunque utente autenticato di cancellare qualunque sito o brief di qualunque account** —
con 35 test su 35 verdi.

**La causa esatta e stata isolata**, e non e "manca un test": un test c'e.
`sites-schema.test.ts` asserisce che l'espressione di ogni policy **contenga** la stringa
`account_id` (lo si vede dal fallimento di SB2: *`expected ' false' to contain 'account_id'`*).
Ma `account_id is not null` **contiene** `account_id` pur essendo del tutto permissivo.
**L'asserzione e per SOTTOSTRINGA dove servirebbe l'espressione ESATTA** — ed e esattamente
il pattern che P2 ha gia adottato: `site-generations-schema.test.ts` confronta
`norm(qual)` con la stringa esatta `is_account_member(account_id)`.

**Questa e la quarta e la quinta occorrenza dello stesso schema.** Il comando DELETE risulta
senza oracolo efficace su **`account_members`** (T-02), **`profiles`** (S2-01), **`sites`** e
**`site_briefs`**. Su nessuna delle quattro esiste un test che esegua un `.delete()` come
utente non autorizzato.

### S45-02 — MEDIUM · `deleteSite` puo cancellare tutto senza che nessuno se ne accorga
Sostituendo `.eq('id', siteId)` con un predicato che seleziona tutte le righe visibili,
`deleteSite` **cancella tutti i siti del chiamante** invece di uno, e 35 test su 35 restano
verdi. La RLS contiene il danno al proprio account — non e un buco cross-tenant — ma resta
distruzione di dati non richiesta.
**Causa**: i test asseriscono *"il sito e sparito"* e mai *"gli altri sono sopravvissuti"*.
E la lezione delle fixture a un solo elemento, gia costata tre volte in P1, applicata alla
cancellazione: con un solo sito nell'account, "cancella quello giusto" e "cancella tutto"
sono indistinguibili.

## 3. Cosa e confermato solido — e qui c'e parecchio

Queste due superfici sono **le meglio oracolate delle cinque viste finora**:

- **La FK COMPOSITA e asserita per davvero** (SB4 rosso), e non da un controllo di catalogo
  ma da un test di comportamento cross-tenant: *"un brief con `account_id` proprio ma
  `site_id` di un altro tenant e respinto dalla FK composita (SQLSTATE 23503)"*. E la difesa
  di T-120, e c'e un oracolo che la tiene. Contrasto netto con la superficie 1, dove la stessa
  classe di mutazione su una FK **non** era stata presa (rilievo T-05).
- **Il percorso POSITIVO esiste** (SB2 rosso, 8 test): ci sono test in cui il proprietario
  legittimo crea, rinomina ed elimina **davvero**, e l'effetto e riletto e asserito. E il
  pattern che manca alla superficie 1 (rilievo T-03).
- **L'unicita 1:1 del brief e pinnata** da due lati: catalogo e violazione a runtime (23505).
- **La guardia di auth applicativa e oracolata** (SC2 rosso), distinta dalla RLS.
- **Nessun oracolo e rigido**: due riscritture equivalenti restano verdi.

## 4. Conseguenza per la fase di fix

Il rilievo S45-01 non va corretto cinque volte in cinque modi. La correzione e **una sola**,
gia esistente nel repo e scritta in P2: **asserire l'espressione ESATTA di ogni policy, per
ogni comando**, invece della presenza di una sottostringa. Applicata alle sei tabelle chiude
in un colpo T-02, S2-01 e S45-01.
