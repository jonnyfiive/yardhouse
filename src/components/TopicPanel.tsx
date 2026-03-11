import { Topic } from '../types/briefing'
import { useState } from 'react'

interface Props {
  topic: Topic | null
  isOpen: boolean
  onClose: () => void
}

export default function TopicPanel({ topic, isOpen, onClose }: Props) {
  const [openDrafts, setOpenDrafts] = useState<Set<string>>(new Set())

  if (!topic) return null

  const toggleDraft = (actionId: string) => {
    setOpenDrafts(prev => {
      const next = new Set(prev)
      if (next.has(actionId)) next.delete(actionId)
      else next.add(actionId)
      return next
    })
  }

  const copyDraft = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const mailToDraft = (email: string, subject: string, body: string) => {
    const link = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    window.location.href = link
  }

  return (
    <div className={`topic-panel ${isOpen ? 'open' : ''}`}>
      <div className="topic-header">
        <div>
          <div className="topic-label">{topic.label}</div>
          <div className="topic-title">{topic.title}</div>
        </div>
        <button className="topic-close-btn" onClick={onClose}>&times;</button>
      </div>

      {topic.pills && topic.pills.length > 0 && (
        <div className="topic-pills">
          {topic.pills.map((p, i) => (
            <div key={i} className={`pill ${p.cls || 'pill-default'}`}>{p.text}</div>
          ))}
        </div>
      )}

      <div className="topic-messages">
        {topic.messages?.map((m, i) => (
          <div key={i} className="topic-message" dangerouslySetInnerHTML={{ __html: m.text }} />
        ))}
      </div>

      <div className="topic-actions">
        {topic.actions?.map((action) => (
          <div key={action.id}>
            <button
              className="action-btn"
              onClick={() => toggleDraft(action.id)}
            >
              {action.icon} {action.text}
            </button>
            {topic.drafts?.[action.id] && openDrafts.has(action.id) && (
              <div className="draft-email open">
                <div className="draft-email-to">TO: {topic.drafts[action.id].to}</div>
                <div className="draft-email-text">{topic.drafts[action.id].text}</div>
                <div className="draft-actions">
                  <button className="draft-btn" onClick={() => copyDraft(topic.drafts[action.id].text)}>COPY</button>
                  <button
                    className="draft-btn"
                    onClick={() => mailToDraft(
                      topic.drafts[action.id].to,
                      topic.drafts[action.id].label,
                      topic.drafts[action.id].text
                    )}
                  >
                    SEND
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
