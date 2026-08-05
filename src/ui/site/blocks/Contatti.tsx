// T-237 (macrotask generation-ui, P2) — BLOCCO CONTATTI E MAPPA: l'indirizzo, un riquadro
// mappa e i canali (telefono, email, WhatsApp, social) resi dai dati del brief. Dal modello
// viene solo la cornice (`contact_title`/`contact_intro`); i recapiti sono dati del brief
// (P2-D4). E' la superficie di rischio piu' larga di P2: `phone`, `email` e i `social_links`
// sono TESTO LIBERO da cui si costruiscono i LINK.
//
// NESSUN href nasce dal testo libero (AC-237-1): ogni link passa da un costruttore che valida
// il campo su uno SCHEMA zod e sceglie lo schema dell'href dal CODICE (`tel:`/`mailto:`/`https:`
// da `./contact-links`, `https://wa.me/...` da `./whatsapp`). Un valore non valido NON produce
// alcun link — il recapito resta come solo TESTO, mai come `href='javascript:...'`.
//
// LA MAPPA e' un riquadro DECORATIVO: porta le coordinate in data-attribute e NESSUN attributo
// src/href, quindi un `photo_ref` o una coordinata non possono diventare una richiesta a un host
// di terzi (AC-237-2; la prova sull'EFFETTO e' T-241).

import { SiteSection } from '@/ui/site/SiteSection';
import { SiteText } from '@/ui/site/SiteText';
import { siteBlockLabel } from '@/ui/site/labels';
import { safeWhatsappHref } from '@/ui/site/blocks/whatsapp';
import { safeTelHref, safeMailtoHref, safeHttpsHref } from '@/ui/site/blocks/contact-links';
import type { SiteBlockProps } from '@/ui/site/types';

/**
 * UN CANALE: il valore visibile e, se e' valido, il suo href sicuro. Con `href` non nullo si
 * rende un <a>; con `href` null si rende il solo testo (nessun link da un valore non validato).
 *
 * In modalita editable il VALORE VISIBILE diventa un'isola di testo (via `SiteText`), portando
 * block id + slot id; l'HREF resta invariato — nasce sempre dai costruttori validati
 * (safeTel/Mailto/Https/Whatsapp), MAI dal testo dell'isola (disciplina T-241, P3-D6).
 */
function Channel({
  kind,
  value,
  href,
  block,
  slot,
  editable,
}: {
  kind: string;
  value: string;
  href: string | null;
  block: string;
  slot: string;
  editable?: boolean;
}) {
  const text = (
    <SiteText editable={editable} block={block} slot={slot}>
      {value}
    </SiteText>
  );
  return (
    <li className={`site-contact__channel site-contact__${kind}`}>
      {href ? (
        <a href={href} style={{ color: 'var(--site-color-accent)' }}>
          {text}
        </a>
      ) : (
        <span style={{ color: 'var(--site-color-text)' }}>{text}</span>
      )}
    </li>
  );
}

export async function Contatti({ block, locale, editable }: SiteBlockProps) {
  const label = await siteBlockLabel(block, locale);

  const title = block.content.contact_title;
  const intro = block.content.contact_intro;

  const { address, geo, phone, email, whatsapp } = block.data;
  const socials = block.data.social_links ?? [];

  return (
    <SiteSection blockId={block.id} label={label} images={block.images}>
      {title ? (
        <h2
          className="site-contact__title"
          style={{ color: 'var(--site-color-text)', fontFamily: 'var(--site-font-heading)' }}
        >
          <SiteText editable={editable} block={block.id} slot="content.contact_title">
            {title}
          </SiteText>
        </h2>
      ) : null}
      {intro ? (
        <p className="site-contact__intro" style={{ color: 'var(--site-color-text-muted)' }}>
          <SiteText editable={editable} block={block.id} slot="content.contact_intro">
            {intro}
          </SiteText>
        </p>
      ) : null}
      {address ? (
        <address className="site-contact__address" style={{ color: 'var(--site-color-text)' }}>
          <SiteText editable={editable} block={block.id} slot="data.address">
            {address}
          </SiteText>
        </address>
      ) : null}
      {geo ? (
        <div
          className="site-contact__map"
          data-geo-lat={geo.lat}
          data-geo-lng={geo.lng}
          aria-hidden="true"
          style={{ backgroundColor: 'var(--site-color-border)', borderRadius: 'var(--site-radius-lg)' }}
        />
      ) : null}
      <ul className="site-contact__channels">
        {phone ? (
          <Channel
            kind="phone"
            value={phone}
            href={safeTelHref(phone)}
            block={block.id}
            slot="data.phone"
            editable={editable}
          />
        ) : null}
        {email ? (
          <Channel
            kind="email"
            value={email}
            href={safeMailtoHref(email)}
            block={block.id}
            slot="data.email"
            editable={editable}
          />
        ) : null}
        {whatsapp ? (
          <Channel
            kind="whatsapp"
            value={whatsapp}
            href={safeWhatsappHref(whatsapp)}
            block={block.id}
            slot="data.whatsapp"
            editable={editable}
          />
        ) : null}
        {socials.map((social, index) => (
          <Channel
            key={index}
            kind="social"
            value={social}
            href={safeHttpsHref(social)}
            block={block.id}
            slot={`data.social_links.${index}`}
            editable={editable}
          />
        ))}
      </ul>
    </SiteSection>
  );
}
