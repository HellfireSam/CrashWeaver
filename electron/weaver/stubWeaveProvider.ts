import type {
  WeavePlanOperation,
  WeavePlanRequest,
  WeavePlanResult,
  WeaveModelInfo,
  WeaveProviderHealth,
} from '../vault-contract';

const STUB_MODEL = 'weaver-stub-v1';

function resolveModel(request: WeavePlanRequest) {
  return request.preferredModel?.trim() || STUB_MODEL;
}

function slugify(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'proposal';
}

function buildBoundaryBlock(cardUid: string) {
  return [
    `%%CW_CARD_START uid:${cardUid}%%`,
    `Staged context for ${cardUid}.`,
    `%%CW_CARD_END uid:${cardUid}%%`,
  ].join('\n');
}

function buildVaultNotePath(request: WeavePlanRequest) {
  if (request.activeNotePath) {
    return request.activeNotePath;
  }
  return `notes/${slugify(request.intent || request.cardUid || 'weaver-proposal')}.md`;
}

function buildGuidedInsertCreateNoteOperation(request: WeavePlanRequest, targetPath: string): WeavePlanOperation {
  const title = request.intent?.trim() || `Card ${request.cardUid}`;

  return {
    kind: 'create-note',
    targetPath,
    payload: {
      cardUid: request.cardUid,
      title,
      content: [
        `# ${title}`,
        '',
        `This note gives ${request.cardUid} a dedicated place in the vault and explains why it belongs here.`,
        '',
        buildBoundaryBlock(request.cardUid),
        '',
        '## Why this note exists',
        '',
        'It captures the focused crashpad idea in a note that can accumulate references, examples, and follow-up structure.',
      ].join('\n'),
    },
    rationale: 'Create a real vault note that can host the focused card with supporting prose around it.',
  };
}

function buildPlanOperations(request: WeavePlanRequest) {
  const operations: WeavePlanOperation[] = [];
  const notePath = buildVaultNotePath(request);
  const boundaryBlock = buildBoundaryBlock(request.cardUid);
  const proposalSlug = slugify(request.intent || request.cardUid || 'weaver');

  if (request.kind === 'guided-insert') {
    operations.push({
      kind: 'insert-boundary-pair',
      targetPath: notePath,
      payload: {
        cardUid: request.cardUid,
        placement: request.selectedText ? 'after-selection' : 'append-to-note',
        boundaryBlock,
        ...(request.selectedText ? { selectedText: request.selectedText } : {}),
      },
      rationale: 'Insert the focused card into a vault note without mutating crashpad content.',
    });

    if (request.permissions.editContent) {
      operations.push({
        kind: 'edit-note-content',
        targetPath: notePath,
        payload: {
          action: request.selectedText ? 'replace-selection' : 'insert-after-heading',
          targetText: request.selectedText || '# Related cards',
          replacementMarkdown: [
            request.selectedText || '# Related cards',
            '',
            `This section now anchors ${request.cardUid} inside the note so the surrounding prose explains why the card belongs here.`,
          ].join('\n'),
        },
        rationale: 'Edit the surrounding note prose so the staged insertion reads as an intentional part of the note.',
      });
    }

    if (request.permissions.createNote) {
      operations.push(buildGuidedInsertCreateNoteOperation(request, `notes/${proposalSlug}-guide.md`));
    }

    return operations;
  }

  const workspaceDirectoryPath = `notes/weaver/${proposalSlug}`;
  const renamedDirectoryPath = `notes/knowledge/${proposalSlug}`;
  const renamedNotePath = `notes/${proposalSlug}-reference.md`;
  const movedNotePath = `${renamedDirectoryPath}/${proposalSlug}-reference.md`;
  const createdNotePath = `${renamedDirectoryPath}/${proposalSlug}-overview.md`;

  operations.push({
    kind: 'insert-boundary-pair',
    targetPath: notePath,
    payload: {
      cardUid: request.cardUid,
      placement: request.selectedText ? 'after-selection' : 'append-to-note',
      boundaryBlock,
      ...(request.selectedText ? { selectedText: request.selectedText } : {}),
    },
    rationale: 'Anchor the focused card in an existing note before proposing broader restructuring around it.',
  });
  operations.push({
    kind: 'edit-note-content',
    targetPath: notePath,
    payload: {
      action: request.selectedText ? 'replace-selection' : 'insert-after-heading',
      targetText: request.selectedText || '# Related cards',
      replacementMarkdown: [
        request.selectedText || '# Related cards',
        '',
        `This note now frames ${request.cardUid} as part of a clearer vault structure with explicit follow-up material.`,
      ].join('\n'),
    },
    rationale: 'Intelligent mode can reshape surrounding prose when that makes the inserted card easier to understand.',
  });

  if (request.strength === 'light') {
    return operations;
  }

  operations.push({
    kind: 'create-directory',
    targetPath: workspaceDirectoryPath,
    payload: {
      purpose: 'Create a focused folder for the note cluster built around the selected card.',
    },
    rationale: 'Standard intelligent planning may create a directory when the card deserves a clearer home in the vault.',
  });
  operations.push({
    kind: 'rename-note',
    targetPath: renamedNotePath,
    payload: {
      fromPath: notePath,
      toPath: renamedNotePath,
      renameReason: 'Rename the note so its title reflects the focused card and the new vault role it should play.',
    },
    rationale: 'Rename the note to make its purpose obvious in search and navigation.',
  });
  operations.push({
    kind: 'move-note',
    targetPath: movedNotePath,
    payload: {
      fromPath: renamedNotePath,
      toPath: movedNotePath,
      moveReason: 'Move the renamed note into the dedicated working directory for this topic.',
    },
    rationale: 'Move the renamed note beside related material so the cluster becomes easier to browse.',
  });
  operations.push(buildGuidedInsertCreateNoteOperation({ ...request, kind: 'guided-insert', permissions: { editContent: false, createNote: true } }, createdNotePath));

  if (request.strength === 'go-ham') {
    operations.push({
      kind: 'rename-directory',
      targetPath: renamedDirectoryPath,
      payload: {
        fromPath: workspaceDirectoryPath,
        toPath: renamedDirectoryPath,
        renameReason: 'Rename the working directory once the card cluster has a clearer long-term knowledge role.',
      },
      rationale: 'Go Ham can rename the supporting directory when it substantially improves the vault taxonomy.',
    });
    operations.push({
      kind: 'move-directory',
      targetPath: `archive/${proposalSlug}`,
      payload: {
        fromPath: renamedDirectoryPath,
        toPath: `archive/${proposalSlug}`,
        moveReason: 'Move the directory when a different parent folder better matches the vault structure.',
      },
      rationale: 'Go Ham can relocate entire directories when the broader structure is worth the churn.',
    });
    operations.push({
      kind: 'delete-note',
      targetPath: `notes/archive/${proposalSlug}-scratch.md`,
      payload: {
        deleteReason: 'Remove the stale scratch note after its useful content is consolidated into the reworked cluster.',
      },
      rationale: 'Go Ham may delete a redundant note when it no longer contributes unique value after consolidation.',
    });
    operations.push({
      kind: 'delete-directory',
      targetPath: `notes/weaver/${proposalSlug}-staging`,
      payload: {
        deleteReason: 'Delete the obsolete staging directory once the proposed structure supersedes it.',
      },
      rationale: 'Go Ham may delete an empty or obsolete staging folder after the new structure replaces it.',
    });
  }

  return operations;
}

