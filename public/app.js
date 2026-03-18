// Mirror-AI — Mobile Client
(function () {
  "use strict";

  // --- State ---
  let ws = null;
  let connected = false;
  let busy = false;
  let reconnectDelay = 1000;
  let currentAssistantEl = null;
  let currentAssistantText = "";

  // --- DOM refs ---
  const messagesEl = document.getElementById("messages");
  const inputEl = document.getElementById("input");
  const sendBtn = document.getElementById("send-btn");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const emptyState = document.getElementById("empty-state");

  // --- Auth ---
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (!token) {
    document.body.innerHTML =
      '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:#f85149;padding:40px;text-align:center;font-size:18px;">Missing auth token. Scan the QR code again.</div>';
    return;
  }

  // Clean URL (remove token from address bar for privacy)
  window.history.replaceState({}, "", window.location.pathname);

  // --- WebSocket ---
  function connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}?token=${token}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      connected = true;
      reconnectDelay = 1000;
      setStatus("connected", "Connected");
    };

    ws.onclose = () => {
      connected = false;
      setStatus("error", "Disconnected");
      setTimeout(() => {
        reconnectDelay = Math.min(reconnectDelay * 2, 16000);
        connect();
      }, reconnectDelay);
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) {
        console.error("Bad message:", e);
      }
    };
  }

  // --- Message handling ---
  function handleMessage(msg) {
    switch (msg.type) {
      case "init":
        // Load history
        messagesEl.innerHTML = "";
        if (msg.history && msg.history.length > 0) {
          hideEmpty();
          msg.history.forEach((m) => {
            if (m.role === "user") addUserMessage(m.content, m.timestamp);
            else if (m.role === "assistant" && m.content)
              addAssistantMessage(m.content, m.timestamp);
          });
        }
        if (msg.status === "busy") {
          setBusy(true);
        }
        break;

      case "chat":
        hideEmpty();
        if (msg.message.role === "user") {
          addUserMessage(msg.message.content, msg.message.timestamp);
        }
        break;

      case "claude":
        hideEmpty();
        handleClaudeMessage(msg.data);
        break;

      case "status":
        if (msg.status === "busy") {
          setBusy(true);
        } else if (msg.status === "ready") {
          setBusy(false);
        } else if (msg.status === "error") {
          setStatus("error", "Error");
        }
        break;

      case "done":
        finalizeAssistant();
        setBusy(false);
        break;

      case "error":
        addSystemMessage("Error: " + msg.message);
        setBusy(false);
        break;

      case "log":
        // Debug logs — ignore in UI
        break;
    }
  }

  function handleClaudeMessage(data) {
    if (!data) return;

    // Text content from assistant
    if (data.type === "assistant" && data.subtype === "text" && data.content) {
      appendToAssistant(data.content);
      return;
    }

    // Content block delta (streaming text)
    if (data.type === "content_block_delta" && data.delta && data.delta.text) {
      appendToAssistant(data.delta.text);
      return;
    }

    // Content block with text
    if (data.type === "content_block_start" && data.content_block) {
      if (data.content_block.type === "text" && data.content_block.text) {
        appendToAssistant(data.content_block.text);
      }
      return;
    }

    // Tool use
    if (data.type === "tool_use" || (data.type === "content_block_start" && data.content_block && data.content_block.type === "tool_use")) {
      const toolName = data.tool_name || (data.content_block && data.content_block.name) || "tool";
      appendToolUse(toolName);
      return;
    }

    // Result message with text
    if (data.type === "result" && data.result) {
      finalizeAssistant();
      addAssistantMessage(data.result);
      return;
    }
  }

  // --- UI helpers ---
  function addUserMessage(text, timestamp) {
    const div = document.createElement("div");
    div.className = "message user";
    div.innerHTML = `
      <div class="message-bubble">${escapeHtml(text)}</div>
      <div class="message-meta">${formatTime(timestamp)}</div>
    `;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function addAssistantMessage(text, timestamp) {
    const div = document.createElement("div");
    div.className = "message assistant";
    div.innerHTML = `
      <div class="message-bubble">${renderMarkdown(text)}</div>
      <div class="message-meta">${formatTime(timestamp)}</div>
    `;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function addSystemMessage(text) {
    const div = document.createElement("div");
    div.className = "message assistant";
    div.innerHTML = `<div class="message-bubble" style="border-color: var(--error); color: var(--error);">${escapeHtml(text)}</div>`;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function appendToAssistant(text) {
    if (!currentAssistantEl) {
      currentAssistantEl = document.createElement("div");
      currentAssistantEl.className = "message assistant";
      currentAssistantEl.innerHTML = `<div class="message-bubble"></div>`;
      messagesEl.appendChild(currentAssistantEl);
      currentAssistantText = "";
    }
    currentAssistantText += text;
    const bubble = currentAssistantEl.querySelector(".message-bubble");
    bubble.innerHTML = renderMarkdown(currentAssistantText);
    scrollToBottom();
  }

  function appendToolUse(toolName) {
    if (!currentAssistantEl) {
      currentAssistantEl = document.createElement("div");
      currentAssistantEl.className = "message assistant";
      currentAssistantEl.innerHTML = `<div class="message-bubble"></div>`;
      messagesEl.appendChild(currentAssistantEl);
      currentAssistantText = "";
    }
    const bubble = currentAssistantEl.querySelector(".message-bubble");
    const toolDiv = document.createElement("div");
    toolDiv.className = "tool-use";
    toolDiv.innerHTML = `<span class="tool-icon">&#9881;</span> ${escapeHtml(toolName)}`;
    bubble.appendChild(toolDiv);
    scrollToBottom();
  }

  function finalizeAssistant() {
    if (currentAssistantEl) {
      const meta = document.createElement("div");
      meta.className = "message-meta";
      meta.textContent = formatTime(Date.now());
      currentAssistantEl.appendChild(meta);
    }
    currentAssistantEl = null;
    currentAssistantText = "";
  }

  function setStatus(state, text) {
    statusDot.className = "status-dot " + state;
    statusText.querySelector("span").textContent = text;
  }

  function setBusy(isBusy) {
    busy = isBusy;
    if (isBusy) {
      setStatus("busy", "Thinking...");
      sendBtn.classList.add("abort");
      sendBtn.innerHTML = "&#9632;"; // stop icon
    } else {
      setStatus("connected", "Ready");
      sendBtn.classList.remove("abort");
      sendBtn.innerHTML = "&#9650;"; // send icon
    }
  }

  function hideEmpty() {
    if (emptyState) emptyState.style.display = "none";
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  // --- Input handling ---
  function sendPrompt() {
    const text = inputEl.value.trim();
    if (!text || !connected) return;

    if (busy) {
      // Abort
      ws.send(JSON.stringify({ type: "abort" }));
      return;
    }

    ws.send(JSON.stringify({ type: "prompt", text }));
    inputEl.value = "";
    inputEl.style.height = "auto";
    inputEl.focus();
  }

  sendBtn.addEventListener("click", sendPrompt);

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  });

  // Auto-resize textarea
  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
  });

  // --- Formatting helpers ---
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function formatTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function renderMarkdown(text) {
    if (!text) return "";
    let html = escapeHtml(text);

    // Code blocks: ```lang\n...\n```
    html = html.replace(
      /```(\w*)\n([\s\S]*?)```/g,
      (_, lang, code) => `<pre><code>${code.trim()}</code></pre>`
    );

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Bold
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    // Italic
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

    // Line breaks
    html = html.replace(/\n/g, "<br>");

    return html;
  }

  // --- Start ---
  connect();
})();
