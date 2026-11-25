import { useLayoutEffect, useRef, type ReactNode } from "react";

// The decision bar. Below `lg` it is fixed above the phone tab bar, with a shadow on top, and a spacer of its own height
// keeps the last content from sitting under it. From `lg` it sits in the flow. Use one per page.
export function StickyActions({ children }: { children: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);

  // The bar is out of the flow, so the spacer copies its height; a fixed number breaks when the buttons wrap.
  useLayoutEffect(() => {
    const barEl = bar.current;
    const spacerEl = spacer.current;
    if (barEl === null || spacerEl === null) return;
    const copy = () => {
      spacerEl.style.height = `${barEl.offsetHeight}px`;
    };
    copy();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(copy);
    observer.observe(barEl);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={spacer} data-slot="sticky-actions-spacer" aria-hidden="true" className="h-20 lg:hidden" />
      <div
        ref={bar}
        data-slot="sticky-actions"
        className="fixed inset-x-0 bottom-[calc(var(--tabbar-height)+env(safe-area-inset-bottom))] z-30 flex flex-wrap items-center gap-3 bg-card px-4 py-3 shadow-bar lg:static lg:z-auto lg:bg-transparent lg:p-0 lg:shadow-none"
      >
        {children}
      </div>
    </>
  );
}
