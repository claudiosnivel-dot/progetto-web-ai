# Come arrivano a Belora le foto del cliente — studio di fattibilità

> **Progetto:** Belora · **Data della verifica:** 2026-07-26 · **Sede della decisione:** **P4** (pipeline media & hosting) e **P1.x** (auto-import), **non P2**.
> **Metodo:** ricerca multi-agente su 4 angoli indipendenti (API Google Photos · termini d'uso e attrito di conformità · percorso Apple/iOS · canali alternativi), ogni claim portante passato a **due refutatori con lenti diverse** (*"è obsoleta?"* e *"è praticabile per noi?"*), più un critico di completezza. 29 agenti, 0 errori.

> ⚠️ **QUESTO DOCUMENTO SCADE.** Le API qui esaminate cambiano in fretta: la Google Photos Library API è passata da "leggi tutta la libreria" a "morta per le app terze" in **dodici mesi**. Ogni affermazione è vera **al 2026-07-26** e va riverificata prima di costruirci sopra. Dove la fonte è più vecchia della verifica, è detto.

---

## 0. Domanda di partenza

*I titolari fanno le foto col telefono, o le ricevono dal fotografo via WhatsApp. Su Android finiscono in Google Photos, su iOS in iCloud. Possiamo far "collegare" quei servizi e importarle?*

**Risposta breve: sì, è fattibile — ma non nella forma immaginata, e la forma che funziona è più semplice.**
Il "collegamento" della libreria non esiste più (Google) o non è mai esistito (Apple). Ma **il picker di sistema del telefono raggiunge già entrambe le librerie cloud**, tramite un normale campo di upload, senza OAuth e senza approvazioni.

---

## 1. Esito per canale

| Canale | Verdetto | Ri-ospitabile? | Attrito di approvazione |
|---|---|---|---|
| **Upload diretto da telefono** | ✅ **La strada** | Sì (sono byte nostri) | **Nessuno** |
| Google Photos **Picker API** | ⚠️ Possibile, ma non è "collega l'account" | **Contestato** (§4) | Verifica *sensitive*, **niente CASA** |
| Google Photos **Library API** | ❌ Morta per le app terze dal 2025-03-31 | — | — |
| **iCloud Photos** (qualsiasi via) | ❌ **Non esiste** | — | — |
| **Google Business Profile** media | ❌ Vietato dalle policy | **No** | Alto (approvazione manuale) |
| **Instagram** | ⚠️ Possibile, attrito alto | Conflitto con obblighi di cancellazione | App Review + Business Verification |
| **WhatsApp Cloud API** (inbound) | ✅ Sottovalutato — vedi §6 | Sì | Business Verification |
| **Web Share Target** (PWA) | ✅ Sottovalutato — vedi §6 | Sì | **Nessuno** |

---

## 2. iCloud Photos: la strada non esiste

Non è "difficile" né "da rivalutare più avanti": **non c'è**, e la conclusione poggia su fonti 2026, non su un thread vecchio.

- **PhotoKit** — matrice di disponibilità ufficiale: iOS/iPadOS/Mac Catalyst/macOS/tvOS/visionOS/watchOS, linguaggi **Swift e Objective-C**. Nessun target web o server-side. `PHPickerViewController` non è deprecato ma resta nativo.
- **CloudKit / CloudKit JS** — accede **solo ai container della tua app** («*By organizing apps in containers, CloudKit ensures each app is siloed*»). iCloud Photos non è un container di terze parti e non è indirizzabile.
- **DMA** — è la prova migliore, perché l'art. 6(9) sulla portabilità era la leva legale che avrebbe potuto forzare una Photos API: l'ambito di conformità dichiarato da Apple si limita ai **dati account App Store** e all'attività di installazione. Le foto non ci sono.
- **WWDC26** (giugno 2026) e il developer news fino al 2026-07-09: nessun annuncio di Photos API web/server.
- **iCloud Shared Albums** — esiste un endpoint **non documentato** (`p{N}-sharedstreams.icloud.com/{token}/sharedstreams/webstream`) usato da librerie di scraping. Bloccato da CORS lato browser, quindi solo server-side; la libreria di riferimento ha in changelog una fix «*caused by Apple*», ultimo push **ottobre 2024**. **Da scartare.**
- I tool che ci riescono (`icloudpd`, `icloud-photos-sync`) si autodichiarano *reverse engineered* e pretendono di **attivare "Access iCloud Data on the Web" e disattivare Advanced Data Protection**. Inaccettabile da chiedere a un ristoratore.

> **Un bottone "Collega iCloud Photos" non è implementabile, né oggi né come roadmap credibile.**

---

## 3. Google Photos: cosa è morto e cosa resta

**Morto il 2025-03-31.** Gli scope `photoslibrary.readonly`, `photoslibrary.sharing` e `photoslibrary` sono stati **rimossi** — non ristretti: «*API calls relying only on these scopes will return a 403 PERMISSION_DENIED after March 31, 2025*». Gli scope Library superstiti (`photoslibrary.appendonly`, `.readonly.appcreateddata`, `.edit.appcreateddata`) vedono **solo i contenuti creati dalla nostra app**. Non esiste waiver, allowlist, partner program, verifica OAuth o CASA che riporti la lettura della libreria: **la capacità è stata rimossa dall'API**. Anche la **Data Portability API** (via DMA, quindi rilevante per IT/ES) **non copre Google Photos**.

**Resta il Picker.** `photospicker.mediaitems.readonly`: l'utente apre il picker di Google, «*can browse their library and select the photos and videos they want to share*», e riceviamo **solo gli item scelti in quella sessione**. Non è "collega il tuo account": è un file-picker ospitato da Google.

Vincoli operativi verificati:

- I `baseUrl` valgono **~60 minuti** e richiedono header `Authorization` col bearer OAuth → **dobbiamo scaricare i byte entro la finestra**. Compatibile col nostro modello (ingest → R2).
- `Session.expireTime`: «*Time when access to this session (and its picked media items) will expire*» → **gli ID dei media scelti non sono handle durevoli**. La vecchia regola "salva l'ID e ri-chiedi un baseUrl fresco" apparteneva alla Library API ed è morta con essa.
- Quote larghe e **gratuito**: 100.000 richieste/minuto per progetto, 1.000.000 per i byte.
- UX: il flusso è progettato attorno al mostrare il `pickerUri` (anche come QR code) — da telefono significa **esci da Belora → scegli in Google Photos → torna**, con polling. Goffo ma percorribile. Nessuna segnalazione sostanziata di rottura su browser mobile: **non provato, non smentito**.

---

## 4. I termini d'uso: una contraddizione che NON è stata risolta

**Questa sezione non ha un verdetto. Due refutatori indipendenti sullo stesso claim hanno concluso l'opposto, e la loro divergenza non è stata arbitrata.** È registrata così apposta: un falso "via libera" qui costerebbe più dell'incertezza.

La frase decisiva — *Photos API User Data and Developer Policy*, aggiornata **2025-08-28**:

> *"Do not use Google Photos APIs to store or serve media such as photos or videos that are not of a personal nature. For storing internal enterprise data or **hosting website media**, consider using Google Cloud Storage instead."*

- **Lettura restrittiva:** Google nomina *letteralmente* «hosting website media» fra gli usi da non fare con queste API → il caso Belora è escluso.
- **Lettura permissiva:** il divieto è usare **Photos come host/CDN**; Belora importa una volta e ospita sul **proprio** object storage — cioè esattamente ciò che la seconda frase raccomanda. Rafforzata dal carve-out *«except for user-initiated export transfers»* e dal caso d'uso approvato *«exporting»*.

Accanto, i **Google APIs ToS §5.e** («*Unless expressly permitted by the content owner or by applicable law…*» → niente «*create permanent copies*» né «*publicly display*») hanno una **deroga del titolare del contenuto**, che nel nostro caso è l'utente stesso. La policy specifica di Photos, invece, non ha deroga equivalente.

**Un muro è caduto.** Il limite dei **60 minuti sulla cache dei byte** è preceduto nella documentazione dal callout *«Note: For the Library API only»* — **non vincola il Picker**. Uno dei due verificatori l'aveva visto, l'altro no; il critico ha arbitrato leggendo la pagina.

**Attrito di verifica: più basso del temuto.** `photospicker.mediaitems.readonly` **non compare** nell'elenco ufficiale degli scope *restricted* (Gmail, Drive, Fit, Chat, Data Portability, Photos Ambient, Health) → **nessuna security assessment CASA**, nessun audit annuale a pagamento. Resta la verifica *sensitive*: homepage pubblica, privacy policy sullo stesso dominio, dominio verificato in Search Console, video demo YouTube unlisted, giustificazione dello scope; ~10 giorni + 2-3 di brand verification. È compliance documentale, non ingegneria di sicurezza: **un fondatore solo con una SRL italiana la passa**.

### Due test che chiudono la questione in mezz'ora (non eseguiti)

1. Creare un progetto GCP usa-e-getta, aggiungere lo scope e **leggere come Google lo classifica** nella schermata di consenso (sensitive vs restricted).
2. Inviare la richiesta di verifica OAuth **dichiarando esplicitamente** «import one-shot + ri-hosting permanente su nostro storage» e leggere la risposta.

> Quattro angoli di ricerca a tavolino, **zero test empirici**. Finché non sono fatti, la lettura restrittiva e quella permissiva restano entrambe difendibili.

---

## 5. La scoperta che ribalta la domanda: il picker di sistema

**Un normale `<input type="file" accept="image/*" multiple>` raggiunge già entrambe le librerie cloud.**

- **iOS Safari** → istanzia `PHPickerViewController` (verificato nel sorgente WebKit, `WKFileUploadPanel.mm`), cioè **la libreria iCloud Photos completa**, con `selectionLimit: 0` = **selezione illimitata**. Le foto **presenti solo nel cloud** per "Ottimizza spazio iPhone" vengono **scaricate al volo da Apple durante l'upload** — confermato da un ingegnere Apple.
- **Android Chrome** → le richieste solo-immagini/video sono reindirizzate al **photo picker di sistema**, che con **Google Photos come cloud media provider** (Android 13+) mostra anche i contenuti cloud e li scarica full-size on demand. Limite di piattaforma al numero di elementi (`MediaStore.getPickImagesMaxLimit()`), max 5.000 media grant; via Chrome non controlliamo questi parametri.

**Conseguenza:** il caricamento diretto dal telefono **è già** l'integrazione con iCloud e Google Photos, su entrambe le piattaforme, senza OAuth, senza scope, senza app review, e **senza dipendere da API che possono morire sotto siti che devono restare online per anni**. Il Picker API aggiungerebbe una cosa sola: scegliere le foto **dal desktop** senza passare dal telefono.

### La premessa iniziale era giusta: sbagliato solo il meccanismo

Le foto ricevute dal fotografo via WhatsApp:

- Il backup su cloud delle **cartelle del dispositivo** in Google Photos **non è attivo per default** → **via API non le vedremmo mai**.
- Ma finiscono **nella galleria del telefono** per default — FAQ ufficiale WhatsApp: *«WhatsApp automatically saves audio, video and photos sent to your phone. The Media visibility option is turned on by default»* → **il picker di sistema le vede**.

**Falsa per la via API, vera per la via picker.** *(Da riverificare: il default su iPhone — salvataggio nel Rullino — e se la cartella scoped-storage `…/Android/media/com.whatsapp/…` sia indicizzata dal photo picker di sistema e non solo dalle app galleria.)*

### Dettagli operativi verificati

- **EXIF**: l'upload da iOS **rimuove la geolocalizzazione** (bene per un sito pubblico → **nessuna feature "rileva l'indirizzo dalla foto"**), ma conserva timestamp, modello, nome file e orientamento da iOS 16.4.1.
- **HEIC**: la conversione la fa `NSItemProvider`, non Safari; il picker espone all'utente *Opzioni → FORMATO: Automatico / Attuale / Più compatibile*. **`accept` non è una leva affidabile**: dobbiamo attenderci HEIC e convertire lato server. Nota: `sharp` oggi è solo un `override` in `package.json`, **non una dipendenza dichiarata** — stessa lezione di **P1-D14** sulla phantom dependency.

---

## 6. Due canali sottovalutati

**WhatsApp Cloud API (inbound).** Tecnicamente funziona e costa quasi nulla: webhook, `GET /{media-id}`, URL valido **5 minuti**, media id **7 giorni**, immagini fino a **5 MB**; i messaggi non-template dentro la finestra di 24 ore sono **gratuiti**. La clausola AI di Meta del **15/01/2026** ci impatta poco (uso *ancillary*) e ha un **carve-out che copre Italia e Spagna ma non il resto del LATAM** — da chiarire per MX/CO/AR prima di contarci. Il flusso *«manda le tue foto a questo numero»* è **l'unico identico su Android e iOS** e il titolare lo capisce senza istruzioni. Costo: Business Verification, un numero, un ingest da presidiare.

**Web Share Target (PWA).** Una PWA installata può essere **destinazione di condivisione** e ricevere più file immagine (`POST`, `multipart/form-data`, entry `files`). Il gesto è quello che il titolare già conosce: apre WhatsApp o Google Photos → seleziona → **Condividi → Belora**. Zero OAuth, zero review, zero picker esterno. Marcata *«Limited availability»*: forte su Android — **dove sta il mercato LATAM** — assente su Safari iOS. Richiede manifest, prompt d'installazione e un endpoint POST: **decisioni architetturali che non si aggiungono a posteriori**.

---

## 7. Google Business Profile: vietato, e il rilievo tocca P1.x

Gli endpoint media **esistono e sono vivi**: `GET/POST https://mybusiness.googleapis.com/v4/{parent=accounts/*/locations/*}/media`, scope `business.manage`. **Non sono deprecati** — non compaiono nella deprecation schedule e la v4 riceve ancora feature fino al **2026-07-24**. *(La prima ricerca aveva letto la sidebar di navigazione come una tabella di deprecation: errore corretto dai refutatori.)*

Ma le **Business Profile API Policies vietano esattamente l'uso che ce ne faremmo**:

> *"You cannot pre-fetch, cache, index, or store any content provided through the Business Profile APIs (Content) for use outside of your Business Profile project except for limited amounts of Content"* — con eccezione solo *"to improve the performance of your project"* e *"temporarily for no more than 30 days"*.

In più: le API **non sono pubbliche** («*Users have to request access*»), l'approvazione è manuale e pretende una **nostra** scheda GBP verificata e attiva da **60+ giorni**, con quota **0 QPM** fino all'ok.

> **Le foto GBP non sono ri-ospitabili.** E poiché la clausola dice *«any content»*, **il rilievo va oltre le foto**: il piano **P1.x** di importare orari, indirizzo e recensioni da GBP va riletto contro questa policy **prima** di prometterlo — è il differenziatore #4 della visione.

**Da evitare** anche la scorciatoia Places API per le foto: stessi vincoli di attribuzione e conservazione, contenuto non del titolare.

**Instagram**: leggibile solo con *Instagram API with Instagram Login* su account professional; servendo clienti terzi serve **Advanced Access** = App Review + Business Verification. Conflitto sostanziale fra gli obblighi di cancellazione dei Meta Platform Terms e un sito pubblico che resta online per anni. **Pagina Facebook**: stesso costo di review, materiale mediamente peggiore.

---

## 8. Il rischio di conversione più grande — e non era in nessun angolo

Il titolare arriva da un **link WhatsApp** e apre la pagina in un **browser in-app** (webview di WhatsApp, Instagram, Facebook), non in Chrome o Safari. Il comportamento di `<input type="file" multiple accept="image/*">` nelle webview in-app è **notoriamente irregolare e non è stato verificato da nessuna fonte, su nessuna piattaforma**.

Se si rompe, **si rompe in silenzio**, esattamente nello scenario più probabile per Belora — e in LATAM, dove Android supera l'80% e l'ingresso via WhatsApp è la norma, è lo scenario **dominante**.

> **Test su dispositivo reale, obbligatorio prima di P4**: webview WhatsApp e Instagram, su Android e iOS. Con fallback dichiarato (istruzione *"apri in Chrome/Safari"*, oppure proprio l'ingest via WhatsApp).

Altri fattori LATAM mai considerati: la fine dello storage illimitato di Google Photos (2021) ha spinto molti a **spegnere il backup** — il che indebolisce ulteriormente Google Photos come sorgente; dispositivi Android Go e Android vecchi dove il modulo photo picker è backportato o assente; connessioni a consumo, dove 20 foto full-res da 4-8 MB sono un costo reale e un tasso di abbandono.

---

## 9. Cosa la ricerca NON ha coperto — e che vale comunque

Quattro angoli su *"possiamo prendere le foto?"*, **zero** su *"cosa ci obbliga a fare il fatto di ospitarle"*. Questi rischi **esistono anche nello scenario raccomandato** (upload diretto) e sono **requisiti di P4**, non opzioni:

1. **Superficie d'attacco dell'ingest** — decompression bomb; CVE dei decoder HEIC/AVIF/WebP nella pipeline di conversione; **SVG servito da R2 = XSS stored sul dominio del cliente**; file polyglot e MIME sniffing. È il rischio introdotto *proprio* da "accetta `image/*` e normalizza lato server".
2. **DSA** — pubblicando contenuti forniti da terzi, Belora è un **servizio di hosting**: notice-and-action (art. 16), punto di contatto, informativa sulle restrizioni nei termini. **Obbligo di legge in Italia e Spagna.**
3. **Moderazione e takedown** di contenuti illeciti caricati dal cliente.
4. **Retention e cancellazione**: il cliente smette di pagare o revoca il consenso — chi cancella, entro quanto, cosa resta online. Su siti che restano su per anni è il debito che poi non si chiude più.
5. **Diritto d'autore e d'immagine** — la foto del fotografo **non è del cliente** salvo cessione (artt. 88 e 96-97 L. 633/1941), e i terzi ritratti hanno un diritto proprio. Serve una conferma **esplicita e per-foto**, non un consenso globale sepolto nei termini.
6. **Costi e abusi su R2** (hotlinking, egress) e mappatura di Cloudflare come **sub-processor GDPR**.

---

## 10. Raccomandazione

1. **P4 costruisce l'upload diretto come percorso primario**, ottimizzato per il telefono. Non è un ripiego: è l'unico percorso che copre iOS e Android, non chiede approvazioni, e non può essere revocato da un provider.
2. **Prima di progettarlo**, eseguire i **tre test su dispositivo reale**: (a) input file nelle webview in-app; (b) default di salvataggio WhatsApp su iPhone; (c) foto WhatsApp visibili nel photo picker di sistema Android.
3. **Poi**, se serve il percorso desktop, valutare la **Picker API** — dopo i due test da mezz'ora del §4 che chiudono l'ambiguità sui termini.
4. **WhatsApp inbound e Web Share Target** vanno valutati come **canali primari alternativi**, non come esperimenti: coprono il gesto che il titolare già conosce. Il secondo va deciso presto perché tocca il manifest della PWA.
5. **GBP e Instagram** restano fuori dal percorso foto. Per **P1.x**, rileggere la policy GBP contro l'import dei *dati* prima di confermare il differenziatore #4.
6. **I requisiti del §9 sono parte di P4**, non un'appendice: sicurezza dell'ingest, DSA, moderazione, retention, diritti.

---

## 11. Cosa cambia per P2 — quasi nulla, ed è il punto

P2 genera i mockup e **non fa ingest di media**. L'unica conseguenza è che il **documento di sito** nasce con lo **slot immagine tipato per sorgente** (`theme-placeholder` in v1, `uploaded` da P4), così P4 riempie uno slot esistente invece di riaprire il contratto del documento. Vedi `docs/superpowers/specs/2026-07-26-p2-generation-design.md` §5.

`photo_ref` proveniente da `fromUrl` **non diventa mai un `src`** in v1: resta un URL di terzi, e mantenerlo fuori dal rendering conserva vera e significativa l'asserzione end-to-end *"nessuna richiesta di rete verso host fuori allowlist"*.
