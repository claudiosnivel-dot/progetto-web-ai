# 02-design-system — Macrotask `design-system` · Design system interno

> Modulo del blueprint P0 (fondamenta) di Belora. Un modulo = un macrotask:
> l'unita al cui confine gira il checkpoint e l'unita di commit atomico.
> Task atomici secondo lo schema trueline (id/AC/target_tests/security_notes).

## Obiettivo del macrotask

UI kit interno a componenti vincolati (i guardrail "always-beautiful"): design token, tema chiaro/scuro, primitive accessibili (shadcn/ui) e AppShell per l area autenticata.

## Task atomici

```yaml
- id: T-020
  title: "Tailwind + design tokens + tema"
  macrotask: "design-system"
  depends_on: [T-001]
  objective: "Configurare Tailwind CSS nel progetto Next.js (App Router, TypeScript) e definire i token di design (colori, spaziature, tipografia, raggi) in un unico modulo TypeScript sorgente-di-verita (src/ui/theme/tokens.ts) da cui tailwind.config.ts deriva la propria theme, cosi che nessun componente usi valori hardcoded. Definire i due set di tema (chiaro/scuro) come CSS custom properties in src/app/globals.css, con override sotto [data-theme='dark']. Implementare un ThemeProvider client (src/ui/theme/ThemeProvider.tsx) che imposta l'attributo data-theme sull'elemento root (document.documentElement) con default 'light' e API di toggle/set, cosi che i token cambino valore per tema senza duplicazione."
  definition_of_done:
    - "File tailwind.config.ts alla radice che importa i token da src/ui/theme/tokens.ts e li mappa dentro theme.extend (colors, spacing, fontFamily, fontSize, borderRadius) senza riscrivere valori literal a mano."
    - "Modulo src/ui/theme/tokens.ts che esporta oggetti tipati per colors, spacing e typography come unica sorgente di verita."
    - "File src/app/globals.css che dichiara le CSS custom properties dei token sotto :root e le ridefinisce sotto [data-theme='dark'], e include le direttive Tailwind (base/components/utilities)."
    - "Componente client src/ui/theme/ThemeProvider.tsx che imposta data-theme su document.documentElement, espone setTheme/toggle, default 'light'."
    - "File di test tests/tokens.test.ts e tests/theme.test.ts presenti ed eseguibili con vitest."
  acceptance_criteria:
    - id: AC-020-1
      given: "tailwind.config.ts che importa src/ui/theme/tokens.ts e i token esportati"
      when: "un test importa sia la config Tailwind sia il modulo tokens e confronta theme.extend.colors con tokens.colors"
      then: "i valori di theme.extend.colors sono deep-equal a tokens.colors (i colori derivano dai token, nessuna palette esadecimale duplicata definita a mano nella config)"
    - id: AC-020-2
      given: "ThemeProvider renderizzato senza prop di tema esplicita"
      when: "il provider si monta"
      then: "document.documentElement.getAttribute('data-theme') e uguale a 'light'"
    - id: AC-020-3
      given: "ThemeProvider montato che espone setTheme/toggle"
      when: "si invoca setTheme('dark') (o toggle dallo stato 'light')"
      then: "document.documentElement.getAttribute('data-theme') e uguale a 'dark'"
    - id: AC-020-4
      given: "il contenuto testuale di src/app/globals.css"
      when: "un test parsa il file e cerca la regola :root e la regola [data-theme='dark']"
      then: "entrambe le regole esistono e la custom property --color-background ha nel blocco [data-theme='dark'] un valore diverso da quello dichiarato in :root"
    - id: AC-020-5
      given: "il modulo src/ui/theme/tokens.ts importato"
      when: "un test ispeziona le scale esportate"
      then: "tokens.spacing ha almeno 4 step e tokens.typography.fontSize ha almeno 4 step (scale non vuote)"
  target_tests:
    - file: "tests/tokens.test.ts"
      covers: [AC-020-1, AC-020-5]
    - file: "tests/theme.test.ts"
      covers: [AC-020-2, AC-020-3, AC-020-4]
  security_notes:
    - "Segreti (A07:2025 / A02:2025): tailwind.config.ts e src/ui/theme/tokens.ts vengono bundlati nel client, quindi non devono contenere alcuna chiave o credenziale; solo eventuali NEXT_PUBLIC_* pubbliche. Il modulo token non legge variabili d'ambiente server-side (mai la service_role qui, R7)."
  out_of_scope:
    - "Persistenza del tema (localStorage/cookie) e sincronizzazione con prefers-color-scheme di sistema"
    - "Toggle di tema nell'interfaccia (delegato all'AppShell in T-022 o a task successivi)"

- id: T-021
  title: "Primitive UI accessibili"
  macrotask: "design-system"
  depends_on: [T-020]
  objective: "Creare l'insieme base di primitive UI vincolate (Button, Input, Label, Card) tramite shadcn/ui, stilizzate esclusivamente con le utilities/token del design system di T-020 (nessun valore arbitrario), con nomi e attributi accessibili: associazione Label-Input via htmlFor/id, stato disabled corretto, varianti gestite con cva, focus gestito dal browser. Fornire smoke test di rendering con @testing-library/react e @testing-library/user-event che verificano accessible name, associazione label/input, digitazione e presenza delle varianti."
  definition_of_done:
    - "Componenti in src/ui/primitives/: button.tsx (varianti via cva), input.tsx, label.tsx, card.tsx (con sotto-parti Card/CardHeader/CardContent)."
    - "Ogni componente e tipizzato in TypeScript, usa la class utility (cn) del design system e classi basate sui token (nessun colore esadecimale hardcoded nel markup dei componenti)."
    - "Barrel src/ui/primitives/index.ts che ri-esporta tutte le primitive."
    - "File di test tests/primitives.test.ts con render smoke per ciascuna primitiva, eseguibile con vitest."
  acceptance_criteria:
    - id: AC-021-1
      given: "Button renderizzato con children 'Salva'"
      when: "si esegue screen.getByRole('button', { name: 'Salva' })"
      then: "l'elemento button e presente nel DOM con accessible name 'Salva'"
    - id: AC-021-2
      given: "Button renderizzato con prop disabled"
      when: "si legge l'elemento button dal DOM"
      then: "la proprieta disabled dell'elemento e true (attributo disabled presente)"
    - id: AC-021-3
      given: "Button renderizzato con variant='secondary' confrontato con Button di default"
      when: "si confrontano le className applicate"
      then: "la className della variante 'secondary' differisce da quella della variante di default (varianti distinte osservabili)"
    - id: AC-021-4
      given: "Label con htmlFor='email' e Input con id='email' renderizzati insieme"
      when: "si esegue screen.getByLabelText per il testo della label"
      then: "viene restituito l'elemento input con id='email' (associazione label/input corretta)"
    - id: AC-021-5
      given: "Input di tipo text renderizzato"
      when: "l'utente digita 'ciao' tramite userEvent.type"
      then: "input.value e uguale a 'ciao'"
    - id: AC-021-6
      given: "Card con CardHeader('Titolo') e CardContent('Corpo') renderizzata"
      when: "si cercano i testi nel DOM"
      then: "sia 'Titolo' sia 'Corpo' sono presenti nel documento"
  target_tests:
    - file: "tests/primitives.test.ts"
      covers: [AC-021-1, AC-021-2, AC-021-3, AC-021-4, AC-021-5, AC-021-6]
  security_notes:
    - "Injection/XSS (A05:2025): le primitive non introducono sink pericolosi, nessun uso di dangerouslySetInnerHTML; i contenuti sono passati come children/testo ed escapati da React. Input non registra ne logga il valore digitato e non forza autocomplete insicuro (delega al chiamante)."
    - "Segreti (A07:2025): nessuna chiave o credenziale hardcoded nei componenti (codice client-side)."
  out_of_scope:
    - "Componenti composti oltre le quattro primitive (Select, Dialog, Toast, Form) rimandati a task/macrotask successivi"
    - "Audit di accessibilita automatizzato completo (es. axe) oltre agli smoke test elencati"

- id: T-022
  title: "AppShell / layout autenticato"
  macrotask: "design-system"
  depends_on: [T-021, T-006]
  objective: "Costruire un componente di layout riusabile AppShell per l'area autenticata, composto da header (con il brand letto da src/config/brand.ts tramite getBrandName()), nav con voci e stato attivo, e area contenuto (main) con id per lo skip-link. Il componente e costruito interamente sulle primitive di T-021 e sui token di T-020, usa i landmark semantici corretti (header/nav/main) ed espone uno skip-link 'Vai al contenuto' per l'accessibilita. L'AppShell e puramente presentazionale: riceve nome brand/utente e voci nav via props/config, non esegue autenticazione ne autorizzazione (a monte)."
  definition_of_done:
    - "Componente src/ui/shell/AppShell.tsx che renderizza <header>, <nav> e <main id='main-content'> con i children nel main."
    - "L'header mostra il brand restituito da src/config/brand.ts (getBrandName())."
    - "La nav accetta una lista di voci { href, label } e marca la voce corrispondente al pathname corrente con aria-current='page'."
    - "Skip-link con href='#main-content' come primo elemento focusabile del layout."
    - "File di test tests/appshell.test.ts eseguibile con vitest (con mock di usePathname di next/navigation)."
  acceptance_criteria:
    - id: AC-022-1
      given: "AppShell renderizzato con children"
      when: "si interrogano i landmark ARIA del DOM"
      then: "esiste esattamente un elemento con role='banner' (header), uno con role='navigation' (nav) e uno con role='main' (main)"
    - id: AC-022-2
      given: "brand configurato (NEXT_PUBLIC_BRAND_NAME oppure default 'Belora')"
      when: "AppShell viene renderizzato"
      then: "l'header contiene il testo restituito da getBrandName()"
    - id: AC-022-3
      given: "nav con voci [{ href: '/dashboard', label: 'Dashboard' }, { href: '/sites', label: 'Siti' }] e pathname corrente mockato a '/sites'"
      when: "AppShell viene renderizzato"
      then: "la voce con label 'Siti' ha attributo aria-current='page' mentre la voce 'Dashboard' non lo ha"
    - id: AC-022-4
      given: "AppShell renderizzato"
      when: "si cerca il link di skip"
      then: "esiste un link con href='#main-content' e l'elemento main ha id='main-content'"
    - id: AC-022-5
      given: "AppShell renderizzato con children di testo 'Contenuto pagina'"
      when: "si ispeziona l'elemento con role='main'"
      then: "il testo 'Contenuto pagina' e contenuto all'interno del main"
  target_tests:
    - file: "tests/appshell.test.ts"
      covers: [AC-022-1, AC-022-2, AC-022-3, AC-022-4, AC-022-5]
  security_notes:
    - "Access control (A01:2025): l'AppShell e presentazionale e NON esegue authz; il controllo d'accesso all'area autenticata e responsabilita del layer auth/middleware upstream (fuori scope del macrotask design-system)."
    - "Service_role e RLS (R7): qualunque dato di account/utente mostrato nell'header deve provenire da query server protette da RLS ed essere passato via props; l'AppShell non effettua query dirette ne usa la service_role."
    - "Injection/XSS (A05:2025): voci nav e dati utente sono trattati come testo escapato da React; nessun href javascript: non validato e nessun dangerouslySetInnerHTML."
    - "Segreti (A07:2025 / A02:2025): nessun segreto incorporato nel componente; il brand arriva da src/config/brand.ts che legge la NEXT_PUBLIC_BRAND_NAME pubblica."
  out_of_scope:
    - "Route guard, redirect di login e recupero della sessione (macrotask auth, non design-system)"
    - "Fetch dei dati di account/utente e delle voci nav dinamiche (delegato alle pagine/loader)"
    - "Toggle di tema e menu utente interattivi oltre alla struttura di layout"
```

## Self-check

- **Strutturale** (deterministico): `validate_blueprint.mjs` sulla dir del blueprint — atteso exit 0.
- **Semantico** (checklist guidata): punti 6–10 su ogni task; i rilievi vanno all'human-in-the-loop.
