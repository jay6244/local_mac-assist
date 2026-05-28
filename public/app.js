const STORAGE_KEY = "m3-desk-companion:v2";
const SETTINGS_KEY = "m3-desk-companion:settings-v3";
const welcomeMessage = {
  role: "assistant",
  content: "Hey, I am ready. Ask me anything, or ask for a photo and I will route it to the image generator automatically."
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
const settingsToggleButton = document.querySelector("#settingsToggle");
const settingsPanelEl = document.querySelector("#settingsPanel");
const focusModeButton = document.querySelector("#focusMode");
const exitFocusButton = document.querySelector("#exitFocus");
const sendButton = document.querySelector("#send");
const stopButton = document.querySelector("#stop");
const cameraButton = document.querySelector("#cameraButton");
const cameraModalEl = document.querySelector("#cameraModal");
const cameraPreviewEl = document.querySelector("#cameraPreview");
const cameraCanvasEl = document.querySelector("#cameraCanvas");
const closeCameraButton = document.querySelector("#closeCamera");
const capturePhotoButton = document.querySelector("#capturePhoto");
const usePhotoButton = document.querySelector("#usePhoto");
const fileUploadEl = document.querySelector("#fileUpload");
const documentsEl = document.querySelector("#documents");
const imageProviderEl = document.querySelector("#imageProvider");
const imageSizeEl = document.querySelector("#imageSize");
const checkpointNameEl = document.querySelector("#checkpointName");
const statusEl = document.querySelector("#status");
const activeTitleEl = document.querySelector("#activeTitle");

let abortController = null;
let state = loadState();
let settings = loadSettings();
let cameraStream = null;
let capturedPhotoDataUrl = "";

function currentModel() {
  return modelEl.value || "llama3.2:3b";
}

function loadSettings() {
  try {
    const savedSettings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      imageProvider: savedSettings.imageProvider || "auto",
      imageSize: savedSettings.imageSize || "512x512",
      checkpoint: savedSettings.checkpoint || "juggernautXL_v9Rdphoto2Lightning.safetensors",
      settingsOpen: false
    };
  } catch {
    return {
      imageProvider: "auto",
      imageSize: "512x512",
      checkpoint: "juggernautXL_v9Rdphoto2Lightning.safetensors",
      settingsOpen: false
    };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function applySettings() {
  imageProviderEl.value = settings.imageProvider || "auto";
  imageSizeEl.value = settings.imageSize || "512x512";
  if (!imageSizeEl.value || imageSizeEl.value === "1024x1024") {
    imageSizeEl.value = "512x512";
    settings.imageSize = "512x512";
    saveSettings();
  }
  checkpointNameEl.value = settings.checkpoint || "juggernautXL_v9Rdphoto2Lightning.safetensors";
  settingsPanelEl.classList.toggle("hidden", !settings.settingsOpen);
  settingsToggleButton.textContent = settings.settingsOpen ? "Close" : "Settings";
}

function createConversation() {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    hidden: false,
    documents: [],
    referenceImages: [],
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
  if (!conversation.referenceImages) conversation.referenceImages = [];
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

    const imageActions = document.createElement("div");
    imageActions.className = "image-actions";

    const openButton = document.createElement("a");
    openButton.className = "image-action-button";
    openButton.href = message.imageUrl;
    openButton.target = "_blank";
    openButton.rel = "noreferrer";
    openButton.textContent = "Open full size";

    const downloadButton = document.createElement("button");
    downloadButton.className = "image-action-button";
    downloadButton.type = "button";
    downloadButton.textContent = "Download";
    downloadButton.addEventListener("click", () => downloadImage(message));

    imageActions.append(openButton, downloadButton);
    node.append(imageActions);
  }

  if (message.image && !message.imageUrl) {
    const image = document.createElement("img");
    image.className = "generated-image reference-preview";
    image.src = message.image;
    image.alt = message.prompt || "Uploaded reference image";
    node.append(image);
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

function downloadImage(message) {
  const source = message.image || message.imageUrl;
  if (!source) return;
  const anchor = document.createElement("a");
  anchor.href = source;
  anchor.download = `${titleFromMessage(message.prompt || "generated-image").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "generated-image"}.png`;
  anchor.click();
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
  const referenceImages = activeConversation().referenceImages || [];
  documentsEl.classList.toggle("hidden", documents.length === 0 && referenceImages.length === 0);
  documentsEl.replaceChildren();

  referenceImages.forEach((referenceImage) => {
    const chip = document.createElement("article");
    chip.className = "document-chip image-chip";

    const preview = document.createElement("img");
    preview.src = referenceImage.dataUrl;
    preview.alt = referenceImage.name;

    const detail = document.createElement("div");
    detail.className = "document-detail";

    const title = document.createElement("strong");
    title.textContent = referenceImage.name;

    const meta = document.createElement("span");
    meta.textContent = "Style reference";

    detail.append(title, meta);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-document";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      const conversation = activeConversation();
      conversation.referenceImages = conversation.referenceImages.filter((item) => item.id !== referenceImage.id);
      conversation.updatedAt = Date.now();
      saveState();
      renderAll();
    });

    chip.append(preview, detail, remove);
    documentsEl.append(chip);
  });

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
  statusEl.textContent = demoModeEl.checked ? "Demo mode" : "Ready";
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
  cameraButton.disabled = isLoading;
  stopButton.classList.toggle("hidden", !isLoading);
  regenerateButton.disabled = isLoading || !canRegenerate(activeConversation());
  statusEl.textContent = isLoading ? "Thinking..." : demoModeEl.checked ? "Demo mode" : "Ready";
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

function latestReferenceImage(conversation) {
  return [...(conversation.referenceImages || [])].sort((a, b) => b.uploadedAt - a.uploadedAt)[0] || null;
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

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let assistantMessage = null;
  let buffer = "";
  let hasReceivedToken = false;

  while (true) {
    const readResult = await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Local streaming paused, retrying without streaming.")), hasReceivedToken ? 60000 : 12000);
      })
    ]);
    const { value, done } = readResult;
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseEvents(buffer);
    buffer = parsed.remainder;

    for (const item of parsed.events) {
      if (item.event === "token") {
        if (!assistantMessage) {
          assistantMessage = { role: "assistant", content: "" };
          conversation.messages.push(assistantMessage);
        }
        hasReceivedToken = true;
        assistantMessage.content += item.data.content;
        renderMessages();
      }
      if (item.event === "error") {
        throw new Error(item.data.detail || item.data.error || "Model stream failed.");
      }
    }
  }

  if (!assistantMessage) throw new Error("The local model returned an empty response.");

  conversation.updatedAt = Date.now();
  saveState();
  renderAll();
}

