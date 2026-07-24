import { describe, it, expect, vi, beforeEach } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { runOnboardingTurn } from '@/data/anthropic';
import { runInterviewTurn } from '@/domain/onboarding/interview';
import { applyBriefUpdate, emptyBrief } from '@/domain/onboarding/brief';

// T-132 (macrotask ai-onboarding, P1) — orchestrazione dell'intervista.
// Le asserzioni derivano dagli acceptance_criteria AC-132-1..5 (02-ai-onboarding.md).
// Il confine LLM di T-131 e mockato: la parte non deterministica resta fuori dagli
// oracoli e i turni/tool-call sono preconfezionati.

vi.mock('@/data/anthropic', () => ({ runOnboardingTurn: vi.fn() }));

const boundary = vi.mocked(runOnboardingTurn);

const USER_MESSAGE = 'Ho un bar a Roma, si chiama Bar Sole';

function textBlock(text: string): Anthropic.TextBlock {
  return { type: 'text', text, citations: null };
}

function toolUseBlock(name: string, input: unknown): Anthropic.ToolUseBlock {
  return { type: 'tool_use', id: `toolu_${name}`, name, input, caller: { type: 'direct' } };
}

// Risposta fissa del modello: e l'input NON FIDATO che l'orchestrazione deve interpretare.
function modelReply(content: Anthropic.ContentBlock[]): Anthropic.Message {
  return {
    id: 'msg_test_t132',
    container: null,
    content,
    model: 'claude-haiku-4-5',
    role: 'assistant',
    stop_details: null,
    stop_reason: 'tool_use',
    stop_sequence: null,
    type: 'message',
    usage: {
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      input_tokens: 10,
      output_tokens: 5,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: null,
    },
  };
}

// Il tool custom e l'unico membro della ToolUnion che porta input_schema: restringe
// la union sul valore effettivo, senza cast.
function isCustomTool(tool: Anthropic.ToolUnion): tool is Anthropic.Tool {
  return 'input_schema' in tool;
}

beforeEach(() => {
  boundary.mockReset();
});

