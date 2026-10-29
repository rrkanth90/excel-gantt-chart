// Speech-to-text using the browser's built-in recognition (Chrome, Edge,
// Safari incl. iPhone/iPad, Samsung Internet). Text is inserted where the
// cursor is, exactly as if it had been typed.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const LANGUAGES = [
  ['en-IN', 'English (India)'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-AU', 'English (Australia)'],
  ['hi-IN', 'हिन्दी Hindi'], ['te-IN', 'తెలుగు Telugu'], ['ta-IN', 'தமிழ் Tamil'], ['kn-IN', 'ಕನ್ನಡ Kannada'],
  ['ml-IN', 'മലയാളം Malayalam'], ['mr-IN', 'मराठी Marathi'], ['bn-IN', 'বাংলা Bengali'], ['gu-IN', 'ગુજરાતી Gujarati'],
  ['es-ES', 'Español'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'], ['it-IT', 'Italiano'], ['pt-BR', 'Português (Brasil)'],
  ['ja-JP', '日本語'], ['zh-CN', '中文 (普通话)'], ['ar-SA', 'العربية'],
];

const COMMANDS = [
  [/\s*\bnew paragraph\b\s*/gi, '\n\n'],
  [/\s*\bnew line\b\s*/gi, '\n'],
  [/\s*\b(full stop|period)\b/gi, '.'],
  [/\s*\bcomma\b/gi, ','],
  [/\s*\bquestion mark\b/gi, '?'],
  [/\s*\bexclamation (mark|point)\b/gi, '!'],
  [/\s*\bcolon\b/gi, ':'],
];

export function isSupported() {
  return !!Recognition;
}

function shape(text, before, lang) {
  let t = text.trim();
  if (!t) return '';
  if (lang.startsWith('en')) for (const [re, rep] of COMMANDS) t = t.replace(re, rep);
  const prev = before.replace(/[ \t]+$/, '');
  const startOfSentence = prev === '' || /[.!?\n]$/.test(prev);
  if (startOfSentence) t = t.replace(/^(\s*)(\p{Ll})/u, (m, s, c) => s + c.toUpperCase());
  t = t.replace(/([.!?]\s+)(\p{Ll})/gu, (m, p, c) => p + c.toUpperCase());
  t = t.replace(/\n[ \t]+/g, '\n');
  const needsSpace = before !== '' && !/\s$/.test(before) && !/^[\s.,!?:]/.test(t);
  return (needsSpace ? ' ' : '') + t;
}

export function createDictation({ textarea, interimEl, onStateChange, onError, getLang }) {
  if (!Recognition) return null;
  let recognition = null;
  let listening = false;
  // Android Chrome repeats phrases in continuous mode, so restart per phrase there.
  const continuous = !/Android/i.test(navigator.userAgent);

  function insert(text) {
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;
    const shaped = shape(text, textarea.value.slice(0, start), getLang());
    if (!shaped) return;
    textarea.setRangeText(shaped, start, end, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function build() {
    const r = new Recognition();
    r.lang = getLang();
    r.continuous = continuous;
    r.interimResults = true;
    r.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) insert(res[0].transcript);
        else interim += res[0].transcript;
      }
      interimEl.textContent = interim;
      interimEl.hidden = !interim;
    };
    r.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      listening = false;
      const messages = {
        'not-allowed': 'Microphone permission was refused. Allow the microphone for this site in your browser settings.',
        'service-not-allowed': 'Voice typing is not available in this browser.',
        'audio-capture': 'No microphone was found.',
        network: 'Voice typing needs an internet connection.',
      };
      onError(messages[event.error] || `Voice typing stopped (${event.error}).`);
      onStateChange(false);
    };
    r.onend = () => {
      interimEl.hidden = true;
      if (listening) {
        try { r.start(); } catch { listening = false; onStateChange(false); }
      } else onStateChange(false);
    };
    return r;
  }

  return {
    get listening() { return listening; },
    start() {
      if (listening) return;
      recognition = build();
      listening = true;
      try {
        recognition.start();
        onStateChange(true);
      } catch (err) {
        listening = false;
        onError('Could not start the microphone.');
        onStateChange(false);
      }
    },
    stop() {
      listening = false;
      interimEl.hidden = true;
      if (recognition) recognition.stop();
      onStateChange(false);
    },
  };
}
