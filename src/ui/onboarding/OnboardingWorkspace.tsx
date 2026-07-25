'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BriefPanel, type BriefPanelPatch } from '@/ui/onboarding/BriefPanel';
import { ChatPanel, type ChatTurn } from '@/ui/onboarding/ChatPanel';
import { UrlImportBar } from '@/ui/onboarding/UrlImportBar';
import { BriefSchema, emptyBrief, type Brief } from '@/domain/onboarding/brief';

// T-151 (macrotask onboarding-ui, P1) — composizione dei tre pannelli: e' qui che vive
// lo stato condiviso, cioe' l'unica cosa che ChatPanel, BriefPanel e UrlImportBar hanno
// in comune (P1-D2: chat-led + pannello brief live, con l'import come porta d'ingresso
// che pre-riempie LO STESSO pannello).
//
// Perche' esiste invece di lasciare che i tre componenti si parlino: "l'import
// pre-riempie il pannello" e' una relazione, e senza un contenitore quella relazione
// starebbe nel test invece che nel codice di produzione — un cablaggio che nessuno
// esegue davvero.
//
// LIMITE DICHIARATO: la history della chat vive solo in memoria. T-150 non la persiste
// (P1-D23), quindi un reload riparte da zero — e il modello, che non vede il brief,
// perde anche l'unica memoria che ha. Non si compensa qui: la sede e' T-132.

// Vincolo 5 / P1-D18 — `complete` e `readyForReview` arrivano dal chunk `brief` dello
// stream di T-150 e NON si ricalcolano nel client. Restano `null` finche' un turno non
// li ha portati: fingere un valore iniziale (per esempio derivandolo dai campi del
// brief con la regola di isBriefComplete) sarebbe esattamente il ricalcolo vietato, e
// nasconderebbe che `readyForReview` e' una decisione del modello, non una proprieta'
// osservabile dei dati.
type Readiness = { complete: boolean; readyForReview: boolean };

type OnboardingWorkspaceProps = {
  siteId: string;
  initialBrief: Brief;
};

// I campi core che una proposta di import puo' pre-riempire. `locale` NON e' nel tipo, e
// questa e' la differenza fra "omesso per convenzione" e IRRAPPRESENTABILE: un sito = una
// lingua (T-121) e la lingua e' proprieta' del sito, non un dato che la pagina di
// qualcun altro possa cambiare, quindi scrivere `locale: proposal.locale` qui sotto e' un
// errore di compilazione (proprieta' in eccesso su un literal di ritorno tipizzato) e non
// una svista che passa la review. Anche `content` e' fuori: le collezioni si fondono con
// una regola loro (sotto), non per sovrascrittura.
type ProposalCore = Omit<Brief, 'locale' | 'content'>;

function proposalCore(proposal: Brief): ProposalCore {
  return {
    business_name: proposal.business_name,
    vertical: proposal.vertical,
    description: proposal.description,
    address: proposal.address,
    geo: proposal.geo,
    hours: proposal.hours,
    phone: proposal.phone,
    whatsapp: proposal.whatsapp,
    email: proposal.email,
    primary_goal: proposal.primary_goal,
  };
}

// I campi che la pagina ha DAVVERO prodotto.
//
// `fromUrl` (T-141) costruisce la proposta su `emptyBrief()`, quindi un campo che la
// pagina non ha prodotto non arriva "assente": arriva con il valore di DEFAULT dello
// schema. Il caso concreto e' `vertical`, che ha `default('altro')` in T-121: senza questo
// filtro OGNI import proponeva 'altro' anche per una pagina che del tipo di attivita' non
// dice niente, la vista lo mostrava e la conferma lo mandava a upsertBrief — cioe' l'import
// CANCELLAVA la scelta dell'utente. Il risultato di `fromUrl` non ha un canale per
// distinguere i due casi e aggiungerlo e' T-141 (fuori scope), quindi la distinzione si
// ricostruisce qui: si confronta con il brief VUOTO dello STESSO locale della proposta e si
// tiene solo cio' che ne differisce. Cosi' "prodotto dalla pagina" e' una proprieta'
// CALCOLATA dai default di T-121, non un elenco di campi da tenere aggiornato a mano: se
// domani un altro campo prendesse un default, sarebbe coperto senza toccare questo file.
//
// Un solo confronto copre entrambi i modi di non esserci: il campo assente (nel brief
// vuoto e' `undefined`, quindi `undefined !== undefined` e' falso e il campo si scarta —
// e' cio' che impedisce a un `undefined` della proposta di CANCELLARE un valore che c'era)
// e il campo col valore di default.
//
// COSTO DICHIARATO: una pagina che dichiara DAVVERO `vertical: 'altro'` non pre-riempie
// quel campo. E' innocuo — 'altro' e' anche il valore che il brief porta finche' l'utente
// non scelga, quindi non si perde nulla — mentre il caso opposto ('altro' scritto sopra
// 'ristorazione') e' la perdita di un dato che l'utente ha dato.
function proposedFields(proposal: Brief): Partial<ProposalCore> {
  const blank = proposalCore(emptyBrief(proposal.locale));
  return Object.fromEntries(
    Object.entries(proposalCore(proposal)).filter(
      ([key, value]) => value !== blank[key as keyof ProposalCore],
    ),
  ) as Partial<ProposalCore>;
}

