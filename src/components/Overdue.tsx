import { OverdueItem } from '../types/briefing'

interface Props {
  items: OverdueItem[]
  onTopicClick: (topicId: string) => void
}

export default function Overdue({ items, onTopicClick }: Props) {
  if (!items || items.length === 0) {
    return (
      <div className="section">
        <div className="section-header">Overdue</div>
        <div className="empty-state">
          <div className="empty-state-icon">—</div>
          <div className="empty-state-text">No overdue items</div>
        </div>
      </div>
    )
  }

  return (
    <div className="section">
      <div className="section-header">Overdue</div>
      {items.map((o, i) => (
        <div
          key={i}
          className="contact-card clickable"
          onClick={() => onTopicClick(o.topicId)}
        >
          <div>
            <div className="contact-name">{o.contact}</div>
            <div className="contact-subject">{o.opportunity}</div>
          </div>
          <div className="days-counter overdue">{o.lastContact}</div>
        </div>
      ))}
    </div>
  )
}
