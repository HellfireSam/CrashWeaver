import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The main-process suites run against the compiled CommonJS output, not the
// TypeScript source, so `npm test` builds the main process first.
const require = createRequire(import.meta.url);
const settingsService = require('../../dist-electron/settingsService.js');
const vaultService = require('../../dist-electron/vaultService.js');
const { writeVaultIndex } = require('../../dist-electron/services/vaultIndexService.js');
const { buildWeaveContextSnapshot } = require('../../dist-electron/weaver/weaveContextService.js');
const { OpenRouterWeaveProvider } = require('../../dist-electron/weaver/openRouterClient.js');

describe('openRouterClient', () => {
  function createGuidedRequest(rootPath: string, overrides: Record<string, unknown> = {}) {
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

  function createChatResponse(
    content: string,
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } = {
      prompt_tokens: 11,
      completion_tokens: 7,
      total_tokens: 18,
    },
  ) {
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

  function createFetchSequence(steps: unknown[]) {
    const calls: Array<{ url: string; init: { body: string } }> = [];
    const queue = [...steps];

    return {
      calls,
      fetchImpl: async (url: string, init: { body: string }) => {
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

  async function writeNote(rootPath: string, filePath: string, content: string) {
    const absolutePath = path.join(rootPath, ...filePath.split('/'));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf8');
    return vaultService.readNote(rootPath, filePath);
  }

  async function snapshotWorkspaceFiles(rootPath: string) {
    const files: Record<string, string> = {};

    async function walk(currentPath: string) {
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
      referenced_in: [{ note_path: 'notes/topic.md', start_line: 2, end_line: 4 }],
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
        ['# Adjacent', '', 'Secondary candidate note.'].join('\n'),
      ),
    ]);
    await writeVaultIndex(
      path.join(rootPath, '.crashweaver', 'index.json'),
      path.join(rootPath, 'index.json'),
      notes,
    );

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

  it('OpenRouterWeaveProvider maps auth failures to auth-error', async () => {
    const fixture = await createProviderFixture();

    try {
      const { fetchImpl } = createFetchSequence([new Response('forbidden', { status: 401 })]);
      const provider = new OpenRouterWeaveProvider('test-key', 'openai/gpt-4o', undefined, {
        fetchImpl,
      });

      await expect(provider.generatePlan(fixture.request, fixture.snapshot)).rejects.toMatchObject({
        errorCategory: 'auth-error',
      });
    } finally {
      fixture.dispose();
    }
  });

  it('OpenRouterWeaveProvider surfaces provider-timeout when the chat request times out', async () => {
    const fixture = await createProviderFixture();

    try {
      // Simulate a real AbortError (which has name: 'AbortError')
      const abortError = new Error('The operation was aborted.');
      abortError.name = 'AbortError';

      const { fetchImpl } = createFetchSequence([abortError]);
      const provider = new OpenRouterWeaveProvider('test-key', 'openai/gpt-4o', undefined, {
        fetchImpl,
      });

      await expect(provider.generatePlan(fixture.request, fixture.snapshot)).rejects.toMatchObject({
        errorCategory: 'provider-timeout',
      });
    } finally {
      fixture.dispose();
    }
  });

  it('OpenRouterWeaveProvider reports schema-error when the model response is not JSON', async () => {
    const fixture = await createProviderFixture();

    try {
      const { fetchImpl } = createFetchSequence([createChatResponse('this is not json at all')]);
      const provider = new OpenRouterWeaveProvider('test-key', 'openai/gpt-4o', undefined, {
        fetchImpl,
      });

      await expect(provider.generatePlan(fixture.request, fixture.snapshot)).rejects.toMatchObject({
        errorCategory: 'schema-error',
      });
    } finally {
      fixture.dispose();
    }
  });

  it('OpenRouterWeaveProvider completes a read-only tool loop and leaves workspace files untouched', async () => {
    const fixture = await createProviderFixture();

    try {
      const requestLogsDirectory = path.join(
        fixture.rootPath,
        '.crashweaver',
        'weaver-request-logs',
      );
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
              summary:
                'Insert the focused card into the existing topic note without changing surrounding prose.',
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
                  rationale:
                    'Append the focused card to the topic note that already references it.',
                },
              ],
              warnings: [],
              referencedCards: ['CW-LIVE-1'],
            },
          }),
        ),
      ]);
      const provider = new OpenRouterWeaveProvider('test-key', 'openai/gpt-4o', undefined, {
        fetchImpl,
      });

      const result = await provider.generatePlan(fixture.request, fixture.snapshot, {
        requestLogDirectory: requestLogsDirectory,
      });
      const afterFiles = await snapshotWorkspaceFiles(fixture.rootPath);
      const afterFilesWithoutLogs = Object.fromEntries(
        Object.entries(afterFiles).filter(
          ([relativePath]) => !relativePath.startsWith('.crashweaver/weaver-request-logs/'),
        ),
      );
      const secondRequestBody = JSON.parse(Buffer.from(calls[1].init.body).toString('utf8'));
      const lastMessage = secondRequestBody.messages[secondRequestBody.messages.length - 1];
      const logFiles = await fs.readdir(requestLogsDirectory);
      const logPath = path.join(requestLogsDirectory, logFiles[0]);
      const logLines = (await fs.readFile(logPath, 'utf8')).trim().split(/\r?\n/g);
      const logEvents = logLines.map((line) => JSON.parse(line).event);

      expect(result.plan.kind).toBe('guided-insert');
      expect(result.plan.operations[0].targetPath).toBe('notes/topic.md');
      expect(result.usage.totalTokens).toBe(36);
      expect(lastMessage.content).toMatch(
        /Tool result for read_note_excerpt|TOOL RESULT: read_note_excerpt/,
      );
      expect(lastMessage.content).toMatch(
        /Deterministic topic note for live provider retrieval tests/i,
      );
      expect(logFiles.length >= 1).toBeTruthy();
      expect(logEvents.includes('session-start') || logEvents.includes('graph-start')).toBeTruthy();
      expect(
        logEvents.includes('openrouter-request') || logEvents.includes('node-call-model'),
      ).toBeTruthy();
      expect(
        logEvents.includes('tool-executed') || logEvents.includes('node-execute-tool'),
      ).toBeTruthy();
      expect(
        logEvents.includes('final-plan-accepted') || logEvents.includes('graph-complete'),
      ).toBeTruthy();
      expect(afterFilesWithoutLogs).toEqual(beforeFiles);
    } finally {
      fixture.dispose();
    }
  });
});
