/* Short, independently decodable VACE inputs. Source credentials stay in read(). */
globalThis.VaceClip = (() => {
  'use strict';
  const MAX_READ_BYTES = 256 * 2 ** 20;
  const MAX_CHUNK_BYTES = 8 * 2 ** 20;
  const FPS = 16;
  let library;
  const load = () => library || (library = import('./vendor/mediabunny-1.60.0.min.mjs'));
  const abortError = () => new DOMException('구간 준비를 취소했어요.', 'AbortError');
  function fail(message, code) { const error = new Error(message); error.code = code; return error; }

  /**
   * read(start, end) uses exclusive end and MUST reject non-206/wrong-range responses
   * before buffering the body. Use MergeUI.tools.driveRead(..., {strictRanges:true}).
   * start is the source player's time; the returned MP4 starts at zero.
   * onProgress receives {phase: 'metadata'|'extract'|'done', progress, bytesRead}.
   */
  async function extract({ file, read, start, duration, signal, onProgress }) {
    const size = Number(file?.size);
    if (!Number.isSafeInteger(size) || size <= 0 || typeof read !== 'function') {
      throw fail('영상 파일 크기 또는 구간 읽기 정보가 올바르지 않아요.', 'INVALID_SOURCE');
    }
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration < 1 || duration > 5) {
      throw fail('시작은 0초 이상, 테스트 길이는 1~5초로 정해 주세요.', 'INVALID_INTERVAL');
    }
    if (signal?.aborted) throw abortError();
    if (!globalThis.VideoDecoder || !globalThis.VideoEncoder) {
      throw fail('이 브라우저는 영상 구간 추출을 지원하지 않아요. 최신 Chrome 또는 Edge에서 열어 주세요.', 'UNSUPPORTED_BROWSER');
    }

    let bytesRead = 0, reservedBytes = 0, phase = 'metadata', progress = null;
    let input, output, conversion, sourceError, stopped = false, completed = false;
    const report = () => onProgress?.({ phase, progress, bytesRead });
    const check = () => {
      if (signal?.aborted || stopped) throw abortError();
      if (sourceError) throw sourceError;
    };
    // Reserve before awaiting: Mediabunny may read audio and video concurrently.
    // A fixed 64 KiB neighborhood (fileSystem profile) avoids tiny HTTP requests
    // without the network profile's exponentially growing read-ahead.
    const boundedRead = async (from, to) => {
      check();
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || to > size) {
        throw fail('올바르지 않은 영상 구간 읽기 요청이에요.', 'INVALID_RANGE');
      }
      const length = to - from;
      if (reservedBytes + length > MAX_READ_BYTES) {
        sourceError = fail('이 구간을 찾는 데 256 MiB보다 많은 원본 데이터가 필요해 중단했어요. 전체 영상은 내려받지 않아요. 다른 구간이나 일반 MP4 파일로 시도해 주세요.', 'READ_BUDGET_EXCEEDED');
        throw sourceError;
      }
      reservedBytes += length;
      // Only this bounded request is buffered; never allocate the original file.
      const chunks = [];
      for (let offset = from; offset < to;) {
        check();
        const end = Math.min(to, offset + MAX_CHUNK_BYTES);
        const chunk = await read(offset, end);
        check();
        if (!(chunk instanceof Uint8Array) || chunk.byteLength !== end - offset) {
          throw fail('서버가 요청한 영상 범위와 다른 데이터를 보냈어요. 전체 다운로드로 전환하지 않고 중단했어요.', 'INVALID_RANGE_RESPONSE');
        }
        bytesRead += chunk.byteLength;
        chunks.push(chunk);
        report();
        offset = end;
      }
      if (chunks.length === 1) return chunks[0];
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes;
    };
    const cancel = () => {
      stopped = true;
      void conversion?.cancel().catch(() => {});
      input?.dispose();
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const MB = await load();
      check();
      report();
      input = new MB.Input({
        formats: [MB.MP4, MB.QTFF, MB.MATROSKA, MB.WEBM],
        source: new MB.CustomSource({
          getSize: () => size,
          read: boundedRead,
          maxCacheSize: MAX_CHUNK_BYTES,
          prefetchProfile: 'fileSystem',
          handleUnhandledError: error => { sourceError ||= error; },
        }),
      });
      const video = await input.getPrimaryVideoTrack();
      if (!video) throw fail('이 파일에서 지원하는 영상 트랙을 찾지 못했어요. MP4, MOV, MKV, WebM을 사용해 주세요.', 'UNSUPPORTED_FORMAT');
      // Do not scan a whole unindexed file merely to discover its duration.
      const sourceDuration = await video.getDurationFromMetadata();
      if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
        throw fail('이 영상에는 구간 탐색에 필요한 길이 정보가 없어요. 전체 스캔 없이 처리할 수 있는 일반 MP4 파일을 사용해 주세요.', 'UNSEEKABLE_SOURCE');
      }
      if (start + duration > sourceDuration + 0.001) {
        throw fail(`선택한 구간이 영상 길이(${sourceDuration.toFixed(2)}초)를 넘어요. 시작이나 길이를 줄여 주세요.`, 'INTERVAL_OUT_OF_RANGE');
      }
      const originalWidth = await video.getDisplayWidth(), originalHeight = await video.getDisplayHeight();
      if (!(originalWidth > 0 && originalHeight > 0) || originalWidth * originalHeight > 40_000_000) {
        throw fail('이 영상의 해상도는 브라우저 구간 추출로 처리하기 어려워요.', 'UNSUPPORTED_DIMENSIONS');
      }
      const scale = Math.min(1, 1280 / originalWidth, 720 / originalHeight);
      const width = Math.max(2, 2 * Math.floor(originalWidth * scale / 2));
      const height = Math.max(2, 2 * Math.floor(originalHeight * scale / 2));
      const audio = await input.getPrimaryAudioTrack();
      check();
      const target = new MB.BufferTarget(); // Only the <=5 second result is in memory.
      output = new MB.Output({ format: new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
      conversion = await MB.Conversion.init({
        input, output, tracks: 'primary', trim: { start, end: start + duration },
        copy: false, tags: {}, showWarnings: false,
        video: {
          codec: 'avc', width, height, fit: 'fill', frameRate: FPS,
          quality: new MB.Quality({ bitrate: 4_000_000 }), keyFrameInterval: 1,
          allowTransformationMetadata: false,
          // v1.60's onProgress may scan tracks lacking duration metadata. Report
          // processed frames instead, keeping all source reads bounded to the trim.
          process: sample => {
            progress = Math.min(1, Math.max(0, (sample.timestamp + sample.duration) / duration));
            report();
            return sample;
          },
        },
        audio: { codec: 'aac', numberOfChannels: 2, sampleRate: 48000, quality: new MB.Quality({ bitrate: 128_000 }) },
      });
      check();
      const lostTrack = conversion.discardedTracks.find(item => item.track === video || item.track === audio);
      if (!conversion.isValid || lostTrack || !conversion.utilizedTracks.includes(video)) {
        throw fail('이 브라우저에서 영상 또는 원음 코덱을 변환하지 못해요. 오디오를 빼거나 전체 파일을 내려받지 않고 중단했어요. 다른 MP4 파일 또는 최신 Chrome/Edge로 시도해 주세요.', 'UNSUPPORTED_CODEC');
      }
      phase = 'extract'; progress = 0; report();
      await conversion.execute();
      check();
      if (!target.buffer?.byteLength) throw fail('선택한 구간에서 영상이 만들어지지 않았어요.', 'EMPTY_CLIP');
      // Check the actual standalone output, not just the requested interval.
      const resultInput = new MB.Input({ formats: [MB.MP4], source: new MB.BufferSource(target.buffer) });
      let actualDuration;
      try {
        const resultVideo = await resultInput.getPrimaryVideoTrack();
        actualDuration = resultVideo && await resultVideo.computeDuration();
        const firstTimestamp = resultVideo && await resultVideo.getFirstTimestamp();
        if (!actualDuration || Math.abs(actualDuration - duration) > 1 / FPS + 0.002 || firstTimestamp < -0.002 || firstTimestamp > 0.002) {
          throw fail('선택한 시작점과 길이로 독립 영상을 만들지 못했어요. 다른 구간을 선택해 주세요.', 'INVALID_CLIP_TIMELINE');
        }
      } finally { resultInput.dispose(); }
      check();
      const blob = new Blob([target.buffer], { type: 'video/mp4' });
      completed = true;
      phase = 'done'; progress = 1; report();
      return {
        blob, name: `vace-clip-${Math.round(start * 1000)}-${Math.round(duration * 1000)}.mp4`,
        duration: actualDuration, width, height, bytesRead, sourceStart: start, fps: FPS,
      };
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (sourceError) throw sourceError;
      if (error.code || error.name === 'AbortError') throw error;
      throw fail(`선택 구간을 추출하지 못했어요. 전체 다운로드로 전환하지 않아요. ${error.message || '지원하지 않는 영상 형식이에요.'}`, 'EXTRACTION_FAILED');
    } finally {
      stopped = true;
      signal?.removeEventListener('abort', cancel);
      if (!completed) {
        if (conversion) await conversion.cancel().catch(() => {});
        else if (output) await output.cancel().catch(() => {});
      }
      input?.dispose();
    }
  }
  return { extract, MAX_READ_BYTES, MAX_CHUNK_BYTES, FPS };
})();
