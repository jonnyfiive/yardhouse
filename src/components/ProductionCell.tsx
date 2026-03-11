import { useState, useRef, useEffect } from 'react'
import { Employee, PieceEntry, TimeEntry, DayKey } from '../types/production'

interface ProductionCellProps {
  employee: Employee
  value: boolean | PieceEntry[] | TimeEntry | null
  day: DayKey
  pieceRates: Record<string, number>
  bonusRates: { bundle: number; bundleSat: number }
  onChange: (value: boolean | PieceEntry[] | TimeEntry | null) => void
}

function formatTime12(t: string): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'p' : 'a'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
}

function PiecePopover({
  entries, pieceRates, isFlatRate, onSave, onClose,
}: {
  entries: PieceEntry[]
  pieceRates: Record<string, number>
  isFlatRate?: boolean
  onSave: (entries: PieceEntry[]) => void
  onClose: () => void
}) {
  const [items, setItems] = useState<PieceEntry[]>(
    entries.length > 0 ? entries : [{ type: Object.keys(pieceRates)[0] || '48x40', qty: 0 }]
  )
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handleSave()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [items])

  const handleSave = () => {
    const valid = items.filter(i => i.qty > 0)
    onSave(valid)
    onClose()
  }

  const updateItem = (idx: number, field: keyof PieceEntry, val: any) => {
    const next = [...items]
    next[idx] = { ...next[idx], [field]: val }
    setItems(next)
  }

  const subtotal = items.reduce((sum, i) => {
    const rate = pieceRates[i.type] || 0
    return sum + (i.qty || 0) * (isFlatRate ? 1 : 20) * rate
  }, 0)

  return (
    <div className="piece-popover" ref={ref}>
      {items.map((item, idx) => (
        <div key={idx} className="piece-popover-row">
          <select
            className="piece-select"
            value={item.type}
            onChange={e => updateItem(idx, 'type', e.target.value)}
          >
            {Object.keys(pieceRates).map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input
            type="number"
            className="piece-qty"
            value={item.qty || ''}
            min={0}
            placeholder="0"
            onChange={e => updateItem(idx, 'qty', parseInt(e.target.value) || 0)}
          />
          {items.length > 1 && (
            <button className="piece-remove" onClick={() => setItems(items.filter((_, i) => i !== idx))}>
              x
            </button>
          )}
        </div>
      ))}
      <div className="piece-popover-footer">
        <button className="piece-add" onClick={() => setItems([...items, { type: Object.keys(pieceRates)[0], qty: 0 }])}>
          + Add
        </button>
        <span className="piece-subtotal">${subtotal.toFixed(2)}</span>
      </div>
    </div>
  )
}

function TimePopover({
  entry, onSave, onClose,
}: {
  entry: TimeEntry | null
  onSave: (entry: TimeEntry | null) => void
  onClose: () => void
}) {
  const [inTime, setIn] = useState(entry?.in || '')
  const [outTime, setOut] = useState(entry?.out || '')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handleSave()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [inTime, outTime])

  const handleSave = () => {
    if (inTime && outTime) {
      onSave({ in: inTime, out: outTime })
    } else if (!inTime && !outTime) {
      onSave(null)
    }
    onClose()
  }

  return (
    <div className="piece-popover time-popover" ref={ref}>
      <div className="time-row">
        <label>In</label>
        <input type="time" value={inTime} onChange={e => setIn(e.target.value)} className="time-input" />
      </div>
      <div className="time-row">
        <label>Out</label>
        <input type="time" value={outTime} onChange={e => setOut(e.target.value)} className="time-input" />
      </div>
      {inTime && outTime && (
        <div className="time-row">
          <span className="piece-subtotal">
            {(parseFloat(outTime.replace(':', '.')) - parseFloat(inTime.replace(':', '.'))).toFixed(1)}h
          </span>
        </div>
      )}
      <button className="piece-add" onClick={() => { onSave(null); onClose() }}>Clear</button>
    </div>
  )
}

function parseTimeToHours(inTime: string, outTime: string): number {
  const [ih, im] = inTime.split(':').map(Number)
  const [oh, om] = outTime.split(':').map(Number)
  return (oh + om / 60) - (ih + im / 60)
}

export default function ProductionCell({ employee, value, day, pieceRates, bonusRates, onChange }: ProductionCellProps) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const { type } = employee

  if (type === 'salaried') {
    return (
      <td
        className={`production-cell cell-salaried ${value === true ? 'cell-present' : 'cell-absent'}`}
        onClick={() => onChange(!(value === true))}
      >
        {value === true ? '+' : ''}
      </td>
    )
  }

  if (type === 'piece') {
    const entries = Array.isArray(value) ? value as PieceEntry[] : []

    let cellRates: Record<string, number>
    let isFlatRate = false
    if (employee.subtype === 'bundler') {
      cellRates = day === 'sat'
        ? { 'Bundle (Sat)': bonusRates.bundleSat }
        : { 'Bundle': bonusRates.bundle }
      isFlatRate = true
    } else if (employee.subtype === 'repairman') {
      cellRates = { '48x40 Repair': 10 }
      isFlatRate = true
    } else if (employee.subtype === 'repairman-blue') {
      cellRates = { '48x40 Repair': 10, 'CHEP': 14 }
      isFlatRate = true
    } else {
      cellRates = pieceRates
    }

    const summary = entries.map(e => `${e.qty} ${e.type.length > 10 ? e.type.slice(0, 8) : e.type}`).join(', ')

    return (
      <td className="production-cell cell-piece" onClick={() => setPopoverOpen(true)}>
        <span className="cell-summary">{summary || ''}</span>
        {popoverOpen && (
          <PiecePopover
            entries={entries}
            pieceRates={cellRates}
            isFlatRate={isFlatRate}
            onSave={onChange}
            onClose={() => setPopoverOpen(false)}
          />
        )}
      </td>
    )
  }

  // Driver
  const timeVal = value as TimeEntry | null
  let display = ''
  if (timeVal?.in && timeVal?.out) {
    display = `${formatTime12(timeVal.in)}-${formatTime12(timeVal.out)}`
  } else if (timeVal?.in) {
    display = formatTime12(timeVal.in)
  }

  return (
    <td className="production-cell cell-driver" onClick={() => setPopoverOpen(true)}>
      <span className="cell-summary">{display}</span>
      {popoverOpen && (
        <TimePopover
          entry={timeVal}
          onSave={onChange}
          onClose={() => setPopoverOpen(false)}
        />
      )}
    </td>
  )
}
