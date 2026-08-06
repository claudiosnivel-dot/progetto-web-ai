import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { type SupabaseClient } from '@supabase/supabase-js';
import { adminClient, createTestUser, signInAs, deleteTestUser } from './helpers/supabase-test';
import { MEDIA_LIMITS } from '@/domain/media/limits';
import { ALLOWED_RASTER_MIME } from '@/domain/media/sniff';

// T-413 (macrotask media-storage, P4) — uploadAsset PROVATA SULL'EFFETTO (i byte effettivamente
// memorizzati e la riga assets scritta), non sull'intenzione. Come le altre azioni runtime del
// repo mockiamo SOLO la costruzione del client SSR (createServerSupabaseClient, che dipende dai
// cookie di next/headers non disponibili in node) con un client ad AUTH REALE (signInAs → JWT,
// ruolo authenticated, RLS attiva): sniff, cap, re-encode sharp, Storage e insert di assets girano
// per intero contro il Supabase locale. La service_role compare SOLO come ORACOLO INDIPENDENTE
// (download dell'oggetto, rilettura della riga) e nel setup delle fixture, mai dentro l'azione.
//
// Fixture OSTILI DISCORDANTI (payload multipli, uno per AC): un JPEG con EXIF (GPS+orientamento+
// commento), un SVG con <script>, un polyglot HTML con mime png falsificato, un bomb in pixel e uno
// in byte, un polyglot con header immagine valido e coda appesa, e un sito NON posseduto. Le
// immagini di fixture sono generate con sharp nel setup. Un solo sign-in (A, owner): il sito altrui
// e' di B, creato via service_role, mai impersonato — l'ownership la nega la RLS, non un secondo login.
//
// Asserzioni da AC-413-1..6.

const SB = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BUCKET = 'site-assets';

// Holder mutabile: l'azione gira col client iniettato qui (sempre A in questo file; per il caso
// "sito altrui" resta A ma il target e' il sito di B → la RLS filtra).
const { clientHolder } = vi.hoisted(() => ({
  clientHolder: { current: null as SupabaseClient | null },
}));

vi.mock('@/data/supabase-ssr', () => ({
  createServerSupabaseClient: async () => clientHolder.current,
}));

// Import DOPO il mock (vi.mock e' hoisted).
import { uploadAsset } from '@/data/media/uploadAsset';

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const includesBytes = (haystack: Uint8Array, needle: Uint8Array): boolean =>
  Buffer.from(haystack).includes(Buffer.from(needle));

type Esito = Awaited<ReturnType<typeof uploadAsset>>;

