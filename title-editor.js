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
  let shown = [], busy = false, memoWrap, baseInput, wordsInput, renameButton, removeButton;
  let preview, status, excludedBadge, resetButton, clearButtons = [];
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
    resetButton.disabled = busy || !excluded.size;
    renameButton.disabled = busy || !rename.length;
    removeButton.disabled = busy || !removal.plans.length;
    baseInput.disabled = wordsInput.disabled = busy;
    for (const button of clearButtons) button.disabled = busy;
  }
  function updateProgress(label, total, success, failed, detail = '') {
    const processed = success + failed;
    const message = `${label} ${processed}/${total} (${Math.floor(processed / total * 100)}%) · 성공 ${success} · 실패 ${failed}` + (detail ? ` · ${detail}` : '');
    status.textContent = message;
    const header = document.getElementById('titleProgress');
    if (header) {
      header.textContent = message;
      header.hidden = false;
    }
  }
  async function apply(kind) {
    if (busy) return;
    // Snapshot the current displayed order and exclusions before any request.
    const files = filter(shown).slice();
    const removal = kind === 'remove' ? removalPlan(files) : { skipped: [] };
    const plans = kind === 'remove' ? removal.plans : planRename(files, baseInput.value);
    if (!plans.length) return;
    busy = true;
    updateControls();
    let success = 0, failed = 0, lastError = '', stopped = '';
    updateProgress('권한 확인 중', plans.length, success, failed);
    try {
      if (!await ensureWriteScope()) {
        stopped = 'Google Drive 수정 권한을 받지 못해 취소했어요. 변경된 파일은 없습니다.';
        return;
      }
      updateProgress('제목 변경 중', plans.length, success, failed);
      for (const { file, name } of plans) {
        try {
          const response = await api(`${DRIVE}/files/${encodeURIComponent(file.id)}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name })
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          file.name = name;
          success++;
        } catch (error) {
          failed++;
          lastError = error.message || String(error);
        } finally {
          updateProgress('제목 변경 중', plans.length, success, failed);
        }
      }
    } catch (error) {
      stopped = `Google Drive 수정 권한 확인 실패: ${error.message || String(error)} · 변경된 파일은 없습니다.`;
    } finally {
      busy = false;
      updateProgress(stopped ? '제목 변경 취소' : '제목 변경 완료', plans.length, success, failed,
        `빈 이름 건너뜀 ${removal.skipped.length}개` + (stopped ? ` · ${stopped}` : '') + (lastError ? ` · ${lastError}` : ''));
      updateControls();
      renderGrid();
    }
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
      if (busy) return;
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
    clearButtons = [left.clear, right.clear];
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
        if (busy) return;
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
  const exported = { planRename, removeWords, matchesKinds, renderMemos, clearExcluded, filter, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  else root.TitleEditor = exported;
})(globalThis);
