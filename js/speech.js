/**
 * 语音识别管理器 - 多后端支持
 * - 浏览器原生 Web Speech API
 * - 讯飞语音听写 WebSocket API
 * - 自动检测网络错误并切换后端
 */

import { XfyunSpeech } from './xfyun-speech.js';

export const SpeechState = {
  IDLE: 'idle',
  LISTENING: 'listening',
  ERROR: 'error',
};

export const BackendType = {
  NATIVE: 'native',
  XFYUN: 'xfyun',
};

export class SpeechRecognition {
  constructor() {
    this.state = SpeechState.IDLE;
    this.resultCallback = null;
    this.stateChangeCallback = null;
    this.finalTranscript = '';
    this.backend = BackendType.NATIVE;
    this.nativeRetryCount = 0;
    this.maxNativeRetry = 1;

    // 原生 Speech Recognition
    this.nativeRecognition = null;

    // 讯飞 Speech Recognition
    this.xfyunRecognition = new XfyunSpeech();

    // 自动切换标志
    this.nativeFailed = false;
  }

  /**
   * 检测浏览器是否支持 Web Speech API
   */
  static isNativeSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  /**
   * 初始化
   */
  init() {
    // 初始化讯飞回调
    this.xfyunRecognition.onResult((finalText, interimText) => {
      this.finalTranscript = finalText;
      if (this.resultCallback) {
        this.resultCallback(finalText, interimText);
      }
    });

    this.xfyunRecognition.onStateChange((state, message) => {
      switch (state) {
        case 'idle':
          this._setState(SpeechState.IDLE);
          break;
        case 'listening':
          this._setState(SpeechState.LISTENING);
          break;
        case 'error':
          this._setState(SpeechState.ERROR, message);
          break;
      }
    });

    // 初始化原生 API
    if (SpeechRecognition.isNativeSupported()) {
      this._initNative();
    }

    // 从 localStorage 恢复配置
    this._loadConfig();
  }

  /**
   * 初始化原生 Web Speech API
   */
  _initNative() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.nativeRecognition = new SR();

    this.nativeRecognition.lang = 'zh-CN';
    this.nativeRecognition.continuous = true;
    this.nativeRecognition.interimResults = true;
    this.nativeRecognition.maxAlternatives = 1;

