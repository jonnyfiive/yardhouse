import { useState, useRef, useEffect } from 'react'
import { Employee, PieceEntry, TimeEntry, CustomEntry, DayKey } from '../types/production'

interface ProductionCellProps {
  employee: Employee
  value: boolean | PieceEntry[] | TimeEntry | CustomEntry | null
  day: DayKey
  pieceRates: Record<string, number>
  bonusRates: { bundle: number; bundleSat: number }
  onChange: (value: boolean | PieceEntry[] | TimeEntry | CustomEntry | null) => void
}

function isCustomEntry(val: any): val is CustomEntry {
  return val && typeof val === 'object' && !Array.isArray(val) && 'custom' in val
}

function formatTime12(t: string): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'p' : 'a'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
}

/* ── Shared popover header ── */
function PopoverHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="pop-header">
      <span className="pop-header-title">{title}</span>
      <button className="pop-header-close" onClick={onClose} title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  )
}

/* ── Custom dollar input ── */
function CustomDollarInput({
  value, onSave, onClose,
}: {
  value: number
  onSave: (val: CustomEntry | null) => void
  onClose: () => void
}) {
  const [amount, setAmount] = useState(value ? String(value) : '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  const handleSave = () => {
    const num = parseFloat(amount)
    if (num > 0) {
      onSave({ custom: num })
    } else {
      onSave(null)
    }
    onClose()
  }

  return (
    <div className="pop-custom-row">
      <span className="pop-custom-symbol">$</span>
      <input
        ref={inputRef}
        type="number"
        className="pop-custom-input"
        value={amount}
        placeholder="0.00"
        min={0}
        step="0.01"
        onChange={e => setAmount(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') onClose()
        }}
      />
      <button className="pop-custom-save" onClick={handleSave}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M2.5 7l3.5 3.5 5.5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  )
}

/* ── Salaried popover (unused full version — kept for reference) ── */
function SalariedPopover({
  isPresent, customVal, onSave, onClose,
}: {
  isPresent: boolean
  customVal: number
  onSave: (value: boolean | CustomEntry | null) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'normal' | 'custom'>(customVal > 0 ? 'custom' : 'normal')

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="pop-container" ref={ref}>
      {mode === 'normal' ? (
        <>
          <div className="salaried-toggle-row">
            <button
              className={`salaried-btn ${isPresent ? 'active' : ''}`}
              onClick={() => { onSave(true); onClose() }}
            >Present</button>
            <button
              className={`salaried-btn ${!isPresent ? 'active' : ''}`}
              onClick={() => { onSave(false); onClose() }}
            >Absent</button>
          </div>
          <div className="pop-divider" />
          <button className="pop-custom-toggle" onClick={() => setMode('custom')}>Custom $</button>
        </>
      ) : (
        <CustomDollarInput value={customVal} onSave={val => onSave(val)} onClose={onClose} />
      )}
    </div>
  )
}