describe.skipIf(!SB)('T-413 uploadAsset — sniff magic-bytes + re-encode sharp (strip EXIF, reject SVG, resize), provata sull effetto', () => {
  const password = 'Password123!';
  const suffisso = randomUUID().slice(0, 8);
  const emailA = `t413a_${randomUUID()}@example.test`;
  const emailB = `t413b_${randomUUID()}@example.test`;

  let userAId = '';
  let userBId = '';
  let accountAId = '';
  let accountBId = '';
  let siteAId = '';
  let siteBId = '';
  let clientA: SupabaseClient;

  // Marker di testo unici: se compaiono nei byte di OUTPUT, un metadato/payload NON e' stato strippato.
  const exifComment = `EXIF-PAYLOAD-${suffisso}`;
  const appendedMarker = `APPENDED-${suffisso}-PAYLOAD`;

  // Le fixture ostili, generate nel setup.
  let jpegWithExif: Uint8Array; // (1) EXIF: GPS + orientamento + commento
  let svgWithScript: Uint8Array; // (2) SVG con <script>
  let fakePng: Uint8Array; // (3) polyglot HTML, mime dichiarato image/png
  let pixelBomb: Uint8Array; // (4a) piccola in byte, enorme in pixel
  let byteBomb: Uint8Array; // (4b) header jpeg valido, oltre il cap di byte
  let polyglotAppended: Uint8Array; // (5) PNG valido + coda appesa
  let plainJpeg: Uint8Array; // (6) jpeg pulito per il caso "sito altrui"

  // asset_id creati con successo: rimossi dallo Storage nel teardown.
  const createdAssetIds: string[] = [];

  // Righe assets di un sito (ORACOLO service_role, RLS bypassata).
  const assetsForSite = async (siteId: string) => {
    const { data, error } = await adminClient()
      .from('assets')
      .select('id, account_id, site_id, storage_path, mime, width, height')
      .eq('site_id', siteId);
    if (error) throw error;
    return data ?? [];
  };

  const countAssets = async (siteId: string): Promise<number> => (await assetsForSite(siteId)).length;

  // Scarica i byte effettivamente memorizzati (admin, nessuna cache): l'oracolo sull'effetto.
  const downloadObject = async (assetId: string): Promise<Uint8Array> => {
    const dl = await adminClient().storage.from(BUCKET).download(assetId);
    if (dl.error) throw dl.error;
    return new Uint8Array(await dl.data!.arrayBuffer());
  };

  const fileOf = (bytes: Uint8Array, name: string, type: string): File =>
    new File([new Uint8Array(bytes)], name, { type });

  beforeAll(async () => {
    const a = await createTestUser(emailA, password);
    const b = await createTestUser(emailB, password);
    userAId = a.id;
    userBId = b.id;

    const admin = adminClient();
    const { data: accs } = await admin
      .from('accounts')
      .select('id, owner_id')
      .in('owner_id', [userAId, userBId]);
    accountAId = (accs ?? []).find((r) => r.owner_id === userAId)!.id as string;
    accountBId = (accs ?? []).find((r) => r.owner_id === userBId)!.id as string;

    // Un sito per tenant (slug per-account, namespacizzati). siteB e' il "sito altrui": creato via
    // service_role, MAI impersonato — l'ownership la nega la RLS.
    const { data: siteA, error: eA } = await admin
      .from('sites')
      .insert({ account_id: accountAId, name: 'A media', slug: `media-a-${suffisso}` })
      .select('id')
      .single();
    if (eA) throw eA;
    siteAId = siteA!.id as string;
    const { data: siteB, error: eB } = await admin
      .from('sites')
      .insert({ account_id: accountBId, name: 'B media', slug: `media-b-${suffisso}` })
      .select('id')
      .single();
    if (eB) throw eB;
    siteBId = siteB!.id as string;

    // Un solo sign-in (rate limit auth): A, l'owner. B non fa login.
    clientA = await signInAs(emailA, password);

    // ── generazione delle fixture ostili con sharp ─────────────────────────────
    // (1) JPEG con EXIF reale: orientamento + un commento con payload testuale (incl. coordinate
    //     GPS come dato personale) + campi identificativi. L'API tipata di sharp scrive tag sotto
    //     IFD0; l'effetto provato a valle e' che TUTTO questo blocco EXIF sparisce dall'output.
    jpegWithExif = new Uint8Array(
      await sharp({ create: { width: 120, height: 90, channels: 3, background: { r: 200, g: 40, b: 40 } } })
        .jpeg()
        .withExif({
          IFD0: {
            Orientation: '6',
            ImageDescription: `${exifComment} GPS:41.9028,12.4964`,
            Software: 'BeloraTest',
            Artist: `owner-${suffisso}`,
            Copyright: `(c) ${suffisso}`,
          },
        })
        .toBuffer(),
    );

    // (2) SVG ben formato con <script> (XSS stored se rasterizzato/servito come tale).
    svgWithScript = new Uint8Array(
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">` +
          `<script>window.__pwn_${suffisso}=1</script>` +
          `<rect width="64" height="64" fill="#0f0"/></svg>`,
      ),
    );

    // (3) Polyglot HTML/JS con mime DICHIARATO image/png ma magic-bytes non-immagine.
    fakePng = new Uint8Array(
      Buffer.from(`<!doctype html><html><script>alert('${suffisso}')</script></html>`),
    );

    // (4a) Bomb in PIXEL: tinta piatta → pochi byte, ma width*height oltre il cap.
    const bombW = 7000;
    const bombH = 6000; // 42 MP > MEDIA_LIMITS.maxInputPixels (40 MP)
    pixelBomb = new Uint8Array(
      await sharp({ create: { width: bombW, height: bombH, channels: 3, background: { r: 10, g: 240, b: 10 } } })
        .png()
        .toBuffer(),
    );

    // (4b) Bomb in BYTE: header jpeg valido su un buffer oltre il cap di byte.
    byteBomb = new Uint8Array(MEDIA_LIMITS.maxInputBytes + 16);
    byteBomb.set([0xff, 0xd8, 0xff], 0);

    // (5) Polyglot: PNG valido + coda appesa con payload/script.
    const basePng = await sharp({
      create: { width: 80, height: 60, channels: 3, background: { r: 20, g: 20, b: 220 } },
    })
      .png()
      .toBuffer();
    polyglotAppended = new Uint8Array(
      Buffer.concat([basePng, Buffer.from(`<script>steal()</script>${appendedMarker}`)]),
    );

    // (6) JPEG pulito per il caso "sito altrui" (nessun difetto: il rifiuto e' l'ownership, non il file).
    plainJpeg = new Uint8Array(
      await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 90, g: 90, b: 90 } } })
        .jpeg()
        .toBuffer(),
    );

    // ── guardrail delle fixture (anti-placebo): senza questi, gli output "puliti" non provano nulla ──
    // Il JPEG di fixture PORTA davvero l'EXIF con il commento (byte del marker dentro l'exif).
    const mIn = await sharp(jpegWithExif).metadata();
    expect(mIn.exif, 'la fixture JPEG dovrebbe avere un blocco EXIF').toBeInstanceOf(Buffer);
    expect(
      includesBytes(new Uint8Array(mIn.exif as Buffer), new Uint8Array(Buffer.from(exifComment))),
      'il commento EXIF dovrebbe essere presente nella fixture di ingresso',
    ).toBe(true);
    // Il bomb in pixel supera davvero il cap; il bomb in byte supera davvero il tetto di byte.
    const mBomb = await sharp(pixelBomb).metadata();
    expect((mBomb.width ?? 0) * (mBomb.height ?? 0)).toBeGreaterThan(MEDIA_LIMITS.maxInputPixels);
    expect(byteBomb.byteLength).toBeGreaterThan(MEDIA_LIMITS.maxInputBytes);
    // Il polyglot appeso CONTIENE il marker in ingresso (che l'output non deve contenere).
    expect(includesBytes(polyglotAppended, new Uint8Array(Buffer.from(appendedMarker)))).toBe(true);
  }, 60_000);

  afterAll(async () => {
    // Rimuovi gli oggetti creati PRIMA di cancellare gli utenti (storage.objects.owner → auth.users).
    if (createdAssetIds.length > 0) {
      try {
        await adminClient().storage.from(BUCKET).remove(createdAssetIds);
      } catch {
        /* best effort */
      }
    }
    // cascade: auth.users → accounts → sites → assets
    if (userAId) await deleteTestUser(userAId);
    if (userBId) await deleteTestUser(userBId);
  });

  // covers: AC-413-1
  it('un JPEG con EXIF (GPS+orientamento+commento) → oggetto salvato SENZA EXIF e riga assets con mime/width/height coerenti', async () => {
    clientHolder.current = clientA;
    const res: Esito = await uploadAsset(siteAId, fileOf(jpegWithExif, 'foto.jpg', 'image/jpeg'));
    expect(res.ok, res.ok ? '' : `atteso ok, status=${res.status}`).toBe(true); // covers: AC-413-1
    if (!res.ok) throw new Error('uploadAsset avrebbe dovuto riuscire');
    createdAssetIds.push(res.asset_id);

    // La riga assets (oracolo service_role): account/sito propri, storage_path = asset_id, mime raster.
    const rows = await assetsForSite(siteAId);
    const row = rows.find((r) => r.storage_path === res.asset_id);
    expect(row, 'la riga assets dovrebbe esistere').toBeTruthy(); // covers: AC-413-1
    expect(row!.account_id).toBe(accountAId); // covers: AC-413-1
    expect(row!.site_id).toBe(siteAId); // covers: AC-413-1
    expect(ALLOWED_RASTER_MIME).toContain(row!.mime); // covers: AC-413-1 — mime fra i raster ammessi
    expect(row!.mime).toBe('image/jpeg'); // covers: AC-413-1 — resta nella famiglia sniffata

    // L'OGGETTO salvato: decodifica come raster SENZA alcun EXIF, e i byte non contengono il commento.
    const stored = await downloadObject(res.asset_id);
    const mOut = await sharp(stored).metadata();
    expect(mOut.exif, 'l output non deve avere EXIF').toBeUndefined(); // covers: AC-413-1 — strip provato sull'output
    expect(
      includesBytes(stored, new Uint8Array(Buffer.from(exifComment))),
      'il commento EXIF non deve sopravvivere nell output',
    ).toBe(false); // covers: AC-413-1
    // width/height della riga COERENTI con i byte di output.
    expect(row!.width).toBe(mOut.width); // covers: AC-413-1
    expect(row!.height).toBe(mOut.height); // covers: AC-413-1
    expect(row!.width).toBeGreaterThan(0); // covers: AC-413-1
    expect(row!.height).toBeGreaterThan(0); // covers: AC-413-1
  });

  // covers: AC-413-2
  it('un SVG (anche con <script>) → rifiutato: nessun oggetto scritto, nessuna riga assets', async () => {
    clientHolder.current = clientA;
    const before = await countAssets(siteAId);

    const res: Esito = await uploadAsset(siteAId, fileOf(svgWithScript, 'logo.svg', 'image/svg+xml'));
    expect(res.ok).toBe(false); // covers: AC-413-2
    if (res.ok) throw new Error('un SVG non doveva essere accettato');
    expect(res.status).toBe(400); // covers: AC-413-2

    // Nessuna riga aggiunta (l'SVG cade sullo sniff, prima di generare un asset_id o scrivere).
    expect(await countAssets(siteAId)).toBe(before); // covers: AC-413-2
  });

  // covers: AC-413-3
  it('mime dichiarato image/png ma magic-bytes non-immagine (polyglot HTML/JS) → lo sniff fallisce, upload rifiutato', async () => {
    clientHolder.current = clientA;
    const before = await countAssets(siteAId);

    // Il content-type DICHIARATO e' image/png, ma i byte sono HTML: non ci si fida del mime del client.
    const res: Esito = await uploadAsset(siteAId, fileOf(fakePng, 'evil.png', 'image/png'));
    expect(res.ok).toBe(false); // covers: AC-413-3
    if (res.ok) throw new Error('un mime falsificato non doveva passare');
    expect(res.status).toBe(400); // covers: AC-413-3

    expect(await countAssets(siteAId)).toBe(before); // covers: AC-413-3
  });

  // covers: AC-413-4
  it('input oltre il cap (pixel: immagine compressa che si espande; e byte) → rifiutato senza oggetto salvato', async () => {
    clientHolder.current = clientA;
    const before = await countAssets(siteAId);

    // (4a) decompression-bomb in PIXEL: pochi byte, ma oltre il cap di pixel.
    const bomb: Esito = await uploadAsset(siteAId, fileOf(pixelBomb, 'bomb.png', 'image/png'));
    expect(bomb.ok).toBe(false); // covers: AC-413-4
    if (bomb.ok) throw new Error('la bomb in pixel non doveva passare');
    expect(bomb.status).toBe(400); // covers: AC-413-4

    // (4b) oltre il cap di BYTE: header jpeg valido ma buffer troppo grande.
    const big: Esito = await uploadAsset(siteAId, fileOf(byteBomb, 'big.jpg', 'image/jpeg'));
    expect(big.ok).toBe(false); // covers: AC-413-4
    if (big.ok) throw new Error('l input oltre il cap di byte non doveva passare');
    expect(big.status).toBe(400); // covers: AC-413-4

    // Nessun oggetto/riga prodotti da nessuno dei due.
    expect(await countAssets(siteAId)).toBe(before); // covers: AC-413-4
  });

  // covers: AC-413-5
  it('polyglot con header immagine valido + payload appeso → output raster con soli dati immagine (payload sparito), output != input', async () => {
    clientHolder.current = clientA;
    const res: Esito = await uploadAsset(siteAId, fileOf(polyglotAppended, 'poly.png', 'image/png'));
    expect(res.ok, res.ok ? '' : `atteso ok, status=${res.status}`).toBe(true); // covers: AC-413-5
    if (!res.ok) throw new Error('un PNG valido con coda appesa doveva essere accettato e ripulito');
    createdAssetIds.push(res.asset_id);

    const stored = await downloadObject(res.asset_id);
    // Il payload appeso e' SPARITO: i byte di output non lo contengono.
    expect(
      includesBytes(stored, new Uint8Array(Buffer.from(appendedMarker))),
      'il payload appeso non deve sopravvivere al re-encode',
    ).toBe(false); // covers: AC-413-5
    // Output != input byte-per-byte (il re-encode ha prodotto byte nuovi).
    expect(bytesEqual(stored, polyglotAppended)).toBe(false); // covers: AC-413-5
    // E resta un raster valido, decodificabile.
    const mOut = await sharp(stored).metadata();
    expect(mOut.width).toBeGreaterThan(0); // covers: AC-413-5
    expect(mOut.height).toBeGreaterThan(0); // covers: AC-413-5

    // La riga assets e' coerente.
    const row = (await assetsForSite(siteAId)).find((r) => r.storage_path === res.asset_id);
    expect(row).toBeTruthy(); // covers: AC-413-5
    expect(row!.mime).toBe('image/png'); // covers: AC-413-5
  });

  // covers: AC-413-6
  it('un siteId di un sito NON posseduto → 404 e nulla scritto (ne oggetto ne riga assets)', async () => {
    // Client di A, ma target = sito di B: la RLS filtra il sito a null → 404 (anti-enumerazione).
    clientHolder.current = clientA;
    const beforeB = await countAssets(siteBId);

    const res: Esito = await uploadAsset(siteBId, fileOf(plainJpeg, 'foto.jpg', 'image/jpeg'));
    expect(res.ok).toBe(false); // covers: AC-413-6
    if (res.ok) throw new Error('un sito altrui non doveva accettare l upload');
    expect(res.status).toBe(404); // covers: AC-413-6

    // Nessuna riga assets per il sito di B (ne prima ne dopo: B non ha mai caricato).
    expect(await countAssets(siteBId)).toBe(beforeB); // covers: AC-413-6
    expect(beforeB).toBe(0); // covers: AC-413-6 — nessun asset per il sito altrui
  });
});