async function fetchAssistantReply(conversation) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: buildModelMessages(conversation),
      model: currentModel(),
      demo: demoModeEl.checked
    })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.detail || result.error || "Chat request failed.");

  conversation.messages.push({
    role: "assistant",
    content: result.content || ""
  });
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
      try {
        statusEl.textContent = "Retrying...";
        await fetchAssistantReply(conversation);
      } catch (fallbackError) {
        conversation.messages.push({
          role: "error",
          content: `${fallbackError.message}\n\nThe chat side uses Ollama. Images use the image engine automatically. If this keeps happening, start Ollama with \`ollama serve\` or turn Demo on in Settings.`
        });
      }
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
  if (/^(an?\s+)?(image|photo|picture|photograph)$/i.test(prompt.trim())) {
    conversation.messages.push({
      role: "error",
      content: "Tell me the subject too, for example: `/image realistic photo of a flying horse at sunset`."
    });
    saveState();
    renderAll();
    return;
  }
  const [width, height] = imageSizeEl.value.split("x").map(Number);
  const provider = imageProviderEl.value;
  const providerLabel = provider === "comfyui" ? "ComfyUI" : provider === "cloud" ? "cloud fallback" : "auto image engine";
  const referenceImage = latestReferenceImage(conversation);
  if (referenceImage?.dataUrl) {
    statusEl.textContent = "Optimizing reference image...";
    const compactDataUrl = await compressImageDataUrl(referenceImage.dataUrl);
    if (compactDataUrl !== referenceImage.dataUrl) {
      referenceImage.dataUrl = compactDataUrl;
      referenceImage.type = "image/jpeg";
      const analysis = await analyzeImageStyle(compactDataUrl);
      referenceImage.width = analysis.width;
      referenceImage.height = analysis.height;
      referenceImage.styleNotes = analysis.notes;
      conversation.updatedAt = Date.now();
      saveState();
      renderDocuments();
    }
  }
  const referencePrompt = referenceImage
    ? `${prompt}. Match the uploaded reference image style: ${referenceImage.styleNotes}`
    : prompt;

  conversation.messages.push({ role: "user", content: `/image ${prompt}` });
  conversation.updatedAt = Date.now();
  if (conversation.title === "New chat") {
    conversation.title = titleFromMessage(prompt);
  }
  saveState();
  renderAll();

  statusEl.textContent = `Creating image with ${providerLabel}...`;
  sendButton.disabled = true;

  try {
    const response = await fetch("/api/images/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: referencePrompt,
        width,
        height,
        provider,
        checkpoint: checkpointNameEl.value.trim(),
        referenceImage: referenceImage
          ? {
              name: referenceImage.name,
              type: referenceImage.type,
              dataUrl: referenceImage.dataUrl
            }
          : null
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Image generation failed.");

    const fallbackNote = result.fallbackReason ? `\n\nComfyUI was not available, so I used the cloud fallback.` : "";
    const referenceNote = referenceImage
      ? result.usedReference
        ? `\n\nUsed **${referenceImage.name}** as the style reference.`
        : `\n\nI used the uploaded image's style notes, but this provider could not use the image pixels directly.`
      : "";
    conversation.messages.push({
      role: "assistant",
      content: `Generated image via ${result.provider}. Seed: ${result.seed}${fallbackNote}${referenceNote}`,
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
    promptEl.focus();
  }
}

function isNaturalImageRequest(text) {
  const normalized = text.toLowerCase();
  const typoFriendly = normalized
    .replace(/\breale\s*stic\b/g, "realistic")
    .replace(/\breale?stic\b/g, "realistic")
    .replace(/\bprtrait\b/g, "portrait");
  const hasImageTerm = /\b(image|photo|picture|pic|portrait|selfie|photograph)\b/.test(typoFriendly);
  const hasCommand = /\b(generate|create|make|draw|show|give|need|want)\b/.test(typoFriendly);
  const hasPhotoCue = /\b(realistic|photorealistic|sharp|camera|iphone|dslr|cinematic)\b/.test(typoFriendly);
  return hasImageTerm && (hasCommand || hasPhotoCue);
}

function imagePromptFromRequest(text) {
  return text
    .replace(/^\/image\s+/i, "")
    .replace(/\breale\s*stic\b/gi, "realistic")
    .replace(/\breale?stic\b/gi, "realistic")
    .replace(/\bprtrait\b/gi, "portrait")
    .replace(/^(please\s+)?(generate|create|make|draw|show|give|need|want)\s+(me\s+)?(?:(a|an|the)\s+)?/i, "")
    .replace(/^(image|photo|picture|pic|portrait|selfie|photograph)\s+(of\s+)?/i, "")
    .trim();
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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function compressImageDataUrl(dataUrl, maxSide = 1024, quality = 0.86) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => {
      const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    });
    image.addEventListener("error", () => reject(new Error("Could not read that image.")));
    image.src = dataUrl;
  });
}

