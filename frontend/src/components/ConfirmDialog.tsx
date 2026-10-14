import { useEffect, useId, useRef, type SyntheticEvent } from 'react'

export interface Confirmation {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
}

/** Accessible modal confirmation for destructive actions; renders nothing without a request. */
export function ConfirmDialog({ confirmation, onClose }: { confirmation: Confirmation | null, onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const messageId = useId()

  useEffect(() => {
    const element = dialog.current
    if (confirmation && element && !element.open) element.showModal()
  }, [confirmation])

  if (!confirmation) return null

  function cancel(event: SyntheticEvent) {
    event.preventDefault()
    onClose()
  }

  function confirm() {
    onClose()
    confirmation?.onConfirm()
  }

  return <dialog ref={dialog} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={messageId} onCancel={cancel}>
    <h2 id={titleId}>{confirmation.title}</h2>
    <p id={messageId}>{confirmation.message}</p>
    <div className="actions">
      <button type="button" autoFocus onClick={onClose}>Keep it</button>
      <button type="button" className="danger-button" onClick={confirm}>{confirmation.confirmLabel}</button>
    </div>
  </dialog>
}
