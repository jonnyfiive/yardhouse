import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi'

interface ARBadge {
  total_open: number
  total_overdue: number
}

interface OverdueItem {
  customer: string
  overdue_amount: number
  total_balance: number
}

export default function TickerBar() {
  const { fetchQBOStatus, fetchARSummary, fetchARTopOverdue, API_BASE } = useApi()
  const [connected, setConnected] = useState(false)
  const [ar, setAr] = useState<ARBadge | null>(null)
  const [overdueItems, setOverdueItems] = useState<OverdueItem[]>([])

  useEffect(() => {
    loadStatus()
  }, [])

  async function loadStatus() {
    try {
      const status = await fetchQBOStatus()
      setConnected(status.connected)
      if (status.connected) {
        const arData = await fetchARSummary()
        if (!arData.error) setAr(arData)
        const topData = await fetchARTopOverdue()
        if (topData.top_overdue) setOverdueItems(topData.top_overdue)
      }
    } catch {
      // Server not running
    }
  }

  function connectQuickBooks() {
    window.open(`${API_BASE}/qbo/connect`, '_blank')
    const check = setInterval(async () => {
      try {
        const status = await fetchQBOStatus()
        if (status.connected) {
          clearInterval(check)
          loadStatus()
        }
      } catch {}
    }, 3000)
    setTimeout(() => clearInterval(check), 300000)
  }

  const fmt = (n: number) => '$' + Math.round(n).toLocaleString()

  const tickerItems = overdueItems.length > 0
    ? overdueItems.map((c, i) => (
        <div className="ticker-item" key={i}>
          <strong>#{i + 1}</strong> {c.customer} — <strong>{fmt(c.overdue_amount)}</strong> overdue ({fmt(c.total_balance)} total open)
        </div>
      ))
    : [<div className="ticker-item" key="none">No overdue balances</div>]

  return (
    <div className="ticker-bar">
      <div className="ar-badges">
        {connected && ar ? (
          <>
            <div className="ar-badge">
              <span className="ar-badge-label">Open</span>
              <span className="ar-badge-value">{fmt(ar.total_open)}</span>
            </div>
            <div className="ar-badge overdue">
              <span className="ar-badge-label">Overdue</span>
              <span className="ar-badge-value">{fmt(ar.total_overdue)}</span>
            </div>
          </>
        ) : (
          <button className="ar-connect-btn" onClick={connectQuickBooks}>
            Connect QuickBooks
          </button>
        )}
      </div>
      <div className="ticker">
        <div className="ticker-content">
          {tickerItems}
          {/* Duplicate for seamless scroll */}
          {tickerItems}
        </div>
      </div>
    </div>
  )
}
