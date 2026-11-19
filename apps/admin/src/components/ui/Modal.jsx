import React, { useId, useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

export function Modal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'md',
}) {
  const dialogRef = useRef(null);
  const titleId = useId();

  useLayoutEffect(() => {
    if (!isOpen) return;

    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    dialog.showModal();
    dialog.querySelector('[data-modal-autofocus]')?.focus();
    return () => {
      dialog.close();
      queueMicrotask(() => {
        const focused = document.activeElement;
        if (trigger instanceof HTMLElement && trigger.isConnected && !dialog.open &&
          (focused === document.body || dialog.contains(focused))) {
          trigger.focus({ preventScroll: true });
        }
      });
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleKeyDown = (e) => {
    if (e.key !== 'Tab') return;

    const controls = [...e.currentTarget.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]',
    )].filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length);
    const first = controls[0];
    const last = controls.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={handleKeyDown}
      aria-labelledby={titleId}
    >
      <div className={`modal-dialog ${maxWidth === 'lg' ? 'max-w-lg' : ''}`}>
        <div className="modal-header">
          <h2 id={titleId} className="modal-title">
            {title}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={16} />
          </Button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </dialog>
  );
}
