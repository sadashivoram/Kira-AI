const $ = (selector) => document.querySelector(selector);
let storageKeys = { settings: 'kira-settings', messages: 'kira-messages', notes: 'kira-notes', tasks: 'kira-tasks', credentials: 'kira-api-credentials' };
const defaults = { conversationLanguage: 'hi', voiceLanguage: 'hi-IN', voiceName: '', rate: 0.9, autoSpeak: true, includeNotes: false, includeTasks: false, background: 'midnight' };
const load = (key, fallback) => {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
};
let settings = { ...defaults, ...load(storageKeys.settings, {}) };
let messages = load(storageKeys.messages, []);
let notes = load(storageKeys.notes, []);
let tasks = load(storageKeys.tasks, []);
let voices = [];
let activeUtterance = null;
let recognition = null;
let isThinking = false;
let toastTimer;
let credentials = load(storageKeys.credentials, { elevenLabsKey: '', elevenLabsVoice: '' });
let activeAudio = null;
let activeAudioUrl = '';
let audioContext = null;
let audioAnalyser = null;
let vrmRenderer = null;
let vrmScene = null;
let vrmCamera = null;
let activeVrm = null;
let vrmClock = null;
let vrmFrame = 0;
let vrmLoadPromise;
let vrmAmplitude = 0;
let speechGeneration = 0;
let currentViseme = 'aa';
let vrmNeck = null;
let vrmChest = null;
let vrmNeckBase = null;
let vrmChestBase = null;
let blinkTimer = 3;
let blinkProgress = 0;
let activeStorageUserId = null;
let aiConnectionLabel = 'Checking connection';
let wakeWordEnabled = false;
let awaitingWakeCommand = false;
let recognitionStarting = false;
let recognitionActive = false;
let manualRecognitionActive = false;
let recognitionRestartTimer = 0;
let recognitionRestartDelay = 700;
let wakePulseTimer = 0;

