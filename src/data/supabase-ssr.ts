import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

// Client Supabase SSR: usa ESCLUSIVAMENTE la anon key + i cookie dell'utente
// (RLS attiva). MAI la service_role → nessun bypass di RLS nel contesto SSR /
// middleware (R7 / A01:2025). L'adapter dei cookie è iniettato dal chiamante, così
// lo stesso modulo serve sia i Server Component / Route Handler (cookie via
// next/headers) sia il middleware (cookie via NextRequest).

function ssrEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Variabili d'ambiente mancanti: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  return { url, anonKey };
}

// Contesto Server Component / Route Handler / Server Action: i cookie sono
// letti/scritti via next/headers. L'import è DINAMICO così next/headers non entra
// nel bundle del middleware (runtime Edge), che importa questo stesso modulo per
// getUserFromRequest. Esportato per i flussi auth server-side (es. signup) che
// devono chiamare le API auth tipate (anon key + cookie, RLS attiva; MAI service_role).
export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  const { url, anonKey } = ssrEnv();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // In un Server Component il cookie store è di sola lettura: il refresh
          // della sessione è scritto dal middleware. Ignorato di proposito.
        }
      },
    },
  });
}

// Identità server-side VALIDATA: usa supabase.auth.getUser(), che rivalida il
// token contro l'auth server, invece di fidarsi del cookie non verificato
// (getSession). Cattura ogni errore → null, non solleva mai.
export async function getUser(): Promise<User | null> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user ?? null;
  } catch {
    return null;
  }
}

// Variante per il middleware: legge i cookie dalla NextRequest (niente
// next/headers, così il modulo resta importabile nel runtime del middleware). La
// guardia consulta solo l'identità validata → l'adapter non scrive cookie.
// Cattura ogni errore → null, non solleva mai.
export async function getUserFromRequest(request: NextRequest): Promise<User | null> {
  try {
    const { url, anonKey } = ssrEnv();
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: () => {
          // La guardia di route legge soltanto l'identità: nessuna mutazione di
          // cookie qui. Il refresh sessione avviene nei flussi RSC / route handler.
        },
      },
    });
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user ?? null;
  } catch {
    return null;
  }
}
