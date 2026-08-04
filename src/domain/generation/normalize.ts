// T-221 (macrotask generation-llm, P2) — LA NORMALIZZAZIONE CONSERVATIVA del testo che
// entra nel prompt. Dominio PURO: nessun accesso al DB, nessun side effect, nessuna
// chiamata al confine.
//
// SI APPLICA ALLA SOLA COPIA DESTINATA AL MODELLO, mai a cio' che e' salvato. Il brief nel
// DB resta com'e' l'ha scritto l'utente, perche' e' suo: qui si normalizza una COPIA della
// proiezione (T-220), e quella copia muore col prompt.
//
// NON E' UNA DIFESA, ed e' la riga piu' importante di questo file (L-COL-006). Togliere i
// tag e gli URL toglie le FORME in cui un'istruzione si nasconde meglio, ma la difesa
// contro la prompt injection resta strutturale e sta altrove: l'allowlist in ingresso
// (T-220, P2-D4) e l'assenza di leve in uscita (T-222 — solo testo in slot nominati).
// Contare questa funzione come difesa sarebbe un falso via libera, perche' un'istruzione
// iniettata scritta IN CHIARO passa di qui INTATTA e deve poterlo fare: il rilevamento
// delle istruzioni iniettate non e' tentato, non essendo oracolabile (out_of_scope di
// T-221). Il file di test lo asserisce esplicitamente, nel verso onesto.
//
// NON E' LA SANIFICAZIONE DEL RENDERING. Quella e' T-231, opera su un percorso DIVERSO — il
// documento, non il prompt — e per un'altra ragione: li' il testo finisce in una pagina
// HTML, qui dentro una stringa JSON che un modello legge. Le due non si sostituiscono a
// vicenda in nessuno dei due versi. In particolare LE OFFERTE, che sono il 95% del peso del
// brief, dal modello non passano affatto (P2-D4): il sito le rende direttamente dal brief
// (T-214), quindi la loro sanificazione e' interamente di T-231. Di qui passa il solo
// CAMPIONE DI NOMI che la proiezione porta al modello.
//
// CONSERVATIVA PER SCELTA, e non e' un dettaglio di gusto: il danno di una normalizzazione
// aggressiva sarebbe SILENZIOSO (nessun errore, nessun test rosso) e PERMANENTE (finisce
// nel copy del sito). Un'attivita' che si chiama 'C&C Ristorazione', una description che
// dice 'Ti amo <3', "L'Osteria dell'Oca", 'Caffe' & Cornetti 🥐' devono uscire da qui con
// tutti i loro caratteri significativi. Nessuno se ne accorgerebbe leggendo il codice: se ne
// accorgerebbe il cliente, guardando il proprio nome storpiato nel titolo del suo sito.
//
// LE DUE PROPRIETA' SONO TENUTE DALLA FORMA, non solo dai test.
//  - NON ALLUNGA MAI. Ogni sostituzione ha un match lungo almeno tre caratteri (il tag piu'
//    corto e' '<a>'; sei per un data URI, otto per un URL, dieci per uno schema eseguibile)
//    e produce UN carattere; il collasso porta una sequenza di N>=1 spazi bianchi a uno; il
//    trim toglie soltanto. Quindi |output| <= |input| per costruzione, non per fortuna.
//  - E' IDEMPOTENTE, ed e' il motivo per cui la rimozione DEI TAG lascia UNO SPAZIO invece
//    del vuoto. Misurato: rimuovendo a vuoto, '<<b>b>' diventa '<b>' — cioe' un tag NUOVO,
//    che una seconda passata toglierebbe, e normalizeForPrompt(normalizeForPrompt(x))
//    sarebbe diverso da normalizeForPrompt(x). Lo spazio impedisce che i due lati di un tag
//    tolto tornino adiacenti. E' anche cio' che evita di incollare due parole separate da un
//    tag ('Bar<br>Sole' -> 'Bar Sole' e non 'BarSole'), ed e' lo spazio LASCIATO DAL TAG a
//    tenere separati i due pezzi di 'https:<b>//evil.example/x'.
//    LO SPAZIO E' PORTANTE SOLO LI'. Per gli URL, per gli schemi e per i data URI la
//    sostituzione con '' darebbe lo STESSO risultato — misurato: '\S+' e '\S*' finiscono
//    sempre su uno spazio bianco o a fine stringa, quindi il collasso finale e il .trim()
//    rendono i due esiti indistinguibili (fuzz di 400.000 stringhe, nessun testimone). Lo
//    spazio resta anche li' per uniformita' del passo, non perche' regga una proprieta'.
//
// LIMITI DICHIARATI, perche' un buco dichiarato e non nominato e' indistinguibile da un
// buco dimenticato.
//  - LE ENTITA' HTML NON SI DECODIFICANO: '&amp;' esce com'e' entrato. Decodificarle
//    obbligherebbe a farlo FINO AL PUNTO FISSO per restare idempotenti ('&amp;amp;' ->
//    '&amp;' -> '&'), che e' esattamente il comportamento aggressivo capace di storpiare il
//    nome di un'attivita' importato da un sito terzo. Qui l'entita' e' testo inerte: il
//    prompt non e' un documento, e chi rende il documento e' T-231.
//  - GLI SCHEMI INCOLLATI a una parola sfuggono dove il match e' ancorato a un confine di
//    parola ('metadata:x,y' resta). E' il verso giusto in cui sbagliare: questa funzione non
//    e' una difesa, mentre un falso positivo rovinerebbe testo vero.
//  - RESTA FUORI tutto cio' che la definition_of_done non nomina: 'mailto:', gli URL senza
//    schema ('www.esempio.it'), i caratteri di controllo invisibili e i bidi override. In
//    particolare gli ZWJ NON si toccano, perche' un'emoji composta ('👩‍🍳') e' fatta con
//    quelli e spezzarla sarebbe proprio il danno silenzioso che il modulo evita.

