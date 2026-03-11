import { useState, useRef, useEffect, useCallback } from 'react'
import { Delivery, Customer, DELIVERY_STATUSES, DELIVERY_DRIVERS, DELIVERY_TYPES } from '../types/briefing'
import { useApi, getDeliveryDate } from '../hooks/useApi'

interface Props {
  deliveries: Delivery[]
  onUpdate: (id: string, field: string, value: any) => void
  onRefresh: () => void
  onCreate: (payload: any) => Promise<any>
  onCustomerClick: (name: string) => void
  lastSync: string
  customers: Customer[]
}

interface EditorState {
  id: string
  field: string
  rect: DOMRect
  options?: string[]
  currentValue: string
  type: 'dropdown' | 'text'
}

export default function DeliveriesTable({ deliveries, onUpdate, onRefresh, onCreate, onCustomerClick, lastSync, customers }: Props) {
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [showNewRow, setShowNewRow] = useState(false)
  const [newCustomer, setNewCustomer] = useState('')
  const [newType, setNewType] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const newInputRef = useRef<HTMLInputElement>(null)
  const customerDropdownRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const customerNames = customers.map(c => c.name)

  const filteredCustomers = newCustomer.trim()
    ? customerNames.filter(n => n.toLowerCase().includes(newCustomer.toLowerCase()))
    : customerNames

  // Close editor on outside click
  useEffect(() => {
    if (!editor) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setEditor(null)
      }
    }
    setTimeout(() => document.addEventListener('click', handler), 10)
    return () => document.removeEventListener('click', handler)
  }, [editor])

  // Close customer dropdown on outside click
  useEffect(() => {
    if (!showCustomerDropdown) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (customerDropdownRef.current && !customerDropdownRef.current.contains(target) &&
          newInputRef.current && !newInputRef.current.contains(target)) {
        setShowCustomerDropdown(false)
      }
    }
    setTimeout(() => document.addEventListener('click', handler), 10)
    return () => document.removeEventListener('click', handler)
  }, [showCustomerDropdown])

  useEffect(() => {
    if (editor?.type === 'text' && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editor])

  const handleRefresh = async () => {
    setRefreshing(true)
    await onRefresh()
    setRefreshing(false)
  }

  const openDropdown = (e: React.MouseEvent, id: string, field: string, options: string[], current: string) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setEditor({ id, field, rect, options, currentValue: current, type: 'dropdown' })
  }

  const openTextEditor = (e: React.MouseEvent, id: string, field: string, current: string) => {
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setEditor({ id, field, rect, currentValue: current, type: 'text' })
  }

  const selectOption = (value: string) => {
    if (editor) {
      onUpdate(editor.id, editor.field, value)
      setEditor(null)
    }
  }

  const saveText = () => {
    if (editor && inputRef.current) {
      const val = editor.field === 'trip'
        ? (inputRef.current.value ? parseInt(inputRef.current.value) : null)
        : inputRef.current.value
      onUpdate(editor.id, editor.field, val)
      setEditor(null)
    }
  }

  const handleCreate = async () => {
    if (!newCustomer.trim()) return
    setCreating(true)
    try {
      // Look up customer ID by name
      const match = customers.find(c => c.name.toLowerCase() === newCustomer.trim().toLowerCase())
      const payload: any = {
        notes: newNotes,
        status: 'Scheduled',
        date: getDeliveryDate().date,
      }
      if (newType) {
        payload.type = newType
      }
      if (match) {
        payload.customerId = match.id
      }
      await onCreate(payload)
      setNewCustomer('')
      setNewType('')
      setNewNotes('')
      setShowNewRow(false)
      setShowCustomerDropdown(false)
      setHighlightedIndex(-1)
      await onRefresh()
    } catch (err) {
      console.error('Failed to create delivery:', err)
    }
    setCreating(false)
  }

  const cancelNew = () => {
    setShowNewRow(false)
    setNewCustomer('')
    setNewType('')
    setNewNotes('')
    setShowCustomerDropdown(false)
    setHighlightedIndex(-1)
  }

  const selectCustomer = (name: string) => {
    setNewCustomer(name)
    setShowCustomerDropdown(false)
    setHighlightedIndex(-1)
  }

  const handleCustomerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setShowCustomerDropdown(true)
      setHighlightedIndex(prev => Math.min(prev + 1, filteredCustomers.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (showCustomerDropdown && filteredCustomers.length > 0) {
        // If highlighted, pick that one; otherwise pick the first match
        const pickIndex = highlightedIndex >= 0 ? highlightedIndex : 0
        selectCustomer(filteredCustomers[pickIndex])
      } else {
        handleCreate()
      }
    } else if (e.key === 'Escape') {
      if (showCustomerDropdown) { setShowCustomerDropdown(false) } else { cancelNew() }
    }
  }

  const statusClass = (status: string) => `status-${status.toLowerCase().replace(' ', '-')}`

  const customerInput = (
    <div className="new-delivery-customer-wrap">
      <input
        ref={newInputRef}
        className="new-delivery-input"
        value={newCustomer}
        onChange={e => { setNewCustomer(e.target.value); setShowCustomerDropdown(true); setHighlightedIndex(-1) }}
        onFocus={() => setShowCustomerDropdown(true)}
        placeholder="Customer name"
        onKeyDown={handleCustomerKeyDown}
        autoComplete="off"
      />
      {showCustomerDropdown && filteredCustomers.length > 0 && (
        <div ref={customerDropdownRef} className="new-delivery-customer-dropdown">
          {filteredCustomers.map((name, i) => (
            <div
              key={name}
              className={`new-delivery-customer-option ${i === highlightedIndex ? 'highlighted' : ''}`}
              onMouseDown={e => { e.preventDefault(); selectCustomer(name) }}
              onMouseEnter={() => setHighlightedIndex(i)}
            >
              {name}
            </div>
          ))}
        </div>
      )}
    </div>
  )

  const newRowContent = (
    <div className="new-delivery-row">
      {customerInput}
      <select className="new-delivery-select" value={newType} onChange={e => setNewType(e.target.value)}>
        <option value="">Type</option>
        {DELIVERY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <input
        className="new-delivery-input new-delivery-notes"
        value={newNotes}
        onChange={e => setNewNotes(e.target.value)}
        placeholder="Notes"
        onKeyDown={e => {
          if (e.key === 'Enter') handleCreate()
          if (e.key === 'Escape') cancelNew()
        }}
      />
      <button className="new-delivery-save" onClick={handleCreate} disabled={creating || !newCustomer.trim()}>
        {creating ? '...' : 'Add'}
      </button>
      <button className="new-delivery-cancel" onClick={cancelNew}>×</button>
    </div>
  )

  const addButton = (
    <button
      className="delivery-add-btn"
      onClick={() => { setShowNewRow(true); setTimeout(() => newInputRef.current?.focus(), 50) }}
      title="Add delivery"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </button>
  )

  if (!deliveries || deliveries.length === 0) {
    return (
      <div className="section">
        <div className="section-header" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {getDeliveryDate().label}
            {addButton}
          </span>
        </div>
        {showNewRow ? newRowContent : (
          <div className="empty-state">
            <div className="empty-state-icon">—</div>
            <div className="empty-state-text">No deliveries scheduled</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="section">
      <div className="section-header" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {getDeliveryDate().label}
          {addButton}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="sync-label">{lastSync}</span>
          <button
            className="sync-btn"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? '...' : 'SYNC'}
          </button>
        </span>
      </div>
      <table className="deliveries-table">
        <thead>
          <tr>
            <th>COMPANY</th>
            <th>TYPE</th>
            <th>DRIVER</th>
            <th>STATUS</th>
            <th>NOTES</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.map((d, idx) => (
            <tr key={d.id || `${d.customer}-${idx}`}>
              <td
                className="customer-cell"
                onClick={() => onCustomerClick(d.customer)}
              >
                {d.customer}
              </td>
              <td
                className="editable-cell"
                onClick={(e) => openDropdown(e, d.id!, 'type', DELIVERY_TYPES, d.type)}
              >
                {d.type}
              </td>
              <td
                className="editable-cell"
                onClick={(e) => openDropdown(e, d.id!, 'driver', DELIVERY_DRIVERS, d.driver)}
              >
                {d.driver || ''}
                {d.trip && (
                  <sup
                    className="trip-sup"
                    onClick={(e) => {
                      e.stopPropagation()
                      openTextEditor(e, d.id!, 'trip', String(d.trip))
                    }}
                  >
                    {d.trip}
                  </sup>
                )}
              </td>
              <td
                className="editable-cell"
                onClick={(e) => openDropdown(e, d.id!, 'status', DELIVERY_STATUSES, d.status)}
              >
                <span className={`status-badge ${statusClass(d.status)}`}>{d.status}</span>
              </td>
              <td
                className="editable-cell truncate"
                onClick={(e) => openTextEditor(e, d.id!, 'notes', d.notes || '')}
              >
                {d.notes || ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showNewRow && newRowContent}

      {/* Inline editor */}
      {editor && editor.type === 'dropdown' && (
        <div
          ref={dropdownRef}
          className="inline-dropdown"
          style={{
            position: 'fixed',
            top: editor.rect.bottom + 4,
            left: editor.rect.left,
            zIndex: 9999,
            minWidth: Math.max(editor.rect.width, 160),
          }}
        >
          {editor.options!.map((opt) => (
            <div
              key={opt}
              className={`dropdown-option ${opt === editor.currentValue ? 'selected' : ''}`}
              onClick={() => selectOption(opt)}
            >
              {opt || '(none)'}
            </div>
          ))}
        </div>
      )}

      {editor && editor.type === 'text' && (
        <div
          style={{
            position: 'fixed',
            top: editor.rect.top,
            left: editor.rect.left,
            width: editor.rect.width,
            zIndex: 9999,
          }}
        >
          <input
            ref={inputRef}
            className="inline-input"
            type={editor.field === 'trip' ? 'number' : 'text'}
            defaultValue={editor.currentValue}
            onBlur={saveText}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); saveText() }
              if (e.key === 'Escape') setEditor(null)
            }}
          />
        </div>
      )}
    </div>
  )
}