function persist(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function showToast(text) {
  const toast = $('#toast');
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
}

function setView(name) {
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active-view'));
  document.querySelectorAll('.nav-item[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === name));
  $(`#${name}-view`).classList.add('active-view');
  const labels = { chat: 'Dashboard', history: 'Chat History', notes: 'Notes', tasks: 'Tasks', settings: 'Settings & Tools' };
  $('#crumb-current').textContent = labels[name];
  if (name === 'history') renderHistory();
  if (name === 'notes') renderNotes();
  if (name === 'tasks') renderTasks();
  if (name === 'chat') setTimeout(() => $('#message-input').focus(), 0);
}

function escapeText(text) {
  return text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function renderMessages() {
  const conversation = $('#conversation');
  const suggestions = $('#suggestions');
  conversation.innerHTML = '';
  conversation.classList.toggle('has-messages', messages.length > 0 || isThinking);
  suggestions.hidden = messages.length > 0;
  for (const [index, message] of messages.entries()) {
    const article = document.createElement('article');
    article.className = `message ${message.role === 'user' ? 'user' : 'assistant'}`;
    const sources = (message.sources || []).filter((source) => /^https?:\/\//i.test(source.uri || ''));
    const sourceMarkup = sources.length ? `<div class="message-sources"><strong>Sources</strong>${sources.map((source) => `<a href="${escapeText(source.uri)}" target="_blank" rel="noopener noreferrer">${escapeText(source.title || source.uri)}</a>`).join('')}</div>` : '';
    const visibleContent = message.displayContent ?? message.content;
    article.innerHTML = `<div class="message-avatar">${message.role === 'user' ? 'Y' : '✳'}</div><div><div class="message-body">${escapeText(visibleContent)}</div>${sourceMarkup}${message.role === 'assistant' ? `<div class="message-actions"><button class="message-action speak-message" data-index="${index}">Speak</button><button class="message-action stop-speaking">Stop Speaking</button><button class="message-action pause-speaking">Pause</button><button class="message-action resume-speaking">Resume</button></div>` : ''}</div>`;
    conversation.append(article);
  }
  if (isThinking) {
    const typing = document.createElement('div');
    typing.className = 'typing-indicator';
    typing.textContent = 'Thinking...';
    conversation.append(typing);
  }
  conversation.querySelectorAll('.speak-message').forEach((button) => button.addEventListener('click', () => speak(messages[Number(button.dataset.index)]?.content)));
  conversation.querySelectorAll('.stop-speaking').forEach((button) => button.addEventListener('click', stopSpeaking));
  conversation.querySelectorAll('.pause-speaking').forEach((button) => button.addEventListener('click', pauseSpeaking));
  conversation.querySelectorAll('.resume-speaking').forEach((button) => button.addEventListener('click', resumeSpeaking));
  conversation.scrollIntoView({ block: 'end', behavior: 'smooth' });
}

function addMessage(role, content) {
  messages.push({ role, content });
  persist(storageKeys.messages, messages);
  renderMessages();
}

function typeReply(message) {
  message.displayContent = '';
  renderMessages();
  const assistantMessages = $('#conversation').querySelectorAll('.message.assistant');
  const messageBody = assistantMessages[assistantMessages.length - 1]?.querySelector('.message-body');
  if (!messageBody) {
    delete message.displayContent;
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let position = 0;
    const step = () => {
      position = Math.min(position + Math.max(1, Math.ceil(message.content.length / 180)), message.content.length);
      message.displayContent = message.content.slice(0, position);
      messageBody.textContent = message.displayContent;
      if (position < message.content.length) {
        window.setTimeout(step, 18);
      } else {
        delete message.displayContent;
        resolve();
      }
    };
    step();
  });
}

async function sendMessage(rawText) {
  const text = String(rawText || '').trim();
  if (!text || isThinking) return;
  $('#message-input').value = '';
  $('#message-input').style.height = '31px';
  setView('chat');
  stopSpeaking();
  addMessage('user', text);
  isThinking = true;
  $('#send-button').disabled = true;
  renderMessages();
  try {
    const authClient = window.kiraAuth;
    if (!authClient) throw new Error('Authentication is still loading. Please try again in a moment.');
    const { data: sessionData, error: sessionError } = await authClient.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) throw new Error('Your session has expired. Sign in again to continue.');

    const history = messages.filter((message) => ['user', 'assistant'].includes(message.role)).slice(-24).map((message) => ({ ...message }));
    const latestUserMessage = history.at(-1);
    const context = [];
    if (settings.includeNotes && notes.length) context.push(`Saved notes:\n${notes.slice(0, 30).map((note) => `- ${note.text}`).join('\n')}`);
    if (settings.includeTasks && tasks.length) context.push(`Tasks:\n${tasks.slice(0, 30).map((task) => `- [${task.done ? 'done' : 'open'}] ${task.text}`).join('\n')}`);
    if (latestUserMessage && context.length) {
      latestUserMessage.content += `\n\n[Personal context for this request]\n${context.join('\n\n')}`;
    }

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session.access_token}` },
      body: JSON.stringify({ messages: history }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Kira could not complete the request. Check the server and model configuration.');
    const reply = typeof result.reply === 'string' ? result.reply.trim() : '';
    if (!reply) throw new Error('The AI service returned an empty response. Try asking again.');
    const assistantMessage = { role: 'assistant', content: reply, sources: Array.isArray(result.sources) ? result.sources : [] };
    messages.push(assistantMessage);
    persist(storageKeys.messages, messages);
    await typeReply(assistantMessage);
    if (settings.autoSpeak) void speak(reply);
    checkConnection();
  } catch (error) {
    if (messages.at(-1)?.role === 'user') {
      messages.pop();
      persist(storageKeys.messages, messages);
    }
    renderMessages();
    showToast(error instanceof TypeError ? 'Could not connect to Kira. Check your internet connection and assistant server.' : error.message);
    checkConnection();
  } finally {
    isThinking = false;
    $('#send-button').disabled = false;
    renderMessages();
  }
}

async function speak(text) {
  stopSpeaking();
  if (!text) return;
  const generation = speechGeneration;
  if (wakeWordEnabled) {
    await speakWithBrowser(text, generation);
    return;
  }
  if (credentials.elevenLabsKey && credentials.elevenLabsVoice) {
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(credentials.elevenLabsVoice)}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: {
          'xi-api-key': credentials.elevenLabsKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true },
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.detail?.message || result.detail || `ElevenLabs returned HTTP ${response.status}.`);
      }
      if (generation !== speechGeneration) return;
      activeAudioUrl = URL.createObjectURL(await response.blob());
      activeAudio = new Audio(activeAudioUrl);
      activeAudio.dataset.kiraText = text;
      activeAudio.dataset.kiraTextLength = String(text.length);
      activeAudio.onended = () => {
        if (generation === speechGeneration) {
          stopSpeaking();
          scheduleWakeRecognitionRestart();
        }
      };
      activeAudio.onerror = () => {
        if (generation !== speechGeneration) return;
        stopSpeaking();
        void speakWithBrowser(text);
        showToast('ElevenLabs audio could not play. Using browser speech instead.');
      };
      try {
        audioContext ||= new AudioContext();
        const source = audioContext.createMediaElementSource(activeAudio);
        audioAnalyser = audioContext.createAnalyser();
        audioAnalyser.fftSize = 256;
        source.connect(audioAnalyser);
        audioAnalyser.connect(audioContext.destination);
        await audioContext.resume();
      } catch {
        audioAnalyser = null;
      }
      if (generation !== speechGeneration) return;
      activeAudio.onplay = () => { $('#connection-label').textContent = 'Speaking...'; };
      await activeAudio.play();
      return;
    } catch (error) {
      if (generation !== speechGeneration) return;
      if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
      activeAudioUrl = '';
      activeAudio = null;
      void speakWithBrowser(text, generation);
      showToast(`${error instanceof TypeError ? 'ElevenLabs could not be reached.' : error.message} Using browser speech instead.`);
      return;
    }
  }
  await speakWithBrowser(text, generation);
}

function waitForHindiVoices(timeoutMs = 3000) {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  voices = window.speechSynthesis.getVoices();
  if (voices.some((voice) => voice.lang.toLowerCase().startsWith('hi'))) return Promise.resolve(voices);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
      voices = window.speechSynthesis.getVoices();
      resolve(voices);
    };
    const onVoicesChanged = () => {
      const available = window.speechSynthesis.getVoices();
      if (available.some((voice) => voice.lang.toLowerCase().startsWith('hi'))) finish();
    };
    const timeout = window.setTimeout(finish, timeoutMs);
    window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
    onVoicesChanged();
  });
}

function visemeForText(text, position = 0) {
  const segment = text.slice(position, position + 8).toLowerCase();
  const firstVowel = segment.match(/[आाअaāइिईीiɪउुऊूuएेऐैeओोऔौo]/u)?.[0];
  if (!firstVowel) return 'aa';
  if (/[आाअaā]/u.test(firstVowel)) return 'aa';
  if (/[इिईीiɪ]/u.test(firstVowel)) return 'ih';
  if (/[उुऊूu]/u.test(firstVowel)) return 'ou';
  if (/[एेऐैe]/u.test(firstVowel)) return 'ee';
  if (/[ओोऔौo]/u.test(firstVowel)) return 'oh';
  return 'aa';
}

function setVrmViseme(name, amount) {
  currentViseme = name;
  vrmAmplitude = amount;
  const manager = activeVrm?.expressionManager;
  if (!manager) return;
  for (const viseme of ['aa', 'ih', 'ou', 'ee', 'oh']) {
    if (manager.getExpression?.(viseme) || manager.expressions?.[viseme]) {
      manager.setValue(viseme, viseme === name ? amount : 0);
    }
  }
}

async function speakWithBrowser(text, generation = speechGeneration) {
  if (!('speechSynthesis' in window) || !text) {
    showToast('Speech output is not supported in this browser. You can still read Kira’s reply.');
    return;
  }
  await waitForHindiVoices();
  if (generation !== speechGeneration) return;
  const hindiVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith('hi'));
  const chosen = hindiVoices.find((voice) => voice.name === settings.voiceName);
  if (!hindiVoices.length) {
    showToast('No Hindi voice is available on this device. Browser speech will try its default voice for Kira’s Hindi reply.');
    $('#voice-warning').hidden = false;
    $('#voice-warning').textContent = 'No Hindi voice is available on this device. Kira’s reply is still readable; install a Hindi system voice for better Hindi speech.';
  }
  const voice = chosen || sortHindiVoices(hindiVoices)[0] || null;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = settings.voiceLanguage || 'hi-IN';
  if (voice) utterance.voice = voice;
  utterance.rate = Number(settings.rate) || 0.9;
  if (wakeWordEnabled && recognition && recognitionActive) {
    try {
      recognition.stop();
    } catch (error) {
      console.warn('Could not pause wake-word recognition during speech:', error);
    }
  }
  utterance.onstart = () => { $('#connection-label').textContent = 'Speaking...'; };
  utterance.onboundary = (event) => {
    if (generation !== speechGeneration || event.name === 'sentence') return;
    const position = Number.isFinite(event.charIndex) ? event.charIndex : 0;
    const viseme = visemeForText(text, position);
    setVrmViseme(viseme, 0.48);
  };
  utterance.onend = () => {
    if (generation !== speechGeneration) return;
    setVrmViseme(currentViseme, 0);
    activeUtterance = null;
    $('#connection-label').textContent = aiConnectionLabel;
    scheduleWakeRecognitionRestart();
  };
  utterance.onerror = (event) => {
    if (generation === speechGeneration && event.error !== 'canceled' && event.error !== 'interrupted') {
      showToast('Speech could not be played. Check your device voice settings.');
      $('#connection-label').textContent = aiConnectionLabel;
      scheduleWakeRecognitionRestart();
    }
  };
  activeUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  speechGeneration += 1;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.onended = null;
    activeAudio.onerror = null;
    activeAudio.removeAttribute('src');
    activeAudio.load();
    activeAudio = null;
  }
  if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
  activeAudioUrl = '';
  audioAnalyser = null;
  setVrmViseme(currentViseme, 0);
  activeUtterance = null;
  $('#connection-label').textContent = aiConnectionLabel;
}

function pauseSpeaking() {
  if (activeAudio && !activeAudio.paused) {
    activeAudio.pause();
    return;
  }
  if ('speechSynthesis' in window && window.speechSynthesis.speaking) window.speechSynthesis.pause();
}

function resumeSpeaking() {
  if (activeAudio?.paused) {
    activeAudio.play().catch(() => showToast('Audio could not resume. Press Speak to try again.'));
    return;
  }
  if ('speechSynthesis' in window && window.speechSynthesis.paused) window.speechSynthesis.resume();
}

function sortHindiVoices(candidates) {
  const femaleVoiceName = /\b(female|woman|girl|aarti|aditi|heera|kalpana|kavya|lekha|neerja|priya|raveena|sangeeta|veena)\b/i;
  return [...candidates].sort((left, right) => {
    const leftIndian = left.lang.toLowerCase() === 'hi-in' ? 0 : 1;
    const rightIndian = right.lang.toLowerCase() === 'hi-in' ? 0 : 1;
    const leftFemaleHint = femaleVoiceName.test(left.name) ? 0 : 1;
    const rightFemaleHint = femaleVoiceName.test(right.name) ? 0 : 1;
    return leftIndian - rightIndian || leftFemaleHint - rightFemaleHint || left.name.localeCompare(right.name);
  });
}

function loadVoices() {
  if (!('speechSynthesis' in window)) {
    $('#voice-select').innerHTML = '<option value="">Speech unavailable</option>';
    $('#voice-help').textContent = 'Speech synthesis is not supported by this browser.';
    $('#voice-warning').hidden = false;
    $('#voice-warning').textContent = 'Speech output is not supported in this browser. Kira’s text replies will still be available.';
    return;
  }
  voices = window.speechSynthesis.getVoices();
  const hindiVoices = sortHindiVoices(voices.filter((voice) => voice.lang.toLowerCase().startsWith('hi')));
  const selector = $('#voice-select');
  selector.replaceChildren();
  if (!hindiVoices.length) {
    selector.add(new Option('No Hindi voice available', ''));
  } else {
    for (const voice of hindiVoices) {
      const femaleHint = /\b(female|woman|girl|aarti|aditi|heera|kalpana|kavya|lekha|neerja|priya|raveena|sangeeta|veena)\b/i.test(voice.name);
      selector.add(new Option(`${voice.name} — ${voice.lang}${femaleHint ? ' (female-sounding name)' : ''}${voice.default ? ' (Default)' : ''}`, voice.name));
    }
    selector.value = hindiVoices.some((voice) => voice.name === settings.voiceName) ? settings.voiceName : hindiVoices[0].name;
    settings.voiceName = selector.value;
  }
  const hasHindi = hindiVoices.length > 0;
  $('#voice-help').textContent = hasHindi ? 'Available Hindi voices. Voice names are only hints; the device does not expose reliable gender metadata.' : 'No Hindi voice is installed on this device.';
  $('#voice-warning').hidden = hasHindi;
  if (!hasHindi) $('#voice-warning').textContent = 'No Hindi voice is available on this device. Replies remain readable in Hindi; install a Hindi speech voice in your system settings to hear them.';
  persist(storageKeys.settings, settings);
}

function updateWakeWordUi() {
  const button = $('#wake-word-button');
  button.setAttribute('aria-pressed', String(wakeWordEnabled));
  $('#wake-word-label').textContent = wakeWordEnabled ? 'Stop Hey Kira' : 'Enable Hey Kira';
  $('#wake-indicator').classList.toggle('active', wakeWordEnabled);
  $('#settings-wake-button').textContent = wakeWordEnabled ? 'Stop Wake Word' : 'Enable Wake Word';
  $('#settings-wake-button').setAttribute('aria-pressed', String(wakeWordEnabled));
  $('#wake-word-help').textContent = wakeWordEnabled
    ? (awaitingWakeCommand ? 'Kira is awake. Say a command now.' : 'Listening for “Hey Kira” or “Kira”.')
    : 'Say “Hey Kira” or “Kira” to wake the assistant, then speak a command.';
}

async function ensureMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access requires a supported browser and a secure connection (HTTPS or localhost).');
  }
  if (navigator.permissions?.query) {
    try {
      const permission = await navigator.permissions.query({ name: 'microphone' });
      if (permission.state === 'denied') throw new Error('Microphone permission is blocked. Allow microphone access in your browser site settings.');
      if (permission.state === 'granted') return;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Microphone permission is blocked')) throw error;
    }
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

function wakePulse() {
  document.body.classList.add('wake-flash');
  window.clearTimeout(wakePulseTimer);
  wakePulseTimer = window.setTimeout(() => document.body.classList.remove('wake-flash'), 1100);
}

function addSpokenAssistantReply(text) {
  addMessage('assistant', text);
  void speak(text);
}

function openVoiceSite(commandText, transcript) {
  const normalized = commandText.toLowerCase().replace(/[.!?,]/g, ' ').replace(/\s+/g, ' ').trim();
  const englishMatch = normalized.match(/^(?:(?:please|can you)\s+)?(?:open|launch|visit|खोलो|ओपन करो)\s+(.+?)\s*$/u);
  const hindiMatch = normalized.match(/^(.+?)\s+(?:खोलो|ओपन करो)\s*$/u);
  const match = englishMatch || hindiMatch;
  if (!match) return false;
  const requestedSite = match[1].replace(/\s+(?:website|site|app)$/u, '').trim();
  const sites = [
    { aliases: ['whatsapp', 'whatsapp web', 'व्हाट्सएप', 'व्हाट्सऐप'], name: 'WhatsApp', url: 'https://web.whatsapp.com/' },
    { aliases: ['google', 'google search', 'गूगल'], name: 'Google', url: 'https://www.google.com/' },
    { aliases: ['youtube', 'you tube', 'यूट्यूब'], name: 'YouTube', url: 'https://www.youtube.com/' },
    { aliases: ['gmail', 'जीमेल'], name: 'Gmail', url: 'https://mail.google.com/' },
    { aliases: ['instagram', 'इंस्टाग्राम'], name: 'Instagram', url: 'https://www.instagram.com/' },
  ];
  const site = sites.find((entry) => entry.aliases.includes(requestedSite));
  if (!site) return false;

  const openedTab = window.open(site.url, '_blank');
  if (openedTab) openedTab.opener = null;
  addMessage('user', transcript);
  addSpokenAssistantReply(openedTab
    ? `मैंने ${site.name} एक नए टैब में खोल दिया है।`
    : `आपके browser ने नया टैब ब्लॉक कर दिया। Pop-ups allow करके ${site.name} फिर से खोलने के लिए कहें।`);
  return true;
}

function wakePhrasePattern() {
  return /(?:hey\s+kira|hi\s+kira|hello\s+kira|kira|हे\s*किरा|हाय\s*किरा|किरा|कीरा)/iu;
}

function handleWakeTranscript(rawTranscript) {
  const transcript = String(rawTranscript || '').trim();
  if (!transcript) return;

  if (awaitingWakeCommand) {
    awaitingWakeCommand = false;
    updateWakeWordUi();
    if (!openVoiceSite(transcript, transcript)) void sendMessage(transcript);
    return;
  }

  const wakePattern = wakePhrasePattern();
  const wakeMatch = wakePattern.exec(transcript);
  if (!wakeMatch) return;
  const command = transcript.replace(wakePattern, '').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '').trim();
  wakePulse();
  awaitingWakeCommand = !command;
  updateWakeWordUi();

  if (command && openVoiceSite(command, transcript)) return;
  if (command) {
    void sendMessage(command);
    return;
  }
  addSpokenAssistantReply('जी, मैं सुन रही हूँ! बताइए, मैं आपकी क्या मदद कर सकती हूँ?');
  showToast('Kira is listening. Say a command or ask a question.');
}

function scheduleWakeRecognitionRestart() {
  window.clearTimeout(recognitionRestartTimer);
  if (!wakeWordEnabled || !recognition || recognitionActive || recognitionStarting) return;
  recognitionRestartTimer = window.setTimeout(() => {
    if (!wakeWordEnabled || !recognition || recognitionActive || recognitionStarting) return;
    if (activeUtterance || ('speechSynthesis' in window && window.speechSynthesis.speaking)) {
      scheduleWakeRecognitionRestart();
      return;
    }
    startRecognition();
  }, recognitionRestartDelay);
}

async function enableWakeWord() {
  if (!recognition) {
    showToast('Wake-word listening is not supported in this browser. You can still type messages.');
    return;
  }
  if (wakeWordEnabled) {
    wakeWordEnabled = false;
    awaitingWakeCommand = false;
    window.clearTimeout(recognitionRestartTimer);
    if (recognitionActive) recognition.stop();
    updateWakeWordUi();
    showToast('Hey Kira listening is off.');
    return;
  }

  try {
    await ensureMicrophonePermission();
    wakeWordEnabled = true;
    manualRecognitionActive = false;
    recognition.continuous = true;
    recognition.interimResults = false;
    recognitionRestartDelay = 700;
    updateWakeWordUi();
    startRecognition();
    showToast('Hey Kira is on. Keep this tab open to use hands-free listening.');
  } catch (error) {
    wakeWordEnabled = false;
    updateWakeWordUi();
    showToast(error.message || 'Microphone access could not be enabled. Check your browser permissions.');
  }
}

function disableWakeWord() {
  wakeWordEnabled = false;
  awaitingWakeCommand = false;
  manualRecognitionActive = false;
  window.clearTimeout(recognitionRestartTimer);
  if (recognitionActive && recognition) recognition.stop();
  updateWakeWordUi();
}

function startRecognition() {
  if (!recognition || recognitionStarting || recognitionActive) return;
  recognitionStarting = true;
  try {
    recognition.start();
  } catch (error) {
    recognitionStarting = false;
    if (error.name !== 'InvalidStateError') {
      console.warn('Speech recognition could not start:', error);
      if (wakeWordEnabled) scheduleWakeRecognitionRestart();
    }
  }
}

function setupRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    $('#recognition-status').textContent = 'Not supported';
    $('#microphone-help').textContent = 'This browser does not support speech recognition. You can still type messages.';
    $('#listen-button').disabled = true;
    $('#listen-button').title = 'Speech recognition is not supported in this browser';
    $('#wake-word-button').disabled = true;
    $('#settings-wake-button').disabled = true;
    $('#wake-warning').hidden = false;
    $('#wake-warning').textContent = 'Wake-word listening is not available in this browser. Use a supported browser such as Chrome or Edge.';
    updateWakeWordUi();
    return;
  }
  recognition = new Recognition();
  recognition.lang = 'hi-IN';
  recognition.interimResults = false;
  recognition.continuous = false;
  $('#recognition-status').textContent = 'Available';
  $('#recognition-status').style.color = '#86d8b1';
  recognition.onstart = () => {
    recognitionStarting = false;
    recognitionActive = true;
    $('#listen-label').textContent = 'Stop Listening';
    $('#listen-button').classList.add('listening');
    $('#recognition-status').textContent = wakeWordEnabled ? 'Wake word active' : 'Listening';
  };
  recognition.onend = () => {
    recognitionStarting = false;
    recognitionActive = false;
    $('#listen-label').textContent = 'Start Listening';
    $('#listen-button').classList.remove('listening');
    $('#recognition-status').textContent = wakeWordEnabled ? 'Wake word active' : 'Available';
    updateWakeWordUi();
    if (wakeWordEnabled) {
      scheduleWakeRecognitionRestart();
    } else if (manualRecognitionActive) {
      manualRecognitionActive = false;
    }
  };
  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (!result.isFinal) continue;
      const transcript = result[0]?.transcript?.trim();
      if (!transcript) continue;
      recognitionRestartDelay = 700;
      if (wakeWordEnabled) {
        handleWakeTranscript(transcript);
      } else if (manualRecognitionActive) {
        manualRecognitionActive = false;
        void sendMessage(transcript);
      }
    }
  };
  recognition.onerror = (event) => {
    const messagesByError = {
      'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser settings.',
      'no-speech': 'No speech was detected. Please try again.',
      'language-not-supported': 'Hindi speech recognition is not supported by this browser.',
      'audio-capture': 'No microphone was found. Connect a microphone and try again.',
    };
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      disableWakeWord();
      showToast(messagesByError[event.error] || 'Microphone access was denied. Allow access in your browser site settings.');
      return;
    }
    if (event.error !== 'no-speech' && event.error !== 'aborted') showToast(messagesByError[event.error] || 'Voice input could not start. You can type your message instead.');
    if (wakeWordEnabled) {
      recognitionRestartDelay = Math.min(recognitionRestartDelay * 1.7, 8000);
    }
  };
}

async function checkConnection() {
  try {
    const response = await fetch('/api/status', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Status check failed with HTTP ${response.status}.`);
    const status = await response.json();
    const connected = Boolean(status.configured && status.authenticated);
    aiConnectionLabel = connected ? 'Online' : 'AI configuration needed';
    $('#status-dot').className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
    $('#connection-label').textContent = aiConnectionLabel;
    $('#ai-model-label').textContent = status.configured ? status.model : 'Not configured';
  } catch {
    aiConnectionLabel = 'Server unavailable';
    $('#status-dot').className = 'status-dot disconnected';
    $('#connection-label').textContent = aiConnectionLabel;
    $('#ai-model-label').textContent = 'Server unavailable';
  }
}

