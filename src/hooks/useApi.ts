const API_BASE = 'http://localhost:5050'

/** Format a Date as YYYY-MM-DD in local time (avoids toISOString UTC shift) */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Get today's date for deliveries — always shows today */
export function getDeliveryDate(): { date: string; label: string } {
  const now = new Date()
  const date = toLocalDateStr(now)
  return { date, label: 'Deliveries Today' }
}

export function useApi() {
  async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, options)
    return res.json()
  }

  async function fetchDeliveries(): Promise<any> {
    const { date } = getDeliveryDate()
    return fetchJson(`/api/deliveries?date=${date}`)
  }

  async function updateDelivery(pageId: string, field: string, value: any): Promise<any> {
    return fetchJson(`/api/deliveries/${pageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    })
  }

  async function createDelivery(payload: any): Promise<any> {
    return fetchJson('/api/deliveries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  async function fetchCustomers(): Promise<any> {
    return fetchJson('/api/customers-with-products')
  }

  async function clearCache(): Promise<any> {
    return fetchJson('/api/cache/clear', { method: 'POST' })
  }

  async function fetchARSummary(): Promise<any> {
    return fetchJson('/api/ar-summary')
  }

  async function fetchQBOStatus(): Promise<any> {
    return fetchJson('/qbo/status')
  }

  async function fetchARTopOverdue(): Promise<any> {
    return fetchJson('/api/ar-top-overdue?limit=3')
  }

  async function fetchBriefing(): Promise<any> {
    return fetchJson('/api/briefing')
  }

  async function triggerEmailPoll(): Promise<any> {
    return fetchJson('/api/briefing/poll', { method: 'POST' })
  }

  async function sendChat(messages: { role: string; content: string }[]): Promise<any> {
    return fetchJson('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    })
  }

  async function fetchProduction(): Promise<any> {
    return fetchJson('/api/production')
  }

  async function saveProduction(data: any): Promise<any> {
    return fetchJson('/api/production', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
  }

  return {
    API_BASE,
    fetchDeliveries,
    updateDelivery,
    createDelivery,
    fetchCustomers,
    clearCache,
    fetchARSummary,
    fetchQBOStatus,
    fetchARTopOverdue,
    fetchBriefing,
    triggerEmailPoll,
    sendChat,
    fetchProduction,
    saveProduction,
  }
}