function analyzeImageStyle(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => {
      const canvas = document.createElement("canvas");
      const sampleSize = 64;
      canvas.width = sampleSize;
      canvas.height = sampleSize;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0, sampleSize, sampleSize);
      const { data } = context.getImageData(0, 0, sampleSize, sampleSize);
      let red = 0;
      let green = 0;
      let blue = 0;
      let brightness = 0;
      let warmPixels = 0;
      let saturatedPixels = 0;
      const pixels = sampleSize * sampleSize;

      for (let index = 0; index < data.length; index += 4) {
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        red += r;
        green += g;
        blue += b;
        brightness += (r + g + b) / 3;
        if (r > b + 18) warmPixels += 1;
        if (Math.max(r, g, b) - Math.min(r, g, b) > 58) saturatedPixels += 1;
      }

      const average = {
        red: Math.round(red / pixels),
        green: Math.round(green / pixels),
        blue: Math.round(blue / pixels),
        brightness: Math.round(brightness / pixels)
      };
      const aspect = image.width > image.height ? "landscape" : image.width < image.height ? "portrait" : "square";
      const mood = average.brightness > 170 ? "bright" : average.brightness < 85 ? "low-key" : "balanced";
      const temperature = warmPixels > pixels * 0.48 ? "warm" : warmPixels < pixels * 0.28 ? "cool" : "neutral";
      const saturation = saturatedPixels > pixels * 0.42 ? "vivid" : saturatedPixels < pixels * 0.18 ? "muted" : "natural";

      resolve({
        width: image.width,
        height: image.height,
        notes: `${aspect} composition, ${mood} exposure, ${temperature} color temperature, ${saturation} colors, average RGB ${average.red}/${average.green}/${average.blue}`
      });
    });
    image.addEventListener("error", () => reject(new Error("Could not read that image.")));
    image.src = dataUrl;
  });
}

async function attachReferenceImage({ dataUrl, name, type, size = 0 }) {
  const conversation = activeConversation();
  const compactDataUrl = await compressImageDataUrl(dataUrl);
  const analysis = await analyzeImageStyle(compactDataUrl);
  const referenceImage = {
    id: crypto.randomUUID(),
    name,
    type: "image/jpeg",
    size,
    uploadedAt: Date.now(),
    dataUrl: compactDataUrl,
    width: analysis.width,
    height: analysis.height,
    styleNotes: analysis.notes
  };

  conversation.referenceImages.unshift(referenceImage);
  conversation.updatedAt = Date.now();

  if (conversation.title === "New chat") {
    conversation.title = titleFromMessage(name);
  }

  conversation.messages.push({
    role: "assistant",
    content: `Attached **${name}** as a style reference.\n\nStyle read: ${analysis.notes}\n\nNow ask for an image and I will match this reference as closely as the selected image engine allows.`,
    image: compactDataUrl,
    prompt: name
  });

  saveState();
  renderAll();
}

