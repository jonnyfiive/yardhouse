import { NextMove } from '../types/briefing'

interface Props {
  items: NextMove[]
  onTopicClick: (topicId: string) => void
}

export default function NextMoves({ items, onTopicClick }: Props) {
  if (!items || items.length === 0) {
    return (
      <div className="section">
        <div className="section-header">Next Moves</div>
        <div className="empty-state">
          <div className="empty-state-text">No next moves</div>
        </div>
      </div>
    )
  }

  return (
    <div className="section">
      <div className="section-header">Next Moves</div>
      <ul className="action-list">
        {items.map((item, i) => (
          <li
            key={i}
            className="action-item"
            onClick={() => onTopicClick(item.topicId)}
            dangerouslySetInnerHTML={{ __html: item.text }}
          />
        ))}
      </ul>
    </div>
  )
}
