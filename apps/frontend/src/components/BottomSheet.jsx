import { useEffect, useRef, useState } from 'react'

const CLOSE_DRAG_THRESHOLD_PX = 100

export default function BottomSheet({ title, isOpen, onClose, children, footer }) {
  const [dragY, setDragY] = useState(0)
  const [isDraggingBody, setIsDraggingBody] = useState(false)
  const bodyRef = useRef(null)
  const dragYRef = useRef(0)
  const headerDraggingRef = useRef(false)
  const headerStartYRef = useRef(0)
  const bodyStateRef = useRef({ pointerDown: false, dragging: false, startY: 0 })

  const setDrag = (value) => {
    dragYRef.current = value
    setDragY(value)
  }

  useEffect(() => {
    if (!isOpen) return

    const scrollY = window.scrollY
    const body = document.body
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.overflow = 'hidden'

    return () => {
      body.style.position = ''
      body.style.top = ''
      body.style.left = ''
      body.style.right = ''
      body.style.overflow = ''
      window.scrollTo(0, scrollY)
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen) setDrag(0)
  }, [isOpen])

  // The scrollable body needs raw touch events (not React's synthetic pointer events) --
  // preventDefault() on a pointermove doesn't reliably suppress touch-driven scrolling once the
  // browser has started handling it; touchmove's preventDefault is the mechanism that actually
  // works, and it needs { passive: false } to be callable at all.
  useEffect(() => {
    if (!isOpen) return
    const el = bodyRef.current
    if (!el) return

    const onTouchStart = (e) => {
      bodyStateRef.current = { pointerDown: true, dragging: false, startY: e.touches[0].clientY }
    }

    const onTouchMove = (e) => {
      const state = bodyStateRef.current
      if (!state.pointerDown) return
      const currentY = e.touches[0].clientY
      const delta = currentY - state.startY

      if (!state.dragging) {
        if (el.scrollTop <= 0 && delta > 0) {
          state.dragging = true
          state.startY = currentY
          setIsDraggingBody(true)
        } else {
          return
        }
      }

      e.preventDefault()
      setDrag(Math.max(0, currentY - state.startY))
    }

    const onTouchEnd = () => {
      if (bodyStateRef.current.dragging) {
        if (dragYRef.current > CLOSE_DRAG_THRESHOLD_PX) {
          onClose()
        } else {
          setDrag(0)
        }
      }
      bodyStateRef.current = { pointerDown: false, dragging: false, startY: 0 }
      setIsDraggingBody(false)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleHeaderDragStart = (e) => {
    headerDraggingRef.current = true
    headerStartYRef.current = e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handleHeaderDragMove = (e) => {
    if (!headerDraggingRef.current) return
    setDrag(Math.max(0, e.clientY - headerStartYRef.current))
  }

  const handleHeaderDragEnd = () => {
    if (!headerDraggingRef.current) return
    headerDraggingRef.current = false
    if (dragYRef.current > CLOSE_DRAG_THRESHOLD_PX) {
      onClose()
    } else {
      setDrag(0)
    }
  }

  const isDragging = headerDraggingRef.current || isDraggingBody

  return (
    <>
      <div onClick={onClose} style={styles.overlay} />
      <div style={{ ...styles.sheet, transform: `translateY(${dragY}px)`, transition: isDragging ? 'none' : 'transform 0.25s ease' }}>
        <div
          style={styles.header}
          onPointerDown={handleHeaderDragStart}
          onPointerMove={handleHeaderDragMove}
          onPointerUp={handleHeaderDragEnd}
          onPointerCancel={handleHeaderDragEnd}
        >
          <div style={styles.handle} />
          {title && <span style={styles.title}>{title}</span>}
        </div>
        <div ref={bodyRef} style={styles.body}>
          {children}
        </div>
        {footer && <div style={styles.footer}>{footer}</div>}
      </div>
    </>
  )
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.32)',
    zIndex: 2000,
    touchAction: 'none',
  },
  sheet: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    minHeight: '50vh',
    maxHeight: '85vh',
    background: 'var(--color-card)',
    borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
    zIndex: 2001,
    display: 'flex',
    flexDirection: 'column',
    boxShadow: 'var(--shadow-overlay)',
    animation: 'slide-up 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
  },
  header: {
    padding: '12px 16px 8px',
    textAlign: 'center',
    flexShrink: 0,
    touchAction: 'none',
    cursor: 'grab',
  },
  handle: {
    width: '36px',
    height: '5px',
    borderRadius: '3px',
    background: 'var(--color-text-tertiary)',
    opacity: 0.4,
    margin: '0 auto 10px',
  },
  title: {
    fontWeight: 600,
    fontSize: 'var(--font-subhead)',
    color: 'var(--color-text)',
  },
  body: {
    overflowY: 'auto',
    flex: 1,
    WebkitOverflowScrolling: 'touch',
    overscrollBehavior: 'contain',
  },
  footer: {
    flexShrink: 0,
    padding: 'var(--space-md) var(--space-lg)',
    borderTop: '1px solid var(--color-border)',
    background: 'var(--color-card)',
  },
}
