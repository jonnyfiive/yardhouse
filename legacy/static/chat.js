// ═══════════════════════════════════════
// JUST NATION — Chat Interface
// Connects to Flask backend → Anthropic API
// ═══════════════════════════════════════

(function() {
  'use strict';

  // ── Config ──
  const API_BASE = window.location.protocol === 'file:'
    ? 'http://localhost:5050'
    : '';

  // ── State ──
  let chatHistory = [];
  let isStreaming = false;
  let currentStreamEl = null;
  let chatOpen = false;

  // ── DOM refs (set after init) ──
  let chatPanel, chatMessages, chatInput, chatSendBtn, chatFab;
  let app;

  // ═══ INIT ═══
  function initChat() {
    chatPanel = document.getElementById('chatPanelAI');
    chatMessages = document.getElementById('chatMessagesAI');
    chatInput = document.getElementById('chatInput');
    chatSendBtn = document.getElementById('chatSend');
    chatFab = document.getElementById('chatFab');
    app = document.getElementById('app');

    if (!chatPanel || !chatInput) return;

    // Events
    chatSendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Auto-resize textarea
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    });

    // Cmd+K / Ctrl+K toggle
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleChat();
      }
    });

    // Welcome message
    if (chatMessages.children.length === 0) {
      addAssistantMessage("Morning. What do you need?");
    }
  }

  // ═══ TOGGLE CHAT ═══
  window.toggleChat = function() {
    if (chatOpen) {
      closeChat();
    } else {
      openChat();
    }
  };

  function openChat() {
    // Close any existing action panel first
    if (typeof closePanel === 'function') closePanel();

    chatPanel.classList.add('open');
    chatOpen = true;
    if (chatFab) chatFab.classList.add('active');

    // Focus input
    setTimeout(() => chatInput.focus(), 300);
  }

  function closeChat() {
    chatPanel.classList.remove('open');
    chatOpen = false;
    if (chatFab) chatFab.classList.remove('active');
  }

  // Override Escape to close chat too
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && chatOpen) {
      closeChat();
    }
  });

  // ═══ CLICK OUTSIDE TO CLOSE ═══
  document.addEventListener('mousedown', (e) => {
    // Close chat if clicking outside
    if (chatOpen) {
      const panel = document.getElementById('chatPanelAI');
      const fab = document.getElementById('chatFab');
      if (panel && fab && !panel.contains(e.target) && !fab.contains(e.target)) {
        closeChat();
      }
    }
    // Close customers if clicking outside
    if (typeof custOpen !== 'undefined' && custOpen) {
      const custPanel = document.getElementById('custPanel');
      const statCust = document.querySelector('.stat-bubble-cust');
      if (custPanel && !custPanel.contains(e.target) && (!statCust || !statCust.contains(e.target))) {
        toggleCustomers();
      }
    }
  });

  // ═══ SEND MESSAGE ═══
  function sendMessage() {
    const text = chatInput.value.trim();
    if (!text || isStreaming) return;

    // Add user message to UI
    addUserMessage(text);

    // Add to history
    chatHistory.push({ role: 'user', content: text });

    // Clear input
    chatInput.value = '';
    chatInput.style.height = 'auto';

    // Stream response
    streamResponse();
  }

  // ═══ STREAM RESPONSE ═══
  async function streamResponse() {
    isStreaming = true;
    chatSendBtn.classList.add('streaming');
    chatInput.disabled = true;

    // Create assistant message placeholder
    const msgEl = createMessageEl('assistant');
    const contentEl = msgEl.querySelector('.chat-msg-content');
    currentStreamEl = contentEl;
    chatMessages.appendChild(msgEl);
    scrollToBottom();

    // Show typing indicator
    contentEl.innerHTML = '<span class="typing-indicator"><span></span><span></span><span></span></span>';

    try {
      const response = await fetch(API_BASE + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatHistory })
      });

      if (!response.ok) {
        const err = await response.json();
        contentEl.textContent = `Error: ${err.error || 'Connection failed'}`;
        isStreaming = false;
        chatSendBtn.classList.remove('streaming');
        chatInput.disabled = false;
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let firstTextReceived = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'text_start') {
              if (!firstTextReceived) {
                contentEl.innerHTML = '';
                firstTextReceived = true;
              }
            }

            else if (event.type === 'text_delta') {
              if (!firstTextReceived) {
                contentEl.innerHTML = '';
                firstTextReceived = true;
              }
              fullText += event.text;
              contentEl.innerHTML = renderMarkdown(fullText);
              scrollToBottom();
            }

            else if (event.type === 'tool_start') {
              // Show tool indicator
              const pill = document.createElement('div');
              pill.className = 'chat-tool-pill';
              pill.innerHTML = `<span class="tool-spinner"></span> ${toolLabel(event.tool_name)}`;
              pill.id = 'tool-' + event.tool_id;
              chatMessages.appendChild(pill);
              scrollToBottom();
            }

            else if (event.type === 'tool_result') {
              // Update tool pill to show completion
              const pills = chatMessages.querySelectorAll('.chat-tool-pill');
              if (pills.length) {
                const lastPill = pills[pills.length - 1];
                lastPill.innerHTML = `✓ ${toolLabel(event.tool_name)}`;
                lastPill.classList.add('done');
              }

              // If it's an email draft, render it specially
              try {
                const result = JSON.parse(event.result_preview);
                if (result.type === 'email_draft') {
                  renderEmailDraft(result);
                }
              } catch (e) {}

              // Reset for next text block
              fullText = '';
              firstTextReceived = false;
              const newMsg = createMessageEl('assistant');
              currentStreamEl = newMsg.querySelector('.chat-msg-content');
              contentEl = currentStreamEl;
              chatMessages.appendChild(newMsg);
            }

            else if (event.type === 'error') {
              contentEl.innerHTML = `<span style="color:var(--red)">${event.message}</span>`;
            }

            else if (event.type === 'done') {
              // Clean up empty trailing message
              if (currentStreamEl && !currentStreamEl.textContent.trim()) {
                currentStreamEl.closest('.chat-msg').remove();
              }
            }
          } catch (e) {
            // Skip malformed JSON
          }
        }
      }

      // Save assistant response to history
      if (fullText) {
        chatHistory.push({ role: 'assistant', content: fullText });
      }

      // Trim history to prevent token overflow (keep last 20 messages)
      if (chatHistory.length > 20) {
        chatHistory = chatHistory.slice(-20);
      }

    } catch (err) {
      contentEl.innerHTML = `<span style="color:var(--red)">Connection failed. Is the server running?</span>`;
    }

    isStreaming = false;
    chatSendBtn.classList.remove('streaming');
    chatInput.disabled = false;
    chatInput.focus();
  }

  // ═══ MESSAGE ELEMENTS ═══
  function addUserMessage(text) {
    const el = createMessageEl('user');
    el.querySelector('.chat-msg-content').textContent = text;
    chatMessages.appendChild(el);
    scrollToBottom();
  }

  function addAssistantMessage(text) {
    const el = createMessageEl('assistant');
    el.querySelector('.chat-msg-content').innerHTML = renderMarkdown(text);
    chatMessages.appendChild(el);
    scrollToBottom();
  }

  function createMessageEl(role) {
    const msg = document.createElement('div');
    msg.className = `chat-msg chat-msg-${role}`;
    msg.innerHTML = `
      <div class="chat-msg-bubble">
        ${role === 'assistant' ? '<div class="chat-msg-label">claude</div>' : ''}
        <div class="chat-msg-content"></div>
      </div>`;
    return msg;
  }

  // ═══ EMAIL DRAFT RENDERER ═══
  function renderEmailDraft(draft) {
    const el = document.createElement('div');
    el.className = 'chat-email-draft';
    el.innerHTML = `
      <div class="draft-header">
        <span class="draft-icon">✉</span>
        <span class="draft-title">Email Draft</span>
      </div>
      <div class="draft-to-line">
        <span class="draft-to-label">to</span> ${escHtml(draft.to)}
      </div>
      <div class="draft-subject-line">
        <span class="draft-to-label">re</span> ${escHtml(draft.subject)}
      </div>
      <textarea class="draft-textarea" spellcheck="true">${escHtml(draft.body)}</textarea>
      <div class="draft-actions">
        <button class="draft-btn draft-btn-copy" onclick="chatCopyDraft(this)">copy</button>
        <button class="draft-btn draft-btn-send" onclick="chatMailtoDraft(this)">open in mail</button>
      </div>`;
    chatMessages.appendChild(el);
    scrollToBottom();
  }

  window.chatCopyDraft = function(btn) {
    const textarea = btn.closest('.chat-email-draft').querySelector('.draft-textarea');
    navigator.clipboard.writeText(textarea.value).then(() => {
      btn.textContent = 'copied';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'copy'; btn.classList.remove('copied'); }, 2000);
    });
  };

  window.chatMailtoDraft = function(btn) {
    const draft = btn.closest('.chat-email-draft');
    const to = draft.querySelector('.draft-to-line').textContent.replace('to', '').trim();
    const subject = draft.querySelector('.draft-subject-line').textContent.replace('re', '').trim();
    const body = draft.querySelector('.draft-textarea').value;
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  // ═══ HELPERS ═══
  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  }

  function toolLabel(name) {
    const labels = {
      'get_crm_data': 'Looking up CRM...',
      'read_current_briefing': 'Reading briefing...',
      'read_tasks': 'Reading tasks...',
      'update_briefing': 'Updating briefing...',
      'update_tasks': 'Updating tasks...',
      'draft_email': 'Drafting email...',
      'search_crm': 'Searching CRM...',
      'update_customer_info': 'Updating records...',
    };
    return labels[name] || name;
  }

  function renderMarkdown(text) {
    // Simple markdown: bold, italic, code, links, line breaks
    let html = escHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank">$1</a>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function escHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ═══ BOOT ═══
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChat);
  } else {
    initChat();
  }

})();
