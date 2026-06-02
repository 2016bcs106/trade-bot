import { useRef, useCallback } from 'react'

export default function useLongPress(onLongPress, onTap, { delay = 500 } = {}) {
  const timerRef = useRef(null)
  const firedRef = useRef(false)

  const start = useCallback(() => {
    firedRef.current = false
    timerRef.current = setTimeout(() => {
      firedRef.current = true
      onLongPress()
    }, delay)
  }, [onLongPress, delay])

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleClick = useCallback(() => {
    if (firedRef.current) {
      firedRef.current = false
      return
    }
    onTap()
  }, [onTap])

  return {
    onMouseDown: start,
    onMouseUp: cancel,
    onMouseLeave: cancel,
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: cancel,
    onClick: handleClick,
  }
}
