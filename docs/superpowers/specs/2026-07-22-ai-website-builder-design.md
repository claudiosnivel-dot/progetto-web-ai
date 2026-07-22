# AI Website Builder — Documento di Design & Strategia (V1)

> **Nome in codice (provvisorio):** Belora · **Data:** 2026-07-22 · **Stato:** design & strategia approvati per la stesura; blueprint tecnico (via skill *trueline*) in fase successiva.
> **Autore del progetto:** fondatore non tecnico, costruisce con Claude Code → priorità a tecnologie *managed*, bassa manutenzione, task atomici, scelte robuste.
> **Deliverable di questa sessione:** SOLO questo documento (nessun codice). I numeri di mercato provengono da una ricerca multi-agente del 2026-07-22 con verifica avversariale dei prezzi.

---

## 0 · Indice

1. Visione in una frase
2. Il "wedge" competitivo (perché vinciamo)
3. Panorama competitivo & gap da attaccare
4. ICP, mercati e lingue
5. Prodotto core V1 — flusso, motore, editor, media, onboarding
6. Scomposizione in 10 sotto-progetti + ordine di costruzione
7. Modello di business — pricing, crediti, add-on, funnel
8. Pagamenti — strategia a fasi (IT/ES → LATAM)
9. Architettura tecnica & hosting
10. Go-to-market — vetrina, blog, SEO/GEO, roadmap
11. Naming — shortlist e raccomandazione
12. Rischi, conformità e vincoli 2026
13. Metriche di successo (KPI)
14. Roadmap delle versioni (V1 → V3)
15. Prossimi passi

---

## 1 · Visione in una frase

**Una piattaforma AI che trasforma il nome di un'attività locale in un sito web bellissimo, trovabile e pronto a convertire — in pochi minuti, senza scrivere una riga né saper "organizzare un sito".** Un "Wix migliore" dove la bellezza è *garantita* (non lasciata al caso) e il prodotto parla la lingua e i prezzi dei mercati IT/ES/LATAM.

Ambizione di lungo periodo: dai siti vetrina (V1) alle intere piattaforme web professionali, incluso l'e-commerce (V3+).

---

## 2 · Il "wedge" competitivo (perché possiamo vincere)

La ricerca su 15 competitor conferma una spaccatura netta del mercato:

- **Chi è facile da usare** (Durable, Hostinger, GoDaddy Airo, 10Web) → produce siti **generici, quasi identici, facili da rovinare**.
- **Chi ha alto potenziale estetico** (Framer, Webflow, editor di Squarespace) → **richiede competenze da designer** e può comunque produrre risultati brutti.
- **Nessuno garantisce un risultato bello a un non-designer.**

I nostri **8 differenziatori difendibili** (tutti "buchi" reali del mercato):

