import { describe, expect, it } from 'vitest';
import type {
  CardDocument,
  CardNoteReference,
  CrashpadCardEntry,
  CrashpadCardOrigin,
  CrashpadDocument,
  ParsedCrashCard,
  VaultNoteDocument,
} from '../../electron/vault-contract';
import {
  projectCards,
  selectDefaultWeaveCardUid,
  selectFocusedCard,
  type CardProjectionInput,
} from './cardProjection';

function makeCardDocument(uid: string, referencedIn: CardNoteReference[] = []): CardDocument {
  return {
    uid,
    type: ['concept'],
    raw_content: `Content of ${uid}.`,
    metadata: { familiarity: 0, next_review: null },
    memory_tricks: { memory_technique: '', qa_pairs: [] },
    referenced_in: referencedIn,
  };
}

function makeParsedCard(uid: string, blockContent = `Block of ${uid}.`): ParsedCrashCard {
  return { uid, startLine: 1, endLine: blockContent.split('\n').length + 2, blockContent };
}

function makeNoteDocument(parsedCards: ParsedCrashCard[]): VaultNoteDocument {
  return {
    filePath: 'notes/topic.md',
    title: 'Topic',
    size: 0,
    modifiedAt: '2026-01-01T00:00:00.000Z',
    tags: [],
    content: '',
    parsedCards,
  };
}

function makeCrashpadCardEntry(uid: string, origin: CrashpadCardOrigin): CrashpadCardEntry {
  return { uid, origin, addedAt: '2026-01-01T00:00:00.000Z' };
}

function makeCrashpadDocument(cards: CrashpadCardEntry[]): CrashpadDocument {
  return {
    id: 'daily',
    name: 'Daily',
    filePath: '.crashweaver/crashpads/daily.crashpad.json',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cards,
    deletedCards: [],
  };
}

function makeInput(overrides: Partial<CardProjectionInput> = {}): CardProjectionInput {
  return {
    activeNote: null,
    allCards: [],
    cardStorePath: undefined,
    selectedNotePath: '',
    activeCrashpad: null,
    activeCardFileUid: null,
    cardScope: 'current-note',
    isCrashpadEditor: false,
    isCardEditor: false,
    ...overrides,
  };
}

