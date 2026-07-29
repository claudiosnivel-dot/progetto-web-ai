# Audit degli oracoli — Superficie 6: IMPORT DA URL (SSRF)

> Piano `AUDIT-ORACOLI-P0-P1.md` §3. Data: 2026-07-29.
> Baseline: **2 file, 62 test, 0 falliti, 0 skippati**.
> **9 mutazioni applicate, 9 esiti registrati, 9 ripristini verificati per sha256.**
>
> *Scostamento dichiarato dal piano*: il piano nominava come oracolo il solo
> `import-fromurl.test.ts`. E stato incluso anche **`fetch-safe.test.ts`**, che e l'oracolo
> vero di `fetchSafe.ts` — una delle sorgenti che il piano mette in scope. Ometterlo avrebbe
> misurato la superficie senza il suo controllo principale.

## 1. Esito: 8 mutazioni su 8 PRESE

| ID | Difesa mutata | Esito |
|---|---|---|
| SS0 | **fatale**: `isBlockedAddress` ritorna sempre `false` | **ROSSO** (3 test) |
| SS3 | `169.254/16` riammesso — **l'endpoint dei metadati cloud** | **ROSSO** (3 test) |
| SS5 | `some(...)` → `every(...)`: si blocca solo se **tutti** i record sono interni | **ROSSO** — *"blocca se anche UNO SOLO dei record DNS dell host e privato"* |
| SS4 | cade il default-DENY su **zero** indirizzi risolti | **ROSSO** — *"blocca quando la risoluzione non restituisce alcun indirizzo"* |
| SS6 | l'IPv4-mapped non viene piu de-mappato (`::ffff:7f00:1`) | **ROSSO** (2 test) |
| SS7 | `redirect: 'manual'` → `'follow'`: i redirect li segue il client | **ROSSO** |
| SS8 | rimosso il **pinning DNS**: si riapre la finestra di rebinding | **ROSSO** (2 test) |
| SS10 | content-type confrontato per **prefisso** (`text/htmlx` passerebbe) | **ROSSO** |
| SS13 | **ATTESA-VERDE**: due condizioni mutuamente esclusive scambiate | **VERDE** |

**Nessun rilievo.** E l'unica superficie delle sei su cui l'audit non ha trovato nulla da
segnalare.

## 2. Perche questa superficie regge, mentre le altre no

Non e fortuna, ed e la lezione piu utile del referto. Tre differenze **strutturali** rispetto
alle superfici 1-5:

**1. I test sono nominati sulla PROPRIETA, non sul meccanismo.**
*"blocca se anche UNO SOLO dei record DNS dell host e privato"*, *"blocca quando la
risoluzione non restituisce alcun indirizzo"*, *"pinnedFetch non segue i redirect da solo:
li consegna al chiamante"*. Ogni nome e la frase che si vorrebbe restasse vera. Altrove i
test si chiamano *"ha policy per SELECT/INSERT/UPDATE/DELETE"*: descrivono la forma
dell'implementazione, e una forma si puo mantenere svuotandola.

**2. Ogni singola clausola difensiva ha il proprio caso.** Le nove mutazioni non hanno dovuto
cercare un punto scoperto: hanno colpito nove difese diverse e ne hanno trovate nove presidiate.
La densita lo dice da sola — **62 test per due moduli**, contro i 21 di sei file altrove.

**3. I casi limite sono quelli che un attaccante userebbe davvero**, non quelli comodi da
scrivere: IPv4-mapped nella forma compressa che *Node* produce, la catena di redirect, i
record DNS misti, il media type che e prefisso di quello ammesso. E la differenza fra provare
che la difesa funziona e provare che **non e aggirabile**.

## 3. Il contrasto, in una riga

Le superfici 1-5 asseriscono che il meccanismo **c'e**. Questa asserisce che la difesa **non
si puo togliere**. E il modello da copiare nella fase di fix — non un pattern da inventare,
ma uno gia scritto in questo repo, da un autore che aveva in mente la domanda giusta.
