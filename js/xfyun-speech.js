/**
 * 讯飞语音听写 WebSocket API 客户端
 * - 适用于中国大陆网络环境
 * - 使用 AudioContext 捕获 PCM 音频
 * - WebSocket 实时传输，获取识别结果
 *
 * 使用前需在 https://www.xfyun.cn/ 注册并创建应用，获取：
 * - APPID
 * - APISecret
 * - APIKey
 */

const XFYUN_URL = 'wss://iat-api.xfyun.cn/v2/iat';
const SAMPLE_RATE = 16000;
const FRAME_SIZE = 4096; // 每次发送的音频字节数

export class XfyunSpeech {
  constructor() {
    this.appId = '';
    this.apiSecret = '';
    this.apiKey = '';
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
  }

  /**
   * 配置讯飞 API 凭证
   */
  configure({ appId, apiSecret, apiKey }) {
    this.appId = appId;
    this.apiSecret = apiSecret;
    this.apiKey = apiKey;
  }

  /**
   * 检查是否已配置
   */
  isConfigured() {
    return !!(this.appId && this.apiSecret && this.apiKey);
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
        this.stateChangeCallback('error', '请先在设置中配置讯飞 API 凭证');
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
        }
      });

      // 创建 AudioContext
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE
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
      console.error('讯飞语音识别启动失败:', err);
      let message = '启动失败';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        message = '麦克风权限被拒绝';
      } else if (err.name === 'NotFoundError') {
        message = '未找到麦克风设备';
      } else if (err.message && err.message.includes('WebSocket')) {
        message = '连接讯飞服务失败，请检查网络和API配置';
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

    // 发送结束标志
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._sendFrame('', true);
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
   * 连接 WebSocket（支持重连）
   */
  async _connectWebSocket() {
    const url = await this._buildAuthUrlAsync();
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      let settled = false;

      this.ws.onopen = () => {
        // 发送开始帧
        this._sendFrame('', false, true);
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
          // 初始连接就失败了
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
   * 使用异步方式构建认证URL
   */
  async _buildAuthUrlAsync() {
    const host = 'iat-api.xfyun.cn';
    const path = '/v2/iat';
    const date = new Date().toUTCString();

    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
    const signature = await this._hmacSha256(signatureOrigin, this.apiSecret);
    const authorization = `api_key="${this.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;

    const authBase64 = btoa(authorization);
    const encodedDate = encodeURIComponent(date);

    return `${XFYUN_URL}?authorization=${authBase64}&date=${encodedDate}&host=${host}`;
  }

  /**
   * HMAC-SHA256 签名（使用 Web Crypto API）
   */
  async _hmacSha256(message, secret) {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    const array = new Uint8Array(signatureBuffer);
    let hex = '';
    for (let i = 0; i < array.length; i++) {
      hex += array[i].toString(16).padStart(2, '0');
    }
    return hex;
  }

  /**
   * 发送音频帧
   */
  _sendAudio() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    while (this.audioBuffer.length > 0) {
      const data = this.audioBuffer.shift();
      if (data && data.length > 0) {
        this._sendFrame(this._arrayBufferToBase64(data), false);
      }
    }
  }

  /**
   * 发送一帧数据
   * 首帧：包含 business 参数（语言、领域等）
   * 中间帧：只包含 data
   * 尾帧：status=2，data.audio 为空
   */
  _sendFrame(audioBase64, isEnd, isFirst) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const status = isEnd ? 2 : (isFirst ? 0 : 1);
    const frame = {
      data: {
        status: status,
        format: 'audio/L16;rate=16000',
        encoding: 'raw',
        audio: isFirst ? '' : (audioBase64 || ''),
      },
    };

    // 首帧需要携带 common 和 business 参数
    if (isFirst) {
      frame.common = {
        app_id: this.appId,
      };
      frame.business = {
        language: 'zh_cn',
        domain: 'iat',
        accent: 'mandarin',
        dwa: 'wpgs', // 动态修正
        vad_eos: 5000,
      };
    }

    this.ws.send(JSON.stringify(frame));
  }

  /**
   * 处理 WebSocket 消息
   */
  _onMessage(event) {
    try {
      const response = JSON.parse(event.data);
      const code = response.code;

      if (code !== 0) {
        console.error('讯飞API错误:', code, response.message);
        // 不调用 stopListening()，避免 idle 回调覆盖 error 状态
        this.isRunning = false;
        this._cleanupAll();
        if (this.stateChangeCallback) {
          this.stateChangeCallback('error', `讯飞服务错误 (${code}): ${response.message || '未知错误'}`);
        }
        return;
      }

      const data = response.data;
      if (!data) return;

      const result = data.result;
      if (!result) return;

      // 解析识别结果
      const ws = result.ws;
      if (!ws) return;

      let text = '';
      for (const item of ws) {
        for (const cw of item.cw) {
          text += cw.w;
        }
      }

      // 判断是中间结果还是最终结果
      const isFinal = data.status === 2;
      const ls = result.ls; // 是否是最后一片结果

      if (isFinal || ls) {
        this.finalTranscript += text;
        if (this.resultCallback) {
          this.resultCallback(this.finalTranscript, '');
        }
      } else {
        // 中间结果
        if (this.resultCallback) {
          this.resultCallback(this.finalTranscript, text);
        }
      }
    } catch (err) {
      console.error('解析讯飞响应失败:', err);
    }
  }

  /**
   * 尝试自动重连 WebSocket
   * - 仅关闭 WebSocket，保留 AudioContext 和麦克风
   * - 最多重连 3 次，每次间隔递增
   */
  _tryReconnect() {
    if (this._reconnectTimer) return; // 已在重连中

    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      // 超过最大重连次数，彻底放弃
      this.isRunning = false;
      this._cleanupAll();
      if (this.stateChangeCallback) {
        this.stateChangeCallback('error', '讯飞服务连接断开，请重新点击麦克风按钮');
      }
      return;
    }

    this._reconnectAttempts++;
    const delay = Math.min(1000 * this._reconnectAttempts, 5000);
    console.log(`尝试重新连接讯飞服务 (${this._reconnectAttempts}/${this._maxReconnectAttempts})，${delay}ms后...`);

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;

      if (!this.isRunning || this._isManualStop) return;

      try {
        // 只重连 WebSocket，保留 AudioContext 和麦克风
        this._cleanupWebSocket();
        this.audioBuffer = []; // 清除陈旧音频数据
        await this._connectWebSocket();
        this._reconnectAttempts = 0;
        console.log('讯飞服务重新连接成功');
      } catch (err) {
        // 重连失败，onclose 会再次触发 _tryReconnect
        console.warn('重新连接失败:', err.message);
      }
    }, delay);
  }

  /**
   * 完全清理所有资源（AudioContext + 麦克风 + WebSocket）
   */
  _cleanupAll() {
    // 清除重连定时器
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
   * 仅清理 WebSocket 资源（重连时使用，保留 AudioContext）
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

  /**
   * ArrayBuffer 转 Base64
   */
  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }
}
