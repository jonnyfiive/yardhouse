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

interface EditModalState {
  delivery: Delivery
}

export default function DeliveriesTable({ deliveries, onUpdate, onRefresh, onCreate, onCustomerClick, lastSync, customers }: Props) {
  const [editModal, setEditModal] = useState<EditModalState | null>(null)
  const [modalValues, setModalValues] = useState<Record<string, any>>({})
  const [refreshing, setRefreshing] = useState(false)
  const [showNewRow, setShowNewRow] = useState(false)
  const [newCustomer, setNewCustomer] = useState('')
  const [newType, setNewType] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [creating, setCreating] = useState(false)
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [modalCustomerSearch, setModalCustomerSearch] = useState('')
  const [showModalCustomerDropdown, setShowModalCustomerDropdown] = useState(false)
  const [modalCustomerHighlight, setModalCustomerHighlight] = useState(-1)
  const newInputRef = useRef<HTMLInputElement>(null)
  const customerDropdownRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const modalCustomerRef = useRef<HTMLDivElement>(null)

  const customerNames = customers.map(c => c.name)

  const filteredCustomers = newCustomer.trim()
    ? customerNames.filter(n => n.toLowerCase().includes(newCustomer.toLowerCase()))
    : customerNames

  const modalFilteredCustomers = modalCustomerSearch.trim()
    ? customerNames.filter(n => n.toLowerCase().includes(modalCustomerSearch.toLowerCase()))
    : customerNames

  // Close modal on outside click
  useEffect(() => {
    if (!editModal) return
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as HTMLElement)) {
        setEditModal(null)
      }
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 10)
    return () => document.removeEventListener('mousedown', handler)
  }, [editModal])

  // Close modal customer dropdown on outside click
  useEffect(() => {
    if (!showModalCustomerDropdown) return
    const handler = (e: MouseEvent) => {
      if (modalCustomerRef.current && !modalCustomerRef.current.contains(e.target as HTMLElement)) {
        setShowModalCustomerDropdown(false)
      }
    }
    setTimeout(() => document.addEventListener('mousedown', handler), 10)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModalCustomerDropdown])

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

  const handleRefresh = async () => {
    setRefreshing(true)
    await onRefresh()
    setRefreshing(false)
  }

  const openEditModal = (d: Delivery) => {
    setEditModal({ delivery: d })
    setModalValues({
      status: d.status,
      type: d.type,
      driver: d.driver || '',
      trip: d.trip || '',
      notes: d.notes || '',
      customer: d.customer,
    })
    setModalCustomerSearch(d.customer)
    setShowModalCustomerDropdown(false)
    setModalCustomerHighlight(-1)
  }

  const saveModal = () => {
    if (!editModal) return
    const d = editModal.delivery
    const id = d.id!
    // Only send updates for fields that actually changed
    if (modalValues.status !== d.status) onUpdate(id, 'status', modalValues.status)
    if (modalValues.type !== d.type) onUpdate(id, 'type', modalValues.type)
    if (modalValues.driver !== (d.driver || '')) onUpdate(id, 'driver', modalValues.driver)
    if (String(modalValues.trip) !== String(d.trip || '')) {
      const tripVal = modalValues.trip ? parseInt(modalValues.trip) : null
      onUpdate(id, 'trip', tripVal)
    }
    if (modalValues.notes !== (d.notes || '')) onUpdate(id, 'notes', modalValues.notes)
    if (modalValues.customer !== d.customer) {
      const match = customers.find(c => c.name === modalValues.customer)
      if (match) onUpdate(id, 'customerId', match.id)
    }
    setEditModal(null)
  }

  const handleCreate = async () => {
    if (!newCustomer.trim()) return
    setCreating(true)
    try {
      const match = customers.find(c => c.name.toLowerCase() === newCustomer.trim().toLowerCase())
      const payload: any = {
        notes: newNotes,
        status: 'Scheduled',
        date: getDeliveryDate().date,
      }
      if (newType) payload.type = newType
      if (match) payload.customerId = match.id
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
            <tr
              key={d.id || `${d.customer}-${idx}`}
              className="delivery-row-clickable"
              onClick={() => openEditModal(d)}
            >
              <td className="customer-cell">
                {d.customer}
              </td>
              <td className="editable-cell">
                {d.type}
              </td>
              <td className="editable-cell">
                {d.driver || ''}
                {d.trip && <sup className="trip-sup">{d.trip}</sup>}
              </td>
              <td className="editable-cell">
                <span className={`status-badge ${statusClass(d.status)}`}>{d.status}</span>
              </td>
              <td className="editable-cell truncate">
                {d.notes || ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {showNewRow && newRowContent}

      {/* Edit Delivery Modal */}
      {editModal && (
        <div className="delivery-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditModal(null) }}>
          <div ref={modalRef} className="delivery-modal">
            <div className="delivery-modal-header">
              <span className="delivery-modal-title">Edit Delivery</span>
              <button className="delivery-modal-close" onClick={() => setEditModal(null)}>×</button>
            </div>
            <div className="delivery-modal-body">

              {/* Company */}
              <label className="delivery-modal-label">Company</label>
              <div className="delivery-modal-customer-wrap">
                <input
                  className="delivery-modal-input"
                  value={modalCustomerSearch}
                  onChange={e => {
                    setModalCustomerSearch(e.target.value)
                    setModalValues(v => ({ ...v, customer: e.target.value }))
                    setShowModalCustomerDropdown(true)
                    setModalCustomerHighlight(-1)
                  }}
                  onFocus={() => setShowModalCustomerDropdown(true)}
                  onKeyDown={e => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault()
                      setShowModalCustomerDropdown(true)
                      setModalCustomerHighlight(prev => Math.min(prev + 1, modalFilteredCustomers.length - 1))
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault()
                      setModalCustomerHighlight(prev => Math.max(prev - 1, 0))
                    } else if (e.key === 'Enter' && showModalCustomerDropdown && modalFilteredCustomers.length > 0) {
                      e.preventDefault()
                      const pick = modalCustomerHighlight >= 0 ? modalCustomerHighlight : 0
                      const name = modalFilteredCustomers[pick]
                      setModalCustomerSearch(name)
                      setModalValues(v => ({ ...v, customer: name }))
                      setShowModalCustomerDropdown(false)
                    }
                  }}
                  autoComplete="off"
                />
                {showModalCustomerDropdown && modalFilteredCustomers.length > 0 && (
                  <div ref={modalCustomerRef} className="delivery-modal-customer-dropdown">
                    {modalFilteredCustomers.slice(0, 8).map((name, i) => (
                      <div
                        key={name}
                        className={`dropdown-option ${i === modalCustomerHighlight ? 'highlighted' : ''} ${name === modalValues.customer ? 'selected' : ''}`}
                        onMouseDown={e => {
                          e.preventDefault()
                          setModalCustomerSearch(name)
                          setModalValues(v => ({ ...v, customer: name }))
                          setShowModalCustomerDropdown(false)
                        }}
                        onMouseEnter={() => setModalCustomerHighlight(i)}
                      >
                        {name}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Status */}
              <label className="delivery-modal-label">Status</label>
              <div className="delivery-modal-options">
                {DELIVERY_STATUSES.map(s => (
                  <button
                    key={s}
                    className={`delivery-modal-option delivery-modal-status-${statusClass(s)} ${modalValues.status === s ? 'active' : ''}`}
                    onClick={() => setModalValues(v => ({ ...v, status: s }))}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Type */}
              <label className="delivery-modal-label">Type</label>
              <div className="delivery-modal-options">
                {DELIVERY_TYPES.map(t => (
                  <button
                    key={t}
                    className={`delivery-modal-option ${modalValues.type === t ? 'active' : ''}`}
                    onClick={() => setModalValues(v => ({ ...v, type: t }))}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Driver */}
              <label className="delivery-modal-label">Driver</label>
              <div className="delivery-modal-options">
                {DELIVERY_DRIVERS.map(d => (
                  <button
                    key={d || '__none'}
                    className={`delivery-modal-option ${modalValues.driver === d ? 'active' : ''}`}
                    onClick={() => setModalValues(v => ({ ...v, driver: d }))}
                  >
                    {d || '(none)'}
                  </button>
                ))}
              </div>

              {/* Trip */}
              <label className="delivery-modal-label">Trip #</label>
              <input
                className="delivery-modal-input"
                type="number"
                value={modalValues.trip}
                onChange={e => setModalValues(v => ({ ...v, trip: e.target.value }))}
                placeholder="Trip number"
              />

              {/* Notes */}
              <label className="delivery-modal-label">Notes</label>
              <textarea
                className="delivery-modal-textarea"
                value={modalValues.notes}
                onChange={e => setModalValues(v => ({ ...v, notes: e.target.value }))}
                placeholder="Delivery notes..."
                rows={3}
              />
            </div>
            <div className="delivery-modal-footer">
              <button className="delivery-modal-btn cancel" onClick={() => setEditModal(null)}>Cancel</button>
              <button className="delivery-modal-btn save" onClick={saveModal}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
