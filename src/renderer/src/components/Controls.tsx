import type { JSX, ReactNode } from 'react'
import { Icon } from './Icon'

/* ------------------------------------------------------------------ */
/* Buttons & chips                                                     */
/* ------------------------------------------------------------------ */

export function Chip({
  children,
  active,
  onClick,
  title
}: {
  children: ReactNode
  active?: boolean
  onClick?: () => void
  title?: string
}): JSX.Element {
  return (
    <button
      type="button"
      className={`chip${active ? ' chip--active' : ''}`}
      onClick={onClick}
      title={title}
      disabled={!onClick}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Form controls                                                       */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
  inline
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  inline?: boolean
}): JSX.Element {
  return (
    <div className={`field${inline ? ' field--inline' : ''}`}>
      <div className="field__text">
        <span className="field__label">{label}</span>
        {hint ? <span className="field__hint">{hint}</span> : null}
      </div>
      <div className="field__control">{children}</div>
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch${checked ? ' switch--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__knob" />
    </button>
  )
}

export function Range({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  label,
  format
}: {
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
  label: string
  format?: (value: number) => string
}): JSX.Element {
  return (
    <div className="range">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ ['--range-progress' as string]: `${((value - min) / (max - min)) * 100}%` }}
      />
      <span className="range__value">{format ? format(value) : value}</span>
    </div>
  )
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  label
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}): JSX.Element {
  return (
    <select className="select" aria-label={label} value={value} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/* ------------------------------------------------------------------ */
/* Section header                                                      */
/* ------------------------------------------------------------------ */

export function SectionCard({
  icon,
  title,
  description,
  children
}: {
  icon?: Parameters<typeof Icon>[0]['name']
  title: string
  description?: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className="panel">
      <header className="panel__head">
        <div className="panel__headtext">
          <h2 className="panel__title">
            {icon ? <Icon name={icon} size={16} /> : null}
            {title}
          </h2>
          {description ? <p className="panel__description">{description}</p> : null}
        </div>
      </header>
      <div className="panel__body">{children}</div>
    </section>
  )
}
