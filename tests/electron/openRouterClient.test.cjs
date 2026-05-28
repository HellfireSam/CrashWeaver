const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const settingsService = require('../../dist-electron/settingsService.js');
const vaultService = require('../../dist-electron/vaultService.js');
const { writeVaultIndex } = require('../../dist-electron/services/vaultIndexService.js');
const { buildWeaveContextSnapshot } = require('../../dist-electron/weaver/weaveContextService.js');
const { OpenRouterWeaveProvider } = require('../../dist-electron/weaver/openRouterClient.js');

function createGuidedRequest(rootPath, overrides = {}) {
  return {
    rootPath,
    kind: 'guided-insert',
    preferredModel: 'openai/gpt-4o',
    intent: 'Place the focused card into the topic note.',
    cardUid: 'CW-LIVE-1',
    permissions: {
      editContent: false,
      createNote: false,
    },
    activeNotePath: 'notes/topic.md',
    activeCrashpadId: 'cp-live',
    activeCrashpadPath: '.crashweaver/crashpads/cp-live.crashpad.json',
    maxOperations: 8,
    ...overrides,
  };
}

function createChatResponse(content, usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 }) {
  return new Response(
    JSON.stringify({
      model: 'openai/gpt-4o',
      choices: [
        {
          message: {
            role: 'assistant',
            content,
          },
          finish_reason: 'stop',
        },
      ],
      usage,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    },
  );
}

function createFetchSequence(steps) {
  const calls = [];
  const queue = [...steps];

  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });

      if (!queue.length) {
        throw new Error('Unexpected extra fetch call.');
      }

      const next = queue.shift();

      if (next instanceof Error) {
        throw next;
      }

      if (typeof next === 'function') {
        return next(url, init);
      }

      return next;
    },
  };
}

async function writeNote(rootPath, filePath, content) {
  const absolutePath = path.join(rootPath, ...filePath.split('/'));
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf8');
  return vaultService.readNote(rootPath, filePath);
}

async function snapshotWorkspaceFiles(rootPath) {
  const files = {};

  async function walk(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join('/');
      files[relativePath] = await fs.readFile(absolutePath, 'utf8');
    }
  }

  await walk(rootPath);
  return files;
}

async function createProviderFixture() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-openrouter-'));
  const settingsPath = path.join(tempDir, 'crashweaver-settings.json');
  const rootPath = path.join(tempDir, 'vault-root');

  await fs.mkdir(rootPath, { recursive: true });

  settingsService.__resetSettingsMutationQueueForTests();
  settingsService.__setSettingsFilePathForTests(settingsPath);

  const createdCard = await vaultService.createCard(rootPath, 'CW-LIVE-1');

  await vaultService.saveCard(rootPath, {
    ...createdCard,
    type: ['topic'],
    raw_content: 'Focused topic card content.',
    referenced_in: [
      { note_path: 'notes/topic.md', start_line: 2, end_line: 4 },
    ],
  });

  const notes = await Promise.all([
    writeNote(
      rootPath,
      'notes/topic.md',
      [
        '# Topic',
        '',
        'Deterministic topic note for live provider retrieval tests.',
        'It should be read but never modified during Stage 5 planning.',
      ].join('\n'),
    ),
    writeNote(
      rootPath,
      'notes/adjacent.md',
      [
        '# Adjacent',
        '',
        'Secondary candidate note.',
      ].join('\n'),
    ),
  ]);
  await writeVaultIndex(path.join(rootPath, '.crashweaver', 'index.json'), path.join(rootPath, 'index.json'), notes);

  const request = createGuidedRequest(rootPath);
  const snapshot = await buildWeaveContextSnapshot(request);

  return {
    rootPath,
    request,
    snapshot,
    dispose() {
      settingsService.__setSettingsFilePathForTests(null);
      settingsService.__resetSettingsMutationQueueForTests();
    },
  };
}

test('OpenRouterWeaveProvider maps auth failures to auth-error', async () => {
  const fixture = await createProviderFixture();

  try {
    const { fetchImpl } = createFetchSequence([
      new Response('forbidden', { status: 401 }),
    ]);
    const provider = new OpenRouterWeaveProvider('test-key', 'openai/gpt-4o', undefined, { fetchImpl });

    await assert.rejects(
      provider.generatePlan(fixture.request, fixture.snapshot),
      (error) => error && error.errorCategory === 'auth-error',
    );
  } finally {
    fixture.dispose();
  }
});

