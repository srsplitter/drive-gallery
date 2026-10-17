// 영상 합치기 엔진 (PC 크롬·엣지). 서버 없이 이 브라우저가 직접:
//   각 영상을 조금씩 읽어(read) → 풀고(디코딩) → [썸네일 1초] + 영상을 차례로 이어 → 다시 압축(H.264 + AAC) →
//   표준 MP4 를 조금씩 writable 로 흘려보냄(위치 지정 쓰기 — 화면 쪽이 브라우저 임시 파일에 받아 둔 뒤 드라이브에 올림).
// 해상도는 첫 영상에 맞추고, 다른 크기·회전 영상은 검은 여백을 두고 가운데에 맞춤.
// 시간 이어 붙이기는 WebAV fastConcatMP4 처럼 "각 영상의 첫 시간을 0으로 맞춘 뒤 지금까지의 길이를 더함".
// 영상·소리 길이가 다르면 짧은 쪽 뒤를 비워 두지 않고 소리는 무음으로 채워 다음 영상과 어긋나지 않게 함.
// Mediabunny(MPL-2.0, vendor/ 에 그대로 둠)를 씀.
const VideoMerge = (() => {
  let lib = null;
  const load = () => lib || (lib = import('./vendor/mediabunny-1.60.0.min.mjs'));
  const even = n => Math.max(2, Math.round(n / 2) * 2);
  const RATE = 48000, CH = 2;

  // parts: [{ name, size, read(start, end) → Promise<Uint8Array>, intro?: CanvasImageSource }]
  // writable: WritableStream<Uint8Array> (앞에서부터 차례로만 씀)
  // onProgress({ done, total, part, phase })
  async function merge({ parts, writable, onProgress = () => {}, signal }) {
    const MB = await load();
    const check = () => { if (signal && signal.aborted) throw new DOMException('취소했어요', 'AbortError'); };

    // 1) 영상마다 열어서 트랙·길이 확인 (파일 앞·뒤 색인만 읽음)
    const inputs = [];
    for (const p of parts) {
      check();
      const input = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.CustomSource({
        getSize: () => p.size, read: (s, e) => p.read(s, e), prefetchProfile: 'network' }) });
      const v = await input.getPrimaryVideoTrack();
      if (!v) throw new Error(`"${p.name}" 에서 영상을 찾지 못했어요.`);
      if (!await v.canDecode()) throw new Error(`"${p.name}" 은(는) 이 브라우저가 풀 수 없는 형식이에요 (${await v.getCodec() || '알 수 없음'}).`);
      let a = await input.getPrimaryAudioTrack();
      if (a && !await a.canDecode()) a = null; // 못 푸는 소리는 무음으로
      const first = await input.getFirstTimestamp();
      const dur = (await input.computeDuration()) - first;
      inputs.push({ p, input, v, a, first, dur });
    }

    // 2) 출력 설정: 첫 영상 크기, 원본과 비슷한 비트레이트
    const W = even(await inputs[0].v.getDisplayWidth()), H = even(await inputs[0].v.getDisplayHeight());
    const firstRate = inputs[0].p.size * 8 / Math.max(1, inputs[0].dur);
    const bitrate = Math.round(Math.min(Math.max(firstRate * 0.95, 2e6), 40e6));
    if (!await MB.canEncodeVideo('avc', { width: W, height: H, bitrate }))
      throw new Error(`이 PC 에서는 ${W}×${H} H.264 로 다시 압축할 수 없어요.`);
    const acodec = await MB.canEncodeAudio('aac', { numberOfChannels: CH, sampleRate: RATE, bitrate: 192e3 }) ? 'aac' : 'opus';
    // 표준 MP4(색인 moov 은 끝에). 조각 MP4(fragmented)는 아이폰이 앞 몇 조각만 보고 길이를 잘못 아는 일이 있어 쓰지 않음.
    // writable 은 { data, position } 을 받아 그 위치에 씀(파일 앞부분 길이 칸을 마지막에 다시 씀)
    const output = new MB.Output({
      format: new MB.Mp4OutputFormat({ fastStart: false }),
      target: new MB.StreamTarget(writable, { chunked: true, chunkSize: 8 * 2 ** 20 }),
    });
    const vsrc = new MB.VideoSampleSource({ codec: 'avc', quality: new MB.Quality({ bitrate }), keyFrameInterval: 2 });
    const asrc = new MB.AudioSampleSource({ codec: acodec, quality: new MB.Quality({ bitrate: 192e3 }) });
    output.addVideoTrack(vsrc);
    output.addAudioTrack(asrc);
    const canvas = new OffscreenCanvas(W, H), ctx = canvas.getContext('2d');
    const total = inputs.reduce((s, x) => s + x.dur + (x.p.intro ? 1 : 0), 0);
    let offset = 0, done = 0;
    const tick = (t, part, phase) => { done = Math.max(done, t); onProgress({ done, total, part, phase }); };

    // 무음 [from, to) 을 1초 조각으로
    async function silence(from, to) {
      for (let t = from; t < to - 1e-4; t += 1) {
        const n = Math.round(Math.min(1, to - t) * RATE);
        if (n <= 0) break;
        const s = new MB.AudioSample({ data: new Float32Array(n * CH), format: 'f32-planar', numberOfChannels: CH, sampleRate: RATE, timestamp: t });
        await asrc.add(s);
        s.close();
      }
    }
    // 소리 조각을 48kHz 스테레오로 맞춤 (다르면 약 5초씩 모아서 한 번에 변환해 이음새를 줄임)
    async function toTarget(buffers) {
      const len = buffers.reduce((s, b) => s + b.length, 0), rate = buffers[0].sampleRate;
      const ch = buffers[0].numberOfChannels;
      const joined = new AudioBuffer({ length: len, numberOfChannels: CH, sampleRate: rate });
      for (let c = 0; c < CH; c++) {
        const out = joined.getChannelData(c);
        let at = 0;
        for (const b of buffers) { out.set(b.getChannelData(Math.min(c, ch - 1)), at); at += b.length; }
      }
      if (rate === RATE) return joined;
      const oac = new OfflineAudioContext(CH, Math.ceil(len * RATE / rate), RATE);
      const node = oac.createBufferSource();
      node.buffer = joined;
      node.connect(oac.destination);
      node.start();
      return oac.startRendering();
    }

    try {
      await output.start();
      for (const [i, x] of inputs.entries()) {
        check();
        if (x.p.intro) { // 썸네일 1초
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
          fit(ctx, x.p.intro, W, H);
          const s = new MB.VideoSample(canvas, { timestamp: offset, duration: 1 });
          await vsrc.add(s, { keyFrame: true });
          s.close();
          await silence(offset, offset + 1);
          offset += 1;
          tick(offset, i, 'intro');
        }
        const base = offset - x.first, end = offset + x.dur;
        let keyNext = true; // 영상이 바뀌는 첫 장면은 키프레임
        const videoLoop = (async () => {
          for await (const sample of new MB.VideoSampleSink(x.v).samples()) {
            try {
              check();
              const t = sample.timestamp + base;
              if (t < offset - 1e-3 || t >= end) continue; // 편집 목록으로 앞뒤에 잘린 장면
              ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
              sample.drawWithFit(ctx, { fit: 'contain' });
              const out = new MB.VideoSample(canvas, { timestamp: t, duration: sample.duration || 1 / 30 });
              await vsrc.add(out, keyNext ? { keyFrame: true } : undefined);
              keyNext = false;
              out.close();
              tick(t, i, 'video');
            } finally { sample.close(); }
          }
        })();
        const audioLoop = (async () => {
          let at = offset; // 여기까지 소리를 채움
          if (x.a) {
            let pending = [], pendingStart = null, pendingLen = 0;
            const flush = async () => {
              if (!pending.length) return;
              const buf = await toTarget(pending);
              let t = Math.max(pendingStart, at);
              if (t > at + 1e-3) await silence(at, t); // 소리 사이 빈 곳
              for (const s of MB.AudioSample.fromAudioBuffer(buf, pendingStart)) {
                if (s.timestamp >= end) { s.close(); continue; }
                await asrc.add(s);
                s.close();
              }
              at = Math.max(at, pendingStart + buf.duration);
              pending = []; pendingStart = null; pendingLen = 0;
            };
            for await (const { buffer, timestamp } of new MB.AudioBufferSink(x.a).buffers()) {
              check();
              const t = timestamp + base;
              if (t + buffer.duration <= offset || t >= end) continue;
              if (pendingStart === null) pendingStart = t;
              pending.push(buffer);
              pendingLen += buffer.duration;
              if (pendingLen >= 5) await flush();
            }
            await flush();
          }
          if (at < end - 1e-3) await silence(at, end); // 소리가 짧거나 없으면 무음으로 끝까지
        })();
        await Promise.all([videoLoop, audioLoop]);
        offset = end;
        tick(offset, i, 'video');
      }
      vsrc.close();
      asrc.close();
      onProgress({ done: total, total, part: inputs.length - 1, phase: 'finish' });
      await output.finalize();
    } catch (e) {
      try { await output.cancel(); } catch {}
      throw e;
    } finally {
      for (const x of inputs) try { x.input.dispose && x.input.dispose(); } catch {}
    }
    return { width: W, height: H, duration: offset, audioCodec: acodec };
  }

  // 이미지·캔버스를 비율 그대로 가운데에 (contain)
  function fit(ctx, img, W, H) {
    const w = img.naturalWidth || img.videoWidth || img.width, h = img.naturalHeight || img.videoHeight || img.height;
    const k = Math.min(W / w, H / h), dw = w * k, dh = h * k;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  return { merge, load };
})();
