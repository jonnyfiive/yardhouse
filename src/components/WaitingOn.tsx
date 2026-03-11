import { WaitingItem } from '../types/briefing'

interface Props {
  items: WaitingItem[]
  onTopicClick: (topicId: string) => void
}

export default function WaitingOn({ items, onTopicClick }: Props) {
  if (!items || items.length === 0) {
    return (
      <div className="section">
        <div className="section-header">Waiting On</div>
        <div className="empty-state">
          <div className="empty-state-icon">—</div>
          <div className="empty-state-text">No pending items</div>
        </div>
      </div>
    )
  }

  return (
    <div className="section">
      <div className="section-header">Waiting On</div>
      {items.map((w, i) => (
        <div
          key={i}
          className="contact-card clickable"
          onClick={() => onTopicClick(w.topicId)}
        >
          <div>
            <div className="contact-name">{w.contact}</div>
            <div className="contact-subject">{w.subject}</div>
          </div>
          <div className="days-counter">{w.days}d</div>
        </div>
      ))}
    </div>
  )
}
