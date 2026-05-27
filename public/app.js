const STORAGE_KEY = "m3-desk-companion:v2";
const welcomeMessage = {
  role: "assistant",
  content: "Hey, I am ready. I will use your local Ollama model unless Demo is turned on."
};

const messagesEl = document.querySelector("#messages");
const conversationListEl = document.querySelector("#conversationList");
const form = document.querySelector("#composer");
const promptEl = document.querySelector("#prompt");
const demoModeEl = document.querySelector("#demoMode");
const modelEl = document.querySelector("#model");
const newChatButton = document.querySelector("#newChat");
const renameChatButton = document.querySelector("#renameChat");
const deleteChatButton = document.querySelector("#deleteChat");
const exportChatButton = document.querySelector("#exportChat");
const hideChatButton = document.querySelector("#hideChat");
const showHiddenButton = document.querySelector("#showHidden");
const regenerateButton = document.querySelector("#regenerate");
const focusModeButton = document.querySelector("#focusMode");
const exitFocusButton = document.querySelector("#exitFocus");
const sendButton = document.querySelector("#send");
const stopButton = document.querySelector("#stop");
const fileUploadEl = document.querySelector("#fileUpload");
const documentsEl = document.querySelector("#documents");
const imageSizeEl = document.querySelector("#imageSize");
const statusEl = document.querySelector("#status");
const activeTitleEl = document.querySelector("#activeTitle");

let abortController = null;
let state = loadState();

function currentModel() {
  return modelEl.value || "llama3.2:3b";
}

function createConversation() {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    hidden: false,
    documents: [],
    messages: [{ ...welcomeMessage }]
  };
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "");
    if (saved?.conversations?.length && saved.activeId) return saved;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }

  const firstConversation = createConversation();
  return {
    activeId: firstConversation.id,
    showHidden: false,
    conversations: [firstConversation]
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function activeConversation() {
  let conversation = state.conversations.find((item) => item.id === state.activeId);
  if (!conversation) {
    conversation = state.conversations.find((item) => !item.hidden) || state.conversations[0] || createConversation();
    if (!state.conversations.length) state.conversations.push(conversation);
    state.activeId = conversation.id;
  }
  if (!conversation.documents) conversation.documents = [];
  if (typeof conversation.hidden !== "boolean") conversation.hidden = false;
  let changed = false;
  conversation.documents.forEach((document) => {
    if (!document.chunks?.length && document.text) {
      document.chunks = buildDocumentChunks(document);
      changed = true;
    }
  });
  if (changed) saveState();
  return conversation;
}

function titleFromMessage(content) {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 39)}...` : clean || "New chat";
}

function tokenize(value) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((term) => term.length > 2)
  );
}

function chunkText(text, size = 1200, overlap = 160) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(text.length, start + size);
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end === text.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

function buildDocumentChunks(document) {
  const sourcePages = document.pages?.length ? document.pages : [{ page: null, text: document.text }];
  return sourcePages.flatMap((page) =>
    chunkText(page.text).map((text, index) => ({
      id: crypto.randomUUID(),
      source: document.name,
      page: page.page,
      index: index + 1,
      text
    }))
  );
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMarkdown(content) {
  const codeBlocks = [];
  let html = escapeHtml(content).replace(/```([\s\S]*?)```/g, (_match, code) => {
    const index = codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`) - 1;
    return `@@CODEBLOCK_${index}@@`;
  });

  html = html
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");

  codeBlocks.forEach((block, index) => {
    html = html.replace(`@@CODEBLOCK_${index}@@`, block);
  });

  return html;
}

function renderConversationList() {
  conversationListEl.replaceChildren();

  [...state.conversations]
    .filter((conversation) => state.showHidden || !conversation.hidden)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .forEach((conversation) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = [
        "conversation-button",
        conversation.id === state.activeId ? "active" : "",
        conversation.hidden ? "is-hidden-chat" : ""
      ].filter(Boolean).join(" ");
      button.textContent = conversation.title;
      button.addEventListener("click", () => {
        if (abortController) return;
        state.activeId = conversation.id;
        saveState();
        renderAll();
      });
      conversationListEl.append(button);
    });
}

function canRegenerate(conversation) {
  return conversation.messages.some((message) => message.role === "user") && !abortController;
}

