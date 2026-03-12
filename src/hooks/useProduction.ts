import { useState, useCallback, useRef, useEffect } from 'react'
import {
  ProductionData, Employee, WeekEntry, WeekData, DayKey, DAY_KEYS,
  PieceEntry, TimeEntry, CustomEntry, EmployeeDefaults,
} from '../types/production'

const MAX_WEEKS = 10

/** Format a Date as YYYY-MM-DD in local time (avoids toISOString UTC shift) */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function getThursdayStart(date: Date = new Date()): string {
  const d = new Date(date)
  const day = d.getDay()
  // Thu=4. If day < 4, go back to previous Thu. If day >= 4, go to this Thu.
  const diff = day >= 4 ? day - 4 : day + 3
  d.setDate(d.getDate() - diff)
  return toLocalDateStr(d)
}

function getWeekDates(thuStart: string): string[] {
  const d = new Date(thuStart + 'T12:00:00')
  const dates: string[] = []
  // Thu, Fri, Sat, (skip Sun), Mon, Tue, Wed
  for (let i = 0; i < 7; i++) {
    if (i === 3) { d.setDate(d.getDate() + 1); continue } // skip Sunday
    dates.push(toLocalDateStr(d))
    d.setDate(d.getDate() + 1)
  }
  return dates
}

