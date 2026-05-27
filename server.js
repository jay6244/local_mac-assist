import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = join(process.cwd(), "public");
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 45000;
const MAX_PDF_PAGES_FOR_CITATIONS = 80;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendStreamEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function readRequestBody(req, limitBytes = 2 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) chunks.push(chunk);
  for (const chunk of chunks) size += chunk.length;
  if (size > limitBytes) {
    const error = new Error("Request body is too large.");
    error.statusCode = 413;
    throw error;
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function demoReply(messages) {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.content || "";
  return [
    "Demo mode is awake. Connect Ollama for real local responses.",
    "",
    `You said: "${lastUserMessage}"`,
    "",
    "For your M3 8 GB Mac, start with a 3B model. It keeps memory pressure low and still feels useful for drafts, notes, and coding help."
  ].join("\n");
}

function extensionFor(name = "") {
  return extname(name).toLowerCase();
}

function normalizeExtractedText(text) {
  return text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function trimExtractedText(text) {
  const normalized = normalizeExtractedText(text);
  return {
    text: normalized.slice(0, MAX_EXTRACTED_CHARS),
    chars: normalized.length,
    truncated: normalized.length > MAX_EXTRACTED_CHARS
  };
}

function isPlainTextFile(name, type) {
  const extension = extensionFor(name);
  return (
    type.startsWith("text/") ||
    [
      ".txt",
      ".md",
      ".csv",
      ".json",
      ".js",
      ".ts",
      ".tsx",
      ".jsx",
      ".html",
      ".css",
      ".xml",
      ".yaml",
      ".yml",
      ".py",
      ".java",
      ".c",
      ".cpp",
      ".h",
      ".go",
      ".rs",
      ".rb",
      ".php",
      ".sql",
      ".log"
    ].includes(extension)
  );
}

async function extractFileText({ name, type, data }) {
  if (!name || !data) {
    const error = new Error("Missing file data.");
    error.statusCode = 400;
    throw error;
  }

  const buffer = Buffer.from(data, "base64");
  if (buffer.length > MAX_UPLOAD_BYTES) {
    const error = new Error("Files must be 12 MB or smaller.");
    error.statusCode = 413;
    throw error;
  }

  const extension = extensionFor(name);
  let text = "";
  let pages = [];

  if (extension === ".pdf" || type === "application/pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const info = await parser.getInfo({ parsePageInfo: false });
      const totalPages = Math.min(info.total || 0, MAX_PDF_PAGES_FOR_CITATIONS);
      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
        const pageResult = await parser.getText({ partial: [pageNumber] });
        const pageText = normalizeExtractedText(pageResult.text || "");
        if (pageText) pages.push({ page: pageNumber, text: pageText });
      }
      const result = await parser.getText();
      text = result.text || "";
    } finally {
      await parser.destroy();
    }
  } else if (
    extension === ".docx" ||
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || "";
  } else if (isPlainTextFile(name, type || "")) {
    text = buffer.toString("utf8");
  } else {
    const error = new Error("Unsupported file type. Try PDF, DOCX, TXT, Markdown, CSV, JSON, or code files.");
    error.statusCode = 415;
    throw error;
  }

  const extracted = trimExtractedText(text);
  if (!extracted.text) {
    const error = new Error("I could not find readable text in that file.");
    error.statusCode = 422;
    throw error;
  }

  return {
    name,
    type,
    size: buffer.length,
    ...extracted,
    pages: pages.map((page) => ({
      page: page.page,
      ...trimExtractedText(page.text)
    }))
  };
}

async function handleExtractFile(req, res) {
  try {
    const body = await readRequestBody(req, MAX_UPLOAD_BYTES * 2);
    const extracted = await extractFileText(body);
    sendJson(res, 200, extracted);
  } catch (error) {
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Could not extract that file."
    });
  }
}

async function handleModels(req, res) {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    if (!response.ok) {
      sendJson(res, 502, { error: "Could not read Ollama models." });
      return;
    }

    const data = await response.json();
    sendJson(res, 200, {
      models: (data.models || []).map((model) => ({
        name: model.name,
        size: model.size,
        modifiedAt: model.modified_at
      }))
    });
  } catch (error) {
    sendJson(res, 503, {
      error: "Ollama is not reachable.",
      detail: error.message
    });
  }
}

function isDisallowedImagePrompt(prompt) {
  const normalized = prompt.toLowerCase();
  return [
    "explicit sex",
    "porn",
    "pornographic",
    "nude",
    "naked",
    "genitals",
    "sexual act",
    "hardcore",
    "erotic minor",
    "underage"
  ].some((term) => normalized.includes(term));
}