function createMessageNode(message) {
  const node = document.createElement("article");
  node.className = `message ${message.role}`;

  const body = document.createElement("div");
  body.className = "message-body";
  body.innerHTML = renderMarkdown(message.content);
  node.append(body);

  if (message.imageUrl) {
    const imageLink = document.createElement("a");
    imageLink.href = message.imageUrl;
    imageLink.target = "_blank";
    imageLink.rel = "noreferrer";
    imageLink.className = "generated-image-link";

    const image = document.createElement("img");
    image.className = "generated-image";
    image.src = message.image || message.imageUrl;
    image.alt = message.prompt || "Generated image";

    imageLink.append(image);
    node.append(imageLink);
  }

  if (message.role === "assistant" && message.content.trim()) {
    const copyButton = document.createElement("button");
    copyButton.className = "copy-button";
    copyButton.type = "button";
    copyButton.textContent = "Copy";
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(message.content);
      copyButton.textContent = "Copied";
      setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1200);
    });
    node.append(copyButton);
  }

  return node;
}

function renderMessages() {
  const shouldFollow =
    messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;

  messagesEl.replaceChildren();
  activeConversation().messages.forEach((message) => {
    messagesEl.append(createMessageNode(message));
  });

  if (shouldFollow) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function renderDocuments() {
  const documents = activeConversation().documents || [];
  documentsEl.classList.toggle("hidden", documents.length === 0);
  documentsEl.replaceChildren();

  documents.forEach((attachedDocument) => {
    const chip = document.createElement("article");
    chip.className = "document-chip";

    const detail = document.createElement("div");
    detail.className = "document-detail";

    const title = document.createElement("strong");
    title.textContent = attachedDocument.name;

    const meta = document.createElement("span");
    meta.textContent = `${(attachedDocument.chunks?.length || 0).toLocaleString()} chunks, ${attachedDocument.chars.toLocaleString()} chars${attachedDocument.truncated ? " truncated" : ""}`;

    detail.append(title, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-document";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      const conversation = activeConversation();
      conversation.documents = conversation.documents.filter((item) => item.id !== attachedDocument.id);
      conversation.updatedAt = Date.now();
      saveState();
      renderAll();
    });

    chip.append(detail, remove);
    documentsEl.append(chip);
  });
}

function renderAll() {
  const conversation = activeConversation();
  activeTitleEl.textContent = conversation.title;
  statusEl.textContent = `${demoModeEl.checked ? "Demo mode" : "Ready"} on ${currentModel()}`;
  regenerateButton.disabled = !canRegenerate(conversation);
  deleteChatButton.disabled = state.conversations.length <= 1;
  hideChatButton.textContent = conversation.hidden ? "Unhide" : "Hide";
  showHiddenButton.textContent = state.showHidden ? "Shown" : "Hidden";
  showHiddenButton.classList.toggle("active-tool", state.showHidden);
  renderConversationList();
  renderMessages();
  renderDocuments();
}

function setLoading(isLoading) {
  sendButton.disabled = isLoading;
  promptEl.disabled = isLoading;
  demoModeEl.disabled = isLoading;
  modelEl.disabled = isLoading;
  fileUploadEl.disabled = isLoading;
  stopButton.classList.toggle("hidden", !isLoading);
  regenerateButton.disabled = isLoading || !canRegenerate(activeConversation());
  statusEl.textContent = isLoading ? "Thinking..." : `${demoModeEl.checked ? "Demo mode" : "Ready"} on ${currentModel()}`;
}

function parseSseEvents(buffer) {
  const events = [];
  const chunks = buffer.split("\n\n");
  const remainder = chunks.pop() || "";

  for (const chunk of chunks) {
    const eventLine = chunk.split("\n").find((line) => line.startsWith("event: "));
    const dataLine = chunk.split("\n").find((line) => line.startsWith("data: "));
    if (!eventLine || !dataLine) continue;
    events.push({
      event: eventLine.slice(7),
      data: JSON.parse(dataLine.slice(6))
    });
  }

  return { events, remainder };
}

