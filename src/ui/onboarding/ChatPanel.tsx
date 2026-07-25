'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Card, CardContent, CardHeader, Input, Label } from '@/ui/primitives';

// T-151 (macrotask onboarding-ui, P1) — pannello di chat: rende i turni assistente/
// utente e raccoglie il turno successivo. Componente presentazionale: il trasporto
// verso l'endpoint di T-150 e la sua persistenza NON stanno qui (li tiene chi lo
// contiene), cosi' questo file non conosce ne' l'URL ne' il protocollo NDJSON.
//
// Sicurezza: il testo dei turni e' input NON FIDATO in rendering (arriva dal modello,
// che a sua volta ha letto testo importato). Finisce solo in nodi di testo JSX: nessun
// dangerouslySetInnerHTML, nessun href.

export type ChatTurn = { role: 'user' | 'assistant'; text: string };

type ChatPanelProps = {
  turns: readonly ChatTurn[];
  pending: boolean;
  failed: boolean;
  onSend: (text: string) => void;
};

export function ChatPanel({ turns, pending, failed, onSend }: ChatPanelProps) {
  const t = useTranslations('onboarding');
  const [text, setText] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Un turno vuoto lo rifiuta anche l'endpoint (400, cap di P1-D22): non si spende
    // una richiesta per farselo dire.
    if (text.trim().length === 0) return;
    onSend(text);
    setText('');
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="text-sm font-semibold text-foreground">{t('chat.title')}</h2>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-sm">
          {turns.map((turn, index) => {
            // 04 §7 p.2 — con Haiku un turno di sole tool-call produce `assistantText`
            // VUOTA, e T-150 emette il chunk `text` comunque per tenere il protocollo
            // uniforme. Senza questo ramo la UI mostrerebbe una bolla assistente vuota,
            // che sembra un guasto: si dichiara invece cosa e' successo (il brief e'
            // stato aggiornato senza testo). Vale SOLO per l'assistente: un turno utente
            // vuoto non esiste (il submit lo rifiuta).
            const silent = turn.role === 'assistant' && turn.text.trim().length === 0;
            return (
              <li key={index} className="flex flex-col gap-xs">
                <span className="text-xs font-medium text-muted-foreground">
                  {turn.role === 'user' ? t('chat.you') : t('chat.assistant')}
                </span>
                <span className="text-sm text-foreground">
                  {silent ? t('chat.assistantSilent') : turn.text}
                </span>
              </li>
            );
          })}
        </ul>

        <form onSubmit={handleSubmit} className="mt-md flex flex-col gap-sm">
          <Label htmlFor="chat-message">{t('chat.message')}</Label>
          <Input id="chat-message" value={text} onChange={(event) => setText(event.target.value)} />
          <Button type="submit" disabled={pending}>
            {t('chat.send')}
          </Button>
          {failed && (
            <p role="alert" className="text-sm font-medium text-foreground">
              {t('chat.error')}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
