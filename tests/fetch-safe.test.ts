import { describe, it, expect, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchSafe, pinnedFetch } from '@/domain/import/fetchSafe';

// T-140 (macrotask url-import, P1) — fetch server-side SSRF-safe.
// Le asserzioni derivano dagli acceptance_criteria AC-140-1..6 (03-url-import.md);
// quelle che pinnano la definition_of_done o le security_notes senza discendere da
// un AC portano il marker corrispondente e NON un `covers:`.
//
// Nessun test apre una connessione verso l'esterno: il resolver DNS e il trasporto
// sono iniettati. ATTENZIONE ALLA TAUTOLOGIA: il doppio del resolver dice soltanto
// "questo host risolve a questi indirizzi" — la CLASSIFICAZIONE (privato/pubblico)
// resta interamente nel codice vero, che e' cio' che questi test mettono alla prova.
// Gli unici due test che parlano davvero TCP (pinnedFetch) usano un server node:http
// su 127.0.0.1 e non passano dalla guardia: non indeboliscono AC-140-1, che continua
// a pretendere il blocco di 127.0.0.1 quando si entra da fetchSafe.

const PUBLIC_HOST = 'sito-pubblico.example';
const PUBLIC_IP = '93.184.216.34';
const CORPO_INTERNO = 'CONTENUTO-INTERNO-CHE-NON-DEVE-USCIRE';

type Hop = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
};

// Doppio del resolver: mappa hostname -> indirizzi testuali. Un hostname assente
// simula un ENOTFOUND. `calls` registra gli hostname visti, nell'ordine.
function resolverOf(map: Record<string, readonly string[]>) {
  const calls: string[] = [];
  return {
    calls,
    resolve: async (hostname: string) => {
      calls.push(hostname);
      const found = map[hostname];
      if (found === undefined) throw new Error('ENOTFOUND');
      return found.map((address) => ({
        address,
        family: address.includes(':') ? 6 : 4,
      }));
    },
  };
}

// Doppio del trasporto: risponde con gli hop dichiarati (l'ultimo si ripete, utile
// per le catene di redirect infinite). `calls` registra URL e indirizzi pinnati.
function transportOf(...hops: readonly Hop[]) {
  const calls: { url: string; pinned: readonly string[] }[] = [];
  return {
    calls,
    transport: async (
      url: string,
      options: { pinnedAddresses: readonly { address: string; family: number }[] },
    ) => {
      calls.push({ url, pinned: options.pinnedAddresses.map((a) => a.address) });
      const hop = hops[Math.min(calls.length - 1, hops.length - 1)];
      // Body in byte, non in stringa: con una stringa il costruttore di Response
      // aggiunge da solo `content-type: text/plain`, e il caso "header assente"
      // diventerebbe silenziosamente un altro caso.
      return new Response(new TextEncoder().encode(hop.body ?? '<html>pubblico</html>'), {
        status: hop.status ?? 200,
        headers: hop.headers ?? { 'content-type': 'text/html' },
      });
    },
  };
}

// Trasporto che fallisce: serve a pinnare la mappatura errore -> motivo tipizzato.
function failingTransport(error: unknown) {
  return async () => {
    throw error;
  };
}

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  try {
    await run((server.address() as AddressInfo).port);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
}

