const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const settingsService = require('../../dist-electron/settingsService.js');
const vaultService = require('../../dist-electron/vaultService.js');
const { writeVaultIndex } = require('../../dist-electron/services/vaultIndexService.js');
const {
  buildWeaveContextSnapshot,
  createWeaveContextToolRuntime,
} = require('../../dist-electron/weaver/weaveContextService.js');

function createGuidedRequest(rootPath, overrides = {}) {
  return {
    rootPath,
    kind: 'guided-insert',
    preferredModel: 'openai/gpt-4o',
    intent: 'Place the reliability playbook near the current testing note.',
    cardUid: 'CW-RETRIEVE-1',
    permissions: {
      editContent: true,
      createNote: false,
    },
    activeNotePath: 'projects/testing.md',
    activeCrashpadId: 'cp-1',
    activeCrashpadPath: '.crashweaver/crashpads/cp-1.crashpad.json',
    maxOperations: 8,
    ...overrides,
  };
}

async function writeNote(rootPath, filePath, content) {
  const absolutePath = path.join(rootPath, ...filePath.split('/'));
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf8');
  return vaultService.readNote(rootPath, filePath);
}

async function createIndexedVault(rootPath) {
  const notes = await Promise.all([
    writeNote(
      rootPath,
      'knowledge/reliability-playbook.md',
      [
        '# Reliability Playbook',
        '',
        'Stage 5 planning needs deterministic note retrieval.',
        'Keep read-only retrieval bounded and explicit.',
        'Use focused card references to pick the right note.',
      ].join('\n'),
    ),
    writeNote(
      rootPath,
      'projects/testing.md',
      [
        '# Testing',
        '',
        'The current active note talks about deterministic integration coverage.',
        'Reliability work should stay close to the testing cluster.',
      ].join('\n'),
    ),
    writeNote(
      rootPath,
      'knowledge/reliability-review.md',
      [
        '# Reliability Review',
        '',
        '#reliability #testing',
        'A second note with overlapping terminology.',
      ].join('\n'),
    ),
    writeNote(
      rootPath,
      'archive/misc.md',
      [
        '# Misc',
        '',
        'Unrelated archive material.',
      ].join('\n'),
    ),
  ]);
  const indexPath = path.join(rootPath, '.crashweaver', 'index.json');
  const legacyPath = path.join(rootPath, 'index.json');

  await writeVaultIndex(indexPath, legacyPath, notes);
}

test('buildWeaveContextSnapshot prioritizes references, active note, and keyword overlap', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-weave-context-'));
  const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
  const rootPath = path.join(tempDir, 'vault-root');

  await fs.mkdir(rootPath, { recursive: true });

  settingsService.__resetSettingsMutationQueueForTests();
  settingsService.__setSettingsFilePathForTests(settingsPath);

  try {
    const createdCard = await vaultService.createCard(rootPath, 'CW-RETRIEVE-1');

    await vaultService.saveCard(rootPath, {
      ...createdCard,
      type: ['reliability', 'testing'],
      raw_content: 'Reliability playbook for deterministic test coverage and note retrieval.',
      referenced_in: [
        { note_path: 'knowledge/reliability-playbook.md', start_line: 2, end_line: 4 },
      ],
    });
    await createIndexedVault(rootPath);

    const snapshot = await buildWeaveContextSnapshot(createGuidedRequest(rootPath));
    const candidatePaths = snapshot.candidateNotes.map((note) => note.filePath);

    assert.equal(candidatePaths[0], 'knowledge/reliability-playbook.md');
    assert.ok(candidatePaths.includes('projects/testing.md'));
    assert.ok(candidatePaths.includes('knowledge/reliability-review.md'));

    const referencedNote = snapshot.candidateNotes.find((note) => note.filePath === 'knowledge/reliability-playbook.md');
    const activeNote = snapshot.candidateNotes.find((note) => note.filePath === 'projects/testing.md');

    assert.ok(referencedNote);
    assert.ok(activeNote);
    assert.ok(referencedNote.score > activeNote.score);
    assert.match(referencedNote.reasons.join(' '), /already references this note/i);
    assert.match(activeNote.reasons.join(' '), /active note context/i);
  } finally {
    settingsService.__setSettingsFilePathForTests(null);
    settingsService.__resetSettingsMutationQueueForTests();
  }
});

test('WeaveContextToolRuntime enforces bounded note reads and truncates excerpts', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-weave-runtime-'));
  const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
  const rootPath = path.join(tempDir, 'vault-root');

  await fs.mkdir(rootPath, { recursive: true });

  settingsService.__resetSettingsMutationQueueForTests();
  settingsService.__setSettingsFilePathForTests(settingsPath);

  try {
    const createdCard = await vaultService.createCard(rootPath, 'CW-RETRIEVE-1');

    await vaultService.saveCard(rootPath, {
      ...createdCard,
      type: ['reliability'],
      raw_content: 'Reliability playbook for deterministic test coverage and note retrieval.',
      referenced_in: [
        { note_path: 'knowledge/reliability-playbook.md', start_line: 2, end_line: 4 },
      ],
    });
    await createIndexedVault(rootPath);

    const snapshot = await buildWeaveContextSnapshot(createGuidedRequest(rootPath));
    const runtime = createWeaveContextToolRuntime(snapshot, {
      maxNoteReads: 1,
      maxExcerptChars: 90,
      maxFullNoteChars: 140,
      maxRetrievedChars: 110,
    });

    const excerptResult = await runtime.execute('read_note_excerpt', {
      filePath: 'knowledge/reliability-playbook.md',
      maxChars: 400,
    });

    assert.equal(excerptResult.ok, true);
    assert.equal(excerptResult.toolName, 'read_note_excerpt');
    assert.match(excerptResult.data.content, /deterministic note retrieval/i);
    assert.ok(excerptResult.data.content.length <= 90);

    const fullReadAfterBudget = await runtime.execute('read_note_full', {
      filePath: 'projects/testing.md',
      maxChars: 400,
    });

    assert.equal(fullReadAfterBudget.ok, false);
    assert.match(fullReadAfterBudget.error, /note-read budget is exhausted/i);
  } finally {
    settingsService.__setSettingsFilePathForTests(null);
    settingsService.__resetSettingsMutationQueueForTests();
  }
});