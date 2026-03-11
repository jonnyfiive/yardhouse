export interface Delivery {
  id?: string
  date?: string
  time: string
  customer: string
  notes: string
  driver: string
  trip: string | number
  status: string
  type: string
}

export interface WaitingItem {
  topicId: string
  contact: string
  subject: string
  days: number
}

export interface OverdueItem {
  topicId: string
  contact: string
  opportunity: string
  lastContact: string
}

export interface NextMove {
  topicId: string
  text: string
}

export interface TopicPill {
  text: string
  cls: string
}

export interface TopicAction {
  icon: string
  text: string
  id: string
}

export interface TopicDraft {
  label: string
  to: string
  text: string
}

export interface Topic {
  label: string
  title: string
  pills: TopicPill[]
  messages: { text: string }[]
  actions: TopicAction[]
  drafts: Record<string, TopicDraft>
}

export interface BriefingData {
  generated: string
  date: string
  dateLabel: string
  title: string
  priority: string
  todaysActions: string[]
  deliveries: Delivery[]
  sentToday: string[]
  waitingOn: WaitingItem[]
  overdue: OverdueItem[]
  nextMoves: NextMove[]
  topics: Record<string, Topic>
}

export interface CustomerProduct {
  id?: string
  name: string
  description?: string
  price: string
  numericPrice?: number
  cost?: string
  numericCost?: number
  unit?: string
}

export interface Customer {
  id: string
  name: string
  address?: string
  address2?: string
  billingAddress?: string
  phone?: string
  contacts: CustomerContact[]
  group?: string
  hours?: string
  notes?: string
  products?: CustomerProduct[]
}

export interface CustomerContact {
  name: string
  email: string
  title: string
  phone: string
}

export interface ReceiptLineItem {
  quantity: string
  productKey: string
  description: string
  unitCost: string
  amount: number
}

export const DELIVERY_STATUSES = ['Pending', 'Scheduled', 'Loaded', 'On Route', 'Completed', 'Cancelled']
export const DELIVERY_DRIVERS = ['', 'Adalid Torres', 'Tito Estrada', 'Nick De Oleviera']
export const DELIVERY_TYPES = ['Delivery', 'Pick Up', 'Drop Trailer', 'Pick Up Trailer', 'CPU']
