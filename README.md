# Voice Bot Widget 🎙️

A **Siri-like voice assistant widget** that can be embedded into any webpage as a plug-and-play component. Fully voice-driven — no chat UI, just a beautiful animated orb.

![Demo](https://img.shields.io/badge/status-ready-brightgreen)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)

---

## ✨ Features

- **Voice-first UI** — animated orb (no chat window), Siri-style interaction
- **Natural conversation** — speech recognition + AI-generated spoken responses
- **Interruption support** — tap the orb to interrupt the bot mid-sentence
- **Knowledge base** — drop PDF, DOCX, or Markdown files into a folder
- **Plug-and-play** — embed with a single `<script>` tag
- **Auto-listen** — bot automatically listens after responding

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
cd voice-bot-widget
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and add your **OpenAI API key**:

```
OPENAI_API_KEY=sk-xxxxx
```

### 3. Add Knowledge Base Files

Place your files in `server/knowledge-base/`:

```
server/knowledge-base/
├── product-docs.pdf
├── faq.md
└── policies.docx
```

### 4. Start

```bash
npm start
```

Open [http://localhost:3800](http://localhost:3800) — click the microphone button and start talking!

---

## 📦 Embed in Your Website

Add two lines to any HTML page:

```html
<script src="https://your-server.com/widget/voice-bot.js"></script>
<script>
  VoiceBot.init({
    serverUrl: 'https://your-server.com',
    position: 'bottom-right',   // bottom-right | bottom-left | bottom-center
    greeting: 'Hi! How can I help?',
    lang: 'en-US',
  });
</script>
```

### Configuration Options

| Option      | Default          | Description                      |
|-------------|------------------|----------------------------------|
| `serverUrl` | `''`             | Backend URL (required)           |
| `position`  | `'bottom-right'` | Widget button position           |
| `greeting`  | `'Hi there…'`    | First message the bot speaks     |
| `lang`      | `'en-US'`        | Speech recognition language      |
| `size`      | `64`             | Trigger button size (px)         |

---

## 📚 Knowledge Base

The bot reads files from `server/knowledge-base/` on startup.

**Supported formats:**
- `.pdf` — Product manuals, reports
- `.docx` — Business documents, policies
- `.md` — Technical docs, FAQs

**Hot-reload** without restarting:

```bash
curl http://localhost:3800/api/kb/reload
```

---

## 🏗 Architecture

```
voice-bot-widget/
├── server/
│   ├── index.js                # Express server
│   ├── services/
│   │   ├── kb-processor.js     # Reads PDF/DOCX/MD, chunks text
│   │   ├── vector-store.js     # TF-IDF search (no external API)
│   │   └── ai-service.js       # OpenAI chat integration
│   └── knowledge-base/         # Drop your files here
├── public/
│   ├── index.html              # Demo page
│   └── widget/
│       └── voice-bot.js        # Self-contained embeddable widget
├── .env.example
└── package.json
```

---

## 🔌 API Endpoints

| Method | Endpoint          | Description               |
|--------|-------------------|---------------------------|
| POST   | `/api/chat`       | Send a message, get reply |
| GET    | `/api/health`     | Server status & KB info   |
| GET    | `/api/kb/reload`  | Reload knowledge base     |

---

## 🎨 How the Widget Works

1. User clicks the floating microphone button
2. A full-screen overlay opens with an animated orb
3. The bot greets the user with voice
4. User speaks → speech is transcribed via Web Speech API
5. Transcript is sent to the server → KB search + AI response
6. Response is spoken back with orb animation
7. User can interrupt anytime by tapping the orb

---

## ⚠ Browser Support

Speech recognition requires **Chrome**, **Edge**, or another Chromium-based browser. Safari has partial support. Firefox does not support the Web Speech API recognition.

---

## License

MIT
