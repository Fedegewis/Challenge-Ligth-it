import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  variant?: 'form' | 'success' | 'error';
  role?: 'dialog' | 'alertdialog';
  canClose?: boolean;
  closeOnBackdrop?: boolean;
  initialFocusRef?: RefObject<HTMLElement>;
};

function focusableIn(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
}

export function Modal({
  title,
  onClose,
  children,
  variant = 'form',
  role = 'dialog',
  canClose = true,
  closeOnBackdrop = false,
  initialFocusRef,
}: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current!;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    (initialFocusRef?.current ?? focusableIn(dialog)[0] ?? dialog).focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [initialFocusRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (canClose) onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const items = focusableIn(dialogRef.current!);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && closeOnBackdrop && canClose) {
      onClose();
    }
  };

  return createPortal(
    <div className="modal-backdrop" onMouseDown={handleBackdrop}>
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`modal modal--${variant}`}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className="modal__title">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
