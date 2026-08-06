import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assetPublicUrl } from '@/config/storage';
import {
  adminClient,
  createTestUser,
  signInAs,
  deleteTestUser,
} from './helpers/supabase-test';

// T-412 (macrotask media-storage, P4) — RLS di SCRITTURA su storage.objects PROVATA A
// RUNTIME, a CONFINE-OWNER (EMENDAMENTO P4-D6a): sul bucket site-assets owner = auth.uid().
// L'oracolo e' il COMPORTAMENTO con client reali, sull'EFFETTO (i byte effettivamente
// memorizzati), non lo schema:
//
//  - (AC-412-3) A carica un oggetto alla propria chiave piatta kA (owner=A). B — uploader
//    legittimo del proprio kB — che tenta UPSERT o DELETE su kA e' RIFIUTATO dalla policy
//    (owner-boundary): i byte di kA restano quelli di A (oracolo sull'effetto). Le chiavi sono
//    uuid NEAR-COLLISION: B non puo' predire/scegliere la chiave di A, e un oggetto 1-char-off
//    resta un oggetto DIVERSO.
//  - (AC-412-4) l'anon che fa GET dell'URL pubblico di kA riceve 200 + i byte (trade-off
//    dichiarato P4-D6: l'oggetto e' pubblico per uuid; la RIGA assets resta privata, cfr.
//    tests/assets-rls.test.ts). L'URL e' costruito da assetPublicUrl(asset_id) (M3, P2-D12):
//    la chiave piatta = l'asset_id, quindi l'URL nasce dal SOLO id.
//
// ANTI-PLACEBO: B carica con SUCCESSO il PROPRIO kB → il diniego su kA e' un CONFINE (owner),
// non un blocco totale della scrittura. L'effetto sui byte e' letto con il client admin
// (download diretto, nessuna cache) → una eventuale sovrascrittura riuscita andrebbe ROSSA.
//
// Client di SESSIONE reali (A/B) per le scritture; anon reale per la lettura pubblica;
// service_role SOLO per l'oracolo sull'effetto e per il teardown. Asserzioni da AC-412-3/4.

const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = 'site-assets';

// NEAR-COLLISION sull'asse che controlliamo (la chiave = asset_id): condivide 35 char di
// prefisso, differisce nell'ultimo hex, resta un uuid valido.
const nearCollision = (u: string): string =>
  u.slice(0, -1) + (u.endsWith('a') ? 'b' : 'a');

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

