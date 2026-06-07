import { useMemo } from 'react'
import { useApp } from '../../context/AppContext'
import { FIXED_LABELS } from './constants'

export default function useRows() {
  const { rowsByMinute } = useApp()

  const rowsByTime = useMemo(() => {
    const map = {}
    for (const r of Object.values(rowsByMinute)) {
      const time = String(r.minute).split('T')[1]?.slice(0, 5)
      if (time) map[time] = r
    }
    return map
  }, [rowsByMinute])

  return useMemo(
    () => FIXED_LABELS.map((t) => rowsByTime[t] || null),
    [rowsByTime],
  )
}
