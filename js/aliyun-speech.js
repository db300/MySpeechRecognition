/**
 * 阿里云智能语音识别 WebSocket API 客户端
 * - 使用 NLS 实时语音转写 WebSocket 协议
 * - 适用于国内网络环境，识别准确率高
 * - 使用 AudioContext 捕获 PCM 音频
 * - WebSocket 实时传输，获取识别结果
 *
 * 使用前需在阿里云智能语音交互控制台：
 * 1. 创建项目，获取 AppKey
 * 2. 获取 Access Token（通过控制台或服务端 API）
 */

const ALIYUN_WS_URL = 'wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1';
const SAMPLE_RATE = 16000;
const FRAME_SIZE = 6400; // 每次发送的音频字节数（200ms @ 16kHz 16bit）

export class AliyunSpeech {
  constructor() {
    this.appKey = '';
    this.token = '';
    this.ws = null;
    this.audioContext = null;
    this.mediaStream = null;
    this.scriptProcessor = null;
    this.sourceNode = null;
    this.audioBuffer = [];
    this.isRunning = false;
    this.resultCallback = null;
    this.stateChangeCallback = null;
    this.finalTranscript = '';

    // 重连控制
    this._isManualStop = false;
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 3;
    this._reconnectTimer = null;

    // 任务 ID
    this._taskId = '';
  }

  /**
   * 配置阿里云凭证
   */
  configure({ appKey, token } = {}) {
    if (appKey !== undefined) this.appKey = appKey;
    if (token !== undefined) this.token = token;
  }

  /**
   * 检查是否已配置
   */
  isConfigured() {
    return !!(this.appKey && this.token);
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
   * 开始录音识别
   */
  async startListening() {
    if (!this.isConfigured()) {
      if (this.stateChangeCallback) {
        this.stateChangeCallback('error', '请先在设置中配置阿里云 AppKey 和 Token');
      }
      return;
    }

    // 重置重连状态
    this._isManualStop = false;
    this._reconnectAttempts = 0;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    try {
      // 获取麦克风权限
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // 创建 AudioContext
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
      });

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // 使用 ScriptProcessorNode 捕获 PCM 数据
      this.scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.scriptProcessor.onaudioprocess = (e) => {
        if (!this.isRunning) return;
        const float32Data = e.inputBuffer.getChannelData(0);
        const int16Data = this._float32ToInt16(float32Data);
        this.audioBuffer.push(int16Data);
        this._sendAudio();
      };

      this.sourceNode.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);

      // 连接 WebSocket
      await this._connectWebSocket();

