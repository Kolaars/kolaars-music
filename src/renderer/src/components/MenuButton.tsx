import { useEffect, useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'

export interface MenuItemSpec {
  label: string
  icon?: IconName
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
  /** Renders a divider above this item. */
  separatorBefore?: boolean
  /** Optional right-aligned hint, e.g. a shortcut or count. */
  hint?: string
}

export interface MenuButtonProps {
  items: MenuItemSpec[]
  label?: string
  icon?: IconName
  title?: string
  className?: string
  children?: ReactNode
  position?: 'bottom-end' | 'bottom-start' | 'top-end'
}

/**
 * A popover menu anchored to its trigger.
 *
 * Rendered in a portal with viewport-aware placement so menus inside scrolling
 * lists are never clipped.
 */
export function MenuButton({
  items,
  label,
  icon,
  title,
  className,
  children,
  position = 'bottom-end'
}: MenuButtonProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [placement, setPlacement] = useState<'below' | 'above'>('below')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const trigger = triggerRef.current.getBoundingClientRect()
    setRect(trigger)
    const spaceBelow = window.innerHeight - trigger.bottom
    setPlacement(spaceBelow < 260 && trigger.top > spaceBelow ? 'above' : 'below')
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    /**
     * A press inside the panel must not dismiss it. This listener sits on the
     * capture phase, so it runs *before* the item's own click — closing here
     * would unmount the very button the user is pressing and the action would
     * never run.
     */
    const onPointerDown = (event: PointerEvent): void => {
      if (panelRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    /**
     * Only a scroll that moves the anchor is a problem. Menus placed beside a
     * scrolling list (the lyrics panel scrolls on its own while a track plays)
     * used to close the moment they opened.
     */
    const onScroll = (event: Event): void => {
      const target = event.target
      if (target === document || target === window) setOpen(false)
      else if (target instanceof Node && triggerRef.current && target.contains(triggerRef.current)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const style: React.CSSProperties = rect
    ? {
        position: 'fixed',
        top: placement === 'below' ? rect.bottom + 6 : undefined,
        bottom: placement === 'above' ? window.innerHeight - rect.top + 6 : undefined,
        ...(position === 'bottom-end' || position === 'top-end'
          ? { right: Math.max(8, window.innerWidth - rect.right) }
          : { left: Math.max(8, rect.left) })
      }
    : { position: 'fixed', visibility: 'hidden' }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className ?? 'iconbtn'}
        title={title ?? label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
      >
        {children ?? (icon ? <Icon name={icon} /> : null)}
        {label ? <span>{label}</span> : null}
      </button>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="menu"
              role="menu"
              style={style}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {items.map((item, index) => (
                <div key={`${item.label}-${index}`}>
                  {item.separatorBefore ? <div className="menu__sep" /> : null}
                  <button
                    type="button"
                    role="menuitem"
                    className={`menu__item${item.danger ? ' menu__item--danger' : ''}`}
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(false)
                      item.onSelect()
                    }}
                  >
                    {item.icon ? <Icon name={item.icon} size={16} /> : <span className="menu__spacer" />}
                    <span className="menu__label">{item.label}</span>
                    {item.hint ? <span className="menu__hint">{item.hint}</span> : null}
                  </button>
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
