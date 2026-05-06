/**
 * StreamingTTSPlayer.ts
 * 
 * 一个用于播放「流式 Base64 MP3」音频的播放器。
 * 使用 MediaSource + SourceBuffer 实现边接收边播放，不卡顿无杂音。
 */

export interface StreamingTTSPlayerOptions {
  /** 用于监听播放器状态（ready、error 等）的回调 */
  onEvent?: (event: string, data?: any) => void;
}

export class StreamingTTSPlayer {
  private audio: HTMLAudioElement;           // 播放用的 <audio> 元素
  private mediaSource: MediaSource;           // 媒体源（支持流式拼接）
  private sourceBuffer: SourceBuffer | null = null; // 用于接收音频块的缓冲区
  private queue: ArrayBuffer[] = [];          // 等待写入 SourceBuffer 的音频块队列
  private isBufferUpdating = false;            // 是否正在写入数据（避免并发）
  private onEvent?: (event: string, data?: any) => void; // 事件回调

  constructor(options?: StreamingTTSPlayerOptions) {
    this.onEvent = options?.onEvent;

    // 1. 创建 HTMLAudioElement
    this.audio = new Audio();

    // 2. 创建 MediaSource 并挂载到 audio 元素
    this.mediaSource = new MediaSource();
    this.audio.src = URL.createObjectURL(this.mediaSource);

    // 3. 等待 mediaSource 初始化完成
    this.mediaSource.addEventListener("sourceopen", () => {
      try {
        // 4. 创建一个 MP3 类型的 SourceBuffer，用于接收音频块
        this.sourceBuffer = this.mediaSource.addSourceBuffer('audio/mpeg');

        // 5. 设置拼接模式为 sequence（自动按顺序拼接）
        this.sourceBuffer.mode = 'sequence';

        // 6. 每次 appendBuffer 完成后触发 updateend，继续处理队列
        this.sourceBuffer.addEventListener('updateend', () => this.feedQueue());

        this.emit("ready");
      } catch (err) {
        console.error("Failed to add sourceBuffer:", err);
        this.emit("error", err);
      }
    });

    // 监听 audio 元素播放错误
    this.audio.addEventListener("error", (e) => {
      this.emit("error", e);
    });
  }

  /**
   * 接收一段 base64 MP3 数据块并放入播放队列
   * @param base64 base64 编码的 MP3 数据块
   * @param autoPlay 是否自动开始播放（默认 true）
   */
  receiveBase64(base64: string, autoPlay = true) {
    try {
      const buffer = this.base64ToArrayBuffer(base64);
      this.queue.push(buffer);
      this.feedQueue(); // 立即尝试送入 SourceBuffer
      if (autoPlay) this.play();
    } catch (err) {
      console.error("TTS decode error:", err);
      this.emit("error", err);
    }
  }

  /** 播放（如果已暂停） */
  play() {
    if (this.audio.paused) {
      this.audio.play().catch(() => {});
    }
  }

  /** 暂停播放 */
  pause() {
    if (!this.audio.paused) {
      this.audio.pause();
    }
  }

  /**
   * 停止播放并清空缓冲
   * （会丢弃所有未播放的数据）
   */
  stop() {
    this.pause();
    this.queue = [];
    if (this.mediaSource.readyState === "open" && this.sourceBuffer && !this.sourceBuffer.updating) {
      try {
        this.sourceBuffer.abort(); // 终止当前的缓冲区写入
      } catch {}
    }
    this.audio.currentTime = 0;
  }

  /**
   * 内部方法：尝试把队列中的数据 append 到 SourceBuffer
   */
  private feedQueue() {
    // 没有 SourceBuffer 或正在写入时不处理
    if (!this.sourceBuffer || this.isBufferUpdating) return;
    if (this.queue.length === 0) return;

    if (!this.sourceBuffer.updating) {
      const chunk = this.queue.shift()!;
      try {
        this.isBufferUpdating = true;
        this.sourceBuffer.appendBuffer(chunk); // 核心：追加 MP3 数据到播放流
        this.isBufferUpdating = false;
      } catch (err) {
        console.error("Failed to append buffer:", err);
        this.emit("error", err);
      }
    }
  }

  /**
   * Base64 -> ArrayBuffer 转换工具
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64.replace(/^data:audio\/\w+;base64,/, ""));
    const len = binary.length;
    const buffer = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      buffer[i] = binary.charCodeAt(i);
    }
    return buffer.buffer;
  }

  /** 触发事件回调 */
  private emit(event: string, data?: any) {
    this.onEvent?.(event, data);
  }
}

