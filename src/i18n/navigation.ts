import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

// API di navigazione tipata di next-intl, derivata dal routing centrale (unica
// sorgente di verità per locale/prefissi). redirect (usato dalla server action
// setLocale) e usePathname (usato da LocaleSwitcher) sono gli unici membri
// consumati oggi: gli altri (Link, useRouter, getPathname) verranno esposti
// quando serviranno, per non lasciare export non usati (knip).
export const { redirect, usePathname } = createNavigation(routing);
