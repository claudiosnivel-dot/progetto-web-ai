// T-240 (macrotask generation-e2e, P2) — IL CANARY DELIBERATAMENTE INSICURO, confinato al codice
// di test. Esiste per una sola ragione (L-COL-006, correzione di metodo n.7 di P1): senza un
// componente che INIETTA PER DAVVERO, "zero errori di console" e' indistinguibile da "la pagina non
// si e' caricata", e il verde di T-241 non significherebbe nulla. Il canary rende testo OSTILE
// attraverso il sink `innerHTML` — cioe' fa esattamente cio' che il renderer del sito (SiteView,
// T-231) NON fa mai — cosi' il gestore d'evento iniettato ESEGUE nel browser e incrementa la
// sentinella globale. Le stesse asserzioni di assertNoInjectionEffect lo devono PRENDERE.
//
// CONFINAMENTO (AC-240-3, security_notes): questo file porta il MARKER LETTERALE UNICO
// `BELORA_CANARY_INSECURE`, con cui tests/e2e-canary-confinement.test.ts verifica che il canary
// (a) viva solo sotto e2e/, (b) non sia importato da alcun sorgente di produzione, (c) non compaia
// nel bundle .next. E' montato SOLO dallo spec via page.setContent(...) — MAI un file src/app,
// quindi nessuna rotta dell'applicazione lo raggiunge. Un canary che finisse in produzione sarebbe
// una vulnerabilita' introdotta per provarne l'assenza.

// Il marker letterale unico su cui poggia il test di confinamento (grep di .next e del sorgente).
// NON esportato: il confinamento cerca la STRINGA nei file, non importa il simbolo (che nessun altro
// modulo consuma) — l'export sarebbe dead-code (knip). Resta usato internamente qui sotto.
const BELORA_CANARY_INSECURE = 'BELORA_CANARY_INSECURE';

/** Il marchio che il payload iniettato scrive in console quando esegue: attribuibile all'iniezione. */
export const CANARY_INJECTED_MARKER = 'BELORA_CANARY_PWNED';

// Il payload OSTILE di default: un <img> con onerror. Assegnato via innerHTML, l'immagine viene
// inserita, la sua sorgente 'x' fallisce, e onerror ESEGUE — incrementa la sentinella e scrive in
// console il marchio d'iniezione. E' la classe di XSS che innerHTML consente davvero (un <script>
// via innerHTML NON gira, un gestore d'evento su un elemento inserito si').
const DEFAULT_HOSTILE_PAYLOAD =
  '<img src="x" onerror="window.__belora_pwned=(window.__belora_pwned||0)+1;' +
  `console.error('${CANARY_INJECTED_MARKER}')">`;

/**
 * Costruisce il documento HTML del canary. Un bootstrap inline (codice "fidato" del componente)
 * prende `hostileText` — testo NON fidato — e lo assegna a `innerHTML`: il SINK insicuro. Il default
 * inietta il payload onerror qui sopra; lo scenario reale (T-241) potra' passare i propri payload.
 *
 * Da montare con page.setContent(insecureCanaryHtml()). Con page.addInitScript gia' agganciato
 * (attachObservables), `window.__belora_pwned` parte da 0 e il payload lo porta a 1.
 */
export function insecureCanaryHtml(hostileText: string = DEFAULT_HOSTILE_PAYLOAD): string {
  const injected = JSON.stringify(hostileText); // letterale JS sicuro dal lato dello string-building
  return `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <title>${BELORA_CANARY_INSECURE}</title>
  </head>
  <body>
    <div id="belora-canary-root"></div>
    <script>
      // ${BELORA_CANARY_INSECURE}: sink insicuro deliberato — testo non fidato -> innerHTML.
      document.getElementById('belora-canary-root').innerHTML = ${injected};
    </script>
  </body>
</html>`;
}

/**
 * Il SECONDO canary, per la sola dimensione "navigazione" di assertNoInjectionEffect. AC-240-2 prova
 * che l'helper diventa rosso su CONTATORE e CONSOLE; questo prova che sa diventare rosso anche su una
 * NAVIGAZIONE del frame principale — cosi' l'assenza di navigazione asserita in AC-241-3 non e' una
 * tautologia dell'oracolo (il rilevatore SA scattare). Sposta il documento SENZA toccare la
 * sentinella ne' scrivere in console: il rosso e' attribuibile alla sola navigazione. Montato via
 * page.setContent, mai una rotta app.
 *
 * `target` va passato dal chiamante e DEVE essere una URL http(s) ASSOLUTA: il browser BLOCCA la
 * navigazione top-level verso data:/blob: (misura anti-XSS), quindi il canary punta a un host reale.
 * Passando l'host DELL'APP (nell'allowlist) scatta la sola dimensione navigazione, non l'off-host.
 */
export function navigatingCanaryHtml(target: string): string {
  const dest = JSON.stringify(target); // letterale JS sicuro dal lato dello string-building
  return `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <title>${BELORA_CANARY_INSECURE} nav</title>
  </head>
  <body>
    <div id="belora-canary-root"></div>
    <script>
      // ${BELORA_CANARY_INSECURE}: canary di NAVIGAZIONE — sposta il documento, niente contatore/console.
      window.location.replace(${dest});
    </script>
  </body>
</html>`;
}