describe('T-132 orchestrazione dell intervista di onboarding', () => {
  // covers: AC-132-1
  it('applica la tool-call update_brief al brief vuoto e riporta il testo assistente al chiamante', async () => {
    boundary.mockResolvedValue(
      modelReply([
        textBlock('Perfetto, Bar Sole.'),
        toolUseBlock('update_brief', { updates: { business_name: 'Bar Sole' } }),
      ]),
    );

    const result = await runInterviewTurn({
      messages: [],
      brief: emptyBrief('it'),
      userMessage: USER_MESSAGE,
    });

    expect(boundary).toHaveBeenCalledTimes(1); // covers: AC-132-1 — il turno passa dal confine T-131
    expect(result.brief.business_name).toBe('Bar Sole'); // covers: AC-132-1
    expect(result.assistantText).toBe('Perfetto, Bar Sole.'); // covers: AC-132-1
  });

  it('inoltra al confine i messaggi precedenti seguiti dal turno dell utente', async () => {
    // Non discende da un AC: copre la definition_of_done di T-132, che fissa gli
    // ingressi "(messaggi precedenti, brief corrente, turno utente)". Senza questa
    // asserzione l'orchestrazione potrebbe scartare storia e messaggio utente
    // restando verde (mutazione verificata).
    boundary.mockResolvedValue(modelReply([textBlock('Certo.')]));
    const previous: Anthropic.MessageParam[] = [
      { role: 'user', content: 'Ciao' },
      { role: 'assistant', content: 'Ciao! Come si chiama la tua attivita?' },
    ];

    await runInterviewTurn({
      messages: previous,
      brief: emptyBrief('it'),
      userMessage: USER_MESSAGE,
    });

    expect(boundary.mock.calls[0][0].messages).toEqual([
      ...previous,
      { role: 'user', content: USER_MESSAGE },
    ]); // DoD T-132
  });

  it('scarta l intera tool-call se l input non rispetta lo schema dichiarato al modello', async () => {
    // security_notes di T-132 (A05:2025): l'input del tool DEVE passare per
    // BriefUpdateSchema (T-121) PRIMA della fusione. Una chiave sconosciuta e il
    // caso che SOLO quel gate intercetta: applyBriefUpdate (T-122) da solo
    // applicherebbe comunque i campi noti, quindi senza questa asserzione la
    // rimozione del gate resterebbe verde (mutazione verificata).
    boundary.mockResolvedValue(
      modelReply([
        textBlock('Ricevuto.'),
        toolUseBlock('update_brief', { updates: { business_name: 'Bar Sole' }, bogus: 1 }),
      ]),
    );

    const result = await runInterviewTurn({
      messages: [],
      brief: emptyBrief('it'),
      userMessage: USER_MESSAGE,
    });

    expect(result.brief.business_name).toBeUndefined(); // security_notes T-132 — nulla passa senza validazione
    expect(result.brief).toEqual(emptyBrief('it')); // security_notes T-132 — brief intatto
  });

  // covers: AC-132-2
  it('passa al confine LLM update_brief strict (additionalProperties:false, required valorizzato) e mark_ready_for_review', async () => {
    boundary.mockResolvedValue(modelReply([textBlock('Come si chiama la tua attivita?')]));

    await runInterviewTurn({ messages: [], brief: emptyBrief('it'), userMessage: USER_MESSAGE });

    const tools = boundary.mock.calls[0][0].tools.filter(isCustomTool);
    const updateBrief = tools.find((tool) => tool.name === 'update_brief');
    const markReady = tools.find((tool) => tool.name === 'mark_ready_for_review');

    expect(updateBrief).toBeDefined(); // covers: AC-132-2
    expect(markReady).toBeDefined(); // covers: AC-132-2
    expect(updateBrief?.strict).toBe(true); // covers: AC-132-2 — strict tool use
    expect(updateBrief?.input_schema.additionalProperties).toBe(false); // covers: AC-132-2
    expect(updateBrief?.input_schema.required).toEqual(['updates']); // covers: AC-132-2 — required valorizzato
    expect(updateBrief?.input_schema.required?.length).toBeGreaterThan(0); // covers: AC-132-2 — non vuoto
    // La patch vive sotto l'unica chiave obbligatoria ed e a sua volta chiusa; gli
    // ENUM coincidono con le allowlist di T-121 (sono derivati da BriefUpdateSchema:
    // se divergessero, il modello riceverebbe uno schema mendace e la validazione
    // scarterebbe cio' che lo schema gli ha appena permesso).
    expect(updateBrief?.input_schema).toMatchObject({
      type: 'object',
      properties: {
        updates: {
          type: 'object',
          additionalProperties: false,
          properties: {
            business_name: { type: 'string' },
            vertical: {
              enum: ['ristorazione', 'fitness', 'salone_studio', 'negozio_artigiano', 'altro'],
            },
            primary_goal: { enum: ['prenota', 'ordina', 'contatta'] },
            locale: { enum: ['it', 'es'] },
          },
        },
      },
    }); // covers: AC-132-2
  });

  // covers: AC-132-3
  it('localizza il system prompt: con locale es e in spagnolo e diverso dalla versione it', async () => {
    boundary.mockResolvedValue(modelReply([textBlock('Hola.')]));

    await runInterviewTurn({ messages: [], brief: emptyBrief('es'), userMessage: USER_MESSAGE });
    await runInterviewTurn({ messages: [], brief: emptyBrief('it'), userMessage: USER_MESSAGE });

    const systemEs = boundary.mock.calls[0][0].system;
    const systemIt = boundary.mock.calls[1][0].system;

    expect(systemEs).not.toBe(systemIt); // covers: AC-132-3 — testo diverso dalla versione it
    expect(systemEs).toContain('asistente'); // covers: AC-132-3 — spagnolo
    expect(systemIt).toContain('assistente'); // covers: AC-132-3 — italiano
    expect(systemEs).not.toContain('assistente'); // covers: AC-132-3 — guardia anti-placebo: non e il testo it
  });

  // covers: AC-132-4
  it('rifiuta un update_brief con vertical fuori allowlist lasciando il brief invariato', async () => {
    const base = applyBriefUpdate(emptyBrief('it'), {
      vertical: 'ristorazione',
      business_name: 'Bar Sole',
    }).brief;

    boundary.mockResolvedValue(
      modelReply([
        textBlock('Ricevuto.'),
        toolUseBlock('update_brief', { updates: { vertical: 'casino' } }),
      ]),
    );

    const result = await runInterviewTurn({ messages: [], brief: base, userMessage: USER_MESSAGE });

    expect(result.brief.vertical).toBe('ristorazione'); // covers: AC-132-4 — campo invariato
    expect(result.brief).toEqual(base); // covers: AC-132-4 — nessuna corruzione del resto del brief
  });

  // covers: AC-132-5
  it('alza il flag ready-for-review quando il modello chiama mark_ready_for_review', async () => {
    boundary.mockResolvedValue(modelReply([textBlock('Ancora una domanda.')]));
    const before = await runInterviewTurn({
      messages: [],
      brief: emptyBrief('it'),
      userMessage: USER_MESSAGE,
    });
    expect(before.readyForReview).toBe(false); // covers: AC-132-5 — guardia anti-placebo: non e sempre true

    boundary.mockResolvedValue(
      modelReply([textBlock('Direi che ci siamo.'), toolUseBlock('mark_ready_for_review', {})]),
    );
    const after = await runInterviewTurn({
      messages: [],
      brief: emptyBrief('it'),
      userMessage: USER_MESSAGE,
    });

    expect(after.readyForReview).toBe(true); // covers: AC-132-5
    expect(after.brief).toEqual(emptyBrief('it')); // covers: AC-132-5 — il flag non altera il brief
  });
});
