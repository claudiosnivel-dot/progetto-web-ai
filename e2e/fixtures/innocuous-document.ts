import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';
import { RECIPES } from '@/domain/generation/recipes';
import { resolveVariantHome } from '@/ui/generation/variant-document';
import type { SiteDocument } from '@/domain/generation/document';

// T-240 (macrotask generation-e2e, P2) — IL DOCUMENTO-FIXTURE INNOCUO per AC-240-1. Non e' scritto
// a mano: e' costruito attraverso il PERCORSO REALE (resolveVariantHome -> resolve -> parseDocument)
// da un brief con un nome di attivita' NOTO, cosi' cio' che l'anteprima rende e' cio' che il
// prodotto produrrebbe davvero. Il nome dell'attivita' e le offerte compaiono nel DOM (hero e
// blocco offerte), e sono gli ancoraggi con cui l'harness verifica che la pagina si e' caricata.
//
// DISCIPLINA FIXTURE (lezione P1, ripetuta 3 volte): PIU' DI UN elemento, valori DISCORDANTI, e un
// id che sia PREFISSO di un altro. Le offerte sono tre, discordanti, e 'Tagliere' e' PREFISSO di
// 'Tagliere della casa': una fixture con un solo elemento, o senza la trappola del prefisso, non
// proverebbe nulla sull'identita' di cio' che viene reso.

/** Il nome dell'attivita' noto, atteso nel DOM dell'anteprima (hero). */
export const BUSINESS_NAME = 'Trattoria Da Nonna Rosa';

/** Una voce di offerta nota, attesa nel DOM (blocco offerte). E' il prefisso-lungo della coppia. */
export const KNOWN_OFFERING = 'Tagliere della casa';

// Il pool CONDIVISO della home: la prosa del modello per ogni slot narrativo, con una firma nel
// testo cosi' che i valori siano tutti distinti. E' la STESSA forma provata da
// tests/generation-preview-reachable.test.ts, che compone un documento home valido.
function homePoolContent(firma: string): Record<string, unknown> {
  return {
    pages: {
      home: {
        hero_title_kicker: `Cucina casalinga nel centro storico ${firma}`,
        hero_title: `Benvenuti alla ${BUSINESS_NAME} ${firma}`,
        hero_subtitle: `Aperti dal 1962, a due passi dal Pantheon ${firma}`,
        offerings_title: `La nostra cucina ${firma}`,
        offerings_intro: `Piatti del giorno e classici romani ${firma}`,
        about_title: `Chi siamo ${firma}`,
        about_body: `Tre generazioni ai fornelli ${firma}`,
        about_points: [`Pasta fatta in casa ${firma}`, `Forno a legna ${firma}`],
        hours_title: `Quando siamo aperti ${firma}`,
        hours_intro: `Chiuso il lunedi ${firma}`,
        contact_title: `Dove trovarci ${firma}`,
        contact_intro: `Prenota un tavolo o passa a trovarci ${firma}`,
        faq_title: `Domande frequenti ${firma}`,
        faq_items: [
          { question: `Accettate gruppi? ${firma}`, answer: `Si, fino a venti coperti ${firma}` },
          { question: `C'e' un menu vegetariano? ${firma}`, answer: `Certo, ogni giorno ${firma}` },
        ],
        whatsapp_cta_title: `Scrivici su WhatsApp ${firma}`,
      },
    },
  };
}

/** Il brief da cui deriva il documento innocuo (nome noto, offerte discordanti col prefisso). */
export function innocuousBrief() {
  return applyBriefUpdate(emptyBrief('it'), {
    business_name: BUSINESS_NAME,
    vertical: 'ristorazione',
    description: 'Cucina casalinga romana nel centro storico, aperta dal 1962.',
    whatsapp: '+39 333 4445566',
    phone: '+39 06 5551234',
    address: 'Via delle Grazie 7, Roma',
    hours: { 'lun-ven': '12:00-15:00', sab: '19:00-23:00' },
    offerings: [
      { name: 'Tagliere', section: 'Antipasti' },
      { name: KNOWN_OFFERING, section: 'Antipasti' }, // 'Tagliere' e' PREFISSO di questo
      { name: 'Tiramisu', section: 'Dolci' },
    ],
  }).brief;
}

/** Il contenuto del pool condiviso, esposto per il percorso genera->scegli->anteprima (T-241). */
export function innocuousHomePool(): Record<string, unknown> {
  return homePoolContent('anteprima');
}

/**
 * COSTRUISCE il documento innocuo attraverso il percorso reale. Lanciato solo quando invocato (mai
 * a import-time), cosi' il collezionamento degli spec non dipende dal DB ne' fallisce se il dominio
 * cambiasse: se il documento non passasse `parseDocument`, e' un errore che va visto, non ingoiato.
 */
export function buildInnocuousDocument(): SiteDocument {
  const resolved = resolveVariantHome(innocuousHomePool(), RECIPES[0], innocuousBrief());
  if (resolved === null) {
    throw new Error('fixture innocua: il documento home non ha superato parseDocument');
  }
  return resolved.document;
}
