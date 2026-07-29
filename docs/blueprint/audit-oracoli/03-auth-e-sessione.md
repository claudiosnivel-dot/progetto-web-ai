# Audit degli oracoli — Superficie 3: AUTH E SESSIONE

> Piano `AUDIT-ORACOLI-P0-P1.md` §3. Data: 2026-07-29.
> Baseline: **6 file, 25 test, 0 falliti, 0 skippati**.
> **12 mutazioni applicate, 12 esiti registrati, 12 ripristini verificati per sha256.**
>
> E la superficie piu esposta delle sei, e va detto perche: **qui non c'e la RLS a fare da
> seconda linea**. Sulle superfici 1, 2, 4 e 5 una guardia applicativa che cade trova ancora
> il database a dire di no. Qui no: se la guardia cade, cade e basta.

## 1. Le mutazioni applicate

### 1a. Prese (3)

| ID | Mutazione | Esito |
|---|---|---|
| AU0 | **fatale**: `if (!user)` → `if (false)` — la guardia non nega piu nulla | **ROSSO** (4 test) — il banco sa diventare rosso |
| AU2 | `PROTECTED_SEGMENTS` da `['dashboard','onboarding']` a `['dashboard']` | **ROSSO** (3 test) |
| AU8 | `import 'server-only'` rimosso da `supabase-admin.ts` | **ROSSO** (1 test) |

### 1b. NON prese — buchi d'oracolo (5)

| ID | Mutazione | Esito |
|---|---|---|
| **AU4** | **OPEN REDIRECT**: `loginUrl.pathname = request.nextUrl.searchParams.get('next') ?? ...` | **VERDE 25/25** |
| **AU9** | il client **SSR usa la `service_role`** invece della anon key | **VERDE 25/25** |
| **AU6** | `getUser()` → `getSession()` (il JWT non e piu rivalidato) | **VERDE 25/25** |
| **AU1** | il `matcher` esclude `dashboard`: il middleware non gira piu su quelle rotte | **VERDE 25/25** |
| AU3 | `loginUrl.search = ''` rimosso: la query dell'attaccante sopravvive nel redirect | **VERDE 25/25** |

### 1c. Prove di equivalenza (2) — entrambe VERDI, gli oracoli non sono rigidi
`AU5` ordine dei segmenti protetti invertito · `AU10` guardia sulle env riscritta.

### 1d. Rifatte invece che registrate
`AU1`, `AU6`, `AU7`, `AU8` sono risultate **non applicate** al primo tentativo (stringa non
trovata): i file su disco sono **CRLF** e le stringhe multi-riga erano scritte con `\n`.
Sono state **rifatte** dopo aver insegnato al banco a rilevare il terminatore reale. Una
mutazione non applicata registrata come "VERDE" sarebbe stata un buco inesistente.

## 2. Rilievi

Nessun **difetto attivo**: il codice di oggi e corretto in tutti e cinque i punti.

### A3-01 — HIGH · l'anti-open-redirect e dichiarato nel commento e verificato da nessuno
Prendere la destinazione del redirect da `?next=` lascia **25 test su 25 verdi**. Il commento
(righe 49-50) dichiara: *"Destinazione FISSA e interna (`/{locale}/login`), mai da input utente
(anti open-redirect)"*. I test asseriscono **che si viene rediretti al login**, non **che la
destinazione non sia influenzabile**. Un attaccante potrebbe far atterrare l'utente non
autenticato su un host esterno partendo da un link a una rotta protetta.

### A3-02 — HIGH · nulla impedisce alla `service_role` di entrare nel client SSR
Sostituire la anon key con `SUPABASE_SERVICE_ROLE_KEY` in `ssrEnv()` lascia 25 test su 25
verdi. Conseguenza: **RLS bypassata in ogni Server Component, Server Action e nel middleware**
— cioe l'esatto opposto di cio che il modulo dichiara (righe 5-9: *"MAI la service_role →
nessun bypass di RLS nel contesto SSR / middleware (R7 / A01:2025)"*).
E il rovescio esatto di AU8: il confine e verificato **in un verso solo**. Si asserisce che
`supabase-admin.ts` abbia `server-only`, non che `supabase-ssr.ts` **non** usi la service_role.

### A3-03 — HIGH · `getUser()` non e pinnato: passare a `getSession()` non fa protestare nessuno
`getSession()` **non rivalida il JWT** contro l'auth server: si fida del cookie. E la
distinzione che Supabase documenta come critica lato server, e il commento del modulo
(righe 48-50) la dichiara esplicitamente come la ragione della scelta. Nessun test la pinna:
i doppi restituiscono un utente comunque, quindi entrambe le forme passano.

### A3-04 — HIGH · il `matcher` del middleware non ha oracolo
Escludere `dashboard` dal matcher lascia tutto verde: **la guardia continua a esistere e a
funzionare, ma non viene mai invocata**. I test chiamano `middleware(request)` direttamente,
quindi provano la funzione e non la sua *installazione*. E il modo di fallire piu insidioso
della superficie: ogni test sulla guardia resta verde mentre la protezione e disattivata.

### A3-05 — MEDIUM · la sanificazione della query nel redirect non e asserita
Rimuovere `loginUrl.search = ''` lascia tutto verde: i parametri dell'URL richiesto
sopravvivono nel redirect verso il login.

## 3. Lo schema che questa superficie rende evidente

Tutti e cinque i buchi hanno la stessa forma: **il test asserisce l'esito nel caso nominale
("senza sessione si viene rediretti al login") e non la PROPRIETA di sicurezza che rende
quell'esito sicuro** (dove si viene rediretti, con quali credenziali, con quale validazione,
e se la guardia viene invocata).

E la stessa forma dei rilievi T-01/T-02/T-03 e S2-01/S2-03: **si prova che il meccanismo
funziona nel caso previsto, non che la difesa non sia rimovibile**. Con una differenza che
qui pesa il doppio: senza RLS dietro, non c'e nulla che pari il colpo.

## 4. Cosa e confermato solido

- La guardia di route funziona ed e oracolata nel merito: rimuoverla (AU0) o togliere
  `onboarding` dalle rotte protette (AU2) produce rossi immediati e circostanziati,
  **con il locale preservato** (`/es/onboarding` → `/es/login`).
- Il confine `server-only` su `supabase-admin.ts` e asserito (AU8 rosso) — anche se
  l'asserzione e sul TESTO del sorgente ("ha `import 'server-only'` come prima istruzione"),
  quindi e rigida al refactoring: e lo stesso pattern del rilievo S2-05.
- Gli oracoli non sono rigidi sulle riscritture equivalenti (AU5, AU10 verdi).