async function initializeVrmRenderer() {
  const [THREE, { GLTFLoader }, { VRMLoaderPlugin, VRMUtils }] = await Promise.all([
    import('three'),
    import('three/addons/loaders/GLTFLoader.js'),
    import('@pixiv/three-vrm'),
  ]);
  const canvas = $('#vrm-canvas');
  vrmRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  vrmRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  vrmRenderer.setClearColor(0x000000, 0);
  vrmScene = new THREE.Scene();
  vrmCamera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  vrmCamera.position.set(0, 1.25, 3.15);
  vrmScene.add(new THREE.HemisphereLight(0xe8ddff, 0x332947, 2));
  const keyLight = new THREE.DirectionalLight(0xfff0e7, 2.2);
  keyLight.position.set(1.4, 2.6, 3);
  vrmScene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x9d8bff, 1.1);
  fillLight.position.set(-2, 1, -1);
  vrmScene.add(fillLight);
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  vrmClock = new THREE.Clock();

  const resize = () => {
    const { width, height } = canvas.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    vrmRenderer.setSize(width, height, false);
    vrmCamera.aspect = width / height;
    vrmCamera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe($('#avatar-stage'));
  window.addEventListener('resize', resize);
  resize();

  const animate = () => {
    vrmFrame = requestAnimationFrame(animate);
    const delta = Math.min(vrmClock.getDelta(), 0.05);
    if (activeVrm) {
      activeVrm.update(delta);
      const elapsed = vrmClock.elapsedTime;
      if (vrmNeck && vrmNeckBase) {
        vrmNeck.rotation.y = vrmNeckBase.y + Math.sin(elapsed * 0.55) * 0.025;
        vrmNeck.rotation.x = vrmNeckBase.x + Math.sin(elapsed * 0.4) * 0.012;
      }
      if (vrmChest && vrmChestBase) {
        vrmChest.rotation.x = vrmChestBase.x + Math.sin(elapsed * 1.15) * 0.008;
      }
      if (activeAudio && audioAnalyser) {
        const samples = new Uint8Array(audioAnalyser.fftSize);
        audioAnalyser.getByteTimeDomainData(samples);
        const sum = samples.reduce((total, value) => total + ((value - 128) / 128) ** 2, 0);
        vrmAmplitude = Math.min(Math.sqrt(sum / samples.length) * 3.2, 1);
        const audioPosition = activeAudio.duration ? Math.floor((activeAudio.currentTime / activeAudio.duration) * activeAudio.dataset.kiraTextLength) : 0;
        const text = activeAudio.dataset.kiraText || '';
        setVrmViseme(visemeForText(text, audioPosition), vrmAmplitude);
      } else if ('speechSynthesis' in window && window.speechSynthesis.speaking) {
        setVrmViseme(currentViseme, 0.12 + Math.max(0, Math.sin(performance.now() / 82)) * 0.35);
      } else {
        vrmAmplitude *= 0.78;
        setVrmViseme(currentViseme, vrmAmplitude < 0.01 ? 0 : vrmAmplitude);
      }
      const manager = activeVrm.expressionManager;
      if (manager?.getExpression?.('blink') || manager?.expressions?.blink) {
        blinkTimer -= delta;
        let blinkValue = 0;
        if (blinkTimer <= 0) {
          blinkProgress += delta;
          blinkValue = blinkProgress < 0.09 ? blinkProgress / 0.09 : Math.max(0, 1 - (blinkProgress - 0.09) / 0.12);
          if (blinkProgress >= 0.21) {
            blinkProgress = 0;
            blinkTimer = 2.5 + Math.random() * 3.5;
          }
        }
        manager.setValue('blink', blinkValue);
      }
    }
    vrmRenderer.render(vrmScene, vrmCamera);
  };
  animate();

  return { loader, VRMUtils };
}