function enhancePhotoPrompt(prompt) {
  const normalized = prompt.toLowerCase();
  const alreadyPhoto = /\b(photo|photograph|realistic|photorealistic|dslr|mirror selfie|iphone|camera)\b/.test(normalized);
  const basePrompt = alreadyPhoto ? prompt : `realistic photograph of ${prompt}`;

  return [
    basePrompt,
    "natural indoor lighting",
    "lifelike skin texture",
    "real camera perspective",
    "sharp focus",
    "high detail",
    "not illustration",
    "not cartoon",
    "not ASCII art",
    "not drawing"
  ].join(", ");
}

async function handleGenerateImage(req, res) {
  try {
    const body = await readRequestBody(req);
    const prompt = String(body.prompt || "").trim();
    if (!prompt) {
      sendJson(res, 400, { error: "Prompt is required." });
      return;
    }

    if (isDisallowedImagePrompt(prompt)) {
      sendJson(res, 400, {
        error: "I can help generate non-explicit images, but not explicit sexual imagery."
      });
      return;
    }

    const width = Math.min(1280, Math.max(512, Number(body.width || 1024)));
    const height = Math.min(1280, Math.max(512, Number(body.height || 1024)));
    const seed = Number.isFinite(Number(body.seed)) && Number(body.seed) >= 0
      ? Number(body.seed)
      : Math.floor(Math.random() * 1_000_000_000);
    const enhancedPrompt = enhancePhotoPrompt(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(enhancedPrompt)}?${new URLSearchParams({
      width: String(width),
      height: String(height),
      seed: String(seed),
      nologo: "true",
      private: "true",
      safe: "true"
    })}`;
    const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(120000) });

    if (!imageResponse.ok) {
      sendJson(res, 502, { error: "The image provider did not return an image." });
      return;
    }

    const contentType = imageResponse.headers.get("content-type") || "image/jpeg";
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    sendJson(res, 200, {
      imageUrl,
      image: `data:${contentType};base64,${imageBuffer.toString("base64")}`,
      provider: "Pollinations",
      prompt: enhancedPrompt,
      seed
    });
  } catch (error) {
    sendJson(res, 500, {
      error: "Could not create the image URL.",
      detail: error.message
    });
  }
}

async function handleChatStream(req, res) {
  try {
    const body = await readRequestBody(req);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const model = body.model || DEFAULT_MODEL;
    const demo = body.demo === true;

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    if (demo) {
      for (const word of demoReply(messages).split(/(\s+)/)) {
        sendStreamEvent(res, "token", { content: word });
      }
      sendStreamEvent(res, "done", { provider: "demo" });
      res.end();
      return;
    }

    const ollamaResponse = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        options: {
          temperature: 0.7,
          num_ctx: 4096
        }
      })
    });

    if (!ollamaResponse.ok || !ollamaResponse.body) {
      const detail = await ollamaResponse.text();
      sendStreamEvent(res, "error", {
        error: "Ollama did not return a valid stream.",
        detail
      });
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of ollamaResponse.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const data = JSON.parse(line);
        const content = data.message?.content || "";
        if (content) sendStreamEvent(res, "token", { content });
        if (data.done) sendStreamEvent(res, "done", { provider: "ollama", model });
      }
    }

    res.end();
  } catch (error) {
    if (!res.headersSent) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache"
      });
    }
    sendStreamEvent(res, "error", {
      error: "Could not reach the local model server.",
      detail: error.message
    });
    res.end();
  }
}

async function handleChat(req, res) {
  try {
    const body = await readRequestBody(req);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const model = body.model || DEFAULT_MODEL;
    const demo = body.demo === true;

    if (demo) {
      sendJson(res, 200, { content: demoReply(messages), provider: "demo" });
      return;
    }

    const ollamaResponse = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: 0.7,
          num_ctx: 4096
        }
      })
    });

    if (!ollamaResponse.ok) {
      const detail = await ollamaResponse.text();
      sendJson(res, 502, {
        error: "Ollama did not return a valid response.",
        detail
      });
      return;
    }

    const result = await ollamaResponse.json();
    sendJson(res, 200, {
      content: result.message?.content || "",
      provider: "ollama",
      model
    });
  } catch (error) {
    sendJson(res, 503, {
      error: "Could not reach the local model server.",
      detail: error.message
    });
  }
}

async function handleStatic(req, res) {
  const requestedPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const safePath = normalize(requestedPath === "/" ? "/index.html" : requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/images/generate") {
    handleGenerateImage(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/api/models") {
    handleModels(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/files/extract") {
    handleExtractFile(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat/stream") {
    handleChatStream(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    handleChat(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    handleStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`Chatbot running at http://localhost:${PORT}`);
  console.log(`Ollama target: ${OLLAMA_URL} (${DEFAULT_MODEL})`);
});
