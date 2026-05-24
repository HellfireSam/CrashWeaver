import { useEffect, useRef, useState } from 'react';
import type {
  CardDocument,
  CardQaPair,
} from '../../electron/vault-contract';
import type { CardViewRecord } from '../lib/cards';

export type AddCardMode = 'attach' | 'create';

type DeleteRequest = {
  confirmed: boolean;
};

type UseCrashpadCardEditorOptions = {
  focusedCard: CardViewRecord | null;
  onAttachExistingCard: (uid: string) => Promise<boolean>;
  onCreateNewCard: (uid: string) => Promise<boolean>;
  onDeleteFocusedCard: (request: DeleteRequest) => Promise<boolean>;
  onSaveFocusedCard: (card: CardDocument) => Promise<void>;
};

function buildEditableCard(record: CardViewRecord): CardDocument {
  return {
    uid: record.uid,
    type: record.type,
    raw_content: record.rawContent,
    metadata: record.metadata,
    memory_tricks: record.memoryTricks,
    referenced_in: record.references,
  };
}

export function useCrashpadCardEditor({
  focusedCard,
  onAttachExistingCard,
  onCreateNewCard,
  onDeleteFocusedCard,
  onSaveFocusedCard,
}: UseCrashpadCardEditorOptions) {
  const copyEmbedTimerRef = useRef<number | null>(null);

  const [cardUid, setCardUid] = useState('');
  const [rawContent, setRawContent] = useState('');
  const [typeCsv, setTypeCsv] = useState('');
  const [familiarity, setFamiliarity] = useState('0');
  const [nextReview, setNextReview] = useState('');
  const [memoryTechnique, setMemoryTechnique] = useState('');
  const [qaPairs, setQaPairs] = useState<CardQaPair[]>([]);
  const [copyEmbedFeedback, setCopyEmbedFeedback] = useState(false);

  const [isAddCardOpen, setIsAddCardOpen] = useState(false);
  const [addCardMode, setAddCardMode] = useState<AddCardMode>('attach');
  const [addCardUid, setAddCardUid] = useState('');

  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);

  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (copyEmbedTimerRef.current !== null) {
        window.clearTimeout(copyEmbedTimerRef.current);
      }
    };
  }, []);

  function resetDeleteConfirmation() {
    setDeleteConfirmed(false);
  }

  function resetEditorForm() {
    setCardUid('');
    setRawContent('');
    setTypeCsv('');
    setFamiliarity('0');
    setNextReview('');
    setMemoryTechnique('');
    setQaPairs([]);
    setIsDeleteOpen(false);
    resetDeleteConfirmation();
    setFormError(null);
  }

  useEffect(() => {
    if (!focusedCard) {
      resetEditorForm();
      return;
    }

    setCardUid(focusedCard.uid);
    setRawContent(focusedCard.rawContent);
    setTypeCsv(focusedCard.type.join(', '));
    setFamiliarity(String(focusedCard.metadata.familiarity));
    setNextReview(focusedCard.metadata.next_review ?? '');
    setMemoryTechnique(focusedCard.memoryTricks.memory_technique);
    setQaPairs(focusedCard.memoryTricks.qa_pairs.map((pair) => ({ ...pair })));
    setIsDeleteOpen(false);
    resetDeleteConfirmation();
    setFormError(null);
  }, [focusedCard?.uid]);

  function setAddMode(mode: AddCardMode) {
    setAddCardMode(mode);
    setAddCardUid('');
  }

  function updateQaPair(index: number, updates: Partial<CardQaPair>) {
    setQaPairs((previous) =>
      previous.map((pair, pairIndex) => (pairIndex === index ? { ...pair, ...updates } : pair)),
    );
  }

  function removeQaPair(index: number) {
    setQaPairs((previous) => previous.filter((_, pairIndex) => pairIndex !== index));
  }

  function closeAddCardForm() {
    setAddCardUid('');
    setIsAddCardOpen(false);
  }

  function closeDeleteForm() {
    setIsDeleteOpen(false);
    resetDeleteConfirmation();
  }

  async function handleSave() {
    if (!focusedCard) {
      return;
    }

    setFormError(null);

    try {
      const normalizedType = typeCsv
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

      const nextCard: CardDocument = {
        ...buildEditableCard(focusedCard),
        uid: cardUid.trim() || focusedCard.uid,
        type: normalizedType,
        raw_content: rawContent,
        metadata: {
          familiarity: Number.isFinite(Number(familiarity)) ? Number(familiarity) : 0,
          next_review: nextReview.trim() || null,
        },
        memory_tricks: {
          memory_technique: memoryTechnique,
          qa_pairs: qaPairs,
        },
      };

      await onSaveFocusedCard(nextCard);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to save card.');
    }
  }

  async function handleCopyEmbed() {
    if (!focusedCard) {
      return;
    }

    const embedUid = cardUid.trim() || focusedCard.uid;
    const embed = `%%CW_CARD_START uid:${embedUid}%%\n\n%%CW_CARD_END uid:${embedUid}%%`;
    await navigator.clipboard.writeText(embed);
    setCopyEmbedFeedback(true);

    if (copyEmbedTimerRef.current !== null) {
      window.clearTimeout(copyEmbedTimerRef.current);
    }

    copyEmbedTimerRef.current = window.setTimeout(() => {
      setCopyEmbedFeedback(false);
      copyEmbedTimerRef.current = null;
    }, 2000);
  }

  async function handleAddCard() {
    setFormError(null);

    if (addCardMode === 'attach') {
      const didAttach = await onAttachExistingCard(addCardUid);

      if (didAttach) {
        closeAddCardForm();
      }

      return;
    }

    const didCreate = await onCreateNewCard(addCardUid);

    if (didCreate) {
      closeAddCardForm();
    }
  }

  async function handleDelete() {
    setFormError(null);
    const didDelete = await onDeleteFocusedCard({
      confirmed: deleteConfirmed,
    });

    if (didDelete) {
      closeDeleteForm();
    }
  }

  return {
    cardUid,
    setCardUid,
    rawContent,
    setRawContent,
    typeCsv,
    setTypeCsv,
    familiarity,
    setFamiliarity,
    nextReview,
    setNextReview,
    memoryTechnique,
    setMemoryTechnique,
    qaPairs,
    setQaPairs,
    copyEmbedFeedback,
    isAddCardOpen,
    setIsAddCardOpen,
    addCardMode,
    addCardUid,
    setAddCardUid,
    isDeleteOpen,
    setIsDeleteOpen,
    deleteConfirmed,
    setDeleteConfirmed,
    formError,
    resetDeleteConfirmation,
    setAddMode,
    updateQaPair,
    removeQaPair,
    handleSave,
    handleCopyEmbed,
    handleAddCard,
    handleDelete,
  };
}
