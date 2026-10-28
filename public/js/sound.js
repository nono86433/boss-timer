// Web Audio API & Speech Synthesis sound engine
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.voiceEnabled = true;
    this.volume = 0.7;
    this.initAudioContext();
  }

  initAudioContext() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    } catch (e) {
      console.warn('AudioContext not supported', e);
    }
  }

  ensureContext() {
    if (!this.ctx) {
      this.initAudioContext();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playChime(type = 'normal') {
    if (!this.enabled) return;
    this.ensureContext();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    if (type === 'urgent') {
      // High-low alert chime
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(880, now); // A5
      osc.frequency.setValueAtTime(1174.66, now + 0.12); // D6
      osc.frequency.setValueAtTime(880, now + 0.24);
      osc.frequency.setValueAtTime(1318.51, now + 0.36); // E6

      gain.gain.setValueAtTime(this.volume * 0.8, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

      osc.start(now);
      osc.stop(now + 0.7);
    } else if (type === 'spawned') {
      // Fanfare / chime for respawned boss
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.15); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.3); // G5
      osc.frequency.setValueAtTime(1046.50, now + 0.45); // C6

      gain.gain.setValueAtTime(this.volume * 0.9, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.1);

      osc.start(now);
      osc.stop(now + 1.1);
    } else {
      // Pleasant melodic chime
      osc.type = 'sine';
      osc.frequency.setValueAtTime(659.25, now); // E5
      osc.frequency.exponentialRampToValueAtTime(987.77, now + 0.15); // B5

      gain.gain.setValueAtTime(this.volume * 0.7, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc.start(now);
      osc.stop(now + 0.6);
    }
  }

  speak(text) {
    if (!this.voiceEnabled) return;
    if (!('speechSynthesis' in window)) return;

    try {
      window.speechSynthesis.cancel(); // Stop prior speech
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'zh-TW';
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.volume = this.volume;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('SpeechSynthesis error:', e);
    }
  }

  notifyBoss(server, bossName, minutesRemaining) {
    this.playChime(minutesRemaining <= 1 ? 'urgent' : 'normal');

    let speechText = '';
    if (minutesRemaining <= 0) {
      speechText = `注意，${server} 的 ${bossName} 已經重生！`;
    } else if (minutesRemaining === 1) {
      speechText = `緊急提醒，${server} 的 ${bossName} 即將在 1 分鐘後重生！`;
    } else {
      speechText = `提醒，${server} 的 ${bossName} 即將在 ${minutesRemaining} 分鐘後重生。`;
    }

    this.speak(speechText);
  }
}

window.soundEngine = new SoundEngine();