describe.skipIf(!SB)(
  'T-412 RLS storage.objects a confine-owner — A scrive kA, B (owner del proprio kB) non tocca kA (upsert/delete rifiutati), anon legge l URL pubblico',
  () => {
    const password = 'Password123!';
    const suffisso = randomUUID().slice(0, 8);
    const emailA = `t412sa_${randomUUID()}@example.test`;
    const emailB = `t412sb_${randomUUID()}@example.test`;

    // Chiavi piatte (asset_id) NEAR-COLLISION: kA e kB condividono 35 char, tenant/owner diversi.
    const kA = randomUUID(); // oggetto di A
    const kB = nearCollision(kA); // oggetto di B (owner diverso, 1 char di differenza)

    // Byte DISCORDANTI (lunghezza e contenuto diversi): consentono di distinguere l'oggetto di
    // A da un eventuale overwrite di B.
    const bytesA = new TextEncoder().encode(`ALPHA-owner-A-${suffisso}`);
    const bytesB = new TextEncoder().encode(`BETA-owner-B-${suffisso}-DISTINCT-PAYLOAD`);

    let userAId = '';
    let userBId = '';
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;

    beforeAll(async () => {
      const a = await createTestUser(emailA, password);
      const b = await createTestUser(emailB, password);
      userAId = a.id;
      userBId = b.id;

      clientA = await signInAs(emailA, password);
      clientB = await signInAs(emailB, password);

      // Guardrail fixture: near-collision armata (prefisso condiviso, chiavi distinte).
      expect(kA).not.toBe(kB);
      expect(kB.slice(0, 35)).toBe(kA.slice(0, 35));
    }, 60_000);

    afterAll(async () => {
      // Rimuovi gli oggetti col client admin PRIMA di cancellare gli utenti (storage.objects.owner
      // riferisce auth.users): teardown pulito e idempotente.
      try {
        await adminClient().storage.from(BUCKET).remove([kA, kB]);
      } catch {
        /* best effort */
      }
      if (userAId) await deleteTestUser(userAId);
      if (userBId) await deleteTestUser(userBId);
    });

    // covers: AC-412-3
    it('A carica kA (owner=A) e B carica il proprio kB (owner=B): entrambe le scritture del PROPRIO oggetto passano — il confine-owner e un confine, non un blocco totale', async () => {
      const upA = await clientA.storage
        .from(BUCKET)
        .upload(kA, new Blob([bytesA], { type: 'image/png' }), { contentType: 'image/png' });
      expect(upA.error).toBeNull(); // covers: AC-412-3 — A scrive il proprio oggetto (owner=A)
      expect(upA.data?.path).toBe(kA); // covers: AC-412-3

      const upB = await clientB.storage
        .from(BUCKET)
        .upload(kB, new Blob([bytesB], { type: 'image/png' }), { contentType: 'image/png' });
      expect(upB.error).toBeNull(); // covers: AC-412-3 — B e' uploader legittimo del PROPRIO kB (anti-placebo)
      expect(upB.data?.path).toBe(kB); // covers: AC-412-3

      // ORACOLO sull'effetto: kA contiene i byte di A (download diretto admin, nessuna cache).
      const dl = await adminClient().storage.from(BUCKET).download(kA);
      expect(dl.error).toBeNull(); // covers: AC-412-3
      const stored = new Uint8Array(await dl.data!.arrayBuffer());
      expect(bytesEqual(stored, bytesA)).toBe(true); // covers: AC-412-3
    });

    // covers: AC-412-3
    it('B che tenta UPSERT sulla chiave kA di A e RIFIUTATO (owner-boundary) e i byte di kA restano quelli di A — B non puo predire ne sovrascrivere la chiave di A', async () => {
      // UPSERT forza il percorso di UPDATE sull'oggetto esistente: la policy UPDATE
      // (using owner = auth.uid()) non qualifica la riga per B (owner=A) → rifiuto.
      const attack = await clientB.storage
        .from(BUCKET)
        .upload(kA, new Blob([bytesB], { type: 'image/png' }), {
          contentType: 'image/png',
          upsert: true,
        });
      expect(attack.error).not.toBeNull(); // covers: AC-412-3 — l'UPSERT cross-owner e' rifiutato

      // ORACOLO sull'effetto (autoritativo): kA e' ANCORA i byte di A, non quelli di B.
      const dl = await adminClient().storage.from(BUCKET).download(kA);
      expect(dl.error).toBeNull(); // covers: AC-412-3
      const stored = new Uint8Array(await dl.data!.arrayBuffer());
      expect(bytesEqual(stored, bytesA)).toBe(true); // covers: AC-412-3 — nessuna sovrascrittura
      expect(bytesEqual(stored, bytesB)).toBe(false); // covers: AC-412-3 — il payload di B non e' entrato
    });

    // covers: AC-412-3
    it('B che tenta DELETE della chiave kA di A non rimuove l oggetto: kA resta scaricabile e con i byte di A (owner-boundary sul DELETE)', async () => {
      // La policy DELETE (using owner = auth.uid()) non qualifica kA per B → nulla rimosso.
      await clientB.storage.from(BUCKET).remove([kA]);

      // ORACOLO sull'effetto: kA esiste ancora e ha i byte di A (il remove di B e' stato un no-op).
      const dl = await adminClient().storage.from(BUCKET).download(kA);
      expect(dl.error).toBeNull(); // covers: AC-412-3 — kA non e' stato cancellato da B
      const stored = new Uint8Array(await dl.data!.arrayBuffer());
      expect(bytesEqual(stored, bytesA)).toBe(true); // covers: AC-412-3
    });

    // covers: AC-412-4
    it('anon che fa GET dell URL pubblico di kA riceve 200 + i byte (bucket public=true, trade-off P4-D6); l URL nasce dal SOLO asset_id (assetPublicUrl, P2-D12)', async () => {
      // URL costruito da assetPublicUrl(asset_id): la chiave piatta E' l'asset_id → l'indirizzo
      // nasce dal solo id (mai da testo libero, P2-D12).
      const url = assetPublicUrl(kA);
      expect(url).toContain(`/storage/v1/object/public/${BUCKET}/${kA}`); // covers: AC-412-4 — forma canonica

      // fetch ANON (nessun header di auth): la lettura pubblica e' data dal flag public=true del
      // bucket, non da una policy anon su storage.objects.
      const res = await fetch(url, { cache: 'no-store' });
      expect(res.status).toBe(200); // covers: AC-412-4 — 200 pubblico
      const body = new Uint8Array(await res.arrayBuffer());
      expect(bytesEqual(body, bytesA)).toBe(true); // covers: AC-412-4 — i byte dell'oggetto di A
    });
  },
);