1. **Bellezza garantita ("always-beautiful")** — motore a blocchi premium + temi con vincoli di qualità: risultati brutti *strutturalmente impossibili*. È il cuore del posizionamento.
2. **Scelta tra 5 mockup** — nessun competitor lo fa. Wix/Durable/Hostinger generano *un* sito da rigenerare alla cieca; Squarespace guida *un* percorso. "Scegli il tuo preferito tra 5" dà controllo senza competenze.
3. **WhatsApp-first** — in LATAM la penetrazione WhatsApp supera il 90% e il 72% dei consumatori ha comprato via messaggistica; è un canale da ~$18B in crescita ~35%/anno. Tutti i competitor lo trattano come widget di terze parti. Noi lo rendiamo la **CTA di conversione primaria** (con flussi a scopo definito: prenota/ordina/contatta).
4. **Auto-import Google Business Profile + Instagram** — i competitor al massimo *embeddano* widget; nessuno **importa** orari, foto, recensioni, menu e post per popolare il sito. Elimina la frizione #1 (inserire i contenuti).
5. **Localizzazione IT/ES/LATAM vera** — GoDaddy Airo è solo US/Canada; Durable/B12/Framer sono English-centric; IONOS è solo UE. Prodotto e copy nativi in italiano e spagnolo, con default per-paese.
6. **Prezzi PPP (adeguati al potere d'acquisto)** — tutti usano prezzi flat in USD (o intro-scontato-poi-rincaro). Prezzi income-adjusted per MX/CO/AR/CL/PE/ES sono insieme una storia di equità e un enorme vantaggio di prezzo.
7. **SEO locale integrata** — debole o assente ovunque, specie in non-inglese. Noi la costruiamo dentro ogni sito generato.
8. **Zero bill-shock** — niente prezzi civetta che raddoppiano al rinnovo (Hostinger/IONOS/GoDaddy) né crediti opachi (Lovable/v0/Bolt). Prezzo trasparente, flat, PPP.

Sintesi del wedge: **"da nome dell'attività a sito bellissimo, popolato e pronto a convertire — con zero digitazione"**, combinando import GBP/IG + 5 mockup + WhatsApp CTA.

---

## 3 · Panorama competitivo & gap (sintesi)

| Competitor | Categoria | Approccio generazione | Prezzo (verificato 2026, USD/annuo) | Debolezza chiave per noi |
|---|---|---|---|---|
| **Wix** (AI Builder + Studio) | Mainstream all-in-one | Template + block assembly | Light $17 · Core $29 · Business $39 · Elite $159 | Qualità non vincolata, no PPP, no 5-mockup, no WhatsApp-first |
| **Squarespace** (Blueprint AI) | Design-led | Assembly guidato da combinazioni | Basic $16 · Core $23 · Plus $39 · Advanced $99 | US/EN-centrico, no LATAM, no PPP, un solo esito |
| **Framer AI** | Design-tool | Layout AI su canvas libero | Free · Basic $10 · Pro $30 · Scale $100 | Troppo per un non-designer, no verticali locali |
| **Durable** | AI-instant SMB | Block assembly limitato | Free · Launch ~$22-25 · Grow ~$85 | Layout generici quasi identici, US-centrico |
| **Hostinger AI** | Budget bundle | Template + AI copy/stock | Intro ~$2.99 → rinnovo ~$11 | Bill-shock, design generico, no PPP reale |
| **GoDaddy Airo** | AI onboarding | Template + asset AI | ~$11-24 + Airo Plus | **Solo US/Canada** (assente IT/ES/LATAM) |
| **10Web** | AI su WordPress | WP + Elementor | ~$10 · $24 · $60 | Complessità WP, no verticali locali |
| **B12** | AI + servizio umano | Assembly + team | Free · $49 · $199 | Caro, orientato ai professionisti, US/EN |
| **Webflow** | Visual dev pro | Codegen visuale | Free · $15 · $25 · Enterprise | Troppo complesso per micro-business |
| **Lovable / v0 / Bolt** | AI codegen | Codice raw da prompt | Credit/token opachi | Strumenti da sviluppatori, non turnkey |
| **Relume** | Sitemap/wireframe AI | Component assembly per designer | ~$38 · $76 | Non è un prodotto per l'utente finale |

**Prezzo "vero" in € (verificato):** Wix Light ~**€14/mese** (annuale), Core ~**€25**, Business ~€34, Elite ~€149. *(La ricerca aveva inizialmente sottostimato questi valori come €10/€20: la verifica avversariale li ha corretti. Conseguenza positiva: i nostri prezzi proposti stanno comodamente **sotto** Wix.)*

I 10 gap completi da attaccare sono elencati nell'appendice della ricerca; i più sfruttabili sono i punti 1-8 della sezione 2.

---

## 4 · ICP, mercati e lingue

- **ICP V1:** micro-imprese locali — ristoranti/bar, palestre/studi fitness, saloni/parrucchieri, artigiani, negozi di vicinato, studi professionali. Bisogno: esserci, essere belli, essere trovati, farsi contattare (WhatsApp).
- **Mercati:** Italia + Spagna (MVP) → poi LATAM (MX, CO, AR, CL, PE).
- **Lingue:** IT + ES fin dalla V1, sia nel prodotto sia nella capacità di generare siti in quelle lingue.
- **Verticali con blocchi dedicati (V1):** menu (ristorazione), corsi/orari (fitness), listino/servizi (saloni/studi), catalogo/portfolio (negozi/artigiani), tutti pre-cablati alla conversione WhatsApp.

---

## 5 · Prodotto core V1 — architettura del flusso

```
Visitatore → SITO VETRINA (demo-led)
   └─ TEASER pubblico: "scrivi il nome della tua attività" → anteprima leggera
      (modello ECONOMICO/Haiku, 0 crediti, gated con email + rate-limit anti-abuso)
         └─ Iscrizione / Pagamento
              └─ ONBOARDING guidato: wizard a step + chat AI + AUTO-IMPORT (GBP/Instagram/sito)
                   └─ GENERA 5 MOCKUP (modello TOP/Opus-Sonnet) → l'utente sceglie 1
                        └─ EDITOR inline + blocchi guidati (testi/foto/colori/font, aggiungi/riordina blocchi)
                             └─ PUBBLICA
                                ├─ ONE-PAGER      → piano FREE (badge "Made with Belora")
                                └─ MULTI-PAGINA   → piani a PAGAMENTO (no badge)
                                     └─ UPSELL: dominio custom · SEO premium · pacchetto legale/GDPR
```

**Componenti chiave:**

- **Motore di generazione** = **libreria di blocchi premium** (hero, servizi, menu, gallery, recensioni, mappa, contatti, FAQ…) × **temi** (colori, font, spaziature). I 5 mockup = stessi contenuti, 5 direzioni estetiche. Garantisce bellezza + varietà + velocità + editabilità, ed evita i costi/imprevedibilità del codegen libero.
- **Editor** = inline + blocchi guidati. Niente drag-and-drop pixel-libero (romperebbe i guardrail). L'utente modifica contenuti e può aggiungere/riordinare/sostituire blocchi dalla libreria.
- **Media** = fonte primaria le **foto reali** (upload o import da IG/GBP) + libreria **stock** curata; l'AI **solo** per ritocco, rimozione sfondo e sfondi/hero astratti. Mai inventare prodotti/piatti/ambienti (evita il "foto finte").
- **Onboarding** = **fusione** di wizard a step guidati (insegna la struttura al non-tecnico) + chat AI (velocità) + auto-arricchimento (magia: precompila orari, foto, recensioni, indirizzo).
- **Conversione V1** = **WhatsApp** (CTA primaria) + form contatti + Google Maps + telefono/orari. *(Prenotazioni/appuntamenti → roadmap V2.)*
- **SEO base automatica** su ogni sito: meta/OG, schema.org LocalBusiness, sitemap, hreflang IT/ES, statico e veloce. (SEO premium = add-on, vedi §7 e §10.)

---

## 6 · Scomposizione in 10 sotto-progetti + ordine di costruzione

Il progetto NON è un blueprint unico: è un ecosistema. Ogni sotto-progetto avrà il suo blueprint tecnico via *trueline*.

**🏗️ Fondamenta**
- **P0 — Piattaforma base:** account/auth, DB multi-tenant (isolamento per utente, RLS), i18n IT/ES, design system interno, impianto infrastrutturale.

**🤖 Prodotto core**
- **P1 — Onboarding** (wizard + chat + auto-import GBP/IG/sito).
- **P2 — Motore di generazione** (blocchi + temi → 5 mockup; modello economico per teaser, top per build).
- **P3 — Editor** (inline + blocchi guidati).
- **P4 — Pubblicazione & hosting** (multi-tenant, sottodominio + dominio custom, SEO base, pipeline media, legale come add-on).
- **P5 — Billing & crediti** (abbonamento + crediti + add-on; Stripe → provider LATAM).

**📣 Crescita**
- **P6 — Sito vetrina** (demo-led + ROI + confronto Wix, con teaser pubblico).
- **P7 — Blog & programmatic SEO** (guide + pagine settore×città).
- **P8 — Layer GEO** (contenuti ottimizzati per motori generativi AI).
- **P9 — Roadmap pubblica** (stato + voti/feedback + changelog).

**Ordine (per "MVP veloce"):**
`P0` → **`P1+P2` = il "wow" (intervista → 5 mockup): prototipo demo da validare per primo** → `P3` editor → `P4` pubblicazione (one-pager free / multi-page paid) → `P5` billing → `P6` vetrina con teaser → poi `P7/P8/P9` in parallelo dopo il lancio.

---

## 7 · Modello di business

### 7.1 Struttura piani (baseline UE — Italia = riferimento 1.0×; prezzo annuale come headline, mensile ~+30%)

| Piano | Prezzo UE (annuale) | Cosa include | Crediti/mese |
|---|---|---|---|
| **Free** | €0 | 1 one-pager su sottodominio, badge "Made with Belora", teaser pubblico | 5 (una tantum di benvenuto → 1 build completa) |
| **Starter** | **€9/mo** (€12 mensile) | Sito multi-pagina adattivo (~5 pagine), **no badge**, sottodominio | 30 |
| **Pro** | **€19/mo** (€24 mensile) | Pagine illimitate, motore completo, coda prioritaria, **1 add-on incluso** | 120 |
| **Studio/Agency** | **€39/mo** (€49 mensile) | Multi-sito, add-on scontati, export white-label | 400 (pool) |

**Ancoraggio:** Wix reale è €14 (Light) / €25 (Core) / €34 (Business). I nostri Starter €9 e Pro €19 stanno **sotto**, comunicando qualità superiore a prezzo migliore.

### 7.2 Add-on à-la-carte (prezzi UE, per sito; NON scalano molto col PPP → restano quasi flat globalmente)

- **SEO premium (AI)** — €6/mese *oppure* 8 crediti per riscrittura SEO completa del sito.
- **Pacchetto legale/cookie/GDPR** — €5/mese (alto valore in UE; ricorrente, non a crediti).
- **Dominio custom (rivendita)** — €15/anno (costo ~€8-10 → margine sano; il 1° anno può essere incluso nel Pro come gancio). **Entrata #2.**
- *(Roadmap: email pro/hosting, prenotazioni/appuntamenti.)*

### 7.3 Modello a crediti (semplice, low-anxiety)

- **1 credito = 1 generazione (modello TOP) di 1 variante di design di pagina ("1 mockup").**
- **Sempre GRATIS (0 crediti):** teaser pubblico, pubblicazione/spubblicazione, editing manuale di testi/foto/colori/layout, micro-modifiche (cambia foto/font/ordine), ripubblicazione.
- **Consuma crediti (solo modello TOP):** build completa dei 5 mockup = **5 crediti** (etichetta in-app: *"Genera 5 design — 5 crediti"*); rigenera 1 variante = 1; riscrittura SEO di una pagina = 1/pagina; copy AI di sezione = 1; re-layout di una nuova pagina aggiunta = 1.
- **Ricariche mensili:** Free 5 (una tantum) · Starter 30 · Pro 120 · Studio 400 (pool). **Roll-over fino a 2×** la dotazione mensile. Top-up in pacchetti tondi (es. 50 crediti) a prezzo PPP.
- **Principio:** 1 credito → 1 risultato visibile e comprensibile ("un design"), così il non-tecnico prevede la spesa senza pensare a token/modelli. I crediti non spengono mai un sito né bloccano i contenuti.
- **Nota di calibrazione:** l'esatto rapporto credito↔costo va tarato quando misureremo il costo reale di inferenza del modello TOP per build.

### 7.4 Strategia regionale (PPP)

Moltiplicatore sul prezzo UE, poi arrotondamento a prezzo psicologico locale; **fatturazione in valuta locale** dove i rail lo supportano (MXN/COP/CLP/PEN), **eccetto Argentina** (fatturare in USD/USD-indexed per l'inflazione).

| Mercato | Moltiplicatore | Starter | Pro |
|---|---|---|---|
| Italia | 1.00× | €9 | €19 |
| Spagna | ~0.95× | €8,99 | €17,99 (shave opzionale) |
| Messico | ~0.45× | ~$79-99 MXN | ~$169-199 MXN |
| Colombia | ~0.40× | ~$14.900 COP | ~$34.900 COP |
| Cile | ~0.50× | ~$4.990 CLP | ~$9.990 CLP |
| Perù | ~0.40× | ~S/ 14,90 | ~S/ 34,90 |
| Argentina | ~0.45× ma **in USD** | ~$4,99 | ~$10,99 (conversione a checkout) |

> ⚠️ Anchorare i prezzi LATAM alla **realtà di rinnovo** di Hostinger (non ai prezzi civetta a 48 mesi). Non far mai scendere il promo sotto il costo marginale del modello TOP per credito incluso. I moltiplicatori PPP sono una leva grezza da validare con A/B live sulle pagine prezzo. *(Confidenza: piani UE ALTA; moltiplicatori LATAM MEDIA.)*

### 7.5 Funnel

- **Free = one-pager** pubblicabile con badge → prodotto d'ingresso *e* motore virale (ogni sito free è pubblicità).
- **Paid = multi-pagina adattivo** + rimozione badge + dominio + add-on → il valore vero è dietro il paywall.

---

## 8 · Pagamenti — strategia a fasi

Entità europea (IT), fondatore solo non-tecnico. **Regola d'oro:** i metodi cash/voucher LATAM (OXXO, PSE, PagoEfectivo) sono **asincroni** → lo schema Supabase deve modellare uno stato `pending` e **accreditare crediti/abbonamento solo sul webhook di conferma**, mai alla creazione del checkout.

- **Fase 0 — MVP (Italia + Spagna): Stripe diretto.** Carte EEA ~1,5% + €0,25 (basse per il cap UE), Stripe Billing (+0,7%) per gli abbonamenti, PaymentIntents/Checkout per i crediti one-off; integrazione migliore in assoluto con Next.js + Supabase (SDK ufficiali, Checkout hosted, webhook → Supabase Edge Function che scrive entitlement e saldo crediti su Postgres). Aggiungere poi SEPA Direct Debit e Bizum (Spagna).
  - **Bivio (consigliato valutare):** se la fiscalità è la paura principale del fondatore, lanciare la Fase 0 su un **Merchant of Record** (Paddle o Lemon Squeezy, ~5% + $0,50 ≈ 7-8% blended). Costa ~2× il processing ma **rimuove tutta la gestione IVA/tax internazionale, fatturazione e chargeback** — spesso ne vale la pena per un solo founder non tecnico. Trade-off: gli MoR sono card-first, deboli sui metodi locali LATAM (da rivedere in Fase 2).
- **Fase 1 — LATAM leggero:** accettare carte internazionali dai clienti LATAM con Stripe/MoR (nessuna entità locale). Solo validazione domanda; strumentare i tassi di decline per paese.
- **Fase 2 — LATAM serio (quando il volume lo giustifica):** le **rate ("meses sin intereses"/"cuotas")** e i rail cash (OXXO, PSE, PagoEfectivo) sono le vere leve di conversione, non catturabili con carte cross-border. Poiché non vogliamo aprire entità in 5 paesi:
  - **(A) dLocal** — *default consigliato*: una sola API/contratto per collezionare in ~40 mercati e 900+ metodi **senza entità locali**, settlement cross-border sul conto UE/USD. Contro: pricing a preventivo (~3-5% + FX), onboarding enterprise, integrazione più pesante.
  - **(B) Mercado Pago** per i top 1-2 mercati (MX, AR, CO) — self-serve, Subscriptions API nativa, miglior supporto rate; ma richiede presenza fiscale per-paese e, con rate a carico nostro, fee effettive fino a ~19% su 12-MSI (da assorbire nel pricing).
- **Nota di conformità:** Stripe per metodi locali LATAM richiede entità legale per-paese (MX: rappresentante legale + domicilio fiscale; BR: CNPJ attivo, KYC dal 27/04/2026). Brasile (Pix/Boleto) **fuori scope** finché non entra nella lista paesi.
- **Ingegneria:** mantenere un'**astrazione pagamenti provider-agnostica** (tabella `payments` con `provider` + `external_id`, handler webhook che normalizzano su eventi interni) così aggiungere dLocal/Mercado Pago non tocca il ledger crediti.

---

## 9 · Architettura tecnica & hosting

**Stack:** Next.js + **Supabase** (Postgres, Auth, Storage, RLS) — tutto managed, compatibile con *trueline*. **AI:** Claude — *Haiku 4.5* per il teaser pubblico economico, *Opus 4.8 / Sonnet* per la build dei 5 mockup; provider immagini per ritocco/rimozione sfondo/stock.

**Hosting — separare in due piani, ciascuno dove costa meno e richiede meno manutenzione:**

1. **App / Dashboard** (builder, editor, auth, billing): su **Vercel Pro** ($20/mo) per l'esperienza Next.js più turnkey (traffico basso → l'egress caro di Vercel non morde qui), *oppure* su Cloudflare per consolidare i vendor. Backend dati su **Supabase Pro** ($25/mo).
2. **Siti pubblicati dei clienti** (le migliaia di siti pubblici): **NON** servirli da Vercel/Netlify (l'egress a consumo esplode). Alla pubblicazione, **pre-renderizzare ogni sito in HTML+asset statici**, salvarli in **Cloudflare R2** ($0,015/GB storage, **egress $0**), servirli via un singolo **Cloudflare Worker/Pages**. Bandwidth gratis a qualsiasi volume; evita anche tutti i caveat di Next.js-su-Cloudflare (SSR).
3. **Domini custom su larga scala:** **Cloudflare for SaaS (custom hostnames)** — 100 hostname gratis, poi **$0,10/hostname/mese** (cap 50.000 pay-as-you-go), SSL automatico per tenant, API per add/remove. È IL prodotto per "ogni cliente sul suo dominio".
4. **Sottodomini wildcard** (`nome.belora.app`): un record DNS wildcard + un certificato wildcard → gratis e istantaneo per ogni tenant di default; il custom hostname a pagamento si attiva solo se il cliente porta il proprio dominio.
5. **LATAM:** Cloudflare ha PoP fisici a San Paolo, Rio, Città del Messico, Guadalajara e Worker a ogni PoP → bassa latenza IT/ES/LATAM senza sovrapprezzo di egress regionale (Vercel fa pagare molto di più l'egress sudamericano).

**Confronto costi a volume (indicativo, ~2 GB/mese per sito):**

| Siti pubblicati | Vercel (egress-dominato) | Cloudflare (hostname-dominato, egress $0) |
|---|---|---|
| 1.000 | ~$200-400/mo | ~$100/mo |
| 10.000 | ~$3.000-6.000/mo | ~$1.000-1.500/mo |
| 100.000 | ~$30.000-55.000/mo (+ cap domini) | ~$10.000-13.000/mo |

**Net:** serving Cloudflare-centrico + Cloudflare for SaaS + R2, dashboard su Vercel (o CF), dati su Supabase → costo marginale per sito pubblicato **~zero** (egress gratis) e ogni dominio custom un prevedibile $0,10/mese. *(Confidenza: architettura e prezzi unitari ALTA; i totali assoluti dipendono dal traffico reale per sito.)*

---

## 10 · Go-to-market

### 10.1 Sito vetrina
Angolo primario **demo-led** ("scrivi il nome → vedi l'anteprima" *prima* di iscriverti) + prova di **ROI** (più contatti/prenotazioni, trovabilità) + **confronto diretto con Wix** (qualità e prezzo). Il teaser gira su modello economico, gated (email + rate-limit) per controllare i costi API.

### 10.2 Blog & programmatic SEO (doppio)
- **Guide per titolari** (SEO informativa): "come farsi trovare su Google", "sito per ristoranti", "che foto usare"…
- **Pagine programmatiche settore×città** (IT/ES): "sito web per ristoranti a Milano", "página web para gimnasios en Madrid", "web para abogados en Bogotá".

### 10.3 GEO (Generative Engine Optimization) + SEO — playbook prioritizzato

**Parte A — Nostro sito/blog (GEO-first):**
1. **Triade Princeton (ROI più alto, evidence-backed +30-40% di visibilità AI):** ogni affermazione sostanziale ha **fonte citata**, **statistica specifica** o **citazione di esperto**. Farlo per primo.
2. **Struttura citation-friendly:** risposta diretta nei primi ~200 parole; header a domanda; blocco FAQ 6+ domande (50-150 parole l'una); tabelle di confronto; schema FAQPage/HowTo/Article + Organization/Person (autore con `sameAs`→LinkedIn).
3. **Segnali di entità/autorità:** autori reali con credenziali, byline del fondatore su pubblicazioni di settore, dati/ricerche proprietarie citabili, menzioni cross-platform (forum, Reddit, roundup).
4. **Freschezza:** "Ultimo aggiornamento" visibile, sostituire stat >18 mesi, sezioni "Cosa cambia nel 2026", refresh trimestrale.
5. **llms.txt:** pubblicarlo (costo ~zero, upside minore con Anthropic/Perplexity) ma **non** dipenderci né venderlo come leva di ranking (evidenza: nessun lift misurabile; Google non lo supporta).
6. **Misurazione prima di scalare:** GA4 su referral da chatgpt.com/perplexity.ai/gemini.google.com/claude.ai/bing.com (gratis) + tracker prompt low-cost (partire da **Otterly.AI Lite ~$25/mo**). Cadenza editoriale di riferimento ~8 articoli/mese.

**Parte B — Siti generati (programmatic local SEO, sicuro per design):**
> ⚠️ Il **Google June 2026 Spam Update** (24/06/2026) ha fatto crollare reti di pagine-località templatate in **24-48h**. La qualità è non negoziabile.
1. **Gate di qualità PRIMA dell'indicizzazione:** pubblica/sitemappa una pagina settore×città solo se ha **≥300 parole** significative, **≥60% contenuto unico**, **≥3 dati locali reali** (prezzi/tariffe locali, competitor locali nominati, normative/licenze regionali, recensioni locali reali, riferimenti a quartieri/landmark). Pagine sotto soglia → **noindex**, non pubblicazione sottile.
2. **Unicità da dati locali reali, non testo "spun":** recensioni proprie del business, prezzi reali dei servizi, fatti city-specific. Se due pagine differiscono solo per il nome della città → non generare la seconda (limita l'espansione a dove il business opera davvero — `areaServed`).
3. **Schema su ogni pagina:** LocalBusiness (NAP/geo/areaServed reali) + Service + Offer/AggregateOffer + AggregateRating/Review (solo se reali) + FAQPage + BreadcrumbList. Doppio uso: ranking locale Google **e** estrazione AI per prompt "best [settore] a [città]".
4. **Link interni:** hub-and-spoke (hub città ↔ spoke servizio×città ↔ home), 10-20 link/pagina.
5. **Ops indicizzazione:** sitemap segmentate, monitorare "Crawled - currently not indexed", risposta <200ms, Core Web Vitals, 301 per pagine morte, refresh dati >6 mesi.
6. **Aspettative:** ~6 mesi per ranking locale misurabile; validare presto via indicizzazione/engagement.

**Principio trasversale:** Google/AI non penalizzano l'automazione in sé, ma il **basso valore** "comunque prodotto". Costruire il gate di qualità *dentro* il generatore, così le pagine sottili sono strutturalmente impossibili da pubblicare.

### 10.4 Roadmap pubblica
Pubblica, con **stato feature** (fatto/in corso/prossimo) + **voti/feedback** utenti + **changelog** delle versioni → community, hype e product-feedback.

---

## 11 · Naming — shortlist e raccomandazione

> ⚠️ La disponibilità dominio indicata è **inferenza da ricerca web, NON una verifica su registrar**. Prima di decidere: verifica formale su registrar + ricerca marchi (classe 42 software).

| Nome | Perché | Fit IT/ES | Rischio |
|---|---|---|---|
| **Belora** ⭐ *(top pick)* | Coniato da "bella/bello" + finale luminoso (aurora). Evoca "siti bellissimi", premium, brandabile | be-LO-ra in entrambe, radice "bella" trasparente | Esiste "Belora Cosmetics" (India, classe cosmetici ≠ software) → search marchi |
| **Sitela** | Fonde "sito/sitio" + "stella/estela" = "un sito che brilla"; "site" incorporato è un asset | si-TE-la, "sito/sitio" trasparente | Collisioni più pulite del set; non segnala "bello/AI" da solo |
| **Belsito** | Letteralmente "bel sito" in italiano — match semantico quasi perfetto | bel-SI-to, "bel sito" immediato | Cognome/comune italiano (Calabria) → .com probabilmente preso, ostacoli marchio |
| **Miora** | Associato a "luce" e "migliore"; corto, premium | mi-O-ra naturale; in ES echeggia "mira" (guarda) | Semanticamente neutro; esiste come nome proprio |
| **Prontia** | Da "pronto" (ready/quick) → angolo "effortless in minuti" | pron-TI-a positivo in entrambe | Racconta "velocità" non "bellezza"; root "pronto" affollata |

**Raccomandazione:** **Belora** come prima scelta (evoca bellezza, premium, brandabile), con **Sitela** come alternativa più "pulita" sulle collisioni. Prossimo passo obbligato: verifica registrar `.com`/`.ai`/`.app` + check marchi UE (EUIPO) e IT/ES prima di impegnarsi.

---

## 12 · Rischi, conformità e vincoli 2026

- **Regola Meta WhatsApp (15/01/2026):** ammessi solo agenti WhatsApp **a scopo specifico** (prenota/ordina/contatta), non chatbot aperti. Progettare i flussi come "defined-purpose", non chat generica.
- **Google June 2026 Spam Update:** vedi gate di qualità §10.3-B.
- **Costo teaser pubblico:** rischio di "bruciare" API con visitatori anonimi → modello economico + gating (email/rate-limit) + teaser limitato (es. sola anteprima parziale). Da monitorare come voce di costo dedicata.
- **Calibrazione crediti↔costo:** da tarare su costi reali di inferenza del modello TOP.
- **PPP LATAM:** moltiplicatori grezzi → validare con A/B live; Argentina sempre in USD (inflazione).
- **Legale/GDPR:** venduto come add-on premium (banner cookie + privacy/cookie auto-generati, pronti GDPR/UE e adattabili a Spagna/LATAM, editabili).
- **Fatturazione asincrona LATAM:** stato `pending` + accredito solo su webhook (vedi §8).
- **Dipendenza da Google Business Profile/Instagram API** per l'auto-import: verificare limiti/termini d'uso delle API in fase di blueprint P1.

---

## 13 · Metriche di successo (KPI)

- **Attivazione:** % visitatori teaser → iscritti; % iscritti → prima build 5-mockup; tempo "nome attività → sito pubblicato".
- **Conversione:** free → paid; take-rate add-on (dominio, SEO, legale).
- **Economia:** ARPU (con add-on), costo AI per build vs crediti consumati, margine per sito pubblicato (near-zero egress su Cloudflare).
- **Ritenzione:** churn mensile per piano/mercato; siti che restano pubblicati.
- **Crescita canali:** referral AI (GA4), quota di citazioni GEO, indicizzazione pagine programmatiche, traffico blog.
- **Qualità:** % pagine programmatiche che passano il gate; soddisfazione sulla scelta dei 5 mockup.

---

## 14 · Roadmap delle versioni

- **V1 — Siti vetrina (questo documento):** IT/ES, one-pager free / multi-pagina paid, motore 5-mockup, editor inline, WhatsApp+form+mappa, SEO base, teaser demo, billing Stripe (IT/ES), hosting Cloudflare, add-on (dominio/SEO/legale).
- **V1.x:** maturità auto-import GBP/IG, pagine programmatiche, GEO layer, roadmap pubblica, ingresso LATAM leggero.
- **V2:** **prenotazioni/appuntamenti** integrati, email pro/hosting come upsell, più verticali, pagamenti LATAM seri (dLocal/Mercado Pago), prezzi PPP live.
- **V3+:** e-commerce, poi **intere piattaforme web professionali** (la visione di lungo periodo).

---

## 15 · Prossimi passi

1. **Tu rivedi questo documento** e mi dici cosa correggere/aggiungere/togliere.
2. Alla tua conferma, in sessioni successive passiamo alla **skill *trueline*** per generare, **un sotto-progetto alla volta**, il blueprint di task atomici verificabili — partendo da **P0 (fondamenta)** e poi dal **"wow" P1+P2** (intervista → 5 mockup).
3. In parallelo: verifica registrar/marchi per il nome, e decisione finale su MoR vs Stripe diretto per la Fase 0.

---

### Appendice — Provenienza dei dati
Ricerca multi-agente del 2026-07-22 (7 agenti, 116 ricerche web) con verifica avversariale dei prezzi. Fonti complete nei risultati grezzi del workflow. Livelli di confidenza indicati inline: piani UE e architettura hosting = ALTA; moltiplicatori PPP LATAM, soglie SEO programmatica e fee dLocal/EBANX = MEDIA (da validare).
