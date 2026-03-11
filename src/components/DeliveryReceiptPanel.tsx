import { useState, useEffect, useRef, useCallback } from 'react'
import { useApi } from '../hooks/useApi'
import type { Customer, CustomerProduct, ReceiptLineItem } from '../types/briefing'

interface DeliveryReceiptPanelProps {
  onClose: () => void
}

const STORAGE_KEY = 'jn-last-invoice-number'

const STARTING_INVOICE = 29640

function getNextInvoice(): string {
  const last = localStorage.getItem(STORAGE_KEY)
  if (last) {
    const num = parseInt(last, 10)
    return isNaN(num) ? String(STARTING_INVOICE) : String(num + 1)
  }
  return String(STARTING_INVOICE)
}

function todayString(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${d.getFullYear()}`
}

const emptyLine = (): ReceiptLineItem => ({ quantity: '', productKey: '', description: '', unitCost: '', amount: 0 })

// Strip "Company Name - " prefix from product names for cleaner receipt display
function stripCompanyPrefix(productName: string): string {
  const dashIdx = productName.indexOf(' - ')
  return dashIdx !== -1 ? productName.substring(dashIdx + 3) : productName
}

export default function DeliveryReceiptPanel({ onClose }: DeliveryReceiptPanelProps) {
  const { fetchCustomers } = useApi()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [customerSearch, setCustomerSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [invoiceNumber, setInvoiceNumber] = useState(getNextInvoice)
  const [date, setDate] = useState(todayString)
  const [shipVia, setShipVia] = useState('JN')
  const [purchaseOrder, setPurchaseOrder] = useState('')
  const [trailerNo, setTrailerNo] = useState('')

  const [billTo, setBillTo] = useState({ name: '', street: '', cityStateZip: '' })
  const [shipTo, setShipTo] = useState({ name: '', street: '', cityStateZip: '' })
  const [shipToSame, setShipToSame] = useState(true)

  const [lineItems, setLineItems] = useState<ReceiptLineItem[]>([emptyLine()])

  const transformCustomers = (list: any[]): Customer[] =>
    list.map((c: any) => ({
      ...c,
      products: (c.products || []).map((p: any) => ({
        id: p.id,
        name: p.name || p.product || '',
        description: p.description || '',
        price: p.price != null ? `$${Number(p.price).toFixed(2)}` : '',
        numericPrice: typeof p.price === 'number' ? p.price : undefined,
        cost: p.cost != null ? `$${Number(p.cost).toFixed(2)}` : undefined,
        numericCost: typeof p.cost === 'number' ? p.cost : undefined,
        unit: p.category || undefined,
      })),
    }))

  const loadCustomers = () => {
    fetchCustomers()
      .then((res: any) => {
        const list = res.customers || (Array.isArray(res) ? res : [])
        setCustomers(transformCustomers(list))
      })
      .catch(() => {})
  }

  // Load customers
  useEffect(() => { loadCustomers() }, [])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const parseAddress = (raw: string) => {
    const parts = raw.split(',').map(s => s.trim())
    if (parts.length >= 3) {
      return { street: parts[0], cityStateZip: parts.slice(1).join(', ') }
    } else if (parts.length === 2) {
      return { street: parts[0], cityStateZip: parts[1] }
    }
    return { street: raw, cityStateZip: '' }
  }

  const selectCustomer = (c: Customer) => {
    setSelectedCustomer(c)
    setCustomerSearch(c.name)
    setShowDropdown(false)

    // Billing address for Bill To (fall back to shipping if empty)
    const billingRaw = c.billingAddress || c.address || ''
    const billing = parseAddress(billingRaw)
    setBillTo({ name: c.name, ...billing })

    // Shipping address for Ship To
    const shippingRaw = c.address || ''
    const shipping = parseAddress(shippingRaw)
    setShipTo({ name: c.name, ...shipping })

    // If billing and shipping are the same, keep checkbox on
    setShipToSame(billingRaw === shippingRaw || !c.billingAddress)
  }

  const filteredCustomers = customerSearch.trim() === ''
    ? customers
    : customers.filter(c => c.name.toLowerCase().includes(customerSearch.toLowerCase()))

  const updateLineItem = (index: number, field: keyof ReceiptLineItem, value: string) => {
    setLineItems(prev => {
      const updated = [...prev]
      const item = { ...updated[index] }

      if (field === 'quantity' || field === 'unitCost') {
        (item as any)[field] = value
        const qty = parseFloat(item.quantity) || 0
        const cost = parseFloat(item.unitCost) || 0
        item.amount = qty * cost
      } else if (field === 'description') {
        // value is the product name (key); find the product and use its Notion description for the receipt
        item.productKey = value
        if (selectedCustomer?.products) {
          const product = selectedCustomer.products.find(p => p.name === value)
          if (product) {
            item.description = product.description || stripCompanyPrefix(product.name)
            if (product.numericPrice) {
              item.unitCost = product.numericPrice.toFixed(2)
              const qty = parseFloat(item.quantity) || 0
              item.amount = qty * product.numericPrice
            }
          } else {
            item.description = value
          }
        } else {
          item.description = value
        }
      } else {
        (item as any)[field] = value
      }

      updated[index] = item
      return updated
    })
  }

  const addRow = () => setLineItems(prev => [...prev, emptyLine()])

  const removeRow = (index: number) => {
    if (lineItems.length <= 1) return
    setLineItems(prev => prev.filter((_, i) => i !== index))
  }

  const total = lineItems.reduce((sum, li) => sum + li.amount, 0)

  const handlePrint = () => {
    if (invoiceNumber) {
      localStorage.setItem(STORAGE_KEY, invoiceNumber)
    }
    window.print()
  }

  const handleNewReceipt = () => {
    if (invoiceNumber) {
      localStorage.setItem(STORAGE_KEY, invoiceNumber)
    }
    setInvoiceNumber(getNextInvoice())
    setDate(todayString())
    setShipVia('JN')
    setPurchaseOrder('')
    setTrailerNo('')
    setSelectedCustomer(null)
    setCustomerSearch('')
    setBillTo({ name: '', street: '', cityStateZip: '' })
    setShipTo({ name: '', street: '', cityStateZip: '' })
    setShipToSame(true)
    setLineItems([emptyLine()])
  }

  const handleShipToSameToggle = (checked: boolean) => {
    setShipToSame(checked)
    if (checked) {
      setShipTo({ ...billTo })
    }
  }

  // Keep shipTo in sync when billTo changes and checkbox is on
  useEffect(() => {
    if (shipToSame) {
      setShipTo({ ...billTo })
    }
  }, [billTo, shipToSame])

  const products: CustomerProduct[] = selectedCustomer?.products || []

  // Product picker popover state
  const [pickerOpen, setPickerOpen] = useState<number | null>(null) // which row index has picker open
  const [pickerSearch, setPickerSearch] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)
  const pickerInputRef = useRef<HTMLInputElement>(null)

  // Close picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(null)
        setPickerSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const openPicker = useCallback((rowIndex: number) => {
    setPickerOpen(rowIndex)
    setPickerSearch('')
    setTimeout(() => pickerInputRef.current?.focus(), 0)
  }, [])

  const selectProduct = (rowIndex: number, product: CustomerProduct) => {
    updateLineItem(rowIndex, 'description', product.name)
    setPickerOpen(null)
    setPickerSearch('')
  }

  const filteredProducts = pickerSearch.trim() === ''
    ? products
    : products.filter(p =>
        stripCompanyPrefix(p.name).toLowerCase().includes(pickerSearch.toLowerCase()) ||
        (p.description || '').toLowerCase().includes(pickerSearch.toLowerCase())
      )

  return (
    <div className="receipt-panel">
      <div className="receipt-toolbar no-print">
        <button className="receipt-btn receipt-btn-back" onClick={onClose}>Back</button>
        <button className="receipt-btn receipt-btn-new" onClick={handleNewReceipt}>New Receipt</button>
        <button className="receipt-btn receipt-btn-print" onClick={handlePrint}>Print</button>
      </div>

      <div className="receipt-page">
        {/* Company Header */}
        <div className="receipt-header">
          <div className="receipt-brand">
            <div className="receipt-brand-name">JUST NATION</div>
            <div className="receipt-brand-addr">271 Meadow Road</div>
            <div className="receipt-brand-addr">Edison, NJ 08817</div>
            <div className="receipt-brand-addr">732-985-7300</div>
            <div className="receipt-brand-addr">accounting@justnationllc.com</div>
          </div>
          <div className="receipt-title-block">
            <div className="receipt-title">DELIVERY RECEIPT</div>
            <input
              className="receipt-input receipt-invoice-input"
              value={invoiceNumber ? `Invoice: ${invoiceNumber}` : ''}
              onChange={e => {
                const raw = e.target.value.replace(/^Invoice:\s*/, '')
                setInvoiceNumber(raw)
              }}
              placeholder="Invoice: #"
            />
          </div>
        </div>

        {/* Customer Selector (screen only) */}
        <div className="receipt-customer-selector no-print" ref={dropdownRef}>
          <label className="receipt-field-label">Customer</label>
          <input
            className="receipt-input"
            value={customerSearch}
            onChange={e => { setCustomerSearch(e.target.value); setShowDropdown(true); setHighlightedIndex(0) }}
            onFocus={e => { e.target.select(); setShowDropdown(true); setHighlightedIndex(0); if (customers.length === 0) loadCustomers() }}
            onKeyDown={e => {
              const visible = filteredCustomers.slice(0, 20)
              if (!showDropdown || visible.length === 0) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setHighlightedIndex(prev => Math.min(prev + 1, visible.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setHighlightedIndex(prev => Math.max(prev - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                selectCustomer(visible[highlightedIndex])
              } else if (e.key === 'Escape') {
                setShowDropdown(false)
              }
            }}
            placeholder="Search customers..."
          />
          {showDropdown && filteredCustomers.length > 0 && (
            <div className="receipt-customer-dropdown">
              {filteredCustomers.slice(0, 20).map((c, i) => (
                <div
                  key={c.id}
                  className={`receipt-customer-option${i === highlightedIndex ? ' highlighted' : ''}`}
                  onMouseDown={() => selectCustomer(c)}
                  onMouseEnter={() => setHighlightedIndex(i)}
                >
                  {c.name}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bill To / Ship To */}
        <div className="receipt-addresses">
          <div className="receipt-address-box">
            <div className="receipt-address-label">Bill To:</div>
            <input
              className="receipt-input receipt-addr-name"
              value={billTo.name}
              onChange={e => setBillTo(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Company name"
            />
            <input
              className="receipt-input receipt-addr-line"
              value={billTo.street}
              onChange={e => setBillTo(prev => ({ ...prev, street: e.target.value }))}
              placeholder="Street address"
            />
            <input
              className="receipt-input receipt-addr-line"
              value={billTo.cityStateZip}
              onChange={e => setBillTo(prev => ({ ...prev, cityStateZip: e.target.value }))}
              placeholder="City, State ZIP"
            />
          </div>
          <div className="receipt-address-box">
            <div className="receipt-address-label">
              Ship To:
              <label className="receipt-same-check no-print">
                <input
                  type="checkbox"
                  checked={shipToSame}
                  onChange={e => handleShipToSameToggle(e.target.checked)}
                />
                Same
              </label>
            </div>
            <input
              className="receipt-input receipt-addr-name"
              value={shipTo.name}
              onChange={e => setShipTo(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Company name"
              disabled={shipToSame}
            />
            <input
              className="receipt-input receipt-addr-line"
              value={shipTo.street}
              onChange={e => setShipTo(prev => ({ ...prev, street: e.target.value }))}
              placeholder="Street address"
              disabled={shipToSame}
            />
            <input
              className="receipt-input receipt-addr-line"
              value={shipTo.cityStateZip}
              onChange={e => setShipTo(prev => ({ ...prev, cityStateZip: e.target.value }))}
              placeholder="City, State ZIP"
              disabled={shipToSame}
            />
          </div>
        </div>

        {/* Info Row */}
        <div className="receipt-info-row">
          <div className="receipt-info-cell">
            <div className="receipt-info-label">Date</div>
            <input
              className="receipt-input"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
          <div className="receipt-info-cell">
            <div className="receipt-info-label">Ship Via</div>
            <input
              className="receipt-input"
              value={shipVia}
              onChange={e => setShipVia(e.target.value)}
            />
          </div>
          <div className="receipt-info-cell">
            <div className="receipt-info-label">Purchase Order</div>
            <input
              className="receipt-input"
              value={purchaseOrder}
              onChange={e => setPurchaseOrder(e.target.value)}
            />
          </div>
          <div className="receipt-info-cell">
            <div className="receipt-info-label">Trailer No.</div>
            <input
              className="receipt-input"
              value={trailerNo}
              onChange={e => setTrailerNo(e.target.value)}
            />
          </div>
        </div>

        {/* Line Items Box */}
        <div className="receipt-items-box">
          <div className="receipt-items-header">
            <div className="receipt-items-col-qty">Quantity</div>
            <div className="receipt-items-col-desc">Description</div>
          </div>
          <div className="receipt-items-body">
            {lineItems.map((li, i) => (
              <div className="receipt-items-row" key={i}>
                <div className="receipt-items-col-qty">
                  <input
                    className="receipt-input receipt-input-num"
                    value={li.quantity}
                    onChange={e => updateLineItem(i, 'quantity', e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="receipt-items-col-desc">
                  <div className="desc-combo no-print">
                    {products.length > 0 && (
                      <div className="desc-picker-wrap" ref={pickerOpen === i ? pickerRef : undefined}>
                        <button
                          className="desc-add-btn"
                          onClick={() => pickerOpen === i ? setPickerOpen(null) : openPicker(i)}
                          title="Select product"
                        >+</button>
                        {pickerOpen === i && (
                          <div className="desc-picker-popover">
                            <input
                              ref={pickerInputRef}
                              className="desc-picker-search"
                              value={pickerSearch}
                              onChange={e => setPickerSearch(e.target.value)}
                              placeholder="Search products..."
                              onKeyDown={e => {
                                if (e.key === 'Escape') { setPickerOpen(null); setPickerSearch('') }
                              }}
                            />
                            <div className="desc-picker-list">
                              {filteredProducts.length > 0 ? filteredProducts.map(p => (
                                <div
                                  key={p.name}
                                  className="desc-picker-item"
                                  onMouseDown={() => selectProduct(i, p)}
                                >
                                  <span className="desc-picker-name">{stripCompanyPrefix(p.name)}</span>
                                </div>
                              )) : (
                                <div className="desc-picker-empty">No products found</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <input
                      className="receipt-input desc-text-input"
                      value={li.description}
                      onChange={e => {
                        setLineItems(prev => {
                          const updated = [...prev]
                          updated[i] = { ...updated[i], description: e.target.value, productKey: '' }
                          return updated
                        })
                      }}
                      placeholder="Description"
                    />
                  </div>
                  <span className="print-only">{li.description}</span>
                </div>
                <div className="receipt-items-col-x no-print">
                  {lineItems.length > 1 && (
                    <button
                      className="receipt-remove-row"
                      onClick={() => removeRow(i)}
                      title="Remove row"
                    >x</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="no-print" style={{ marginTop: '8px' }}>
          <button className="receipt-btn receipt-btn-add" onClick={addRow}>+ Add Row</button>
        </div>

        {/* Signature */}
        <div className="receipt-signature">
          <div className="receipt-sig-label">Received By:</div>
          <div className="receipt-sig-line"></div>
        </div>
      </div>
    </div>
  )
}