describe('T-140 fetch SSRF-safe', () => {
  // covers: AC-140-2
  it('rifiuta gli schemi diversi da http/https senza effettuare alcuna richiesta di rete', async () => {
    const dns = resolverOf({});
    const net = transportOf({});

    for (const raw of [
      'file:///etc/passwd',
      'ftp://sito.example/x',
      'gopher://sito.example/',
      'data:text/html,<b>x</b>',
      'javascript:alert(1)',
      'ws://sito.example/',
    ]) {
      const result = await fetchSafe(raw, { resolve: dns.resolve, transport: net.transport });
      expect(result, raw).toEqual({ ok: false, reason: 'scheme-not-allowed' }); // covers: AC-140-2
    }

    // La prova che NON c'e' stata alcuna richiesta: ne' risoluzione DNS ne' connessione.
    expect(dns.calls).toEqual([]); // covers: AC-140-2
    expect(net.calls).toEqual([]); // covers: AC-140-2
  });

  // covers: AC-140-1
  it('blocca gli host che risolvono a IPv4 privati/riservati senza connettersi', async () => {
    // Ogni voce e' un indirizzo che la guardia deve classificare come non raggiungibile.
    const blocked = [
      '0.0.0.0', // 0/8
      '0.255.255.255',
      '10.0.0.5', // 10/8
      '10.255.255.255',
      '100.64.0.1', // 100.64/10 CGNAT
      '100.127.255.255',
      '127.0.0.1', // 127/8 loopback
      '127.255.255.255',
      '169.254.169.254', // metadata cloud, dentro 169.254/16
      '169.254.0.1',
      '172.16.0.1', // 172.16/12
      '172.31.255.255',
      '192.0.0.1', // 192.0.0.0/24
      '192.168.1.1', // 192.168/16
      '192.168.255.255',
      '198.18.0.1', // 198.18/15
      '198.19.255.255',
      '224.0.0.1', // 224/4 multicast
      '239.255.255.255',
      '240.0.0.1', // 240/4 riservato
      '255.255.255.255', // broadcast
    ];

    for (const address of blocked) {
      const dns = resolverOf({ 'interno.example': [address] });
      const net = transportOf({ body: CORPO_INTERNO });
      const result = await fetchSafe('http://interno.example/admin', {
        resolve: dns.resolve,
        transport: net.transport,
      });

      expect(result, address).toEqual({ ok: false, reason: 'address-blocked' }); // covers: AC-140-1
      // Nessun contenuto del target interno: il risultato ha SOLO ok+reason.
      expect(Object.keys(result).sort(), address).toEqual(['ok', 'reason']); // covers: AC-140-1
      expect(JSON.stringify(result).includes(CORPO_INTERNO), address).toBe(false); // covers: AC-140-1
      // E soprattutto: la connessione non e' mai partita.
      expect(net.calls, address).toEqual([]); // covers: AC-140-1
    }
  });

  // covers: AC-140-1
  it('blocca gli host che risolvono a IPv6 riservati, compresi gli IPv4-mapped', async () => {
    const blocked = [
      '::', // non specificato
      '::1', // loopback
      '::7f00:1', // IPv4-compatible (deprecato) su 127.0.0.1
      'fc00::1', // fc00::/7 ULA
      'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      'fe80::1', // fe80::/10 link-local
      'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      'ff00::1', // ff00::/8 multicast
      'ff02::1',
      'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
      '::ffff:127.0.0.1', // IPv4-mapped, forma dotted
      '::ffff:7f00:1', // stesso indirizzo nella forma esadecimale che usa Node
      '::ffff:10.0.0.5',
      '::ffff:a9fe:a9fe', // 169.254.169.254 mappato
      'non-un-indirizzo', // default DENY: non classificabile
      'fe80::1%eth0', // zone id: non classificabile con certezza
    ];

    for (const address of blocked) {
      const dns = resolverOf({ 'interno.example': [address] });
      const net = transportOf({ body: CORPO_INTERNO });
      const result = await fetchSafe('http://interno.example/', {
        resolve: dns.resolve,
        transport: net.transport,
      });

      expect(result, address).toEqual({ ok: false, reason: 'address-blocked' }); // covers: AC-140-1
      expect(net.calls, address).toEqual([]); // covers: AC-140-1
    }
  });

  // covers: AC-140-1
  it('blocca la forma IPv6 letterale fra parentesi quadre risolvendo l hostname nudo', async () => {
    const dns = resolverOf({ '::ffff:7f00:1': ['::ffff:7f00:1'] });
    const net = transportOf({ body: CORPO_INTERNO });

    const result = await fetchSafe('http://[::ffff:7f00:1]/', {
      resolve: dns.resolve,
      transport: net.transport,
    });

    expect(result).toEqual({ ok: false, reason: 'address-blocked' }); // covers: AC-140-1
    expect(net.calls).toEqual([]); // covers: AC-140-1
    // Le parentesi quadre sono della sintassi dell'URL, non dell'hostname: al
    // resolver arriva l'indirizzo nudo.
    expect(dns.calls).toEqual(['::ffff:7f00:1']); // DoD T-140
  });

  // covers: AC-140-1
  it('blocca se anche UNO SOLO dei record DNS dell host e privato', async () => {
    const dns = resolverOf({ 'doppio.example': [PUBLIC_IP, '10.0.0.5'] });
    const net = transportOf({ body: CORPO_INTERNO });

    const result = await fetchSafe('http://doppio.example/', {
      resolve: dns.resolve,
      transport: net.transport,
    });

    expect(result).toEqual({ ok: false, reason: 'address-blocked' }); // covers: AC-140-1
    expect(net.calls).toEqual([]); // covers: AC-140-1
  });

  // Default DENY (security_notes T-140): senza indirizzi non c'e' nulla da validare.
  it('blocca quando la risoluzione non restituisce alcun indirizzo', async () => {
    const net = transportOf({});
    const result = await fetchSafe('http://vuoto.example/', {
      resolve: async () => [],
      transport: net.transport,
    });

    expect(result).toEqual({ ok: false, reason: 'address-blocked' }); // security_notes T-140
    expect(net.calls).toEqual([]); // security_notes T-140
  });

  // Guardia anti-iper-blocco: la guardia non deve rifiutare la rete pubblica, e i
  // valori scelti sono i CONFINI delle range bloccate (uccidono gli off-by-one).
  it('lascia passare gli indirizzi pubblici, anche a ridosso dei confini delle range bloccate', async () => {
    const allowed = [
      '1.0.0.1',
      '8.8.8.8',
      '9.255.255.255', // appena sotto 10/8
      '11.0.0.0', // appena sopra 10/8
      '100.63.255.255', // appena sotto 100.64/10
      '100.128.0.0', // appena sopra 100.64/10
      '126.255.255.255', // appena sotto 127/8
      '128.0.0.1', // appena sopra 127/8
      '169.253.255.255', // appena sotto 169.254/16
      '169.255.0.0', // appena sopra 169.254/16
      '172.15.255.255', // appena sotto 172.16/12
      '172.32.0.0', // appena sopra 172.16/12
      '192.0.1.1', // appena sopra 192.0.0.0/24
      '192.167.255.255', // appena sotto 192.168/16
      '192.169.0.0', // appena sopra 192.168/16
      '198.17.255.255', // appena sotto 198.18/15
      '198.20.0.0', // appena sopra 198.18/15
      '223.255.255.255', // appena sotto 224/4
      PUBLIC_IP,
      '2001:4860:4860::8888',
      '2606:2800:220:1:248:1893:25c8:1946',
      // Confini delle maschere IPv6: fuori dalle range bloccate richieste.
      'fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', // appena sotto fc00::/7
      'fe40::1', // appena sotto fe80::/10
      'fec0::1', // appena sopra fe80::/10
    ];

    for (const address of allowed) {
      const dns = resolverOf({ [PUBLIC_HOST]: [address] });
      const net = transportOf({ body: '<html>ok</html>' });
      const result = await fetchSafe(`http://${PUBLIC_HOST}/`, {
        resolve: dns.resolve,
        transport: net.transport,
      });

      expect(result, address).toEqual({ ok: true, html: '<html>ok</html>' }); // DoD T-140
    }
  });

  // covers: AC-140-5
  it('restituisce il body HTML di una risposta 200 text/html', async () => {
    const html = '<html><head><title>Bar Sole</title></head><body>ciao</body></html>';
    const dns = resolverOf({ [PUBLIC_HOST]: [PUBLIC_IP] });
    const net = transportOf({ status: 200, headers: { 'content-type': 'text/html' }, body: html });

    const result = await fetchSafe(`https://${PUBLIC_HOST}/menu`, {
      resolve: dns.resolve,
      transport: net.transport,
    });

    expect(result).toEqual({ ok: true, html }); // covers: AC-140-5
    // Una sola richiesta, all'URL richiesto, connessa SOLO all'indirizzo validato.
    expect(net.calls).toEqual([{ url: `https://${PUBLIC_HOST}/menu`, pinned: [PUBLIC_IP] }]); // DoD T-140
  });

  // covers: AC-140-5
  it('accetta il content-type text/html anche con parametri (charset)', async () => {
    const dns = resolverOf({ [PUBLIC_HOST]: [PUBLIC_IP] });
    const net = transportOf({
      headers: { 'content-type': 'Text/HTML; charset=utf-8' },
      body: '<html>àccento</html>',
    });

    const result = await fetchSafe(`http://${PUBLIC_HOST}/`, {
      resolve: dns.resolve,
      transport: net.transport,
    });

    expect(result).toEqual({ ok: true, html: '<html>àccento</html>' }); // covers: AC-140-5
  });

  // covers: AC-140-6
  it('rifiuta i content-type diversi da text/html', async () => {
    const rifiutati = [
      'application/octet-stream',
      'application/json',
      'text/plain',
      'text/htmlx', // prefisso ingannevole: il confronto e sul media type intero
      'application/xhtml+xml',
    ];

    for (const contentType of rifiutati) {
      const dns = resolverOf({ [PUBLIC_HOST]: [PUBLIC_IP] });
      const net = transportOf({ headers: { 'content-type': contentType }, body: CORPO_INTERNO });
      const result = await fetchSafe(`http://${PUBLIC_HOST}/file`, {
        resolve: dns.resolve,
        transport: net.transport,
      });

      expect(result, contentType).toEqual({ ok: false, reason: 'content-type-not-allowed' }); // covers: AC-140-6
      expect(JSON.stringify(result).includes(CORPO_INTERNO), contentType).toBe(false); // covers: AC-140-6
    }
  });

  // Default DENY anche sul content-type: senza header non c'e' certezza.
  it('rifiuta una risposta priva di content-type', async () => {
    const dns = resolverOf({ [PUBLIC_HOST]: [PUBLIC_IP] });
    const net = transportOf({ headers: {}, body: '<html>ok</html>' });

    const result = await fetchSafe(`http://${PUBLIC_HOST}/`, {
      resolve: dns.resolve,
      transport: net.transport,
    });

    expect(result).toEqual({ ok: false, reason: 'content-type-not-allowed' }); // DoD T-140
  });

  // covers: AC-140-4
  it('rifiuta una risposta che supera la dimensione massima e non restituisce body', async () => {
    const dns = resolverOf({ [PUBLIC_HOST]: [PUBLIC_IP] });
    // Un byte oltre il massimo (1 MB): il limite e scritto qui a mano di proposito,
    // cosi cambiare la costante nell'implementazione fa fallire il test.
    const net = transportOf({ body: 'x'.repeat(1_000_001) });

    const result = await fetchSafe(`http://${PUBLIC_HOST}/enorme`, {
      resolve: dns.resolve,
      transport: net.transport,
    });

    expect(result).toEqual({ ok: false, reason: 'too-large' }); // covers: AC-140-4
    expect(Object.keys(result).sort()).toEqual(['ok', 'reason']); // covers: AC-140-4 — nessun body oltre il massimo
  });

  // covers: AC-140-4
  it('accetta una risposta esattamente al limite di dimensione', async () => {
    const dns = resolverOf({ [PUBLIC_HOST]: [PUBLIC_IP] });
    const body = 'x'.repeat(1_000_000);
    const net = transportOf({ body });

    const result = await fetchSafe(`http://${PUBLIC_HOST}/grande`, {
      resolve: dns.resolve,
      transport: net.transport,
    });

    expect(result).toEqual({ ok: true, html: body }); // covers: AC-140-4 — il limite e sul superamento
  });

  // covers: AC-140-3
  it('blocca il redirect verso un IP privato all hop di redirect', async () => {
    const dns = resolverOf({
      [PUBLIC_HOST]: [PUBLIC_IP],
      'metadata.example': ['169.254.169.254'],
    });
    const net = transportOf(
      { status: 302, headers: { location: 'http://metadata.example/latest/meta-data/' } },
      { body: CORPO_INTERNO },
    );

    const result = await fetchSafe(`http://${PUBLIC_HOST}/start`, {
      resolve: dns.resolve,
      transport: net.transport,
    });

    expect(result).toEqual({ ok: false, reason: 'address-blocked' }); // covers: AC-140-3
    expect(JSON.stringify(result).includes(CORPO_INTERNO)).toBe(false); // covers: AC-140-3
    // La seconda connessione non e' mai partita: il blocco precede l'I/O sull'hop.
    expect(net.calls.map((c) => c.url)).toEqual([`http://${PUBLIC_HOST}/start`]); // covers: AC-140-3
    // Ma il target del redirect e' stato comunque ri-risolto e giudicato.
    expect(dns.calls).toEqual([PUBLIC_HOST, 'metadata.example']); // covers: AC-140-3
  });

  // covers: AC-140-3
  it('ri-valida ogni hop: un redirect relativo verso un host che risolve a 127.0.0.1 e bloccato', async () => {
    const dns = resolverOf({ [PUBLIC_HOST]: [PUBLIC_IP], 'interno.example': ['127.0.0.1'] });
    const net = transportOf(
      { status: 301, headers: { location: '/passo-2' } },
      { status: 307, headers: { location: 'http://interno.example/segreto' } },
      { body: CORPO_INTERNO },
    );

    const result = await fetchSafe(`http://${PUBLIC_HOST}/passo-1`, {
      resolve: dns.resolve,
      transport: net.transport,
    });

    expect(result).toEqual({ ok: false, reason: 'address-blocked' }); // covers: AC-140-3
    // Il location relativo e stato risolto sull'URL dell'hop corrente.
    expect(net.calls.map((c) => c.url)).toEqual([
      `http://${PUBLIC_HOST}/passo-1`,
      `http://${PUBLIC_HOST}/passo-2`,
    ]); // covers: AC-140-3
  });

  // covers: AC-140-3
  it('blocca un redirect verso uno schema non http/https', async () => {
    const dns = resolverOf({ [PUBLIC_HOST]: [PUBLIC_IP] });
    const net = transportOf({ status: 302, headers: { location: 'file:///etc/passwd' } });

    const result = await fetchSafe(`http://${PUBLIC_HOST}/start`, {
      resolve: dns.resolve,
      transport: net.transport,
    });

    expect(result).toEqual({ ok: false, reason: 'scheme-not-allowed' }); // covers: AC-140-3
    expect(net.calls.length).toBe(1); // covers: AC-140-3
  });

  it('segue al massimo 5 redirect', async () => {
    const dns = resolverOf({ [PUBLIC_HOST]: [PUBLIC_IP] });
    const redirect: Hop = { status: 302, headers: { location: `http://${PUBLIC_HOST}/loop` } };

    // 5 redirect e poi una pagina: passa (6 richieste in tutto).
    const cinque = transportOf(
      redirect,
      redirect,
      redirect,
      redirect,
      redirect,
      { body: '<html>arrivato</html>' },
      { body: CORPO_INTERNO },
    );
    const okResult = await fetchSafe(`http://${PUBLIC_HOST}/0`, {
      resolve: dns.resolve,
      transport: cinque.transport,
    });
    expect(okResult).toEqual({ ok: true, html: '<html>arrivato</html>' }); // DoD T-140
    expect(cinque.calls.length).toBe(6); // DoD T-140

    // Il sesto redirect no: catena interrotta, nessuna settima richiesta.
    const sei = transportOf(redirect);
    const koResult = await fetchSafe(`http://${PUBLIC_HOST}/0`, {
      resolve: dns.resolve,
      transport: sei.transport,
    });
    expect(koResult).toEqual({ ok: false, reason: 'too-many-redirects' }); // DoD T-140
    expect(sei.calls.length).toBe(6); // DoD T-140
  });

  it('passa al trasporto un unico budget di tempo per tutta la catena', async () => {
    const dns = resolverOf({ [PUBLIC_HOST]: [PUBLIC_IP] });
    const signals: AbortSignal[] = [];
    const transport = async (url: string, options: { signal: AbortSignal }) => {
      signals.push(options.signal);
      return signals.length === 1
        ? new Response(null, { status: 302, headers: { location: `http://${PUBLIC_HOST}/2` } })
        : new Response(new TextEncoder().encode('<html>ok</html>'), {
            headers: { 'content-type': 'text/html' },
          });
    };

    const result = await fetchSafe(`http://${PUBLIC_HOST}/1`, { resolve: dns.resolve, transport });

    expect(result).toEqual({ ok: true, html: '<html>ok</html>' }); // DoD T-140
    expect(signals.length).toBe(2); // DoD T-140
    expect(signals[0]).toBeInstanceOf(AbortSignal); // DoD T-140
    // Lo stesso segnale a ogni hop: un redirect non ricompra tempo.
    expect(signals[1]).toBe(signals[0]); // DoD T-140
    expect(signals[0].aborted).toBe(false); // DoD T-140
  });

  it('tratta un redirect privo di location come errore di rete', async () => {
    const dns = resolverOf({ [PUBLIC_HOST]: [PUBLIC_IP] });
    const net = transportOf({ status: 302, headers: {} });

    const result = await fetchSafe(`http://${PUBLIC_HOST}/`, {
      resolve: dns.resolve,
      transport: net.transport,
    });

    expect(result).toEqual({ ok: false, reason: 'network-error' }); // DoD T-140
  });

  it('rifiuta le risposte con status non di successo senza restituirne il corpo', async () => {
    for (const status of [404, 500]) {
      const dns = resolverOf({ [PUBLIC_HOST]: [PUBLIC_IP] });
      const net = transportOf({
        status,
        headers: { 'content-type': 'text/html' },
        body: `<html>${CORPO_INTERNO}</html>`,
      });
      const result = await fetchSafe(`http://${PUBLIC_HOST}/`, {
        resolve: dns.resolve,
        transport: net.transport,
      });

      expect(result, String(status)).toEqual({ ok: false, reason: 'network-error' }); // DoD T-140
      expect(JSON.stringify(result).includes(CORPO_INTERNO), String(status)).toBe(false); // DoD T-140
    }
  });

  it('distingue il timeout dagli altri errori del trasporto e della risoluzione', async () => {
    const dns = resolverOf({ [PUBLIC_HOST]: [PUBLIC_IP] });

    const scaduto = await fetchSafe(`http://${PUBLIC_HOST}/`, {
      resolve: dns.resolve,
      transport: failingTransport(new DOMException('The operation was aborted', 'TimeoutError')),
    });
    expect(scaduto).toEqual({ ok: false, reason: 'timeout' }); // DoD T-140

    const rotto = await fetchSafe(`http://${PUBLIC_HOST}/`, {
      resolve: dns.resolve,
      transport: failingTransport(new TypeError('fetch failed')),
    });
    expect(rotto).toEqual({ ok: false, reason: 'network-error' }); // DoD T-140

    // Host inesistente: il doppio del resolver rigetta come farebbe un ENOTFOUND.
    // Il motivo e' 'address-blocked', LO STESSO di un host che risolve a un IP
    // interno: distinguerli renderebbe la guardia un oracolo di enumerazione del
    // DNS interno (si potrebbe sondare quali nomi esistono nella rete del server
    // leggendo il motivo del rifiuto). La conflazione e' deliberata.
    const net = transportOf({});
    const ignoto = await fetchSafe('http://non-esiste.example/', {
      resolve: resolverOf({}).resolve,
      transport: net.transport,
    });
    expect(ignoto).toEqual({ ok: false, reason: 'address-blocked' }); // security_notes T-140
    const interno = await fetchSafe('http://interno.example/', {
      resolve: resolverOf({ 'interno.example': ['10.0.0.5'] }).resolve,
      transport: net.transport,
    });
    // Indistinguibili: e' questo che nega l'enumerazione.
    expect(ignoto).toEqual(interno); // security_notes T-140
    expect(net.calls).toEqual([]); // DoD T-140
  });

  it('rifiuta una stringa che non e un URL, senza toccare la rete', async () => {
    const dns = resolverOf({});
    const net = transportOf({});

    const result = await fetchSafe('non un url', {
      resolve: dns.resolve,
      transport: net.transport,
    });

    expect(result).toEqual({ ok: false, reason: 'scheme-not-allowed' }); // DoD T-140
    expect(dns.calls).toEqual([]); // DoD T-140
    expect(net.calls).toEqual([]); // DoD T-140
  });

  // Il trasporto reale, provato contro un server locale: e' il pezzo che chiude la
  // finestra TOCTOU/DNS-rebinding (security_notes T-140). Qui si entra SOTTO la
  // guardia, passandole a mano un indirizzo gia' "validato": non e' una scorciatoia
  // per fetchSafe, che su 127.0.0.1 continua a rispondere 'address-blocked'.
  it('pinnedFetch connette all indirizzo pinnato conservando hostname, Host e User-Agent', async () => {
    await withServer(
      (req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<html>host=${req.headers.host} ua=${req.headers['user-agent']}</html>`);
      },
      async (port) => {
        // Hostname del TLD .invalid (RFC 2606): non e' risolvibile da nessun DNS.
        // Se il pinning non funzionasse, la richiesta fallirebbe invece di arrivare.
        const response = await pinnedFetch(`http://pinnato.invalid:${port}/pagina`, {
          pinnedAddresses: [{ address: '127.0.0.1', family: 4 }],
          signal: AbortSignal.timeout(5_000),
        });
        const body = await response.text();

        expect(response.status).toBe(200); // security_notes T-140
        // L'URL non viene riscritto con l'IP: Host (e su https SNI/certificato)
        // restano quelli dell'hostname originale.
        expect(body).toContain(`host=pinnato.invalid:${port}`); // security_notes T-140
        // User-Agent identificabile (out_of_scope: robots/ToS best-effort dichiarato).
        expect(body).toContain('ua=BeloraImportBot/1.0'); // DoD T-140
      },
    );
  });

  it('pinnedFetch non segue i redirect da solo: li consegna al chiamante', async () => {
    await withServer(
      (req, res) => {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        res.end('ignorato');
      },
      async (port) => {
        const response = await pinnedFetch(`http://pinnato.invalid:${port}/redir`, {
          pinnedAddresses: [{ address: '127.0.0.1', family: 4 }],
          signal: AbortSignal.timeout(5_000),
        });
        await response.body?.cancel();

        // Se seguisse i redirect da solo, la ri-validazione per hop di AC-140-3
        // sarebbe scavalcata dentro il trasporto.
        expect(response.status).toBe(302); // security_notes T-140
        expect(response.headers.get('location')).toBe('http://169.254.169.254/latest/meta-data/'); // security_notes T-140
      },
    );
  });
});

