/**
 * 应用主入口
 * - 初始化粒子背景和语音识别
 * - 多后端支持（浏览器原生 / 阿里云）
 * - 设置面板管理
 * - 状态管理与 UI 更新
 */

import { ParticleSystem } from './particles.js';
import { SpeechRecognition, SpeechState, BackendType } from './speech.js';

class App {
  constructor() {
    this.particles = new ParticleSystem();
    this.speech = new SpeechRecognition();
    this.state = SpeechState.IDLE;

    // DOM 元素 - 主界面
    this.btnMic = document.getElementById('btn-mic');
    this.btnClear = document.getElementById('btn-clear');
    this.btnCopy = document.getElementById('btn-copy');
    this.transcriptEl = document.getElementById('transcript');
    this.transcriptContainer = document.getElementById('transcript-container');
    this.statusEl = document.getElementById('status');
    this.waveform = document.getElementById('waveform');
    this.recordingLine = document.getElementById('recording-line');
    this.unsupportedEl = document.getElementById('unsupported');
    this.toastEl = document.getElementById('toast');

    // DOM 元素 - 设置面板
    this.btnSettings = document.getElementById('btn-settings');
    this.settingsOverlay = document.getElementById('settings-overlay');
    this.btnSettingsClose = document.getElementById('btn-settings-close');
    this.btnSettingsSave = document.getElementById('btn-settings-save');
    this.rbNative = document.getElementById('rb-native');
    this.rbAliyun = document.getElementById('rb-aliyun');
    this.aliyunConfig = document.getElementById('aliyun-config');
    this.aliyunAppKey = document.getElementById('aliyun-appkey');
    this.aliyunToken = document.getElementById('aliyun-token');
  }

  init() {
    // 初始化粒子背景
    this.particles.init();

    // 初始化语音识别
    this.speech.init();
    this.speech.onResult((finalText, interimText) => this._onResult(finalText, interimText));
    this.speech.onStateChange((state, message) => this._onStateChange(state, message));

    // 绑定主界面事件
    this._bindMainEvents();

    // 绑定设置面板事件
    this._bindSettingsEvents();

    // 初始化设置面板状态
    this._syncSettingsUI();

    // 字体加载完成
    document.fonts.ready.then(() => {
      console.log('HYNiaoWen 字体加载完成');
    });
  }

  // ---- 主界面事件 ----