async function loadVrmFromBuffer(buffer, label) {
  if (!vrmLoadPromise) {
    vrmLoadPromise = initializeVrmRenderer().catch((error) => {
      vrmLoadPromise = null;
      throw error;
    });
  }
  try {
    const { loader, VRMUtils } = await vrmLoadPromise;
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(buffer, '', resolve, reject);
    });
    const nextVrm = gltf.userData.vrm;
    if (!nextVrm) throw new Error('This file did not contain a VRM avatar.');
    VRMUtils.rotateVRM0(nextVrm);
    if (activeVrm) vrmScene.remove(activeVrm.scene);
    activeVrm = nextVrm;
    vrmNeck = activeVrm.humanoid?.getNormalizedBoneNode('neck') || activeVrm.humanoid?.getRawBoneNode('neck') || null;
    vrmChest = activeVrm.humanoid?.getNormalizedBoneNode('chest') || activeVrm.humanoid?.getRawBoneNode('chest') || null;
    vrmNeckBase = vrmNeck ? { x: vrmNeck.rotation.x, y: vrmNeck.rotation.y } : null;
    vrmChestBase = vrmChest ? { x: vrmChest.rotation.x } : null;
    vrmScene.add(activeVrm.scene);
    $('#avatar-stage').classList.add('has-vrm');
    $('#vrm-file-label').textContent = `Loaded ${label}. The model stays in this browser session.`;
    showToast('3D avatar loaded.');
  } catch (error) {
    $('#avatar-stage').classList.remove('has-vrm');
    showToast(`Could not load this VRM model: ${error.message}`);
  }
}

