import type { CardParseDiagnostic, ParsedCrashCard, ParsedCrashCardsNote } from './vault-contract';
import { CARD_UID_ALPHABET, isValidCardUid, normalizeCardUid } from './cardUid';

// Both boundary patterns are built from the shared card-UID alphabet in
// `electron/cardUid.ts`. The capture is then trimmed and validated against the
// full grammar below, so the parser and the card store accept exactly the same
// titles: the store would reject a title the parser let through, and a note
// carrying such a boundary would fail to open instead of reporting a diagnostic.
const START_BOUNDARY_PATTERN = new RegExp(`^%%CW_CARD_START\\s+uid:([${CARD_UID_ALPHABET}]+)%%$`);
const END_BOUNDARY_PATTERN = new RegExp(`^%%CW_CARD_END\\s+uid:([${CARD_UID_ALPHABET}]+)%%$`);

const INVALID_START_BOUNDARY_MESSAGE =
  'Card start boundary must follow the format %%CW_CARD_START uid:<UID>%%.';
const INVALID_END_BOUNDARY_MESSAGE =
  'Card end boundary must follow the format %%CW_CARD_END uid:<UID>%%.';

interface ActiveBoundary {
  uid: string;
  line: number;
}

function createDiagnostic(
  code: CardParseDiagnostic['code'],
  line: number,
  message: string,
  uid?: string,
): CardParseDiagnostic {
  return {
    code,
    line,
    message,
    severity: 'error',
    uid,
  };
}

function buildCard(
  lines: string[],
  startBoundary: ActiveBoundary,
  endLine: number,
): ParsedCrashCard {
  return {
    uid: startBoundary.uid,
    startLine: startBoundary.line,
    endLine,
    blockContent: lines.slice(startBoundary.line, endLine - 1).join('\n'),
  };
}

export function formatCardStartBoundary(uid: string) {
  return `%%CW_CARD_START uid:${uid}%%`;
}

export function formatCardEndBoundary(uid: string) {
  return `%%CW_CARD_END uid:${uid}%%`;
}

export function parseCrashCardsFromNote(notePath: string, content: string): ParsedCrashCardsNote {
  const normalizedContent = content.replace(/\r\n/g, '\n');
  const lines = normalizedContent.split('\n');
  const cards: ParsedCrashCard[] = [];
  const diagnostics: CardParseDiagnostic[] = [];
  let activeBoundary: ActiveBoundary | null = null;

  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    const startMatch = line.match(START_BOUNDARY_PATTERN);
    const endMatch = line.match(END_BOUNDARY_PATTERN);

    if (startMatch) {
      const uid = normalizeCardUid(startMatch[1]);

      // A marker whose captured title is not a legal UID — empty, whitespace
      // only, or longer than the cap — is reported like the malformed markers
      // below rather than opening a boundary the card store cannot address.
      if (!isValidCardUid(uid)) {
        diagnostics.push(
          createDiagnostic('invalid-start-boundary', lineNumber, INVALID_START_BOUNDARY_MESSAGE),
        );
        continue;
      }

      if (activeBoundary) {
        diagnostics.push(
          createDiagnostic(
            'nested-start-boundary',
            lineNumber,
            `Found a nested card start boundary for ${uid} before closing ${activeBoundary.uid}.`,
            uid,
          ),
        );
        continue;
      }

      activeBoundary = { uid, line: lineNumber };
      continue;
    }

    if (line.startsWith('%%CW_CARD_START')) {
      diagnostics.push(
        createDiagnostic('invalid-start-boundary', lineNumber, INVALID_START_BOUNDARY_MESSAGE),
      );
      continue;
    }

    if (endMatch) {
      const uid = normalizeCardUid(endMatch[1]);

      if (!isValidCardUid(uid)) {
        diagnostics.push(
          createDiagnostic('invalid-end-boundary', lineNumber, INVALID_END_BOUNDARY_MESSAGE),
        );
        continue;
      }

      if (!activeBoundary) {
        diagnostics.push(
          createDiagnostic(
            'unmatched-end-boundary',
            lineNumber,
            `Found a closing card boundary for ${uid} without a matching start boundary.`,
            uid,
          ),
        );
        continue;
      }

      if (activeBoundary.uid !== uid) {
        diagnostics.push(
          createDiagnostic(
            'mismatched-boundary-uid',
            lineNumber,
            `Card end boundary for ${uid} does not match the active start boundary ${activeBoundary.uid}.`,
            uid,
          ),
        );
        continue;
      }

      cards.push(buildCard(lines, activeBoundary, lineNumber));
      activeBoundary = null;
      continue;
    }

    if (line.startsWith('%%CW_CARD_END')) {
      diagnostics.push(
        createDiagnostic('invalid-end-boundary', lineNumber, INVALID_END_BOUNDARY_MESSAGE),
      );
    }
  }

  if (activeBoundary) {
    diagnostics.push(
      createDiagnostic(
        'unmatched-start-boundary',
        activeBoundary.line,
        `Card start boundary for ${activeBoundary.uid} does not have a matching end boundary.`,
        activeBoundary.uid,
      ),
    );
  }

  return {
    notePath,
    cards,
    diagnostics,
  };
}