  _bindMainEvents() {
    this.btnMic.addEventListener('click', () => this._toggleListening());
    this.btnClear.addEventListener('click', () => this._clearTranscript());
    this.btnCopy.addEventListener('click', () => this._copyTranscript());

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        this._toggleListening();
      }
    });
  }

  _toggleListening() {
    if (this.state === SpeechState.IDLE) {
      this.speech.startListening();
    } else if (this.state === SpeechState.LISTENING) {
      this.speech.stopListening();
    } else if (this.state === SpeechState.ERROR) {
      this.speech.resetTranscript();
      this.speech.startListening();
    }
  }

  // ---- 设置面板事件 ----

  _bindSettingsEvents() {
    // 打开设置
    this.btnSettings.addEventListener('click', () => this._openSettings());

    // 关闭设置
    this.btnSettingsClose.addEventListener('click', () => this._closeSettings());
    this.settingsOverlay.addEventListener('click', (e) => {
      if (e.target === this.settingsOverlay) {
        this._closeSettings();
      }
    });

    // 引擎切换
    this.rbNative.addEventListener('change', () => this._onBackendChange());
    this.rbAliyun.addEventListener('change', () => this._onBackendChange());



    // 保存设置
    this.btnSettingsSave.addEventListener('click', () => this._saveSettings());

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !this.settingsOverlay.classList.contains('hidden')) {
        this._closeSettings();
      }
    });
  }

  _openSettings() {
    this._syncSettingsUI();
    this.settingsOverlay.classList.remove('hidden');
  }

  _closeSettings() {
    this.settingsOverlay.classList.add('hidden');
  }

  _syncSettingsUI() {
    const backend = this.speech.getBackend();
    const aliyunConfig = this.speech.getAliyunConfig();

    // 同步引擎选择
    if (backend === BackendType.ALIYUN) {
      this.rbAliyun.checked = true;
    } else {
      this.rbNative.checked = true;
    }

    // 同步阿里云配置
    this.aliyunAppKey.value = aliyunConfig.appKey || this.aliyunAppKey.value;
    this.aliyunToken.value = aliyunConfig.token || this.aliyunToken.value;

    // 更新配置区域状态
    this._updateAliyunConfigState();
  }

  _onBackendChange() {
    this._updateAliyunConfigState();
  }

  _updateAliyunConfigState() {
    if (this.rbAliyun.checked) {
      this.aliyunConfig.classList.remove('disabled');
    } else {
      this.aliyunConfig.classList.add('disabled');
    }
  }

  _saveSettings() {
    let backend;
    if (this.rbAliyun.checked) {
      backend = BackendType.ALIYUN;
    } else {
      backend = BackendType.NATIVE;
    }

    this.speech.setBackend(backend);

    if (backend === BackendType.ALIYUN) {
      this.speech.configureAliyun({
        appKey: this.aliyunAppKey.value.trim(),
        token: this.aliyunToken.value.trim(),
      });
    }

    this._closeSettings();
    this._showToast('设置已保存');
  }

  // ---- 语音识别回调 ----

  _onResult(finalText, interimText) {
    this.transcriptEl.innerHTML = '';

    if (!finalText && !interimText) {
      this.transcriptEl.innerHTML = '<p class="placeholder">正在聆听...</p>';
      return;
    }

    if (finalText) {
      const lines = finalText.split('\n').filter(line => line.trim());
      for (const line of lines) {
        const p = document.createElement('p');
        p.className = 'final';
        p.textContent = line;
        this.transcriptEl.appendChild(p);
      }
    }

    if (interimText) {
      const span = document.createElement('span');
      span.className = 'interim';
      span.textContent = interimText;
      this.transcriptEl.appendChild(span);
    }

    this.transcriptContainer.scrollTop = this.transcriptContainer.scrollHeight;
  }

  _onStateChange(state, message, openSettings) {
    this.state = state;

    switch (state) {
      case SpeechState.IDLE:
        this.btnMic.classList.remove('listening');
        this.waveform.classList.remove('active');
        this.recordingLine.classList.remove('active');
        this.statusEl.textContent = '点击麦克风按钮或按空格键开始';
        this.statusEl.className = '';
        break;

      case SpeechState.LISTENING:
        this.btnMic.classList.add('listening');
        this.waveform.classList.add('active');
        this.recordingLine.classList.add('active');
        const backendLabel = this.speech.getBackend() === BackendType.ALIYUN
          ? '阿里云'
          : '浏览器原生';
        this.statusEl.textContent = `正在聆听... (${backendLabel})`;
        this.statusEl.className = 'active';

        if (!this.speech.getFinalTranscript()) {
          this.transcriptEl.innerHTML = '<p class="placeholder">正在聆听...</p>';
        }
        break;

      case SpeechState.ERROR:
        this.btnMic.classList.remove('listening');
        this.waveform.classList.remove('active');
        this.recordingLine.classList.remove('active');
        this.statusEl.textContent = message || '发生错误，请重试';
        this.statusEl.className = 'error';
        // 如果需要打开设置面板（如原生API失败且阿里云未配置）
        if (openSettings) {
          setTimeout(() => this._openSettings(), 500);
        }
        break;
    }
  }

  // ---- 辅助方法 ----

  _clearTranscript() {
    this.speech.resetTranscript();
    this.transcriptEl.innerHTML = '<p class="placeholder">点击下方麦克风按钮开始语音识别...</p>';
  }



  async _copyTranscript() {
    const text = this.speech.getFinalTranscript();
    if (!text) {
      this._showToast('没有可复制的文本');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      this._showToast('已复制到剪贴板');
    } catch (e) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      this._showToast('已复制到剪贴板');
    }
  }

  _showToast(message) {
    this.toastEl.textContent = message;
    this.toastEl.classList.remove('hidden');
    this.toastEl.classList.add('show');

    setTimeout(() => {
      this.toastEl.classList.remove('show');
      setTimeout(() => {
        this.toastEl.classList.add('hidden');
      }, 300);
    }, 2000);
  }
}

// 启动应用
const app = new App();
app.init();
