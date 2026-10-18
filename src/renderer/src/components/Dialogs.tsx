/**
 * Small, reusable dialogs: a single-line prompt and a confirmation.
 *
 * Both wrap `Modal`, so they automatically take part in the "a modal is open"
 * guard used by the global keyboard shortcuts.
 */

import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'

export interface PromptModalProps {
  open: boolean
  title: string
  label: string
  placeholder?: string
  initialValue?: string
  confirmLabel?: string
  /** Extra controls rendered under the input. */
  children?: ReactNode
  onCancel: () => void
  onConfirm: (value: string) => void
}

export function PromptModal({
  open,
  title,
  label,
  placeholder,
  initialValue = '',
  confirmLabel = 'Сохранить',
  children,
  onCancel,
  onConfirm
}: PromptModalProps): JSX.Element | null {
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])

  if (!open) return null

  const submit = (): void => {
    const trimmed = value.trim()
    if (!trimmed) return
    onConfirm(trimmed)
  }

  return (
    <Modal
      open
      title={title}
      onClose={onCancel}
      width={460}
      footer={
        <>
          <span className="modal__status" />
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onCancel}>
              Отмена
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={!value.trim()}
              onClick={submit}
            >
              <Icon name="check" size={16} />
              {confirmLabel}
            </button>
          </div>
        </>
      }
    >
      <div className="dialog__form">
        <label className="field__label" htmlFor="prompt-input">
          {label}
        </label>
        <input
          id="prompt-input"
          className="input"
          autoFocus
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
        />
        {children}
      </div>
    </Modal>
  )
}

export interface ConfirmModalProps {
  open: boolean
  title: string
  text?: ReactNode
  confirmLabel?: string
  danger?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmModal({
  open,
  title,
  text,
  confirmLabel = 'Удалить',
  danger = true,
  onCancel,
  onConfirm
}: ConfirmModalProps): JSX.Element | null {
  if (!open) return null

  return (
    <Modal
      open
      title={title}
      onClose={onCancel}
      width={430}
      footer={
        <>
          <span className="modal__status" />
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onCancel}>
              Отмена
            </button>
            <button
              type="button"
              className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </>
      }
    >
      <p className="dialog__text">{text}</p>
    </Modal>
  )
}
