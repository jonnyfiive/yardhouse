import { useState, useRef, useEffect } from 'react'
import { useApi } from '../hooks/useApi'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export default function ChatPanel() {
  const { sendChat } = useApi()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const recognitionRef = useRef<any>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: ChatMessage = { role: 'user', content: text }
    const updated = [...messages, userMsg]
    setMessages(updated)
    setInput('')
    setLoading(true)

    try {
      const result = await sendChat(updated)
      if (result.reply) {
        setMessages(prev => [...prev, { role: 'assistant', content: result.reply }])
      } else if (result.error) {
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${result.error}` }])
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Failed to connect to AI. Is the server running?' }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const clearChat = () => {
    setMessages([])
  }

  const toggleVoice = () => {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognitionRef.current = recognition

    recognition.onstart = () => setListening(true)

    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      setInput(prev => {
        const base = prev.replace(/[\s]*$/, '')
        return base ? `${base} ${transcript}` : transcript
      })
    }

    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)

    recognition.start()
  }

  return (
    <>
      {/* Floating Action Button */}
      <button
        className={`chat-fab ${isOpen ? 'chat-fab-active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="AI Assistant"
      >
        <div className="chat-fab-dots" />
        <svg className="chat-fab-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="6" width="18" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <rect x="3" y="11" width="18" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <rect x="3" y="16" width="18" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
          <line x1="7" y1="6" x2="7" y2="19" stroke="currentColor" strokeWidth="1.5" />
          <line x1="12" y1="6" x2="12" y2="19" stroke="currentColor" strokeWidth="1.5" />
          <line x1="17" y1="6" x2="17" y2="19" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className="chat-panel">
          <div className="chat-header">
            <span className="chat-title">Claude</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="chat-clear-btn" onClick={clearChat} title="Clear chat">Clear</button>
              <button className="chat-close-btn" onClick={() => setIsOpen(false)}>&times;</button>
            </div>
          </div>

          <div className="chat-messages">
            {messages.length === 0 && (
              <div className="chat-empty">
                <div className="chat-empty-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="6" width="18" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                    <rect x="3" y="11" width="18" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                    <rect x="3" y="16" width="18" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
                    <line x1="7" y1="6" x2="7" y2="19" stroke="currentColor" strokeWidth="1.2" />
                    <line x1="12" y1="6" x2="12" y2="19" stroke="currentColor" strokeWidth="1.2" />
                    <line x1="17" y1="6" x2="17" y2="19" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                </div>
                <div className="chat-empty-text">Ask me anything about customers, pricing, or draft an email.</div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`chat-msg chat-msg-${msg.role}`}>
                <div className="chat-msg-bubble">{msg.content}</div>
              </div>
            ))}
            {loading && (
              <div className="chat-msg chat-msg-assistant">
                <div className="chat-msg-bubble chat-typing">Thinking...</div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="chat-input-area">
            <textarea
              ref={inputRef}
              className="chat-input"
              placeholder=""
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <button
              className={`chat-voice-btn ${listening ? 'chat-voice-active' : ''}`}
              onClick={toggleVoice}
              title={listening ? 'Stop listening' : 'Voice input'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <rect x="9" y="2" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="2" />
                <path d="M5 11a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <button
              className="chat-send-btn"
              onClick={handleSend}
              disabled={loading || !input.trim()}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  )
}
