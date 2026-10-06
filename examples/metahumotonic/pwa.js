let installPrompt = null;
const installStatus = (message) => {
  const target = document.querySelector('#installStatus');
  if (target) target.textContent = message;
};
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/feed/sw.js', { scope: '/feed/' }).catch(() => {
    installStatus('앱 설치 준비에 실패했습니다. 연결을 확인한 뒤 다시 열어주세요.');
  });
}
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  installStatus('앱 설치가 완료되었습니다.');
});
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-install-app]');
  if (!button) return;
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) {
    installStatus('현재 설치한 앱으로 실행 중입니다.');
    return;
  }
  if (!installPrompt) {
    installStatus(window.isSecureContext
      ? '브라우저 메뉴의 앱 설치 또는 홈 화면에 추가를 선택하세요. 지원 여부는 브라우저에 따라 다릅니다.'
      : '앱 설치는 HTTPS 주소에서 지원됩니다. 지금은 웹으로 사용할 수 있습니다.');
    return;
  }
  button.disabled = true;
  const pending = installPrompt;
  installPrompt = null;
  try {
    await pending.prompt();
    const choice = await pending.userChoice;
    installStatus(choice.outcome === 'accepted' ? '설치 요청을 보냈습니다.' : '설치를 취소했습니다.');
  } catch {
    installStatus('설치 창을 열지 못했습니다. 브라우저 메뉴에서 다시 시도하세요.');
  } finally { button.disabled = false; }
});
