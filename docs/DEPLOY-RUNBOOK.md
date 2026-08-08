# Belora — Deploy Runbook (staging privato dietro Cloudflare Access)

> Obiettivo di questa fase: il ciclo completo (onboarding → 5 mockup → editing → pubblicazione
> `/s/<slug>` → foto) gira in **produzione su `ulaba.net`**, ma **solo l'amministratore** vi accede.
> Sblocca P5: la **misura reale del costo di generazione** e un **URL per i webhook Stripe**.
>
> Stack: **Vercel** (app) · **Supabase Cloud** (backend, regione EU) · **Cloudflare** (DNS + Access
> wall) · **Anthropic** (LLM). Non è un lancio pubblico: legale/cookie, CSP stretta, billing, e i
> siti pubblicati su Cloudflare R2 restano per il lancio / P5.
>
> **Regola d'oro sui segreti:** i valori segreti (service_role key, Anthropic key, DB password) si
> digitano SOLO dentro Supabase / Vercel / il tuo terminale. Mai in chat, mai nel repo.
>
> Le caselle **🔴 sono il MURO VERO** del pre-lancio: senza, resterebbe una porta aperta.

---

## 0. Prerequisiti (una tantum, sulla tua macchina)

- **Supabase CLI** installata (serve per applicare le migrazioni al cloud). Verifica: `supabase --version`.
  Se manca: https://supabase.com/docs/guides/cli.

---

## 1. Cloudflare — dominio (in corso)

- [ ] `ulaba.net` aggiunto a Cloudflare, **nameserver cambiati su Hostinger**
  (`lindsey.ns.cloudflare.com` / `razvan.ns.cloudflare.com`), DNSSEC OFF.
- [ ] Attendi l'email "Active" da Cloudflare.
- [ ] Cloudflare → **SSL/TLS → Overview → Full (strict)**.
- [ ] I record `A ulaba.net` e `CNAME www` restano **Proxied (nuvola arancione)**: li aggiorneremo
      con i valori di Vercel al passo 5.

L'**Access wall** si configura al passo 4 (dopo che l'app è online).

---

## 2. Supabase Cloud

### 2a. Progetto
- [ ] Crea un **nuovo progetto**, regione **EU (Frankfurt / eu-central-1)**.
- [ ] Segnati dal dashboard (Settings → API): **Project URL**, **anon public key**, **service_role
      key** (servono al passo 3). Il **Project ref** è la stringa nell'URL del progetto.

### 2b. Applica le migrazioni (dal TUO terminale, nella cartella del repo)
```bash
supabase login                       # apre il browser una volta
supabase link --project-ref <TUO_PROJECT_REF>   # chiede la DB password (dal dashboard: Settings → Database)
supabase db push                     # applica le 12 migrazioni di supabase/migrations/ al cloud
```
Atteso: le 12 migrazioni applicate in ordine (baseline → accounts → profiles → auto_provision →
sites → briefs → generations → revisions → publications → grant → assets_and_storage). Crea anche
il **bucket Storage `site-assets`** (dalla migrazione assets_and_storage).
> Se `db push` fallisce sulle policy di `storage.objects` (permessi piattaforma), apri il file
> `supabase/migrations/20260806000300_assets_and_storage.sql` e incolla le sole `create policy … on
> storage.objects` nel **SQL Editor** del dashboard.

