# StreamingTTSPlayer
TTS流式播放优化方案，可直接使用的封装类，只需传入 Base64 MP3 数据块，即可实现流式播放

使用方式
```
const player = new StreamingTTSPlayer();

// 每收到一块 TTS 音频数据就塞进去
ws.onmessage = (e) => {
  const data = JSON.parse(e.data);
  if (data.audio) player.receiveBase64(data.audio);
};
```

🚀 真正流畅的做法：MediaSource + SourceBuffer
后来我们换成浏览器原生支持的 MediaSource Extensions (MSE) 技术：

创建 MediaSource 作为音频流容器
mediaSource.addSourceBuffer('audio/mpeg') 声明要接收 MP3 流
每收到一块 Base64 MP3：

转为 ArrayBuffer
sourceBuffer.appendBuffer(buffer) 追加到播放流


浏览器底层会自动解码 + 缓冲 + 拼接播放

结果立刻变得丝滑：
✅ 接收即播，低延迟
✅ 无缝拼接，无杂音
✅ 不再卡顿，性能极佳
✅ 兼容所有现代浏览器（Chrome / Edge / Firefox / Safari）
