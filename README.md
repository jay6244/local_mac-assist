# Local Chatbot For M3 8 GB

A lightweight browser chatbot that runs on your Mac and talks to Ollama locally.

## Run The App

```sh
npm start
```

Open:

```txt
http://localhost:3000
```

Demo mode is available as a fallback, but the app now defaults to your local Ollama model.

## Use A Local Model

For an M3 Mac with 8 GB memory, start with a smaller model:

```sh
ollama pull llama3.2:3b
ollama serve
```

Then turn off **Demo** in the app and send a message.

You already have this Ollama model installed:

```txt
gemma4:e4b
```

You can type that model name into the app's model field if you want to try it, but a 3B model is the safer first choice for 8 GB memory.

## What It Can Do Now

- Streams replies token-by-token from Ollama.
- Saves multiple chats in your browser.
- Lets you start a new chat without losing older conversations.
- Lets you rename, delete, export, and regenerate chats.
- Shows installed Ollama models in a picker.
- Includes Focus mode to hide the sidebar/top chrome.
- Adds chat-based non-explicit image generation with `/image your prompt`.
- Renders basic markdown, including inline code and fenced code blocks.
- Includes a stop button while the model is responding.
- Includes a copy button for assistant replies.
- Lets you attach local documents to a chat and ask questions from relevant extracted chunks.

## Document Uploads

Use **Attach** to add a local file to the current chat.

Supported formats:

- PDF
- DOCX
- TXT, Markdown, CSV, JSON
- Common code files

Files are processed by the local Node server. Extracted text is stored in your browser's local chat history and sent to Ollama only as part of that chat's prompt.

The app now uses a lightweight local RAG flow: it splits attached documents into chunks, searches for the chunks most relevant to your latest question, and asks the model to cite those snippets with labels like `[Source 1]`.

## Image Generation

Type an image request directly in chat:

```txt
/image cinematic photo of a futuristic desk assistant
```

The image settings panel controls size and negative prompt. It uses a cloud image URL provider, so image prompts are sent outside your Mac.

The app does not require ComfyUI for image generation now.
