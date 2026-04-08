/**
 * ╔══════════════════════════════════════════════════╗
 * ║       Voice Bot Widget — Siri-style Orb UI       ║
 * ║  Self-contained, plug-and-play voice assistant   ║
 * ╚══════════════════════════════════════════════════╝
 *
 * Usage:
 *   <script src="/widget/voice-bot.js"></script>
 *   <script>VoiceBot.init({ serverUrl: 'http://localhost:3800', apiKey: 'your-tenant-api-key' });</script>
 */

(function () {
  'use strict';

  /* ════════════════════════════════════════════════════
     §1  CONFIGURATION & CONSTANTS
     ════════════════════════════════════════════════════ */

  const DEFAULTS = {
    serverUrl: '',
    apiKey: '',                  // Tenant API key for multi-tenant isolation
    position: 'bottom-right', // bottom-right | bottom-left | bottom-center
    accentColor: '#5E5CE6',
    size: 64,
    greeting: 'Hi there! I\'m Vedaa. How can I help you?',
    lang: 'en-IN',             // Default to Indian English
    voiceGender: 'female',     // Prefer female voice
    languages: {               // Available languages for toggle
      'en-IN': { label: 'EN', name: 'English', greeting: 'Hi there! I\'m Vedaa. How can I help you?' },
      'hi-IN': { label: 'हिं', name: 'हिन्दी', greeting: 'नमस्ते! मैं वेदा हूँ। मैं आपकी कैसे मदद कर सकती हूँ?' },
    },
    wakeWord: 'hey vedaa',     // Wake word phrase to activate the bot
    wakeWordEnabled: true,      // Enable/disable wake word detection

    /* ── Deepgram Voice Agent ── */
    deepgramEnabled: false,     // true → use Deepgram Voice Agent (WS), false → browser SpeechRecognition/TTS
    deepgramApiKey: '',         // Deepgram API key (or leave blank & use server proxy /api/deepgram/token)
    deepgramSettings: null,     // Full Deepgram Settings JSON override (if null, uses built-in defaults)
  };

  const STATES = {
    IDLE: 'idle',
    LISTENING: 'listening',
    PROCESSING: 'processing',
    SPEAKING: 'speaking',
    ERROR: 'error',
  };

  /* ════════════════════════════════════════════════════
     §2  INJECT STYLES
     ════════════════════════════════════════════════════ */

  function injectStyles() {
    if (document.getElementById('vb-styles')) return;
    const style = document.createElement('style');
    style.id = 'vb-styles';
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');

      /* ── Reset ── */
      #vb-root, #vb-root * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }

      /* ══════════════════════════════════════
         LIGHT THEME OVERRIDES
         ══════════════════════════════════════ */
      #vb-root.vb-light #vb-overlay {
        background: radial-gradient(ellipse at 50% 40%, rgba(240, 238, 255, 0.99) 0%, rgba(248, 246, 252, 1) 100%);
      }
      #vb-root.vb-light #vb-status { color: rgba(30, 20, 60, 0.6); }
      #vb-root.vb-light #vb-status.vb-active { color: rgba(30, 20, 60, 0.9); }
      #vb-root.vb-light #vb-transcript { color: rgba(30, 20, 60, 0.5); }
      #vb-root.vb-light #vb-transcript.vb-highlight { color: rgba(30, 20, 60, 0.85); }
      #vb-root.vb-light #vb-transcript.vb-rich::-webkit-scrollbar-thumb { background: rgba(30, 20, 60, 0.15); }
      #vb-root.vb-light #vb-hint { color: rgba(30, 20, 60, 0.35); }
      #vb-root.vb-light #vb-hint span { border-color: rgba(30, 20, 60, 0.15); }

      /* Close / Notes / Lang buttons */
      #vb-root.vb-light #vb-close,
      #vb-root.vb-light #vb-notes-btn { background: rgba(30, 20, 60, 0.06); }
      #vb-root.vb-light #vb-close:hover { background: rgba(30, 20, 60, 0.12); }
      #vb-root.vb-light #vb-notes-btn:hover { background: rgba(30, 20, 60, 0.12); transform: scale(1.1) translateY(-4px); animation: none; }
      #vb-root.vb-light #vb-close svg { stroke: rgba(30, 20, 60, 0.55); }
      #vb-root.vb-light #vb-notes-btn svg { stroke: rgba(30, 20, 60, 0.55); }

      /* Theme toggle button */
      #vb-theme-toggle {
        position: absolute;
        top: 24px;
        right: 80px;
        width: 44px;
        height: 44px;
        border: none;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(10px);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.25s ease, transform 0.25s ease;
        z-index: 10;
      }
      #vb-theme-toggle:hover { background: rgba(255, 255, 255, 0.15); transform: scale(1.1); }
      #vb-theme-toggle svg { width: 18px; height: 18px; stroke: rgba(255,255,255,0.7); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform 0.3s ease; }
      #vb-theme-toggle .vb-icon-sun { display: none; }
      #vb-theme-toggle .vb-icon-moon { display: block; }

      /* Theme toggle — light mode overrides */
      #vb-root.vb-light #vb-theme-toggle { background: rgba(30, 20, 60, 0.06); }
      #vb-root.vb-light #vb-theme-toggle:hover { background: rgba(30, 20, 60, 0.12); }
      #vb-root.vb-light #vb-theme-toggle svg { stroke: rgba(30, 20, 60, 0.55); }
      #vb-root.vb-light #vb-theme-toggle .vb-icon-sun { display: block; }
      #vb-root.vb-light #vb-theme-toggle .vb-icon-moon { display: none; }

      /* Language toggle light */
      #vb-root.vb-light #vb-lang-toggle {
        background: rgba(30, 20, 60, 0.06);
      }
      #vb-root.vb-light #vb-lang-toggle:hover { background: rgba(30, 20, 60, 0.12); }
      #vb-root.vb-light #vb-lang-toggle svg { stroke: rgba(30, 20, 60, 0.55); }
      #vb-root.vb-light #vb-lang-label { background: rgba(94, 92, 230, 0.25); color: #5E5CE6; }

      /* Notes panel light */
      #vb-root.vb-light #vb-notes-panel {
        background: rgba(255, 255, 255, 0.97);
        border-color: rgba(30, 20, 60, 0.1);
      }
      #vb-root.vb-light #vb-notes-header { border-color: rgba(30, 20, 60, 0.08); }
      #vb-root.vb-light #vb-notes-header h3 { color: rgba(30, 20, 60, 0.85); }
      #vb-root.vb-light #vb-notes-close-panel { color: rgba(30, 20, 60, 0.4); }
      #vb-root.vb-light #vb-notes-close-panel:hover { background: rgba(30, 20, 60, 0.06); }
      #vb-root.vb-light .vb-note-text { color: rgba(30, 20, 60, 0.85); }
      #vb-root.vb-light .vb-note-time { color: rgba(30, 20, 60, 0.45); }
      #vb-root.vb-light .vb-note-delete { color: rgba(30, 20, 60, 0.4); }
      #vb-root.vb-light #vb-notes-empty { color: rgba(30, 20, 60, 0.35); }

      /* Error toast light */
      #vb-root.vb-light #vb-error {
        background: rgba(255, 55, 95, 0.1);
        border-color: rgba(255, 55, 95, 0.2);
      }

      /* Table display light (orb area) */
      #vb-root.vb-light .vb-table-container {
        background: rgba(30, 20, 60, 0.02);
        border-color: rgba(30, 20, 60, 0.08);
      }
      #vb-root.vb-light #vb-table-display table { color: rgba(30, 20, 60, 0.8); background: rgba(30, 20, 60, 0.01); }
      #vb-root.vb-light #vb-table-display thead th {
        background: rgba(94, 92, 230, 0.1);
        color: rgba(30, 20, 60, 0.8);
        border-color: rgba(30, 20, 60, 0.08);
      }
      #vb-root.vb-light #vb-table-display tbody td { border-color: rgba(30, 20, 60, 0.06); }
      #vb-root.vb-light #vb-table-display tbody tr:hover { background: rgba(94, 92, 230, 0.06); }
      #vb-root.vb-light #vb-table-display .vb-td-label { color: rgba(30, 20, 60, 0.6); }
      #vb-root.vb-light #vb-table-display .vb-td-count { color: rgba(30, 20, 60, 0.35); }
      #vb-root.vb-light .vb-table-scroll::-webkit-scrollbar-thumb { background: rgba(30, 20, 60, 0.12); }

      /* Content area scrollbar light */
      #vb-root.vb-light #vb-content-area { scrollbar-color: rgba(30,20,60,0.12) transparent; }
      #vb-root.vb-light #vb-content-area::-webkit-scrollbar-thumb { background: rgba(30,20,60,0.12); }

      /* Charts light */
      #vb-root.vb-light .vb-chart-container {
        background: linear-gradient(180deg, rgba(0,200,117,0.04) 0%, rgba(255,255,255,0.97) 20%, rgba(250,252,250,0.99) 100%);
        border-color: rgba(0, 200, 117, 0.15);
        box-shadow: 0 2px 12px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,200,117,0.08);
      }
      #vb-root.vb-light .vb-chart-container::before {
        background: linear-gradient(135deg, rgba(0,200,117,0.04), rgba(0,230,180,0.02), transparent 60%);
      }
      #vb-root.vb-light .vb-chart-label { color: rgba(0, 130, 76, 0.85); }
      #vb-root.vb-light .vb-chart-type-btn {
        border-color: rgba(0, 200, 117, 0.15);
        background: rgba(0, 200, 117, 0.04);
        color: rgba(30, 30, 30, 0.6);
      }
      #vb-root.vb-light .vb-chart-type-btn:hover {
        background: rgba(0, 200, 117, 0.1);
        border-color: rgba(0, 200, 117, 0.3);
        color: rgba(30, 30, 30, 0.85);
      }
      #vb-root.vb-light .vb-chart-type-btn.active {
        background: linear-gradient(135deg, rgba(0, 200, 117, 0.15), rgba(0, 230, 180, 0.1));
        border-color: rgba(0, 200, 117, 0.4);
        color: #5E5CE6;
      }

      /* Chat toggle button light */
      #vb-root.vb-light #vb-chat-toggle { background: rgba(30, 20, 60, 0.06); }
      #vb-root.vb-light #vb-chat-toggle:hover { background: rgba(30, 20, 60, 0.1); }
      #vb-root.vb-light #vb-chat-toggle svg { stroke: rgba(30, 20, 60, 0.55); }
      #vb-root.vb-light #vb-chat-toggle.vb-chat-open { background: rgba(94, 92, 230, 0.15); }
      #vb-root.vb-light #vb-chat-toggle.vb-chat-open svg { stroke: #5E5CE6; }

      /* Chat panel light */
      #vb-root.vb-light #vb-chat-panel.vb-visible {
        box-shadow: -12px 0 60px rgba(0,0,0,0.15);
      }
      #vb-root.vb-light #vb-chat-panel {
        background: rgba(255, 255, 255, 0.99);
        border-left-color: rgba(30, 20, 60, 0.08);
      }
      #vb-root.vb-light .vb-chat-resize-handle:hover,
      #vb-root.vb-light .vb-chat-resize-handle.vb-dragging {
        background: rgba(94, 92, 230, 0.25);
      }
      #vb-root.vb-light #vb-chat-header { background: rgba(30, 20, 60, 0.02); border-color: rgba(30, 20, 60, 0.06); }
      #vb-root.vb-light #vb-chat-header h4 { color: rgba(30, 20, 60, 0.9); }
      #vb-root.vb-light .vb-chat-header-text span { color: rgba(30, 20, 60, 0.45); }
      #vb-root.vb-light .vb-chat-status-dot { border-color: #fff; }
      #vb-root.vb-light #vb-chat-minimize { background: rgba(30, 20, 60, 0.04); }
      #vb-root.vb-light #vb-chat-minimize:hover { background: rgba(30, 20, 60, 0.08); }
      #vb-root.vb-light #vb-chat-minimize svg { stroke: rgba(30, 20, 60, 0.45); }
      #vb-root.vb-light #vb-chat-fullscreen { background: rgba(30, 20, 60, 0.04); }
      #vb-root.vb-light #vb-chat-fullscreen:hover { background: rgba(30, 20, 60, 0.08); }
      #vb-root.vb-light #vb-chat-fullscreen svg { stroke: rgba(30, 20, 60, 0.45); }

      /* Chat messages light */
      #vb-root.vb-light #vb-chat-messages::-webkit-scrollbar-thumb { background: rgba(30, 20, 60, 0.06); }
      #vb-root.vb-light .vb-msg-row-bot {
        border-bottom-color: transparent;
      }
      #vb-root.vb-light .vb-msg-row-user {
        background: transparent;
      }
      #vb-root.vb-light .vb-msg-row-bot .vb-msg-body {
        background: transparent; /* No bubble for light mode bot either */
        border: none;
      }
      #vb-root.vb-light .vb-msg-row-user .vb-msg-body {
        background: rgba(0, 0, 0, 0.05); /* very light grey typical of Gemini */
        border: none;
        width: fit-content;
        flex: 0 1 auto;
        padding: 12px 18px;
        box-sizing: border-box;
      }
      #vb-root.vb-light .vb-msg-avatar {
        background: transparent;
      }
      #vb-root.vb-light .vb-msg-row-user .vb-msg-avatar {
        background: rgba(94, 92, 230, 0.15);
      }
      #vb-root.vb-light .vb-msg-avatar svg { stroke: rgba(94, 92, 230, 0.6); }
      #vb-root.vb-light .vb-msg-row-user .vb-msg-avatar svg { stroke: #5E5CE6; }
      #vb-root.vb-light .vb-msg-text { color: rgba(30, 20, 60, 0.85); }
      #vb-root.vb-light .vb-msg-row-user .vb-msg-text { color: rgba(30, 20, 60, 0.95); }
      #vb-root.vb-light .vb-msg-time { color: rgba(30, 20, 60, 0.35); }
      #vb-root.vb-light .vb-msg-timing { color: rgba(30, 20, 60, 0.40); }
      #vb-root.vb-light .vb-msg-timing .vb-timing-detail { color: rgba(30, 20, 60, 0.25); }
      #vb-root.vb-light .vb-timing-badge { color: rgba(30, 20, 60, 0.45); }
      #vb-root.vb-light .vb-timing-badge .vb-timing-detail { color: rgba(30, 20, 60, 0.28); }
      /* Hide elements not in Gemini style */
      #vb-root.vb-light .vb-msg-typing-wave span { background: rgba(94, 92, 230, 0.35); }
      #vb-root.vb-light .vb-msg-source { color: #5E5CE6; background: rgba(94,92,230,0.06); }
      #vb-root.vb-light .vb-msg-source:hover { background: rgba(94,92,230,0.12); color: #4a48c8; }
      #vb-root.vb-light .vb-tool-details-inner { background: rgba(94,92,230,0.03); border-color: rgba(94,92,230,0.08); }
      #vb-root.vb-light .vb-tool-call-args { background: rgba(94,92,230,0.04); color: rgba(30,20,60,0.7); border-left-color: rgba(94,92,230,0.2); }
      #vb-root.vb-light .vb-tool-call-name { color: #5E5CE6; }
      #vb-root.vb-light .vb-tool-call-divider { border-top-color: rgba(30,20,60,0.06); }

      /* Chat message tables light */
      #vb-root.vb-light .vb-msg-text table th {
        background: rgba(94, 92, 230, 0.06);
        color: rgba(30, 20, 60, 0.7);
        border-color: rgba(30, 20, 60, 0.06);
      }
      #vb-root.vb-light .vb-msg-text table td {
        color: rgba(30, 20, 60, 0.65);
        border-color: rgba(30, 20, 60, 0.04);
      }
      #vb-root.vb-light .vb-msg-text table tr:hover td { background: rgba(94,92,230,0.03); }
      #vb-root.vb-light .vb-table-wrap { border-color: rgba(30, 20, 60, 0.08); }
      #vb-root.vb-light .vb-table-wrap::-webkit-scrollbar-thumb { background: rgba(30, 20, 60, 0.1); }

      /* Chat input light */
      #vb-root.vb-light #vb-chat-input-bar {
        background: rgba(255, 255, 255, 0.85);
        border-color: rgba(30, 20, 60, 0.08);
        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
      }
      #vb-root.vb-light #vb-chat-input-bar:focus-within {
        border-color: rgba(94, 92, 230, 0.45);
        box-shadow: 0 10px 40px rgba(94, 92, 230, 0.15);
      }
      #vb-root.vb-light #vb-chat-input {
        background: transparent;
        border: none;
        color: rgba(30, 20, 60, 0.9);
        box-shadow: none;
      }
      #vb-root.vb-light #vb-chat-input::placeholder { color: rgba(30, 20, 60, 0.35); }
      #vb-root.vb-light #vb-chat-input:focus {
        box-shadow: none;
        background: transparent;
        border-color: transparent;
      }
      #vb-root.vb-light #vb-chat-mic { background: rgba(30, 20, 60, 0.04); }
      #vb-root.vb-light #vb-chat-mic:hover { background: rgba(30, 20, 60, 0.08); }
      #vb-root.vb-light #vb-chat-mic svg { stroke: rgba(30, 20, 60, 0.5); }
      #vb-root.vb-light #vb-chat-mic.vb-mic-active svg { stroke: #FF375F; }

      /* List items inside messages — light */
      #vb-root.vb-light .vb-msg-text li { color: rgba(30, 20, 60, 0.7) !important; }

      /* Mini orb / mini transcript light */
      #vb-root.vb-light #vb-mini-transcript {
        background: rgba(255, 255, 255, 0.97);
        box-shadow: 0 4px 20px rgba(0,0,0,0.08);
      }
      #vb-root.vb-light #vb-mini-transcript-status { color: rgba(30, 20, 60, 0.45); }
      #vb-root.vb-light #vb-mini-transcript-text { color: rgba(30, 20, 60, 0.8); }
      #vb-root.vb-light #vb-mini-transcript-text.vb-listening { color: #5E5CE6; }

      /* Wake indicator light */
      #vb-root.vb-light #vb-wake-indicator {
        background: rgba(255, 255, 255, 0.9);
        border-color: rgba(30, 20, 60, 0.08);
      }
      #vb-root.vb-light #vb-wake-label { color: rgba(30, 20, 60, 0.4); }
      #vb-root.vb-light #vb-wake-indicator.vb-heard #vb-wake-label { color: rgba(30, 20, 60, 0.8); }

      /* Training indicator — stays red, just update border */
      #vb-root.vb-light #vb-training-indicator {
        box-shadow: 0 4px 20px rgba(255, 55, 95, 0.25);
      }

      /* ── Trigger Button ── */
      #vb-trigger {
        position: fixed;
        z-index: 99999;
        width: var(--vb-size);
        height: var(--vb-size);
        border: none;
        border-radius: 50%;
        cursor: pointer;
        background: linear-gradient(135deg, #5E5CE6 0%, #BF5AF2 50%, #FF375F 100%);
        box-shadow: 0 4px 24px rgba(94, 92, 230, 0.45), 0 0 0 0 rgba(94, 92, 230, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease;
        animation: vb-pulse-ring 2.5s ease-in-out infinite;
      }
      #vb-trigger:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 32px rgba(94, 92, 230, 0.6), 0 0 0 0 rgba(94, 92, 230, 0.4);
      }
      #vb-trigger:active { transform: scale(0.95); }
      #vb-trigger svg { width: 28px; height: 28px; fill: #fff; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.2)); }
      #vb-trigger.vb-hidden { transform: scale(0); pointer-events: none; }

      @keyframes vb-pulse-ring {
        0%, 100% { box-shadow: 0 4px 24px rgba(94, 92, 230, 0.45), 0 0 0 0 rgba(94, 92, 230, 0.25); }
        50% { box-shadow: 0 4px 24px rgba(94, 92, 230, 0.45), 0 0 0 12px rgba(94, 92, 230, 0); }
      }

      /* ── Wake Word Listening Indicator ── */
      #vb-wake-indicator {
        position: fixed;
        z-index: 99998;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 14px 6px 10px;
        border-radius: 20px;
        background: rgba(18, 11, 30, 0.85);
        border: 1px solid rgba(94, 92, 230, 0.2);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.4s ease, transform 0.4s ease;
        pointer-events: none;
      }
      #vb-wake-indicator.vb-active {
        opacity: 1;
        transform: translateY(0);
      }
      #vb-wake-indicator.vb-pos-bottom-right  { bottom: 96px; right: 24px; }
      #vb-wake-indicator.vb-pos-bottom-left   { bottom: 96px; left: 24px; }
      #vb-wake-indicator.vb-pos-bottom-center { bottom: 96px; left: 50%; transform: translateX(-50%); }
      #vb-wake-indicator.vb-pos-bottom-center.vb-active { transform: translateX(-50%) translateY(0); }

      #vb-wake-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #30D158;
        box-shadow: 0 0 6px rgba(48, 209, 88, 0.6);
        animation: vb-wake-blink 1.8s ease-in-out infinite;
      }
      @keyframes vb-wake-blink {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.8); }
      }
      #vb-wake-indicator.vb-heard #vb-wake-dot {
        background: #5E5CE6;
        box-shadow: 0 0 10px rgba(94, 92, 230, 0.8);
        animation: vb-wake-heard 0.4s ease;
      }
      @keyframes vb-wake-heard {
        0% { transform: scale(1); }
        50% { transform: scale(1.8); }
        100% { transform: scale(1); }
      }
      #vb-wake-label {
        font-size: 11px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.5);
        letter-spacing: 0.3px;
        white-space: nowrap;
      }
      #vb-wake-indicator.vb-heard #vb-wake-label {
        color: rgba(255, 255, 255, 0.9);
      }

      /* ── Position variants ── */
      #vb-trigger.vb-pos-bottom-right  { bottom: 24px; right: 24px; }
      #vb-trigger.vb-pos-bottom-left   { bottom: 24px; left: 24px; }
      #vb-trigger.vb-pos-bottom-center { bottom: 24px; left: 50%; transform: translateX(-50%); }
      #vb-trigger.vb-pos-bottom-center:hover { transform: translateX(-50%) scale(1.1); }
      #vb-trigger.vb-pos-bottom-center.vb-hidden { transform: translateX(-50%) scale(0); }

      /* ── Mini Orb (replaces trigger button in voice mode) ── */
      #vb-mini-orb {
        position: fixed;
        width: 120px;
        height: 120px;
        z-index: 99999;
        opacity: 0;
        visibility: hidden;
        transform: scale(0);
        transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        border-radius: 50%;
        background: radial-gradient(ellipse at center, rgba(30, 20, 60, 0.15) 0%, rgba(8, 4, 20, 0.05) 100%);
        backdrop-filter: blur(8px);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      }
      #vb-mini-orb.vb-show {
        opacity: 1;
        visibility: visible;
        transform: scale(1);
      }
      #vb-mini-orb.vb-pos-bottom-right  { bottom: 24px; right: 24px; }
      #vb-mini-orb.vb-pos-bottom-left   { bottom: 24px; left: 24px; }
      #vb-mini-orb.vb-pos-bottom-center { bottom: 24px; left: 50%; transform: translateX(-50%) scale(0); }
      #vb-mini-orb.vb-pos-bottom-center.vb-show { transform: translateX(-50%) scale(1); }
      #vb-mini-orb canvas {
        width: 100%;
        height: 100%;
        cursor: pointer;
        border-radius: 50%;
      }

      /* ── Mini Transcript (appears above mini orb) ── */
      #vb-mini-transcript {
        position: fixed;
        bottom: 115px;
        padding: 16px 24px;
        background: rgba(20, 20, 40, 0.95);
        backdrop-filter: blur(20px);
        border-radius: 16px;
        max-width: 400px;
        min-width: 200px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
        z-index: 99998;
        opacity: 0;
        visibility: hidden;
        transform: translateY(10px);
        transition: all 0.3s ease;
      }
      #vb-mini-transcript.vb-show {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }
      #vb-mini-transcript.vb-pos-bottom-right  { right: 24px; }
      #vb-mini-transcript.vb-pos-bottom-left   { left: 24px; }
      #vb-mini-transcript.vb-pos-bottom-center { left: 50%; transform: translateX(-50%) translateY(10px); }
      #vb-mini-transcript.vb-pos-bottom-center.vb-show { transform: translateX(-50%) translateY(0); }
      #vb-mini-transcript-status {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.5);
        text-align: center;
        margin-bottom: 6px;
        text-transform: uppercase;
        letter-spacing: 1px;
        font-weight: 600;
      }
      #vb-mini-transcript-text {
        font-size: 15px;
        color: rgba(255, 255, 255, 0.9);
        text-align: center;
        line-height: 1.4;
      }
      #vb-mini-transcript-text.vb-listening {
        color: rgba(138, 96, 255, 0.9);
      }

      /* ── Position variants ── */
      #vb-overlay {
        position: fixed;
        inset: 0;
        z-index: 100000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        padding-top: 20px;
        padding-bottom: 80px;
        background: radial-gradient(ellipse at 50% 40%, rgba(30, 20, 60, 0.97) 0%, rgba(8, 4, 20, 0.99) 100%);
        backdrop-filter: blur(40px) saturate(1.4);
        -webkit-backdrop-filter: blur(40px) saturate(1.4);
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.4s ease, visibility 0.4s ease, padding-right 0.5s cubic-bezier(0.25, 1, 0.2, 1);
        overflow: hidden;
      }
      #vb-overlay.vb-visible { opacity: 1; visibility: visible; }
      /* Shift overlay content when chat panel is open */
      #vb-overlay.vb-chat-shifted {
        padding-right: var(--vb-chat-w, 420px);
      }
      @media (max-width: 900px) {
        #vb-overlay.vb-chat-shifted { padding-right: var(--vb-chat-w, 360px); }
      }
      @media (max-width: 600px) {
        #vb-overlay.vb-chat-shifted { padding-right: 0; }
      }

      /* ── Canvas (orb) ── */
      #vb-canvas {
        width: 280px;
        height: 280px;
        border-radius: 50%;
        filter: contrast(1.05) brightness(1.05);
        flex-shrink: 0;
      }

      /* ── Status Text ── */
      #vb-status {
        font-size: 16px;
        font-weight: 500;
        letter-spacing: 0.6px;
        color: rgba(255, 255, 255, 0.7);
        text-align: center;
        min-height: 24px;
        transition: color 0.3s ease;
        flex-shrink: 0;
        margin-top: 4px;
      }
      #vb-status.vb-active { color: rgba(255, 255, 255, 0.95); }

      /* ── Scrollable Content Area (transcript + tables + charts) ── */
      #vb-content-area {
        display: flex;
        flex-direction: column;
        align-items: center;
        max-width: 860px;
        width: 100%;
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 8px 24px 24px;
        margin-top: 8px;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,0.2) transparent;
      }
      #vb-content-area::-webkit-scrollbar { width: 5px; }
      #vb-content-area::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
      #vb-content-area::-webkit-scrollbar-track { background: transparent; }

      /* ── Transcript ── */
      #vb-transcript {
        font-size: 18px;
        font-weight: 300;
        color: rgba(255, 255, 255, 0.55);
        text-align: center;
        max-width: min(90vw, 600px);
        width: 100%;
        min-height: 28px;
        line-height: 1.5;
        transition: color 0.3s ease;
        padding: 0;
        word-break: break-word;
        flex-shrink: 0;
      }
      #vb-transcript:empty { min-height: 0; }
      #vb-transcript.vb-highlight { color: rgba(255, 255, 255, 0.9); }

      /* Rich transcript (code blocks / tables inside transcript area) */
      #vb-transcript.vb-rich {
        text-align: left;
        max-height: 55vh;
        overflow-y: auto;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,255,255,0.15) transparent;
      }
      #vb-transcript.vb-rich::-webkit-scrollbar { width: 5px; }
      #vb-transcript.vb-rich::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
      #vb-transcript.vb-rich::-webkit-scrollbar-track { background: transparent; }

      /* ── Table Display (inside content area) ── */
      #vb-table-display {
        max-width: 800px;
        width: 100%;
        margin-top: 16px;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      #vb-table-display:empty { display: none; }
      
      .vb-table-container {
        width: 100%;
        background: rgba(255,255,255,0.02);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px;
        padding: 12px;
        margin-bottom: 12px;
      }
      .vb-table-scroll {
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
      .vb-table-scroll::-webkit-scrollbar { height: 6px; }
      .vb-table-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }

      #vb-table-display table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        color: rgba(255,255,255,0.85);
        background: rgba(255,255,255,0.02);
        border-radius: 8px;
        overflow: hidden;
      }
      #vb-table-display thead th {
        background: rgba(138,96,255,0.25);
        color: rgba(255,255,255,0.95);
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: 10px 12px;
        text-align: left;
        border-bottom: 1px solid rgba(255,255,255,0.1);
        white-space: nowrap;
      }
      #vb-table-display tbody td {
        padding: 8px 12px;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        white-space: nowrap;
      }
      #vb-table-display tbody tr:hover {
        background: rgba(138,96,255,0.1);
      }
      #vb-table-display tbody tr:last-child td { border-bottom: none; }

      /* Stock Market Table Theme */
      .vb-stock-table table {
        background: rgba(0, 200, 117, 0.02);
        border: 1px solid rgba(0, 200, 117, 0.1);
      }
      .vb-stock-table thead th {
        background: linear-gradient(135deg, rgba(0, 200, 117, 0.2), rgba(0, 180, 100, 0.15));
        color: rgba(255, 255, 255, 0.95);
        border-bottom: 1px solid rgba(0, 200, 117, 0.2);
        font-size: 10px;
        letter-spacing: 0.8px;
      }
      .vb-stock-table tbody td {
        font-family: 'SF Mono', 'Fira Code', 'Menlo', monospace;
        font-size: 12px;
        border-bottom: 1px solid rgba(0, 200, 117, 0.06);
      }
      .vb-stock-table tbody tr:hover {
        background: rgba(0, 200, 117, 0.08);
      }
      #vb-root.vb-light .vb-stock-table table {
        background: rgba(0, 200, 117, 0.02);
        border-color: rgba(0, 200, 117, 0.12);
      }
      #vb-root.vb-light .vb-stock-table thead th {
        background: linear-gradient(135deg, rgba(0, 200, 117, 0.12), rgba(0, 180, 100, 0.08));
        color: rgba(20, 40, 30, 0.9);
        border-bottom-color: rgba(0, 200, 117, 0.15);
      }
      #vb-root.vb-light .vb-stock-table tbody tr:hover {
        background: rgba(0, 200, 117, 0.06);
      }
      #vb-table-display .vb-td-label {
        font-size: 13px;
        font-weight: 600;
        color: rgba(255,255,255,0.7);
        margin-bottom: 6px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      #vb-table-display .vb-td-count {
        font-size: 11px;
        color: rgba(255,255,255,0.35);
        text-align: right;
        margin-top: 4px;
      }

      /* ── Chart Display (Stock Market Theme) ── */
      .vb-chart-container {
        width: 100%;
        background: linear-gradient(180deg, rgba(0,200,117,0.04) 0%, rgba(10,10,20,0.95) 20%, rgba(10,10,20,0.98) 100%);
        border: 1px solid rgba(0, 200, 117, 0.15);
        border-radius: 16px;
        padding: 16px;
        animation: vb-chart-in 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.15) backwards;
        position: relative;
        overflow: hidden;
        box-shadow: 0 0 20px rgba(0, 200, 117, 0.06), inset 0 1px 0 rgba(0, 200, 117, 0.1);
      }
      .vb-chart-container::before {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(135deg, rgba(0,200,117,0.06), rgba(0,230,180,0.03), transparent 60%);
        pointer-events: none;
        border-radius: 16px;
      }
      @keyframes vb-chart-in {
        from { opacity: 0; transform: translateY(16px) scale(0.96); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      .vb-chart-container canvas {
        max-width: 100%;
        max-height: 320px;
        position: relative;
        z-index: 1;
      }
      .vb-chart-label {
        font-size: 13px;
        font-weight: 600;
        color: rgba(0, 200, 117, 0.9);
        margin-bottom: 10px;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        position: relative;
        z-index: 1;
      }
      .vb-chart-toolbar {
        display: flex;
        gap: 6px;
        margin-bottom: 10px;
        flex-wrap: wrap;
        position: relative;
        z-index: 1;
      }
      .vb-chart-type-btn {
        padding: 4px 12px;
        border: 1px solid rgba(0, 200, 117, 0.15);
        border-radius: 14px;
        background: rgba(0, 200, 117, 0.05);
        color: rgba(255,255,255,0.6);
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.25s ease;
        font-family: inherit;
      }
      .vb-chart-type-btn:hover {
        background: rgba(0, 200, 117, 0.15);
        border-color: rgba(0, 200, 117, 0.35);
        color: rgba(255,255,255,0.9);
      }
      .vb-chart-type-btn.active {
        background: linear-gradient(135deg, rgba(0, 200, 117, 0.25), rgba(0, 230, 180, 0.15));
        border-color: rgba(0, 200, 117, 0.5);
        color: #fff;
        box-shadow: 0 0 8px rgba(0, 200, 117, 0.2);
      }

      /* Chart inside chat message */
      .vb-msg-text .vb-chart-container {
        margin-top: 8px;
        padding: 12px;
      }
      .vb-msg-text .vb-chart-container canvas {
        max-height: 220px;
      }

      /* ── Close Button ── */
      #vb-close {
        position: absolute;
        top: 24px;
        right: 28px;
        width: 44px;
        height: 44px;
        border: none;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(10px);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.25s ease, transform 0.25s ease;
      }
      #vb-close:hover { background: rgba(255, 255, 255, 0.15); transform: scale(1.1); }
      #vb-close svg { width: 18px; height: 18px; stroke: rgba(255,255,255,0.7); stroke-width: 2.5; fill: none; }

      /* ── Language Toggle ── */
      #vb-lang-toggle {
        position: absolute;
        top: 24px;
        left: 28px;
        width: 44px;
        height: 44px;
        border: none;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(10px);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.25s ease, transform 0.25s ease;
        z-index: 10;
      }
      #vb-lang-toggle:hover { background: rgba(255, 255, 255, 0.15); transform: scale(1.1); }
      #vb-lang-toggle svg { width: 20px; height: 20px; stroke: rgba(255,255,255,0.7); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform 0.3s ease; }
      #vb-lang-toggle:hover svg { transform: rotate(15deg); }
      #vb-lang-label {
        position: absolute;
        bottom: -2px;
        right: -2px;
        min-width: 20px;
        height: 16px;
        border-radius: 8px;
        background: rgba(94, 92, 230, 0.7);
        color: #fff;
        font-size: 8px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 3px;
        letter-spacing: 0.3px;
        text-transform: uppercase;
        pointer-events: none;
      }

      /* ── Hint ── */
      #vb-hint {
        position: absolute;
        bottom: 40px;
        font-size: 13px;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.3);
        letter-spacing: 0.5px;
      }
      #vb-hint span {
        display: inline-block;
        padding: 4px 12px;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 20px;
        margin-left: 4px;
      }

      /* ── Error Toast ── */
      #vb-error {
        position: absolute;
        bottom: 80px;
        background: rgba(255, 55, 95, 0.15);
        border: 1px solid rgba(255, 55, 95, 0.3);
        border-radius: 12px;
        padding: 10px 20px;
        color: #FF375F;
        font-size: 13px;
        font-weight: 500;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity 0.3s ease, transform 0.3s ease;
        pointer-events: none;
      }
      #vb-error.vb-show { opacity: 1; transform: translateY(0); pointer-events: auto; }

      /* ── Responsive ── */
      @media (max-width: 480px) {
        #vb-overlay { padding-top: 60px; }
        #vb-canvas { width: 180px; height: 180px; }
        #vb-status { font-size: 14px; margin-top: 16px; }
        #vb-transcript { font-size: 15px; }
        #vb-content-area { padding: 4px 12px 16px; }
        #vb-notes-panel { width: 90vw; max-height: 60vh; }
      }

      /* ── Notes Panel ── */
      #vb-notes-btn {
        position: absolute;
        bottom: 24px;
        left: 28px;
        width: 48px;
        height: 48px;
        border: none;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(10px);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.25s ease, transform 0.25s ease;
        animation: vb-float 4s ease-in-out infinite;
        animation-delay: 0.5s; /* Offset from chat icon so they don't bounce identically */
      }
      #vb-notes-btn:hover {
        background: rgba(255, 255, 255, 0.15);
        transform: scale(1.1) translateY(-4px);
        animation: none;
      }
      #vb-notes-btn svg { width: 22px; height: 22px; fill: none; stroke: rgba(255,255,255,0.7); stroke-width: 2; transition: transform 0.3s ease; stroke-linecap: round; stroke-linejoin: round; }
      #vb-notes-btn:hover svg { transform: rotate(10deg); }
      #vb-notes-badge {
        position: absolute;
        top: -2px;
        right: -2px;
        min-width: 18px;
        height: 18px;
        border-radius: 9px;
        background: #5E5CE6;
        color: #fff;
        font-size: 10px;
        font-weight: 600;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 0 4px;
        line-height: 18px;
      }
      #vb-notes-badge.vb-visible { display: flex; }

      #vb-notes-panel {
        position: absolute;
        bottom: 80px;
        left: 28px;
        width: 340px;
        max-height: 65vh;
        background: rgba(18, 11, 30, 0.95);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        opacity: 0;
        visibility: hidden;
        transform: translateY(10px);
        transform-origin: bottom left;
        transition: opacity 0.3s ease, visibility 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        z-index: 100001;
        box-shadow: 10px 10px 40px rgba(0,0,0,0.2);
      }
      #vb-notes-panel.vb-visible {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }
      #vb-notes-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 14px 16px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      #vb-notes-header h3 {
        font-size: 14px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.9);
        letter-spacing: 0.3px;
      }
      #vb-notes-close-panel {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.5);
        cursor: pointer;
        font-size: 18px;
        padding: 2px 6px;
        border-radius: 6px;
        transition: background 0.2s;
      }
      #vb-notes-close-panel:hover { background: rgba(255,255,255,0.1); }
      #vb-notes-list {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      #vb-notes-list::-webkit-scrollbar { width: 4px; }
      #vb-notes-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
      .vb-note-item {
        margin-bottom: 0; /* Handled by gap */
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: stretch; /* Cards take full width */
      }
      .vb-note-body {
        background: rgba(255, 255, 255, 0.05); /* Card style */
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 16px;
        box-sizing: border-box;
        border-radius: 12px; /* Card border radius */
        width: 100%;
        max-width: 100%;
        transition: transform 0.2s, background 0.2s, box-shadow 0.2s;
        text-align: left;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      }
      #vb-root.vb-light .vb-note-body {
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid rgba(0, 0, 0, 0.08);
        box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      }
      .vb-note-body:hover {
        background: rgba(255, 255, 255, 0.08);
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0,0,0,0.15);
      }
      #vb-root.vb-light .vb-note-body:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0,0,0,0.08);
      }
      
      /* Note Card Colors (Repeated Sequence) */
      .vb-note-item:nth-child(5n+1) .vb-note-body { background: rgba(255, 99, 132, 0.1); border-color: rgba(255, 99, 132, 0.2); }
      .vb-note-item:nth-child(5n+2) .vb-note-body { background: rgba(54, 162, 235, 0.1); border-color: rgba(54, 162, 235, 0.2); }
      .vb-note-item:nth-child(5n+3) .vb-note-body { background: rgba(255, 206, 86, 0.1); border-color: rgba(255, 206, 86, 0.2); }
      .vb-note-item:nth-child(5n+4) .vb-note-body { background: rgba(75, 192, 192, 0.1); border-color: rgba(75, 192, 192, 0.2); }
      .vb-note-item:nth-child(5n+5) .vb-note-body { background: rgba(153, 102, 255, 0.1); border-color: rgba(153, 102, 255, 0.2); }
      
      .vb-note-item:nth-child(5n+1) .vb-note-body:hover { background: rgba(255, 99, 132, 0.15); }
      .vb-note-item:nth-child(5n+2) .vb-note-body:hover { background: rgba(54, 162, 235, 0.15); }
      .vb-note-item:nth-child(5n+3) .vb-note-body:hover { background: rgba(255, 206, 86, 0.15); }
      .vb-note-item:nth-child(5n+4) .vb-note-body:hover { background: rgba(75, 192, 192, 0.15); }
      .vb-note-item:nth-child(5n+5) .vb-note-body:hover { background: rgba(153, 102, 255, 0.15); }

      #vb-root.vb-light .vb-note-item:nth-child(5n+1) .vb-note-body { background: rgba(255, 99, 132, 0.08); border-color: rgba(255, 99, 132, 0.2); }
      #vb-root.vb-light .vb-note-item:nth-child(5n+2) .vb-note-body { background: rgba(54, 162, 235, 0.08); border-color: rgba(54, 162, 235, 0.2); }
      #vb-root.vb-light .vb-note-item:nth-child(5n+3) .vb-note-body { background: rgba(255, 206, 86, 0.08); border-color: rgba(255, 206, 86, 0.2); }
      #vb-root.vb-light .vb-note-item:nth-child(5n+4) .vb-note-body { background: rgba(75, 192, 192, 0.08); border-color: rgba(75, 192, 192, 0.2); }
      #vb-root.vb-light .vb-note-item:nth-child(5n+5) .vb-note-body { background: rgba(153, 102, 255, 0.08); border-color: rgba(153, 102, 255, 0.2); }

      #vb-root.vb-light .vb-note-item:nth-child(5n+1) .vb-note-body:hover { background: rgba(255, 99, 132, 0.12); }
      #vb-root.vb-light .vb-note-item:nth-child(5n+2) .vb-note-body:hover { background: rgba(54, 162, 235, 0.12); }
      #vb-root.vb-light .vb-note-item:nth-child(5n+3) .vb-note-body:hover { background: rgba(255, 206, 86, 0.12); }
      #vb-root.vb-light .vb-note-item:nth-child(5n+4) .vb-note-body:hover { background: rgba(75, 192, 192, 0.12); }
      #vb-root.vb-light .vb-note-item:nth-child(5n+5) .vb-note-body:hover { background: rgba(153, 102, 255, 0.12); }
      
      .vb-note-text {
        font-size: 13px;
        color: rgba(255, 255, 255, 0.85);
        line-height: 1.5;
        word-break: break-word;
      }
      .vb-note-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
      }
      #vb-root.vb-light .vb-note-meta {
        border-top-color: rgba(0, 0, 0, 0.05);
      }
      .vb-note-time {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.4);
      }
      .vb-note-delete {
        background: none;
        border: none;
        color: rgba(255, 255, 255, 0.5); /* Match muted aesthetic initially */
        cursor: pointer;
        padding: 4px;
        margin-left: 12px;
        border-radius: 4px;
        transition: color 0.2s, background 0.2s, transform 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .vb-note-delete svg {
        width: 14px;
        height: 14px;
      }
      .vb-note-delete:hover {
        background: rgba(255, 55, 95, 0.15); /* Red pill */
        color: #FF375F; /* Icon turns red */
        transform: scale(1.1);
      }
      #vb-notes-empty {
        padding: 24px 16px;
        text-align: center;
        color: rgba(255, 255, 255, 0.3);
        font-size: 13px;
      }
      #vb-notes-empty span { font-size: 24px; display: block; margin-bottom: 8px; }

      /* ── Note Saved Toast ── */
      #vb-note-toast {
        position: absolute;
        top: 24px;
        left: 50%;
        transform: translateX(-50%) translateY(-20px);
        padding: 8px 20px;
        border-radius: 20px;
        background: rgba(48, 209, 88, 0.15);
        border: 1px solid rgba(48, 209, 88, 0.3);
        color: #30D158;
        font-size: 13px;
        font-weight: 500;
        opacity: 0;
        transition: opacity 0.3s ease, transform 0.3s ease;
        pointer-events: none;
        z-index: 100002;
        white-space: nowrap;
      }
      #vb-note-toast.vb-show {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }

      /* ── Chat Panel — Right Side Drawer ── */
      #vb-chat-toggle {
        position: absolute;
        bottom: 24px;
        right: 28px;
        width: 48px;
        height: 48px;
        border: none;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(10px);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.25s ease, transform 0.25s ease;
        z-index: 10;
        animation: vb-float 4s ease-in-out infinite;
      }
      @keyframes vb-float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-6px); }
      }
      #vb-chat-toggle:hover { 
        background: rgba(255, 255, 255, 0.15); 
        transform: scale(1.1) translateY(-4px); 
        animation: none;
      }
      #vb-chat-toggle svg { width: 22px; height: 22px; stroke: rgba(255,255,255,0.7); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform 0.3s ease; }
      #vb-chat-toggle:hover svg { transform: rotate(10deg); }
      #vb-chat-toggle.vb-chat-open { 
        background: rgba(94, 92, 230, 0.4); 
        animation: none; 
        transform: scale(1);
      }
      #vb-chat-toggle.vb-chat-open svg { stroke: #fff; transform: rotate(0deg); }

      #vb-chat-panel {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: var(--vb-chat-w, 420px);
        min-width: 320px;
        max-width: 700px;
        transform: translateX(100%);
        background: rgba(10, 6, 20, 0.98);
        border-left: 1px solid rgba(255, 255, 255, 0.08);
        backdrop-filter: blur(40px);
        -webkit-backdrop-filter: blur(40px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: transform 0.5s cubic-bezier(0.25, 1, 0.2, 1), box-shadow 0.5s ease;
        z-index: 100001;
      }
      #vb-chat-panel.vb-visible {
        transform: translateX(0);
        box-shadow: -12px 0 60px rgba(0,0,0,0.4);
      }
      /* Resize handle — left edge of chat panel */
      .vb-chat-resize-handle {
        position: absolute;
        top: 0;
        left: -3px;
        width: 6px;
        height: 100%;
        cursor: col-resize;
        z-index: 10;
        transition: background 0.2s;
      }
      .vb-chat-resize-handle:hover,
      .vb-chat-resize-handle.vb-dragging {
        background: rgba(94, 92, 230, 0.4);
      }
      @media (max-width: 900px) {
        #vb-chat-panel { --vb-chat-w: 360px; min-width: 280px; }
      }
      @media (max-width: 600px) {
        #vb-chat-panel { width: 100vw !important; min-width: unset; max-width: unset; }
        .vb-chat-resize-handle { display: none; }
      }

      #vb-chat-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        flex-shrink: 0;
        background: rgba(255, 255, 255, 0.02);
      }
      .vb-chat-header-left {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .vb-chat-header-avatar {
        position: relative;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: linear-gradient(135deg, rgba(94,92,230,0.6), rgba(191,90,242,0.6));
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 10px rgba(191,90,242,0.3);
      }
      .vb-chat-header-avatar svg {
        width: 22px;
        height: 22px;
        stroke: #fff;
      }
      .vb-chat-status-dot {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 10px;
        height: 10px;
        background: #34C759;
        border: 2px solid rgba(10, 6, 20, 0.98);
        border-radius: 50%;
        animation: vb-pulse-green 2s infinite;
      }
      @keyframes vb-pulse-green {
        0% { box-shadow: 0 0 0 0 rgba(52, 199, 89, 0.7); }
        70% { box-shadow: 0 0 0 6px rgba(52, 199, 89, 0); }
        100% { box-shadow: 0 0 0 0 rgba(52, 199, 89, 0); }
      }
      .vb-chat-header-text {
        display: flex;
        flex-direction: column;
      }
      #vb-chat-header h4 {
        font-size: 16px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.95);
        letter-spacing: 0.3px;
        margin: 0 0 2px 0;
      }
      .vb-chat-header-text span {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.5);
        font-weight: 400;
      }
      #vb-chat-minimize {
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.06);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s, transform 0.2s;
      }
      #vb-chat-minimize:hover { 
        background: rgba(255, 255, 255, 0.12); 
        transform: rotate(90deg);
      }
      #vb-chat-minimize svg { width: 16px; height: 16px; stroke: rgba(255,255,255,0.5); fill: none; stroke-width: 2; }

      /* Chat header action buttons group */
      .vb-chat-header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      /* Fullscreen toggle button */
      #vb-chat-fullscreen {
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.06);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s, transform 0.2s;
      }
      #vb-chat-fullscreen:hover {
        background: rgba(255, 255, 255, 0.12);
        transform: scale(1.1);
      }
      #vb-chat-fullscreen svg { width: 15px; height: 15px; stroke: rgba(255,255,255,0.5); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      #vb-chat-fullscreen .vb-icon-collapse { display: none; }
      #vb-chat-panel.vb-chat-fullscreen #vb-chat-fullscreen .vb-icon-expand { display: none; }
      #vb-chat-panel.vb-chat-fullscreen #vb-chat-fullscreen .vb-icon-collapse { display: block; }

      /* Chat fullscreen mode */
      #vb-chat-panel.vb-chat-fullscreen {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 100% !important;
        border-left: none;
      }
      #vb-chat-panel.vb-chat-fullscreen .vb-chat-resize-handle { display: none; }
      #vb-chat-panel.vb-chat-fullscreen #vb-chat-messages {
        max-width: 900px;
        margin: 0 auto;
        width: 100%;
      }
      #vb-chat-panel.vb-chat-fullscreen #vb-chat-input-bar {
        max-width: 900px;
        margin: 0 auto 40px auto;
        width: 100%;
      }

      /* Messages area */
      #vb-chat-messages {
        flex: 1;
        overflow-y: auto;
        padding: 12px 0 24px 0; /* Add extra bottom padding for the pill input */
        display: flex;
        flex-direction: column;
        gap: 0;
        scroll-behavior: smooth;
      }
      #vb-chat-messages::-webkit-scrollbar { width: 5px; }
      #vb-chat-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
      #vb-chat-messages::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
      #vb-chat-messages::-webkit-scrollbar-track { background: transparent; }

      /* ── Gemini-style Clean Chat Messages ── */
      .vb-msg-row {
        display: flex;
        align-items: flex-start; /* Align to top like Gemini */
        gap: 16px; /* wider gap for avatar */
        padding: 12px 24px;
        animation: vb-msg-in 0.3s ease backwards;
        position: relative;
      }
      .vb-msg-row-bot {
        /* No specific row borders */
      }
      .vb-msg-row-user {
        flex-direction: row-reverse;
      }
      @keyframes vb-msg-in {
        from { opacity: 0; transform: translateY(16px) scale(0.98); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }

      /* Avatar */
      .vb-msg-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: transparent; /* No bubble for avatar */
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        margin-top: 2px;
      }
      .vb-msg-row-user .vb-msg-avatar {
        display: none; /* Gemini hides the user avatar in chat */
      }
      .vb-msg-avatar svg {
        width: 24px;
        height: 24px;
        stroke: rgba(191, 90, 242, 0.85); /* Sparkle-like color */
      }

      /* Message body */
      .vb-msg-body {
        flex: 1;
        min-width: 0;
        max-width: 90%;
        padding: 4px 0; /* Bot message has no background bubble, just text */
        border-radius: 0;
        background: transparent;
      }
      .vb-msg-row-user .vb-msg-body {
        text-align: left;
        background: rgba(255, 255, 255, 0.08); /* Clean user bubble */
        padding: 12px 18px;
        box-sizing: border-box;
        border-radius: 20px; /* Fully rounded user pill */
        max-width: 75%;
        width: fit-content;
        flex: 0 1 auto;
      }
      .vb-msg-sender {
        display: none; /* Gemini doesn't show sender names */
      }
      .vb-msg-text {
        font-size: 15px; /* Slightly larger, readable font */
        line-height: 1.6;
        color: rgba(255, 255, 255, 0.95);
        word-break: break-word;
        overflow-wrap: anywhere;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .vb-msg-text p { margin: 0 0 6px 0; }
      .vb-msg-text p:last-child { margin-bottom: 0; }
      .vb-msg-text ul, .vb-msg-text ol {
        margin: 6px 0;
        padding-left: 18px;
        overflow-wrap: anywhere;
      }
      .vb-msg-text li {
        margin-bottom: 3px;
        line-height: 1.5;
      }
      .vb-msg-row-user .vb-msg-text {
        color: rgba(255, 255, 255, 0.92);
      }
      .vb-msg-time {
        font-size: 10px;
        font-weight: 400;
        color: rgba(255, 255, 255, 0.22);
        margin-top: 4px;
        letter-spacing: 0.02em;
      }

      /* Latency badge — chat panel */
      .vb-msg-timing {
        font-size: 10px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.35);
        margin-top: 3px;
        letter-spacing: 0.02em;
        cursor: default;
      }
      .vb-msg-timing .vb-timing-detail {
        color: rgba(255, 255, 255, 0.22);
        font-weight: 400;
      }

      /* Latency badge — orb transcript */
      .vb-timing-badge {
        font-size: 11px;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.40);
        margin-top: 6px;
        text-align: center;
        cursor: default;
        letter-spacing: 0.02em;
      }
      .vb-timing-badge .vb-timing-detail {
        color: rgba(255, 255, 255, 0.22);
        font-weight: 400;
        font-size: 10px;
      }

      /* Peaceful thinking indicator */
      .vb-msg-typing {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 2px 0;
      }
      .vb-msg-typing-label {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.3);
        font-weight: 500;
        letter-spacing: 0.03em;
        font-style: italic;
      }
      .vb-msg-typing-wave {
        display: flex;
        align-items: center;
        gap: 3px;
        height: 16px;
      }
      .vb-msg-typing-wave span {
        width: 3px;
        height: 3px;
        border-radius: 2px;
        background: rgba(94, 92, 230, 0.45);
        animation: vb-wave 1.4s ease-in-out infinite;
      }
      .vb-msg-typing-wave span:nth-child(1) { animation-delay: 0s; }
      .vb-msg-typing-wave span:nth-child(2) { animation-delay: 0.15s; }
      .vb-msg-typing-wave span:nth-child(3) { animation-delay: 0.3s; }
      .vb-msg-typing-wave span:nth-child(4) { animation-delay: 0.45s; }
      @keyframes vb-wave {
        0%, 100% { height: 3px; opacity: 0.3; }
        50% { height: 14px; opacity: 0.7; }
      }

      /* Tables inside messages */
      .vb-msg-text table {
        width: 100%;
        border-collapse: collapse;
        margin: 8px 0 4px;
        font-size: 12px;
      }
      .vb-msg-text table th {
        background: rgba(94, 92, 230, 0.12);
        color: rgba(255, 255, 255, 0.85);
        font-weight: 600;
        text-align: left;
        padding: 7px 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        white-space: nowrap;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .vb-msg-text table td {
        padding: 6px 10px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.03);
        color: rgba(255, 255, 255, 0.75);
        font-size: 12px;
      }
      .vb-msg-text table tr:hover td {
        background: rgba(255, 255, 255, 0.03);
      }
      .vb-msg-text table tr:last-child td { border-bottom: none; }

      /* Scrollable table wrapper */
      .vb-table-wrap {
        overflow-x: auto;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.07);
        margin: 6px 0;
        max-width: 100%;
        width: 100%;
        animation: vb-table-in 0.4s ease backwards;
        animation-delay: 0.1s;
      }
      @keyframes vb-table-in {
        from { opacity: 0; transform: translateY(4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .vb-table-wrap::-webkit-scrollbar { height: 4px; }
      .vb-table-wrap::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }

      /* ── Code block card (dark theme) ── */
      .vb-code-card {
        background: #0d1117;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        margin: 8px 0;
        overflow: hidden;
        animation: vb-table-in 0.4s ease backwards;
        animation-delay: 0.1s;
      }
      .vb-code-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 12px;
        background: rgba(255, 255, 255, 0.04);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      }
      .vb-code-lang {
        font-size: 10px;
        font-weight: 600;
        color: rgba(94, 92, 230, 0.7);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
      }
      .vb-code-copy {
        background: none;
        border: 1px solid rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.45);
        font-size: 10px;
        padding: 2px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-family: 'Inter', sans-serif;
        transition: all 0.2s ease;
      }
      .vb-code-copy:hover {
        background: rgba(255, 255, 255, 0.06);
        color: rgba(255, 255, 255, 0.7);
        border-color: rgba(255, 255, 255, 0.2);
      }
      .vb-code-copy.vb-copied {
        color: rgba(48, 209, 88, 0.8);
        border-color: rgba(48, 209, 88, 0.3);
      }
      .vb-code-body {
        padding: 12px 14px;
        overflow-x: auto;
        max-height: 400px;
        overflow-y: auto;
      }
      .vb-code-body pre {
        margin: 0;
        white-space: pre;
        tab-size: 2;
      }
      .vb-code-body code {
        font-family: 'SF Mono', 'Fira Code', 'Consolas', 'Monaco', monospace;
        font-size: 11.5px;
        font-style: italic;
        line-height: 1.6;
        color: rgba(230, 237, 243, 0.88);
      }
      .vb-code-body::-webkit-scrollbar { width: 4px; height: 4px; }
      .vb-code-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

      /* Inline code */
      .vb-inline-code {
        font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
        font-size: 11px;
        font-style: italic;
        background: rgba(255, 255, 255, 0.06);
        color: rgba(230, 237, 243, 0.85);
        padding: 1px 5px;
        border-radius: 3px;
        border: 1px solid rgba(255, 255, 255, 0.06);
      }

      /* Light theme code overrides */
      #vb-root.vb-light .vb-code-card {
        background: #f6f8fa;
        border-color: rgba(0, 0, 0, 0.1);
      }
      #vb-root.vb-light .vb-code-header {
        background: rgba(0, 0, 0, 0.03);
        border-bottom-color: rgba(0, 0, 0, 0.08);
      }
      #vb-root.vb-light .vb-code-lang { color: rgba(94, 92, 230, 0.8); }
      #vb-root.vb-light .vb-code-copy {
        color: rgba(0, 0, 0, 0.4);
        border-color: rgba(0, 0, 0, 0.12);
      }
      #vb-root.vb-light .vb-code-copy:hover {
        background: rgba(0, 0, 0, 0.04);
        color: rgba(0, 0, 0, 0.6);
      }
      #vb-root.vb-light .vb-code-body code {
        color: #24292f;
      }
      #vb-root.vb-light .vb-inline-code {
        background: rgba(0, 0, 0, 0.05);
        color: #24292f;
        border-color: rgba(0, 0, 0, 0.08);
      }

      /* Source badge in chat */
      .vb-msg-source {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        font-weight: 500;
        color: rgba(94, 92, 230, 0.55);
        background: rgba(94, 92, 230, 0.07);
        padding: 2px 8px;
        border-radius: 4px;
        margin-top: 6px;
        letter-spacing: 0.02em;
        cursor: pointer;
        transition: background 0.2s, color 0.2s;
        user-select: none;
      }
      .vb-msg-source:hover {
        background: rgba(94, 92, 230, 0.14);
        color: rgba(94, 92, 230, 0.8);
      }
      .vb-msg-source .vb-source-chevron {
        display: inline-block;
        font-size: 8px;
        transition: transform 0.25s ease;
        margin-left: 2px;
      }
      .vb-msg-source.vb-source-open .vb-source-chevron {
        transform: rotate(90deg);
      }

      /* Expandable tool call details */
      .vb-tool-details {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.35s ease, opacity 0.3s ease, margin 0.3s ease;
        opacity: 0;
        margin-top: 0;
        border-radius: 6px;
      }
      .vb-tool-details.vb-tool-open {
        max-height: 600px;
        opacity: 1;
        margin-top: 8px;
      }
      .vb-tool-details-inner {
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 6px;
        padding: 10px 12px;
        font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
        font-size: 11px;
        line-height: 1.5;
      }
      .vb-tool-call-item {
        margin-bottom: 8px;
      }
      .vb-tool-call-item:last-child {
        margin-bottom: 0;
      }
      .vb-tool-call-name {
        color: rgba(94, 92, 230, 0.7);
        font-weight: 600;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 4px;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .vb-tool-call-name::before {
        content: '▸';
        font-size: 9px;
      }
      .vb-tool-call-args {
        color: rgba(255, 255, 255, 0.55);
        white-space: pre-wrap;
        word-break: break-all;
        padding: 4px 8px;
        background: rgba(0, 0, 0, 0.15);
        border-radius: 4px;
        border-left: 2px solid rgba(94, 92, 230, 0.25);
      }
      .vb-tool-call-args .vb-sql-keyword {
        color: rgba(94, 92, 230, 0.8);
        font-weight: 600;
      }
      .vb-tool-call-args .vb-sql-string {
        color: rgba(52, 199, 89, 0.8);
      }
      .vb-tool-call-divider {
        border: none;
        border-top: 1px solid rgba(255, 255, 255, 0.05);
        margin: 8px 0;
      }

      /* Input bar */
      #vb-chat-input-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 16px 12px 16px;
        padding: 6px 6px 6px 16px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 30px;
        flex-shrink: 0;
        background: rgba(40, 30, 60, 0.5);
        backdrop-filter: blur(20px);
        position: relative;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        transition: border-color 0.3s, background 0.3s, box-shadow 0.3s;
      }
      #vb-chat-input-bar:focus-within {
        border-color: rgba(94, 92, 230, 0.5);
        background: rgba(50, 40, 70, 0.6);
        box-shadow: 0 10px 40px rgba(94, 92, 230, 0.2);
      }
      #vb-chat-input {
        flex: 1;
        background: transparent;
        border: none;
        padding: 10px 0;
        color: rgba(255, 255, 255, 0.95);
        font-size: 14px;
        font-family: inherit;
        outline: none;
        box-shadow: none;
      }
      #vb-chat-input::placeholder { color: rgba(255, 255, 255, 0.35); }
      #vb-chat-input:focus {
        border-color: transparent;
        background: transparent;
        box-shadow: none;
      }
      #vb-chat-send, #vb-chat-mic {
        width: 38px;
        height: 38px;
        border: none;
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s, transform 0.15s;
        flex-shrink: 0;
      }
      #vb-chat-send {
        background: linear-gradient(135deg, #5E5CE6, #BF5AF2, #5E5CE6);
        background-size: 200% 200%;
        animation: gradient-shift 4s ease infinite;
      }
      @keyframes gradient-shift {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
      #vb-chat-send:hover { 
        transform: scale(1.08); 
        box-shadow: 0 3px 12px rgba(94,92,230,0.35); 
      }
      #vb-chat-send:active { transform: scale(0.95); }
      #vb-chat-send svg { width: 16px; height: 16px; fill: #fff; stroke: none; transition: transform 0.2s; }
      #vb-chat-send:active svg { transform: translateX(2px) translateY(-2px); }
      #vb-chat-mic {
        background: rgba(255, 255, 255, 0.06);
      }
      #vb-chat-mic:hover { 
        background: rgba(255, 255, 255, 0.1); 
        transform: scale(1.06); 
      }
      #vb-chat-mic.vb-mic-active {
        background: rgba(255, 55, 95, 0.2);
        animation: vb-mic-pulse 1.5s ease-in-out infinite;
      }
      @keyframes vb-mic-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(255, 55, 95, 0.3); }
        50% { box-shadow: 0 0 0 8px rgba(255, 55, 95, 0); }
      }
      #vb-chat-mic svg { width: 16px; height: 16px; stroke: rgba(255,255,255,0.55); fill: none; stroke-width: 2; stroke-linecap: round; }
      #vb-chat-mic.vb-mic-active svg { stroke: #FF375F; }

      /* ── Training Mode Indicator ── */
      #vb-training-indicator {
        position: absolute;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(255, 55, 95, 0.95);
        backdrop-filter: blur(10px);
        color: #fff;
        padding: 12px 24px;
        border-radius: 24px;
        font-size: 14px;
        font-weight: 600;
        display: none;
        align-items: center;
        gap: 10px;
        box-shadow: 0 4px 20px rgba(255, 55, 95, 0.4);
        z-index: 1001;
        animation: vb-training-pulse 2s ease-in-out infinite;
      }
      #vb-training-indicator.vb-show { display: flex; }
      #vb-training-indicator .vb-rec-dot {
        width: 8px;
        height: 8px;
        background: #fff;
        border-radius: 50%;
        animation: vb-rec-blink 1s ease-in-out infinite;
      }
      @keyframes vb-rec-blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
      @keyframes vb-training-pulse {
        0%, 100% { box-shadow: 0 4px 20px rgba(255, 55, 95, 0.4); }
        50% { box-shadow: 0 4px 30px rgba(255, 55, 95, 0.7); }
      }
      #vb-training-indicator .vb-step-count {
        opacity: 0.9;
        font-size: 12px;
      }

      /* ── Voice-Only Mode (Minimal UI) ── */
      #vb-voice-panel {
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(20, 20, 40, 0.95);
        backdrop-filter: blur(20px);
        border-radius: 20px;
        padding: 24px 32px;
        max-width: 500px;
        min-width: 320px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        z-index: 99999;
        opacity: 0;
        visibility: hidden;
        transition: all 0.3s ease;
        pointer-events: none;
      }
      #vb-voice-panel.vb-show {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
      }
      #vb-voice-status {
        font-size: 13px;
        color: rgba(255, 255, 255, 0.5);
        text-align: center;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 1px;
        font-weight: 600;
      }
      #vb-voice-transcript {
        font-size: 18px;
        color: rgba(255, 255, 255, 0.9);
        text-align: center;
        min-height: 50px;
        line-height: 1.5;
        padding: 12px 0;
      }
      #vb-voice-transcript.vb-listening {
        color: rgba(138, 96, 255, 0.9);
      }
      #vb-voice-close {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 28px;
        height: 28px;
        border: none;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 50%;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }
      #vb-voice-close:hover {
        background: rgba(255, 255, 255, 0.2);
      }
      #vb-voice-close svg {
        width: 12px;
        height: 12px;
        stroke: rgba(255, 255, 255, 0.7);
        stroke-width: 2.5;
      }
    `;
    document.head.appendChild(style);
  }

  /* ════════════════════════════════════════════════════
     §3  DOM CONSTRUCTION
     ════════════════════════════════════════════════════ */

  function buildDOM(config) {
    const root = document.createElement('div');
    root.id = 'vb-root';
    root.style.setProperty('--vb-size', config.size + 'px');

    // Trigger button
    root.innerHTML = `
      <button id="vb-trigger" class="vb-pos-${config.position}" aria-label="Open voice assistant">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z"/>
          <path d="M19 10v1a7 7 0 0 1-14 0v-1" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
          <line x1="12" y1="19" x2="12" y2="23" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
          <line x1="8" y1="23" x2="16" y2="23" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>

      <div id="vb-wake-indicator" class="vb-pos-${config.position}">
        <div id="vb-wake-dot"></div>
        <span id="vb-wake-label">Say "Hey Vedaa"</span>
      </div>

      <!-- Mini Orb (voice-only mode) -->
      <div id="vb-mini-orb" class="vb-pos-${config.position}">
        <canvas id="vb-mini-canvas" width="240" height="240"></canvas>
      </div>

      <!-- Mini Transcript -->
      <div id="vb-mini-transcript" class="vb-pos-${config.position}">
        <div id="vb-mini-transcript-status">Listening</div>
        <div id="vb-mini-transcript-text">Say something...</div>
      </div>

      <div id="vb-overlay">
        <button id="vb-close" aria-label="Close voice assistant">
          <svg viewBox="0 0 24 24"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
        </button>
        <button id="vb-theme-toggle" aria-label="Toggle light/dark theme">
          <svg class="vb-icon-moon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          <svg class="vb-icon-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
        </button>
        <button id="vb-lang-toggle" aria-label="Switch language">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"/>
          </svg>
          <span id="vb-lang-label">${(config.lang || 'en').toUpperCase()}</span>
        </button>
        <button id="vb-notes-btn" aria-label="View notes">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke-linecap="round" stroke-linejoin="round"/>
            <polyline points="14 2 14 8 20 8" stroke-linecap="round" stroke-linejoin="round"/>
            <line x1="8" y1="13" x2="16" y2="13" stroke-linecap="round"/>
            <line x1="8" y1="17" x2="13" y2="17" stroke-linecap="round"/>
          </svg>
          <span id="vb-notes-badge"></span>
        </button>
        <div id="vb-notes-panel">
          <div id="vb-notes-header">
            <h3>📝 Notes</h3>
            <button id="vb-notes-close-panel">&times;</button>
          </div>
          <div id="vb-notes-list"></div>
        </div>
        <div id="vb-note-toast">✓ Note saved</div>
        
        <!-- Training Mode Indicator -->
        <div id="vb-training-indicator">
          <div class="vb-rec-dot"></div>
          <span>Recording Workflow</span>
          <span class="vb-step-count">0 steps</span>
        </div>

        <canvas id="vb-canvas" width="560" height="560"></canvas>
        <div id="vb-status">Say "Hey Vedaa" or tap the orb</div>
        <div id="vb-content-area">
          <div id="vb-transcript"></div>
          <div id="vb-table-display"></div>
        </div>
        <div id="vb-hint">Say "take a note" · Tap orb to stop · <span>ESC</span> to close</div>
        <div id="vb-error"></div>

        <!-- Chat toggle button -->
        <button id="vb-chat-toggle" aria-label="Toggle chat">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path>
            <path d="M8 14v-4"></path>
            <path d="M12 16V8"></path>
            <path d="M16 13v-2"></path>
          </svg>
        </button>

        <!-- Chat panel -->
        <div id="vb-chat-panel">
          <div class="vb-chat-resize-handle"></div>
          <div id="vb-chat-header">
            <div class="vb-chat-header-left">
              <div class="vb-chat-header-avatar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a2 2 0 0 1 2 2c-.004 5.55-.425 10.38-1.5 14.5a15 15 0 0 1 4-1c.642 0 1.258.077 1.83.21a2 2 0 0 1 1.67 1.96v.05A2.3 2.3 0 0 1 17.7 22H6.3A2.3 2.3 0 0 1 4 19.72v-.05A2 2 0 0 1 5.67 17.7c.572-.133 1.188-.21 1.83-.21a15 15 0 0 1 4 1C10.425 14.38 10.004 9.55 10 4a2 2 0 0 1 2-2z"/></svg>
                <div class="vb-chat-status-dot"></div>
              </div>
              <div class="vb-chat-header-text">
                <h4>Vedaa</h4>
                <span>AI Assistant</span>
              </div>
            </div>
            <div class="vb-chat-header-actions">
              <button id="vb-chat-fullscreen" aria-label="Toggle fullscreen">
                <svg class="vb-icon-expand" viewBox="0 0 24 24"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                <svg class="vb-icon-collapse" viewBox="0 0 24 24"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
              </button>
              <button id="vb-chat-minimize" aria-label="Minimize chat">
                <svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
            </div>
          </div>
          <div id="vb-chat-messages"></div>
          <div id="vb-chat-input-bar">
            <input id="vb-chat-input" type="text" placeholder="Type a message…" autocomplete="off" />
            <button id="vb-chat-mic" aria-label="Voice input">
              <svg viewBox="0 0 24 24">
                <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z"/>
                <path d="M19 10v1a7 7 0 0 1-14 0v-1"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
              </svg>
            </button>
            <button id="vb-chat-send" aria-label="Send message">
              <svg viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    return root;
  }

  /* ════════════════════════════════════════════════════
     §4  ORB ANIMATION ENGINE
     ════════════════════════════════════════════════════ */

  class OrbRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.width = canvas.width;
      this.height = canvas.height;
      this.cx = this.width / 2;
      this.cy = this.height / 2;
      this.time = 0;
      this.audioLevel = 0;
      this.targetAudioLevel = 0;
      this.state = STATES.IDLE;
      this.animId = null;
      this.running = false;

      // Layer configuration
      this.layers = [
        { radius: 120, color1: '#0A84FF', color2: '#5E5CE6', speed: 0.6, freqs: [2, 3, 5], amps: [12, 8, 4], opacity: 0.25 },
        { radius: 105, color1: '#5E5CE6', color2: '#BF5AF2', speed: 0.8, freqs: [3, 4, 7], amps: [10, 7, 3], opacity: 0.35 },
        { radius: 88, color1: '#BF5AF2', color2: '#FF375F', speed: 1.0, freqs: [2, 5, 6], amps: [9, 6, 3], opacity: 0.5 },
        { radius: 70, color1: '#FF375F', color2: '#FF6B9D', speed: 1.2, freqs: [3, 5, 8], amps: [8, 5, 2], opacity: 0.65 },
        { radius: 50, color1: '#FF9F43', color2: '#FECA57', speed: 1.5, freqs: [4, 6, 9], amps: [6, 4, 2], opacity: 0.8 },
      ];

      // Particle system
      this.particles = Array.from({ length: 40 }, () => this._newParticle());
    }

    _newParticle() {
      const angle = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 80;
      return {
        x: this.cx + Math.cos(angle) * dist,
        y: this.cy + Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        size: 1 + Math.random() * 2.5,
        alpha: Math.random() * 0.5,
        life: Math.random(),
        speed: 0.002 + Math.random() * 0.004,
      };
    }

    start() {
      if (this.running) return;
      this.running = true;
      this._loop();
    }

    stop() {
      this.running = false;
      if (this.animId) cancelAnimationFrame(this.animId);
    }

    setState(state) { this.state = state; }
    setAudioLevel(level) { this.targetAudioLevel = Math.min(1, Math.max(0, level)); }

    _loop() {
      if (!this.running) return;
      this.time += 0.016;
      this.audioLevel += (this.targetAudioLevel - this.audioLevel) * 0.15;
      this._draw();
      this.animId = requestAnimationFrame(() => this._loop());
    }

    _draw() {
      const { ctx, width, height, cx, cy, time, audioLevel, state } = this;
      ctx.clearRect(0, 0, width, height);

      // ── Background glow ──
      const glowRadius = 180 + audioLevel * 60 + Math.sin(time * 0.8) * 10;
      const bgGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
      bgGlow.addColorStop(0, `rgba(94, 92, 230, ${0.12 + audioLevel * 0.1})`);
      bgGlow.addColorStop(0.5, `rgba(191, 90, 242, ${0.06 + audioLevel * 0.05})`);
      bgGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = bgGlow;
      ctx.fillRect(0, 0, width, height);

      // ── Particles ──
      this._drawParticles();

      // ── Orb layers (back to front) ──
      for (let i = 0; i < this.layers.length; i++) {
        this._drawLayer(this.layers[i], i);
      }

      // ── Inner core glow ──
      const coreGrad = ctx.createRadialGradient(cx, cy - 8, 0, cx, cy, 55);
      coreGrad.addColorStop(0, `rgba(255, 255, 255, ${0.35 + audioLevel * 0.2})`);
      coreGrad.addColorStop(0.4, `rgba(255, 220, 255, ${0.12 + audioLevel * 0.1})`);
      coreGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, 50, 0, Math.PI * 2);
      ctx.fill();
    }

    _drawLayer(layer, index) {
      const { ctx, cx, cy, time, audioLevel, state } = this;
      const { radius, color1, color2, speed, freqs, amps, opacity } = layer;
      const points = 128;

      // State-based modifiers
      let speedMult = 1,
        ampMult = 1,
        breathe = 0,
        audioMult = 1;

      switch (state) {
        case STATES.IDLE:
          speedMult = 0.5;
          ampMult = 0.6;
          breathe = Math.sin(time * 0.6 + index * 0.3) * 6;
          audioMult = 0.5;
          break;
        case STATES.LISTENING:
          speedMult = 1.2;
          ampMult = 1.0 + audioLevel * 1.5;
          audioMult = 3.0;
          break;
        case STATES.PROCESSING:
          speedMult = 2.5;
          ampMult = 0.7;
          breathe = Math.sin(time * 3) * 10;
          audioMult = 0.3;
          break;
        case STATES.SPEAKING:
          speedMult = 0.9;
          ampMult = 0.8 + audioLevel * 1.2;
          audioMult = 2.5;
          breathe = Math.sin(time * 1.5) * 4;
          break;
        case STATES.ERROR:
          speedMult = 0.3;
          ampMult = 0.4;
          break;
      }

      const t = time * speed * speedMult;
      const baseRadius = radius + breathe;

      // Build points
      const pts = [];
      for (let i = 0; i <= points; i++) {
        const angle = (i / points) * Math.PI * 2;
        let r = baseRadius;

        // Noise from multiple frequencies
        for (let f = 0; f < freqs.length; f++) {
          r += Math.sin(angle * freqs[f] + t * (1 + f * 0.3) + index) * amps[f] * ampMult;
        }

        // Audio reactivity
        r += Math.sin(angle * 4 + time * 2.5) * audioLevel * 25 * audioMult;
        r += Math.sin(angle * 7 - time * 1.8) * audioLevel * 12 * audioMult;

        pts.push({
          x: cx + Math.cos(angle) * r,
          y: cy + Math.sin(angle) * r,
        });
      }

      // Draw smooth path
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const xc = (pts[i].x + pts[i + 1].x) / 2;
        const yc = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
      }
      ctx.closePath();

      // Gradient fill
      const grad = ctx.createRadialGradient(cx, cy - radius * 0.2, 0, cx, cy, baseRadius + 20);
      const hueShift = Math.sin(time * 0.3 + index) * 0.15;
      grad.addColorStop(0, this._adjustAlpha(color1, opacity + hueShift));
      grad.addColorStop(1, this._adjustAlpha(color2, opacity * 0.6 + hueShift));
      ctx.fillStyle = grad;
      ctx.fill();
    }

    _drawParticles() {
      const { ctx, cx, cy, time, audioLevel, state } = this;

      for (const p of this.particles) {
        p.life += p.speed * (state === STATES.PROCESSING ? 3 : 1);
        if (p.life > 1) Object.assign(p, this._newParticle(), { life: 0 });

        const dx = p.x - cx;
        const dy = p.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        // Orbit + drift
        const orbitSpeed = 0.003 * (state === STATES.PROCESSING ? 4 : 1);
        p.x = cx + Math.cos(angle + orbitSpeed) * (dist + p.vx + audioLevel * Math.sin(time * 3) * 0.8);
        p.y = cy + Math.sin(angle + orbitSpeed) * (dist + p.vy + audioLevel * Math.cos(time * 3) * 0.8);

        const alpha = p.alpha * (1 - Math.abs(p.life - 0.5) * 2) * (0.5 + audioLevel * 0.5);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.8 + audioLevel * 0.5), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200, 180, 255, ${alpha})`;
        ctx.fill();
      }
    }

    _adjustAlpha(hex, alpha) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
    }
  }

  /* ════════════════════════════════════════════════════
     §5  SPEECH ENGINE
     ════════════════════════════════════════════════════ */

  class SpeechEngine {
    constructor(lang, voiceGender = 'female') {
      this.lang = lang;
      this.voiceGender = voiceGender;
      this._selectedVoice = null;    // Cached preferred voice
      this.recognition = null;
      this.synthesis = window.speechSynthesis;
      this.isListening = false;
      this.isSpeaking = false;
      this._bargeInEnabled = true;   // Enable voice-based barge-in
      this._bargeInRecognition = null; // Separate recognition for barge-in
      this._bargeInActive = false;   // True during barge-in to suppress onSpeakEnd
      this._currentTTSText = '';     // Track what TTS is currently saying (for echo filtering)
      this._bargeInReady = false;    // Delay barge-in to avoid TTS echo at start
      this._initRecognition();
      this._pickVoice();             // Pre-select best voice

      // Callbacks
      this.onResult = () => { };
      this.onInterim = () => { };
      this.onListeningStart = () => { };
      this.onListeningEnd = () => { };
      this.onSpeakStart = () => { };
      this.onSpeakEnd = () => { };
      this.onError = () => { };
      this.onAudioLevel = () => { };
      this.onBargeIn = () => { };     // Called when user interrupts by voice (receives partial text)

      // Audio analysis
      this._audioCtx = null;
      this._analyser = null;
      this._micStream = null;
    }

    /* ── Indian female voice picker ── */

    _pickVoice() {
      const voices = this.synthesis.getVoices();
      if (!voices.length) return; // voices not loaded yet — will retry on speak()

      // Debug: log available voices (helpful for tuning)
      console.log(`[Voice] Available voices for ${this.lang}:`,
        voices.filter(v => v.lang.startsWith(this.lang.split('-')[0]))
          .map(v => `${v.name} (${v.lang})`)
      );

      const langBase = this.lang.split('-')[0]; // 'en' or 'hi'
      const isFemale = this.voiceGender === 'female';

      // Priority list for Indian female voices (best → fallback)
      // These cover Chrome, Edge, Safari, and Android
      const preferenceKeywords = this.lang.startsWith('hi') ? [
        // Hindi female voices (most natural → least)
        'Google हिन्दी',
        'Neerja',        // Microsoft Neerja (Edge)
        'Swara',         // Microsoft Swara (Edge)
        'Lekha',
        'Hindi Female',
        'Hindi',
      ] : [
        // Indian/English female voices — wide net across all browsers & OS
        'Google India English Female',
        'Google India',
        'Neerja',        // Microsoft Neerja (Edge)
        'Veena',         // macOS Indian English female
        'Google UK English Female',
        'Google US English Female',   // Chrome female
        'Google US English',
        'Samantha',      // macOS default female
        'Karen',         // macOS Australian female
        'Moira',         // macOS Irish female
        'Fiona',         // macOS Scottish female
        'Tessa',         // macOS South African female
        'Microsoft Zira',// Windows female
        'Microsoft Jenny',// Windows 11 female
        'Female',
        'India English',
        'India',
      ];

      // Try each preference keyword
      for (const keyword of preferenceKeywords) {
        const match = voices.find(v => {
          const nameMatch = v.name.includes(keyword);
          const langMatch = v.lang.startsWith(langBase) || v.lang.startsWith(this.lang);
          const genderOK = !isFemale || !v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('female');
          return nameMatch && langMatch && genderOK;
        });
        if (match) {
          this._selectedVoice = match;
          console.log(`[Voice] Selected: "${match.name}" (${match.lang})`);
          return;
        }
      }

      // Broader fallback: try any English female voice (relax lang-region match)
      if (isFemale && langBase === 'en') {
        const anyEnglishFemale = voices.find(v =>
          v.lang.startsWith('en') && (
            v.name.toLowerCase().includes('female') ||
            /samantha|karen|veena|fiona|moira|tessa|zira|jenny|neerja|google.*female/i.test(v.name)
          )
        );
        if (anyEnglishFemale) {
          this._selectedVoice = anyEnglishFemale;
          console.log(`[Voice] English female fallback: "${anyEnglishFemale.name}" (${anyEnglishFemale.lang})`);
          return;
        }
      }

      // Last resort: any voice matching the lang with female preference
      const langVoices = voices.filter(v => v.lang.startsWith(langBase) || v.lang.startsWith(this.lang));
      const femaleVoice = langVoices.find(v =>
        v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('woman') ||
        /samantha|karen|veena|fiona|moira|tessa|zira|jenny|neerja|swara|lekha/i.test(v.name)
      );
      this._selectedVoice = femaleVoice || langVoices[0] || null;
      if (this._selectedVoice) {
        console.log(`[Voice] Fallback: "${this._selectedVoice.name}" (${this._selectedVoice.lang})`);
      } else {
        console.warn(`[Voice] No voice found for ${this.lang}`);
      }
    }

    /* ── Switch language at runtime ── */

    setLang(newLang) {
      this.lang = newLang;
      // Update recognition language
      if (this.recognition) this.recognition.lang = newLang;
      // Re-pick voice for new language
      this._pickVoice();
      console.log(`[SpeechEngine] Language switched to ${newLang}`);
    }

    _initRecognition() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return;
      this.recognition = new SR();
      this.recognition.lang = this.lang;
      this.recognition.interimResults = true;
      this.recognition.continuous = true;
      this.recognition.maxAlternatives = 1;

      this.recognition.onresult = (e) => {
        let final = '', interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const transcript = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += transcript;
          else interim += transcript;
        }
        if (interim) this.onInterim(interim);
        if (final) {
          this.onResult(final.trim());
          // Don't stop recognition — just consume the result
        }
      };

      this.recognition.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        console.warn('[SpeechEngine] Recognition error:', e.error);

        // If mic permission denied, stop trying to restart
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          this.isListening = false; // Prevent auto-restart in onend
          this.onError('Microphone access denied. Please allow mic permission and try again.');
          return;
        }
        this.onError(e.error);
      };

      this.recognition.onend = () => {
        // Chrome kills recognition frequently even with continuous=true
        // (after silence, network hiccup, or getting a final result).
        // Auto-restart if we're still supposed to be listening.
        if (this.isListening) {
          console.log('[SpeechEngine] Recognition ended unexpectedly — restarting…');
          // Small delay to avoid Chrome's rapid-restart throttling
          setTimeout(() => {
            if (!this.isListening) return;
            try {
              this.recognition.start();
            } catch (e) {
              // If restart fails, give up
              console.warn('[SpeechEngine] Could not restart:', e.message);
              this.isListening = false;
              this.onListeningEnd();
              this._stopAudioAnalysis();
            }
          }, 300);
          return;
        }
        this.isListening = false;
        this.onListeningEnd();
        this._stopAudioAnalysis();
      };
    }

    get supported() {
      return !!this.recognition;
    }

    async startListening() {
      if (!this.recognition) {
        this.onError('Speech recognition not supported in this browser.');
        return;
      }
      // Interrupt TTS if playing
      if (this.isSpeaking) this.stopSpeaking();

      try {
        this.recognition.start();
        this.isListening = true;
        this.onListeningStart();
        await this._startAudioAnalysis();
      } catch (e) {
        if (e.message?.includes('already started')) return;
        this.onError(e.message);
      }
    }

    stopListening() {
      if (!this.recognition) return;
      try {
        this.recognition.stop();
      } catch (_) { }
      this.isListening = false;
      this._stopAudioAnalysis();
    }

    speak(text) {
      return new Promise((resolve) => {
        // ── Chrome workaround: un-stick the speechSynthesis engine ──
        // Chrome pauses the TTS engine after ~15 s of inactivity, causing
        // subsequent .speak() calls to silently fail (no events fire).
        // Fix: cancel → resume → small delay → then speak.
        this.synthesis.cancel();
        this.synthesis.resume();    // un-pause Chrome's internal state

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = this.lang;
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        // Use pre-selected Indian female voice (retry pick if not cached yet)
        if (!this._selectedVoice) this._pickVoice();
        if (this._selectedVoice) utterance.voice = this._selectedVoice;

        console.log(`[TTS] Speaking: "${text.slice(0, 80)}…" | voice: ${this._selectedVoice?.name || 'default'}`);

        // Safety timeout — if onstart never fires within 3 s, force resolve
        // (catches the Chrome silent-fail scenario)
        let started = false;
        const safetyTimer = setTimeout(() => {
          if (!started) {
            console.warn('[TTS] Safety timeout — utterance never started. Retrying once…');
            this.synthesis.cancel();
            this.synthesis.resume();
            // One retry
            const retry = new SpeechSynthesisUtterance(text);
            retry.lang = utterance.lang;
            retry.rate = utterance.rate;
            retry.pitch = utterance.pitch;
            retry.volume = utterance.volume;
            if (this._selectedVoice) retry.voice = this._selectedVoice;
            retry.onstart = utterance.onstart;
            retry.onend = utterance.onend;
            retry.onerror = utterance.onerror;
            this.synthesis.speak(retry);
          }
        }, 3000);

        utterance.onstart = () => {
          started = true;
          clearTimeout(safetyTimer);
          this.isSpeaking = true;
          this._currentTTSText = text.toLowerCase();
          this.onSpeakStart();
          this._simulateSpeechAudio(text);
          // Delay barge-in activation to let TTS audio settle and avoid echo false-triggers
          this._bargeInReady = false;
          setTimeout(() => {
            this._bargeInReady = true;
          }, 800);
          // Start barge-in listener so user can interrupt by voice
          this._startBargeInListener();

          // ── Chrome keep-alive: prevent Chrome from pausing mid-utterance ──
          // Chrome will pause TTS after ~15 s of continuous speech. Periodically
          // calling .resume() keeps it alive.
          this._ttsKeepAlive = setInterval(() => {
            if (this.synthesis.speaking && !this.synthesis.paused) return;
            this.synthesis.resume();
          }, 5000);
        };

        utterance.onend = () => {
          started = true;
          clearTimeout(safetyTimer);
          clearInterval(this._ttsKeepAlive);
          this.isSpeaking = false;
          this._currentTTSText = '';
          this._bargeInReady = false;
          this._stopBargeInListener();
          // Don't fire onSpeakEnd if barge-in already handled the transition
          if (this._bargeInActive) {
            this._bargeInActive = false;
            resolve();
            return;
          }
          this.onSpeakEnd();
          resolve();
        };

        utterance.onerror = (e) => {
          console.warn('[TTS] Utterance error:', e.error, e.message);
          started = true;
          clearTimeout(safetyTimer);
          clearInterval(this._ttsKeepAlive);
          this.isSpeaking = false;
          this._currentTTSText = '';
          this._bargeInReady = false;
          this._stopBargeInListener();
          if (this._bargeInActive) {
            this._bargeInActive = false;
            resolve();
            return;
          }
          this.onSpeakEnd();
          resolve();
        };

        // Small delay after cancel+resume to give Chrome time to reset
        setTimeout(() => {
          this.synthesis.speak(utterance);
        }, 50);
      });
    }

    stopSpeaking() {
      this.synthesis.cancel();
      clearInterval(this._ttsKeepAlive);
      this.isSpeaking = false;
      this._stopBargeInListener();
      this.onSpeakEnd();
    }

    interrupt() {
      this.synthesis.cancel();
      clearInterval(this._ttsKeepAlive);
      this.isSpeaking = false;
      this._currentTTSText = '';
      this._bargeInReady = false;
      this._stopBargeInListener();
      this.onSpeakEnd();
    }

    /* ── Barge-in: listen for voice while TTS is playing ── */

    _startBargeInListener() {
      if (!this._bargeInEnabled) return;

      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return;

      // Stop any existing barge-in listener
      this._stopBargeInListener();

      this._bargeInRecognition = new SR();
      this._bargeInRecognition.lang = this.lang;
      this._bargeInRecognition.interimResults = true;
      this._bargeInRecognition.continuous = true;
      this._bargeInRecognition.maxAlternatives = 1;

      // Track interim accumulation to detect sustained non-echo speech
      this._bargeInInterimCount = 0;

      this._bargeInRecognition.onresult = (e) => {
        // Don't trigger until startup delay has passed
        if (!this._bargeInReady) return;

        for (let i = e.resultIndex; i < e.results.length; i++) {
          const transcript = e.results[i][0].transcript.trim();
          const confidence = e.results[i][0].confidence || 0;
          const isFinal = e.results[i].isFinal;

          // Ignore empty / very short fragments
          if (transcript.length < 2) continue;

          // ── TTS Echo Filter — lightweight ──
          const heard = transcript.toLowerCase().replace(/[.,!?;:'"।॥]/g, '');
          const tts = this._currentTTSText.replace(/[.,!?;:'"।॥]/g, '');

          // Only reject if the heard text is a direct substring of TTS
          // (exact echo). Don't do phrase matching — too many false negatives.
          if (tts && tts.includes(heard)) {
            console.log(`[BargeIn] Echo (substring): "${transcript}"`);
            continue;
          }

          // ── Interim path — trigger on sustained non-echo speech ──
          if (!isFinal) {
            this._bargeInInterimCount++;
            // Instantly interrupt on the very first non-echo interim for a human-like, snappy reaction time
            if (this._bargeInInterimCount >= 1) {
              console.log(`[BargeIn] Interim interrupt (${this._bargeInInterimCount} hits): "${transcript}"`);
              this._executeBargeIn(transcript);
              return;
            }
            continue;
          }

          // ── Final result — always trigger (already passed echo check) ──
          // Skip only if confidence is explicitly reported as very low
          if (confidence > 0 && confidence < 0.25) {
            console.log(`[BargeIn] Ignoring low-confidence (${(confidence * 100).toFixed(0)}%): "${transcript}"`);
            continue;
          }

          console.log(`[BargeIn] Final: "${transcript}" (conf: ${confidence > 0 ? (confidence * 100).toFixed(0) + '%' : 'n/a'})`);
          this._executeBargeIn(transcript);
          return;
        }
      };

      this._bargeInRecognition.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        console.warn('[BargeIn] Recognition error:', e.error);
      };

      this._bargeInRecognition.onend = () => {
        // Auto-restart if still speaking
        if (this.isSpeaking && this._bargeInEnabled) {
          try { this._bargeInRecognition.start(); } catch (_) { }
        }
      };

      try {
        this._bargeInRecognition.start();
        console.log('[BargeIn] Listening for voice interruption...');
      } catch (e) {
        console.warn('[BargeIn] Could not start:', e.message);
      }
    }

    _stopBargeInListener() {
      if (this._bargeInRecognition) {
        try { this._bargeInRecognition.abort(); } catch (_) { }
        this._bargeInRecognition = null;
      }
    }

    /**
     * Execute barge-in: kill TTS instantly, switch to listening mode.
     * The controller shows "Listening…" and the mic captures the user's full sentence.
     */
    _executeBargeIn(transcript) {
      // Flag to prevent utterance.onend from firing onSpeakEnd after cancel
      this._bargeInActive = true;

      // 1. Kill TTS audio immediately (synchronous)
      this.synthesis.cancel();
      clearInterval(this._ttsKeepAlive);
      this.isSpeaking = false;
      this._currentTTSText = '';
      this._bargeInReady = false;

      // 2. Kill barge-in listener
      this._stopBargeInListener();

      // 3. Play a subtle, human-like acknowledgement hum/pop
      this._playAcknowledgeSound();

      // 4. Notify controller — it will show "Listening…"
      this.onBargeIn(transcript);

      // 5. Start main mic after a tiny delay for audio context to settle
      setTimeout(() => {
        this.startListening();
      }, 100);
    }

    _playAcknowledgeSound() {
      try {
        const ctx = this._audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (!this._audioCtx) this._audioCtx = ctx;

        // Create a warm, organic "hmm" / "blip" sound to acknowledge interruption instantly
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(250, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.15);

        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);

        // Add a second oscillator for a slightly richer "human" formant feel
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);

        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(500, ctx.currentTime);
        osc2.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.15);

        gain2.gain.setValueAtTime(0, ctx.currentTime);
        gain2.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.05);
        gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);

        osc2.start(ctx.currentTime);
        osc2.stop(ctx.currentTime + 0.2);
      } catch (e) {
        console.warn('[Audio] Could not play acknowledge sound', e);
      }
    }

    /**
     * Check if heard text is a direct echo of TTS output.
     * Kept simple — only exact substring matching.
     */
    _isEcho(heard, tts) {
      if (!tts) return false;
      return tts.includes(heard);
    }

    /* ── Audio level analysis with noise cancellation pipeline ── */

    async _startAudioAnalysis() {
      try {
        if (!this._audioCtx) {
          this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        this._micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
            channelCount: 1,            // mono — reduces processing
            sampleRate: 16000,          // voice-optimised sample rate
          }
        });
        const source = this._audioCtx.createMediaStreamSource(this._micStream);

        // ── Noise cancellation chain ──
        // 1. High-pass filter — removes low-frequency rumble (AC, traffic, fan hum)
        const highPass = this._audioCtx.createBiquadFilter();
        highPass.type = 'highpass';
        highPass.frequency.value = 85;   // cut below 85 Hz
        highPass.Q.value = 0.7;

        // 2. Low-pass filter — removes high-frequency hiss / electronic noise
        const lowPass = this._audioCtx.createBiquadFilter();
        lowPass.type = 'lowpass';
        lowPass.frequency.value = 8000;  // cut above 8 kHz (voice is 100–4000 Hz)
        lowPass.Q.value = 0.7;

        // 3. Peaking filter — boost the voice presence band (1–4 kHz)
        const voiceBoost = this._audioCtx.createBiquadFilter();
        voiceBoost.type = 'peaking';
        voiceBoost.frequency.value = 2500;
        voiceBoost.Q.value = 1.0;
        voiceBoost.gain.value = 3;       // +3 dB boost to speech clarity

        // 4. Compressor — normalises loud/quiet speech, squashes noise floor
        const compressor = this._audioCtx.createDynamicsCompressor();
        compressor.threshold.value = -35;  // start compressing at -35 dB
        compressor.knee.value = 10;
        compressor.ratio.value = 6;        // 6:1 ratio
        compressor.attack.value = 0.005;   // 5 ms — fast attack for speech
        compressor.release.value = 0.15;   // 150 ms — smooth release

        // 5. Noise gate via gain node — suppress signals below threshold
        this._noiseGate = this._audioCtx.createGain();
        this._noiseGate.gain.value = 1;
        this._noiseFloor = 0;              // calibrated in first ~500 ms
        this._noiseCalibFrames = 0;
        this._noiseCalibSum = 0;

        // Connect chain: mic → highPass → lowPass → voiceBoost → compressor → noiseGate → analyser
        source.connect(highPass);
        highPass.connect(lowPass);
        lowPass.connect(voiceBoost);
        voiceBoost.connect(compressor);
        compressor.connect(this._noiseGate);

        this._analyser = this._audioCtx.createAnalyser();
        this._analyser.fftSize = 256;
        this._analyser.smoothingTimeConstant = 0.75;
        this._noiseGate.connect(this._analyser);

        // Store filter refs for cleanup
        this._audioNodes = [highPass, lowPass, voiceBoost, compressor, this._noiseGate];

        this._analysisLoop();
      } catch (_) {
        // Fallback: simulate audio levels
      }
    }

    _stopAudioAnalysis() {
      if (this._micStream) {
        this._micStream.getTracks().forEach(t => t.stop());
        this._micStream = null;
      }
      // Disconnect audio processing nodes
      if (this._audioNodes) {
        this._audioNodes.forEach(n => { try { n.disconnect(); } catch (_) { } });
        this._audioNodes = null;
      }
      this._noiseGate = null;
      this._noiseFloor = 0;
      this._noiseCalibFrames = 0;
      this._noiseCalibSum = 0;
    }

    _analysisLoop() {
      if (!this.isListening || !this._analyser) return;
      const data = new Uint8Array(this._analyser.frequencyBinCount);
      this._analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;

      // ── Software noise gate ──
      // Calibrate noise floor from first ~30 frames (~500 ms)
      if (this._noiseCalibFrames < 30) {
        this._noiseCalibSum += avg;
        this._noiseCalibFrames++;
        if (this._noiseCalibFrames === 30) {
          this._noiseFloor = (this._noiseCalibSum / 30) * 1.4; // 40% above avg ambient
          console.log(`[Audio] Noise floor calibrated: ${this._noiseFloor.toFixed(1)}`);
        }
      }

      // Gate: if signal is below calibrated noise floor, treat as silence
      const gatedAvg = (this._noiseFloor > 0 && avg < this._noiseFloor) ? 0 : avg;
      const level = Math.min(1, gatedAvg / 128);

      this.onAudioLevel(level);
      requestAnimationFrame(() => this._analysisLoop());
    }

    _simulateSpeechAudio(text) {
      // Simulate audio levels for TTS (since we can't easily analyze TTS output)
      const words = text.split(/\s+/).length;
      const durationMs = words * 300; // rough estimate
      const start = Date.now();

      const tick = () => {
        if (!this.isSpeaking) return;
        const elapsed = Date.now() - start;
        if (elapsed > durationMs) { this.onAudioLevel(0); return; }
        // Create organic-looking levels
        const t = elapsed / 1000;
        const level = 0.3 +
          Math.sin(t * 5.5) * 0.15 +
          Math.sin(t * 8.3) * 0.1 +
          Math.sin(t * 13.1) * 0.08 +
          Math.random() * 0.12;
        this.onAudioLevel(Math.max(0, Math.min(1, level)));
        requestAnimationFrame(tick);
      };
      tick();
    }
  }

  /* ════════════════════════════════════════════════════
     §5a  DEEPGRAM VOICE AGENT
     ════════════════════════════════════════════════════
     Full-duplex voice agent over WebSocket.
     Replaces browser SpeechRecognition + speechSynthesis
     with Deepgram's server-side STT → LLM → TTS pipeline.
     Exposes the same callback interface as SpeechEngine
     so VoiceBotController's _bindSpeech() works unchanged.
     ════════════════════════════════════════════════════ */

  class DeepgramVoiceAgent {
    /**
     * @param {object} opts
     * @param {string} opts.apiKey        — Deepgram API key
     * @param {string} opts.serverUrl     — App server URL (for /api/deepgram/token fallback)
     * @param {string} opts.appApiKey     — Tenant API key (for server proxy auth)
     * @param {object} [opts.settings]    — Full Settings JSON override
     * @param {string} [opts.greeting]    — Agent greeting text
     */
    constructor(opts = {}) {
      this._apiKey = opts.apiKey || '';
      this._serverUrl = opts.serverUrl || '';
      this._appApiKey = opts.appApiKey || '';
      this._settingsOverride = opts.settings || null;
      this._greeting = opts.greeting || 'Hello! How may I help you?';

      // State
      this.isListening = false;
      this.isSpeaking = false;
      this._ws = null;
      this._connected = false;
      this._micStream = null;
      this._audioCtx = null;
      this._playbackCtx = null;
      this._workletNode = null;
      this._scriptNode = null;     // Fallback ScriptProcessorNode
      this._keepAliveTimer = null;

      // Audio playback queue
      this._playQueue = [];
      this._isPlaying = false;
      this._nextPlayTime = 0;

      // Audio level analysis
      this._analyser = null;
      this._levelRAF = null;

      // Callbacks — same interface as SpeechEngine
      this.onResult = () => {};         // Final user transcript
      this.onInterim = () => {};        // Interim user transcript
      this.onListeningStart = () => {};
      this.onListeningEnd = () => {};
      this.onSpeakStart = () => {};
      this.onSpeakEnd = () => {};
      this.onError = () => {};
      this.onAudioLevel = () => {};
      this.onBargeIn = () => {};

      // Deepgram-specific callbacks
      this.onAgentText = () => {};      // Agent's full text response (ConversationText role=agent)
      this.onUserText = () => {};       // User's full text (ConversationText role=user)
      this.onAgentThinking = () => {};  // Agent is thinking
    }

    get supported() { return true; } // WebSocket + AudioContext are universally supported

    /* ────────────────────────────────────────────
       CONNECTION LIFECYCLE
       ──────────────────────────────────────────── */

    async connect() {
      if (this._ws && this._connected) return;

      // Resolve API key — prefer direct key, fallback to server proxy
      let apiKey = this._apiKey;
      if (!apiKey && this._serverUrl) {
        try {
          const headers = { 'Content-Type': 'application/json' };
          if (this._appApiKey) headers['x-api-key'] = this._appApiKey;
          const res = await fetch(`${this._serverUrl}/api/deepgram/token`, { headers });
          if (res.ok) {
            const data = await res.json();
            apiKey = data.key || data.token || data.apiKey || '';
          }
        } catch (e) {
          console.warn('[Deepgram] Could not fetch token from server:', e.message);
        }
      }

      if (!apiKey) {
        this.onError('No Deepgram API key configured. Set deepgramApiKey or configure server proxy.');
        return;
      }

      return new Promise((resolve, reject) => {
        const wsUrl = 'wss://agent.deepgram.com/agent';
        this._ws = new WebSocket(wsUrl, ['token', apiKey]);

        this._ws.binaryType = 'arraybuffer';

        this._ws.onopen = () => {
          console.log('[Deepgram] WebSocket connected');
          this._connected = true;
          this._sendSettings();
          this._startKeepAlive();
          resolve();
        };

        this._ws.onmessage = (evt) => this._handleMessage(evt);

        this._ws.onerror = (evt) => {
          console.error('[Deepgram] WebSocket error:', evt);
          this.onError('Deepgram connection error');
          reject(new Error('WebSocket error'));
        };

        this._ws.onclose = (evt) => {
          console.log(`[Deepgram] WebSocket closed (code: ${evt.code})`);
          this._connected = false;
          this._stopKeepAlive();
          this._stopMicCapture();
          if (this.isListening) {
            this.isListening = false;
            this.onListeningEnd();
          }
        };
      });
    }

    disconnect() {
      this._stopKeepAlive();
      this._stopMicCapture();
      this._stopPlayback();
      if (this._ws) {
        this._ws.close();
        this._ws = null;
      }
      this._connected = false;
      this.isListening = false;
      this.isSpeaking = false;
    }

    /* ────────────────────────────────────────────
       SETTINGS
       ──────────────────────────────────────────── */

    _sendSettings() {
      const settings = this._settingsOverride || {
        type: 'Settings',
        audio: {
          input:  { encoding: 'linear16', sample_rate: 48000 },
          output: { encoding: 'linear16', sample_rate: 24000, container: 'none' },
        },
        agent: {
          language: 'en',
          speak: {
            provider: { type: 'deepgram', model: 'aura-2-odysseus-en' },
          },
          listen: {
            provider: { type: 'deepgram', version: 'v2', model: 'flux-general-en' },
          },
          think: {
            provider: { type: 'google', model: 'gemini-2.5-flash' },
            prompt: 'You are a friendly virtual assistant. Be warm, concise, and helpful. Keep responses under 2 sentences unless the user asks for detail.',
          },
          greeting: this._greeting,
        },
      };

      // Ensure type field is set
      if (!settings.type) settings.type = 'Settings';

      this._send(JSON.stringify(settings));
      console.log('[Deepgram] Settings sent');
    }

    /* ────────────────────────────────────────────
       KEEP-ALIVE
       ──────────────────────────────────────────── */

    _startKeepAlive() {
      this._stopKeepAlive();
      this._keepAliveTimer = setInterval(() => {
        if (this._connected) {
          this._send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 8000);
    }

    _stopKeepAlive() {
      if (this._keepAliveTimer) {
        clearInterval(this._keepAliveTimer);
        this._keepAliveTimer = null;
      }
    }

    /* ────────────────────────────────────────────
       MESSAGE HANDLING
       ──────────────────────────────────────────── */

    _handleMessage(evt) {
      // Binary → agent audio
      if (evt.data instanceof ArrayBuffer) {
        this._queueAudioChunk(evt.data);
        return;
      }

      // JSON text event
      let msg;
      try { msg = JSON.parse(evt.data); } catch (_) { return; }

      const type = msg.type;
      console.log(`[Deepgram] Event: ${type}`);

      switch (type) {
        case 'Welcome':
          console.log('[Deepgram] Session ID:', msg.session_id);
          break;

        case 'SettingsApplied':
          console.log('[Deepgram] Settings applied successfully');
          break;

        case 'UserStartedSpeaking':
          // Barge-in — flush audio queue
          this._flushPlayback();
          if (this.isSpeaking) {
            this.isSpeaking = false;
            this.onBargeIn('');
          }
          break;

        case 'AgentThinking':
          this.onAgentThinking();
          break;

        case 'AgentStartedSpeaking':
          this.isSpeaking = true;
          this.onSpeakStart();
          break;

        case 'AgentAudioDone':
          // Audio stream complete — playback continues until queue drains
          // onSpeakEnd is fired after the last queued chunk finishes playing
          this._markAudioDone();
          break;

        case 'ConversationText':
          if (msg.role === 'user') {
            this.onUserText(msg.content || '');
            this.onResult(msg.content || '');
          } else if (msg.role === 'assistant') {
            this.onAgentText(msg.content || '');
          }
          break;

        case 'Error':
          console.error('[Deepgram] Agent error:', msg);
          this.onError(msg.message || msg.description || 'Deepgram agent error');
          break;

        default:
          // Ignore unknown events
          break;
      }
    }

    /* ────────────────────────────────────────────
       MIC CAPTURE → PCM LINEAR16 48 kHz
       ──────────────────────────────────────────── */

    async _startMicCapture() {
      try {
        this._audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });

        this._micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 48000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

        const source = this._audioCtx.createMediaStreamSource(this._micStream);

        // Audio level analyser
        this._analyser = this._audioCtx.createAnalyser();
        this._analyser.fftSize = 256;
        source.connect(this._analyser);
        this._startLevelMonitor();

        // PCM capture via ScriptProcessorNode (widely supported)
        const bufferSize = 4096;
        this._scriptNode = this._audioCtx.createScriptProcessor(bufferSize, 1, 1);

        this._scriptNode.onaudioprocess = (e) => {
          if (!this._connected || !this.isListening) return;
          const float32 = e.inputBuffer.getChannelData(0);
          const int16 = this._float32ToInt16(float32);
          this._send(int16.buffer);
        };

        source.connect(this._scriptNode);
        this._scriptNode.connect(this._audioCtx.destination); // Required for ScriptProcessor to fire

        console.log('[Deepgram] Mic capture started (48 kHz linear16)');
      } catch (e) {
        console.error('[Deepgram] Mic error:', e);
        this.onError('Microphone access denied or unavailable.');
      }
    }

    _stopMicCapture() {
      this._stopLevelMonitor();
      if (this._scriptNode) {
        this._scriptNode.disconnect();
        this._scriptNode = null;
      }
      if (this._micStream) {
        this._micStream.getTracks().forEach(t => t.stop());
        this._micStream = null;
      }
      if (this._audioCtx) {
        this._audioCtx.close().catch(() => {});
        this._audioCtx = null;
      }
      this._analyser = null;
    }

    _float32ToInt16(float32Array) {
      const int16 = new Int16Array(float32Array.length);
      for (let i = 0; i < float32Array.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Array[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      return int16;
    }

    /* ────────────────────────────────────────────
       AUDIO LEVEL MONITOR (for orb animation)
       ──────────────────────────────────────────── */

    _startLevelMonitor() {
      if (!this._analyser) return;
      const buf = new Uint8Array(this._analyser.frequencyBinCount);

      const tick = () => {
        if (!this._analyser) return;
        this._analyser.getByteFrequencyData(buf);
        // Average energy → normalised 0–1
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        const avg = sum / buf.length / 255;
        this.onAudioLevel(avg);
        this._levelRAF = requestAnimationFrame(tick);
      };
      tick();
    }

    _stopLevelMonitor() {
      if (this._levelRAF) {
        cancelAnimationFrame(this._levelRAF);
        this._levelRAF = null;
      }
      this.onAudioLevel(0);
    }

    /* ────────────────────────────────────────────
       AUDIO PLAYBACK — linear16 24 kHz
       ──────────────────────────────────────────── */

    _ensurePlaybackCtx() {
      if (!this._playbackCtx || this._playbackCtx.state === 'closed') {
        this._playbackCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
      }
      if (this._playbackCtx.state === 'suspended') {
        this._playbackCtx.resume();
      }
    }

    _queueAudioChunk(arrayBuffer) {
      this._ensurePlaybackCtx();

      // Convert Int16 → Float32 for Web Audio
      const int16 = new Int16Array(arrayBuffer);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      // Create AudioBuffer
      const audioBuffer = this._playbackCtx.createBuffer(1, float32.length, 24000);
      audioBuffer.getChannelData(0).set(float32);

      this._playQueue.push(audioBuffer);
      this._drainPlayQueue();
    }

    _drainPlayQueue() {
      if (this._playQueue.length === 0) return;

      const ctx = this._playbackCtx;
      const now = ctx.currentTime;

      // Schedule all queued chunks back-to-back
      while (this._playQueue.length > 0) {
        const buf = this._playQueue.shift();
        const source = ctx.createBufferSource();
        source.buffer = buf;
        source.connect(ctx.destination);

        const startTime = Math.max(now, this._nextPlayTime);
        source.start(startTime);
        this._nextPlayTime = startTime + buf.duration;

        // If this is the last chunk and audio is marked done, fire onSpeakEnd when it finishes
        if (this._audioDoneReceived && this._playQueue.length === 0) {
          source.onended = () => {
            this._audioDoneReceived = false;
            this.isSpeaking = false;
            this.onSpeakEnd();
          };
        }
      }
    }

    _markAudioDone() {
      this._audioDoneReceived = true;
      // If queue is already empty, fire immediately
      if (this._playQueue.length === 0 && this._nextPlayTime <= (this._playbackCtx?.currentTime || 0)) {
        this._audioDoneReceived = false;
        this.isSpeaking = false;
        this.onSpeakEnd();
      }
      // Otherwise _drainPlayQueue will handle it
    }

    _flushPlayback() {
      this._playQueue.length = 0;
      this._nextPlayTime = 0;
      this._audioDoneReceived = false;
      if (this._playbackCtx && this._playbackCtx.state !== 'closed') {
        // Close and recreate to cancel all scheduled sources
        this._playbackCtx.close().catch(() => {});
        this._playbackCtx = null;
      }
    }

    _stopPlayback() {
      this._flushPlayback();
      this.isSpeaking = false;
    }

    /* ────────────────────────────────────────────
       PUBLIC INTERFACE (SpeechEngine-compatible)
       ──────────────────────────────────────────── */

    async startListening() {
      if (this.isListening) return;

      await this.connect();
      await this._startMicCapture();
      this.isListening = true;
      this.onListeningStart();
    }

    stopListening() {
      if (!this.isListening) return;
      this.isListening = false;
      this._stopMicCapture();
      this.onListeningEnd();
    }

    /**
     * speak() is a no-op for Deepgram agent — the agent controls its own TTS.
     * But we keep the method signature so VoiceBotController can call it for greeting.
     * The greeting is handled by Deepgram's agent.greeting setting instead.
     */
    speak(_text) {
      return Promise.resolve();
    }

    stopSpeaking() {
      this._flushPlayback();
      this.isSpeaking = false;
      this.onSpeakEnd();
    }

    interrupt() {
      this.stopSpeaking();
    }

    setLang(_newLang) {
      // Deepgram agent language is set via Settings — runtime switch requires reconnect
      console.log('[Deepgram] Language switch requires reconnect — not yet supported');
    }

    /* ────────────────────────────────────────────
       INTERNALS
       ──────────────────────────────────────────── */

    _send(data) {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        this._ws.send(data);
      }
    }
  }

  /* ════════════════════════════════════════════════════
     §5b  NOTES MANAGER
     ════════════════════════════════════════════════════ */

  class NotesManager {
    constructor(serverUrl, apiKey) {
      this.serverUrl = serverUrl;
      this.apiKey = apiKey || '';
      this.notes = [];
      this.onNotesChange = () => { };   // callback when notes array changes
      this.onNoteSaved = () => { };     // callback for the host page
      this._source = window.location.href;  // track which page the note came from
    }

    _headers(extra = {}) {
      const h = { 'Content-Type': 'application/json', ...extra };
      if (this.apiKey) h['x-api-key'] = this.apiKey;
      return h;
    }

    /* ── Intent Detection ── */

    /**
     * Check if the user's speech is a note-related command.
     * Returns { intent, body } or null if not a note command.
     *
     * Supported intents:
     *   - save      → "take a note <text>", "note that <text>", "save note <text>", "remember <text>"
     *   - save-last → "take a note of it", "note that down", "save that", "remember that"
     *                 (saves a summary of what Vedaa was just saying)
     *   - list      → "read my notes", "show notes", "list notes", "what are my notes"
     *   - clear     → "delete all notes", "clear my notes"
     */
    detectIntent(text) {
      const t = text.toLowerCase().trim();

      // ── Save-last patterns (referential — "save THAT", "note IT down") ──
      // These must be checked BEFORE general save patterns to avoid false matches.
      const saveLastPatterns = [
        /^(?:take\s+a\s+note\s+of\s+(?:it|that|this|what\s+you\s+said|what\s+you\s+just\s+said))$/i,
        /^(?:note\s+(?:that|this|it)\s+down)$/i,
        /^(?:save\s+(?:that|this|it))$/i,
        /^(?:remember\s+(?:that|this|it))$/i,
        /^(?:write\s+(?:that|this|it)\s+down)$/i,
        /^(?:jot\s+(?:that|this|it)\s+down)$/i,
        /^(?:make\s+a\s+note\s+of\s+(?:it|that|this))$/i,
        /^(?:add\s+(?:that|this|it)\s+(?:to|as)\s+(?:a\s+)?note)$/i,
        /^(?:can\s+you\s+(?:take\s+a\s+note|note\s+that|save\s+that|remember\s+that))$/i,
        /^(?:please\s+(?:take\s+a\s+note|note\s+that|save\s+that))$/i,
        /^(?:note\s+(?:it|that))$/i,
        /^(?:take\s+(?:a\s+)?note)$/i,
      ];
      for (const pattern of saveLastPatterns) {
        if (pattern.test(t)) return { intent: 'save-last', body: null };
      }

      // ── Save patterns (explicit content) ──
      const savePatterns = [
        /^(?:take\s+a\s+note)\s+(.+)/i,
        /^(?:make\s+a\s+note)\s+(.+)/i,
        /^(?:save\s+(?:a\s+)?note)\s+(.+)/i,
        /^(?:note\s+(?:that|this|down)?)\s+(.+)/i,
        /^(?:remember\s+(?:that|this)?)\s+(.+)/i,
        /^(?:write\s+(?:down|this|that)?)\s+(.+)/i,
        /^(?:add\s+(?:a\s+)?note)\s+(.+)/i,
        /^(?:jot\s+down)\s+(.+)/i,
      ];

      for (const pattern of savePatterns) {
        const match = t.match(pattern);
        if (match && match[1] && match[1].trim().length > 1) {
          return { intent: 'save', body: match[1].trim() };
        }
      }

      // ── List patterns ──
      const listPatterns = [
        /^(?:read|show|list|get|view)\s+(?:my\s+)?notes/i,
        /^(?:what\s+are\s+my\s+notes)/i,
        /^(?:do\s+i\s+have\s+(?:any\s+)?notes)/i,
        /^(?:my\s+notes)/i,
        /^(?:open\s+notes)/i,
      ];
      for (const pattern of listPatterns) {
        if (pattern.test(t)) return { intent: 'list', body: null };
      }

      // ── Clear/Delete patterns ──
      const clearPatterns = [
        /^(?:delete|clear|remove)\s+(?:all\s+)?(?:my\s+)?notes/i,
      ];
      for (const pattern of clearPatterns) {
        if (pattern.test(t)) return { intent: 'clear', body: null };
      }

      return null;
    }

    /* ── API Calls ── */

    async saveNote(text, tags = []) {
      try {
        const res = await fetch(`${this.serverUrl}/api/notes`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({ text, source: this._source, tags }),
        });
        const data = await res.json();
        if (data.note) {
          this.notes.push(data.note);
          this.onNotesChange(this.notes);
          this.onNoteSaved(data.note);
        }
        return data.note;
      } catch (err) {
        console.error('[Notes] Save error:', err);
        return null;
      }
    }

    async loadNotes() {
      try {
        const headers = {};
        if (this.apiKey) headers['x-api-key'] = this.apiKey;
        const res = await fetch(`${this.serverUrl}/api/notes`, { headers });
        const data = await res.json();
        this.notes = data.notes || [];
        this.onNotesChange(this.notes);
        return this.notes;
      } catch (err) {
        console.error('[Notes] Load error:', err);
        return [];
      }
    }

    async deleteNote(id) {
      try {
        const headers = {};
        if (this.apiKey) headers['x-api-key'] = this.apiKey;
        await fetch(`${this.serverUrl}/api/notes/${id}`, { method: 'DELETE', headers });
        this.notes = this.notes.filter(n => n.id !== id);
        this.onNotesChange(this.notes);
      } catch (err) {
        console.error('[Notes] Delete error:', err);
      }
    }

    async clearAll() {
      const toDelete = [...this.notes];
      for (const note of toDelete) {
        await this.deleteNote(note.id);
      }
    }

    get count() { return this.notes.length; }
  }

  /* ════════════════════════════════════════════════════
     §6  WAKE WORD DETECTOR
     ════════════════════════════════════════════════════ */

  class WakeWordDetector {
    constructor(lang, wakeWord) {
      this.lang = lang;
      this.wakeWord = wakeWord.toLowerCase().trim();
      this.recognition = null;
      this.isRunning = false;
      this.isPaused = false;
      this.onWakeWordDetected = () => { };
      this.onStatusChange = () => { };
      this._restartTimer = null;
      this._cooldown = false;

      // Build a list of fuzzy variants the wake word might be heard as
      this._variants = this._buildVariants(this.wakeWord);
    }

    _buildVariants(phrase) {
      // "hey vedaa" can be misheard in many ways. Build a fuzzy match set.
      const variants = new Set();
      variants.add(phrase);                          // hey vedaa
      variants.add(phrase.replace(/aa$/, 'a'));       // hey veda
      variants.add(phrase.replace(/aa$/, ''));        // hey ved
      variants.add(phrase.replace('vedaa', 'vida'));  // hey vida
      variants.add(phrase.replace('vedaa', 'veeda')); // hey veeda
      variants.add(phrase.replace('vedaa', 'vidu'));  // hey vidu
      variants.add(phrase.replace('vedaa', 'beta'));  // hey beta
      variants.add(phrase.replace('vedaa', 'veda'));  // hey veda
      variants.add(phrase.replace('vedaa', 'vidal')); // hey vidal
      variants.add(phrase.replace('vedaa', 'vado'));  // hey vado
      variants.add(phrase.replace('vedaa', 'weda'));  // hey weda
      variants.add(phrase.replace('vedaa', 'weather')); // hey weather (common misrecog)
      variants.add(phrase.replace('vedaa', 'vader'));  // hey vader (very common)
      variants.add(phrase.replace('vedaa', 'video'));  // hey video
      variants.add(phrase.replace('vedaa', 'veda'));   // hey veda
      variants.add(phrase.replace('vedaa', 'vedha'));  // hey vedha
      variants.add(phrase.replace('vedaa', 'vidal'));  // hey vidal
      variants.add(phrase.replace('vedaa', 'veda'));   // hey veda
      variants.add(phrase.replace('vedaa', 'reader')); // hey reader
      variants.add(phrase.replace('vedaa', 'weeder')); // hey weeder
      variants.add(phrase.replace('vedaa', 'cedar'));   // hey cedar
      variants.add(phrase.replace('vedaa', 'peter'));   // hey peter (misrecog)
      variants.add(phrase.replace('vedaa', 'feeder'));  // hey feeder
      variants.add(phrase.replace('vedaa', 'leader'));  // hey leader
      variants.add(phrase.replace('hey', 'hay'));     // hay vedaa
      variants.add(phrase.replace('hey', 'he'));      // he vedaa
      variants.add(phrase.replace('hey', 'a'));       // a vedaa
      variants.add(phrase.replace('hey', 'hey'));     // hey vedaa (no-op, just in case)
      // Without the space
      variants.add('heyvedaa');
      variants.add('heyveda');
      // Just the name (without "hey") — user might just say "vedaa"
      variants.add('vedaa');
      variants.add('veda');
      variants.add('vader');
      variants.add('vida');
      return [...variants].map(v => v.toLowerCase());
    }

    _matchesWakeWord(text) {
      const normalized = text.toLowerCase().trim()
        .replace(/[.,!?;:'"]/g, '')    // strip punctuation
        .replace(/\s+/g, ' ');       // collapse whitespace

      // Check exact substring match for any variant
      for (const variant of this._variants) {
        if (normalized.includes(variant)) return true;
      }

      // Check if the text contains "hey" followed by something close to "vedaa"
      const heyMatch = normalized.match(/\b(?:hey|hay|he|a)\s+(\w+)/);
      if (heyMatch) {
        const nameHeard = heyMatch[1];
        // Check fuzzy match of just the name part against vedaa/veda variants
        const nameVariants = ['vedaa', 'veda', 'vader', 'vida', 'veeda', 'vidu', 'beta', 'weda', 'video', 'vedha', 'cedar', 'feeder'];
        for (const nv of nameVariants) {
          if (this._fuzzyMatch(nameHeard, nv)) return true;
        }
      }

      // Check if the text ends with something close (Levenshtein-like loose match)
      const words = normalized.split(' ');
      for (let i = 0; i < words.length - 1; i++) {
        const twoWord = words[i] + ' ' + words[i + 1];
        for (const variant of this._variants) {
          if (this._fuzzyMatch(twoWord, variant)) return true;
        }
      }

      return false;
    }

    _fuzzyMatch(a, b) {
      // Allow up to 3 character differences for short phrases
      if (Math.abs(a.length - b.length) > 4) return false;
      let diff = 0;
      const maxLen = Math.max(a.length, b.length);
      for (let i = 0; i < maxLen; i++) {
        if (a[i] !== b[i]) diff++;
        if (diff > 3) return false;
      }
      return true;
    }

    start() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        console.warn('WakeWordDetector: SpeechRecognition not supported.');
        return;
      }

      if (this.isRunning) return;

      this.recognition = new SR();
      this.recognition.lang = this.lang;
      this.recognition.interimResults = true;
      this.recognition.continuous = true;
      this.recognition.maxAlternatives = 3;

      this.recognition.onresult = (e) => {
        if (this.isPaused || this._cooldown) return;

        for (let i = e.resultIndex; i < e.results.length; i++) {
          const isFinal = e.results[i].isFinal;
          // Check all alternatives for each result
          for (let alt = 0; alt < e.results[i].length; alt++) {
            const transcript = e.results[i][alt].transcript;
            if (this._matchesWakeWord(transcript)) {
              console.log('[WakeWord] ✅ Detected wake word in:', transcript);
              this._cooldown = true;
              // Stop recognition FIRST — then notify (avoids race with open())
              this.pause();
              this.onWakeWordDetected();
              setTimeout(() => { this._cooldown = false; }, 3000);
              return;
            }
          }
          // Log what was heard but not matched (only for final results to reduce noise)
          if (isFinal) {
            const heard = e.results[i][0].transcript;
            console.log('[WakeWord] 👂 Heard (no match):', heard);
          }
        }
      };

      this.recognition.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        console.warn('[WakeWord] Error:', e.error);
      };

      this.recognition.onend = () => {
        // Auto-restart unless intentionally paused
        if (this.isRunning && !this.isPaused) {
          clearTimeout(this._restartTimer);
          this._restartTimer = setTimeout(() => {
            if (this.isRunning && !this.isPaused) {
              try {
                this.recognition.start();
              } catch (_) { }
            }
          }, 300);
        }
      };

      this.isRunning = true;
      this.isPaused = false;

      try {
        this.recognition.start();
        this.onStatusChange('listening');
        console.log('[WakeWord] Listening for "' + this.wakeWord + '"...');
      } catch (e) {
        console.warn('[WakeWord] Could not start:', e.message);
      }
    }

    pause() {
      this.isPaused = true;
      clearTimeout(this._restartTimer);
      if (this.recognition) {
        try { this.recognition.abort(); } catch (_) { }
      }
      this.onStatusChange('paused');
    }

    resume() {
      if (!this.isRunning) { this.start(); return; }
      this.isPaused = false;
      clearTimeout(this._restartTimer);
      this._restartTimer = setTimeout(() => {
        if (this.isRunning && !this.isPaused) {
          try {
            this.recognition.start();
            this.onStatusChange('listening');
            console.log('[WakeWord] Resumed listening...');
          } catch (_) { }
        }
      }, 500);
    }

    stop() {
      this.isRunning = false;
      this.isPaused = false;
      clearTimeout(this._restartTimer);
      if (this.recognition) {
        try { this.recognition.abort(); } catch (_) { }
        this.recognition = null;
      }
      this.onStatusChange('stopped');
    }
  }

  /* ════════════════════════════════════════════════════
     §6b  CHAT RENDERER
     ════════════════════════════════════════════════════ */

  /**
   * Manages the chat panel — adds message bubbles, detects tabular content,
   * renders tables, handles typing indicators, and auto-scrolls.
   */
  class ChatRenderer {
    constructor(messagesEl) {
      this.messagesEl = messagesEl;
      this._typingEl = null;
    }

    /* ── Public API ── */

    /**
     * Add a message bubble to the chat.
     * @param {'user'|'bot'} role
     * @param {string} text — plain text or may contain [source: ...] tags
     * @param {Array} [tables] — structured table data from server [{columns, rows, tableName}]
     * @param {Array} [charts] — chart data from server [{type, title, labels, datasets}]
     */
    addMessage(role, text, tables, charts, toolCalls, timing) {
      this._removeTyping();

      const row = document.createElement('div');
      row.className = `vb-msg-row vb-msg-row-${role}`;

      // Avatar
      const avatar = document.createElement('div');
      avatar.className = 'vb-msg-avatar';
      if (role === 'bot') {
        avatar.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a2 2 0 0 1 2 2c-.004 5.55-.425 10.38-1.5 14.5a15 15 0 0 1 4-1c.642 0 1.258.077 1.83.21a2 2 0 0 1 1.67 1.96v.05A2.3 2.3 0 0 1 17.7 22H6.3A2.3 2.3 0 0 1 4 19.72v-.05A2 2 0 0 1 5.67 17.7c.572-.133 1.188-.21 1.83-.21a15 15 0 0 1 4 1C10.425 14.38 10.004 9.55 10 4a2 2 0 0 1 2-2z"/></svg>`;
      } else {
        avatar.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
      }
      row.appendChild(avatar);

      // Body container
      const body = document.createElement('div');
      body.className = 'vb-msg-body';

      // Sender label
      const sender = document.createElement('div');
      sender.className = 'vb-msg-sender';
      sender.textContent = role === 'bot' ? 'Vedaa' : 'You';
      body.appendChild(sender);

      // Text content
      const textEl = document.createElement('div');
      textEl.className = 'vb-msg-text';

      if (role === 'bot') {
        // Parse out [source: ...] citation
        let source = '';
        const sourceMatch = text.match(/\[source:\s*([^\]]+)\]/i);
        if (sourceMatch) {
          source = sourceMatch[1].trim();
          text = text.replace(sourceMatch[0], '').trim();
        }

        // If server sent structured tables, render those directly
        if (tables && tables.length > 0) {
          const cleanText = this._stripPipeTable(text);
          if (cleanText) {
            textEl.innerHTML = `<div>${this._escapeHtml(cleanText).replace(/\n/g, '<br>')}</div>`;
          }
          for (const t of tables) {
            const label = t.tableName ? `<div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:4px;">📋 ${this._escapeHtml(t.tableName)}${t.rowCount > t.rows.length ? ` (showing ${t.rows.length} of ${t.rowCount})` : ''}</div>` : '';
            const tableHtml = this._renderAutoTable(
              t.columns,
              t.rows.map(row => t.columns.map(col => row[col] !== undefined ? row[col] : '—')),
              ''
            );
            textEl.innerHTML += label + tableHtml;
          }
        } else {
          const contentHtml = this._renderContent(text);
          textEl.innerHTML = contentHtml;
        }

        if (source) {
          const badge = document.createElement('div');
          badge.className = 'vb-msg-source';
          badge.innerHTML = '📌 ' + this._escapeHtml(source) + ' <span class="vb-source-chevron">▶</span>';

          // Build the expandable tool details panel
          const detailsWrap = document.createElement('div');
          detailsWrap.className = 'vb-tool-details';

          const detailsInner = document.createElement('div');
          detailsInner.className = 'vb-tool-details-inner';

          if (toolCalls && toolCalls.length > 0) {
            toolCalls.forEach((tc, idx) => {
              const item = document.createElement('div');
              item.className = 'vb-tool-call-item';

              const nameEl = document.createElement('div');
              nameEl.className = 'vb-tool-call-name';
              nameEl.textContent = tc.tool;
              item.appendChild(nameEl);

              const argsEl = document.createElement('div');
              argsEl.className = 'vb-tool-call-args';
              // Format arguments — highlight SQL if present
              const args = tc.arguments || {};
              if (args.sql) {
                argsEl.innerHTML = this._highlightSql(args.sql);
              } else if (args.database && Object.keys(args).length === 1) {
                argsEl.textContent = 'database: ' + args.database;
              } else {
                argsEl.textContent = JSON.stringify(args, null, 2);
              }
              item.appendChild(argsEl);

              detailsInner.appendChild(item);
              if (idx < toolCalls.length - 1) {
                const hr = document.createElement('hr');
                hr.className = 'vb-tool-call-divider';
                detailsInner.appendChild(hr);
              }
            });
          } else {
            detailsInner.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:10px;">No tool call details available</div>';
          }

          detailsWrap.appendChild(detailsInner);

          // Toggle on click
          badge.addEventListener('click', () => {
            badge.classList.toggle('vb-source-open');
            detailsWrap.classList.toggle('vb-tool-open');
          });

          textEl.appendChild(badge);
          textEl.appendChild(detailsWrap);
        }

        // Render charts
        if (charts && charts.length > 0) {
          for (const chartData of charts) {
            this._renderChart(textEl, chartData, { compact: true });
          }
        }
      } else {
        textEl.innerHTML = `<div>${this._escapeHtml(text)}</div>`;
      }

      body.appendChild(textEl);

      // Timing badge (for bot messages)
      if (role === 'bot' && timing) {
        const timingEl = document.createElement('div');
        timingEl.className = 'vb-msg-timing';
        const totalSec = (timing.totalMs / 1000).toFixed(1);
        const llmSec = (timing.llmMs / 1000).toFixed(1);
        const toolSec = (timing.toolMs / 1000).toFixed(1);
        timingEl.innerHTML = `⏱ ${totalSec}s` +
          `<span class="vb-timing-detail"> (LLM ${llmSec}s` +
          (timing.toolMs > 0 ? ` · API ${toolSec}s` : '') +
          (timing.rounds > 1 ? ` · ${timing.rounds} rounds` : '') +
          `)</span>`;
        timingEl.title = `Total: ${timing.totalMs}ms | LLM: ${timing.llmMs}ms | Tools: ${timing.toolMs}ms | Rounds: ${timing.rounds}`;
        body.appendChild(timingEl);
      }

      // Timestamp
      const timeEl = document.createElement('div');
      timeEl.className = 'vb-msg-time';
      timeEl.textContent = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      body.appendChild(timeEl);

      row.appendChild(body);
      this.messagesEl.appendChild(row);
      this._scrollToBottom();
    }

    /** Show typing indicator */
    showTyping() {
      this._removeTyping();

      const row = document.createElement('div');
      row.className = 'vb-msg-row vb-msg-row-bot';
      row.id = 'vb-typing-indicator';

      const avatar = document.createElement('div');
      avatar.className = 'vb-msg-avatar';
      avatar.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a2 2 0 0 1 2 2c-.004 5.55-.425 10.38-1.5 14.5a15 15 0 0 1 4-1c.642 0 1.258.077 1.83.21a2 2 0 0 1 1.67 1.96v.05A2.3 2.3 0 0 1 17.7 22H6.3A2.3 2.3 0 0 1 4 19.72v-.05A2 2 0 0 1 5.67 17.7c.572-.133 1.188-.21 1.83-.21a15 15 0 0 1 4 1C10.425 14.38 10.004 9.55 10 4a2 2 0 0 1 2-2z"/></svg>`;

      const body = document.createElement('div');
      body.className = 'vb-msg-body';

      const sender = document.createElement('div');
      sender.className = 'vb-msg-sender';
      sender.textContent = 'Vedaa';
      body.appendChild(sender);

      const textEl = document.createElement('div');
      textEl.className = 'vb-msg-text';
      textEl.innerHTML = `<div class="vb-msg-typing">
        <span class="vb-msg-typing-label">Thinking</span>
        <div class="vb-msg-typing-wave"><span></span><span></span><span></span><span></span></div>
      </div>`;
      body.appendChild(textEl);

      row.appendChild(avatar);
      row.appendChild(body);

      this._typingEl = row;
      this.messagesEl.appendChild(row);
      this._scrollToBottom();
    }

    /** Remove typing indicator */
    _removeTyping() {
      if (this._typingEl) {
        this._typingEl.remove();
        this._typingEl = null;
      }
    }

    /* ── Smart Content Detection & Rendering ── */

    /**
     * Detect whether text contains tabular data and render appropriately.
     * Handles: pipe tables, comma-lists, numbered lists, and plain text.
     */
    _renderContent(text) {
      // 0. Check if text contains fenced code blocks (```...```)
      if (/```/.test(text)) {
        return this._renderWithCodeBlocks(text);
      }

      // 1. Try to detect markdown-style pipe tables ( | col1 | col2 | )
      if (this._isPipeTable(text)) {
        return this._renderPipeTable(text);
      }

      // 2. Try to detect structured list data — lines with consistent key:value or delimiter pattern
      const tableData = this._detectTabularText(text);
      if (tableData) {
        return this._renderAutoTable(tableData.headers, tableData.rows, tableData.preamble);
      }

      // 3. Detect numbered/bulleted lists and render nicely
      if (this._isList(text)) {
        return this._renderList(text);
      }

      // 4. Plain text — render inline code (`...`) and line breaks
      return `<div>${this._formatInlineMarkdown(this._escapeHtml(text))}</div>`;
    }

    /**
     * Render text that contains fenced code blocks (```lang ... ```).
     * Splits into prose segments and code cards.
     */
    _renderWithCodeBlocks(text) {
      const parts = [];
      const regex = /```(\w*)\n?([\s\S]*?)```/g;
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(text)) !== null) {
        // Text before this code block
        const before = text.slice(lastIndex, match.index).trim();
        if (before) {
          parts.push({ type: 'text', content: before });
        }
        parts.push({
          type: 'code',
          lang: match[1] || '',
          content: match[2].replace(/^\n+|\n+$/g, '') // trim leading/trailing newlines
        });
        lastIndex = regex.lastIndex;
      }

      // Text after last code block
      const after = text.slice(lastIndex).trim();
      if (after) {
        parts.push({ type: 'text', content: after });
      }

      let html = '';
      for (const part of parts) {
        if (part.type === 'code') {
          const langLabel = part.lang || 'code';
          const codeId = 'vb-code-' + Math.random().toString(36).slice(2, 8);
          html += `<div class="vb-code-card">`;
          html += `<div class="vb-code-header">`;
          html += `<span class="vb-code-lang">${this._escapeHtml(langLabel)}</span>`;
          html += `<button class="vb-code-copy" data-code-id="${codeId}" onclick="(function(btn){var c=document.getElementById('${codeId}');if(c){navigator.clipboard.writeText(c.textContent).then(function(){btn.textContent='Copied!';btn.classList.add('vb-copied');setTimeout(function(){btn.textContent='Copy';btn.classList.remove('vb-copied')},1500)}).catch(function(){})}})(this)">Copy</button>`;
          html += `</div>`;
          html += `<div class="vb-code-body"><pre><code id="${codeId}">${this._escapeHtml(part.content)}</code></pre></div>`;
          html += `</div>`;
        } else {
          // Render prose segment — could be table, list, or plain text
          const rendered = this._renderProseSegment(part.content);
          html += rendered;
        }
      }

      return html;
    }

    /**
     * Render a prose segment (non-code-block text) — checks for tables, lists, plain text.
     */
    _renderProseSegment(text) {
      if (this._isPipeTable(text)) return this._renderPipeTable(text);
      const tableData = this._detectTabularText(text);
      if (tableData) return this._renderAutoTable(tableData.headers, tableData.rows, tableData.preamble);
      if (this._isList(text)) return this._renderList(text);
      return `<div>${this._formatInlineMarkdown(this._escapeHtml(text))}</div>`;
    }

    /**
     * Format inline markdown: `code`, **bold**, *italic*
     */
    _formatInlineMarkdown(html) {
      // Inline code: `...`
      html = html.replace(/`([^`]+)`/g, '<span class="vb-inline-code">$1</span>');
      // Bold: **...**
      html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      // Italic: *...*
      html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      // Line breaks
      html = html.replace(/\n/g, '<br>');
      return html;
    }

    /* ── Pipe Table ( | a | b | ) ── */

    _isPipeTable(text) {
      const lines = text.trim().split('\n');
      let pipeLines = 0;
      for (const line of lines) {
        if (line.trim().startsWith('|') && line.trim().endsWith('|') && line.includes('|')) pipeLines++;
      }
      return pipeLines >= 2;
    }

    _renderPipeTable(text) {
      const lines = text.trim().split('\n');
      const preamble = [];
      const tableLines = [];
      let inTable = false;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
          inTable = true;
          // Skip separator rows ( |---|---| )
          if (/^\|[\s\-:]+\|$/.test(trimmed.replace(/\|/g, '|').replace(/[^|:\-\s]/g, ''))) continue;
          const cells = trimmed.slice(1, -1).split('|').map(c => c.trim());
          tableLines.push(cells);
        } else if (!inTable) {
          preamble.push(trimmed);
        }
      }

      if (tableLines.length < 2) return `<div>${this._escapeHtml(text).replace(/\n/g, '<br>')}</div>`;

      const headers = tableLines[0];
      const rows = tableLines.slice(1);
      return this._renderAutoTable(headers, rows, preamble.join(' '));
    }

    /* ── Auto-detect tabular text ── */

    /**
     * Detect patterns like:
     *   - "Name: Amar, Department: Engineering, Salary: 95000"
     *   - Repeated "key: value" lines across multiple entries
     *   - CSV-like comma/tab separated lines with a header
     */
    _detectTabularText(text) {
      const lines = text.trim().split('\n').filter(l => l.trim());

      // Pattern A: Multiple lines each with ≥2 "Key: Value" pairs (comma-separated)
      const kvLines = [];
      const nonKvPreamble = [];
      for (const line of lines) {
        const pairs = line.match(/[\w\s]+:\s*[^,]+/g);
        if (pairs && pairs.length >= 2) {
          kvLines.push(pairs.map(p => {
            const [k, ...v] = p.split(':');
            return { key: k.trim(), value: v.join(':').trim() };
          }));
        } else {
          if (kvLines.length === 0) nonKvPreamble.push(line);
        }
      }

      if (kvLines.length >= 1) {
        // Build table from key-value pairs
        const allKeys = [];
        const seen = new Set();
        for (const row of kvLines) {
          for (const { key } of row) {
            if (!seen.has(key.toLowerCase())) {
              seen.add(key.toLowerCase());
              allKeys.push(key);
            }
          }
        }
        const headers = allKeys;
        const rows = kvLines.map(row => {
          const map = {};
          row.forEach(({ key, value }) => { map[key.toLowerCase()] = value; });
          return headers.map(h => map[h.toLowerCase()] || '—');
        });
        return { headers, rows, preamble: nonKvPreamble.join(' ') };
      }

      // Pattern B: CSV-like (first line looks like header, rest have same number of commas)
      if (lines.length >= 3) {
        const sep = lines[0].includes('\t') ? '\t' : ',';
        const headerCells = lines[0].split(sep).map(c => c.trim());
        if (headerCells.length >= 2) {
          const dataLines = lines.slice(1);
          const rows = [];
          let consistent = true;
          for (const dl of dataLines) {
            const cells = dl.split(sep).map(c => c.trim());
            if (Math.abs(cells.length - headerCells.length) <= 1) {
              rows.push(cells);
            } else {
              consistent = false;
              break;
            }
          }
          if (consistent && rows.length >= 1) {
            return { headers: headerCells, rows, preamble: '' };
          }
        }
      }

      return null;
    }

    /* ── Render a table from headers + rows ── */

    _renderAutoTable(headers, rows, preamble) {
      let html = '';
      if (preamble) {
        html += `<div style="margin-bottom:6px">${this._escapeHtml(preamble)}</div>`;
      }
      html += '<div class="vb-table-wrap"><table>';
      html += '<thead><tr>' + headers.map(h => `<th>${this._escapeHtml(h)}</th>`).join('') + '</tr></thead>';
      html += '<tbody>';
      for (const row of rows) {
        html += '<tr>' + row.map(cell => `<td>${this._escapeHtml(this._fmtCell(cell))}</td>`).join('') + '</tr>';
      }
      html += '</tbody></table></div>';
      return html;
    }

    /* ── Chart Rendering (Chart.js) ── */

    /**
     * Color palettes for charts — stock-market inspired.
     * Green = profit/gains, Red = loss, Gold = highlights, Blue = neutral.
     */
    static CHART_COLORS = [
      'rgba(0, 200, 117, 0.85)',    // market green (profit)
      'rgba(255, 68, 68, 0.85)',    // market red (loss)
      'rgba(255, 193, 7, 0.85)',    // gold (highlight)
      'rgba(33, 150, 243, 0.85)',   // blue (neutral)
      'rgba(0, 230, 180, 0.75)',    // teal green
      'rgba(255, 109, 0, 0.85)',    // amber/orange
      'rgba(156, 39, 176, 0.85)',   // purple (accent)
      'rgba(0, 176, 255, 0.85)',    // sky blue
      'rgba(255, 145, 77, 0.85)',   // coral
      'rgba(100, 221, 23, 0.85)',   // lime green
    ];
    static CHART_BORDERS = [
      'rgba(0, 200, 117, 1)',
      'rgba(255, 68, 68, 1)',
      'rgba(255, 193, 7, 1)',
      'rgba(33, 150, 243, 1)',
      'rgba(0, 230, 180, 1)',
      'rgba(255, 109, 0, 1)',
      'rgba(156, 39, 176, 1)',
      'rgba(0, 176, 255, 1)',
      'rgba(255, 145, 77, 1)',
      'rgba(100, 221, 23, 1)',
    ];

    /**
     * Render a Chart.js chart into a container element.
     * @param {HTMLElement} container — parent element to insert the chart into
     * @param {object} chartData — { type, title, labels, datasets }
     * @param {object} [options] — { compact: boolean } for chat bubble vs orb
     */
    _renderChart(container, chartData, options = {}) {
      if (!window.Chart) {
        console.warn('📊 Chart.js not loaded yet');
        container.innerHTML = '<div style="padding:12px;color:rgba(255,255,255,0.5);font-size:13px;">⏳ Loading chart engine…</div>';
        // Retry after Chart.js loads
        setTimeout(() => {
          if (window.Chart) {
            container.innerHTML = '';
            this._renderChart(container, chartData, options);
          }
        }, 1500);
        return;
      }

      const chartEl = document.createElement('div');
      chartEl.className = 'vb-chart-container';

      // Title
      if (chartData.title) {
        const titleEl = document.createElement('div');
        titleEl.className = 'vb-chart-label';
        titleEl.textContent = '📊 ' + chartData.title;
        chartEl.appendChild(titleEl);
      }

      // Chart type toolbar (let user switch)
      const supportedTypes = ['bar', 'line', 'pie', 'doughnut', 'polarArea', 'radar'];
      const toolbar = document.createElement('div');
      toolbar.className = 'vb-chart-toolbar';
      const typeLabels = { bar: '📊 Bar', line: '📈 Line', pie: '🥧 Pie', doughnut: '🍩 Donut', polarArea: '🎯 Polar', radar: '🕸️ Radar' };
      let currentType = chartData.type === 'horizontalBar' ? 'bar' : (chartData.type || 'bar');

      for (const t of supportedTypes) {
        const btn = document.createElement('button');
        btn.className = 'vb-chart-type-btn' + (t === currentType ? ' active' : '');
        btn.textContent = typeLabels[t] || t;
        btn.addEventListener('click', () => {
          toolbar.querySelectorAll('.vb-chart-type-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          rebuildChart(t);
        });
        toolbar.appendChild(btn);
      }
      chartEl.appendChild(toolbar);

      // Canvas
      const canvas = document.createElement('canvas');
      canvas.style.width = '100%';
      canvas.style.maxHeight = options.compact ? '220px' : '320px';
      chartEl.appendChild(canvas);
      container.appendChild(chartEl);

      // Build / rebuild chart
      let chartInstance = null;

      const rebuildChart = (type) => {
        if (chartInstance) chartInstance.destroy();
        currentType = type;

        const isPie = ['pie', 'doughnut', 'polarArea'].includes(type);
        const isHorizontal = chartData.type === 'horizontalBar' && type === 'bar';

        // Detect current theme from DOM
        const isLight = !!document.querySelector('#vb-root.vb-light');
        const tickColor = isLight ? 'rgba(30,30,30,0.5)' : 'rgba(255,255,255,0.5)';
        const gridColor = isLight ? 'rgba(0,200,117,0.06)' : 'rgba(0,200,117,0.08)';
        const brdColor = isLight ? 'rgba(0,200,117,0.1)' : 'rgba(0,200,117,0.12)';
        const legendClr = isLight ? 'rgba(30,30,30,0.65)' : 'rgba(255,255,255,0.7)';
        const tooltipBg = isLight ? 'rgba(255,255,255,0.97)' : 'rgba(10,10,20,0.95)';
        const tooltipT = isLight ? '#1a1a2e' : '#00c875';
        const tooltipB = isLight ? 'rgba(30,30,30,0.8)' : 'rgba(255,255,255,0.85)';
        const tooltipBrd = isLight ? 'rgba(0,200,117,0.15)' : 'rgba(0,200,117,0.2)';

        // Check if this is P&L / profit-loss data (color bars green/red dynamically)
        const isPnL = /p\s*[&n]\s*l|profit|loss|change|gain|return/i.test(chartData.title || '');

        const datasets = (chartData.datasets || []).map((ds, i) => {
          const baseColor = ChatRenderer.CHART_COLORS[i % ChatRenderer.CHART_COLORS.length];
          const borderColor = ChatRenderer.CHART_BORDERS[i % ChatRenderer.CHART_BORDERS.length];

          if (isPie) {
            return {
              ...ds,
              backgroundColor: ds.data.map((_, j) => ChatRenderer.CHART_COLORS[j % ChatRenderer.CHART_COLORS.length]),
              borderColor: ds.data.map((_, j) => ChatRenderer.CHART_BORDERS[j % ChatRenderer.CHART_BORDERS.length]),
              borderWidth: 2,
            };
          }

          // P&L bars: green for positive, red for negative
          if (isPnL && (type === 'bar' || type === 'horizontalBar')) {
            return {
              ...ds,
              backgroundColor: ds.data.map(v => v >= 0 ? 'rgba(0,200,117,0.8)' : 'rgba(255,68,68,0.8)'),
              borderColor: ds.data.map(v => v >= 0 ? 'rgba(0,200,117,1)' : 'rgba(255,68,68,1)'),
              borderWidth: 1,
              borderRadius: 6,
            };
          }

          return {
            ...ds,
            backgroundColor: type === 'line'
              ? baseColor.replace(/[\d.]+\)$/, '0.12)')
              : baseColor,
            borderColor: borderColor,
            borderWidth: type === 'line' ? 2.5 : 1,
            pointBackgroundColor: borderColor,
            pointBorderColor: isLight ? '#fff' : '#0a0a14',
            pointBorderWidth: 2,
            pointRadius: type === 'line' ? 4 : 0,
            pointHoverRadius: type === 'line' ? 7 : 0,
            tension: 0.35, // smooth lines
            fill: type === 'line',
            borderRadius: type === 'bar' ? 6 : 0,
          };
        });

        chartInstance = new Chart(canvas, {
          type: type,
          data: {
            labels: chartData.labels || [],
            datasets: datasets,
          },
          options: {
            indexAxis: isHorizontal ? 'y' : 'x',
            responsive: true,
            maintainAspectRatio: false,
            animation: {
              duration: 800,
              easing: 'easeOutQuart',
            },
            plugins: {
              legend: {
                display: (chartData.datasets || []).length > 1 || isPie,
                position: 'bottom',
                labels: {
                  color: legendClr,
                  font: { family: "'Inter', 'SF Pro', system-ui, sans-serif", size: 11 },
                  padding: 12,
                  usePointStyle: true,
                  pointStyleWidth: 8,
                },
              },
              tooltip: {
                backgroundColor: tooltipBg,
                titleColor: tooltipT,
                bodyColor: tooltipB,
                borderColor: tooltipBrd,
                borderWidth: 1,
                cornerRadius: 10,
                padding: 12,
                titleFont: { family: "'Inter', sans-serif", weight: '600', size: 13 },
                bodyFont: { family: "'Inter', sans-serif", size: 12 },
                displayColors: true,
                callbacks: {
                  label: function (ctx) {
                    let label = ctx.dataset.label || '';
                    if (label) label += ': ';
                    const v = ctx.parsed.y !== undefined ? ctx.parsed.y : ctx.parsed;
                    if (typeof v === 'number') {
                      // Format as ₹ currency for stock data
                      const formatted = Math.abs(v) >= 100
                        ? '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : (Number.isInteger(v) ? String(v) : v.toFixed(2));
                      const arrow = isPnL ? (v >= 0 ? ' ▲' : ' ▼') : '';
                      label += formatted + arrow;
                    } else {
                      label += v;
                    }
                    return label;
                  },
                },
              },
            },
            scales: isPie ? {} : {
              x: {
                ticks: { color: tickColor, font: { size: 11 }, maxRotation: 45 },
                grid: { color: gridColor, lineWidth: 0.5 },
                border: { color: brdColor },
              },
              y: {
                beginAtZero: !isPnL,
                ticks: {
                  color: tickColor,
                  font: { size: 11 },
                  callback: function(value) {
                    if (Math.abs(value) >= 10000000) return '₹' + (value/10000000).toFixed(1) + 'Cr';
                    if (Math.abs(value) >= 100000) return '₹' + (value/100000).toFixed(1) + 'L';
                    if (Math.abs(value) >= 1000) return '₹' + (value/1000).toFixed(1) + 'K';
                    return value;
                  },
                },
                grid: { color: gridColor, lineWidth: 0.5 },
                border: { color: brdColor },
              },
            },
          },
        });
      };

      // Initial render
      rebuildChart(currentType);
      return chartInstance;
    }

    /* ── List Detection & Rendering ── */

    _isList(text) {
      const lines = text.trim().split('\n').filter(l => l.trim());
      if (lines.length < 2) return false;
      let listLines = 0;
      for (const line of lines) {
        if (/^\s*(\d+[\.\)]\s|[-•*]\s)/.test(line)) listLines++;
      }
      return listLines >= 2 && listLines >= lines.length * 0.5;
    }

    _renderList(text) {
      const lines = text.trim().split('\n');
      let html = '';
      let inList = false;
      const isOrdered = /^\s*\d+[\.\)]/.test(lines.find(l => /^\s*(\d+[\.\)]\s|[-•*]\s)/.test(l)) || '');
      const tag = isOrdered ? 'ol' : 'ul';

      for (const line of lines) {
        const trimmed = line.trim();
        if (/^\s*(\d+[\.\)]\s|[-•*]\s)/.test(trimmed)) {
          if (!inList) { html += `<${tag} style="margin:4px 0;padding-left:20px;">`; inList = true; }
          const content = trimmed.replace(/^\s*(\d+[\.\)]\s*|[-•*]\s*)/, '');
          html += `<li style="margin:2px 0;color:rgba(255,255,255,0.85);">${this._escapeHtml(content)}</li>`;
        } else {
          if (inList) { html += `</${tag}>`; inList = false; }
          html += `<div style="margin:4px 0;">${this._escapeHtml(trimmed)}</div>`;
        }
      }
      if (inList) html += `</${tag}>`;
      return html;
    }

    /* ── Utilities ── */

    /**
     * Strip markdown pipe-table lines from text so we don't show both the
     * structured HTML table AND the raw pipe-table the LLM may have generated.
     */
    _stripPipeTable(text) {
      if (!text) return '';
      return text
        .split('\n')
        .filter(line => {
          const t = line.trim();
          // Remove separator lines  |---|---|
          if (/^\|[\s\-:|]+\|$/.test(t)) return false;
          // Remove data / header lines  | a | b |
          if (/^\|.+\|$/.test(t)) return false;
          return true;
        })
        .join('\n')
        .trim();
    }

    _scrollToBottom() {
      requestAnimationFrame(() => {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      });
    }

    /** Format a cell value — round floats to 2 decimal places */
    _fmtCell(val) {
      if (val === undefined || val === null) return '—';
      // Handle nested objects/arrays — avoid [object Object]
      if (typeof val === 'object') {
        try { return JSON.stringify(val); } catch (_) { return '—'; }
      }
      const s = String(val);
      // If it looks like a decimal number with more than 2 decimal places, round it
      if (/^-?\d+\.\d{3,}$/.test(s.trim())) {
        return parseFloat(s).toFixed(2);
      }
      return s;
    }

    /** Highlight SQL keywords in a query string */
    _highlightSql(sql) {
      const escaped = this._escapeHtml(sql);
      const keywords = /\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AND|OR|NOT|IN|AS|ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|DISTINCT|COUNT|SUM|AVG|MIN|MAX|LIKE|BETWEEN|IS|NULL|UNION|ALL|EXISTS|CASE|WHEN|THEN|ELSE|END|CAST|COALESCE|TOP)\b/gi;
      const strings = /('(?:[^'\\]|\\.)*')/g;
      let result = escaped.replace(strings, '<span class="vb-sql-string">$1</span>');
      result = result.replace(keywords, '<span class="vb-sql-keyword">$1</span>');
      return result;
    }

    _escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }
  }

  /* ════════════════════════════════════════════════════
     §6.6  WORKFLOW RECORDER (Training Mode)
     ════════════════════════════════════════════════════ */

  class WorkflowRecorder {
    constructor(serverUrl, apiKey) {
      this.serverUrl = serverUrl;
      this.apiKey = apiKey || '';
      this.isRecording = false;
      this.workflowId = null;
      this.stepCount = 0;
      this.listeners = [];
    }

    _headers() {
      const h = { 'Content-Type': 'application/json' };
      if (this.apiKey) h['x-api-key'] = this.apiKey;
      return h;
    }

    async startRecording(workflowName, description) {
      if (this.isRecording) {
        return { success: false, error: 'Already recording' };
      }

      try {
        const res = await fetch(`${this.serverUrl}/api/chat`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({
            message: `Start training workflow: "${workflowName}" - ${description} - Start URL: ${window.location.href}`,
            conversationHistory: [],
            lang: 'en-IN'
          })
        });

        if (!res.ok) throw new Error('Failed to start training');

        this.isRecording = true;
        this.stepCount = 0;
        this.attachListeners();

        return { success: true, message: `Recording "${workflowName}". Perform your workflow steps.` };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    attachListeners() {
      // Record clicks
      const clickHandler = (e) => {
        if (this.isRecording && !e.target.closest('#vb-overlay')) {
          this.recordClick(e.target);
        }
      };

      // Record form inputs
      const changeHandler = (e) => {
        if (this.isRecording && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
          this.recordFormFill(e.target);
        }
      };

      document.addEventListener('click', clickHandler, true);
      document.addEventListener('change', changeHandler, true);

      this.listeners.push(
        { type: 'click', handler: clickHandler },
        { type: 'change', handler: changeHandler }
      );
    }

    detachListeners() {
      for (const { type, handler } of this.listeners) {
        document.removeEventListener(type, handler, true);
      }
      this.listeners = [];
    }

    recordClick(element) {
      const selector = this.getSelector(element);
      const text = element.textContent?.trim().substring(0, 50) || element.value || '';

      this.recordStep({
        type: 'click',
        description: `Click on "${text || selector}"`,
        selector,
        elementText: text,
        elementType: element.tagName.toLowerCase(),
        url: window.location.href
      });
    }

    recordFormFill(element) {
      const selector = this.getSelector(element);
      const fieldName = element.name || element.id || element.placeholder || selector;
      const fieldValue = element.value;

      const validation = {};
      if (element.required) validation.required = true;
      if (element.pattern) validation.pattern = element.pattern;
      if (element.minLength) validation.minLength = element.minLength;

      this.recordStep({
        type: element.tagName === 'SELECT' ? 'select' : 'fill',
        description: `Fill "${fieldName}" with value`,
        selector,
        fieldName,
        fieldValue: fieldValue.substring(0, 100), // Truncate for privacy
        validation: Object.keys(validation).length > 0 ? validation : null,
        url: window.location.href
      });
    }

    async recordStep(stepData) {
      this.stepCount++;

      try {
        await fetch(`${this.serverUrl}/api/chat`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({
            message: `Record step: ${JSON.stringify(stepData)}`,
            conversationHistory: [],
            lang: 'en-IN'
          })
        });
      } catch (err) {
        console.error('[WorkflowRecorder] Failed to record step:', err);
      }
    }

    async stopRecording() {
      if (!this.isRecording) {
        return { success: false, error: 'Not recording' };
      }

      this.detachListeners();
      this.isRecording = false;

      try {
        const res = await fetch(`${this.serverUrl}/api/chat`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({
            message: 'Finish training workflow',
            conversationHistory: [],
            lang: 'en-IN'
          })
        });

        return {
          success: true,
          message: `Workflow saved with ${this.stepCount} steps`
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }

    getSelector(element) {
      if (element.id) return `#${element.id}`;
      if (element.name) return `[name="${element.name}"]`;
      if (element.className) {
        const classes = element.className.split(' ').filter(c => c.trim()).slice(0, 2);
        if (classes.length) return `.${classes.join('.')}`;
      }
      return element.tagName.toLowerCase();
    }
  }

  /* ════════════════════════════════════════════════════
     §7  MAIN VOICEBOT CONTROLLER
     ════════════════════════════════════════════════════ */


  class VoiceBotController {
    constructor(config) {
      this.config = { ...DEFAULTS, ...config };
      this.state = STATES.IDLE;
      this.conversationHistory = [];
      this.isOpen = false;
      this._lastAssistantResponse = '';  // Track what Vedaa last said (for "note that down")
      this._sessionId = 'vb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7); // Unique session for intent tracking

      // Build
      injectStyles();
      this.root = buildDOM(this.config);

      // Load Chart.js from CDN (for graph/chart generation)
      this._loadChartJS();

      // DOM refs
      this.triggerBtn = document.getElementById('vb-trigger');
      this.overlay = document.getElementById('vb-overlay');
      this.canvas = document.getElementById('vb-canvas');
      this.statusEl = document.getElementById('vb-status');
      this.contentArea = document.getElementById('vb-content-area');
      this.transcriptEl = document.getElementById('vb-transcript');
      this.tableDisplayEl = document.getElementById('vb-table-display');
      this._orbDataCleared = true; // Track whether orb data has been cleared for current cycle
      this.closeBtn = document.getElementById('vb-close');
      this.errorEl = document.getElementById('vb-error');
      this.wakeIndicator = document.getElementById('vb-wake-indicator');
      this.wakeLabel = document.getElementById('vb-wake-label');

      // Theme toggle
      this.themeToggleBtn = document.getElementById('vb-theme-toggle');
      this._lightTheme = false;
      this._restoreTheme(); // Restore from localStorage

      // Mini orb mode refs (mic transforms to orb)
      this.miniOrb = document.getElementById('vb-mini-orb');
      this.miniCanvas = document.getElementById('vb-mini-canvas');
      this.miniTranscript = document.getElementById('vb-mini-transcript');
      this.miniTranscriptStatus = document.getElementById('vb-mini-transcript-status');
      this.miniTranscriptText = document.getElementById('vb-mini-transcript-text');
      this.miniOrbActive = false;

      // Systems
      this.orb = new OrbRenderer(this.canvas);
      this.miniOrbRenderer = new OrbRenderer(this.miniCanvas);
      this._deepgramMode = !!this.config.deepgramEnabled;

      if (this._deepgramMode) {
        this.speech = new DeepgramVoiceAgent({
          apiKey: this.config.deepgramApiKey,
          serverUrl: this.config.serverUrl,
          appApiKey: this.config.apiKey,
          settings: this.config.deepgramSettings,
          greeting: this.config.greeting,
        });
      } else {
        this.speech = new SpeechEngine(this.config.lang, this.config.voiceGender);
      }

      // Notes system
      this.notes = new NotesManager(this.config.serverUrl, this.config.apiKey);
      this.notesPanelOpen = false;
      this.notesBtn = document.getElementById('vb-notes-btn');
      this.notesBadge = document.getElementById('vb-notes-badge');
      this.notesPanel = document.getElementById('vb-notes-panel');
      this.notesList = document.getElementById('vb-notes-list');
      this.notesClosePanel = document.getElementById('vb-notes-close-panel');
      this.noteToast = document.getElementById('vb-note-toast');

      this.notes.onNotesChange = (notes) => this._renderNotes(notes);
      this.notes.onNoteSaved = (note) => {
        // Dispatch event for host page
        if (this.config.onNote) this.config.onNote(note);
        window.dispatchEvent(new CustomEvent('vedaa:note', { detail: note }));
      };

      // Pre-load notes
      this.notes.loadNotes();

      // Chat system
      this.chatPanelOpen = false;
      this.chatToggleBtn = document.getElementById('vb-chat-toggle');
      this.chatPanel = document.getElementById('vb-chat-panel');
      this.chatMessages = document.getElementById('vb-chat-messages');
      this.chatInput = document.getElementById('vb-chat-input');
      this.chatSendBtn = document.getElementById('vb-chat-send');
      this.chatMicBtn = document.getElementById('vb-chat-mic');
      this.chatMinimizeBtn = document.getElementById('vb-chat-minimize');
      this.chatFullscreenBtn = document.getElementById('vb-chat-fullscreen');
      this._chatFullscreen = false;
      this.chatRenderer = new ChatRenderer(this.chatMessages);

      // Resizable chat panel
      this._chatResizeHandle = this.chatPanel.querySelector('.vb-chat-resize-handle');
      this._initChatResize();

      // Workflow training system
      this.workflowRecorder = new WorkflowRecorder(this.config.serverUrl, this.config.apiKey);
      this.trainingIndicator = document.getElementById('vb-training-indicator');
      this.trainingStepCount = this.trainingIndicator.querySelector('.vb-step-count');

      // Wake word detector
      this.wakeWordDetector = null;
      if (this.config.wakeWordEnabled) {
        this._initWakeWord();
      }

      this._bindEvents();
      this._bindSpeech();

      // Pre-load voices & re-pick when available
      if (window.speechSynthesis) {
        window.speechSynthesis.getVoices();
        window.speechSynthesis.onvoiceschanged = () => {
          window.speechSynthesis.getVoices();
          this.speech._pickVoice();  // Re-pick once voices are loaded
        };
      }
    }

    /** Build fetch headers — includes x-api-key when configured */
    _headers(extra = {}) {
      const h = { 'Content-Type': 'application/json', ...extra };
      if (this.config.apiKey) h['x-api-key'] = this.config.apiKey;
      return h;
    }

    /* ── Wake Word Init ── */

    _initWakeWord() {
      this.wakeWordDetector = new WakeWordDetector(
        this.config.lang,
        this.config.wakeWord
      );

      this.wakeWordDetector.onWakeWordDetected = () => {
        // Flash the indicator
        if (this.wakeIndicator) {
          this.wakeIndicator.classList.add('vb-heard');
          if (this.wakeLabel) this.wakeLabel.textContent = 'Waking up…';
          setTimeout(() => {
            this.wakeIndicator.classList.remove('vb-heard');
            if (this.wakeLabel) this.wakeLabel.textContent = 'Say "Hey Vedaa"';
          }, 1200);
        }
        // Close mini orb if active, open full orb mode
        if (this.miniOrbActive) {
          this.closeMiniOrb();
        }
        if (!this.isOpen) {
          this.open();
        }
      };

      this.wakeWordDetector.onStatusChange = (status) => {
        if (this.wakeIndicator) {
          if (status === 'listening') {
            this.wakeIndicator.classList.add('vb-active');
          } else {
            this.wakeIndicator.classList.remove('vb-active');
          }
        }
      };

      // Start listening for wake word after a short delay (let page load)
      setTimeout(() => {
        this.wakeWordDetector.start();
      }, 1500);
    }

    /* ── Chart.js CDN Loader ── */

    _loadChartJS() {
      if (window.Chart) return; // already loaded
      if (document.getElementById('vb-chartjs-cdn')) return;
      const script = document.createElement('script');
      script.id = 'vb-chartjs-cdn';
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js';
      script.async = true;
      script.onload = () => console.log('📊 Chart.js loaded');
      document.head.appendChild(script);
    }

    /* ── Event Bindings ── */

    _bindEvents() {
      // Mic button click → open full overlay with chat panel
      this.triggerBtn.addEventListener('click', () => {
        this.open();
        // Auto-open chat panel so user can type or speak
        setTimeout(() => this._toggleChat(true), 400);
      });

      // Click mini orb to close or expand to full mode
      this.miniCanvas.addEventListener('click', () => {
        if (this.miniOrbActive) {
          // Close mini orb
          this.closeMiniOrb();
        }
      });

      // Close overlay
      this.closeBtn.addEventListener('click', () => this.close());

      // Theme toggle
      this.themeToggleBtn.addEventListener('click', () => this._toggleTheme());

      // ESC to close
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          if (this.miniOrbActive) { this.closeMiniOrb(); return; }
          // Exit fullscreen first, then close chat
          if (this.isOpen && this._chatFullscreen) { this._toggleChatFullscreen(false); return; }
          if (this.isOpen && this.chatPanelOpen) { this._toggleChat(false); return; }
          if (this.isOpen && this.notesPanelOpen) { this._toggleNotesPanel(); return; }
          if (this.isOpen) { this.close(); return; }
        }
      });

      // Tap canvas to toggle listening / interrupt
      this.canvas.addEventListener('click', () => {
        if (this.state === STATES.SPEAKING) {
          this.speech.interrupt();
        } else if (this.state === STATES.IDLE || this.state === STATES.ERROR) {
          this._startConversation();
        } else if (this.state === STATES.LISTENING) {
          this.speech.stopListening();
        }
      });

      // Notes button
      this.notesBtn.addEventListener('click', () => this._toggleNotesPanel());
      this.notesClosePanel.addEventListener('click', () => this._toggleNotesPanel());

      // Language toggle — cycles through available languages on each click
      const langToggle = document.getElementById('vb-lang-toggle');
      if (langToggle) {
        langToggle.addEventListener('click', () => {
          const langs = Object.keys(this.config.languages || {});
          if (langs.length < 2) return;
          const currentIdx = langs.indexOf(this.config.lang);
          const nextIdx = (currentIdx + 1) % langs.length;
          this.switchLanguage(langs[nextIdx]);
        });
      }

      // ── Chat panel events ──
      this.chatToggleBtn.addEventListener('click', () => this._toggleChat());
      this.chatMinimizeBtn.addEventListener('click', () => this._toggleChat(false));
      this.chatFullscreenBtn.addEventListener('click', () => this._toggleChatFullscreen());

      // Send on click
      this.chatSendBtn.addEventListener('click', () => this._chatSend());

      // Send on Enter
      this.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this._chatSend();
        }
      });

      // Mic button in chat — quick voice input
      this._chatMicActive = false;
      this._chatMicRecognition = null;
      this.chatMicBtn.addEventListener('click', () => this._toggleChatMic());
    }

    /* ── Language Switching ── */

    switchLanguage(newLang) {
      const langInfo = this.config.languages?.[newLang];
      if (!langInfo) return;

      // Stop any current activity
      if (this.speech.isSpeaking) this.speech.stopSpeaking();
      if (this.speech.isListening) this.speech.stopListening();

      // Update config
      this.config.lang = newLang;

      // Update speech engine language + voice
      this.speech.setLang(newLang);

      // Update wake word detector language
      if (this.wakeWordDetector && this.wakeWordDetector.recognition) {
        this.wakeWordDetector.lang = newLang;
        if (this.wakeWordDetector.recognition) {
          this.wakeWordDetector.recognition.lang = newLang;
        }
      }

      // Update toggle UI — badge label
      const langLabel = document.getElementById('vb-lang-label');
      if (langLabel) langLabel.textContent = newLang.toUpperCase();

      // Speak a confirmation in the new language
      const greeting = langInfo.greeting || `Switched to ${langInfo.name}`;
      this.statusEl.textContent = langInfo.name;
      this.speech.speak(greeting);

      console.log(`[VoiceBot] Language switched to ${newLang} (${langInfo.name})`);
    }

    /* ── Theme Toggle ── */

    _toggleTheme() {
      this._lightTheme = !this._lightTheme;
      this._applyTheme();
      try { localStorage.setItem('vb-theme', this._lightTheme ? 'light' : 'dark'); } catch (_) { /* ignore */ }
    }

    _restoreTheme() {
      try {
        const saved = localStorage.getItem('vb-theme');
        if (saved === 'light') this._lightTheme = true;
      } catch (_) { /* ignore */ }
      this._applyTheme();
    }

    _applyTheme() {
      if (this._lightTheme) {
        this.root.classList.add('vb-light');
      } else {
        this.root.classList.remove('vb-light');
      }
      // Update Chart.js instances if any are visible — they need re-coloring for grid/tick/legend
      this._updateChartsForTheme();
    }

    /** Reconfigure visible Chart.js instances for current theme */
    _updateChartsForTheme() {
      const isLight = this._lightTheme;
      const tickColor = isLight ? 'rgba(30,20,60,0.45)' : 'rgba(255,255,255,0.5)';
      const gridColor = isLight ? 'rgba(30,20,60,0.06)' : 'rgba(255,255,255,0.05)';
      const borderColor = isLight ? 'rgba(30,20,60,0.1)' : 'rgba(255,255,255,0.1)';
      const legendColor = isLight ? 'rgba(30,20,60,0.6)' : 'rgba(255,255,255,0.7)';
      const tooltipBg = isLight ? 'rgba(255,255,255,0.97)' : 'rgba(10,6,20,0.95)';
      const tooltipTitle = isLight ? '#1e143c' : '#fff';
      const tooltipBody = isLight ? 'rgba(30,20,60,0.75)' : 'rgba(255,255,255,0.85)';
      const tooltipBorder = isLight ? 'rgba(30,20,60,0.1)' : 'rgba(255,255,255,0.1)';

      if (!window.Chart) return;
      const allCharts = Object.values(Chart.instances || {});
      for (const chart of allCharts) {
        // Update legend
        if (chart.options?.plugins?.legend?.labels) {
          chart.options.plugins.legend.labels.color = legendColor;
        }
        // Update tooltip
        if (chart.options?.plugins?.tooltip) {
          Object.assign(chart.options.plugins.tooltip, {
            backgroundColor: tooltipBg,
            titleColor: tooltipTitle,
            bodyColor: tooltipBody,
            borderColor: tooltipBorder,
          });
        }
        // Update scales
        for (const axis of ['x', 'y']) {
          if (chart.options?.scales?.[axis]) {
            if (chart.options.scales[axis].ticks) chart.options.scales[axis].ticks.color = tickColor;
            if (chart.options.scales[axis].grid) chart.options.scales[axis].grid.color = gridColor;
            if (chart.options.scales[axis].border) chart.options.scales[axis].border.color = borderColor;
          }
        }
        chart.update('none');
      }
    }

    _bindSpeech() {
      const s = this.speech;

      s.onListeningStart = () => {
        this._setState(STATES.LISTENING);
        this.statusEl.textContent = 'Listening…';
        this.statusEl.classList.add('vb-active');
        // Don't clear transcript or table data yet — keep previous results
        // visible until the user actually starts speaking (cleared in onInterim)
      };

      s.onInterim = (text) => {
        // User started speaking — now clear previous data
        if (!this._orbDataCleared) {
          this._orbDataCleared = true;
          this._clearOrbTable();
        }
        this.transcriptEl.classList.remove('vb-rich');
        this.transcriptEl.textContent = text;
        this.transcriptEl.classList.add('vb-highlight');
      };

      s.onResult = (text) => {
        // Also clear here in case onInterim didn't fire
        if (!this._orbDataCleared) {
          this._orbDataCleared = true;
          this._clearOrbTable();
        }

        this.transcriptEl.textContent = text;
        this.transcriptEl.classList.add('vb-highlight');

        // In Deepgram mode, the agent has its own LLM — don't call _sendMessage.
        // Just show the user's text; the agent will respond via onAgentText.
        if (this._deepgramMode) {
          // Add user message to chat panel
          this.chatRenderer.addMessage('user', text);
          this.conversationHistory.push({ role: 'user', content: text });
          return;
        }

        this.speech.stopListening();

        // ── Check for note intent before sending to AI ──
        const noteIntent = this.notes.detectIntent(text);
        if (noteIntent) {
          this._handleNoteIntent(noteIntent, text);
          return;
        }

        this._sendMessage(text);
      };

      s.onListeningEnd = () => {
        if (this.state === STATES.LISTENING) {
          // No result received — go idle
          this._setState(STATES.IDLE);
          this.statusEl.textContent = 'Say "Hey Vedaa" or tap the orb';
          this.statusEl.classList.remove('vb-active');
        }
      };

      s.onSpeakStart = () => {
        this._setState(STATES.SPEAKING);
        this.statusEl.textContent = 'Speaking… (say something to interrupt)';
        this.statusEl.classList.add('vb-active');
      };

      s.onSpeakEnd = () => {
        if (this.state === STATES.SPEAKING) {
          this._setState(STATES.IDLE);
          this.statusEl.textContent = 'Say "Hey Vedaa" or tap the orb';
          this.statusEl.classList.remove('vb-active');
          // Keep transcript and table/chart data visible below the orb
          // — they'll be cleared when the user starts speaking next (onListeningStart)
          // Auto-listen after speaking — delay to let TTS audio fully dissipate
          setTimeout(() => {
            if (this.isOpen && this.state === STATES.IDLE) {
              this._startConversation();
            }
          }, 1500);
        }
      };

      s.onAudioLevel = (level) => {
        this.orb.setAudioLevel(level);
      };

      s.onBargeIn = (partialText) => {
        console.log('[VoiceBot] Barge-in detected — switching to listening');
        this._clearOrbTable();

        // Switch to listening state — mic will capture the user's full sentence
        this._setState(STATES.LISTENING);
        this.statusEl.textContent = 'Hmm... listening'; // Conversational filler!
        this.statusEl.classList.add('vb-active');

        // Show partial text immediately so user visually feels instantly heard
        if (partialText) {
          this.transcriptEl.textContent = partialText + '...';
          this.transcriptEl.classList.add('vb-highlight');
        } else {
          this.transcriptEl.textContent = '';
          this.transcriptEl.classList.remove('vb-highlight');
        }
        this.transcriptEl.classList.remove('vb-rich');
      };

      s.onError = (err) => {
        this._showError(err);
        this._setState(STATES.ERROR);
        this.statusEl.textContent = 'Something went wrong';
        setTimeout(() => {
          if (this.state === STATES.ERROR) {
            this._setState(STATES.IDLE);
            this.statusEl.textContent = 'Say "Hey Vedaa" or tap the orb';
          }
        }, 3000);
      };

      /* ── Deepgram-specific callbacks ── */
      if (this._deepgramMode && s.onAgentText !== undefined) {
        s.onAgentText = (text) => {
          // Agent's spoken response text — show in transcript and chat
          this._lastAssistantResponse = text;
          this.conversationHistory.push({ role: 'assistant', content: text });
          this.chatRenderer.addMessage('bot', text);
          this._setTranscript(text);
          this.transcriptEl.classList.add('vb-highlight');
        };

        s.onAgentThinking = () => {
          this._setState(STATES.PROCESSING);
          this.statusEl.textContent = 'Thinking…';
        };
      }
    }

    /* ── State Management ── */

    _setState(state) {
      this.state = state;
      this.orb.setState(state);
    }

    /* ── Lifecycle ── */

    open() {
      this.isOpen = true;
      this.overlay.classList.add('vb-visible');
      this.triggerBtn.classList.add('vb-hidden');
      this.orb.start();

      // Pause wake word while bot is active (they share the mic)
      if (this.wakeWordDetector) {
        this.wakeWordDetector.pause();
        if (this.wakeIndicator) this.wakeIndicator.classList.remove('vb-active');
      }

      if (!this.speech.supported) {
        this._showError('Speech recognition is not supported. Please use Chrome or Edge.');
        return;
      }

      // Delay before starting speech to let the wake word recognition
      // fully release the mic (Chrome only allows one SpeechRecognition at a time)
      const startDelay = this.wakeWordDetector ? 800 : 500;

      // ── Deepgram mode: connect WS, greeting handled by agent ──
      if (this._deepgramMode) {
        setTimeout(async () => {
          try {
            this.statusEl.textContent = 'Connecting…';
            await this.speech.connect();
            await this.speech.startListening();
            this.statusEl.textContent = 'Listening…';
            this.statusEl.classList.add('vb-active');
          } catch (e) {
            this._showError(e.message || 'Failed to connect to Deepgram');
          }
        }, startDelay);
        return;
      }

      // Auto-greet on first open
      if (this.conversationHistory.length === 0 && this.config.greeting) {
        setTimeout(() => {
          this.transcriptEl.textContent = this.config.greeting;
          this.transcriptEl.classList.add('vb-highlight');
          this._clearOrbTable();
          this.speech.speak(this.config.greeting).then(() => {
            this.transcriptEl.textContent = '';
            this.transcriptEl.classList.remove('vb-highlight');
            this.transcriptEl.classList.remove('vb-rich');
            // Explicitly start listening after greeting ends
            // (onSpeakEnd auto-listen may not fire reliably in all browsers)
            setTimeout(() => {
              if (this.isOpen && this.state === STATES.IDLE) {
                this._startConversation();
              }
            }, 500);
          });
        }, startDelay);
      } else {
        setTimeout(() => this._startConversation(), startDelay);
      }
    }

    close() {
      this.isOpen = false;
      this.overlay.classList.remove('vb-visible');
      this.overlay.classList.remove('vb-chat-shifted');
      this.triggerBtn.classList.remove('vb-hidden');
      this.orb.stop();
      this.speech.stopSpeaking();
      this.speech.stopListening();
      if (this._deepgramMode && this.speech.disconnect) {
        this.speech.disconnect();
      }
      this._setState(STATES.IDLE);

      // Close chat panel if open
      if (this.chatPanelOpen) {
        this.chatPanelOpen = false;
        this.chatPanel.classList.remove('vb-visible');
        this.chatToggleBtn.classList.remove('vb-chat-open');
      }

      // Stop training if active
      if (this.workflowRecorder.isRecording) {
        this.workflowRecorder.stopRecording();
        this._hideTrainingIndicator();
      }

      // Resume wake word detection after closing
      if (this.wakeWordDetector) {
        setTimeout(() => {
          if (!this.isOpen) {
            this.wakeWordDetector.resume();
          }
        }, 1000);
      }
    }

    /* ── Mini Orb Mode ── */

    openMiniOrb() {
      if (this.miniOrbActive) return;

      this.miniOrbActive = true;

      // Hide mic button, show mini orb only (no transcript)
      this.triggerBtn.classList.add('vb-hidden');
      this.miniOrb.classList.add('vb-show');
      // Don't show transcript: this.miniTranscript.classList.add('vb-show');

      // Start mini orb animation
      this.miniOrbRenderer.setState(STATES.LISTENING);
      this.miniOrbRenderer.start();

      // Pause wake word while in mini orb mode
      if (this.wakeWordDetector) {
        this.wakeWordDetector.pause();
        if (this.wakeIndicator) this.wakeIndicator.classList.remove('vb-active');
      }

      // Start listening immediately
      this._startMiniOrbListening();
    }

    closeMiniOrb() {
      if (!this.miniOrbActive) return;

      this.miniOrbActive = false;

      // Hide mini orb, show mic button
      this.miniOrb.classList.remove('vb-show');
      // this.miniTranscript.classList.remove('vb-show'); // Already hidden
      this.triggerBtn.classList.remove('vb-hidden');

      // Stop mini orb animation
      this.miniOrbRenderer.stop();

      this.speech.stopListening();
      this.speech.stopSpeaking();

      // Resume wake word
      if (this.wakeWordDetector) {
        setTimeout(() => {
          if (!this.miniOrbActive && !this.isOpen) {
            this.wakeWordDetector.resume();
          }
        }, 1000);
      }
    }

    _startMiniOrbListening() {
      const s = this.speech;

      s.onInterim = (text) => {
        // Just animate orb, no text display
        this.miniOrbRenderer.setAudioLevel(0.5); // Pulse while speaking
      };

      s.onFinal = (text) => {
        // Set to processing state
        this.miniOrbRenderer.setState(STATES.PROCESSING);
        this._handleMiniOrbMessage(text);
      };

      s.onEnd = () => {
        // Auto-close after response is spoken
        setTimeout(() => {
          if (this.miniOrbActive) {
            this.closeMiniOrb();
          }
        }, 1000);
      };

      s.startListening();
    }

    async _handleMiniOrbMessage(text) {
      try {
        // Send to server
        const res = await fetch(`${this.config.serverUrl}/api/chat`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({
            message: text,
            conversationHistory: [],
            lang: this.config.lang
          })
        });

        if (!res.ok) throw new Error('Server error');

        const data = await res.json();
        const response = data.response || 'I didn\'t get a response.';
        const voiceText = response.replace(/\[source:\s*[^\]]+\]/gi, '').trim();

        // Clean for TTS: strip pipe tables, markdown, chart blocks
        let ttsText = this.chatRenderer._stripPipeTable(voiceText)
          .replace(/<<<CHART_JSON>>>[\s\S]*?<<<END_CHART>>>/g, '')
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/`([^`]+)`/g, '$1')
          .replace(/#{1,6}\s*/g, '')
          .replace(/\n{2,}/g, '. ')
          .replace(/\s{2,}/g, ' ')
          .trim() || 'Here are the results.';

        // Set to speaking state
        this.miniOrbRenderer.setState(STATES.SPEAKING);

        // Speak response
        await this.speech.speak(ttsText);

        // Close after speaking
        setTimeout(() => {
          if (this.miniOrbActive) {
            this.closeMiniOrb();
          }
        }, 1500);

      } catch (err) {
        // Close on error
        setTimeout(() => {
          if (this.miniOrbActive) {
            this.closeMiniOrb();
          }
        }, 2000);
      }
    }

    /* ── Training Mode ── */

    _handleTrainingCommands(text) {
      const lower = text.toLowerCase();

      // Start training
      if (lower.includes('start training') || lower.includes('begin recording workflow') || lower.includes('record workflow')) {
        // Extract workflow name if provided
        const nameMatch = text.match(/(?:called?|named?)\s+"?([^"]+)"?/i);
        const workflowName = nameMatch ? nameMatch[1] : 'New Workflow';

        this.workflowRecorder.startRecording(workflowName, `Workflow recorded on ${new Date().toLocaleDateString()}`);
        this._showTrainingIndicator();

        return {
          success: true,
          message: `Started recording workflow "${workflowName}". Perform your actions, and I'll record each step. Say "stop training" when done.`
        };
      }

      // Stop training
      if ((lower.includes('stop training') || lower.includes('stop recording') || lower.includes('finish workflow')) && this.workflowRecorder.isRecording) {
        const result = this.workflowRecorder.stopRecording();
        this._hideTrainingIndicator();

        return {
          success: true,
          message: result.message || 'Workflow recording stopped and saved.'
        };
      }

      return null; // Not a training command
    }

    _showTrainingIndicator() {
      this.trainingIndicator.classList.add('vb-show');
      this._updateTrainingStepCount();

      // Poll for step count updates
      this._trainingPollInterval = setInterval(() => {
        if (this.workflowRecorder.isRecording) {
          this._updateTrainingStepCount();
        } else {
          clearInterval(this._trainingPollInterval);
        }
      }, 1000);
    }

    _hideTrainingIndicator() {
      this.trainingIndicator.classList.remove('vb-show');
      if (this._trainingPollInterval) {
        clearInterval(this._trainingPollInterval);
        this._trainingPollInterval = null;
      }
    }

    _updateTrainingStepCount() {
      const count = this.workflowRecorder.stepCount;
      this.trainingStepCount.textContent = `${count} step${count !== 1 ? 's' : ''}`;
    }

    _startConversation() {
      this.speech.startListening();
    }

    /* ── API Communication ── */

    async _sendMessage(text, fromChat = false) {
      this._setState(STATES.PROCESSING);
      this.statusEl.textContent = 'Thinking…';
      this.orb.setAudioLevel(0);

      // Check for training mode commands
      const trainingMatch = this._handleTrainingCommands(text);
      if (trainingMatch) {
        // Training command was handled locally, speak response
        this._setTranscript(trainingMatch.message);
        this.transcriptEl.classList.add('vb-highlight');
        if (!fromChat) {
          await this.speech.speak(trainingMatch.message);
        } else {
          this._setState(STATES.IDLE);
          this.statusEl.textContent = 'Say "Hey Vedaa" or tap the orb';
        }
        return;
      }

      // Add user message to chat panel
      this.chatRenderer.addMessage('user', text);
      this.chatRenderer.showTyping();

      // Add user message to history
      this.conversationHistory.push({ role: 'user', content: text });

      try {
        const res = await fetch(`${this.config.serverUrl}/api/chat`, {
          method: 'POST',
          headers: this._headers(),
          body: JSON.stringify({
            message: text,
            conversationHistory: this.conversationHistory,
            lang: this.config.lang,
            sessionId: this._sessionId,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Server error ${res.status}`);
        }

        const data = await res.json();
        const response = data.response || 'I didn\'t get a response.';
        const tables = data.tables || [];
        const toolCalls = data.toolCalls || [];
        let charts = data.charts || [];
        const timing = data.timing || null;

        // Auto-generate charts from tables if the LLM didn't provide any
        if (tables.length > 0 && charts.length === 0) {
          charts = this._autoChartsFromTables(tables);
        }

        // Track last response (for "note that down" feature)
        this._lastAssistantResponse = response;

        // Add assistant message to history
        this.conversationHistory.push({ role: 'assistant', content: response });

        // Add bot response to chat panel (smart rendering: tables, lists, charts)
        // Pass structured tables, charts, and tool call details from server
        this.chatRenderer.addMessage('bot', response, tables, charts, toolCalls, timing);

        // Show and speak response (voice transcript shows plain text)
        // Strip [source: ...] for voice playback
        const voiceText = response.replace(/\[source:\s*[^\]]+\]/gi, '').trim();

        // Render tables and/or charts below the orb if we have structured data
        const hasTables = (tables && tables.length > 0) || (voiceText.includes('|') && /^\|.+\|$/m.test(voiceText));
        const hasCharts = charts && charts.length > 0;
        if (hasTables || hasCharts) {
          this._renderOrbTables(tables, voiceText, charts);
          // Show only the text summary (strip pipe table lines) in transcript
          const summaryText = this.chatRenderer._stripPipeTable(voiceText);
          this._setTranscript(summaryText || (hasCharts ? 'Here\'s the chart:' : 'Here are the results:'));
        } else {
          this._clearOrbTable();
          this._setTranscript(voiceText);
        }
        this.transcriptEl.classList.add('vb-highlight');

        // Show latency badge below orb transcript
        if (timing) {
          this._showOrbTiming(timing);
        }

        // If sent from chat input, don't speak aloud — just show in chat
        if (!fromChat) {
          // Clean the text for TTS: strip pipe tables, markdown artifacts, chart JSON
          let ttsText = this.chatRenderer._stripPipeTable(voiceText)
            .replace(/<<<CHART_JSON>>>[\s\S]*?<<<END_CHART>>>/g, '')  // remove chart blocks
            .replace(/\*\*([^*]+)\*\*/g, '$1')   // bold → plain
            .replace(/\*([^*]+)\*/g, '$1')        // italic → plain
            .replace(/`([^`]+)`/g, '$1')          // code → plain
            .replace(/#{1,6}\s*/g, '')             // strip heading markers
            .replace(/\n{2,}/g, '. ')              // collapse blank lines → pause
            .replace(/\s{2,}/g, ' ')               // collapse whitespace
            .trim();

          // If we had table data but all text was stripped, provide a spoken summary
          if (!ttsText && (hasTables || hasCharts)) {
            const rowCount = tables.reduce((sum, t) => sum + (t.rows ? t.rows.length : t.rowCount || 0), 0);
            ttsText = rowCount > 0
              ? `Here are the results. I found ${rowCount} row${rowCount !== 1 ? 's' : ''} of data. You can see the table and chart on screen.`
              : 'Here are the results displayed on screen.';
          }

          if (ttsText) {
            await this.speech.speak(ttsText);
          }
        } else {
          // Go back to idle since we're not speaking
          this._setState(STATES.IDLE);
          this.statusEl.textContent = 'Say "Hey Vedaa" or tap the orb';
          this.statusEl.classList.remove('vb-active');
        }

      } catch (err) {
        console.error('VoiceBot API error:', err);
        this.chatRenderer.addMessage('bot', '⚠️ ' + (err.message || 'Failed to reach the server.'));
        this._showError(err.message || 'Failed to reach the server.');
        this._setState(STATES.ERROR);
        this.statusEl.textContent = 'Tap the orb to try again';
        setTimeout(() => {
          if (this.state === STATES.ERROR) {
            this._setState(STATES.IDLE);
            this.statusEl.textContent = 'Tap the orb to speak';
          }
        }, 4000);
      }
    }

    /* ── Orb Table Display ── */

    /**
     * Render structured tables and charts below the orb transcript area.
     * @param {Array} tables — [{columns, rows, tableName, rowCount}]
     * @param {string} text — LLM response text (also check for pipe tables)
     * @param {Array} [charts] — [{type, title, labels, datasets}]
     */
    _renderOrbTables(tables, text, charts) {
      this.tableDisplayEl.innerHTML = '';
      this._orbDataCleared = false; // Reset — new data is now showing

      // 1. Structured tables from server (raw DB rows / API responses)
      if (tables && tables.length > 0) {
        for (const t of tables) {
          const cols = t.columns || (t.rows.length ? Object.keys(t.rows[0]) : []);
          const isStockData = /bajaj|groww|holdings|positions|order|trade|funds|portfolio/i.test(t.tool || t.tableName || '');
          const labelIcon = isStockData ? '📈' : '📋';
          const label = t.tableName
            ? `<div class="vb-td-label">${labelIcon} ${this._escapeHtml(t.tableName)}</div>`
            : '';
          let html = label + '<div class="vb-table-scroll"><table><thead><tr>';
          for (const c of cols) {
            html += `<th>${this._escapeHtml(c)}</th>`;
          }
          html += '</tr></thead><tbody>';
          for (const row of t.rows) {
            html += '<tr>';
            for (const c of cols) {
              if (isStockData) {
                html += `<td>${this._fmtStockCell(row[c], c)}</td>`;
              } else {
                html += `<td>${this._escapeHtml(this._fmtCell(row[c]))}</td>`;
              }
            }
            html += '</tr>';
          }
          html += '</tbody></table></div>';
          if (t.rowCount && t.rowCount > t.rows.length) {
            html += `<div class="vb-td-count">Showing ${t.rows.length} of ${t.rowCount} rows</div>`;
          }
          const wrapper = document.createElement('div');
          wrapper.className = 'vb-table-container' + (isStockData ? ' vb-stock-table' : '');
          wrapper.innerHTML = html;
          this.tableDisplayEl.appendChild(wrapper);
        }
      }

      // 2. Fallback: detect pipe table in LLM text (only if no structured tables)
      if ((!tables || tables.length === 0) && text && text.includes('|')) {
        const lines = text.split('\n');
        const pipeLines = lines.filter(l => l.trim().startsWith('|') && l.trim().endsWith('|'));
        const sepLines = pipeLines.filter(l => /^\|[\s\-:|]+\|$/.test(l.trim()));
        if (pipeLines.length >= 3 && sepLines.length >= 1) {
          // Parse pipe table
          const dataLines = pipeLines.filter(l => !/^\|[\s\-:|]+\|$/.test(l.trim()));
          if (dataLines.length >= 2) {
            const parseRow = line => line.split('|').filter((_, i, a) => i > 0 && i < a.length - 1).map(c => c.trim());
            const headers = parseRow(dataLines[0]);
            let html = '<div class="vb-table-scroll"><table><thead><tr>';
            for (const h of headers) {
              html += `<th>${this._escapeHtml(h)}</th>`;
            }
            html += '</tr></thead><tbody>';
            for (let i = 1; i < dataLines.length; i++) {
              const cells = parseRow(dataLines[i]);
              html += '<tr>';
              for (const cell of cells) {
                html += `<td>${this._escapeHtml(this._fmtCell(cell))}</td>`;
              }
              html += '</tr>';
            }
            html += '</tbody></table></div>';
            const wrapper = document.createElement('div');
            wrapper.className = 'vb-table-container';
            wrapper.innerHTML = html;
            this.tableDisplayEl.appendChild(wrapper);
          }
        }
      }

      // 3. Render charts below the orb (full-size)
      if (charts && charts.length > 0) {
        for (const chartData of charts) {
          this.chatRenderer._renderChart(this.tableDisplayEl, chartData, { compact: false });
        }
      }

      // Auto-scroll content area so new tables/charts are visible
      if (this.contentArea && this.tableDisplayEl.children.length > 0) {
        requestAnimationFrame(() => {
          this.contentArea.scrollTop = this.transcriptEl.offsetHeight + 16;
        });
      }
    }

    /**
     * Auto-generate chart data from structured tables (client-side fallback).
     * Scans each table for numeric columns and builds a bar chart.
     * @param {Array} tables — [{columns, rows, tableName}]
     * @returns {Array} — chart data objects [{type, title, labels, datasets}]
     */
    _autoChartsFromTables(tables) {
      const charts = [];
      for (const t of tables) {
        if (!t.rows || t.rows.length === 0 || !t.columns || t.columns.length < 2) continue;

        const cols = t.columns;
        const toolName = (t.tool || t.tableName || '').toLowerCase();

        // ── SINGLE-ROW tables (Sensex, Nifty, Funds) ──
        // Pivot numeric columns into chart labels so each metric becomes a bar/slice
        if (t.rows.length === 1) {
          const row = t.rows[0];
          const numericEntries = [];
          for (const col of cols) {
            const val = row[col];
            const num = Number(val);
            if (val !== undefined && val !== null && val !== '' && !isNaN(num) && num !== 0) {
              numericEntries.push({ label: col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), value: Math.round(num * 100) / 100 });
            }
          }
          if (numericEntries.length < 2) continue;

          // For index data, pick the most useful metrics (skip noise like finkey, scripcode)
          let entries = numericEntries;
          if (/index|nifty|sensex|stock/i.test(toolName)) {
            const keepKeys = /open|high|low|close|ltp|volume|prevclose|prevClo|52.*high|52.*low|change|value|pchange/i;
            const filtered = numericEntries.filter(e => keepKeys.test(e.label));
            if (filtered.length >= 3) entries = filtered;
          }

          // For funds, show all entries
          const chartTitle = /index|nifty|sensex/i.test(toolName) ? 'Market Index Data'
            : /fund/i.test(toolName) ? 'Fund Summary'
            : (t.tableName || 'Summary').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

          const hasNeg = entries.some(e => e.value < 0);
          const type = hasNeg ? 'bar' : 'bar'; // bar works best for single-row pivoted data

          charts.push({
            type,
            title: chartTitle,
            labels: entries.map(e => e.label),
            datasets: [{
              label: chartTitle,
              data: entries.map(e => e.value),
            }],
          });
          continue;
        }

        // ── MULTI-ROW tables (Holdings, Orderbook, Positions) ──
        // Find the label column (first non-numeric column)
        // and numeric columns (columns where most values are numbers)
        let labelCol = null;
        const numericCols = [];

        for (const col of cols) {
          let numCount = 0;
          for (const row of t.rows) {
            const val = row[col];
            if (val !== undefined && val !== null && val !== '' && val !== '—' && !isNaN(Number(val))) {
              numCount++;
            }
          }
          const ratio = numCount / t.rows.length;
          if (ratio >= 0.6) {
            numericCols.push(col);
          } else if (!labelCol) {
            labelCol = col;
          }
        }

        // Need at least 1 label column and 1 numeric column
        if (!labelCol || numericCols.length === 0) continue;

        const labels = t.rows.map(row => String(row[labelCol] || ''));
        const datasets = numericCols.map(col => ({
          label: col.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          data: t.rows.map(row => {
            const v = Number(row[col]);
            return isNaN(v) ? 0 : Math.round(v * 100) / 100;
          }),
        }));

        // Auto-pick chart type — stock-market-aware
        let type = 'bar';
        const hasNegative = datasets.some(ds => ds.data.some(v => v < 0));

        // Stock-market heuristics
        if (/holdings|portfolio|allocation/i.test(toolName) && numericCols.length === 1 && t.rows.length <= 10) {
          type = 'doughnut'; // portfolio allocation pie
        } else if (/p.*l|profit|loss|pnl|change|return/i.test(toolName) || hasNegative) {
          type = 'bar'; // P&L → bar with green/red coloring
        } else if (/position/i.test(toolName)) {
          type = 'bar';
        } else if (t.rows.length <= 6 && numericCols.length === 1) {
          type = 'doughnut';
        } else if (t.rows.length > 12) {
          type = 'bar';
        }
        // Time-series detection → line chart
        if (labels.some(l => /^\d{4}[-\/]/.test(l) || /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(l))) type = 'line';

        // Build a stock-friendly title
        const chartTitle = /holdings/i.test(toolName) ? 'Portfolio Holdings'
          : /position/i.test(toolName) ? 'Open Positions'
          : /orderbook|order/i.test(toolName) ? 'Order Book'
          : /funds/i.test(toolName) ? 'Fund Allocation'
          : /index|nifty|sensex/i.test(toolName) ? 'Market Index Data'
          : t.tableName || labelCol.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ' Overview';

        charts.push({
          type,
          title: chartTitle,
          labels,
          datasets,
        });
      }
      return charts;
    }

    _clearOrbTable() {
      this.tableDisplayEl.innerHTML = '';
      if (this.contentArea) this.contentArea.scrollTop = 0;
    }

    /**
     * Smart transcript setter — renders code blocks / tables / lists
     * using the same ChatRenderer pipeline as the chat window.
     * Falls back to plain textContent for simple messages.
     */
    _setTranscript(text) {
      const hasCode = /```/.test(text);
      const hasTable = /^\|.+\|$/m.test(text);
      const hasList = /^(\d+[\.\)]\s|[-•]\s)/m.test(text);
      const hasInline = /`[^`]+`/.test(text);

      if (hasCode || hasTable || hasList || hasInline) {
        this.transcriptEl.innerHTML = this.chatRenderer._renderContent(text);
        this.transcriptEl.classList.add('vb-rich');
      } else {
        this.transcriptEl.textContent = text;
        this.transcriptEl.classList.remove('vb-rich');
      }
    }

    /** Show latency breakdown badge below orb transcript */
    _showOrbTiming(timing) {
      // Remove any existing timing badge
      const existing = this.transcriptEl.parentElement?.querySelector('.vb-timing-badge');
      if (existing) existing.remove();

      const totalSec = (timing.totalMs / 1000).toFixed(1);
      const llmSec = (timing.llmMs / 1000).toFixed(1);
      const toolSec = (timing.toolMs / 1000).toFixed(1);

      const badge = document.createElement('div');
      badge.className = 'vb-timing-badge';
      badge.innerHTML = `⏱ ${totalSec}s` +
        `<span class="vb-timing-detail"> (LLM ${llmSec}s` +
        (timing.toolMs > 0 ? ` · API ${toolSec}s` : '') +
        (timing.rounds > 1 ? ` · ${timing.rounds} rounds` : '') +
        `)</span>`;
      badge.title = `Total: ${timing.totalMs}ms | LLM: ${timing.llmMs}ms | Tools: ${timing.toolMs}ms | Rounds: ${timing.rounds}`;
      this.transcriptEl.parentElement?.appendChild(badge);
    }

    /* ── Notes ── */

    async _handleNoteIntent(intent, originalText) {
      switch (intent.intent) {
        case 'save': {
          this._setState(STATES.PROCESSING);
          this.statusEl.textContent = 'Saving note…';
          const note = await this.notes.saveNote(intent.body);
          if (note) {
            this._showNoteToast('✓ Note saved');
            const reply = `Got it! I've saved your note: "${intent.body}"`;
            this._setTranscript(reply);
            this.transcriptEl.classList.add('vb-highlight');
            await this.speech.speak(reply);
          } else {
            const reply = 'Sorry, I couldn\'t save that note. Please try again.';
            this._setTranscript(reply);
            await this.speech.speak(reply);
          }
          break;
        }
        case 'save-last': {
          // User said "note that down" / "save that" — save what Vedaa just said
          if (!this._lastAssistantResponse) {
            const reply = 'I don\'t have anything to save yet. Ask me something first, then say "note that down".';
            this._setTranscript(reply);
            this.transcriptEl.classList.add('vb-highlight');
            await this.speech.speak(reply);
            break;
          }

          this._setState(STATES.PROCESSING);
          this.statusEl.textContent = 'Summarizing & saving…';
          this.transcriptEl.textContent = 'Saving what I just told you…';
          this.transcriptEl.classList.add('vb-highlight');

          // Ask the server to summarize Vedaa's last response into a note
          let summary = this._lastAssistantResponse;
          try {
            const res = await fetch(`${this.config.serverUrl}/api/notes/summarize`, {
              method: 'POST',
              headers: this._headers(),
              body: JSON.stringify({ text: this._lastAssistantResponse }),
            });
            if (res.ok) {
              const data = await res.json();
              if (data.summary) summary = data.summary;
            }
          } catch (err) {
            console.warn('[Notes] Summarize failed, saving full text:', err);
          }

          const note = await this.notes.saveNote(summary, ['from-vedaa']);
          if (note) {
            this._showNoteToast('✓ Note saved');
            const reply = `Done! I've noted that down: "${summary}"`;
            this._setTranscript(reply);
            this.transcriptEl.classList.add('vb-highlight');
            await this.speech.speak(reply);
          } else {
            const reply = 'Sorry, I couldn\'t save that. Please try again.';
            this._setTranscript(reply);
            await this.speech.speak(reply);
          }
          break;
        }
        case 'list': {
          this._setState(STATES.PROCESSING);
          await this.notes.loadNotes();
          this._toggleNotesPanel(true); // open panel
          const count = this.notes.count;
          const reply = count === 0
            ? 'You don\'t have any notes yet. Say "take a note" followed by what you\'d like to remember.'
            : `You have ${count} note${count > 1 ? 's' : ''}. I've opened the notes panel for you.`;
          this._setTranscript(reply);
          this.transcriptEl.classList.add('vb-highlight');
          await this.speech.speak(reply);
          break;
        }
        case 'clear': {
          this._setState(STATES.PROCESSING);
          this.statusEl.textContent = 'Clearing notes…';
          const count = this.notes.count;
          if (count === 0) {
            const reply = 'You don\'t have any notes to clear.';
            this._setTranscript(reply);
            await this.speech.speak(reply);
          } else {
            await this.notes.clearAll();
            const reply = `Done! I've deleted all ${count} note${count > 1 ? 's' : ''}.`;
            this._setTranscript(reply);
            this.transcriptEl.classList.add('vb-highlight');
            await this.speech.speak(reply);
          }
          break;
        }
      }
    }

    _toggleNotesPanel(forceOpen) {
      if (forceOpen === true) {
        this.notesPanelOpen = true;
      } else if (forceOpen === false) {
        this.notesPanelOpen = false;
      } else {
        this.notesPanelOpen = !this.notesPanelOpen;
      }

      if (this.notesPanelOpen) {
        this.notesPanel.classList.add('vb-visible');
        this.notes.loadNotes(); // refresh
      } else {
        this.notesPanel.classList.remove('vb-visible');
      }
    }

    _renderNotes(notes) {
      // Update badge
      if (notes.length > 0) {
        this.notesBadge.textContent = notes.length;
        this.notesBadge.classList.add('vb-visible');
      } else {
        this.notesBadge.classList.remove('vb-visible');
      }

      // Render list
      if (notes.length === 0) {
        this.notesList.innerHTML = `
          <div id="vb-notes-empty">
            <span>📝</span>
            Say "take a note" to save one
          </div>`;
        return;
      }

      this.notesList.innerHTML = notes
        .slice()
        .reverse()  // newest first
        .map(note => {
          const time = new Date(note.createdAt).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
          });
          return `
            <div class="vb-note-item" data-id="${note.id}">
              <div class="vb-note-body">
                <div class="vb-note-text">${this._escapeHtml(note.text)}</div>
                <div class="vb-note-meta">
                  <span class="vb-note-time">${time}</span>
                  <button class="vb-note-delete" data-id="${note.id}" aria-label="Delete note">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              </div>
            </div>`;
        })
        .join('');

      // Bind delete buttons
      this.notesList.querySelectorAll('.vb-note-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.notes.deleteNote(btn.dataset.id);
        });
      });
    }

    _showNoteToast(msg) {
      this.noteToast.textContent = msg;
      this.noteToast.classList.add('vb-show');
      setTimeout(() => this.noteToast.classList.remove('vb-show'), 2500);
    }

    _escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    _fmtCell(value) {
      if (value === null || value === undefined || value === '') return '—';
      const str = String(value);
      const num = Number(str);
      if (!isNaN(num) && str === String(num) && str.includes('.') && str.split('.')[1]?.length > 2) {
        return num.toFixed(2);
      }
      return str;
    }

    /**
     * Format a cell with stock-market-aware coloring.
     * Returns HTML string (not escaped — caller must handle context).
     * Green for positive P&L, red for negative.
     */
    _fmtStockCell(value, colName) {
      if (value === null || value === undefined || value === '') return '—';
      // Handle nested objects/arrays — skip displaying [object Object]
      if (typeof value === 'object') {
        try { return this._escapeHtml(JSON.stringify(value)); } catch (_) { return '—'; }
      }
      const str = String(value);
      const num = Number(str);
      const isPnLCol = /p.*l|profit|loss|pnl|change|return|gain|net|unreali[sz]ed/i.test(colName || '');

      if (!isNaN(num) && str === String(num)) {
        const formatted = Math.abs(num) >= 1000
          ? num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : (str.includes('.') && str.split('.')[1]?.length > 2 ? num.toFixed(2) : str);

        if (isPnLCol) {
          const color = num > 0 ? '#00c875' : num < 0 ? '#ff4444' : 'inherit';
          const arrow = num > 0 ? '▲ ' : num < 0 ? '▼ ' : '';
          return `<span style="color:${color};font-weight:600">${arrow}${formatted}</span>`;
        }
        return formatted;
      }
      return this._escapeHtml(str);
    }

    /* ── Resizable Chat Panel ── */

    _initChatResize() {
      const handle = this._chatResizeHandle;
      if (!handle) return;
      let startX = 0, startW = 0, dragging = false;

      const onMouseDown = (e) => {
        e.preventDefault();
        startX = e.clientX;
        startW = this.chatPanel.offsetWidth;
        dragging = true;
        handle.classList.add('vb-dragging');
        // Disable pointer events on iframes / canvas during drag
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        // Disable panel transition during drag for instant feedback
        this.chatPanel.style.transition = 'none';
        this.overlay.style.transition = 'none';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      };

      const onMouseMove = (e) => {
        if (!dragging) return;
        const delta = startX - e.clientX; // moving left = wider panel
        let newW = Math.max(320, Math.min(700, startW + delta));
        this.root.style.setProperty('--vb-chat-w', newW + 'px');
      };

      const onMouseUp = () => {
        dragging = false;
        handle.classList.remove('vb-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Re-enable transitions
        this.chatPanel.style.transition = '';
        this.overlay.style.transition = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      handle.addEventListener('mousedown', onMouseDown);
    }

    /* ── Chat Panel ── */

    _toggleChat(forceState) {
      const open = forceState !== undefined ? forceState : !this.chatPanelOpen;
      this.chatPanelOpen = open;

      if (open) {
        this.chatPanel.classList.add('vb-visible');
        this.chatToggleBtn.classList.add('vb-chat-open');
        this.overlay.classList.add('vb-chat-shifted');
        // Auto-open the panel if first time — add greeting
        if (this.chatMessages.children.length === 0) {
          const greeting = this.config.languages?.[this.config.lang]?.greeting || this.config.greeting;
          this.chatRenderer.addMessage('bot', greeting);
        }
        // Focus input
        setTimeout(() => this.chatInput.focus(), 300);
      } else {
        this.chatPanel.classList.remove('vb-visible');
        this.chatToggleBtn.classList.remove('vb-chat-open');
        this.overlay.classList.remove('vb-chat-shifted');
        // Exit fullscreen when closing
        if (this._chatFullscreen) {
          this._chatFullscreen = false;
          this.chatPanel.classList.remove('vb-chat-fullscreen');
        }
      }
    }

    _toggleChatFullscreen(forceState) {
      const fs = forceState !== undefined ? forceState : !this._chatFullscreen;
      this._chatFullscreen = fs;

      if (fs) {
        this.chatPanel.classList.add('vb-chat-fullscreen');
        // Hide the orb overlay behind the full-width chat
        this.overlay.classList.remove('vb-chat-shifted');
      } else {
        this.chatPanel.classList.remove('vb-chat-fullscreen');
        // Restore shifted overlay
        if (this.chatPanelOpen) {
          this.overlay.classList.add('vb-chat-shifted');
        }
      }
      // Keep focus on input
      setTimeout(() => this.chatInput.focus(), 100);
    }

    _chatSend() {
      const text = this.chatInput.value.trim();
      if (!text) return;
      this.chatInput.value = '';

      // Check for note intent first
      const noteIntent = this.notes.detectIntent(text);
      if (noteIntent) {
        this.chatRenderer.addMessage('user', text);
        this._handleNoteIntent(noteIntent, text);
        return;
      }

      // Send as typed message (fromChat=true → don't speak aloud)
      this._sendMessage(text, true);
    }

    _toggleChatMic() {
      if (this._chatMicActive) {
        // Stop mic
        this._chatMicActive = false;
        this.chatMicBtn.classList.remove('vb-mic-active');
        this.chatInput.placeholder = 'Type a message…';
        if (this._chatMicRecognition) {
          try { this._chatMicRecognition.stop(); } catch (_) { }
          this._chatMicRecognition = null;
        }
        return;
      }

      // Start mic — use a separate SpeechRecognition instance for the chat input
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        this._showError('Speech recognition not supported in this browser.');
        return;
      }

      // ── Stop any competing SpeechRecognition instances ──
      // Browser allows only one active instance at a time
      this._chatMicWasListening = this.speech.isListening;
      this._chatMicWasSpeaking = (this.state === STATES.SPEAKING);
      if (this.speech.isListening) {
        this.speech.stopListening();
      }
      // Stop barge-in listener if active
      if (this.speech._bargeInRecognition) {
        this.speech._stopBargeInListener();
      }
      // Cancel TTS so barge-in listener doesn't restart
      if (this._chatMicWasSpeaking) {
        this.speech.synthesis.cancel();
      }

      this._chatMicActive = true;
      this.chatMicBtn.classList.add('vb-mic-active');
      this.chatInput.placeholder = 'Listening…';

      const recognition = new SpeechRecognition();
      recognition.lang = this.config.lang;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      this._chatMicRecognition = recognition;

      recognition.onresult = (event) => {
        let final = '';
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            final += event.results[i][0].transcript;
          } else {
            interim += event.results[i][0].transcript;
          }
        }
        this.chatInput.value = final || interim;
      };

      recognition.onend = () => {
        this._chatMicActive = false;
        this.chatMicBtn.classList.remove('vb-mic-active');
        this.chatInput.placeholder = 'Type a message…';
        this._chatMicRecognition = null;
        // Auto-send if we got text
        if (this.chatInput.value.trim()) {
          this._chatSend();
        }
      };

      recognition.onerror = (e) => {
        console.warn('[ChatMic] error:', e.error);
        this._chatMicActive = false;
        this.chatMicBtn.classList.remove('vb-mic-active');
        this.chatInput.placeholder = 'Type a message…';
        this._chatMicRecognition = null;
      };

      try {
        recognition.start();
      } catch (err) {
        console.warn('[ChatMic] start failed:', err);
        this._chatMicActive = false;
        this.chatMicBtn.classList.remove('vb-mic-active');
        this.chatInput.placeholder = 'Type a message…';
        this._chatMicRecognition = null;
      }
    }

    /* ── Notifications ── */

    _showError(msg) {
      this.errorEl.textContent = msg;
      this.errorEl.classList.add('vb-show');
      setTimeout(() => this.errorEl.classList.remove('vb-show'), 5000);
    }
  }

  /* ════════════════════════════════════════════════════
     §8  PUBLIC API
     ════════════════════════════════════════════════════ */

  window.VoiceBot = {
    _instance: null,

    /**
     * Initialise the Voice Bot widget.
     * @param {object} config
     * @param {string} config.serverUrl - Backend URL (required)
     * @param {string} [config.position='bottom-right']
     * @param {string} [config.greeting]
     * @param {string} [config.lang='en-US']
     * @param {number} [config.size=64]
     * @param {string} [config.wakeWord='hey vedaa'] - Wake word phrase
     * @param {boolean} [config.wakeWordEnabled=true] - Enable wake word
     * @param {function} [config.onNote] - Callback when a note is saved: (note) => {}
     * @param {boolean} [config.deepgramEnabled=false] - Use Deepgram Voice Agent (WS) instead of browser speech
     * @param {string} [config.deepgramApiKey] - Deepgram API key (or use server proxy)
     * @param {object} [config.deepgramSettings] - Full Deepgram Settings JSON override
     */
    init(config = {}) {
      if (this._instance) {
        console.warn('VoiceBot is already initialised.');
        return this._instance;
      }
      this._instance = new VoiceBotController(config);
      return this._instance;
    },

    open() { this._instance?.open(); },
    close() { this._instance?.close(); },

    /** Get all notes */
    getNotes() { return this._instance?.notes?.notes || []; },

    /** Save a note programmatically */
    saveNote(text) { return this._instance?.notes?.saveNote(text); },
  };

})();