function selectRelevantChunks(conversation, query) {
  const documents = conversation.documents || [];
  const terms = tokenize(query);
  const chunks = documents.flatMap((document) => document.chunks || []);

  if (!chunks.length) return [];

  return chunks
    .map((chunk) => {
      const chunkTerms = tokenize(chunk.text);
      let score = 0;
      terms.forEach((term) => {
        if (chunkTerms.has(term)) score += 3;
        if (chunk.text.toLowerCase().includes(term)) score += 1;
      });
      return { ...chunk, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function buildModelMessages(conversation) {
  const usableMessages = conversation.messages.filter((message) => ["user", "assistant"].includes(message.role));
  const lastUserMessage = [...usableMessages].reverse().find((message) => message.role === "user")?.content || "";
  const relevantChunks = selectRelevantChunks(conversation, lastUserMessage);

  if (!relevantChunks.length) return usableMessages;

  const documentContext = relevantChunks
    .map((chunk, index) => [
      `[Source ${index + 1}: ${chunk.source}${chunk.page ? `, page ${chunk.page}` : `, chunk ${chunk.index}`}]`,
      chunk.text
    ].join("\n"))
    .join("\n\n---\n\n");

  return [
    {
      role: "system",
      content: [
        "You are a local assistant with user-attached documents.",
        "Use the retrieved source snippets when they are relevant.",
        "Cite sources inline using labels such as [Source 1] or [Source 2].",
        "If the answer is not supported by the snippets, say what is missing instead of pretending.",
        "",
        documentContext
      ].join("\n")
    },
    ...usableMessages
  ];
}

async function streamAssistantReply(conversation) {
  abortController = new AbortController();
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: abortController.signal,
    body: JSON.stringify({
      messages: buildModelMessages(conversation),
      model: currentModel(),
      demo: demoModeEl.checked
    })
  });

  if (!response.ok || !response.body) throw new Error("Chat stream failed to start.");

  const assistantMessage = { role: "assistant", content: "" };
  conversation.messages.push(assistantMessage);
  renderMessages();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseEvents(buffer);
    buffer = parsed.remainder;

    for (const item of parsed.events) {
      if (item.event === "token") {
        assistantMessage.content += item.data.content;
        renderMessages();
      }
      if (item.event === "error") {
        throw new Error(item.data.detail || item.data.error || "Model stream failed.");
      }
    }
  }

  conversation.updatedAt = Date.now();
  saveState();
  renderAll();
}

async function sendCurrentConversation() {
  const conversation = activeConversation();
  setLoading(true);

  try {
    await streamAssistantReply(conversation);
  } catch (error) {
    if (error.name !== "AbortError") {
      conversation.messages.push({
        role: "error",
        content: `${error.message}\n\nCheck that Ollama is running, or turn Demo on and try again.`
      });
    }
    saveState();
    renderAll();
  } finally {
    abortController = null;
    setLoading(false);
    promptEl.focus();
  }
}

async function generateImageForConversation(prompt) {
  const conversation = activeConversation();
  const [width, height] = imageSizeEl.value.split("x").map(Number);

  conversation.messages.push({ role: "user", content: `/image ${prompt}` });
  conversation.updatedAt = Date.now();
  if (conversation.title === "New chat") {
    conversation.title = titleFromMessage(prompt);
  }
  saveState();
  renderAll();

  statusEl.textContent = "Creating image...";
  sendButton.disabled = true;

  try {
    const response = await fetch("/api/images/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        width,
        height
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Image generation failed.");

    conversation.messages.push({
      role: "assistant",
      content: `Generated image via ${result.provider}. Seed: ${result.seed}`,
      imageUrl: result.imageUrl,
      image: result.image,
      prompt
    });
    conversation.updatedAt = Date.now();
    saveState();
    renderAll();

    statusEl.textContent = "Image added to chat.";
  } catch (error) {
    conversation.messages.push({
      role: "error",
      content: error.message
    });
    saveState();
    renderAll();
    statusEl.textContent = error.message;
  } finally {
    sendButton.disabled = false;
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = String(reader.result || "");
      resolve(result.slice(result.indexOf(",") + 1));
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = promptEl.value.trim();
  if (!text || abortController) return;

  if (text.toLowerCase().startsWith("/image ")) {
    promptEl.value = "";
    const imagePrompt = text.slice(7).trim();
    if (imagePrompt) {
      await generateImageForConversation(imagePrompt);
    }
    return;
  }

  const conversation = activeConversation();
  promptEl.value = "";
  conversation.messages.push({ role: "user", content: text });

  if (conversation.title === "New chat") {
    conversation.title = titleFromMessage(text);
  }

  conversation.updatedAt = Date.now();
  saveState();
  renderAll();
  await sendCurrentConversation();
});

promptEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

newChatButton.addEventListener("click", () => {
  if (abortController) return;
  const conversation = createConversation();
  state.conversations.unshift(conversation);
  state.activeId = conversation.id;
  saveState();
  renderAll();
  promptEl.focus();
});

renameChatButton.addEventListener("click", () => {
  if (abortController) return;
  const conversation = activeConversation();
  const title = prompt("Rename chat", conversation.title);
  if (!title?.trim()) return;
  conversation.title = title.trim();
  conversation.updatedAt = Date.now();
  saveState();
  renderAll();
});

deleteChatButton.addEventListener("click", () => {
  if (abortController || state.conversations.length <= 1) return;
  const conversation = activeConversation();
  if (!confirm(`Delete "${conversation.title}"?`)) return;
  state.conversations = state.conversations.filter((item) => item.id !== conversation.id);
  state.activeId = state.conversations[0].id;
  saveState();
  renderAll();
});

hideChatButton.addEventListener("click", () => {
  if (abortController) return;
  const conversation = activeConversation();
  conversation.hidden = !conversation.hidden;
  conversation.updatedAt = Date.now();

  if (conversation.hidden && !state.showHidden) {
    const nextConversation = state.conversations.find((item) => !item.hidden && item.id !== conversation.id);
    if (nextConversation) {
      state.activeId = nextConversation.id;
    } else {
      const freshConversation = createConversation();
      state.conversations.unshift(freshConversation);
      state.activeId = freshConversation.id;
    }
  }

  saveState();
  renderAll();
});

showHiddenButton.addEventListener("click", () => {
  state.showHidden = !state.showHidden;
  saveState();
  renderAll();
});

exportChatButton.addEventListener("click", () => {
  const conversation = activeConversation();
  const lines = [
    `# ${conversation.title}`,
    "",
    ...(conversation.documents || []).map((document) => `Attached document: ${document.name}`),
    "",
    ...conversation.messages.map((message) => `## ${message.role}\n\n${message.content}`)
  ];
  const blob = new Blob([lines.join("\n\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${conversation.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "chat"}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
});

regenerateButton.addEventListener("click", async () => {
  if (abortController) return;
  const conversation = activeConversation();
  const lastUserIndex = conversation.messages.map((message) => message.role).lastIndexOf("user");
  if (lastUserIndex === -1) return;
  conversation.messages = conversation.messages.slice(0, lastUserIndex + 1);
  conversation.updatedAt = Date.now();
  saveState();
  renderAll();
  await sendCurrentConversation();
});

stopButton.addEventListener("click", () => {
  abortController?.abort();
});

function setFocusMode(enabled) {
  document.body.classList.toggle("focus-mode", enabled);
  exitFocusButton.classList.toggle("hidden", !enabled);
}

focusModeButton.addEventListener("click", () => setFocusMode(true));
exitFocusButton.addEventListener("click", () => setFocusMode(false));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("focus-mode")) {
    setFocusMode(false);
  }
});

fileUploadEl.addEventListener("change", async () => {
  const file = fileUploadEl.files?.[0];
  if (!file || abortController) return;

  const conversation = activeConversation();
  statusEl.textContent = `Reading ${file.name}...`;
  fileUploadEl.disabled = true;

  try {
    const data = await fileToBase64(file);
    const response = await fetch("/api/files/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: file.name,
        type: file.type,
        data
      })
    });
    const extracted = await response.json();

    if (!response.ok) throw new Error(extracted.error || "Could not read that file.");

    conversation.documents.push({
      id: crypto.randomUUID(),
      uploadedAt: Date.now(),
      ...extracted,
      chunks: buildDocumentChunks(extracted)
    });
    conversation.updatedAt = Date.now();

    if (conversation.title === "New chat") {
      conversation.title = titleFromMessage(file.name);
    }

    conversation.messages.push({
      role: "assistant",
      content: `Attached **${extracted.name}** and indexed it for document search. Ask me what you want to know from it.`
    });

    saveState();
    renderAll();
  } catch (error) {
    conversation.messages.push({
      role: "error",
      content: error.message
    });
    saveState();
    renderAll();
  } finally {
    fileUploadEl.value = "";
    fileUploadEl.disabled = false;
    statusEl.textContent = `${demoModeEl.checked ? "Demo mode" : "Ready"} on ${currentModel()}`;
  }
});

demoModeEl.addEventListener("change", renderAll);
modelEl.addEventListener("input", renderAll);

async function loadModels() {
  try {
    const response = await fetch("/api/models");
    const data = await response.json();
    if (!response.ok || !data.models?.length) return;

    const current = currentModel();
    modelEl.replaceChildren();
    data.models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.name;
      option.textContent = model.name;
      modelEl.append(option);
    });
    modelEl.value = data.models.some((model) => model.name === current) ? current : data.models[0].name;
    renderAll();
  } catch {
    renderAll();
  }
}

renderAll();
loadModels();