      this.isRunning = true;
      if (this.stateChangeCallback) {
        this.stateChangeCallback('listening');
      }
    } catch (err) {
      console.error('阿里云语音识别启动失败:', err);
      let message = '启动失败';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        message = '麦克风权限被拒绝';
      } else if (err.name === 'NotFoundError') {
        message = '未找到麦克风设备';
      } else if (err.message && err.message.includes('WebSocket')) {
        message = '连接阿里云服务失败，请检查Token和网络';
      }
      if (this.stateChangeCallback) {
        this.stateChangeCallback('error', message);
      }
      this._cleanupAll();
    }
  }

  /**
   * 停止录音识别（手动停止，不触发重连）
   */
  stopListening() {
    this._isManualStop = true;

    // 清除重连定时器
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (!this.isRunning) return;
    this.isRunning = false;

    // 发送停止指令
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._sendStopCommand();
    }

    this._cleanupAll();

    if (this.stateChangeCallback) {
      this.stateChangeCallback('idle');
    }
  }

  /**
   * 获取已确认的文本
   */
  getFinalTranscript() {
    return this.finalTranscript;
  }

  /**
   * 重置文本
   */
  resetTranscript() {
    this.finalTranscript = '';
  }

  /**
   * 销毁实例
   */
  destroy() {
    this.stopListening();
  }

  // ---- 内部方法 ----

  /**
   * 连接 WebSocket
   */
  _connectWebSocket() {
    const url = `${ALIYUN_WS_URL}?token=${this.token}`;
    this._taskId = this._generateUUID();
    this._currentSentenceIndex = 0;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      let settled = false;

      this.ws.onopen = () => {
        // 发送 StartTranscription 指令
        this._sendStartCommand();
        settled = true;
        resolve();
      };

      this.ws.onmessage = (event) => {
        this._onMessage(event);
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        if (!settled) {
          settled = true;
          reject(new Error('WebSocket 连接失败'));
        }
        // 连接已建立后的错误，由 onclose 处理重连
      };

      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        if (!settled) {
          settled = true;
          reject(new Error('WebSocket 连接关闭'));
          return;
        }

        // 连接曾建立成功，现在断开了
        if (this._isManualStop) return;
        if (!this.isRunning) return;

        // 非手动断开，尝试自动重连
        this._tryReconnect();
      };
    });
  }

  /**
   * 生成 32 位 UUID（hex 格式）
   */
  _generateUUID() {
    return 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'.replace(/x/g, () => {
      return Math.floor(Math.random() * 16).toString(16);
    });
  }

  /**
   * 发送 StartTranscription 指令
   */
  _sendStartCommand() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const message = {
      header: {
        message_id: this._generateUUID(),
        task_id: this._taskId,
        namespace: 'SpeechTranscriber',
        name: 'StartTranscription',
        appkey: this.appKey,
      },
      payload: {
        format: 'PCM',
        sample_rate: SAMPLE_RATE,
        enable_intermediate_result: true,
        enable_punctuation_prediction: true,
        enable_inverse_text_normalization: true,
        max_sentence_silence: 800,
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 发送 StopTranscription 指令
   */
  _sendStopCommand() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const message = {
      header: {
        message_id: this._generateUUID(),
        task_id: this._taskId,
        namespace: 'SpeechTranscriber',
        name: 'StopTranscription',
        appkey: this.appKey,
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * 发送音频数据
   */
  _sendAudio() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    while (this.audioBuffer.length > 0) {
      const data = this.audioBuffer.shift();
      if (data && data.byteLength > 0) {
        this.ws.send(data);
      }
    }
  }

  /**
   * 处理 WebSocket 消息
   */
  _onMessage(event) {
    try {
      const response = JSON.parse(event.data);
      const header = response.header;
      const payload = response.payload;

      if (!header) return;

      // 检查错误状态
      if (header.status && header.status !== 20000000) {
        console.error('阿里云API错误:', header.status, header.status_message);

        if (header.status === 40000002) {
          // 无效消息
          return;
        }

        if (header.status >= 40000000 && header.status < 50000000) {
          // 客户端错误，停止识别
          this.isRunning = false;
          this._cleanupAll();
          if (this.stateChangeCallback) {
            this.stateChangeCallback('error', `阿里云服务错误: ${header.status_message || '未知错误'}`);
          }
          return;
        }
      }

      const name = header.name;

      switch (name) {
        case 'TranscriptionStarted':
          // 服务端已准备好，可以发送音频
          break;

        case 'SentenceBegin':
          // 一句话开始
          break;

        case 'TranscriptionResultChanged':
          // 中间识别结果
          if (payload && payload.result) {
            if (this.resultCallback) {
              this.resultCallback(this.finalTranscript, payload.result);
            }
          }
          break;

        case 'SentenceEnd':
          // 一句话结束，最终结果，换行拼接
          if (payload && payload.result) {
            if (this.finalTranscript) {
              this.finalTranscript += '\n' + payload.result;
            } else {
              this.finalTranscript = payload.result;
            }
            if (this.resultCallback) {
              this.resultCallback(this.finalTranscript, '');
            }
          }
          break;

        case 'TranscriptionCompleted':
          // 转写完成
          break;
      }
    } catch (err) {
      console.error('解析阿里云响应失败:', err);
    }
  }

  /**
   * 尝试自动重连
   */
  _tryReconnect() {
    if (this._reconnectTimer) return;

    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      this.isRunning = false;
      this._cleanupAll();
      if (this.stateChangeCallback) {
        this.stateChangeCallback('error', '阿里云服务连接断开，请重新点击麦克风按钮');
      }
      return;
    }

    this._reconnectAttempts++;
    const delay = Math.min(1000 * this._reconnectAttempts, 5000);
    console.log(`尝试重新连接阿里云服务 (${this._reconnectAttempts}/${this._maxReconnectAttempts})，${delay}ms后...`);

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;

      if (!this.isRunning || this._isManualStop) return;

      try {
        // 只重连 WebSocket，保留 AudioContext 和麦克风
        this._cleanupWebSocket();
        this.audioBuffer = [];
        await this._connectWebSocket();
        this._reconnectAttempts = 0;
        console.log('阿里云服务重新连接成功');
      } catch (err) {
        console.warn('重新连接失败:', err.message);
      }
    }, delay);
  }

  /**
   * 完全清理所有资源
   */
  _cleanupAll() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    this._cleanupWebSocket();
  }

  /**
   * 仅清理 WebSocket 资源
   */
  _cleanupWebSocket() {
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    this.audioBuffer = [];
  }

  /**
   * Float32 转 Int16 PCM
   */
  _float32ToInt16(float32Array) {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16Array.buffer;
  }
}
