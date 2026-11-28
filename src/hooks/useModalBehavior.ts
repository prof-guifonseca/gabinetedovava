import { useEffect } from "react";

let openModalCount = 0;
let savedBodyOverflow: string | null = null;

export function useModalBehavior(open: boolean, onClose?: () => void): void {
  useEffect(() => {
    if (!open) return;

    if (openModalCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    openModalCount += 1;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onClose) {
        event.preventDefault();
        onClose();
      }
    };

    if (onClose) {
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      if (onClose) {
        window.removeEventListener("keydown", handleKeyDown);
      }
      openModalCount = Math.max(0, openModalCount - 1);
      if (openModalCount === 0) {
        document.body.style.overflow = savedBodyOverflow ?? "";
        savedBodyOverflow = null;
      }
    };
  }, [open, onClose]);
}
