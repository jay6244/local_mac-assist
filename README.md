# Local Chatbot For M3 8 GB

A lightweight browser chatbot that runs on your Mac, talks to Ollama for normal chat, and routes image requests automatically.

## Run The App

```sh
npm start
```

Open:

```txt
http://localhost:3000
```

Demo mode and advanced model/image settings live behind **Settings**. For everyday use, just type in the chat box.

## Use A Local Model

For an M3 Mac with 8 GB memory, start with a smaller model:

```sh
ollama pull llama3.2:3b
ollama serve
```

Then send a message. Normal questions use Ollama automatically.

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
- Lets you hide individual chats from the sidebar and reveal them with **Hidden**.
- Keeps model and image settings tucked behind **Settings** so the main screen behaves like one bot.
- Includes Focus mode to hide the sidebar/top chrome.
- Adds chat-based non-explicit image generation with `/image your prompt`, using Auto mode to try ComfyUI first and fall back to cloud.
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

You can also ask naturally, for example:

```txt
generate a realistic photo of a flying horse at golden hour
```

By default, image generation is on **Auto**:

- If ComfyUI is reachable at `http://127.0.0.1:8188`, the app uses it.
- If ComfyUI is not reachable, the app uses the cloud fallback.

Open **Settings** only when you want to change the chat model, image size, image engine, or Juggernaut XL checkpoint filename.

## Image Style References

Use **Attach** to upload a PNG, JPG, JPEG, or WebP image. The app saves it in the current chat as a style reference and reads simple local style notes such as composition, exposure, color temperature, and average color.

After attaching an image, ask for a new image normally:

```txt
generate a realistic photo in this same style
```

When ComfyUI is reachable, Auto mode uploads the reference image to ComfyUI and uses it in the image workflow. If Auto falls back to cloud generation, it uses the style notes from the reference image but cannot use the image pixels directly.
