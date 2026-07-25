'use server';

import { getUser } from '@/data/supabase-ssr';
import { fromUrl } from '@/domain/import/fromUrl';
import type { Brief } from '@/domain/onboarding/brief';

// T-151 (macrotask onboarding-ui, P1) — Server Action SOTTILE fra la UrlImportBar
// (componente client) e l'import da URL di T-141.
//
// PERCHE' esiste, invece di chiamare fromUrl dalla barra: `fromUrl` tira dentro il
// confine `server-only` (@/data/anthropic, T-131) e `fetchSafe` (undici), quindi un
// import diretto da un modulo 'use client' romperebbe il build — e prima ancora
// porterebbe il segreto Anthropic nel grafo del bundle browser. La ESLint di T-131
// (deny-by-default su tutto src/**) e' l'altra faccia della stessa regola.
//
// PERCHE' una Server Action e non un route handler: una Server Action eredita il
// controllo d'origine che Next applica alle azioni, cioe' esattamente la difesa CSRF
// che il route handler di T-150 ha dovuto costruire a mano con due gate (Sec-Fetch-Site
// + Origin). Qui non si riscrive quella logica: si sceglie il trasporto che la ha.
//
// Sicurezza:
//  - A01:2025. La sessione e' PRETESA: senza identita' questo endpoint sarebbe un
//    proxy di sonde SSRF a disposizione di chiunque — un anonimo potrebbe far
//    scaricare al nostro server URL scelti da lui e leggere dall'esito se la richiesta
//    e' andata a buon fine. Il rifiuto e' TIPIZZATO (nessun throw): un'eccezione da una
//    Server Action arriva al client come errore opaco e la barra non potrebbe
//    distinguerla da un guasto, mentre qui il chiamante ha un valore da rendere.
//  - A05:2025. `rawUrl` arriva dal browser: si pretende una STRINGA prima di passarla a
//    fromUrl. Un oggetto/array/null/numero sarebbe input di forma inattesa per
//    fetchSafe (che si aspetta di poter fare `new URL(rawUrl)`), e la validazione di
//    forma e' la prima cosa che non si delega.
//  - P1-D16. `fromUrl` ritorna `address-blocked` sia per "host non risolvibile" sia per
//    "IP interno", di proposito: distinguerli renderebbe il server un oracolo di
//    enumerazione del DNS interno. Qui TUTTI i motivi collassano in un solo
//    'import-failed': la UI ha un unico messaggio e non puo' nemmeno per sbaglio
//    lasciar capire quale ramo sia scattato. Si perde la diagnostica per l'utente
//    ("schema non ammesso" sarebbe innocuo): costo accettato, perche' un solo codice di
//    ritorno rende la proprieta' vera per COSTRUZIONE invece che per disciplina del
//    chiamante.
//  - NESSUN LIMITE DI FREQUENZA NE' DI COSTO, dichiarato perche' questa e' la PRIMA
//    porta raggiungibile dal browser verso `fromUrl` (T-141), e quindi verso `fetchSafe`
//    (T-140): prima di T-151 nessun ingresso dell'applicazione la raggiungeva. La sessione
//    e' pretesa, ma un utente AUTENTICATO puo' invocarla quante volte vuole, e ogni
//    invocazione fa scaricare al nostro server una pagina scelta da lui — banda, tempo di
//    connessione e (col tetto sui byte di T-140) memoria. E' la stessa lacuna gia'
//    dichiarata per T-150: P1-D22 mette un tetto al SINGOLO turno e non alla raffica.
//    Non si implementa qui: un rate limiting e' una decisione di piattaforma (dove si
//    conta, per utente o per account, con quale store) e sarebbe comportamento inventato
//    in un task di UI. Resta un rischio residuo dichiarato.
//  - Nessuna persistenza: si restituisce la PROPOSTA. La scrittura avviene solo se
//    l'utente conferma dal pannello, via upsertBrief (T-123).
//  - Nulla trapela oltre a cio' che fromUrl gia' ritorna: nessun dettaglio della
//    risposta remota, nessun indirizzo risolto, nessun messaggio di errore interno.

export type ImportBriefResult =
  | { ok: true; brief: Brief }
  | { ok: false; reason: 'unauthorized' | 'invalid-url' | 'import-failed' };

/**
 * Propone un brief a partire da un URL, senza persistere nulla.
 * @param rawUrl input NON FIDATO dal browser: deve essere una stringa.
 */
export async function importBriefFromUrl(rawUrl: unknown): Promise<ImportBriefResult> {
  const user = await getUser();
  if (!user) return { ok: false, reason: 'unauthorized' };

  if (typeof rawUrl !== 'string') return { ok: false, reason: 'invalid-url' };

  // Il fallbackLocale di fromUrl resta il suo default: il locale del brief NON si
  // pre-riempie dalla proposta (un sito = una lingua, T-121, ed e' una proprieta' del
  // sito, non un dato che una pagina esterna possa cambiare), quindi il valore che
  // fromUrl mette in `brief.locale` non viene usato dal pannello.
  const proposal = await fromUrl(rawUrl);
  if (proposal.status === 'failed') return { ok: false, reason: 'import-failed' };

  return { ok: true, brief: proposal.brief };
}