// La proposta SOVRASCRIVE i campi che porta: importare e' un'azione esplicita
// dell'utente e nulla viene salvato finche' non conferma, quindi "riempi solo i buchi"
// avrebbe scartato in silenzio proprio i dati che ha chiesto di importare. Le
// collezioni, invece, non si SVUOTANO: una proposta senza offerte non deve cancellare
// le offerte gia' raccolte dalla chat.
//
// Esportata per l'oracolo: il locale non e' osservabile dal DOM (il pannello non lo rende),
// quindi la sola sede in cui si puo' asserire che la proposta non cambia la lingua del sito
// e' la fusione stessa.
export function mergeProposal(current: Brief, proposal: Brief): Brief {
  return {
    ...current,
    ...proposedFields(proposal),
    // La lingua e' del SITO: si riafferma DOPO lo spread. Non e' ridondante — rende la
    // mutazione "prendi il locale dalla proposta" una riscrittura di questa riga (o una
    // chiave duplicata, che TypeScript rifiuta), non una riga in piu' che nessuno nota.
    locale: current.locale,
    content: {
      offerings:
        proposal.content.offerings.length > 0
          ? proposal.content.offerings
          : current.content.offerings,
      social_links:
        proposal.content.social_links.length > 0
          ? proposal.content.social_links
          : current.content.social_links,
      highlights:
        proposal.content.highlights.length > 0
          ? proposal.content.highlights
          : current.content.highlights,
      brand_hints: proposal.content.brand_hints ?? current.content.brand_hints,
    },
  };
}

