import { ReactNode } from 'react'

interface LiquidGlassButtonProps {
  children: ReactNode
  active?: boolean
  onClick?: () => void
  className?: string
  title?: string
}

// macOS Tahoe liquid glass toolbar button — pure CSS implementation
// Based on Apple's macOS 26 UI Kit Figma specs:
// - Pill shape (rounded-full)
// - Glass fill: #333 mix-blend-color-dodge + rgb(247,247,247) overlay
// - Glass effect: rgba(0,0,0,0.2) mix-blend-screen
// - Shadow: 0 8px 40px rgba(0,0,0,0.12)
export default function LiquidGlassButton({ children, active = false, onClick, className = '', title }: LiquidGlassButtonProps) {
  return (
    <button
      className={`tahoe-toolbar-btn ${active ? 'active' : ''} ${className}`}
      onClick={onClick}
      title={title}
    >
      <span className="tahoe-btn-label">{children}</span>
    </button>
  )
}
