import { useEffect, type RefObject } from "react";

interface Options {
  searchInputRef: RefObject<HTMLInputElement | null>;
  onClearSearch: () => void;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}

export function useKeyboardShortcuts({ searchInputRef, onClearSearch }: Options): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      const editable = isEditable(e.target);

      if ((e.metaKey || e.ctrlKey) && e.key === "k" && !e.shiftKey) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (e.key === "/" && !editable) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (e.key === "Escape" && document.activeElement === searchInputRef.current) {
        onClearSearch();
        searchInputRef.current?.blur();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchInputRef, onClearSearch]);
}
