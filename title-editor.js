/* Main hook: append TitleEditor.render(shown, counts) when currentView === 'title'.
 * Pass the existing sorted/search-filtered list; exclusions belong only to this module.
 * planRename returns {file, name}[]; removeWords returns null for an empty basename.
 * Browser dependencies: videoCard, api, DRIVE, ensureWriteScope, renderGrid (existing global bindings).
 */
(function (root) {
  'use strict';
  const videoExtension = /\.[^.]+$/;
  function splitName(name) {
    const match = String(name).match(videoExtension);
    return match ? [name.slice(0, -match[0].length), match[0]] : [String(name), ''];
  }
  function planRename(files, base, numberSingle = false) {
    const clean = String(base).trim();
    if (!clean) return [];
    return files.map((file, i) => ({ file,
      name: clean + (files.length > 1 || numberSingle ? i + 1 : '') + splitName(file.name)[1] }));
  }
  function removeWords(name, input) {
    const [base, extension] = splitName(name);
    const tokens = String(input).split(/[,\s]+/u);
    const extensionTokens = tokens.filter(token => /^\.[^.]+$/u.test(token));
    const removeExtension = extensionTokens.some(token => token.toLowerCase() === extension.toLowerCase());
    const words = new Set((tokens.filter(token => !extensionTokens.includes(token)).join(' ').match(/[\p{L}\p{N}\p{M}_]+/gu) || [])
      .map(word => word.toLowerCase()));
    if (!words.size && !removeExtension) return String(name);
    const next = base.replace(/[\p{L}\p{N}\p{M}_]+/gu,
      word => words.has(word.toLowerCase()) ? '' : word).replace(/\s+/g, ' ').trim();
    return next ? next + (removeExtension ? '' : extension) : null;
  }

  const kindLabels = { title: '제목', normal: '태그', category: '카테고리', genre: '장르', character: '캐릭터', series: '시리즈' };
  const queries = { title: '', normal: '', category: '', genre: '', character: '', series: '' };
  function matchesKinds(file, queries, data) {
    return Object.keys(kindLabels).every(kind => {
      const query = String(queries[kind] || '').trim().toLowerCase();
      if (!query) return true;
      if (kind === 'title') return file.name.toLowerCase().includes(query);
      if (kind === 'series') return Object.values(data.series || {}).some(series =>
        series && Array.isArray(series.videoIds) && series.videoIds.includes(file.id)
        && String(series.name || '').toLowerCase().includes(query));
      return ((data.tags || {})[file.id] || []).some(tag =>
        (((data.tagKinds || {})[tag] || 'normal') === kind) && tag.toLowerCase().includes(query));
    });
  }
  const excluded = new Set();
  let searchTimer;
  let shown = [], memoWrap, baseInput, wordsInput, renameButton, removeButton;
  const jobs = [], fileTails = new Map(), lastWriter = new Map();
  let scopePromise;
  function writeScope() {
    if (!scopePromise) scopePromise = Promise.resolve().then(() => ensureWriteScope())
      .finally(() => { scopePromise = undefined; });
    return scopePromise;
  }
  let preview, status, excludedBadge, resetButton;
  const filter = list => list.filter(file => !excluded.has(file.id)
    && matchesKinds(file, queries, typeof gallery === 'undefined' ? {} : gallery));
  const editing = () => document.body.classList.contains('editing');
  function clearExcluded() {
    excluded.clear();
    updateControls();
  }
  function node(tag, text, className) {
    const result = document.createElement(tag);
    if (text) result.textContent = text;
    if (className) result.className = className;
    return result;
  }
  function removalPlan(files) {
    const plans = [], skipped = [];
    for (const file of files) {
      const name = removeWords(file.name, wordsInput.value);
      if (name === null) skipped.push(file);
      else if (name !== file.name) plans.push({ file, name });
    }
    return { plans, skipped };
  }
  function updateControls() {
    if (!memoWrap) return;
    const files = filter(shown);
    const rename = planRename(files, baseInput.value);
    const removal = removalPlan(files);
    preview.textContent = `대상 ${files.length}개 · 일괄 이름 ${rename.length}개 · 단어 제거 ${removal.plans.length}개 · 빈 이름 건너뜀 ${removal.skipped.length}개`;
    excludedBadge.textContent = `제목 편집 제외 ${excluded.size}개`;
    resetButton.disabled = !excluded.size;
    renameButton.disabled = !rename.length;
    removeButton.disabled = !removal.plans.length;
  }
  function getJobs() {
    return jobs.map(job => ({ id: job.id, state: job.state, total: job.plans.length,
      processed: job.success + job.failed, success: job.success, failed: job.failed,
      canceled: job.canceled, cancelled: job.canceled,
      rollbackTotal: job.rollbackTotal, rollbackProcessed: job.rollbackProcessed,
      rollbackSuccess: job.rollbackSuccess, rollbackFailed: job.rollbackFailed,
      rollbackSkipped: job.rollbackSkipped,
      skipped: job.state === 'canceled' ? job.plans.length - job.success - job.failed : 0 }));
  }
  function renderJobs() {
    const terminal = new Set(jobs.filter(job => ['completed', 'canceled', 'failed'].includes(job.state))
      .slice(-3));
    const visibleJobs = jobs.filter(job => !['completed', 'canceled', 'failed'].includes(job.state)
      || terminal.has(job));
    const labels = { waiting: '권한 확인 중', running: '제목 변경 중', canceling: '취소 요청',
      restoring: '되돌리는 중', completed: '제목 변경 완료', canceled: '취소·복원 완료',
      'restore-failed': '취소·복원실패', failed: '제목 변경 실패' };
    for (const container of [status, document.getElementById('titleProgress')]) {
      if (!container) continue;
      container.replaceChildren();
      container.hidden = !jobs.length;
      for (const job of visibleJobs) {
        const processed = job.success + job.failed;
        const row = node('span', '', 'title-job');
        row.dataset.jobId = String(job.id);
        row.append(node('span', '작업 ' + job.id + ' · ' + labels[job.state] + ' ' + processed + '/' + job.plans.length
          + ' (' + Math.floor(processed / job.plans.length * 100) + '%) · 성공 ' + job.success + ' · 실패 ' + job.failed
          + ' · 빈 이름 건너뜀 ' + job.empty + '개'
          + (job.canceled ? ' · ' + (job.state === 'restoring' ? '되돌리는 중 ' : '복원 처리 ') + job.rollbackProcessed + '/' + job.rollbackTotal
            + ' · 복원 성공 ' + job.rollbackSuccess + ' · 복원실패 ' + job.rollbackFailed
            + ' · 새 수정 건너뜀 ' + job.rollbackSkipped : '')
          + (job.canceled ? ' · 취소 건너뜀 ' + (job.plans.length - processed) + '개' : '')
          + (job.error ? ' · ' + job.error : '')));
        if (['waiting', 'running', 'canceling'].includes(job.state)) {
          const button = node('button', job.canceled ? '취소 요청' : '취소', 'chip');
          button.type = 'button';
          button.setAttribute('aria-label', '제목 작업 ' + job.id + ' 취소');
          button.disabled = job.canceled;
          button.addEventListener('click', () => {
            job.canceled = true;
            job.state = 'canceling';
            // Append now, so submissions after cancellation wait for restoration.
            job.rollbackSlots = job.plans.map(reserve);
            job.cancel();
            renderJobs();
          });
          row.append(button);
        }
        if (job.state === 'restore-failed') {
          const retry = node('button', '복원 재시도', 'chip');
          retry.type = 'button';
          retry.setAttribute('aria-label', '제목 작업 ' + job.id + ' 복원 재시도');
          retry.addEventListener('click', () => {
            if (job.state !== 'restore-failed') return;
            job.rollbackSlots = job.plans.filter(plan => job.applied.has(plan.id)).map(reserve);
            void retryRestore(job);
          });
          row.append(retry);
        }
        container.append(row);
      }
    }
  }
  function reserve(plan) {
    const previous = fileTails.get(plan.id) || Promise.resolve();
    let release;
    const ownRelease = new Promise(resolve => { release = resolve; });
    const tail = Promise.all([previous, ownRelease]);
    fileTails.set(plan.id, tail);
    tail.then(() => { if (fileTails.get(plan.id) === tail) fileTails.delete(plan.id); });
    return { plan, previous, release };
  }
  function restoreOrigin(id, saved) {
    const seen = new Set();
    while (saved.writer !== undefined && !seen.has(saved.writer)) {
      seen.add(saved.writer);
      const writer = jobs.find(job => job.id === saved.writer);
      if (!writer || !writer.canceled) break;
      const original = writer.origins.get(id);
      if (!original) break;
      saved = original;
    }
    return saved;
  }
  async function restoreJob(job) {
    job.state = 'restoring';
    // Progress/failures describe this attempt; successes/skips remain cumulative.
    job.rollbackProcessed = 0;
    job.rollbackFailed = 0;
    job.error = '';
    job.rollbackTotal = job.applied.size;
    renderJobs();
    try {
      for (const slot of job.rollbackSlots) {
        try {
          await slot.previous;
          const saved = job.applied.get(slot.plan.id);
          if (!saved) continue;
          const { file, id, name } = slot.plan;
          if (lastWriter.get(id) !== job.id || file.name !== name) {
            job.rollbackSkipped++;
            job.applied.delete(id);
          } else {
            try {
              if (!await writeScope()) throw new Error('Google Drive 수정 권한을 받지 못했습니다.');
              const original = restoreOrigin(id, saved);
              const response = await api(DRIVE + '/files/' + encodeURIComponent(id), {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: original.name })
              });
              if (!response.ok) throw new Error('HTTP ' + response.status);
              file.name = original.name;
              if (original.writer === undefined) lastWriter.delete(id);
              else lastWriter.set(id, original.writer);
              job.rollbackSuccess++;
              job.applied.delete(id);
            } catch (error) {
              job.rollbackFailed++;
              job.error = '복원실패: ' + (error.message || String(error));
            }
          }
          job.rollbackProcessed++;
        } finally {
          slot.release();
          renderJobs();
        }
      }
    } finally {
      for (const slot of job.rollbackSlots) slot.release();
    }
  }
  async function retryRestore(job) {
    await restoreJob(job);
    job.state = job.rollbackFailed ? 'restore-failed' : 'canceled';
    renderJobs();
    updateControls();
    renderGrid();
  }
  async function runJob(job) {
    try {
      const granted = await Promise.race([writeScope(), job.cancellation]);
      if (job.canceled) return;
      if (!granted) {
        job.error = 'Google Drive 수정 권한을 받지 못했습니다. 변경된 파일은 없습니다.';
        job.state = 'failed';
        return;
      }
      job.state = 'running';
      renderJobs();
      for (const slot of job.slots) {
        await Promise.race([slot.previous, job.cancellation]);
        if (job.canceled) break;
        const { file, id, name } = slot.plan;
        try {
          const original = { name: file.name, writer: lastWriter.get(id) };
          const response = await api(DRIVE + '/files/' + encodeURIComponent(id), {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
          });
          if (!response.ok) throw new Error('HTTP ' + response.status);
          file.name = name;
          lastWriter.set(id, job.id);
          job.applied.set(id, original);
          job.origins.set(id, original);
          job.success++;
        } catch (error) {
          job.failed++;
          job.error = error.message || String(error);
        } finally {
          slot.release();
          renderJobs();
        }
        if (job.canceled) break;
      }
    } catch (error) {
      job.state = 'failed';
      job.error = 'Google Drive 수정 권한 확인 실패: ' + (error.message || String(error));
    } finally {
      // Released canceled slots still await older reservations before successors run.
      for (const slot of job.slots) slot.release();
      if (job.canceled) await restoreJob(job);
      job.state = job.canceled ? (job.rollbackFailed ? 'restore-failed' : 'canceled')
        : job.state === 'failed' ? 'failed' : 'completed';
      renderJobs();
      updateControls();
      renderGrid();
    }
  }
  function apply(kind) {
    const files = filter(shown).slice();
    const removal = kind === 'remove' ? removalPlan(files) : { skipped: [] };
    const draft = kind === 'remove' ? removal.plans : planRename(files, baseInput.value);
    if (!draft.length) return;
    const plans = Object.freeze(draft.map(({ file, name }) => Object.freeze({ file, id: file.id, name })));
    const job = { id: jobs.length + 1, plans, state: 'waiting', success: 0, failed: 0,
      canceled: false, empty: removal.skipped.length, error: '', applied: new Map(), origins: new Map(),
      rollbackTotal: 0, rollbackProcessed: 0, rollbackSuccess: 0, rollbackFailed: 0, rollbackSkipped: 0 };
    job.cancellation = new Promise(resolve => { job.cancel = () => resolve(false); });
    // Reserve all files synchronously before permission or scheduling can yield.
    job.slots = plans.map(reserve);
    jobs.push(job);
    renderJobs();
    void runJob(job);
  }
  function memo(labelText, hint, actionText, kind) {
    const box = node('div', '', 'title-memo');
    const label = node('label', labelText);
    const input = node('textarea');
    input.rows = 2;
    input.placeholder = hint;
    input.setAttribute('aria-label', labelText);
    label.append(input);
    const button = node('button', actionText, 'chip');
    button.type = 'button';
    button.addEventListener('click', () => apply(kind));
    input.addEventListener('input', updateControls);
    input.addEventListener('keydown', event => {
      // Composition Enter only commits the IME. A subsequent Enter submits.
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        button.click();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        (input === baseInput ? wordsInput : baseInput).focus();
      }
    });
    const clear = node('button', '입력 지우기', 'chip');
    clear.type = 'button';
    clear.addEventListener('click', () => {
      input.value = '';
      updateControls();
      input.focus();
    });
    box.append(label, button, clear);
    return { box, input, button, clear };
  }
  function renderMemos() {
    if (memoWrap) return memoWrap;
    memoWrap = node('div', '', 'title-memos');
    const notice = node('p', '아래 작업은 Google Drive의 실제 파일명을 변경합니다. 수정 OFF에서도 실행됩니다.', 'hint');
    const left = memo('일괄 이름 변경', '예: 마리오 → 마리오1.mp4, 마리오2.mp4', 'Google Drive 이름 변경', 'rename');
    const right = memo('완전한 단어 제거', '쉼표·줄바꿈·공백 구분 · .mp4 입력 시 확장자 제거', 'Google Drive 단어 제거', 'remove');
    baseInput = left.input; renameButton = left.button;
    wordsInput = right.input; removeButton = right.button;
    const columns = node('div');
    columns.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px';
    columns.append(left.box, right.box);
    const searches = node('div', '', 'title-kind-search');
    const searchInputs = [];
    for (const [kind, title] of Object.entries(kindLabels)) {
      const label = node('label', title);
      const input = node('input');
      input.type = 'text';
      input.value = queries[kind];
      input.placeholder = `${title} 검색`;
      input.setAttribute('aria-label', kind === 'title' ? '제목으로 동영상 검색' : `${title}로 동영상 검색`);
      input.addEventListener('input', () => {
        queries[kind] = input.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => renderGrid(), 150);
      });
      label.append(input);
      searches.append(label);
      searchInputs.push(input);
    }
    const clearSearch = node('button', '분류 검색 초기화', 'chip');
    clearSearch.type = 'button';
    clearSearch.setAttribute('aria-label', '분류 검색 초기화');
    clearSearch.addEventListener('click', () => {
      clearTimeout(searchTimer);
      for (const kind of Object.keys(queries)) queries[kind] = '';
      for (const input of searchInputs) input.value = '';
      renderGrid();
    });
    for (const input of [baseInput, wordsInput]) input.style.cssText = 'display:block;width:100%;box-sizing:border-box';
    preview = node('p', '', 'hint');
    status = node('p', '', 'hint');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    excludedBadge = node('span', '', 'hint');
    resetButton = node('button', '제목 편집 제외 초기화', 'chip');
    resetButton.type = 'button';
    resetButton.addEventListener('click', () => { clearExcluded(); renderGrid(); });
    memoWrap.append(notice, columns, searches, clearSearch, preview, excludedBadge, resetButton, status);
    updateControls();
    renderJobs();
    return memoWrap;
  }
  function render(list, counts) {
    shown = list.slice();
    const active = document.activeElement;
    const focused = memoWrap && memoWrap.contains(active) ? active : null;
    const selection = focused && (focused.tagName === 'TEXTAREA' || focused.tagName === 'INPUT')
      ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
    const wrapper = node('div');
    wrapper.id = 'titleEditor';
    wrapper.append(renderMemos());
    const grid = node('div', '', 'cat-grid');
    for (const file of filter(shown)) {
      const card = videoCard(file, counts);
      card.addEventListener('click', event => {
        if (!editing()) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        excluded.add(file.id);
        card.remove();
        updateControls();
      }, true);
      grid.append(card);
    }
    wrapper.append(grid);
    updateControls();
    // Main replaces the grid synchronously; restore focus after attachment.
    if (focused) queueMicrotask(() => {
      if (!focused.isConnected) return;
      focused.focus({ preventScroll: true });
      if (selection) focused.setSelectionRange(...selection);
    });
    return wrapper;
  }
  const exported = { getJobs, planRename, removeWords, matchesKinds, renderMemos, clearExcluded, filter, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.TitleEditor = exported;
})(globalThis);
