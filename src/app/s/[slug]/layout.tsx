import type { ReactNode } from 'react';
import { routing } from '@/i18n/routing';
import { readPublishedSite } from '@/data/public-site';

// T-405 (macrotask public-serving, P4) — IL ROOT LAYOUT STANDALONE dell'albero pubblico /s/*.
//
// PERCHE' ESISTE. Non c'e' alcun src/app/layout.tsx: il layout radice de-facto dell'app e'
// src/app/[locale]/layout.tsx, l'UNICO posto che rende <html>/<body> (piu' i provider next-intl /
// theme). Una rotta di primo livello /s/<slug> sta FUORI dal segmento [locale], quindi non eredita
// quel layout e non avrebbe <html>/<body>. Next 16 ammette PIU' root layout quando manca il layout
// radice condiviso: questo e' il secondo root layout, per il solo sotto-albero /s/*, e rende
// <html>/<body> a PIENA PAGINA, senza alcun chrome di Belora (niente header/nav del builder).
//
// LANG DALLA RIGA, NON DAL BROWSER. `lang` viene dal `locale` dello snapshot PUBBLICATO
// (readPublishedSite), mai dal locale negoziato col browser: un sito italiano resta lang="it" anche
// se il visitatore ha il browser in spagnolo. La stessa lettura anon+RLS della page, deduplicata
// per richiesta da React cache() (una sola query per layout e page). Per uno slug inesistente o non
// pubblicato la riga e' `null` (la page rispondera' notFound()): il layout deve comunque produrre un
// documento valido per la pagina 404, quindi ricade sul defaultLocale — una scelta neutra che NON
// distingue lo sconosciuto dal non pubblicato (P1-D21).
//
// NESSUN provider next-intl qui: il render pubblico e' READ-ONLY (editable falsy) e i blocchi
// risolvono le proprie etichette via `getTranslations({ locale })` server-side (labels.ts), a cui
// il locale arriva per parametro dalla page — non serve il NextIntlClientProvider.

type PublicSiteLayoutProps = {
  children: ReactNode;
  params: Promise<{ slug: string }>;
};

export default async function PublicSiteLayout({ children, params }: PublicSiteLayoutProps) {
  const { slug } = await params;
  // Stessa lettura anon+RLS della page, condivisa via cache(): qui se ne usa il SOLO `locale`.
  const site = await readPublishedSite(slug);
  const lang = site?.locale ?? routing.defaultLocale;

  return (
    <html lang={lang}>
      <body>{children}</body>
    </html>
  );
}
