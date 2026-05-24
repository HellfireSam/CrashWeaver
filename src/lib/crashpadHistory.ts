import type { CardDeleteResult, CardDocument } from '../../electron/vault-contract';

export type CrashpadDeleteRequest = {
  confirmed: boolean;
};

export type CrashpadHistoryEntry =
  | { kind: 'attach-existing'; uid: string }
  | { kind: 'create-new'; uid: string }
  | { kind: 'update-card'; before: CardDocument; after: CardDocument }
  | {
      kind: 'delete-card';
      card: CardDocument;
      origin: 'existing' | 'new';
      deletedAt: string;
      removeNoteBoundaries: boolean;
      deleteResult: CardDeleteResult;
    };