### 2c. 🔴 Chiudi i signup pubblici (il muro dell'endpoint auth)
- [ ] Authentication → **Sign In / Providers → Email** → **"Allow new users to sign up" = OFF**.
      *(Chiude `POST /auth/v1/signup` e l'auto-provisioning: senza, chiunque abbia la anon key
      pubblica può creare un account bypassando l'app.)*

### 2d. 🔴 Invita te stesso
- [ ] Authentication → **Users → Add user → Create new user** con la **tua email** e una password.
      *(Con i signup chiusi, questo è l'unico modo per avere il tuo account.)* Questa email deve
      coincidere con quella che metti in `SIGNUP_ALLOWLIST` (passo 3) e in Cloudflare Access (passo 4).

### 2e. 🔴 Google / OAuth OFF fino al lancio
- [ ] Authentication → Providers → **Google = disabilitato** (e ogni altro provider esterno).

### 2f. URL di redirect auth
- [ ] Authentication → **URL Configuration → Site URL = `https://ulaba.net`**; aggiungi
      `https://ulaba.net/**` alle **Redirect URLs** (serve al login/callback).

---

## 3. Anthropic

- [ ] Crea/recupera una **API key** (console.anthropic.com).
- [ ] 🔴 **Imposta uno spending limit mensile** (es. **$20–50**). *È il freno di costo HARD.*

---

## 4. Vercel — app

### 4a. Progetto
- [ ] Crea account, **Import Project** dal repo GitHub `progetto-web-ai`. Framework: **Next.js**
      (auto-rilevato). Build command / output: default.

### 4b. Environment Variables (Settings → Environment Variables) — per **Production** e **Preview**
| Nome | Valore | Segreto? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL Supabase | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key | no (pubblica) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | **🔒 sì** |
| `ANTHROPIC_API_KEY` | la tua key Anthropic | **🔒 sì** |
| `NEXT_PUBLIC_SITE_URL` | `https://ulaba.net` | no |
| `SIGNUP_ALLOWLIST` | la tua email (la stessa del passo 2d) | no |
| `GENERATION_DAILY_CAP` | `20` (opzionale) | no |
> `VERCEL_ENV` la imposta Vercel da sola. **Se manca una variabile critica, la produzione non
> parte** (fail-fast voluto: `src/instrumentation.ts` → `assertProductionEnv`).

### 4c. Deploy
- [ ] Fai partire il primo deploy. Deve completare il build. (Ancora **non** raggiungibile pubblico:
      il dominio lo colleghiamo al passo 5, e il muro al passo 4d.)

---

## 5. Dominio `ulaba.net` → Vercel (via Cloudflare)

- [ ] Vercel → Project → **Settings → Domains → Add `ulaba.net`** (e `www.ulaba.net`). Vercel ti
      mostrerà i record DNS da impostare (tipicamente `A @ 76.76.21.21` e/o `CNAME www
      cname.vercel-dns.com`).
- [ ] Su **Cloudflare → DNS**: aggiorna il record `A ulaba.net` (e `CNAME www`) con i valori che
      Vercel ti indica. **Mantieni Proxied (nuvola arancione)** — serve per Access.
      *(Mandami i valori esatti che Vercel mostra e te lo confermo record per record.)*
- [ ] SSL/TLS Cloudflare già su **Full (strict)** (passo 1).

---

## 6. 🔴 Cloudflare Access — il muro sull'app

Cloudflare → **Zero Trust → Access → Applications**:
- [ ] **App A** — Add application → **Self-hosted**. Domain: `ulaba.net`, **Path vuoto** (tutta l'app).
      Policy: **Action = Allow**, Include → **Emails** → la **tua** email. (Identity provider: **One-time
      PIN** via email è il più semplice.)
- [ ] **App B** — Add application → **Self-hosted**. Domain: `ulaba.net`, **Path = `/s/*`**. Policy:
      **Action = Bypass**, Include → **Everyone**. *(I siti pubblicati restano pubblici; la dashboard no.)*
- [ ] Nota: NON impostare il cookie di Access su SameSite=Strict (loop di redirect).

*(Questi due li configuriamo insieme quando ci arrivi.)*

---

## 7. Smoke test (sei l'unico dentro) + MISURA DEL COSTO

- [ ] Da browser: apri `https://ulaba.net` → Access ti chiede l'email → login app (l'utente del passo 2d).
- [ ] Percorri: **onboarding → genera 5 mockup → scegli → edita → pubblica → apri `/s/<slug>`**.
- [ ] 🎯 **Misura il costo**: dopo una generazione da 5 mockup, guarda il consumo su **Anthropic →
      Usage**. È il dato che sblocca il pricing dei crediti di **P5**.
- [ ] Verifica il muro: da una finestra **incognito senza login**, `https://ulaba.net` deve chiedere
      Access; `https://ulaba.net/s/<uno-slug-pubblicato>` deve invece aprirsi **senza login**.
- [ ] Verifica il cap: dopo ~20 generazioni in un giorno, la 21ª deve dare 429 (best-effort; il freno
      vero è lo spend cap Anthropic).

---

## Cosa NON è in questa fase (rimandato)
- Legale / privacy / cookie (GDPR), CSP stretta, rimozione badge, billing/pagamenti → **lancio / P5**.
- Siti pubblicati su **Cloudflare R2** (egress $0) → pass hosting dedicato (P4-D1).
- **CI su GitHub**: `.github/workflows/ci.yml` gira su ogni push (typecheck · lint · build · suite ·
  knip). Dopo il primo push, controlla la tab **Actions** del repo che sia verde (abilita Actions se
  disattivata). L'e2e Playwright resta al checkpoint locale, non in CI.
