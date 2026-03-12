import { useEffect, useState, useRef, useCallback } from 'react'
import { useProduction, calculateCash } from '../hooks/useProduction'
import ProductionCell from './ProductionCell'
import { DAY_KEYS, DAY_LABELS, DayKey, Employee, EmployeeType } from '../types/production'

interface ProductionPanelProps {
  onClose: () => void
}

type Category = 'salaried' | 'builder' | 'repairman' | 'dismantler' | 'driver'

const CATEGORY_LABELS: Record<Category, string> = {
  salaried: 'Salaried',
  builder: 'Builder',
  repairman: 'Repairman',
  dismantler: 'Dismantler',
  driver: 'Driver',
}

function categoryFromEmployee(emp: Employee): Category {
  if (emp.type === 'salaried') return 'salaried'
  if (emp.type === 'driver') return 'driver'
  if (emp.subtype === 'builder') return 'builder'
  if (emp.subtype === 'bundler') return 'dismantler'
  return 'repairman'
}

function categoryToTypeSubtype(cat: Category): { type: EmployeeType; subtype?: string } {
  switch (cat) {
    case 'salaried': return { type: 'salaried' }
    case 'builder': return { type: 'piece', subtype: 'builder' }
    case 'repairman': return { type: 'piece', subtype: 'repairman' }
    case 'dismantler': return { type: 'piece', subtype: 'bundler' }
    case 'driver': return { type: 'driver' }
  }
}

