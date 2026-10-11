const EMOTIONS = Object.freeze({
  happy: { pitch: 1.12, rate: 1.04 },
  caring: { pitch: 1.04, rate: 0.94 },
  energetic: { pitch: 1.16, rate: 1.1 },
  angry: { pitch: 0.9, rate: 1.02 },
  calm: { pitch: 0.96, rate: 0.9 },
  neutral: { pitch: 1, rate: 1 },
});

function inferEmotion(text) {
  const normalized = text.toLowerCase();
  if (/\[(happy|caring|energetic|angry|calm)\]/i.test(text)) {
    return normalized.match(/\[(happy|caring|energetic|angry|calm)\]/i)[1].toLowerCase();
  }
  if (/(love you|miss you|take care|apna dhyan|khayal|sorry|sad|dukhi|pareshan)/i.test(normalized)) {
    return "caring";
  }
  if (/(angry|gussa|naraz|annoyed)/i.test(normalized)) return "angry";
  if (/(great|awesome|yay|khushi|maza|excited|congratulations)/i.test(normalized)) return "happy";
  if (/(let's go|chalo|come on|jaldi|amazing)/i.test(normalized)) return "energetic";
  if (/(relax|calm|breathe|aaram|shanti)/i.test(normalized)) return "calm";
  return "neutral";
}

function isVoiceForLanguage(voice, language) {
  return voice.lang.toLowerCase().startsWith(language.slice(0, 2).toLowerCase());
}

function voiceScore(voice, language, preferredURI, assistantGender = "female") {
  let score = isVoiceForLanguage(voice, language) ? 10 : 0;
  if (preferredURI && voice.voiceURI === preferredURI) score += 100;
  const femaleVoice = /female|woman|zira|samantha|sara/i.test(voice.name);
  const maleVoice = /\bmale\b|\bman\b|\bdavid\b|\bdaniel\b|\bmark\b|\bravi\b/i.test(voice.name);
  if (assistantGender === "male") score += maleVoice ? 6 : femaleVoice ? -2 : 0;
  else score += femaleVoice ? 6 : maleVoice ? -2 : 0;
  if (/neural/i.test(voice.name)) score += 2;
  return score;
}

export class VoiceEngine {
  constructor({
    getPreferences = () => ({}),
    onMouthUpdate = () => {},
    onSpeakingChange = () => {},
    onError = () => {},
  } = {}) {
    this.getPreferences = getPreferences;
    this.onMouthUpdate = onMouthUpdate;
    this.onSpeakingChange = onSpeakingChange;
    this.onError = onError;
    this.utterance = null;
    this.isSpeaking = false;
    this.generation = 0;
    this.animationTimer = 0;
  }

  getVoices() {
    return window.speechSynthesis?.getVoices() || [];
  }

  async waitForVoices(timeoutMs = 1500) {
    const synthesis = window.speechSynthesis;
    if (!synthesis) return [];
    const existing = synthesis.getVoices();
    if (existing.length) return existing;

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        synthesis.removeEventListener?.("voiceschanged", finish);
        resolve(synthesis.getVoices());
      };
      const timer = setTimeout(finish, timeoutMs);
      synthesis.addEventListener?.("voiceschanged", finish, { once: true });
    });
  }

  async speak(text, { force = false, language = "" } = {}) {
    const preferences = this.getPreferences();
    if (!force && preferences.autoSpeak === false) return false;
    if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === "undefined") {
      const error = new Error("Speech output is not available in this browser.");
      this.onError(error);
      return false;
    }

    this.stop();
    const generation = this.generation;
    const voices = await this.waitForVoices();
    if (generation !== this.generation) return false;

    const requestedLanguage = language || "hi-IN";
    const selected = voices
      .map((voice) => ({
        voice,
        score: voiceScore(voice, requestedLanguage, preferences.voiceURI, preferences.assistantGender),
      }))
      .sort((left, right) => right.score - left.score)[0]?.voice;
    const utterance = new SpeechSynthesisUtterance(text);
    const emotion = EMOTIONS[inferEmotion(text)] || EMOTIONS.neutral;
    utterance.rate = Math.max(0.75, Math.min(1.25, (Number(preferences.rate) || 1) * emotion.rate));
    utterance.pitch = emotion.pitch;
    utterance.lang = selected?.lang || requestedLanguage;
    if (selected) utterance.voice = selected;

    let boundaryCount = 0;
    utterance.onstart = () => {
      if (generation !== this.generation) return;
      this.isSpeaking = true;
      this.onSpeakingChange(true);
      this.animationTimer = window.setInterval(() => {
        boundaryCount += 1;
        this.onMouthUpdate(0.16 + Math.abs(Math.sin(boundaryCount * 1.7)) * 0.36);
      }, 105);
    };
    utterance.onboundary = (event) => {
      if (generation !== this.generation) return;
      const index = Math.max(0, event.charIndex || 0);
      const character = text[index]?.toLowerCase() || "";
      const mouth = /[aāaeiou]/.test(character) ? 0.55 : /[mbp]/.test(character) ? 0.08 : 0.3;
      this.onMouthUpdate(mouth);
    };
    utterance.onend = () => this.finish(generation);
    utterance.onerror = (event) => {
      this.finish(generation);
      if (event.error !== "canceled" && event.error !== "interrupted") {
        this.onError(new Error("Speech playback failed. Check your browser voice settings."));
      }
    };
    this.utterance = utterance;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  finish(generation) {
    if (generation !== this.generation) return;
    clearInterval(this.animationTimer);
    this.animationTimer = 0;
    this.utterance = null;
    this.isSpeaking = false;
    this.onMouthUpdate(0);
    this.onSpeakingChange(false);
  }

  stop() {
    this.generation += 1;
    clearInterval(this.animationTimer);
    this.animationTimer = 0;
    window.speechSynthesis?.cancel();
    this.utterance = null;
    this.isSpeaking = false;
    this.onMouthUpdate(0);
    this.onSpeakingChange(false);
  }

  pause() {
    window.speechSynthesis?.pause();
  }

  resume() {
    window.speechSynthesis?.resume();
  }
}
