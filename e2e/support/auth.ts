import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import './env';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';
import { adminClient } from './seed';

// T-240 (macrotask generation-e2e, P2) — L'AUTENTICAZIONE DELL'END-TO-END. Provisiona UN utente
// di test (service_role), firma con la anon key (JWT reale, RLS attiva) e CATTURA i cookie di
// sessione nel formato che l'app legge lato server (@supabase/ssr), per lo storageState del
// browser di Playwright.
//
// PERCHE' NON COMPORRE IL COOKIE A MANO: il nome del cookie ('sb-<ref>-auth-token', piu' i pezzi
// '.0'/'.1' se il valore e' chunkato) e la sua codifica sono un dettaglio interno di @supabase/ssr
// che e' gia' cambiato fra versioni. Il metodo VERSIONE-PROOF e' rigiocare la sessione dentro un
// createServerClient con un adapter cookie che INTERCETTA setAll — lo STESSO percorso che
// src/data/supabase-ssr.ts usa in produzione — e raccogliere esattamente i cookie che quel client
// scrive. Cosi' il browser presentera' all'app cio' che l'app si aspetta di leggere, qualunque sia
// la versione della libreria.

/** Un cookie nel formato storageState di Playwright. */
export type StorageStateCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
};

/** Crea l'utente di test (email confermata) e lo restituisce. */
export async function createTestUser(email: string, password: string): Promise<User> {
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  return data.user;
}

/** L'account auto-provisionato per l'owner (trigger su auth.users). Ritorna l'account id. */
export async function accountFor(userId: string): Promise<string> {
  const { data, error } = await adminClient()
    .from('accounts')
    .select('id')
    .eq('owner_id', userId)
    .single();
  if (error || !data) throw error ?? new Error(`account assente per l'utente ${userId}`);
  return data.id as string;
}

/** Cancella l'utente di test (CASCADE fino a account -> sites -> generations -> pools). */
export async function deleteTestUser(userId: string): Promise<void> {
  await adminClient().auth.admin.deleteUser(userId);
}

type CookieOptions = {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: boolean | 'lax' | 'strict' | 'none';
};

function normaliseSameSite(sameSite: CookieOptions['sameSite']): 'Strict' | 'Lax' | 'None' {
  if (sameSite === 'strict') return 'Strict';
  if (sameSite === 'none') return 'None';
  // Il default di @supabase/ssr e' 'lax'; qualunque altro valore (incluso il boolean true)
  // ricade su Lax, che e' cio' che consente l'invio al top-level navigation dell'app.
  return 'Lax';
}

function toStorageStateCookie(name: string, value: string, options: CookieOptions): StorageStateCookie {
  let expires = -1; // cookie di sessione, salvo maxAge esplicito
  if (typeof options.maxAge === 'number') {
    expires = Math.floor(Date.now() / 1000) + options.maxAge;
  } else if (options.expires instanceof Date) {
    expires = Math.floor(options.expires.getTime() / 1000);
  }
  return {
    name,
    value,
    // L'app gira su http://127.0.0.1:3000: il dominio del cookie e' l'host senza porta, e
    // `secure` DEVE essere false perche' su http un cookie secure non verrebbe mai inviato.
    domain: '127.0.0.1',
    path: options.path ?? '/',
    expires,
    httpOnly: options.httpOnly ?? true,
    secure: false,
    sameSite: normaliseSameSite(options.sameSite),
  };
}

/**
 * Firma con email/password e restituisce i cookie di sessione per lo storageState del browser.
 * Rigioca la sessione dentro un server client il cui adapter cattura setAll (vedi l'intestazione).
 */
export async function captureSessionCookies(
  email: string,
  password: string,
): Promise<StorageStateCookie[]> {
  const signin = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await signin.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error('sign-in senza sessione');

  const collected: StorageStateCookie[] = [];
  const server = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (cookiesToSet) => {
        for (const cookie of cookiesToSet) {
          collected.push(
            toStorageStateCookie(cookie.name, cookie.value, (cookie.options ?? {}) as CookieOptions),
          );
        }
      },
    },
  });
  // setSession emette l'evento SIGNED_IN, che fa scrivere i cookie via setAll: raccolti sopra.
  await server.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });

  if (collected.length === 0) {
    throw new Error('nessun cookie di sessione catturato: lo storageState sarebbe vuoto');
  }
  return collected;
}
