export type DayKey = 'thu' | 'fri' | 'sat' | 'mon' | 'tue' | 'wed'

export const DAY_KEYS: DayKey[] = ['thu', 'fri', 'sat', 'mon', 'tue', 'wed']
export const DAY_LABELS: Record<DayKey, string> = {
  thu: 'Thu', fri: 'Fri', sat: 'Sat', mon: 'Mon', tue: 'Tue', wed: 'Wed',
}

export type EmployeeType = 'salaried' | 'piece' | 'driver'

export interface Employee {
  id: string
  name: string
  type: EmployeeType
  subtype?: 'builder' | 'bundler' | 'repairman' | 'repairman-blue'
  payInfo: string | null
  weeklyRate?: number
  dailyRate?: number
  hourlyRate?: number
}

export interface PieceEntry {
  type: string
  qty: number
}

export interface TimeEntry {
  in: string
  out: string
}

export interface WeekEntry {
  days: Record<DayKey, boolean | PieceEntry[] | TimeEntry | null>
  hrsPayroll?: number
  hrsWorked?: number | null
  deductions: number
  debit: number
  total: number
  totalOverride: number | null
  notes: string
}

export interface WeekData {
  label: string
  dates: string[]
  entries: Record<string, WeekEntry>
}

export interface EmployeeDefaults {
  hrsPayroll?: number | null
}

export interface ProductionData {
  employees: Employee[]
  pieceRates: Record<string, number>
  bonusRates: {
    bundle: number
    bundleSat: number
    stackRepaired: number
    blueStackRepaired: number
    driverHourly: number
  }
  weeks: Record<string, WeekData>
  employeeDefaults?: Record<string, EmployeeDefaults>
}
