import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

type UseStoredScrollSyncOptions = {
  enabled?: boolean;
  releaseDelayMs?: number;
  syncThreshold?: number;
};

const DEFAULT_RELEASE_DELAY_MS = 120;
const DEFAULT_SYNC_THRESHOLD = 1;

export function useStoredScrollSync<T extends HTMLElement>(
  elementRef: RefObject<T | null>,
  storedScrollTop: number,
  options: UseStoredScrollSyncOptions = {},
) {
  const { enabled = true, releaseDelayMs = DEFAULT_RELEASE_DELAY_MS, syncThreshold = DEFAULT_SYNC_THRESHOLD } = options;
  const isLocallyScrollingRef = useRef(false);
  const scrollTimerRef = useRef<number | null>(null);

  const markLocallyScrolling = useCallback(() => {
    if (!enabled) {
      return;
    }

    isLocallyScrollingRef.current = true;

    if (scrollTimerRef.current !== null) {
      window.clearTimeout(scrollTimerRef.current);
    }

    scrollTimerRef.current = window.setTimeout(() => {
      isLocallyScrollingRef.current = false;
      scrollTimerRef.current = null;
    }, releaseDelayMs);
  }, [enabled, releaseDelayMs]);

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current !== null) {
        window.clearTimeout(scrollTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const element = elementRef.current;

      if (!element || isLocallyScrollingRef.current) {
        return;
      }

      if (Math.abs(element.scrollTop - storedScrollTop) > syncThreshold) {
        element.scrollTop = storedScrollTop;
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [elementRef, enabled, storedScrollTop, syncThreshold]);

  return {
    isLocallyScrollingRef,
    markLocallyScrolling,
  };
}