test('OpenRouterWeaveProvider surfaces provider-timeout when the chat request times out', async () => {
  const fixture = await createProviderFixture();

  try {
    const { fetchImpl } = createFetchSequence([
      new Error('provider-timeout'),
    ]);
    const provider = new OpenRouterWeaveProvider('test-key', 'openai/gpt-4o', undefined, { fetchImpl });

    await assert.rejects(
      provider.generatePlan(fixture.request, fixture.snapshot),
      (error) => error && error.errorCategory === 'provider-timeout',
    );
  } finally {
    fixture.dispose();
  }
});

test('OpenRouterWeaveProvider reports schema-error when the model response is not JSON', async () => {
  const fixture = await createProviderFixture();

  try {
    const { fetchImpl } = createFetchSequence([
      createChatResponse('this is not json at all'),
    ]);
    const provider = new OpenRouterWeaveProvider('test-key', 'openai/gpt-4o', undefined, { fetchImpl });

    await assert.rejects(
      provider.generatePlan(fixture.request, fixture.snapshot),
      (error) => error && error.errorCategory === 'schema-error',
    );
  } finally {
    fixture.dispose();
  }
});

test('OpenRouterWeaveProvider completes a read-only tool loop and leaves workspace files untouched', async () => {
  const fixture = await createProviderFixture();

  try {
    const requestLogsDirectory = path.join(fixture.rootPath, '.crashweaver', 'weaver-request-logs');
    const beforeFiles = await snapshotWorkspaceFiles(fixture.rootPath);
    const { fetchImpl, calls } = createFetchSequence([
      createChatResponse(
        JSON.stringify({
          type: 'tool',
          toolName: 'read_note_excerpt',
          arguments: {
            filePath: 'notes/topic.md',
            maxChars: 240,
          },
        }),
      ),
      createChatResponse(
        JSON.stringify({
          type: 'final',
          plan: {
            kind: 'guided-insert',
            permissions: {
              editContent: false,
              createNote: false,
            },
            summary: 'Insert the focused card into the existing topic note without changing surrounding prose.',
            operations: [
              {
                kind: 'insert-boundary-pair',
                targetPath: 'notes/topic.md',
                payload: {
                  cardUid: 'CW-LIVE-1',
                  placement: 'append-to-note',
                  boundaryBlock: [
                    '%%CW_CARD_START uid:CW-LIVE-1%%',
                    'Focused topic card content.',
                    '%%CW_CARD_END uid:CW-LIVE-1%%',
                  ].join('\n'),
                },
                rationale: 'Append the focused card to the topic note that already references it.',
              },
            ],
            warnings: [],
            referencedCards: ['CW-LIVE-1'],
          },
        }),
      ),
    ]);
    const provider = new OpenRouterWeaveProvider('test-key', 'openai/gpt-4o', undefined, { fetchImpl });

    const result = await provider.generatePlan(fixture.request, fixture.snapshot, {
      requestLogDirectory: requestLogsDirectory,
    });
    const afterFiles = await snapshotWorkspaceFiles(fixture.rootPath);
    const afterFilesWithoutLogs = Object.fromEntries(
      Object.entries(afterFiles).filter(([relativePath]) => !relativePath.startsWith('.crashweaver/weaver-request-logs/')),
    );
    const secondRequestBody = JSON.parse(Buffer.from(calls[1].init.body).toString('utf8'));
    const lastMessage = secondRequestBody.messages[secondRequestBody.messages.length - 1];
    const logFiles = await fs.readdir(requestLogsDirectory);
    const logPath = path.join(requestLogsDirectory, logFiles[0]);
    const logLines = (await fs.readFile(logPath, 'utf8')).trim().split(/\r?\n/g);
    const logEvents = logLines.map((line) => JSON.parse(line).event);

    assert.equal(result.plan.kind, 'guided-insert');
    assert.equal(result.plan.operations[0].targetPath, 'notes/topic.md');
    assert.equal(result.usage.totalTokens, 36);
    assert.match(lastMessage.content, /Tool result for read_note_excerpt/);
    assert.match(lastMessage.content, /Deterministic topic note for live provider retrieval tests/i);
    assert.ok(logFiles.length >= 1);
    assert.ok(logEvents.includes('session-start'));
    assert.ok(logEvents.includes('openrouter-request'));
    assert.ok(logEvents.includes('tool-executed'));
    assert.ok(logEvents.includes('final-plan-accepted'));
    assert.deepEqual(afterFilesWithoutLogs, beforeFiles);
  } finally {
    fixture.dispose();
  }
});