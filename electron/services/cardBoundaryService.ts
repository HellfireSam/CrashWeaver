import { formatCardEndBoundary, formatCardStartBoundary } from '../cardParser';

export function removeCardBoundaryLines(content: string, uid: string) {
  const startBoundary = formatCardStartBoundary(uid);
  const endBoundary = formatCardEndBoundary(uid);
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const nextLines: string[] = [];
  let removedBoundaryLines = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === startBoundary || line === endBoundary) {
      removedBoundaryLines += 1;
      continue;
    }

    nextLines.push(rawLine);
  }

  return {
    content: nextLines.join('\n'),
    removedBoundaryLines,
  };
}

export function replaceCardBoundaryUids(content: string, previousUid: string, nextUid: string) {
  const previousStartBoundary = formatCardStartBoundary(previousUid);
  const previousEndBoundary = formatCardEndBoundary(previousUid);
  const nextStartBoundary = formatCardStartBoundary(nextUid);
  const nextEndBoundary = formatCardEndBoundary(nextUid);
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let replaced = false;

  const nextLines = lines.map((rawLine) => {
    const line = rawLine.trim();

    if (line === previousStartBoundary) {
      replaced = true;
      return rawLine.replace(previousStartBoundary, nextStartBoundary);
    }

    if (line === previousEndBoundary) {
      replaced = true;
      return rawLine.replace(previousEndBoundary, nextEndBoundary);
    }

    return rawLine;
  });

  return {
    content: nextLines.join('\n'),
    replaced,
  };
}

export function restoreCardBoundaryLines(
  content: string,
  uid: string,
  rawContent: string,
  preferredStartLine: number,
  preferredEndLine: number,
) {
  const startBoundary = formatCardStartBoundary(uid);
  const endBoundary = formatCardEndBoundary(uid);
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const hasStartBoundary = lines.some((rawLine) => rawLine.trim() === startBoundary);
  const hasEndBoundary = lines.some((rawLine) => rawLine.trim() === endBoundary);

  function insertAtSavedLineRange() {
    if (preferredEndLine <= preferredStartLine) {
      return null;
    }

    const startIndex = Math.max(0, Math.min(lines.length, preferredStartLine - 1));
    const expectedBlockLineCount = Math.max(0, preferredEndLine - preferredStartLine - 1);

    if (startIndex + expectedBlockLineCount > lines.length) {
      return null;
    }

    const nextLines = [...lines];
    nextLines.splice(startIndex, 0, startBoundary);

    const endInsertionIndex = Math.max(
      startIndex + 1,
      Math.min(nextLines.length, preferredEndLine - 1),
    );
    nextLines.splice(endInsertionIndex, 0, endBoundary);

    return {
      content: nextLines.join('\n'),
      inserted: true,
      alreadyPresent: false,
    };
  }

  if (hasStartBoundary && hasEndBoundary) {
    return {
      content: lines.join('\n'),
      inserted: false,
      alreadyPresent: true,
    };
  }

  if (hasStartBoundary || hasEndBoundary) {
    return {
      content: lines.join('\n'),
      inserted: false,
      alreadyPresent: false,
    };
  }

  if (!rawContent.length) {
    return insertAtSavedLineRange() ?? {
      content: lines.join('\n'),
      inserted: false,
      alreadyPresent: false,
    };
  }

  const blockLines = rawContent.replace(/\r\n/g, '\n').split('\n');
  const candidateStarts: number[] = [];

  for (let index = 0; index <= lines.length - blockLines.length; index += 1) {
    let matches = true;

    for (let offset = 0; offset < blockLines.length; offset += 1) {
      if (lines[index + offset] !== blockLines[offset]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      candidateStarts.push(index);
    }
  }

  if (candidateStarts.length === 0) {
    return insertAtSavedLineRange() ?? {
      content: lines.join('\n'),
      inserted: false,
      alreadyPresent: false,
    };
  }

  const preferredStartIndex = Math.max(0, preferredStartLine - 1);
  candidateStarts.sort((left, right) => {
    const leftDistance = Math.abs(left - preferredStartIndex);
    const rightDistance = Math.abs(right - preferredStartIndex);

    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }

    return left - right;
  });

  const matchStart = candidateStarts[0];
  const matchEnd = matchStart + blockLines.length;
  const nextLines = [...lines];
  nextLines.splice(matchStart, 0, startBoundary);
  nextLines.splice(matchEnd + 1, 0, endBoundary);

  return {
    content: nextLines.join('\n'),
    inserted: true,
    alreadyPresent: false,
  };
}
