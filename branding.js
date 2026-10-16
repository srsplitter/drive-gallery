// Account-specific icon stored with the private gallery metadata.
const Branding = (() => {
  const logo = document.getElementById('siteLogo');
  const input = document.getElementById('brandFile');
  const icon = document.getElementById('brandIcon');
  const favicon = document.querySelector('link[rel="icon"]');
  let session = 0;
  function logout() {
    session++;
    pendingSaves.delete('u:icon');
    apply(null);
  }
  function apply(value) {
    const custom = typeof value === 'string' && value.startsWith('data:image/png;base64,') && value.length <= 1000000;
    const image = document.createElement('img');
    image.alt = '';
    image.src = custom ? value : 'icons/gallery-192.png';
    icon.replaceChildren(image);
    favicon.href = custom ? value : 'favicon.ico?v=20261017-logo2';
    favicon.type = custom ? 'image/png' : 'image/x-icon';
    if (custom) favicon.removeAttribute('sizes');
    else favicon.setAttribute('sizes', '16x16 32x32 48x48');
  }
  logo.addEventListener('click', () => {
    if (!token) { setStatus('로그인 후 아이콘을 바꿀 수 있어요.'); return; }
    input.click();
  });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = '';
    if (!file || !token) return;
    if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) {
      setStatus('10MB 이하의 이미지 파일을 선택해 주세요.', true); return;
    }
    const accountGallery = gallery;
    const accountToken = token;
    const url = URL.createObjectURL(file);
    logo.disabled = true;
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const scale = Math.min(256 / image.naturalWidth, 256 / image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      canvas.getContext('2d').drawImage(image, (256 - width) / 2, (256 - height) / 2, width, height);
      const value = canvas.toDataURL('image/png');
      if (accountGallery !== gallery || accountToken !== token) return;
      gallery.settings = gallery.settings || {};
      gallery.settings.icon = value;
      pendingSaves.set('u:icon', value);
      apply(value);
      flushSaves();
      setStatus('갤러리 아이콘을 변경했어요.');
    } catch {
      setStatus('이미지를 읽지 못했어요. PNG·JPG·WebP 이미지로 다시 선택해 주세요.', true);
    } finally {
      URL.revokeObjectURL(url);
      logo.disabled = false;
    }
  });
  return { apply, logout, get session() { return session; } };
})();