function getWeekLabel(thuStart: string): string {
  const dates = getWeekDates(thuStart)
  const fmt = (s: string) => {
    const d = new Date(s + 'T12:00:00')
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
  return `${fmt(dates[0])} - ${fmt(dates[dates.length - 1])}`
}

function parseTime(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}

export function calculateTotal(
  employee: Employee,
  entry: WeekEntry,
  pieceRates: Record<string, number>,
  bonusRates?: { bundle: number; bundleSat: number },
): number {
  if (entry.totalOverride !== null) return entry.totalOverride

  let total = 0

  if (employee.type === 'salaried') {
    if (employee.dailyRate) {
      total = DAY_KEYS.filter(k => entry.days[k] === true).length * employee.dailyRate
    }
  } else if (employee.type === 'piece') {
    for (const key of DAY_KEYS) {
      const dayVal = entry.days[key]
      if (Array.isArray(dayVal)) {
        for (const p of dayVal as PieceEntry[]) {
          if (employee.subtype === 'bundler') {
            const bundleRate = p.type === 'Bundle (Sat)'
              ? (bonusRates?.bundleSat || 30)
              : (bonusRates?.bundle || 25)
            total += (p.qty || 0) * bundleRate
          } else if (employee.subtype === 'repairman' || employee.subtype === 'repairman-blue') {
            const repairRate = p.type === 'CHEP' ? 14 : 10
            total += (p.qty || 0) * repairRate
          } else {
            total += (p.qty || 0) * 20 * (pieceRates[p.type] || 0)
          }
        }
      }
    }
  } else if (employee.type === 'driver') {
    if (entry.hrsWorked != null && employee.hourlyRate) {
      total = (entry.hrsWorked || 0) * employee.hourlyRate
    }
  }

  // Add custom dollar amounts from any day
  for (const key of DAY_KEYS) {
    const dayVal = entry.days[key]
    if (dayVal && typeof dayVal === 'object' && !Array.isArray(dayVal) && 'custom' in dayVal) {
      total += (dayVal as CustomEntry).custom || 0
    }
  }

  // Deductions decrease total, debits increase total
  total -= (entry.deductions || 0)
  total += (entry.debit || 0)

  return Math.round(total * 100) / 100
}

export function calculateCash(total: number, employee: Employee, entry: WeekEntry): number {
  let cash = total - (employee.weeklyRate || 0)
  return Math.max(0, Math.round(cash * 100) / 100)
}

// Only hrsPayroll carries forward — hrsWorked, deductions, debit change week to week
const DEFAULT_FIELDS: (keyof EmployeeDefaults)[] = ['hrsPayroll']

function createEmptyEntry(employee: Employee, defaults?: EmployeeDefaults): WeekEntry {
  const days: Record<string, any> = {}
  for (const k of DAY_KEYS) {
    if (employee.type === 'salaried') days[k] = false
    else if (employee.type === 'piece') days[k] = []
    else days[k] = null
  }
  return {
    days: days as WeekEntry['days'],
    hrsPayroll: defaults?.hrsPayroll ?? (employee.type === 'driver' ? 0 : undefined),
    hrsWorked: employee.type === 'driver' ? null : undefined,
    deductions: 0,
    debit: 0,
    total: 0,
    totalOverride: null,
    notes: '',
  }
}

const API_BASE = 'http://localhost:5050'

export function useProduction() {
  const [data, setData] = useState<ProductionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentWeekKey, setCurrentWeekKey] = useState(() => getThursdayStart())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedRef = useRef(false)

  const loadData = useCallback(async () => {
    if (loadedRef.current) return
    loadedRef.current = true
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/production`)
      const result = await res.json() as ProductionData
      // Recalculate all totals on load to ensure consistency
      const empDefaults = result.employeeDefaults || {}
      for (const weekKey of Object.keys(result.weeks)) {
        const week = result.weeks[weekKey]
        // Fill in any missing employees in every loaded week
        for (const emp of result.employees) {
          if (!week.entries[emp.id]) {
            const defs = empDefaults[emp.id]
            const entry = createEmptyEntry(emp, defs)
            entry.total = calculateTotal(emp, entry, result.pieceRates, result.bonusRates)
            week.entries[emp.id] = entry
          }
        }
        for (const empId of Object.keys(week.entries)) {
          const emp = result.employees.find(e => e.id === empId)
          const entry = week.entries[empId]
          if (emp && entry.totalOverride === null) {
            entry.total = calculateTotal(emp, entry, result.pieceRates, result.bonusRates)
          }
        }
      }
      setData(result)
    } catch {
      console.error('Failed to load production data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const debouncedSave = useCallback((newData: ProductionData, weekKey?: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const payload: any = { ...newData }
      // Tell the server which week changed so it only syncs that one to Notion
      if (weekKey) payload.changedWeek = weekKey
      fetch(`${API_BASE}/api/production`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(console.error)
    }, 500)
  }, [])

  const updateData = useCallback((updater: (prev: ProductionData) => ProductionData, weekKey?: string) => {
    setData(prev => {
      if (!prev) return prev
      const next = updater(prev)
      debouncedSave(next, weekKey)
      return next
    })
  }, [debouncedSave])

  const ensureWeek = useCallback((weekKey: string, prodData: ProductionData): ProductionData => {
    const existingWeek = prodData.weeks[weekKey]
    const dates = existingWeek?.dates?.length ? existingWeek.dates : getWeekDates(weekKey)
    const empDefaults = prodData.employeeDefaults || {}
    // Merge existing entries (from Notion) with defaults for missing employees
    const existingEntries = existingWeek?.entries || {}
    const entries: Record<string, WeekEntry> = { ...existingEntries }
    let changed = !existingWeek
    for (const emp of prodData.employees) {
      if (!entries[emp.id]) {
        const defs = empDefaults[emp.id]
        const entry = createEmptyEntry(emp, defs)
        entry.total = calculateTotal(emp, entry, prodData.pieceRates, prodData.bonusRates)
        entries[emp.id] = entry
        changed = true
      }
    }
    if (!changed) return prodData
    const newWeeks = {
      ...prodData.weeks,
      [weekKey]: { label: getWeekLabel(weekKey), dates, entries },
    }
    // Prune old weeks, but never prune the week we just created
    const keys = Object.keys(newWeeks).sort().filter(k => k !== weekKey)
    while (keys.length >= MAX_WEEKS) {
      const oldest = keys.shift()!
      delete newWeeks[oldest]
    }
    return { ...prodData, weeks: newWeeks }
  }, [])

  const navigateWeek = useCallback((direction: -1 | 1) => {
    setCurrentWeekKey(prev => {
      const d = new Date(prev + 'T12:00:00')
      d.setDate(d.getDate() + direction * 7)
      const newKey = getThursdayStart(d)
      // Don't allow navigating past next week from today
      if (direction === 1) {
        const currentThursday = getThursdayStart()
        const nextThursday = new Date(currentThursday + 'T12:00:00')
        nextThursday.setDate(nextThursday.getDate() + 7)
        const maxKey = toLocalDateStr(nextThursday)
        if (newKey > maxKey) return prev
      }
      if (data) {
        const withWeek = ensureWeek(newKey, data)
        if (withWeek !== data) {
          setData(withWeek)
          debouncedSave(withWeek, newKey)
        }
      }
      return newKey
    })
  }, [data, ensureWeek, debouncedSave])

  const updateCell = useCallback((
    employeeId: string, day: DayKey, value: boolean | PieceEntry[] | TimeEntry | CustomEntry | null
  ) => {
    updateData(prev => {
      const withWeek = ensureWeek(currentWeekKey, prev)
      const week = { ...withWeek.weeks[currentWeekKey] }
      const entry = { ...week.entries[employeeId] }
      entry.days = { ...entry.days, [day]: value }
      // Recalculate total
      const emp = prev.employees.find(e => e.id === employeeId)
      if (emp) entry.total = calculateTotal(emp, entry, prev.pieceRates, prev.bonusRates)
      week.entries = { ...week.entries, [employeeId]: entry }
      return { ...withWeek, weeks: { ...withWeek.weeks, [currentWeekKey]: week } }
    }, currentWeekKey)
  }, [currentWeekKey, ensureWeek, updateData])

  const updateEntryField = useCallback((
    employeeId: string, field: keyof WeekEntry, value: any
  ) => {
    updateData(prev => {
      const withWeek = ensureWeek(currentWeekKey, prev)
      const week = { ...withWeek.weeks[currentWeekKey] }
      const entry = { ...week.entries[employeeId], [field]: value }
      const emp = prev.employees.find(e => e.id === employeeId)
      if (emp && field !== 'totalOverride') {
        entry.total = calculateTotal(emp, entry, prev.pieceRates, prev.bonusRates)
      }
      week.entries = { ...week.entries, [employeeId]: entry }
      let result = { ...withWeek, weeks: { ...withWeek.weeks, [currentWeekKey]: week } }

      // Auto-save as default for future weeks when these fields change
      if (DEFAULT_FIELDS.includes(field as keyof EmployeeDefaults)) {
        const empDefaults = { ...(result.employeeDefaults || {}) }
        empDefaults[employeeId] = { ...(empDefaults[employeeId] || {}), [field]: value }
        result = { ...result, employeeDefaults: empDefaults }
      }

      return result
    }, currentWeekKey)
  }, [currentWeekKey, ensureWeek, updateData])

  const addEmployee = useCallback((employee: Employee) => {
    updateData(prev => {
      const employees = [...prev.employees, employee]
      const weeks = { ...prev.weeks }
      for (const key of Object.keys(weeks)) {
        const week = { ...weeks[key] }
        week.entries = { ...week.entries, [employee.id]: createEmptyEntry(employee) }
        weeks[key] = week
      }
      return { ...prev, employees, weeks }
    })
  }, [updateData])

  const updateEmployee = useCallback((employeeId: string, updates: Partial<Employee>) => {
    updateData(prev => ({
      ...prev,
      employees: prev.employees.map(e => e.id === employeeId ? { ...e, ...updates } : e),
    }))
  }, [updateData])

  const reorderEmployees = useCallback((newOrder: Employee[]) => {
    updateData(prev => ({ ...prev, employees: newOrder }))
  }, [updateData])

  const removeEmployee = useCallback((employeeId: string) => {
    updateData(prev => {
      const employees = prev.employees.filter(e => e.id !== employeeId)
      const weeks = { ...prev.weeks }
      for (const key of Object.keys(weeks)) {
        const week = { ...weeks[key] }
        const entries = { ...week.entries }
        delete entries[employeeId]
        week.entries = entries
        weeks[key] = week
      }
      // Clean up defaults too
      const empDefaults = { ...(prev.employeeDefaults || {}) }
      delete empDefaults[employeeId]
      return { ...prev, employees, weeks, employeeDefaults: empDefaults }
    })
  }, [updateData])

  const getCurrentWeek = useCallback((): WeekData | null => {
    if (!data) return null
    const withWeek = ensureWeek(currentWeekKey, data)
    if (withWeek !== data) {
      setData(withWeek)
      debouncedSave(withWeek, currentWeekKey)
    }
    return withWeek.weeks[currentWeekKey] || null
  }, [data, currentWeekKey, ensureWeek, debouncedSave])

  // Compute whether forward navigation is allowed
  const canNavigateForward = (() => {
    const d = new Date(currentWeekKey + 'T12:00:00')
    d.setDate(d.getDate() + 7)
    const nextKey = getThursdayStart(d)
    const currentThursday = getThursdayStart()
    const maxDate = new Date(currentThursday + 'T12:00:00')
    maxDate.setDate(maxDate.getDate() + 7)
    const maxKey = toLocalDateStr(maxDate)
    return nextKey <= maxKey
  })()

  return {
    data,
    loading,
    currentWeekKey,
    getCurrentWeek,
    navigateWeek,
    canNavigateForward,
    updateCell,
    updateEntryField,
    addEmployee,
    removeEmployee,
    updateEmployee,
    reorderEmployees,
    updateData,
    getWeekLabel: () => data?.weeks[currentWeekKey]?.label || getWeekLabel(currentWeekKey),
  }
}
