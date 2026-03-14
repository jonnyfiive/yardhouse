import { useState, useEffect, useCallback } from 'react'
import { useTheme } from './hooks/useTheme'
import { useApi, getDeliveryDate } from './hooks/useApi'
import { BriefingData, Topic, Customer, CustomerProduct } from './types/briefing'
import Header from './components/Header'
import TickerBar from './components/TickerBar'
import DeliveriesTable from './components/DeliveriesTable'
import TodoCard from './components/TodoCard'
import TopicPanel from './components/TopicPanel'
import CustomerPanel from './components/CustomerPanel'
import DeliveryReceiptPanel from './components/DeliveryReceiptPanel'
import ProductionPanel from './components/ProductionPanel'

// Import the static briefing data
import briefingDataJson from '../briefing-data.json'

export default function App() {
  const { toggle: toggleTheme } = useTheme()
  const { fetchDeliveries, updateDelivery, createDelivery, clearCache, fetchBriefing, fetchCustomers } = useApi()

  const [data, setData] = useState<BriefingData>(() => {
    const base = briefingDataJson as BriefingData
    try {
      const cached = localStorage.getItem('jn-deliveries-cache')
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed.date === getDeliveryDate().date) {
          return { ...base, deliveries: parsed.deliveries }
        }
      }
    } catch {}
    return base
  })
  const [activePanel, setActivePanel] = useState<string | null>(null)
  const [activeTopic, setActiveTopic] = useState<Topic | null>(null)
  const [topicOpen, setTopicOpen] = useState(false)
  const [focusCustomerName, setFocusCustomerName] = useState<string | null>(null)
  const [customers, setCustomers] = useState<Customer[]>(() => {
    try {
      const cached = localStorage.getItem('jn-customers-cache')
      return cached ? JSON.parse(cached) : []
    } catch { return [] }
  })
  const [customersLoading, setCustomersLoading] = useState(false)

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        togglePanel('customers')
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        togglePanel('receipt')
      }
      if (e.key === 'Escape') {
        setActivePanel(null)
        setTopicOpen(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [toggleTheme])

  // Pre-load customers on app start so the panel is always instant
  const loadCustomers = useCallback(async () => {
    setCustomersLoading(true)
    try {
      const data = await fetchCustomers()
      const list = data.customers || data
      if (Array.isArray(list) && list.length > 0) {
        const transformed: Customer[] = list.map((c: any) => {
          const products: CustomerProduct[] = (c.products || []).map((p: any) => {
            const rawName = p.name || p.product || ''
            const cleanName = rawName.includes(' - ') ? rawName.split(' - ').slice(1).join(' - ') : rawName
            return {
              id: p.id,
              name: cleanName,
              price: p.price != null ? `$${Number(p.price).toFixed(2)}` : '',
              numericPrice: p.price,
              cost: p.cost != null ? `$${Number(p.cost).toFixed(2)}` : undefined,
              numericCost: p.cost,
              unit: p.category || undefined,
            }
          })
          return { ...c, products }
        })
        setCustomers(transformed)
        try { localStorage.setItem('jn-customers-cache', JSON.stringify(transformed)) } catch {}
      }
    } catch {
      // server not available — cached data still showing
    } finally {
      setCustomersLoading(false)
    }
  }, [fetchCustomers])

  const refreshCustomers = useCallback(async () => {
    await clearCache()
    await loadCustomers()
  }, [clearCache, loadCustomers])

  // Initial data fetch
  useEffect(() => {
    refreshDeliveries()
    loadCustomers()
  }, [])

  // Poll briefing data every 3 minutes (email poller updates)
  useEffect(() => {
    const pollBriefing = async () => {
      try {
        const result = await fetchBriefing()
        if (result && !result.error) {
          setData(prev => ({
            ...prev,
            waitingOn: result.waitingOn ?? prev.waitingOn,
            overdue: result.overdue ?? prev.overdue,
            nextMoves: result.nextMoves ?? prev.nextMoves,
            todaysActions: result.todaysActions ?? prev.todaysActions,
            topics: result.topics ?? prev.topics,
          }))
        }
      } catch {
        // Server not running, keep static data
      }
    }
    // Initial fetch
    pollBriefing()
    const interval = setInterval(pollBriefing, 180_000) // 3 minutes
    return () => clearInterval(interval)
  }, [fetchBriefing])

  const refreshDeliveries = useCallback(async () => {
    try {
      const result = await fetchDeliveries()
      if (result.deliveries) {
        setData(prev => ({ ...prev, deliveries: result.deliveries }))
        try { localStorage.setItem('jn-deliveries-cache', JSON.stringify({ date: getDeliveryDate().date, deliveries: result.deliveries })) } catch {}
      }
    } catch {
      // Server not running, use static data
    }
  }, [clearCache, fetchDeliveries])

  const handleDeliveryUpdate = useCallback(async (id: string, field: string, value: any) => {
    try {
      await updateDelivery(id, field, value)
      setData(prev => ({
        ...prev,
        deliveries: prev.deliveries.map(d =>
          d.id === id ? { ...d, [field]: value } : d
        ),
      }))
    } catch (err) {
      console.error('Failed to update delivery:', err)
    }
  }, [updateDelivery])

  const togglePanel = (panel: string) => {
    setActivePanel(prev => prev === panel ? null : panel)
    setTopicOpen(false)
    setFocusCustomerName(null)
  }

  const openTopic = (topicId: string) => {
    const topic = data.topics?.[topicId]
    if (topic) {
      setActiveTopic(topic)
      setTopicOpen(true)
      setActivePanel(null)
    }
  }

  const closeTopic = () => {
    setTopicOpen(false)
    setActiveTopic(null)
  }

  const handleCustomerClick = (name: string) => {
    setFocusCustomerName(name)
    setActivePanel('customers')
  }

  return (
    <div className="app">
      <Header
        onToggleTheme={toggleTheme}
        onToggleCustomers={() => togglePanel('customers')}
        onToggleSchedule={() => togglePanel('schedule')}
        onToggleReceipt={() => togglePanel('receipt')}
        onToggleProduction={() => togglePanel('production')}
        activePanel={activePanel}
      />
      <TickerBar />

      {activePanel === 'receipt' ? (
        <DeliveryReceiptPanel onClose={() => setActivePanel(null)} />
      ) : activePanel === 'production' ? (
        <ProductionPanel onClose={() => setActivePanel(null)} />
      ) : (
        <div className="container">
          <div className="grid">
            <div className="main-col">
              <DeliveriesTable
                deliveries={data.deliveries}
                onUpdate={handleDeliveryUpdate}
                onCreate={createDelivery}
                onRefresh={refreshDeliveries}
                onCustomerClick={handleCustomerClick}
                customers={customers}
              />
            </div>
            <div className="sidebar">
              <TodoCard />
            </div>
          </div>
        </div>
      )}

      {/* Backdrop — click anywhere outside panel to close */}
      {((activePanel && activePanel !== 'receipt' && activePanel !== 'production') || topicOpen) && (
        <div
          className="panel-backdrop visible"
          onClick={() => { setActivePanel(null); setTopicOpen(false) }}
        />
      )}

      {/* Side Panels (render after backdrop so they sit on top) */}
      <TopicPanel
        topic={activeTopic}
        isOpen={topicOpen}
        onClose={closeTopic}
      />
      <CustomerPanel
        isOpen={activePanel === 'customers'}
        onClose={() => setActivePanel(null)}
        customers={customers}
        loading={customersLoading}
        onRefresh={refreshCustomers}
        onCustomersUpdate={setCustomers}
        focusCustomerName={focusCustomerName}
      />
    </div>
  )
}