describe('projectCards', () => {
  it('has no visible cards when no note is open on the note scope', () => {
    const projection = projectCards(makeInput());

    expect(projection.visibleCards).toEqual([]);
    expect(projection.crashpadCards).toEqual([]);
  });

  it('projects the active note cards in uid order on the note scope', () => {
    const projection = projectCards(
      makeInput({
        activeNote: makeNoteDocument([makeParsedCard('beta'), makeParsedCard('alpha')]),
      }),
    );

    expect(projection.visibleCards.map((card) => card.uid)).toEqual(['alpha', 'beta']);
    expect(projection.visibleCards[0]).toMatchObject({
      source: 'current-note',
      rawContent: 'Block of alpha.',
      currentReference: {
        note_path: 'notes/topic.md',
        start_line: 1,
        end_line: 3,
      },
    });
  });

  it('has no note cards for a note without parsed cards', () => {
    const activeNote: VaultNoteDocument = {
      filePath: 'notes/topic.md',
      title: 'Topic',
      size: 0,
      modifiedAt: '2026-01-01T00:00:00.000Z',
      tags: [],
      content: 'No boundary markers here.',
    };

    expect(projectCards(makeInput({ activeNote })).visibleCards).toEqual([]);
  });

  it('projects a parsed note card through its linked card payload', () => {
    const linkedCard = makeCardDocument('alpha', [
      { note_path: 'notes/other.md', start_line: 10, end_line: 12 },
    ]);
    const parsedCard: ParsedCrashCard = {
      ...makeParsedCard('alpha', 'Stale block.'),
      cardFilePath: '.crashweaver/cards/alpha.json',
      cardExists: true,
      linkedCard,
    };

    const projection = projectCards(makeInput({ activeNote: makeNoteDocument([parsedCard]) }));

    expect(projection.visibleCards[0]).toMatchObject({
      rawContent: 'Content of alpha.',
      cardExists: true,
      cardFilePath: '.crashweaver/cards/alpha.json',
      references: linkedCard.referenced_in,
      currentReference: {
        note_path: 'notes/topic.md',
        start_line: 1,
        end_line: 3,
      },
    });
  });

  it('projects the card catalog in uid order on the vault scope', () => {
    const projection = projectCards(
      makeInput({
        allCards: [
          makeCardDocument('gamma', [{ note_path: 'notes/other.md', start_line: 1, end_line: 2 }]),
          makeCardDocument('alpha', [{ note_path: 'notes/other.md', start_line: 3, end_line: 4 }]),
        ],
        cardStorePath: 'C:/vault/.crashweaver/cards',
        selectedNotePath: 'notes/other.md',
        cardScope: 'current-vault',
      }),
    );

    expect(projection.visibleCards.map((card) => card.uid)).toEqual(['alpha', 'gamma']);
    expect(projection.visibleCards[0]).toMatchObject({
      source: 'current-vault',
      rawContent: 'Content of alpha.',
      cardFilePath: 'C:/vault/.crashweaver/cards/alpha.json',
      currentReference: {
        note_path: 'notes/other.md',
        start_line: 3,
        end_line: 4,
      },
    });
  });

  it('prefers the selected note reference for a vault card', () => {
    const projection = projectCards(
      makeInput({
        allCards: [
          makeCardDocument('alpha', [
            { note_path: 'notes/other.md', start_line: 1, end_line: 2 },
            { note_path: 'notes/selected.md', start_line: 5, end_line: 6 },
          ]),
        ],
        selectedNotePath: 'notes/selected.md',
        cardScope: 'current-vault',
      }),
    );

    expect(projection.visibleCards[0].currentReference).toEqual({
      note_path: 'notes/selected.md',
      start_line: 5,
      end_line: 6,
    });
  });

  it('omits the card file path when no card store is configured', () => {
    const projection = projectCards(
      makeInput({
        allCards: [makeCardDocument('alpha')],
        cardScope: 'current-vault',
      }),
    );

    expect(projection.visibleCards[0].cardFilePath).toBeUndefined();
  });

  it('falls back to the first stored reference when the selected note is not referenced', () => {
    const projection = projectCards(
      makeInput({
        allCards: [
          makeCardDocument('alpha', [
            { note_path: 'notes/other.md', start_line: 1, end_line: 2 },
            { note_path: 'notes/third.md', start_line: 3, end_line: 4 },
          ]),
        ],
        selectedNotePath: 'notes/unrelated.md',
        cardScope: 'current-vault',
      }),
    );

    expect(projection.visibleCards[0].currentReference).toEqual({
      note_path: 'notes/other.md',
      start_line: 1,
      end_line: 2,
    });
  });

  it('ignores the card catalog on the note scope', () => {
    const projection = projectCards(
      makeInput({
        activeNote: makeNoteDocument([makeParsedCard('note-card')]),
        allCards: [makeCardDocument('vault-card')],
      }),
    );

    expect(projection.visibleCards.map((card) => card.uid)).toEqual(['note-card']);
  });

  it('ignores the active note on the vault scope', () => {
    const projection = projectCards(
      makeInput({
        activeNote: makeNoteDocument([makeParsedCard('note-card')]),
        allCards: [makeCardDocument('vault-card')],
        cardScope: 'current-vault',
      }),
    );

    expect(projection.visibleCards.map((card) => card.uid)).toEqual(['vault-card']);
  });

  it('projects only the open card file on the card surface', () => {
    const projection = projectCards(
      makeInput({
        allCards: [makeCardDocument('alpha'), makeCardDocument('beta')],
        activeCardFileUid: 'beta',
        isCardEditor: true,
      }),
    );

    expect(projection.visibleCards.map((card) => card.uid)).toEqual(['beta']);
  });

  it('projects crashpad cards from the catalog in uid order and drops missing ones', () => {
    const projection = projectCards(
      makeInput({
        activeCrashpad: makeCrashpadDocument([
          makeCrashpadCardEntry('beta', 'new'),
          makeCrashpadCardEntry('alpha', 'existing'),
          makeCrashpadCardEntry('missing', 'new'),
        ]),
        allCards: [makeCardDocument('alpha'), makeCardDocument('beta')],
        selectedNotePath: 'notes/topic.md',
        isCrashpadEditor: true,
      }),
    );

    expect(projection.visibleCards.map((card) => card.uid)).toEqual(['alpha', 'beta']);
    expect(projection.visibleCards[0]).toMatchObject({
      source: 'crashpad',
      origin: 'existing',
    });
    expect(projection.visibleCards[1]).toMatchObject({
      source: 'crashpad',
      origin: 'new',
    });
  });
  it('projects crashpad cards while another surface is active', () => {
    const projection = projectCards(
      makeInput({
        activeNote: makeNoteDocument([makeParsedCard('note-card')]),
        activeCrashpad: makeCrashpadDocument([makeCrashpadCardEntry('alpha', 'existing')]),
        allCards: [makeCardDocument('alpha')],
      }),
    );

    expect(projection.visibleCards.map((card) => card.uid)).toEqual(['note-card']);
    expect(projection.crashpadCards.map((card) => card.uid)).toEqual(['alpha']);
  });
});

