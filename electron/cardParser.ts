import type { CardParseDiagnostic, ParsedCrashCard, ParsedCrashCardsNote } from './vault-contract';

const START_BOUNDARY_PATTERN = /^%%CW_CARD_START\s+uid:([A-Za-z0-9_-]+)%%$/;
const END_BOUNDARY_PATTERN = /^%%CW_CARD_END\s+uid:([A-Za-z0-9_-]+)%%$/;

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

function buildCard(lines: string[], startBoundary: ActiveBoundary, endLine: number): ParsedCrashCard {
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
      const uid = startMatch[1];

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
        createDiagnostic(
          'invalid-start-boundary',
          lineNumber,
          'Card start boundary must follow the format %%CW_CARD_START uid:<UID>%%.',
        ),
      );
      continue;
    }

    if (endMatch) {
      const uid = endMatch[1];

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
        createDiagnostic(
          'invalid-end-boundary',
          lineNumber,
          'Card end boundary must follow the format %%CW_CARD_END uid:<UID>%%.',
        ),
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