/* ── Piece popover ── */
function PiecePopover({
  entries, pieceRates, isFlatRate, customVal, above, onSave, onSaveCustom, onClose,
}: {
  entries: PieceEntry[]
  pieceRates: Record<string, number>
  isFlatRate?: boolean
  customVal: number
  above?: boolean
  onSave: (entries: PieceEntry[]) => void
  onSaveCustom: (val: CustomEntry | null) => void
  onClose: () => void
}) {
  const [items, setItems] = useState<PieceEntry[]>(
    entries.length > 0 ? entries : [{ type: Object.keys(pieceRates)[0] || '48x40', qty: 0 }]
  )
  const [mode, setMode] = useState<'normal' | 'custom'>(customVal > 0 ? 'custom' : 'normal')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (mode === 'normal') handleSave()
        else onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [items, mode])

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
    <div className={`pop-container pop-piece ${above ? 'popover-above' : ''}`} ref={ref}>
      <PopoverHeader title="Piece Count" onClose={onClose} />
      {mode === 'normal' ? (
        <>
          <div className="pop-body">
            {items.map((item, idx) => (
              <div key={idx} className="pop-piece-row">
                <select
                  className="pop-select"
                  value={item.type}
                  onChange={e => updateItem(idx, 'type', e.target.value)}
                >
                  {Object.keys(pieceRates).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input
                  type="number"
                  className="pop-qty-input"
                  value={item.qty || ''}
                  min={0}
                  placeholder="Qty"
                  onChange={e => updateItem(idx, 'qty', parseInt(e.target.value) || 0)}
                />
                {items.length > 1 && (
                  <button className="pop-row-remove" onClick={() => setItems(items.filter((_, i) => i !== idx))}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                    </svg>
                  </button>
                )}
              </div>
            ))}
            <button className="pop-add-btn" onClick={() => setItems([...items, { type: Object.keys(pieceRates)[0], qty: 0 }])}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Add Row
            </button>
          </div>
          <div className="pop-footer">
            <span className="pop-subtotal">${subtotal.toFixed(2)}</span>
            <button className="pop-custom-toggle" onClick={() => setMode('custom')}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1v10M3 4.5h6M3.5 7.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              Custom $
            </button>
          </div>
        </>
      ) : (
        <div className="pop-body">
          <CustomDollarInput value={customVal} onSave={val => onSaveCustom(val)} onClose={onClose} />
        </div>
      )}
    </div>
  )
}

