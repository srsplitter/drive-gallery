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

  // parts: [{ name, size, read(start, end) → Promise<Uint8Array>, intro?: CanvasImageSource, introSec?: 썸네일 길이(초, 기본 1) 또는 (영상 길이 → 초) 함수 }]
  // writable: WritableStream<Uint8Array> (앞에서부터 차례로만 씀)
  // onProgress({ done, total, part, phase })
  // onPlan({ bytes }): 다시 압축하기 전에 결과 크기 어림값을 알려 줌 (임시 공간이 모자라면 여기서 throw 해서 멈춤)
  async function merge({ parts, writable, onProgress = () => {}, onPlan, signal }) {
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
      let dur = (await input.computeDuration()) - first;
      // 장면 절반쯤에 엉뚱하게 큰 시각(예: 134초 영상에 143165초)이 찍힌 영상: 음수인 표시 시각 차이를 부호 없는 32비트로 저장해
      // 2^32 ÷ 시간 단위만큼 밀린 것 → 그만큼 되돌려 씀 (소리보다 훨씬 길게 나올 때만)
      let wrap = 0;
      if (a) {
        const ad = (await a.computeDuration()) - first;
        if (dur > ad * 1.5 + 10) {
          wrap = 2 ** 32 / v.timeResolution;
          dur = await unwrappedEnd(MB, v, wrap) - first;
          if (dur > ad * 1.5 + 10) throw new Error(`"${p.name}" 은(는) 장면 시각이 깨져 있어 다시 압축할 수 없어요.`);
        }
      }
      const introLen = !p.intro ? 0 : typeof p.introSec === 'function' ? p.introSec(dur) : p.introSec || 1;
      inputs.push({ p, input, v, a, first, dur, introLen, wrap });
    }

    // 2) 출력 설정: 첫 영상 크기, 원본과 비슷한 비트레이트
    let W = even(await inputs[0].v.getDisplayWidth()), H = even(await inputs[0].v.getDisplayHeight());
    const firstRate = inputs[0].p.size * 8 / Math.max(1, inputs[0].dur);
    const bitrate = Math.round(Math.min(Math.max(firstRate * 0.95, 2e6), 40e6));
    // H.264 로 못 만드는 큰 화면(예: 5120×2160)은 비율 그대로 줄여서 만들 수 있는 크기로
    if (!await MB.canEncodeVideo('avc', { width: W, height: H, bitrate })) {
      let fit = null;
      for (const side of [4096, 3840, 2560, 1920, 1280]) {
        const k = side / Math.max(W, H);
        if (k >= 1) continue;
        const w = even(W * k), h = even(H * k);
        if (await MB.canEncodeVideo('avc', { width: w, height: h, bitrate })) { fit = [w, h]; break; }
      }
      if (!fit) throw new Error(`이 PC 에서는 ${W}×${H} H.264 로 다시 압축할 수 없어요.`);
      [W, H] = fit;
    }
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
    const total = inputs.reduce((s, x) => s + x.dur + x.introLen, 0);
    if (onPlan) await onPlan({ bytes: Math.round((bitrate + 192e3) / 8 * total * 1.03) + 64e6, width: W, height: H });
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
        if (x.p.intro) { // 썸네일 (기본 1초, introSec 로 바꿈)
          const sec = x.introLen;
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
          fit(ctx, x.p.intro, W, H);
          const s = new MB.VideoSample(canvas, { timestamp: offset, duration: sec });
          await vsrc.add(s, { keyFrame: true });
          s.close();
          await silence(offset, offset + sec);
          offset += sec;
          tick(offset, i, 'intro');
        }
        const base = offset - x.first, end = offset + x.dur;
        let keyNext = true; // 영상이 바뀌는 첫 장면은 키프레임
        let srcAt = 0; // 마지막으로 푼 원본 시각 (깨진 파일 안내용)
        const put = async sample => {
          try {
            check();
            srcAt = sample.timestamp;
            const t = sample.timestamp + base;
            if (t < offset - 1e-3 || t >= end) return; // 편집 목록으로 앞뒤에 잘린 장면
            ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
            sample.drawWithFit(ctx, { fit: 'contain' });
            const out = new MB.VideoSample(canvas, { timestamp: t, duration: sample.duration || 1 / 30 });
            await vsrc.add(out, keyNext ? { keyFrame: true } : undefined);
            keyNext = false;
            out.close();
            tick(t, i, 'video');
          } finally { sample.close(); }
        };
        const videoLoop = (async () => {
          let resume = null;
          try {
            for await (const sample of (x.wrap ? robustSamples(MB, x.v, x.wrap) : new MB.VideoSampleSink(x.v).samples())) await put(sample);
          } catch (e) {
            // 중간 몇 초가 깨진 영상(크롬 <video> 는 깨진 장면만 건너뛰고 재생됨): 거기서부터는 직접 풀면서 깨진 구간을 건너뜀
            if (!e || e.name === 'AbortError' || !/decod/i.test(e.message || '')) throw e;
            resume = srcAt;
          }
          if (resume !== null)
            for await (const sample of robustSamples(MB, x.v, x.wrap, resume)) {
              if (sample.timestamp <= resume + 1e-6) { sample.close(); continue; }
              await put(sample);
            }
        })().catch(e => {
          // 파일 중간부터 영상 데이터가 아닌 것이 들어 있는 등 깨진 파일: 크롬 해독기가 "Decoder/Decoding error" 를 냄
          if (e && e.name !== 'AbortError' && /decod/i.test(e.message || '')) throw new Error(`"${x.p.name}" 은(는) ${Math.floor(srcAt)}초쯤부터 파일이 깨져 있어 다시 압축할 수 없어요 (원본 파일을 다시 올려야 해요).`);
          throw e;
        });
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

  // 밀린 시각을 되돌린 뒤의 영상 끝 (색인만 훑음)
  async function unwrappedEnd(MB, v, wrap) {
    let end = 0;
    for await (const p of new MB.EncodedPacketSink(v).packets(undefined, undefined, { metadataOnly: true }))
      end = Math.max(end, (p.timestamp > wrap / 2 ? p.timestamp - wrap : p.timestamp) + (p.duration || 0));
    return end;
  }
  // 직접 풂: 패킷을 해독 순서대로 넣으면 해독기가 장면을 표시 순서로 내놓음.
  // - wrap: 밀린 시각을 되돌림 (Mediabunny 의 장면 꺼내기는 깨진 시각 그대로 순서를 정해 밀린 장면들이 맨 뒤로 몰림)
  // - 깨진 패킷(H.264 길이 표시가 안 맞음)이나 해독 실패가 나오면 다음 멀쩡한 키프레임까지 건너뛰고 해독기를 새로 만듦
  // - from: 이 시각 근처부터 시작 (앞에서 해독이 멈춘 곳)
  async function* robustSamples(MB, v, wrap, from) {
    const norm = t => wrap && t > wrap / 2 ? t - wrap : t;
    const config = await v.getDecoderConfig();
    const desc = config.description;
    const db = !desc ? null : desc instanceof ArrayBuffer ? new Uint8Array(desc) : new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength);
    const lenSize = /^avc[13]/.test(config.codec) && db && db.length > 4 ? (db[4] & 3) + 1 : 0;
    const wellFormed = d => {
      if (!lenSize) return true;
      let i = 0;
      while (i < d.length) {
        if (i + lenSize > d.length) return false;
        let n = 0;
        for (let k = 0; k < lenSize; k++) n = n * 256 + d[i + k];
        if (!n) return false;
        i += lenSize + n;
      }
      return i === d.length;
    };
    const ready = [];
    let dec = null, broken = false, needKey = true;
    const open = () => {
      broken = false;
      dec = new VideoDecoder({ output: f => ready.push(f), error: () => { broken = true; } });
      dec.configure(config);
    };
    const reset = () => { try { dec.close(); } catch {} open(); needKey = true; };
    open();
    const sink = new MB.EncodedPacketSink(v);
    const start = from == null ? undefined : (await sink.getPacket(from)) || undefined;
    try {
      for await (const p of sink.packets(start)) {
        if (broken) reset();
        if (!wellFormed(p.data)) { needKey = true; continue; } // 깨진 패킷: 다음 키프레임까지 버림
        if (needKey && p.type !== 'key') continue;
        if (needKey && dec.decodeQueueSize) reset();
        needKey = false;
        try {
          dec.decode(new EncodedVideoChunk({ type: p.type, timestamp: Math.round(norm(p.timestamp) * 1e6), duration: Math.round((p.duration || 0) * 1e6), data: p.data }));
        } catch { broken = true; continue; }
        while (dec.decodeQueueSize > 4 && !broken) await new Promise(r => setTimeout(r, 2));
        while (ready.length) yield new MB.VideoSample(ready.shift());
      }
      if (!broken) await dec.flush().catch(() => {});
      while (ready.length) yield new MB.VideoSample(ready.shift());
    } finally {
      for (const f of ready) f.close();
      try { dec.close(); } catch {}
    }
  }

  // 이미지·캔버스를 비율 그대로 가운데에 (contain)
  function fit(ctx, img, W, H) {
    const w = img.naturalWidth || img.videoWidth || img.width, h = img.naturalHeight || img.videoHeight || img.height;
    const k = Math.min(W / w, H / h), dw = w * k, dh = h * k;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }

  // 조각 MP4(fragmented) 인지: 앞부분에 moov 안의 mvex 나 moof 상자가 있으면 조각 형식
  async function isFragmented(read, size) {
    const head = await read(0, Math.min(size, 2 * 2 ** 20));
    for (let i = 4; i + 4 <= head.length; i++) {
      if (head[i] === 0x6d && ((head[i + 1] === 0x76 && head[i + 2] === 0x65 && head[i + 3] === 0x78) // mvex
        || (head[i + 1] === 0x6f && head[i + 2] === 0x6f && head[i + 3] === 0x66))) return true;       // moof
    }
    return false;
  }

  // 다시 압축하지 않고 표준 MP4(moov 끝)로 옮겨 담기 (화질 그대로, 빠름)
  async function remux({ size, read, writable, onProgress = () => {}, signal }) {
    const MB = await load();
    const input = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.CustomSource({ getSize: () => size, read, prefetchProfile: 'network' }) });
    const output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: false }),
      target: new MB.StreamTarget(writable, { chunked: true, chunkSize: 8 * 2 ** 20 }) });
    const conv = await MB.Conversion.init({ input, output, tracks: 'primary' });
    if (!conv.isValid) throw new Error('이 영상은 그대로 옮겨 담을 수 없어요.');
    conv.onProgress = p => onProgress(p);
    const stop = () => conv.cancel();
    if (signal) signal.addEventListener('abort', stop, { once: true });
    try { await conv.execute(); }
    finally { if (signal) signal.removeEventListener('abort', stop); try { input.dispose && input.dispose(); } catch {} }
  }

  return { merge, load, isFragmented, remux };
})();