export class StubWeaveProvider {
  async generatePlan(request: WeavePlanRequest): Promise<WeavePlanResult> {
    const operations = buildPlanOperations(request).slice(0, request.maxOperations);
    const resolvedModel = resolveModel(request);
    const warnings: string[] = [
      `Crashpad context ${request.activeCrashpadId} is source-only — no crashpad file is ever targeted by this plan.`,
      'This is a Stage 5 stub plan. No filesystem writes occur until a later approval layer exists.',
    ];
    const plan = request.kind === 'guided-insert'
      ? {
          kind: 'guided-insert' as const,
          permissions: request.permissions,
          summary: `Stub Weaver staged ${operations.length} operation${operations.length === 1 ? '' : 's'} for focused card ${request.cardUid} from ${request.activeCrashpadId}.`,
          operations,
          warnings,
          referencedCards: [request.cardUid],
        }
      : {
          kind: 'intelligent' as const,
          strength: request.strength,
          summary: `Stub Weaver staged ${operations.length} operation${operations.length === 1 ? '' : 's'} for focused card ${request.cardUid} from ${request.activeCrashpadId}.`,
          operations,
          warnings,
          referencedCards: [request.cardUid],
        };

    return {
      plan,
      model: resolvedModel,
      provider: 'stub',
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
      latencyMs: 1,
    };
  }

  async healthCheck(): Promise<WeaveProviderHealth> {
    return {
      ok: true,
      provider: 'stub',
      configured: true,
      model: STUB_MODEL,
      message: 'Stub Weaver provider is ready for read-only vault planning scaffolding.',
    };
  }

  async listModels(): Promise<WeaveModelInfo[]> {
    // Curated set returned when no live API key is configured.
    return [
      { id: 'deepseek/deepseek-v3-base:free', name: 'DeepSeek V3 Base', costLabel: 'Free', isFree: true },
      { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1', costLabel: 'Free', isFree: true },
      { id: 'meta-llama/llama-4-scout:free', name: 'Llama 4 Scout', costLabel: 'Free', isFree: true },
      { id: 'meta-llama/llama-4-maverick:free', name: 'Llama 4 Maverick', costLabel: 'Free', isFree: true },
      { id: 'google/gemma-3-27b-it:free', name: 'Gemma 3 27B', costLabel: 'Free', isFree: true },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', costLabel: '$0.15/M', isFree: false, contextLength: 128000 },
      { id: 'openai/gpt-4o', name: 'GPT-4o', costLabel: '$5/M', isFree: false, contextLength: 128000 },
      { id: 'anthropic/claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', costLabel: '$3/M', isFree: false, contextLength: 200000 },
      { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5', costLabel: '$3/M', isFree: false, contextLength: 200000 },
      { id: 'google/gemini-flash-1.5', name: 'Gemini Flash 1.5', costLabel: '$0.08/M', isFree: false, contextLength: 1000000 },
      { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', costLabel: '$1.25/M', isFree: false, contextLength: 1000000 },
    ];
  }
}