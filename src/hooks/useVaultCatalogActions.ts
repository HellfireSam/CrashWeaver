import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { CardDocument } from '../../electron/vault-contract';

type UseVaultCatalogActionsOptions = {
  setAllCards: Dispatch<SetStateAction<CardDocument[]>>;
  setInternalDirectories: Dispatch<SetStateAction<string[]>>;
};

export function useVaultCatalogActions({
  setAllCards,
  setInternalDirectories,
}: UseVaultCatalogActionsOptions) {
  const refreshCardsCatalog = useCallback(
    async (rootPath: string) => {
      const cards = await window.crashWeaver.listCards(rootPath);
      setAllCards(cards);
      return cards;
    },
    [setAllCards],
  );

  const refreshInternalDirectories = useCallback(
    async (rootPath: string) => {
      const directories = await window.crashWeaver.listInternalDirectories(rootPath);
      setInternalDirectories(directories);
      return directories;
    },
    [setInternalDirectories],
  );

  return {
    refreshCardsCatalog,
    refreshInternalDirectories,
  };
}