async function loadVrmFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.vrm')) {
    showToast('Choose a .vrm avatar file.');
    return;
  }
  await loadVrmFromBuffer(await file.arrayBuffer(), file.name);
}

function openApiSettings() {
  $('#elevenlabs-key').value = credentials.elevenLabsKey;
  $('#elevenlabs-voice').value = credentials.elevenLabsVoice;
  $('#api-modal').showModal();
}

function renderHistory() {
  const list = $('#history-list');
  if (!messages.length) {
    list.innerHTML = '<div class="empty-state">Your conversations will appear here. Start a new chat whenever you like.</div>';
    return;
  }
  const first = messages.find((message) => message.role === 'user')?.content || 'New conversation';
  list.innerHTML = `<div class="history-item"><span>${escapeText(first.slice(0, 90))}</span><button id="continue-chat">Continue chat →</button></div>`;
  $('#continue-chat').addEventListener('click', () => setView('chat'));
}

function renderNotes() {
  $('#notes-count').textContent = String(notes.length);
  $('#notes-list').innerHTML = notes.length ? notes.map((note, index) => `<article class="note-card">${escapeText(note.text)}<small class="note-date">${escapeText(note.date)}</small><button class="delete-button delete-note" data-index="${index}" aria-label="Delete note">×</button></article>`).join('') : '<div class="empty-state">No notes yet. Add a note above to keep a thought close.</div>';
  document.querySelectorAll('.delete-note').forEach((button) => button.addEventListener('click', () => {
    notes.splice(Number(button.dataset.index), 1);
    persist(storageKeys.notes, notes);
    renderNotes();
  }));
}