function EmployeeModal({ existing, onSave, onClose }: {
  existing?: Employee
  onSave: (emp: Employee, isNew: boolean) => void
  onClose: () => void
}) {
  const isEdit = !!existing
  const [name, setName] = useState(existing?.name || '')
  const [category, setCategory] = useState<Category>(existing ? categoryFromEmployee(existing) : 'salaried')
  const [payInfo, setPayInfo] = useState(existing?.payInfo || '')
  const [weeklyRate, setWeeklyRate] = useState(existing?.weeklyRate?.toString() || '')
  const [dailyRate, setDailyRate] = useState(existing?.dailyRate?.toString() || '')
  const [hourlyRate, setHourlyRate] = useState(existing?.hourlyRate?.toString() || '')

  const { type, subtype } = categoryToTypeSubtype(category)

  const handleSubmit = () => {
    if (!name.trim()) return
    const id = existing?.id || name.trim().toLowerCase().replace(/\s+/g, '-')
    onSave({
      id,
      name: name.trim().toUpperCase(),
      type,
      subtype: subtype as Employee['subtype'],
      payInfo: payInfo || null,
      weeklyRate: weeklyRate ? parseFloat(weeklyRate) : undefined,
      dailyRate: dailyRate ? parseFloat(dailyRate) : undefined,
      hourlyRate: hourlyRate ? parseFloat(hourlyRate) : undefined,
    }, !isEdit)
    onClose()
  }

  return (
    <div className="production-modal-backdrop" onClick={onClose}>
      <div className="production-modal" onClick={e => e.stopPropagation()}>
        <h3>{isEdit ? 'Edit Employee' : 'Add Employee'}</h3>
        <div className="modal-field">
          <label>Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. John Smith" autoFocus />
        </div>
        <div className="modal-field">
          <label>Category</label>
          <select value={category} onChange={e => setCategory(e.target.value as Category)}>
            {(Object.keys(CATEGORY_LABELS) as Category[]).map(c => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </div>
        <div className="modal-field">
          <label>Pay Info</label>
          <input value={payInfo} onChange={e => setPayInfo(e.target.value)} placeholder="e.g. 400/Payroll" />
        </div>
        <div className="modal-field">
          <label>Weekly Rate ($)</label>
          <input type="number" value={weeklyRate} onChange={e => setWeeklyRate(e.target.value)} placeholder="0" />
        </div>
        {type === 'salaried' && (
          <div className="modal-field">
            <label>Daily Rate ($)</label>
            <input type="number" value={dailyRate} onChange={e => setDailyRate(e.target.value)} placeholder="0" />
          </div>
        )}
        {type === 'driver' && (
          <div className="modal-field">
            <label>Hourly Rate ($)</label>
            <input type="number" value={hourlyRate} onChange={e => setHourlyRate(e.target.value)} placeholder="0" />
          </div>
        )}
        <div className="modal-actions">
          <button className="receipt-btn" onClick={onClose}>Cancel</button>
          <button className="receipt-btn receipt-btn-print" onClick={handleSubmit}>{isEdit ? 'Save' : 'Add'}</button>
        </div>
      </div>
    </div>
  )
}

export default function ProductionPanel({ onClose }: ProductionPanelProps) {
  const {
    data, loading, currentWeekKey, getCurrentWeek, navigateWeek, canNavigateForward,
    updateCell, updateEntryField, addEmployee, removeEmployee, updateEmployee, reorderEmployees, getWeekLabel,
  } = useProduction()

  const [showAddModal, setShowAddModal] = useState(false)
  const [showRatesModal, setShowRatesModal] = useState(false)
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null)
  const [editingTotal, setEditingTotal] = useState<string | null>(null)
  const [editingPayInfo, setEditingPayInfo] = useState<string | null>(null)
  const [editingHrsPay, setEditingHrsPay] = useState<string | null>(null)

  // --- DOM-only drag-and-drop (no React re-renders during drag) ---
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null)
  const dragRef = useRef<{
    kind: 'employee' | 'category'
    id: string
    draggedRows: HTMLTableRowElement[]
    allRows: HTMLTableRowElement[]
    rowMids: number[]
    draggedIndices: number[]
    startY: number
    ghostEl: HTMLDivElement
    totalDragHeight: number
    currentInsertIdx: number
  } | null>(null)
  const isDragging = useRef(false)
  // Store window listeners in refs so we can always remove the correct ones
  const moveHandlerRef = useRef<((e: PointerEvent) => void) | null>(null)
  const upHandlerRef = useRef<((e: PointerEvent) => void) | null>(null)

  const getSectionName = (e: Employee): string => {
    if (e.type === 'salaried') return 'Salaried'
    if (e.type === 'driver') return 'Drivers'
    if (e.subtype === 'builder') return 'Builders'
    if (e.subtype === 'bundler') return 'Dismantlers'
    return 'Repairmen'
  }

  const getCategoryKey = (e: Employee): Category => {
    if (e.type === 'salaried') return 'salaried'
    if (e.type === 'driver') return 'driver'
    if (e.subtype === 'builder') return 'builder'
    if (e.subtype === 'bundler') return 'dismantler'
    return 'repairman'
  }

  const buildGrouped = useCallback((employees: Employee[]) => {
    const seen = new Set<string>()
    const groupOrder: string[] = []
    for (const e of employees) {
      const cat = getCategoryKey(e)
      if (!seen.has(cat)) { seen.add(cat); groupOrder.push(cat) }
    }
    const groups: Record<string, Employee[]> = {}
    for (const e of employees) {
      const cat = getCategoryKey(e)
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(e)
    }
    const result: Employee[] = []
    for (const cat of groupOrder) {
      if (groups[cat]) result.push(...groups[cat])
    }
    return result
  }, [])

  const onHandlePointerDown = useCallback((
    e: React.PointerEvent,
    kind: 'employee' | 'category',
    id: string,
  ) => {
    const handle = (e.target as HTMLElement).closest('.drag-handle')
    if (!handle || !tbodyRef.current || !data) return

    e.preventDefault()
    e.stopPropagation()

    const tbody = tbodyRef.current
    const allRows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr[data-emp-id], tr[data-cat-id]'))

    // Find the dragged rows
    let draggedRows: HTMLTableRowElement[]
    if (kind === 'employee') {
      draggedRows = allRows.filter(r => r.getAttribute('data-emp-id') === id)
    } else {
      const catRow = allRows.find(r => r.getAttribute('data-cat-id') === id)
      const empRows = allRows.filter(r => {
        const empId = r.getAttribute('data-emp-id')
        if (!empId) return false
        const emp = data.employees.find(emp => emp.id === empId)
        return emp && getCategoryKey(emp) === id
      })
      draggedRows = catRow ? [catRow, ...empRows] : empRows
    }
    if (draggedRows.length === 0) return

    // Snapshot positions before any transforms
    const rowMids = allRows.map(r => {
      const rect = r.getBoundingClientRect()
      return rect.top + rect.height / 2
    })
    const draggedIndices = draggedRows.map(r => allRows.indexOf(r))
    const totalDragHeight = draggedRows.reduce((sum, r) => sum + r.getBoundingClientRect().height, 0)

    // Create floating ghost clone
    const ghostEl = document.createElement('div')
    ghostEl.className = 'drag-ghost' + (kind === 'category' ? ' drag-ghost-category' : '')
    const ghostTable = document.createElement('table')
    ghostTable.className = 'production-table'
    ghostTable.style.width = draggedRows[0]?.closest('table')?.offsetWidth + 'px'
    const ghostBody = document.createElement('tbody')
    for (const row of draggedRows) {
      const clone = row.cloneNode(true) as HTMLTableRowElement
      const origCells = row.querySelectorAll('td')
      const cloneCells = clone.querySelectorAll('td')
      origCells.forEach((cell, i) => {
        if (cloneCells[i]) cloneCells[i].style.width = cell.offsetWidth + 'px'
      })
      ghostBody.appendChild(clone)
    }
    ghostTable.appendChild(ghostBody)
    ghostEl.appendChild(ghostTable)
    document.body.appendChild(ghostEl)

    const firstRect = draggedRows[0].getBoundingClientRect()
    ghostEl.style.top = firstRect.top + 'px'
    ghostEl.style.left = firstRect.left + 'px'
    ghostEl.style.width = firstRect.width + 'px'

    // Mark dragged rows as invisible
    draggedRows.forEach(r => r.classList.add('drag-source'))
    tbody.classList.add('is-dragging')

    // Enable transitions on all non-dragged rows
    allRows.forEach((r, i) => {
      if (!draggedIndices.includes(i)) {
        r.style.transition = 'transform 0.25s cubic-bezier(0.2, 0, 0, 1)'
      }
    })

    const startY = e.clientY

    dragRef.current = {
      kind, id, draggedRows, allRows, rowMids, draggedIndices,
      startY, ghostEl, totalDragHeight,
      currentInsertIdx: draggedIndices[0],
    }
    isDragging.current = true

    // --- Helpers (pure functions of dragRef, no React state needed) ---

    const findInsertIdx = (mouseY: number): number => {
      const d = dragRef.current!
      const otherMids = d.rowMids.filter((_, i) => !d.draggedIndices.includes(i))
      const otherIndices = d.allRows.map((_, i) => i).filter(i => !d.draggedIndices.includes(i))
      for (let i = 0; i < otherMids.length; i++) {
        if (mouseY < otherMids[i]) return otherIndices[i]
      }
      return d.allRows.length
    }

    const applyDisplacements = (insertIdx: number) => {
      const d = dragRef.current!
      const dragH = d.totalDragHeight
      const firstDrag = d.draggedIndices[0]
      const lastDrag = d.draggedIndices[d.draggedIndices.length - 1]

      for (let i = 0; i < d.allRows.length; i++) {
        if (d.draggedIndices.includes(i)) continue
        const row = d.allRows[i]
        let shift = 0
        if (firstDrag < insertIdx) {
          if (i > lastDrag && i < insertIdx) shift = -dragH
        } else if (firstDrag > insertIdx) {
          if (i >= insertIdx && i < firstDrag) shift = dragH
        }
        row.style.transform = shift ? `translateY(${shift}px)` : ''
      }
    }

    // --- Window-level event handlers (closures over current data/refs) ---

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return
      ev.preventDefault()
      const d = dragRef.current
      const deltaY = ev.clientY - d.startY
      d.ghostEl.style.transform = `translateY(${deltaY}px)`

      const insertIdx = findInsertIdx(ev.clientY)
      if (insertIdx !== d.currentInsertIdx) {
        d.currentInsertIdx = insertIdx
        applyDisplacements(insertIdx)
      }
    }

    const onUp = (_ev: PointerEvent) => {
      if (!dragRef.current) return
      const d = dragRef.current

      // Clean up DOM
      d.ghostEl.remove()
      d.draggedRows.forEach(r => r.classList.remove('drag-source'))
      d.allRows.forEach(r => { r.style.transform = ''; r.style.transition = '' })
      tbodyRef.current?.classList.remove('is-dragging')

      // Compute final order from row data attributes
      const originalIds: string[] = []
      for (const row of d.allRows) {
        const empId = row.getAttribute('data-emp-id')
        if (empId) originalIds.push(empId)
      }
      const draggedEmpIds: string[] = []
      for (const row of d.draggedRows) {
        const empId = row.getAttribute('data-emp-id')
        if (empId) draggedEmpIds.push(empId)
      }
      const remaining = originalIds.filter(eid => !draggedEmpIds.includes(eid))
      let insertInRemaining = 0
      for (let i = 0; i < d.currentInsertIdx && i < d.allRows.length; i++) {
        if (!d.draggedIndices.includes(i)) {
          const empId = d.allRows[i].getAttribute('data-emp-id')
          if (empId) insertInRemaining++
        }
      }
      remaining.splice(insertInRemaining, 0, ...draggedEmpIds)
      const newOrder = remaining.map(eid => data!.employees.find(emp => emp.id === eid)!).filter(Boolean)

      const changed = !newOrder.every((emp, i) => emp.id === data?.employees[i]?.id)
      if (changed) reorderEmployees(newOrder)

      dragRef.current = null
      isDragging.current = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      moveHandlerRef.current = null
      upHandlerRef.current = null
    }

    moveHandlerRef.current = onMove
    upHandlerRef.current = onUp
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [data, reorderEmployees])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (moveHandlerRef.current) window.removeEventListener('pointermove', moveHandlerRef.current)
      if (upHandlerRef.current) window.removeEventListener('pointerup', upHandlerRef.current)
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingEmployee) setEditingEmployee(null)
        else if (showAddModal) setShowAddModal(false)
        else onClose()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, showAddModal, editingEmployee])

  const week = getCurrentWeek()
  if (loading || !data) {
    return (
      <div className="production-panel">
        <div className="production-toolbar no-print">
          <button className="receipt-btn" onClick={onClose}>Back</button>
        </div>
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--label-secondary)' }}>
          {loading ? 'Loading...' : 'No data available'}
        </div>
      </div>
    )
  }

  const weekDates = week?.dates || []
  const dayDateLabels: Record<DayKey, string> = {} as any
  DAY_KEYS.forEach((k, i) => {
    if (weekDates[i]) {
      const d = new Date(weekDates[i] + 'T12:00:00')
      dayDateLabels[k] = `${d.getMonth() + 1}/${d.getDate()}`
    } else {
      dayDateLabels[k] = ''
    }
  })

  const formatPayRate = (emp: Employee): string => {
    return emp.payInfo || ''
  }

  const grouped = buildGrouped(data.employees)

  return (
    <div className="production-panel">
      {/* Toolbar */}
      <div className="production-toolbar no-print">
        <button className="receipt-btn" onClick={onClose}>Back</button>
        <h2 className="production-title">Employee Production Sheet</h2>
        <div className="production-nav">
          <button className="receipt-btn" onClick={() => navigateWeek(-1)} title="Previous week">&#9664;</button>
          <span className="production-week-label">{getWeekLabel()}</span>
          <button className="receipt-btn" onClick={() => navigateWeek(1)} title="Next week" disabled={!canNavigateForward} style={!canNavigateForward ? { opacity: 0.3, cursor: 'not-allowed' } : undefined}>&#9654;</button>
        </div>
        <button className="receipt-btn" onClick={() => setShowRatesModal(true)}>Rates</button>
        <button className="receipt-btn" onClick={() => setShowAddModal(true)}>+ Employee</button>
      </div>

      {/* Table */}
      <div className="production-table-wrap">
        <table className="production-table">
          <thead>
            <tr>
              <th className="col-name">Employee</th>
              <th className="col-pay">Pay Rate</th>
              {DAY_KEYS.map(k => (
                <th key={k} className="col-day">
                  <div>{DAY_LABELS[k]}</div>
                  <div className="day-date">{dayDateLabels[k]}</div>
                </th>
              ))}
              <th className="col-num">Hrs Pay</th>
              <th className="col-num">Hrs Wkd</th>
              <th className="col-num">Deduct</th>
              <th className="col-num">Debit</th>
              <th className="col-total">Total</th>
              <th className="col-cash">Cash</th>
              <th className="col-action"></th>
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {grouped.map((emp, idx) => {
              const entry = week?.entries[emp.id]
              if (!entry) return null

              const section = getSectionName(emp)
              const catKey = getCategoryKey(emp)
              const prevSection = idx > 0 ? getSectionName(grouped[idx - 1]) : null
              const showHeader = section !== prevSection

              return (
                <>
                  {showHeader && (
                    <tr
                      key={`header-${section}`}
                      data-cat-id={catKey}
                      className="section-header-row"
                      onPointerDown={e => onHandlePointerDown(e, 'category', catKey)}
                    >
                      <td colSpan={14} className="section-header">
                        <span className="drag-handle" title="Drag to reorder category">⠿</span>
                        {section}
                      </td>
                    </tr>
                  )}
                  <tr
                    key={emp.id}
                    data-emp-id={emp.id}
                    className={`employee-row type-${emp.type}`}
                    onPointerDown={e => onHandlePointerDown(e, 'employee', emp.id)}
                  >
                    <td className="col-name" onClick={() => !isDragging.current && setEditingEmployee(emp)} style={{ cursor: 'pointer' }} title="Click to edit">
                      <span className="drag-handle" title="Drag to reorder">⠿</span>
                      {emp.name}
                    </td>
                    <td className="col-pay" onClick={() => setEditingPayInfo(emp.id)}>
                      {editingPayInfo === emp.id ? (
                        <input
                          className="prod-input pay-input"
                          defaultValue={emp.payInfo || ''}
                          autoFocus
                          onBlur={e => {
                            updateEmployee(emp.id, { payInfo: e.target.value || null })
                            setEditingPayInfo(null)
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                            if (e.key === 'Escape') { e.stopPropagation(); setEditingPayInfo(null) }
                          }}
                        />
                      ) : (
                        <span className="pay-label" title="Click to edit">{formatPayRate(emp)}</span>
                      )}
                    </td>
                    {DAY_KEYS.map(k => (
                      <ProductionCell
                        key={k}
                        employee={emp}
                        value={entry.days[k]}
                        day={k}
                        pieceRates={data.pieceRates}
                        bonusRates={data.bonusRates}
                        onChange={val => updateCell(emp.id, k, val)}
                      />
                    ))}
                    <td className="col-num col-hrspay" onClick={() => setEditingHrsPay(emp.id)}>
                      {editingHrsPay === emp.id ? (
                        <div className="hrspay-edit">
                          <input
                            type="number"
                            className="prod-input"
                            defaultValue={entry.hrsPayroll ?? ''}
                            placeholder="hrs"
                            autoFocus
                            onBlur={e => {
                              const val = e.target.value.trim()
                              updateEntryField(emp.id, 'hrsPayroll', val === '' ? null : (parseFloat(val) || 0))
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur()
                                const next = (e.target as HTMLInputElement).parentElement?.querySelector('.hrspay-rate-input') as HTMLInputElement
                                next?.focus()
                              }
                              if (e.key === 'Escape') { e.stopPropagation(); setEditingHrsPay(null) }
                            }}
                          />
                          <input
                            type="number"
                            className="prod-input hrspay-rate-input"
                            defaultValue={emp.weeklyRate ?? ''}
                            placeholder="$"
                            onBlur={e => {
                              const val = e.target.value.trim()
                              updateEmployee(emp.id, { weeklyRate: val === '' ? undefined : (parseFloat(val) || 0) })
                              setEditingHrsPay(null)
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                              if (e.key === 'Escape') { e.stopPropagation(); setEditingHrsPay(null) }
                            }}
                          />
                        </div>
                      ) : (
                        (entry.hrsPayroll != null || emp.weeklyRate) ? (
                          <div className="hrspay-display">
                            {entry.hrsPayroll != null ? <span><svg className="clock-icon" width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm0 14.5A6.5 6.5 0 1 1 8 1.5a6.5 6.5 0 0 1 0 13zM8.5 4h-1v4.5l3.5 2.1.5-.8-3-1.8V4z"/></svg> {entry.hrsPayroll}</span> : null}
                            {emp.weeklyRate ? <span className="hrspay-rate">${emp.weeklyRate}</span> : null}
                          </div>
                        ) : null
                      )}
                    </td>
                    <td className="col-num">
                      <input
                        type="number"
                        className="prod-input"
                        value={entry.hrsWorked ?? ''}
                        onChange={e => updateEntryField(emp.id, 'hrsWorked', parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td className="col-num">
                      <input
                        type="number"
                        className="prod-input"
                        value={entry.deductions || ''}
                        onChange={e => updateEntryField(emp.id, 'deductions', parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td className="col-num">
                      <input
                        type="number"
                        className="prod-input"
                        value={entry.debit || ''}
                        onChange={e => updateEntryField(emp.id, 'debit', parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td className={`col-total ${entry.totalOverride !== null ? 'total-override' : ''}`}>
                      {editingTotal === emp.id ? (
                        <input
                          type="number"
                          className="prod-input total-input"
                          defaultValue={entry.totalOverride ?? entry.total}
                          autoFocus
                          placeholder="auto"
                          onBlur={e => {
                            const raw = e.target.value.trim()
                            if (raw === '' || raw === 'auto') {
                              updateEntryField(emp.id, 'totalOverride', null)
                            } else {
                              const val = parseFloat(raw)
                              if (!isNaN(val)) updateEntryField(emp.id, 'totalOverride', val)
                            }
                            setEditingTotal(null)
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                            if (e.key === 'Escape') {
                              e.stopPropagation()
                              setEditingTotal(null)
                            }
                          }}
                        />
                      ) : (
                        <span
                          className="total-value"
                          onClick={() => setEditingTotal(emp.id)}
                          title="Click to override"
                        >
                          ${(entry.totalOverride ?? entry.total).toFixed(2)}
                          {entry.totalOverride !== null && <span className="override-dot" title="Manual override">*</span>}
                        </span>
                      )}
                    </td>
                    <td className="col-cash">
                      ${calculateCash(entry.totalOverride ?? entry.total, emp, entry).toFixed(2)}
                    </td>
                    <td className="col-action">
                      <button
                        className="remove-btn"
                        onClick={() => setConfirmRemove({ id: emp.id, name: emp.name })}
                        title="Remove employee"
                      >
                        x
                      </button>
                    </td>
                  </tr>
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {showRatesModal && (
        <div className="production-modal-backdrop" onClick={() => setShowRatesModal(false)}>
          <div className="rates-modal" onClick={e => e.stopPropagation()}>
            <div className="rates-modal-header">
              <h3>Rates & Bonuses</h3>
              <button className="rates-close-btn" onClick={e => { e.stopPropagation(); setShowRatesModal(false) }}>
                <svg width="16" height="16" viewBox="0 0 14 14" fill="none" style={{ pointerEvents: 'none' }}><path d="M1.5 1.5l11 11M12.5 1.5l-11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div className="rates-cards">
              <div className="rates-card">
                <div className="rates-card-header">
                  <svg className="rates-card-icon" width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="1.5"/><path d="M2 9h20M6 14h4M6 17h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  <div>
                    <div className="rates-card-title">Piece Rates</div>
                    <div className="rates-card-subtitle">Per pallet built</div>
                  </div>
                </div>
                <div className="rates-card-body">
                  {Object.entries(data.pieceRates).map(([type, rate]) => (
                    <div key={type} className="rates-row">
                      <span className="rates-row-label">{type}</span>
                      <span className="rates-row-value">${rate.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rates-card">
                <div className="rates-card-header">
                  <svg className="rates-card-icon" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  <div>
                    <div className="rates-card-title">Repair & Bundle</div>
                    <div className="rates-card-subtitle">Per stack</div>
                  </div>
                </div>
                <div className="rates-card-body">
                  <div className="rates-row">
                    <span className="rates-row-label">48x40 Repair</span>
                    <span className="rates-row-value">$10.00</span>
                  </div>
                  <div className="rates-row">
                    <span className="rates-row-label">CHEP Repair</span>
                    <span className="rates-row-value">$14.00</span>
                  </div>
                  <div className="rates-row-divider" />
                  <div className="rates-row">
                    <span className="rates-row-label">Bundle</span>
                    <span className="rates-row-value">${data.bonusRates.bundle}.00</span>
                  </div>
                  <div className="rates-row">
                    <span className="rates-row-label">Bundle (Sat)</span>
                    <span className="rates-row-value">${data.bonusRates.bundleSat}.00</span>
                  </div>
                </div>
              </div>

              <div className="rates-card">
                <div className="rates-card-header">
                  <svg className="rates-card-icon" width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="1" y="3" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.5"/><path d="M16 8l5 3-5 3V8z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/><circle cx="5" cy="19" r="2" stroke="currentColor" strokeWidth="1.5"/><circle cx="12" cy="19" r="2" stroke="currentColor" strokeWidth="1.5"/><path d="M7 19h3" stroke="currentColor" strokeWidth="1.5"/></svg>
                  <div>
                    <div className="rates-card-title">Driver</div>
                    <div className="rates-card-subtitle">Hourly rate</div>
                  </div>
                </div>
                <div className="rates-card-body">
                  <div className="rates-row">
                    <span className="rates-row-label">Hourly</span>
                    <span className="rates-row-value rates-row-value-lg">${data.bonusRates.driverHourly}<span className="rates-row-unit">/hr</span></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <EmployeeModal
          onSave={(emp, isNew) => { if (isNew) addEmployee(emp); else updateEmployee(emp.id, emp) }}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {editingEmployee && (
        <EmployeeModal
          existing={editingEmployee}
          onSave={(emp) => updateEmployee(emp.id, emp)}
          onClose={() => setEditingEmployee(null)}
        />
      )}

      {confirmRemove && (
        <div className="production-modal-backdrop" onClick={() => setConfirmRemove(null)}>
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="confirm-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 15c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1s1 .45 1 1v4c0 .55-.45 1-1 1zm1-8h-2V7h2v2z" fill="var(--system-orange)"/>
              </svg>
            </div>
            <h3>Remove Employee</h3>
            <p>Are you sure you want to remove <strong>{confirmRemove.name}</strong> from the production sheet?</p>
            <div className="confirm-actions">
              <button className="confirm-btn confirm-cancel" onClick={() => setConfirmRemove(null)}>Cancel</button>
              <button className="confirm-btn confirm-delete" onClick={() => { removeEmployee(confirmRemove.id); setConfirmRemove(null) }}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
