import { useCallback, useRef, useState } from 'react';

// Layout decisions key off the pane the app actually lives in (an Obsidian
// leaf can be a narrow split on a wide monitor), never the device type.
//
// Callback ref (not useRef+useEffect): the measured element renders
// conditionally (boot/setup branches come first), so observation must start
// whenever the node actually appears, not on first mount.
export function useContainerWidth() {
  const observerRef = useRef(null);
  const [width, setWidth] = useState(null);
  const ref = useCallback(node => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const observer = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect?.width;
      if (typeof w === 'number') setWidth(w);
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);
  return [ref, width];
}
