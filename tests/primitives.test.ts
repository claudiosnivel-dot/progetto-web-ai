// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement as h } from 'react';
import {
  Button,
  Input,
  Label,
  Card,
  CardHeader,
  CardContent,
} from '@/ui/primitives';

afterEach(cleanup);

// T-021 — primitive UI accessibili (Button, Input, Label, Card) in stile shadcn,
// stilizzate solo con i token del design system. Smoke test di accessibilità:
// accessible name, associazione label/input, digitazione, varianti, composizione.
describe('T-021 primitive UI accessibili', () => {
  it('Button espone accessible name dai children', () => {
    render(h(Button, null, 'Salva'));
    expect(screen.getByRole('button', { name: 'Salva' })).toBeTruthy(); // covers: AC-021-1
  });

  it('Button con prop disabled ha la proprietà disabled = true', () => {
    render(h(Button, { disabled: true }, 'Salva'));
    const b = screen.getByRole('button') as HTMLButtonElement;
    expect(b.disabled).toBe(true); // covers: AC-021-2
  });

  it('la variante "secondary" ha className diversa dalla default', () => {
    render(h(Button, null, 'Default'));
    render(h(Button, { variant: 'secondary' }, 'Secondary'));
    const deflt = screen.getByRole('button', { name: 'Default' });
    const secondary = screen.getByRole('button', { name: 'Secondary' });
    expect(secondary.className).not.toBe(deflt.className); // covers: AC-021-3
  });

  it('Label con htmlFor è associata all’Input con lo stesso id', () => {
    render(
      h(
        'div',
        null,
        h(Label, { htmlFor: 'email' }, 'Email'),
        h(Input, { id: 'email' }),
      ),
    );
    const input = screen.getByLabelText('Email');
    expect(input.id).toBe('email'); // covers: AC-021-4
  });

  it('digitando in un Input il suo value riflette il testo inserito', async () => {
    render(h(Input, { type: 'text', 'aria-label': 'campo' }));
    const el = screen.getByLabelText('campo') as HTMLInputElement;
    await userEvent.type(el, 'ciao');
    expect(el.value).toBe('ciao'); // covers: AC-021-5
  });

  it('Card compone CardHeader e CardContent nel documento', () => {
    render(
      h(
        Card,
        null,
        h(CardHeader, null, 'Titolo'),
        h(CardContent, null, 'Corpo'),
      ),
    );
    expect(screen.getByText('Titolo')).toBeTruthy(); // covers: AC-021-6
    expect(screen.getByText('Corpo')).toBeTruthy(); // covers: AC-021-6
  });
});