function renderTasks() {
  $('#tasks-count').textContent = String(tasks.filter((task) => !task.done).length);
  $('#task-list').innerHTML = tasks.length ? tasks.map((task, index) => `<label class="task-item ${task.done ? 'done' : ''}"><input class="task-check" type="checkbox" data-index="${index}" ${task.done ? 'checked' : ''} /><span class="task-text">${escapeText(task.text)}</span><button type="button" class="delete-button delete-task" data-index="${index}" aria-label="Delete task">×</button></label>`).join('') : '<div class="empty-state">Nothing on your list yet. Add a task above to get started.</div>';
  document.querySelectorAll('.task-check').forEach((input) => input.addEventListener('change', () => {
    tasks[Number(input.dataset.index)].done = input.checked;
    persist(storageKeys.tasks, tasks);
    renderTasks();
  }));
  document.querySelectorAll('.delete-task').forEach((button) => button.addEventListener('click', () => {
    tasks.splice(Number(button.dataset.index), 1);
    persist(storageKeys.tasks, tasks);
    renderTasks();
  }));
}

function loadSettingsForm() {
  $('#conversation-language').value = settings.conversationLanguage;
  $('#voice-language').value = settings.voiceLanguage;
  $('#speech-rate').value = settings.rate;
  $('#rate-value').value = `${settings.rate}×`;
  $('#auto-speak').checked = settings.autoSpeak;
  $('#include-notes').checked = settings.includeNotes;
  $('#include-tasks').checked = settings.includeTasks;
  $('#background-theme').value = settings.background;
  if (voices.length) $('#voice-select').value = settings.voiceName;
}