describe('T-140 rilievi della verifica avversariale (regressioni pinnate)', () => {
  // security_notes T-140 — I prefissi IPv6 di TRANSIZIONE incapsulano un IPv4:
  // in una rete che li instrada (NAT64 e' comune negli ambienti IPv6-only)
  // `64:ff9b::a9fe:a9fe` raggiunge 169.254.169.254, l'endpoint metadata cloud,
  // pur non somigliando a nessun indirizzo privato.
  it('blocca i prefissi IPv6 di transizione che incapsulano un IPv4 (NAT64, 6to4)', async () => {
    const incapsulati = [
      '64:ff9b::a9fe:a9fe', // NAT64 di 169.254.169.254 (metadata)
      '64:ff9b::7f00:1', // NAT64 di 127.0.0.1
      '2002:7f00:1::', // 6to4 di 127.0.0.1
      '2002:a9fe:a9fe::', // 6to4 di 169.254.169.254
      '::a9fe:a9fe', // IPv4-compatible deprecato
    ];

    for (const address of incapsulati) {
      const net = transportOf({});
      const result = await fetchSafe(`http://${PUBLIC_HOST}/`, {
        resolve: resolverOf({ [PUBLIC_HOST]: [address] }).resolve,
        transport: net.transport,
      });
      expect(result, address).toEqual({ ok: false, reason: 'address-blocked' }); // security_notes T-140
      // Non e' stata nemmeno tentata la connessione: il blocco precede l'I/O.
      expect(net.calls, address).toEqual([]); // security_notes T-140
    }
  });

  // DoD T-140 ("timeout ... applicato"): senza questo oracolo TIMEOUT_MS puo'
  // valere qualunque cosa — anche 600 s — con la suite verde.
  it('applica il budget di tempo dichiarato a tutta la catena', async () => {
    vi.useFakeTimers();
    try {
      const pending = fetchSafe(`http://${PUBLIC_HOST}/`, {
        resolve: resolverOf({ [PUBLIC_HOST]: [PUBLIC_IP] }).resolve,
        // Trasporto che non risponde mai: solo il timeout puo' chiudere la richiesta.
        transport: (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(options.signal.reason));
          }),
      });

      await vi.advanceTimersByTimeAsync(9_000);
      // Ancora nessun esito: il budget non e' scaduto.
      await vi.advanceTimersByTimeAsync(1_500);
      expect(await pending).toEqual({ ok: false, reason: 'timeout' }); // DoD T-140
    } finally {
      vi.useRealTimers();
    }
  });

  // DoD T-140: 303 e 308 sono redirect a tutti gli effetti. Senza oracolo si
  // possono togliere da REDIRECT_STATUSES e il body della risposta 3xx verrebbe
  // trattato come contenuto della pagina.
  it('riconosce come redirect anche 303 e 308, rivalidando il nuovo target', async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const net = transportOf(
        { status, headers: { location: 'http://interno.example/' } },
        { status: 200, headers: { 'content-type': 'text/html' }, body: CORPO_INTERNO },
      );
      const result = await fetchSafe(`http://${PUBLIC_HOST}/`, {
        resolve: resolverOf({
          [PUBLIC_HOST]: [PUBLIC_IP],
          'interno.example': ['10.0.0.5'],
        }).resolve,
        transport: net.transport,
      });
      expect(result, String(status)).toEqual({ ok: false, reason: 'address-blocked' }); // DoD T-140
      expect(JSON.stringify(result), String(status)).not.toContain(CORPO_INTERNO); // security_notes T-140
      // Un solo hop eseguito: il secondo non e' mai stato contattato.
      expect(net.calls.length, String(status)).toBe(1); // DoD T-140
    }
  });

  // DoD T-140: i test iniettano resolver e trasporto, quindi il CABLAGGIO di
  // produzione (systemResolve + pinnedFetch come default) non sarebbe coperto da
  // nulla: si potrebbe rimuovere la risoluzione DNS reale e restare verdi.
  it('usa il resolver di sistema quando non gli si inietta nulla', async () => {
    // Nessun `deps`: entra in gioco systemResolve. 127.0.0.1 e' un IP letterale,
    // quindi la risoluzione non tocca la rete, ma passa dal codice vero.
    expect(await fetchSafe('http://127.0.0.1/')).toEqual({
      ok: false,
      reason: 'address-blocked',
    }); // DoD T-140
    expect(await fetchSafe('http://[::1]/')).toEqual({ ok: false, reason: 'address-blocked' }); // DoD T-140
    // Un host pubblico non viene bloccato dalla CLASSIFICAZIONE: qui il trasporto
    // e' iniettato, quindi nessuna connessione parte, ma il resolver e' quello vero.
    const net = transportOf({ status: 200, headers: { 'content-type': 'text/html' }, body: 'ok' });
    expect(await fetchSafe('http://93.184.216.34/', { transport: net.transport })).toEqual({
      ok: true,
      html: 'ok',
    }); // DoD T-140
  });
});
