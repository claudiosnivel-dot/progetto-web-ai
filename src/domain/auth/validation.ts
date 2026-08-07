import { z } from 'zod';

// Policy password applicata SERVER-SIDE prima di ogni chiamata ad auth: lunghezza
// minima 8 + complessità (almeno una minuscola, una maiuscola e una cifra).
// L'hashing è delegato a Supabase Auth (bcrypt) — qui si valida solo la robustezza
// dell'input in chiaro, nessun hashing casalingo (A04:2025).
const passwordPolicy = z
  .string()
  .min(8, { message: 'La password deve avere almeno 8 caratteri.' })
  .regex(/[a-z]/, { message: 'La password deve contenere almeno una lettera minuscola.' })
  .regex(/[A-Z]/, { message: 'La password deve contenere almeno una lettera maiuscola.' })
  .regex(/[0-9]/, { message: 'La password deve contenere almeno una cifra.' });

// Schema di signup: valida SOLO email + password e fa STRIP di ogni campo extra
// (comportamento di default di z.object): un payload che inietta role/account_id
// dal client viene ripulito, così nessun privilegio deciso dal client raggiunge
// mai supabase.auth.signUp (A01:2025 — broken access control). safeParse
// restituisce quindi un oggetto con le sole chiavi { email, password }.
export const signupSchema = z.object({
  email: z.string().email({ message: "Inserisci un'email valida." }),
  password: passwordPolicy,
});

// Esito della Server Action di signup, consumato dalla pagina via useActionState.
export type SignupState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
};

// Schema di login: valida SERVER-SIDE la sola PRESENZA + formato delle
// credenziali prima di ogni contatto con l'auth server. A differenza del signup
// NON si applica la password policy (un utente esistente può avere qualunque
// password già valida): si richiede solo che la password non sia vuota. Lo
// schema fa STRIP di ogni campo extra (default z.object), così nessun input
// inatteso raggiunge signInWithPassword.
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Esito della Server Action di login. Nessun ramo 'success': in caso di successo
// l'azione fa redirect (non ritorna), quindi lo stato osservabile è solo
// 'idle' | 'error' con un messaggio GENERICO e uniforme (anti user-enumeration).
export type LoginState = {
  status: 'idle' | 'error';
  message?: string;
};

// (deploy pass) — POLICY PURA di allowlist dei signup: il muro applicativo del
// pre-lancio. Pre-lancio si tengono le registrazioni CHIUSE a chiunque tranne gli
// indirizzi in allowlist (P4-D5 gating a pagamento = P5; qui e' solo il gate di accesso).
// Dominio PURO: nessun accesso all'ambiente — l'allowlist gliela passa il chiamante
// (la Server Action, che la legge da config/env). La lista si assume gia' NORMALIZZATA
// (trim + lowercase) da chi la costruisce (getSignupAllowlist).
//
//  - Allowlist VUOTA => `true` (registrazioni APERTE): il default di sviluppo/test/locale,
//    cosi' il flusso esistente e i test non si rompono. In PRODUZIONE l'allowlist e'
//    OBBLIGATORIA e non vuota (assertProductionEnv la impone al boot), quindi prod = muro armato.
//  - Allowlist NON vuota => `true` SOLO se l'email normalizzata e' nella lista, per
//    UGUAGLIANZA ESATTA (mai prefisso/sottostringa: `me@ulaba.net` non ammette
//    `me@ulaba.net.attacker.com` ne `notme@ulaba.net`).
export function isSignupAllowed(email: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  const normalized = email.trim().toLowerCase();
  return allowlist.includes(normalized);
}
