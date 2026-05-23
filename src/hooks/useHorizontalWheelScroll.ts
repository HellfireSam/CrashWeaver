import { useCallback, useEffect, useState } from 'react';

function scrollHorizontally(element: HTMLElement, event: WheelEvent) {
  event.preventDefault();
  event.stopPropagation();

  if (element.scrollWidth <= element.clientWidth) {
    return;
  }

  const horizontalDelta = event.deltaX || event.deltaY;

  if (!horizontalDelta) {
    return;
  }

  const maxScrollLeft = element.scrollWidth - element.clientWidth;
  const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, element.scrollLeft + horizontalDelta));

  if (nextScrollLeft === element.scrollLeft) {
    return;
  }

  element.scrollLeft = nextScrollLeft;
}

export function useHorizontalWheelScroll<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);

  useEffect(() => {
    if (!element) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      scrollHorizontally(element, event);
    };

    element.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      element.removeEventListener('wheel', handleWheel);
    };
  }, [element]);

  return useCallback((node: T | null) => {
    setElement(node);
  }, []);
}