    this.nativeRecognition.addEventListener('result', (event) => this._onNativeResult(event));
    this.nativeRecognition.addEventListener('end', () => this._onNativeEnd());
    this.nativeRecognition.addEventListener('error', (event) => this._onNativeError(event));
    this.nativeRecognition.addEventListener('start', () => {
      this._setState(SpeechState.LISTENING);
    });
  }

  /**
   * 注册结果回调
   */
  onResult(callback) {
    this.resultCallback = callback;
  }

  /**
   * 注册状态变化回调
   */
  onStateChange(callback) {
    this.stateChangeCallback = callback;
  }

  /**
   * 获取当前后端类型
   */
  getBackend() {
    return this.backend;
  }

  /**
   * 设置后端类型
   */
  setBackend(type) {
    this.backend = type;
    this._saveConfig();
  }

  /**
   * 配置讯飞凭证
   */
  configureXfyun(config) {
    this.xfyunRecognition.configure(config);
    this._saveConfig();
  }

  /**
   * 获取讯飞配置
   */
  getXfyunConfig() {
    return {
      appId: this.xfyunRecognition.appId,
      apiSecret: this.xfyunRecognition.apiSecret,
      apiKey: this.xfyunRecognition.apiKey,
    };
  }

  /**
   * 开始录音识别
   */
  startListening() {
    if (this.backend === BackendType.XFYUN) {
      this._startXfyun();
    } else {
      // 如果原生API之前因网络错误失败，且讯飞已配置，直接使用讯飞
      if (this.nativeFailed && this.xfyunRecognition.isConfigured()) {
        this.backend = BackendType.XFYUN;
        this._saveConfig();
        this._startXfyun();
        return;
      }
      // 如果原生API之前因网络错误失败，且讯飞未配置，直接提示配置
      if (this.nativeFailed) {
        this._setState(SpeechState.ERROR, '浏览器原生语音服务不可用，请在设置中配置讯飞API', true);
        return;
      }
      this._startNative();
    }
  }

  /**
   * 停止录音识别
   */
  stopListening() {
    if (this.backend === BackendType.XFYUN) {
      this.xfyunRecognition.stopListening();
    } else {
      this._stopNative();
    }
    this._setState(SpeechState.IDLE);
  }

  /**
   * 获取已确认文本
   */
  getFinalTranscript() {
    return this.finalTranscript;
  }

  /**
   * 重置文本
   */
  resetTranscript() {
    this.finalTranscript = '';
    if (this.backend === BackendType.XFYUN) {
      this.xfyunRecognition.resetTranscript();
    }
  }

  /**
   * 销毁
   */
  destroy() {
    this._stopNative();
    this.xfyunRecognition.destroy();
  }

  // ---- 原生 API 方法 ----

  _startNative() {
    if (!this.nativeRecognition) {
      this._setState(SpeechState.ERROR, '浏览器不支持 Web Speech API');
      return;
    }

    this._isManualStop = false;
    this._restartDelay = 0;
    this.nativeRetryCount = 0;

    try {
      this.nativeRecognition.start();
    } catch (e) {
      console.warn('Native SpeechRecognition start error:', e);
    }
  }

  _stopNative() {
    if (!this.nativeRecognition) return;
    this._isManualStop = true;

    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }

    try {
      this.nativeRecognition.stop();
    } catch (e) {
      console.warn('Native SpeechRecognition stop error:', e);
    }
  }

  _onNativeResult(event) {
    let interimTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        this.finalTranscript += result[0].transcript;
      } else {
        interimTranscript += result[0].transcript;
      }
    }

    // 成功获得结果，重置重试计数
    this.nativeRetryCount = 0;

    if (this.resultCallback) {
      this.resultCallback(this.finalTranscript, interimTranscript);
    }
  }

  _onNativeEnd() {
    if (this._isManualStop) {
      // 仅在未处于ERROR状态时重置为IDLE
      // 避免覆盖 _onNativeError 中已设置的ERROR状态
      if (this.state !== SpeechState.ERROR) {
        this._setState(SpeechState.IDLE);
      }
      return;
    }

    // 自动重连
    this._restartDelay = Math.min((this._restartDelay || 0) + 100, 2000);
    this._restartTimer = setTimeout(() => {
      if (!this._isManualStop && this.state === SpeechState.LISTENING) {
        try {
          this.nativeRecognition.start();
        } catch (e) {
          console.warn('Native SpeechRecognition restart error:', e);
        }
      }
    }, this._restartDelay);
  }

  _onNativeError(event) {
    console.warn('Native SpeechRecognition error:', event.error);

    switch (event.error) {
      case 'not-allowed':
        this._isManualStop = true;
        this._setState(SpeechState.ERROR, '麦克风权限被拒绝，请在浏览器设置中允许访问麦克风');
        break;

      case 'network':
        this.nativeRetryCount++;
        // 如果原生 API 网络错误，自动建议切换到讯飞
        this.nativeFailed = true;
        if (this.nativeRetryCount >= this.maxNativeRetry) {
          this._isManualStop = true;
          if (this.xfyunRecognition.isConfigured()) {
            this._setState(SpeechState.ERROR, '网络错误（可能无法访问Google服务），已自动切换到讯飞引擎');
            // 自动切换到讯飞
            this.backend = BackendType.XFYUN;
            this._saveConfig();
            // 短暂延迟后自动用讯飞重试
            setTimeout(() => {
              this.finalTranscript = '';
              this._startXfyun();
            }, 500);
          } else {
            this._setState(SpeechState.ERROR, '网络错误，无法连接语音识别服务。请在设置中配置讯飞API以使用国内语音识别');
          }
        }
        break;

      case 'no-speech':
        // 静默重试
        break;

      case 'aborted':
        break;

      default:
        console.warn('Unhandled native speech error:', event.error);
        break;
    }
  }

  // ---- 讯飞 API 方法 ----

  _startXfyun() {
    if (!this.xfyunRecognition.isConfigured()) {
      this._setState(SpeechState.ERROR, '请先在设置中配置讯飞 API 凭证');
      return;
    }
    this.xfyunRecognition.startListening();
  }

  // ---- 内部方法 ----

  _setState(newState, message, openSettings = false) {
    if (this.state !== newState || message) {
      this.state = newState;
      if (this.stateChangeCallback) {
        this.stateChangeCallback(newState, message, openSettings);
      }
    }
  }

  _saveConfig() {
    try {
      const config = {
        backend: this.backend,
        xfyun: {
          appId: this.xfyunRecognition.appId,
          apiSecret: this.xfyunRecognition.apiSecret,
          apiKey: this.xfyunRecognition.apiKey,
        },
      };
      localStorage.setItem('speech-recognition-config', JSON.stringify(config));
    } catch (e) {
      console.warn('保存配置失败:', e);
    }
  }

  _loadConfig() {
    try {
      const saved = localStorage.getItem('speech-recognition-config');
      if (saved) {
        const config = JSON.parse(saved);
        if (config.backend) {
          this.backend = config.backend;
        }
        if (config.xfyun) {
          this.xfyunRecognition.configure(config.xfyun);
        }
      }
    } catch (e) {
      console.warn('加载配置失败:', e);
    }
  }
}
