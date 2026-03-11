import { useEffect, useState } from 'react'
import LiquidGlassButton from './LiquidGlassButton'
import logoSrc from '../assets/logo.png'

interface HeaderProps {
  onToggleTheme: () => void
  onToggleCustomers: () => void
  onToggleSchedule: () => void
  onToggleReceipt: () => void
  onToggleProduction: () => void
  activePanel: string | null
}

export default function Header({ onToggleTheme, onToggleCustomers, onToggleSchedule, onToggleReceipt, onToggleProduction, activePanel }: HeaderProps) {
  const [dateLabel, setDateLabel] = useState('')

  useEffect(() => {
    const update = () => {
      const now = new Date()
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      const day = days[now.getDay()]
      const month = String(now.getMonth() + 1).padStart(2, '0')
      const date = String(now.getDate()).padStart(2, '0')
      const year = now.getFullYear()
      setDateLabel(`${day}. ${month}.${date}.${year}`)
    }
    update()
    const interval = setInterval(update, 60000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="tahoe-titlebar">
      {/* Traffic light spacer — Electron renders the actual buttons */}
      <div className="titlebar-traffic-spacer" />

      {/* Single row: logo left, date + buttons right */}
      <div className="titlebar-top-row">
        <div className="titlebar-leading">
          <img src={logoSrc} alt="Just Nation" className="brand-logo" />
        </div>
        <div className="titlebar-right">
          <span className="titlebar-date">{dateLabel}</span>
          <div className="titlebar-buttons">
            <LiquidGlassButton
              onClick={onToggleCustomers}
              active={activePanel === 'customers'}
              title="Cmd+J"
            >
              Customers
            </LiquidGlassButton>
            <LiquidGlassButton
              onClick={onToggleReceipt}
              active={activePanel === 'receipt'}
              title="Cmd+D"
            >
              Receipt
            </LiquidGlassButton>
            <LiquidGlassButton
              onClick={onToggleProduction}
              active={activePanel === 'production'}
              title="Production"
            >
              Production
            </LiquidGlassButton>
            <div style={{ width: '12px' }} />
            <button
              className="tahoe-toolbar-btn tahoe-theme-toggle"
              onClick={onToggleTheme}
              title="Press T"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21.75 12.79A9.01 9.01 0 0 1 11.21 2.25a9 9 0 1 0 10.54 10.54Z" fill="currentColor" opacity="0.85"/>
                <path d="M21.75 12.79A9.01 9.01 0 0 1 11.21 2.25a9 9 0 1 0 10.54 10.54Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.4"/>
                <circle cx="15" cy="5.5" r="0.75" fill="currentColor" opacity="0.5"/>
                <circle cx="18.5" cy="8" r="0.5" fill="currentColor" opacity="0.35"/>
                <circle cx="17" cy="3.5" r="0.4" fill="currentColor" opacity="0.25"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
