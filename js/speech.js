/**
 * 语音识别管理器 - 多后端支持
 * - 浏览器原生 Web Speech API
 * - 阿里云智能语音交互 WebSocket API
 * - 自动检测错误并切换后端
 */

import { AliyunSpeech } from './aliyun-speech.js';

export const SpeechState = {
  IDLE: 'idle',
  LISTENING: 'listening',
  ERROR: 'error',
};

export const BackendType = {
  NATIVE: 'native',
  ALIYUN: 'aliyun',
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

    // 阿里云 Speech Recognition
    this.aliyunRecognition = new AliyunSpeech();

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
    // 初始化阿里云回调
    this.aliyunRecognition.onResult((finalText, interimText) => {
      this.finalTranscript = finalText;
      if (this.resultCallback) {
        this.resultCallback(finalText, interimText);
      }
    });

    this.aliyunRecognition.onStateChange((state, message) => {
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
   * 配置阿里云凭证
   */
  configureAliyun(config) {
    this.aliyunRecognition.configure(config);
    this._saveConfig();
  }

  /**
   * 获取阿里云配置
   */
  getAliyunConfig() {
    return {
      appKey: this.aliyunRecognition.appKey,
      token: this.aliyunRecognition.token,
    };
  }

  /**
   * 开始录音识别
   */
  startListening() {
    if (this.backend === BackendType.ALIYUN) {
      this._startAliyun();
    } else {
      // 如果原生API之前因网络错误失败，且阿里云已配置，直接使用阿里云
      if (this.nativeFailed && this.aliyunRecognition.isConfigured()) {
        this.backend = BackendType.ALIYUN;
        this._saveConfig();
        this._startAliyun();
        return;
      }
      // 如果原生API之前因网络错误失败，且阿里云未配置，直接提示配置
      if (this.nativeFailed) {
        this._setState(SpeechState.ERROR, '浏览器原生语音服务不可用，请在设置中配置阿里云API', true);
        return;
      }
      this._startNative();
    }
  }

  /**
   * 停止录音识别
   */
  stopListening() {
    if (this.backend === BackendType.ALIYUN) {
      this.aliyunRecognition.stopListening();
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
    if (this.backend === BackendType.ALIYUN) {
      this.aliyunRecognition.resetTranscript();
    }
  }

  /**
   * 销毁
   */
  destroy() {
    this._stopNative();
    this.aliyunRecognition.destroy();
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
        // 如果原生 API 网络错误，自动建议切换到阿里云
        this.nativeFailed = true;
        if (this.nativeRetryCount >= this.maxNativeRetry) {
          this._isManualStop = true;
          if (this.aliyunRecognition.isConfigured()) {
            this._setState(SpeechState.ERROR, '网络错误（可能无法访问Google服务），已自动切换到阿里云引擎');
            // 自动切换到阿里云
            this.backend = BackendType.ALIYUN;
            this._saveConfig();
            // 短暂延迟后自动用阿里云重试
            setTimeout(() => {
              this.finalTranscript = '';
              this._startAliyun();
            }, 500);
          } else {
            this._setState(SpeechState.ERROR, '网络错误，无法连接语音识别服务。请在设置中配置阿里云API以使用国内语音识别');
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

  // ---- 阿里云 API 方法 ----

  _startAliyun() {
    if (!this.aliyunRecognition.isConfigured()) {
      this._setState(SpeechState.ERROR, '请先在设置中配置阿里云 AppKey 和 Token');
      return;
    }
    this.aliyunRecognition.startListening();
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
        aliyun: {
          appKey: this.aliyunRecognition.appKey,
          token: this.aliyunRecognition.token,
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
          // 兼容旧配置中的 xfyun 后端，映射到 native
          if (config.backend === 'xfyun') {
            this.backend = BackendType.NATIVE;
          } else {
            this.backend = config.backend;
          }
        }
        if (config.aliyun) {
          this.aliyunRecognition.configure(config.aliyun);
        }
      }
    } catch (e) {
      console.warn('加载配置失败:', e);
    }
  }
}
