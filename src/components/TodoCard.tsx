import { useState, useEffect, useRef } from 'react'

// ── Types ──────────────────────────────────────────────────
export interface TodoItem {
  id: string
  title: string
  completed: boolean
  completedAt?: number
  createdAt: number
  order: number
}

// ── localStorage key ───────────────────────────────────────
const STORAGE_KEY = 'jn-todo-items'

function loadTodos(): TodoItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const items: TodoItem[] = JSON.parse(raw)
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    return items.filter(item => {
      if (item.completed && item.completedAt) {
        return item.completedAt >= todayStart.getTime()
      }
      return true
    })
  } catch { return [] }
}

function saveTodos(items: TodoItem[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)) } catch {}
}

// ── Pop sound via Web Audio API ────────────────────────────
function playPopSound() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1200, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.15)
    setTimeout(() => ctx.close(), 200)
  } catch {}
}

// ── Component ──────────────────────────────────────────────
export default function TodoCard() {
  const [todos, setTodos] = useState<TodoItem[]>(loadTodos)
  const [newTitle, setNewTitle] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { saveTodos(todos) }, [todos])

  useEffect(() => {
    if (showAddForm) setTimeout(() => inputRef.current?.focus(), 50)
  }, [showAddForm])

  useEffect(() => {
    if (editingId) setTimeout(() => editInputRef.current?.focus(), 50)
  }, [editingId])

  // ── Actions ────────────────────────────────────────────
  const addTodo = () => {
    const title = newTitle.trim()
    if (!title) return
    const item: TodoItem = {
      id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      completed: false,
      createdAt: Date.now(),
      order: todos.filter(t => !t.completed).length,
    }
    setTodos(prev => [item, ...prev])
    setNewTitle('')
    setShowAddForm(false)
  }

  const toggleComplete = (id: string) => {
    setTodos(prev => prev.map(t => {
      if (t.id !== id) return t
      const nowComplete = !t.completed
      if (nowComplete) playPopSound()
      return {
        ...t,
        completed: nowComplete,
        completedAt: nowComplete ? Date.now() : undefined,
      }
    }))
  }

  const startEdit = (item: TodoItem) => {
    setEditingId(item.id)
    setEditTitle(item.title)
  }

  const saveEdit = () => {
    if (!editingId) return
    const title = editTitle.trim()
    if (!title) return
    setTodos(prev => prev.map(t =>
      t.id === editingId ? { ...t, title } : t
    ))
    setEditingId(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const deleteTodo = (id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id))
  }

  // ── Drag and drop ─────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    const el = e.currentTarget as HTMLElement
    el.style.opacity = '0.4'
  }

  const handleDragEnd = (e: React.DragEvent) => {
    (e.currentTarget as HTMLElement).style.opacity = '1'
    setDragId(null)
    setDragOverId(null)
  }

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id !== dragOverId) setDragOverId(id)
  }

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!dragId || dragId === targetId) return
    setTodos(prev => {
      const items = [...prev]
      const dragIdx = items.findIndex(t => t.id === dragId)
      const targetIdx = items.findIndex(t => t.id === targetId)
      if (dragIdx < 0 || targetIdx < 0) return prev
      const [moved] = items.splice(dragIdx, 1)
      items.splice(targetIdx, 0, moved)
      return items.map((item, i) => ({ ...item, order: i }))
    })
    setDragId(null)
    setDragOverId(null)
  }

  // ── Render ─────────────────────────────────────────────
  const activeTodos = todos.filter(t => !t.completed)
  const completedTodos = todos.filter(t => t.completed)

  return (
    <div className="section todo-card">
      <div className="todo-header">
        <div className="section-header" style={{ marginBottom: 0 }}>To-Do</div>
        <button
          className="todo-add-btn"
          onClick={() => setShowAddForm(!showAddForm)}
          title="Add task"
        >
          {showAddForm ? '×' : '+'}
        </button>
      </div>

      {/* ── Add form ── */}
      {showAddForm && (
        <div className="todo-add-form">
          <div className="todo-form-row">
            <input
              ref={inputRef}
              className="todo-input"
              type="text"
              placeholder="What needs to be done?"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') addTodo()
                if (e.key === 'Escape') setShowAddForm(false)
              }}
            />
            <button
              className="todo-submit-btn"
              onClick={addTodo}
              disabled={!newTitle.trim()}
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* ── Task list ── */}
      <div className="todo-list">
        {activeTodos.length === 0 && completedTodos.length === 0 && (
          <div className="empty-state" style={{ padding: '24px 16px' }}>
            <div className="empty-state-text">No tasks yet</div>
          </div>
        )}

        {activeTodos.map(item => (
          editingId === item.id ? (
            <div key={item.id} className="todo-item editing">
              <textarea
                ref={editInputRef as any}
                className="todo-edit-textarea"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
                  if (e.key === 'Escape') cancelEdit()
                }}
                rows={Math.max(2, Math.ceil(editTitle.length / 35))}
              />
              <div className="todo-edit-actions">
                <button className="todo-save-btn" onClick={saveEdit}>Save</button>
                <button className="todo-cancel-btn" onClick={cancelEdit}>Cancel</button>
              </div>
            </div>
          ) : (
            <div
              key={item.id}
              className={`todo-item${dragOverId === item.id ? ' drag-over' : ''}`}
              draggable
              onDragStart={e => handleDragStart(e, item.id)}
              onDragEnd={handleDragEnd}
              onDragOver={e => handleDragOver(e, item.id)}
              onDrop={e => handleDrop(e, item.id)}
            >
              <div className="todo-item-left">
                <button
                  className="todo-checkbox"
                  onClick={() => toggleComplete(item.id)}
                >
                  <span className="todo-check-icon" />
                </button>
                <div className="todo-item-content" onClick={() => startEdit(item)}>
                  <span className="todo-title"><strong>{item.title}</strong></span>
                </div>
              </div>
              <button className="todo-delete-btn" onClick={() => deleteTodo(item.id)} title="Delete">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          )
        ))}

        {completedTodos.map(item => (
          <div key={item.id} className="todo-item completed">
            <div className="todo-item-left">
              <button
                className="todo-checkbox checked"
                onClick={() => toggleComplete(item.id)}
              >
                <svg className="todo-checkmark" width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 6.5L5 9L9.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <div className="todo-item-content">
                <span className="todo-title"><strong>{item.title}</strong></span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
