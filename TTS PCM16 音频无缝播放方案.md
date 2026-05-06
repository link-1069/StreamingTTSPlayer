# TTS 音频无缝播放方案

## 问题背景

在通过 WebSocket 中转（SDK → Node.js → WebSocket → 浏览器）流式接收 PCM16 音频时，由于网络抖动，音频块到达时间不均匀，容易出现**卡顿**。

常见错误方案：使用 `AudioWorklet` + 环形缓冲区（如 `PcmPlaybackBuffer`）。当缓冲区耗尽时，缓冲区进入等待状态，输出静音，等到下一个块到达后才恢复播放，造成可听见的卡顿。

## 核心方案：AudioBufferSourceNode 精确调度

利用 Web Audio API 的 `AudioContext.currentTime` 时间线对音频块进行**精确时间调度**，让每个块在上一个块结束的瞬间开始，实现零间隔衔接。

### 关键原理

```
块1: [start=T0,       end=T0+d1]
块2: [start=T0+d1,    end=T0+d1+d2]
块3: [start=T0+d1+d2, end=T0+d1+d2+d3]
```

无论块何时到达（网络抖动），`source.start(scheduledTime)` 均会按计划时间播放，不产生间隙。

### 完整实现（React Hook）

```typescript
import { useRef, useState, useCallback } from 'react';

const SAMPLE_RATE = 24000; // Voice Live 默认输出采样率

export function useAudioPlayback() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const nextStartTimeRef = useRef(0);          // 下一个块的计划开始时间
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]); // 用于打断
  const isMutedRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPlaybackMuted, setIsPlaybackMuted] = useState(false);

  // 初始化（需在用户手势回调中调用，如点击事件）
  const initPlayback = useCallback(async () => {
    if (audioContextRef.current) return;
    const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    audioContextRef.current = audioContext;
    const gainNode = audioContext.createGain();
    gainNodeRef.current = gainNode;
    gainNode.gain.value = isMutedRef.current ? 0 : 1;
    gainNode.connect(audioContext.destination);
  }, []);

  // 播放一个 base64 编码的 PCM16 音频块
  const playAudio = useCallback(async (base64Data: string) => {
    if (!audioContextRef.current) await initPlayback();
    const audioContext = audioContextRef.current!;
    if (audioContext.state === 'suspended') await audioContext.resume();

    // 1. 解码 base64 → Int16Array
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const int16Data = new Int16Array(bytes.buffer);
    if (int16Data.length === 0) return;

    // 2. PCM16 → Float32 → AudioBuffer
    const audioBuffer = audioContext.createBuffer(1, int16Data.length, SAMPLE_RATE);
    const float32Data = audioBuffer.getChannelData(0);
    for (let i = 0; i < int16Data.length; i++) {
      float32Data[i] = int16Data[i] / 32768.0;
    }

    // 3. 精确调度：紧接上一块结束时间，或立即播放（首块 / 间隙后）
    const now = audioContext.currentTime;
    const startTime = Math.max(now, nextStartTimeRef.current);
    nextStartTimeRef.current = startTime + audioBuffer.duration;

    // 4. 创建并启动 AudioBufferSourceNode
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(gainNodeRef.current!);
    activeSourcesRef.current.push(source);
    source.onended = () => {
      const idx = activeSourcesRef.current.indexOf(source);
      if (idx > -1) activeSourcesRef.current.splice(idx, 1);
      if (activeSourcesRef.current.length === 0) setIsPlaying(false);
    };
    source.start(startTime);
    setIsPlaying(true);
  }, [initPlayback]);

  // 立即停止（用于打断 / barge-in）
  const stopPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((source) => {
      try { source.stop(); } catch (_) {}
    });
    activeSourcesRef.current = [];
    nextStartTimeRef.current = 0; // 重置调度时间线
    setIsPlaying(false);
  }, []);

  // 静音切换
  const togglePlaybackMute = useCallback(() => {
    const muted = !isMutedRef.current;
    isMutedRef.current = muted;
    setIsPlaybackMuted(muted);
    if (gainNodeRef.current) gainNodeRef.current.gain.value = muted ? 0 : 1;
  }, []);

  // 销毁（页面卸载 / 会话结束）
  const cleanupPlayback = useCallback(() => {
    stopPlayback();
    gainNodeRef.current?.disconnect();
    gainNodeRef.current = null;
    if (audioContextRef.current?.state !== 'closed') audioContextRef.current?.close();
    audioContextRef.current = null;
  }, [stopPlayback]);

  return { playAudio, stopPlayback, initPlayback, cleanupPlayback,
           isPlaying, isPlaybackMuted, isMutedRef, togglePlaybackMute };
}
```

## 关键设计点

| 点 | 说明 |
|---|---|
| `Math.max(now, nextStartTime)` | 首块或间隙后立即播放，不在过去的时间点调度 |
| `nextStartTimeRef` | 纯 ref，避免 React 重渲染导致时间错乱 |
| `activeSourcesRef` | 收集所有活跃 source，支持随时 `stop()` 打断 |
| `stopPlayback` 重置 `nextStartTimeRef = 0` | 打断后下一个响应从当前时间重新开始调度 |
| GainNode 控制音量 | 静音时 `gain=0` 而非停止播放，保持调度时间线连续 |

## 与 AudioWorklet 方案对比

| | AudioWorklet + 环形缓冲区 | AudioBufferSourceNode 精确调度（本方案）|
|---|---|---|
| 卡顿原因 | 缓冲区耗尽 → 输出静音 → 重新填充 | 无，块与块时间线无缝衔接 |
| 网络抖动容忍度 | 低（依赖缓冲区持续有数据） | 高（块提前/延迟到达均不影响已调度的播放）|
| 打断实现 | 向 Worklet 发送 `null` 消息清空缓冲区 | 直接 `source.stop()` 立即生效 |
| 延迟 | 有预缓冲延迟（如 100ms） | 零额外延迟 |
| 实现复杂度 | 需要额外的 Worklet 文件 | 纯主线程，无需额外文件 |

## 适用场景

- 实时 TTS 流式输出（PCM16，24000 Hz，单声道）
- WebSocket / WebRTC 等有网络抖动的传输通道
- 需要支持 barge-in（用户打断 AI 回答）的对话系统
- 基于 Azure Voice Live / OpenAI Realtime API 的应用

## 音频格式说明

Voice Live 输出格式：

```
编码: PCM16（有符号 16 位整数，小端序）
采样率: 24000 Hz
声道: 1（单声道）
传输: base64 编码的二进制
```

Float32 转换公式：`float32 = int16 / 32768.0`