function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  cameraPreviewEl.srcObject = null;
}

function closeCamera() {
  stopCamera();
  capturedPhotoDataUrl = "";
  usePhotoButton.disabled = true;
  cameraModalEl.classList.add("hidden");
  promptEl.focus();
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Camera capture is not available in this browser.");
  }

  capturedPhotoDataUrl = "";
  usePhotoButton.disabled = true;
  cameraModalEl.classList.remove("hidden");
  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: "user",
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  });
  cameraPreviewEl.srcObject = cameraStream;
  await cameraPreviewEl.play();
}

function captureCameraFrame() {
  const width = cameraPreviewEl.videoWidth || 1280;
  const height = cameraPreviewEl.videoHeight || 720;
  cameraCanvasEl.width = width;
  cameraCanvasEl.height = height;
  const context = cameraCanvasEl.getContext("2d");
  context.drawImage(cameraPreviewEl, 0, 0, width, height);
  capturedPhotoDataUrl = cameraCanvasEl.toDataURL("image/jpeg", 0.92);
  usePhotoButton.disabled = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const text = promptEl.value.trim();
  if (!text || abortController) return;

  if (text.toLowerCase().startsWith("/image ") || isNaturalImageRequest(text)) {
    promptEl.value = "";
    const imagePrompt = imagePromptFromRequest(text);
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
    ...(conversation.referenceImages || []).map((image) => `Attached style reference: ${image.name} (${image.styleNotes})`),
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
  const lastUserMessage = conversation.messages[lastUserIndex].content;
  conversation.messages = conversation.messages.slice(0, lastUserIndex + 1);
  conversation.updatedAt = Date.now();
  saveState();
  renderAll();

  if (lastUserMessage.toLowerCase().startsWith("/image ") || isNaturalImageRequest(lastUserMessage)) {
    conversation.messages = conversation.messages.slice(0, lastUserIndex);
    const imagePrompt = imagePromptFromRequest(lastUserMessage);
    if (imagePrompt) await generateImageForConversation(imagePrompt);
    return;
  }

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
    if (file.type.startsWith("image/")) {
      const maxImageBytes = 8 * 1024 * 1024;
      if (file.size > maxImageBytes) throw new Error("Reference images must be 8 MB or smaller.");
      const dataUrl = await fileToDataUrl(file);
      await attachReferenceImage({ dataUrl, name: file.name, type: file.type, size: file.size });
      return;
    }

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
    statusEl.textContent = demoModeEl.checked ? "Demo mode" : "Ready";
  }
});

cameraButton.addEventListener("click", async () => {
  if (abortController) return;
  statusEl.textContent = "Opening camera...";
  try {
    await openCamera();
    statusEl.textContent = "Camera ready";
  } catch (error) {
    closeCamera();
    activeConversation().messages.push({
      role: "error",
      content: `${error.message}\n\nIf the browser asks for permission, allow camera access and try again.`
    });
    saveState();
    renderAll();
    statusEl.textContent = "Camera unavailable";
  }
});

closeCameraButton.addEventListener("click", closeCamera);

capturePhotoButton.addEventListener("click", () => {
  try {
    captureCameraFrame();
    statusEl.textContent = "Photo captured";
  } catch (error) {
    activeConversation().messages.push({
      role: "error",
      content: error.message || "Could not capture a photo."
    });
    saveState();
    renderAll();
  }
});

usePhotoButton.addEventListener("click", async () => {
  if (!capturedPhotoDataUrl) return;
  statusEl.textContent = "Reading photo...";
  try {
    await attachReferenceImage({
      dataUrl: capturedPhotoDataUrl,
      name: `camera-reference-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`,
      type: "image/jpeg"
    });
    closeCamera();
    statusEl.textContent = "Photo attached";
  } catch (error) {
    activeConversation().messages.push({
      role: "error",
      content: error.message || "Could not use that photo."
    });
    saveState();
    renderAll();
  }
});

demoModeEl.addEventListener("change", renderAll);
modelEl.addEventListener("input", renderAll);
settingsToggleButton.addEventListener("click", () => {
  settings.settingsOpen = !settings.settingsOpen;
  applySettings();
});

[imageProviderEl, imageSizeEl, checkpointNameEl].forEach((control) => {
  control.addEventListener("input", () => {
    settings.imageProvider = imageProviderEl.value;
    settings.imageSize = imageSizeEl.value;
    settings.checkpoint = checkpointNameEl.value.trim();
    saveSettings();
  });
});

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

applySettings();
renderAll();
loadModels();
