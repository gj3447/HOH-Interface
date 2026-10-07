/* Copyright (C) 2026 MetaHumotonic Foundation. SPDX-License-Identifier: AGPL-3.0-only */
const statuses = { idle: '참여 전', joining: '연결 준비 중', waiting: '상대방을 기다리는 중', connected: '연결됨', reconnecting: '연결 복구 중', error: '연결하지 못했습니다', closed: '종료됨' };

/** Media is owned by the mount-scoped session, never by a transient DOM render. */
export function renderRealtimeView({ item, signal, isCurrent, session, available, start }) {
  const request = item.content?.payload?.realtime || {};
  const mode = request.mode, role = request.role;
  const valid = ['audio', 'video', 'broadcast'].includes(mode) && (mode === 'broadcast' ? ['publisher', 'viewer'].includes(role) : role === 'participant');
  const card = document.createElement('article'); card.className = 'realtime-card';
  card.innerHTML = `<header class="realtime-header"><p class="eyebrow"></p><h2></h2><p class="realtime-meta"></p></header>
    <p class="realtime-status" role="status" aria-live="polite"></p>
    <div class="realtime-stage"><div class="realtime-videos"></div><p class="realtime-placeholder"></p></div>
    <p class="realtime-error" role="alert" hidden></p>
    <div class="realtime-controls" role="group" aria-label="통화 및 방송 조작">
      <button type="button" data-rtc-action="join"></button><button type="button" data-rtc-action="leave" hidden>나가기</button>
      <button type="button" data-rtc-action="microphone" hidden>마이크 끄기</button><button type="button" data-rtc-action="camera" hidden>카메라 끄기</button>
      <button type="button" data-rtc-action="screen" hidden>화면 공유</button><button type="button" data-rtc-action="sound" hidden>소리 끄기</button><button type="button" data-rtc-action="play" hidden>소리·영상 재생</button>
    </div>`;
  const $ = s => card.querySelector(s);
  // Keep consent and leave controls before media, including on short viewports.
  card.insertBefore($('.realtime-controls'), $('.realtime-stage'));
  const action = name => $(`[data-rtc-action="${name}"]`);
  $('.eyebrow').textContent = mode === 'broadcast' ? 'LIVE' : mode === 'audio' ? 'VOICE' : 'VIDEO';
  $('h2').textContent = item.content.title || '실시간 콘텐츠';
  $('.realtime-meta').textContent = typeof item.content.payload?.body === 'string' ? item.content.payload.body : '참여 버튼을 누르면 연결을 시작합니다.';
  const joinLabel = mode === 'broadcast' ? role === 'viewer' ? '방송 시청' : '방송 시작' : '통화 참여';
  const tiles = new Map(); let playbackBlocked = false, pending = false, operationError = '', soundMuted = false;
  function tile(id, stream, label, local) {
    let entry = tiles.get(id);
    if (!entry) {
      const node = document.createElement('figure'); node.className = 'realtime-tile';
      const video = document.createElement('video'); video.autoplay = true; video.playsInline = true; video.muted = local || soundMuted;
      const caption = document.createElement('figcaption'); node.append(video, caption); $('.realtime-videos').append(node);
      entry = { node, video, caption, local }; tiles.set(id, entry);
    }
    entry.caption.textContent = label;
    entry.node.classList.toggle('is-audio', !stream?.getVideoTracks().some(track => track.readyState === 'live' && track.enabled));
    if (entry.video.srcObject !== stream) {
      entry.video.srcObject = stream;
      if (stream) entry.video.play().catch(() => { if (!signal.aborted) { playbackBlocked = true; action('play').hidden = false; } });
    }
  }
  function update(snapshot) {
    if (signal.aborted) return;
    const active = session?.isActive() || false, joined = active && snapshot.status !== 'joining';
    const receiver = role === 'viewer';
    $('.realtime-status').textContent = !valid ? '콘텐츠의 연결 설정을 확인해 주세요.' : !available ? '연결 서비스가 준비되지 않았습니다.' : statuses[snapshot?.status] || '참여 전';
    $('.realtime-status').dataset.status = snapshot?.status || 'idle';
    action('join').textContent = snapshot?.status === 'error' ? '다시 연결' : joinLabel;
    action('join').hidden = active; action('join').disabled = !valid || !available || pending;
    action('leave').hidden = !active;
    action('sound').hidden = !joined;
    action('sound').textContent = soundMuted ? '소리 켜기' : '소리 끄기';
    action('sound').setAttribute('aria-pressed', String(!soundMuted));
    for (const name of ['microphone', 'camera', 'screen']) action(name).hidden = !joined || receiver || name === 'camera' && mode === 'audio' || name === 'screen' && (mode === 'audio' || !snapshot?.capabilities?.screenShare);
    action('microphone').textContent = snapshot?.microphoneEnabled ? '마이크 끄기' : '마이크 켜기';
    action('microphone').setAttribute('aria-pressed', String(Boolean(snapshot?.microphoneEnabled)));
    action('camera').textContent = snapshot?.cameraEnabled ? '카메라 끄기' : '카메라 켜기';
    action('camera').setAttribute('aria-pressed', String(Boolean(snapshot?.cameraEnabled)));
    action('screen').textContent = snapshot?.screenSharing ? '공유 종료' : '화면 공유';
    action('screen').setAttribute('aria-pressed', String(Boolean(snapshot?.screenSharing)));
    for (const name of ['microphone', 'camera', 'screen']) action(name).disabled = pending;
    const streams = new Set();
    if (snapshot?.localStream) { streams.add('local'); tile('local', snapshot.localStream, snapshot.screenSharing ? '내 공유 화면' : '나 · 내 소리 음소거', true); }
    for (const peer of snapshot?.peers || []) {
      if (!peer.stream) continue;
      streams.add(peer.id); tile(peer.id, peer.stream, peer.state === 'connected' ? '참여자 · 연결됨' : '참여자 · 연결 중', false);
    }
    for (const [id, entry] of tiles) if (!streams.has(id)) { entry.video.srcObject = null; entry.node.remove(); tiles.delete(id); }
    $('.realtime-placeholder').hidden = streams.size > 0;
    $('.realtime-placeholder').textContent = role === 'viewer' ? '방송을 시작하면 이곳에 영상과 소리가 표시됩니다.' : '참여하기 전에는 마이크와 카메라를 사용하지 않습니다.';
    $('.realtime-error').textContent = snapshot?.error?.message || operationError; $('.realtime-error').hidden = !snapshot?.error && !operationError;
    action('play').hidden = !playbackBlocked || !streams.size;
  }
  card.addEventListener('click', async event => {
    const button = event.target.closest('[data-rtc-action]');
    if (!button || !isCurrent() || !available) return;
    const name = button.dataset.rtcAction, snapshot = session.getSnapshot();
    if (name === 'leave') { session.leave(); pending = false; update(session.getSnapshot()); return; }
    if (pending) return;
    pending = true; operationError = '';
    try {
      // Invoke screen capture directly in the user's click stack, before any await.
      let result;
      if (name === 'join') result = start({ mode, role });
      if (name === 'microphone') result = session.setMicrophone(!snapshot.microphoneEnabled);
      if (name === 'camera') result = session.setCamera(!snapshot.cameraEnabled);
      if (name === 'screen') result = snapshot.screenSharing ? session.stopScreenShare() : session.shareScreen();
      if (name === 'sound') { soundMuted = !soundMuted; for (const entry of tiles.values()) entry.video.muted = entry.local || soundMuted; }
      if (name === 'play') result = Promise.all([...tiles.values()].map(entry => entry.video.play())).then(() => { playbackBlocked = false; });
      update(session.getSnapshot()); const outcome = await result;
      if (outcome?.applies === false) operationError = outcome.error?.message || '현재 연결에서 이 작업을 완료하지 못했습니다.';
    } catch (error) {
      operationError = error?.message || '작업을 완료하지 못했습니다.';
    } finally { pending = false; if (!signal.aborted) update(session.getSnapshot()); }
  }, { signal });
  const unsubscribe = session?.subscribe(update);
  if (!session) update(null);
  signal.addEventListener('abort', () => { unsubscribe?.(); for (const entry of tiles.values()) entry.video.srcObject = null; tiles.clear(); }, { once: true });
  return card;
}