/* ── Time / Driver popover ── */
function TimePopover({
  entry, customVal, above, onSave, onSaveCustom, onClose,
}: {
  entry: TimeEntry | null
  customVal: number
  above?: boolean
  onSave: (entry: TimeEntry | null) => void
  onSaveCustom: (val: CustomEntry | null) => void
  onClose: () => void
}) {
  const [inTime, setIn] = useState(entry?.in || '')
  const [outTime, setOut] = useState(entry?.out || '')
  const [mode, setMode] = useState<'normal' | 'custom'>(customVal > 0 ? 'custom' : 'normal')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        if (mode === 'normal') handleSave()
        else onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [inTime, outTime, mode])

  const handleSave = () => {
    if (inTime && outTime) {
      onSave({ in: inTime, out: outTime })
    } else if (!inTime && !outTime) {
      onSave(null)
    }
    onClose()
  }

  const calcHours = () => {
    if (!inTime || !outTime) return null
    const [ih, im] = inTime.split(':').map(Number)
    const [oh, om] = outTime.split(':').map(Number)
    return ((oh + om / 60) - (ih + im / 60)).toFixed(1)
  }

  const hours = calcHours()

  return (
    <div className={`pop-container pop-time ${above ? 'popover-above' : ''}`} ref={ref}>
      <PopoverHeader title="Clock In / Out" onClose={onClose} />
      {mode === 'normal' ? (
        <>
          <div className="pop-body">
            <div className="pop-time-field">
              <label className="pop-time-label">IN</label>
              <input type="time" value={inTime} onChange={e => setIn(e.target.value)} className="pop-time-input" />
            </div>
            <div className="pop-time-field">
              <label className="pop-time-label">OUT</label>
              <input type="time" value={outTime} onChange={e => setOut(e.target.value)} className="pop-time-input" />
            </div>
            {hours && (
              <div className="pop-hours-pill">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.6 }}>
                  <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm0 14.5A6.5 6.5 0 1 1 8 1.5a6.5 6.5 0 0 1 0 13zM8.5 4h-1v4.5l3.5 2.1.5-.8-3-1.8V4z"/>
                </svg>
                {hours}h
              </div>
            )}
          </div>
          <div className="pop-footer">
            <button className="pop-clear-btn" onClick={() => { onSave(null); onClose() }}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 3h8M4.5 3V2h3v1M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Clear
            </button>
            <button className="pop-custom-toggle" onClick={() => setMode('custom')}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1v10M3 4.5h6M3.5 7.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              Custom $
            </button>
          </div>
        </>
      ) : (
        <div className="pop-body">
          <CustomDollarInput value={customVal} onSave={val => onSaveCustom(val)} onClose={onClose} />
        </div>
      )}
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
  const [popoverAbove, setPopoverAbove] = useState(false)
  const cellRef = useRef<HTMLTableCellElement>(null)
  const { type } = employee

  // Determine if popover should open above (cell in bottom half of viewport)
  const openPopover = () => {
    if (cellRef.current) {
      const rect = cellRef.current.getBoundingClientRect()
      setPopoverAbove(rect.bottom > window.innerHeight * 0.55)
    }
    setPopoverOpen(true)
  }

  // Click-outside to close salaried mini-popover
  useEffect(() => {
    if (!popoverOpen || type !== 'salaried') return
    const handler = (e: MouseEvent) => {
      if (cellRef.current && !cellRef.current.contains(e.target as Node)) {
        setPopoverOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoverOpen, type])

  // Check if the current value is a custom dollar entry
  const isCustom = isCustomEntry(value)
  const customAmount = isCustom ? value.custom : 0

  if (type === 'salaried') {
    const isPresent = value === true
    const isAbsent = value === false
    const isEmpty = value === null || value === undefined

    return (
      <td
        ref={cellRef}
        className={`production-cell cell-salaried ${isPresent ? 'cell-present' : isEmpty ? '' : 'cell-absent'}`}
        onClick={openPopover}
      >
        {isPresent ? '+' : isAbsent ? '–' : ''}
        {popoverOpen && (
          <div className={`pop-salaried ${popoverAbove ? 'popover-above' : ''}`} onClick={e => e.stopPropagation()}>
            <button
              className={`pop-sal-btn pop-sal-present ${isPresent ? 'active' : ''}`}
              onClick={() => { onChange(true); setPopoverOpen(false) }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8.5l3.5 3.5 6.5-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Present</span>
            </button>
            <div className="pop-sal-divider" />
            <button
              className={`pop-sal-btn pop-sal-absent ${isAbsent ? 'active' : ''}`}
              onClick={() => { onChange(false); setPopoverOpen(false) }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              <span>Absent</span>
            </button>
            <div className="pop-sal-divider" />
            <button
              className="pop-sal-btn pop-sal-clear"
              onClick={() => { onChange(null); setPopoverOpen(false) }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3.5 4h7M5.5 4V3h3v1M4 4v7.5a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Clear</span>
            </button>
          </div>
        )}
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

    const summary = isCustom
      ? `$${customAmount}`
      : entries.map(e => `${e.qty} ${e.type.length > 10 ? e.type.slice(0, 8) : e.type}`).join(', ')

    return (
      <td ref={cellRef} className={`production-cell cell-piece ${isCustom ? 'cell-custom' : ''}`} onClick={openPopover}>
        <span className="cell-summary">{summary || ''}</span>
        {popoverOpen && (
          <PiecePopover
            entries={entries}
            pieceRates={cellRates}
            isFlatRate={isFlatRate}
            customVal={customAmount}
            above={popoverAbove}
            onSave={onChange}
            onSaveCustom={onChange}
            onClose={() => setPopoverOpen(false)}
          />
        )}
      </td>
    )
  }

  // Driver
  const timeVal = isCustom ? null : value as TimeEntry | null
  let display = ''
  if (isCustom) {
    display = `$${customAmount}`
  } else if (timeVal?.in && timeVal?.out) {
    display = `${formatTime12(timeVal.in)}-${formatTime12(timeVal.out)}`
  } else if (timeVal?.in) {
    display = formatTime12(timeVal.in)
  }

  return (
    <td ref={cellRef} className={`production-cell cell-driver ${isCustom ? 'cell-custom' : ''}`} onClick={openPopover}>
      <span className="cell-summary">{display}</span>
      {popoverOpen && (
        <TimePopover
          entry={timeVal}
          customVal={customAmount}
          above={popoverAbove}
          onSave={onChange}
          onSaveCustom={onChange}
          onClose={() => setPopoverOpen(false)}
        />
      )}
    </td>
  )
}
