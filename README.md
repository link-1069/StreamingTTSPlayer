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