/**
 * UN TAG: '<' seguito da un apritore di markup — una lettera, '/', '!' o '?' — fino al
 * PRIMO '>'. Gli ATTRIBUTI sono dentro il match per costruzione ('[^>]*' li attraversa),
 * quindi un onclick non sopravvive al tag che lo porta, ne' come nome ne' come valore.
 *
 * L'APRITORE E' LA PARTE CONSERVATIVA: un '<' seguito da qualunque altro carattere non e'
 * un tag e resta dov'e'. E' cio' che salva '<3', '< 30 minuti' e '1<2', che sono testi veri
 * e non casi di scuola. '!' e '?' sono nell'elenco perche' il commento HTML
 * ('<!-- ... -->') e' l'apritore in cui un'istruzione si nasconde meglio di tutti, e perche'
 * '<!DOCTYPE' e '<?xml' sono markup quanto un tag: nessuno dei tre puo' collidere con un uso
 * legittimo di '<' nel copy di un'attivita'.
 *
 * IL '>' E' OBBLIGATORIO: un '<div' senza chiusura resta testo. Rimuovere fino a fine
 * stringa cancellerebbe tutto cio' che segue un '<' isolato, che e' il danno peggiore che
 * questo modulo possa fare.
 */
const TAG_HTML = /<[A-Za-z\/!?][^>]*>/gu;

/**
 * Un URL http/https e tutto cio' che lo segue fino al primo spazio bianco.
 *
 * NON ancorato a un confine di parola, di proposito: '://' non compare in nessuna parola
 * italiana o spagnola, quindi allargare qui non costa falsi positivi e prende anche le forme
 * incollate ('httphttps://evil.example/x'), che l'ancoraggio lascerebbe passare.
 */
const URL_HTTP = /https?:\/\/\S+/giu;

/**
 * Gli schemi ESEGUIBILI, col loro payload. Il ':' dev'essere seguito SUBITO da un carattere
 * non-spazio: 'javascript:alert(1)' e' uno schema, 'JavaScript: il corso base' e' il titolo
 * di un corso — ed e' copy legittimo di un'agenzia web, non un caso inventato. Lo spazio
 * dopo i due punti e' cio' che distingue i due, e costa zero riconoscerlo.
 */
const SCHEMI_ESEGUIBILI = /(?:javascript|vbscript):\S+/giu;

/**
 * Il data URI, riconosciuto DALLA SUA FORMA e non dal solo nome dello schema: 'data:', poi
 * il media type, poi la VIRGOLA che RFC 2397 rende obbligatoria, poi il payload.
 *
 * PERCHE' NON BASTA 'data:'. 'Data:' e' una parola italiana comunissima ('Data: 12 marzo
 * 2026'): un match sul solo nome dello schema cancellerebbe la data da una description
 * importata, in silenzio e per sempre. Il confine di parola tiene fuori 'metadata:', la
 * virgola obbligatoria tiene fuori 'Data:12/03/2026'.
 * COSTO DICHIARATO: un 'Data:12, marzo' — virgola subito dopo, senza spazio — verrebbe
 * comunque preso. E' il caso raro barattato col caso comune.
 */
const DATA_URI = /\bdata:[^\s,]*,\S*/giu;

/**
 * Una sequenza QUALUNQUE di spazi bianchi -> uno spazio solo.
 *
 * Copre anche a capo e tabulazioni: la proiezione raggiunge il modello dentro una stringa
 * JSON, dove un a capo e' comunque un '\n' scritto per esteso e non una struttura che il
 * modello possa leggere come tale — e la sequenza di righe vuote che spinge un'istruzione
 * fuori dalla vista e' una delle forme che questo modulo esiste per togliere. Gli spazi
 * tipografici e il NBSP finiscono qui dentro e diventano uno spazio normale; gli ZWJ NO,
 * perche' '\s' non li comprende, ed e' cio' che tiene insieme le emoji composte.
 */
const SPAZI_MULTIPLI = /\s+/gu;

/**
 * Ripulisce un testo del brief PRIMA che entri nel prompt: via i tag HTML con i loro
 * attributi, via gli URL http/https, via gli schemi eseguibili e i data URI, spazi
 * collassati e bordi tagliati.
 *
 * Funzione PURA: le stringhe sono immutabili, quindi ritorna sempre un valore nuovo e non
 * tocca nulla di cio' che ha intorno — chi la applica a una proiezione ne costruisce una
 * COPIA, e il brief da cui la proiezione deriva non se ne accorge.
 *
 * L'ORDINE CONTA. I tag per primi, cosi' un href se ne va insieme al tag che lo porta; poi
 * gli URL, prima degli schemi, perche' un 'data:' dentro il path di un URL deve morire con
 * l'URL invece di spezzarlo a meta'; il collasso per ultimo, perche' e' l'unico passo che
 * deve vedere gli spazi lasciati da tutti gli altri.
 *
 * NON E' UNA DIFESA e non e' una sanificazione per il rendering: vedi la testa del modulo.
 */
export function normalizeForPrompt(text: string): string {
  return text
    .replace(TAG_HTML, ' ')
    .replace(URL_HTTP, ' ')
    .replace(SCHEMI_ESEGUIBILI, ' ')
    .replace(DATA_URI, ' ')
    .replace(SPAZI_MULTIPLI, ' ')
    .trim();
}