describe('selectFocusedCard', () => {
  it('selects the requested card when it is visible', () => {
    const { visibleCards } = projectCards(
      makeInput({
        activeNote: makeNoteDocument([makeParsedCard('beta'), makeParsedCard('alpha')]),
      }),
    );

    expect(selectFocusedCard(visibleCards, 'beta')?.uid).toBe('beta');
  });

  it('falls back to the first visible card when the requested card is not visible', () => {
    const { visibleCards } = projectCards(
      makeInput({
        activeNote: makeNoteDocument([makeParsedCard('beta'), makeParsedCard('alpha')]),
      }),
    );

    expect(selectFocusedCard(visibleCards, 'missing')?.uid).toBe('alpha');
    expect(selectFocusedCard(visibleCards, null)?.uid).toBe('alpha');
  });

  it('has no focused card when no cards are visible', () => {
    expect(selectFocusedCard([], 'missing')).toBeNull();
  });
});

describe('selectDefaultWeaveCardUid', () => {
  it('selects the focused crashpad card', () => {
    const { crashpadCards } = projectCards(
      makeInput({
        activeCrashpad: makeCrashpadDocument([
          makeCrashpadCardEntry('alpha', 'existing'),
          makeCrashpadCardEntry('beta', 'new'),
        ]),
        allCards: [makeCardDocument('alpha'), makeCardDocument('beta')],
        isCrashpadEditor: true,
      }),
    );

    expect(selectDefaultWeaveCardUid(crashpadCards, 'beta')).toBe('beta');
  });

  it('falls back to the first crashpad card when the focused card is not in the crashpad', () => {
    const { crashpadCards } = projectCards(
      makeInput({
        activeCrashpad: makeCrashpadDocument([makeCrashpadCardEntry('alpha', 'existing')]),
        allCards: [makeCardDocument('alpha')],
        isCrashpadEditor: true,
      }),
    );

    expect(selectDefaultWeaveCardUid(crashpadCards, 'missing')).toBe('alpha');
  });

  it('has no default weave card when the crashpad has no cards', () => {
    const { crashpadCards } = projectCards(
      makeInput({
        activeCrashpad: makeCrashpadDocument([]),
        isCrashpadEditor: true,
      }),
    );

    expect(selectDefaultWeaveCardUid(crashpadCards, null)).toBeNull();
  });
});