export function OnboardingWorkspace({ siteId, initialBrief }: OnboardingWorkspaceProps) {
  const t = useTranslations('onboarding');
  // DUE stati, non uno: `brief` e' cio' che l'utente vede e modifica (vi entra anche il
  // pre-riempimento di un import, che NON e' salvato), `persisted` e' cio' che il DB
  // contiene secondo l'ultima lettura/scrittura. Il pannello calcola il diff contro
  // `persisted`: con un solo stato, un import avrebbe pre-riempito la vista e poi la
  // conferma non avrebbe trovato nulla da scrivere — la proposta si sarebbe persa in
  // silenzio, che e' il modo peggiore di rispettare "la proposta non salva".
  const [brief, setBrief] = useState<Brief>(initialBrief);
  const [persisted, setPersisted] = useState<Brief>(initialBrief);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [pending, setPending] = useState(false);
  const [chatFailed, setChatFailed] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);

  // Un chunk NDJSON di T-150. Arriva dal nostro endpoint, ma si controlla comunque la
  // FORMA prima di usarlo: un chunk troncato (stream interrotto a meta' riga) o di tipo
  // inatteso non deve far crollare il pannello — `brief.content` in particolare, che il
  // BriefPanel dereferenzia.
  function applyChunk(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (parsed === null || typeof parsed !== 'object') return;
    const chunk = parsed as Record<string, unknown>;

    if (chunk.type === 'text' && typeof chunk.text === 'string') {
      setTurns((current) => [...current, { role: 'assistant', text: chunk.text as string }]);
      return;
    }
    if (chunk.type === 'brief') {
      // FORMA VALIDATA CON LO SCHEMA DI T-121, non con un predicato scritto a mano. Il
      // predicato precedente (`typeof chunk.brief.content === 'object'`) era VERO per
      // `content: null`, perche' `typeof null === 'object'`, e per un array: il BriefPanel
      // dereferenzia `brief.content.offerings.length`, quindi la guardia cadeva proprio nei
      // casi per cui esisteva — misurato, il pannello LANCIAVA e l'albero si smontava.
      // Ogni forma di quella famiglia (content nullo, array, `offerings` non-array) e' un
      // buco diverso, quindi non si rattoppa il predicato: si chiede a chi definisce cos'e'
      // un Brief. Il chunk viene da T-150, che serializza un Brief prodotto da
      // applyBriefUpdate: qui non si sta rivalidando un input ostile, si sta impedendo che
      // uno stream troncato o una risposta di forma inattesa entri nello stato.
      // FAIL-CLOSED: un chunk che non valida si scarta INTERO — brief e readiness insieme —
      // perche' meta' chunk sarebbe uno stato che nessuna sorgente ha mai affermato.
      // COSTO DICHIARATO: BriefSchema e' strict, quindi se un task futuro aggiungesse un
      // campo al Brief senza toccare questo modulo il chunk verrebbe scartato: un
      // aggiornamento perso e visibile (il pannello non cambia), non un crash.
      const parsed = BriefSchema.safeParse(chunk.brief);
      if (!parsed.success) return;
      // Il brief del chunk e' quello che upsertBrief ha SALVATO (T-150 flusha questo
      // chunk solo dopo la persistenza): aggiorna ENTRAMBI gli stati, perche' e' al
      // tempo stesso cio' che si vede e cio' che il DB contiene.
      setBrief(parsed.data);
      setPersisted(parsed.data);
      setReadiness({
        complete: chunk.complete === true,
        readyForReview: chunk.readyForReview === true,
      });
      return;
    }
    if (chunk.type === 'error') setChatFailed(true);
  }

  async function handleSend(text: string): Promise<void> {
    // La history spedita e' quella PRECEDENTE al turno corrente: l'endpoint appende lui
    // `userMessage` in coda (P1-D19: solo turni di testo, il primo dev'essere `user`).
    const history = turns.map((turn) => ({ role: turn.role, text: turn.text }));
    setTurns((current) => [...current, { role: 'user', text }]);
    setPending(true);
    setChatFailed(false);

    try {
      const response = await fetch(`/api/onboarding/${encodeURIComponent(siteId)}/turn`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // NESSUN troncamento client-side della history: P1-D22 impone che fuori scala
        // sia un 400, mai un troncamento silenzioso. Se si supera il cap, l'endpoint
        // rifiuta e l'utente vede l'errore — non un'intervista mutilata di nascosto.
        body: JSON.stringify({ messages: history, userMessage: text }),
      });
      if (!response.ok || response.body === null) {
        setChatFailed(true);
        return;
      }

      // NDJSON (P1-D18): una riga JSON per chunk. Si accumula in un buffer perche' il
      // confine dei chunk di rete non coincide con il confine delle righe.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf('\n');
        while (newline >= 0) {
          applyChunk(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf('\n');
        }
      }
      // Ultima riga senza '\n' finale (non accade con T-150, che chiude ogni chunk con
      // il separatore, ma un resto non consumato sarebbe un dato perso in silenzio).
      if (buffer.trim().length > 0) applyChunk(buffer);
    } catch {
      setChatFailed(true);
    } finally {
      setPending(false);
    }
  }

  // La patch appena scritta si fonde in ENTRAMBI gli stati, e da qui in poi il diff del
  // pannello riparte da zero.
  //
  // LIMITE DICHIARATO, non risolto qui. "upsertBrief ha applicato la patch" e'
  // un'APPROSSIMAZIONE: `upsertBrief` fonde con applyBriefUpdate, che scarta CAMPO PER
  // CAMPO (un valore fuori dai tetti di P1-D17, un enum fuori allowlist), e ritorna solo
  // `{ok, complete}` — il `rejected[]` di T-122 non attraversa quel confine. Quindi un
  // campo RIFIUTATO viene segnato qui come persistito, i diff successivi lo saltano e il
  // valore non arriva mai in tabella senza che l'utente lo sappia.
  // Perche' non si finge di saperlo: con l'API attuale non si PUO' sapere quali campi
  // sono stati scartati. Le due strade scartate, e il perche':
  //  - riportare `rejected[]` in UpsertBriefResult sarebbe un emendamento a T-123, un task
  //    chiuso e verde, fuori dallo scope di T-151 (P1-D17 ha gia' dovuto toccarne uno);
  //  - rileggere con getBrief dopo ogni salvataggio renderebbe `persisted` veritiero ma NON
  //    direbbe niente all'utente (upsertBrief resta `ok:true` comunque): si pagherebbe un
  //    round-trip per campo salvato in cambio dell'APPARENZA di una correzione, e si
  //    aggiungerebbe un secondo modo di fallire (la rilettura che non risponde).
  // Sede della fix: `UpsertBriefResult` in `src/data/briefs.ts` (T-123), con una decisione
  // esplicita. Fino ad allora e' un limite dichiarato, non un incidente.
  function handleSaved(patch: BriefPanelPatch): void {
    setBrief((current) => ({ ...current, ...patch }));
    setPersisted((current) => ({ ...current, ...patch }));
  }

  return (
    <div className="flex flex-col gap-lg">
      <UrlImportBar
        onProposal={(proposal) => setBrief((current) => mergeProposal(current, proposal))}
      />

      {readiness !== null && (
        <div className="flex flex-col gap-xs">
          {readiness.complete && (
            <p className="text-sm text-muted-foreground">{t('readiness.complete')}</p>
          )}
          {readiness.readyForReview && (
            <p className="text-sm text-muted-foreground">{t('readiness.readyForReview')}</p>
          )}
        </div>
      )}

      <BriefPanel siteId={siteId} brief={brief} persisted={persisted} onSaved={handleSaved} />

      <ChatPanel turns={turns} pending={pending} failed={chatFailed} onSend={handleSend} />
    </div>
  );
}