window.kiraSetUser = (userId) => {
  if (userId && activeStorageUserId === userId) return;
  if (!userId && wakeWordEnabled) disableWakeWord();
  activeStorageUserId = userId || null;
  storageKeys = userId
    ? {
        settings: `kira:${userId}:settings`,
        messages: `kira:${userId}:messages`,
        notes: `kira:${userId}:notes`,
        tasks: `kira:${userId}:tasks`,
        credentials: `kira:${userId}:credentials`,
      }
    : { settings: 'kira-signed-out:settings', messages: 'kira-signed-out:messages', notes: 'kira-signed-out:notes', tasks: 'kira-signed-out:tasks', credentials: 'kira-signed-out:credentials' };
  settings = { ...defaults, ...load(storageKeys.settings, {}) };
  messages = load(storageKeys.messages, []);
  notes = load(storageKeys.notes, []);
  tasks = load(storageKeys.tasks, []);
  credentials = load(storageKeys.credentials, { elevenLabsKey: '', elevenLabsVoice: '' });
  document.body.dataset.background = settings.background === 'midnight' ? '' : settings.background;
  renderMessages();
  renderNotes();
  renderTasks();
  loadSettingsForm();
  checkConnection();
};

document.querySelectorAll('.nav-item[data-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
$('#open-settings').addEventListener('click', () => setView('settings'));
$('#open-api-settings').addEventListener('click', openApiSettings);
$('#api-modal').addEventListener('click', (event) => {
  if (event.target === $('#api-modal')) $('#api-modal').close();
});
$('#close-api-settings').addEventListener('click', () => $('#api-modal').close());
$('#cancel-api-settings').addEventListener('click', () => $('#api-modal').close());
$('#api-settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  credentials = {
    elevenLabsKey: $('#elevenlabs-key').value.trim(),
    elevenLabsVoice: $('#elevenlabs-voice').value.trim(),
  };
  try {
    persist(storageKeys.credentials, credentials);
  } catch {
    showToast('Settings could not be saved in this browser. Check available storage.');
    return;
  }
  checkConnection();
  $('#api-modal').close();
  showToast('Voice settings saved in this browser.');
});
$('#vrm-file').addEventListener('change', (event) => loadVrmFile(event.target.files?.[0]));
$('#new-chat').addEventListener('click', () => {
  messages = [];
  persist(storageKeys.messages, messages);
  isThinking = false;
  renderMessages();
  setView('chat');
});
$('#chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage($('#message-input').value);
});
$('#message-input').addEventListener('input', (event) => {
  event.target.style.height = '31px';
  event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`;
});
$('#message-input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    $('#chat-form').requestSubmit();
  }
});
document.querySelectorAll('.suggestion-card').forEach((button) => button.addEventListener('click', () => sendMessage(button.dataset.prompt)));
$('#listen-button').addEventListener('click', () => {
  if (!recognition) return;
  if (wakeWordEnabled) {
    disableWakeWord();
    return;
  }
  if (recognitionActive && manualRecognitionActive) {
    manualRecognitionActive = false;
    recognition.stop();
    return;
  }
  void (async () => {
    try {
      await ensureMicrophonePermission();
      manualRecognitionActive = true;
      recognition.continuous = false;
      recognition.interimResults = false;
      startRecognition();
    } catch (error) {
      manualRecognitionActive = false;
      showToast(error.message || 'Microphone access could not be enabled. Check your browser permissions.');
    }
  })();
});
$('#wake-word-button').addEventListener('click', () => { void enableWakeWord(); });
$('#settings-wake-button').addEventListener('click', () => { void enableWakeWord(); });
$('#note-form').addEventListener('submit', (event) => {
  event.preventDefault();
  notes.unshift({ text: $('#note-input').value.trim(), date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) });
  persist(storageKeys.notes, notes);
  $('#note-input').value = '';
  renderNotes();
});
$('#task-form').addEventListener('submit', (event) => {
  event.preventDefault();
  tasks.unshift({ text: $('#task-input').value.trim(), done: false });
  persist(storageKeys.tasks, tasks);
  $('#task-input').value = '';
  renderTasks();
});
$('#clear-chat').addEventListener('click', () => {
  messages = [];
  persist(storageKeys.messages, messages);
  renderMessages();
  renderHistory();
  showToast('Chat cleared.');
});
$('#speech-rate').addEventListener('input', (event) => { $('#rate-value').value = `${event.target.value}×`; });
$('#save-settings').addEventListener('click', () => {
  settings = {
    conversationLanguage: $('#conversation-language').value,
    voiceLanguage: $('#voice-language').value,
    voiceName: $('#voice-select').value,
    rate: Number($('#speech-rate').value),
    autoSpeak: $('#auto-speak').checked,
    includeNotes: $('#include-notes').checked,
    includeTasks: $('#include-tasks').checked,
    background: $('#background-theme').value,
  };
  try {
    persist(storageKeys.settings, settings);
  } catch {
    showToast('Settings could not be saved in this browser. Check available storage.');
    return;
  }
  document.body.dataset.background = settings.background === 'midnight' ? '' : settings.background;
  $('#save-status').textContent = 'Settings saved';
  setTimeout(() => { $('#save-status').textContent = ''; }, 2200);
});
$('#cancel-settings').addEventListener('click', () => {
  loadSettingsForm();
  setView('chat');
});

document.body.dataset.background = settings.background === 'midnight' ? '' : settings.background;
renderMessages();
renderNotes();
renderTasks();
loadSettingsForm();
setupRecognition();
loadVoices();
if ('speechSynthesis' in window) window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
checkConnection();

    