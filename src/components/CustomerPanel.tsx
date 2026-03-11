import { useState, useEffect } from 'react'
import { Customer, CustomerProduct } from '../types/briefing'

interface Props {
  isOpen: boolean
  onClose: () => void
  customers: Customer[]
  loading: boolean
  onRefresh: () => void
  onCustomersUpdate: (customers: Customer[]) => void
  focusCustomerName?: string | null
}

const API_BASE = 'http://localhost:5050'

interface EditForm {
  address: string
  phone: string
  notes: string
  products: { id?: string; name: string; price: string; numericPrice?: number }[]
}

export default function CustomerPanel({ isOpen, onClose, customers, loading, onRefresh, onCustomersUpdate, focusCustomerName }: Props) {
  const [search, setSearch] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState<EditForm>({ address: '', phone: '', notes: '', products: [] })

  useEffect(() => {
    if (!isOpen) {
      setSelectedCustomer(null)
      setEditing(false)
    }
  }, [isOpen])

  // Auto-select customer when opened from deliveries table
  useEffect(() => {
    if (isOpen && focusCustomerName && customers.length > 0) {
      const needle = focusCustomerName.toLowerCase()
      const match = customers.find(c => c.name.toLowerCase() === needle)
        || customers.find(c => c.name.toLowerCase().includes(needle))
        || customers.find(c => needle.includes(c.name.toLowerCase()))
      if (match) {
        setSelectedCustomer(match)
        setEditing(false)
      }
    }
  }, [isOpen, focusCustomerName, customers])

  function selectCustomer(customer: Customer) {
    setSelectedCustomer(customer)
    setEditing(false)
  }

  const filtered = customers
    .filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))

  const startEdit = () => {
    if (!selectedCustomer) return
    setEditForm({
      address: selectedCustomer.address || '',
      phone: selectedCustomer.phone || '',
      notes: selectedCustomer.notes || '',
      products: (selectedCustomer.products || []).map(p => ({
        id: p.id,
        name: p.name,
        price: p.price,
        numericPrice: p.numericPrice,
      })),
    })
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
  }

  const saveEdit = async () => {
    if (!selectedCustomer) return
    setSaving(true)

    try {
      // 1. Update company fields in Notion
      await fetch(`${API_BASE}/api/customers/${selectedCustomer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: editForm.address,
          phone: editForm.phone,
          notes: editForm.notes,
        }),
      })

      // 2. Update product prices in Notion
      for (const product of editForm.products) {
        if (product.id && product.numericPrice != null) {
          // Find the original to see if price changed
          const original = selectedCustomer.products?.find(p => p.id === product.id)
          if (original && original.numericPrice !== product.numericPrice) {
            await fetch(`${API_BASE}/api/products/${product.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ price: product.numericPrice }),
            })
          }
        }
      }

      // 3. Update local state
      const updated: Customer = {
        ...selectedCustomer,
        address: editForm.address,
        phone: editForm.phone,
        notes: editForm.notes,
        products: editForm.products.map(p => ({
          ...p,
          price: p.numericPrice != null ? `$${Number(p.numericPrice).toFixed(2)}` : p.price,
        })),
      }
      setSelectedCustomer(updated)
      onCustomersUpdate(customers.map(c => c.id === updated.id ? updated : c))
      setEditing(false)
    } catch (err) {
      console.error('Save failed:', err)
    } finally {
      setSaving(false)
    }
  }

  const closeDetail = () => {
    setSelectedCustomer(null)
    setEditing(false)
  }

  const updateProductPrice = (index: number, value: string) => {
    const num = parseFloat(value)
    setEditForm(prev => ({
      ...prev,
      products: prev.products.map((p, i) =>
        i === index ? { ...p, numericPrice: isNaN(num) ? undefined : num } : p
      ),
    }))
  }

  return (
    <>
      {/* List panel */}
      <div className={`customer-panel ${isOpen ? 'open' : ''}`}>
        <div className="cust-panel-header">
          <span className="section-header" style={{ marginBottom: 0 }}>Customers</span>
          <button className="cust-refresh-btn" onClick={onRefresh} disabled={loading}>
            {loading ? '...' : '↻'}
          </button>
        </div>
        <input
          type="text"
          className="customer-search"
          placeholder="Search customers..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <ul className="customer-list">
          {filtered.map(c => (
            <li
              key={c.id}
              className="customer-list-item"
              onClick={() => selectCustomer(c)}
            >
              <span className="customer-list-name">{c.name}</span>
              {c.products && c.products.length > 0 && (
                <span className="customer-list-rate">{c.products[0].name} @ {c.products[0].price}</span>
              )}
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="empty-state">
              <div className="empty-state-text">{loading ? 'Loading customers...' : 'No customers found'}</div>
            </li>
          )}
        </ul>
      </div>

      {/* Backdrop — click to close everything */}
      {selectedCustomer && (
        <div className="cust-detail-backdrop" onClick={onClose} />
      )}

      {/* Detail panel */}
      <div className={`customer-detail-panel ${selectedCustomer ? 'open' : ''}`}>
        {selectedCustomer && (
          <>
            <div className="cust-detail-header">
              <div className="cust-detail-name">{selectedCustomer.name}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {!editing ? (
                  <button className="cust-edit-btn" onClick={startEdit}>Edit</button>
                ) : (
                  <>
                    <button className="cust-save-btn" onClick={saveEdit} disabled={saving}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button className="cust-cancel-btn" onClick={cancelEdit}>Cancel</button>
                  </>
                )}
                <button className="cust-detail-close" onClick={closeDetail}>&times;</button>
              </div>
            </div>

            {/* Address */}
            <div className="cust-field">
              <span className="cust-field-label">Address</span>
              {editing ? (
                <input
                  className="cust-edit-input"
                  value={editForm.address}
                  onChange={e => setEditForm(prev => ({ ...prev, address: e.target.value }))}
                  placeholder="Address..."
                />
              ) : (
                <div className="cust-field-value">{selectedCustomer.address || '—'}</div>
              )}
            </div>

            {/* Phone */}
            <div className="cust-field">
              <span className="cust-field-label">Phone</span>
              {editing ? (
                <input
                  className="cust-edit-input"
                  value={editForm.phone}
                  onChange={e => setEditForm(prev => ({ ...prev, phone: e.target.value }))}
                  placeholder="Phone..."
                />
              ) : (
                <div className="cust-field-value">{selectedCustomer.phone || '—'}</div>
              )}
            </div>

            {/* Notes */}
            <div className="cust-field">
              <span className="cust-field-label">Notes</span>
              {editing ? (
                <textarea
                  className="cust-edit-textarea"
                  value={editForm.notes}
                  onChange={e => setEditForm(prev => ({ ...prev, notes: e.target.value }))}
                  rows={3}
                  placeholder="Notes..."
                />
              ) : (
                <div className="cust-field-value">{selectedCustomer.notes || '—'}</div>
              )}
            </div>

            {/* Contacts (read-only — managed in Notion) */}
            {selectedCustomer.contacts && selectedCustomer.contacts.length > 0 && (
              <div className="cust-field">
                <span className="cust-field-label">Contacts</span>
                {selectedCustomer.contacts.map((c, i) => (
                  <div key={i} className="contact-row">
                    <div className="contact-row-name">{c.name}</div>
                    {c.email && <div className="contact-row-email">{c.email}</div>}
                    {c.phone && <div className="contact-row-phone">{c.phone}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Products & Rates */}
            {((selectedCustomer.products && selectedCustomer.products.length > 0) || editing) && (
              <div className="cust-field">
                <span className="cust-field-label">Products &amp; Rates</span>
                <div className="cust-products">
                  {editing ? (
                    editForm.products.map((p, i) => (
                      <div key={i} className="cust-product-row">
                        <span className="cust-product-name">{p.name}</span>
                        <div className="cust-product-edit-price">
                          <span>$</span>
                          <input
                            type="number"
                            step="0.25"
                            className="cust-price-input"
                            value={p.numericPrice ?? ''}
                            onChange={e => updateProductPrice(i, e.target.value)}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    selectedCustomer.products?.map((p, i) => (
                      <div key={i} className="cust-product-row">
                        <span className="cust-product-name">{p.name}</span>
                        <span className="cust-product-price">{p.price}</span>
                        {p.cost && <span className="cust-product-cost">{p.cost}</span>}
                        {p.unit && <span className="cust-product-category">{p.unit}</span>}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Notion link */}
            {(selectedCustomer as any).notionUrl && (
              <div className="cust-field" style={{ marginTop: 8 }}>
                <a
                  href={(selectedCustomer as any).notionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cust-notion-link"
                >
                  Open in Notion
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
