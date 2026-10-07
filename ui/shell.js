const icon = (paths) => `<svg class="ui-icon" aria-hidden="true" viewBox="0 0 24 24">${paths}</svg>`;
const icons = {
  app: icon("<path d=\"M7 3h10M5 7h14M7 21h10M5 17h14M7 7v10M17 7v10\"/>"),
  previous: icon("<path d=\"m15 18-6-6 6-6\"/>"),
  next: icon("<path d=\"m9 18 6-6-6-6\"/>"),
  like: icon("<path d=\"M7 10v10H4v-10h3Zm0 10h9.1a2 2 0 0 0 2-1.6l1-5a2 2 0 0 0-2-2.4H14l.5-3.5a3 3 0 0 0-3-3.5L7 10Z\"/>"),
  dislike: icon("<path d=\"M7 14V4H4v10h3Zm0-10h9.1a2 2 0 0 1 2 1.6l1 5A2 2 0 0 1 17.1 13H14l.5 3.5a3 3 0 0 1-3 3.5L7 14Z\"/>"),
  comment: icon("<path d=\"M5 5h14v11H9l-4 4V5Z\"/>"),
  share: icon("<circle cx=\"18\" cy=\"5\" r=\"2\"/><circle cx=\"6\" cy=\"12\" r=\"2\"/><circle cx=\"18\" cy=\"19\" r=\"2\"/><path d=\"m8 11 8-5M8 13l8 5\"/>"),
  save: icon("<path d=\"M6 4h12v16l-6-4-6 4V4Z\"/>"),
  close: icon("<path d=\"m7 7 10 10M17 7 7 17\"/>"),
  down: icon("<path d=\"m6 9 6 6 6-6\"/>"),
  handle: icon("<path d=\"M7 9h10M7 15h10\"/>")
};

/** Shared, code-owned DOM template; host content is inserted with textContent. */
export const shellMarkup = `<main class="app-shell" data-sheet="content">
  <header class="topbar"><a class="brand" href="#feed" aria-label="HOH Interface">MetaHumotonic</a><div id="providerStatus" class="provider-status" role="status">콘텐츠 준비 중</div><button id="retryButton" class="retry-button" type="button" hidden>다시 시도</button><button class="home-button" type="button" data-home>홈</button></header>
  <section class="workspace" aria-label="콘텐츠와 AI 채팅">
    <section class="viewer" id="feed" aria-label="현재 콘텐츠"><header class="viewer-head"><div><p class="eyebrow">CONTENTS</p><h1 id="viewerTitle">콘텐츠</h1></div><div class="feed-nav"><button id="dashboardGesture" class="dashboard-gesture" type="button" aria-label="대시보드 열기">${icons.app}<span class="sr-only">앱</span></button><button type="button" data-prev aria-label="이전 콘텐츠">${icons.previous}</button><span id="position" aria-live="polite">0 / 0</span><button type="button" data-next aria-label="다음 콘텐츠">${icons.next}</button></div></header><nav class="favorites" aria-label="저장한 콘텐츠"><div class="rail-label">저장됨</div><div id="favoritesList" class="favorites-list"></div></nav><div id="contentStage" class="content-stage" tabindex="0"></div><div id="feedGesture" class="feed-gesture" aria-label="콘텐츠를 좌우로 넘기기">↔</div><aside class="action-rail" aria-label="콘텐츠 행동"><button type="button" data-reaction="like" aria-pressed="false" aria-label="좋아요">${icons.like}</button><button type="button" data-reaction="dislike" aria-pressed="false" aria-label="싫어요">${icons.dislike}</button><button type="button" data-comment aria-label="댓글 보기">${icons.comment}</button><button type="button" data-share aria-label="공유 링크 복사">${icons.share}</button></aside><footer class="viewer-foot"><button type="button" data-save aria-pressed="false">${icons.save}<span data-save-label>저장</span></button><button type="button" data-remove hidden>저장 목록에서 제거</button><span id="contentMeta"></span></footer></section>
    <aside class="chat" aria-label="전역 AI 채팅"><header><div><p class="eyebrow">AI CHAT</p><h2>AI 채팅</h2></div><button type="button" class="sheet-close" data-sheet-close aria-label="채팅 닫기">${icons.down}</button></header><div id="chatStatus" class="chat-status" role="status">연결 상태를 확인하는 중</div><ol id="messages" class="messages" aria-live="polite" tabindex="0" aria-label="대화"></ol><form id="chatForm" class="composer"><label class="sr-only" for="chatInput">AI에게 질문</label><input id="chatInput" name="message" autocomplete="off" placeholder="현재 콘텐츠에 관해 물어보세요"><button type="submit">보내기</button></form></aside>
  </section>
  <button id="sheetHandle" class="mobile-grab" type="button" aria-label="AI 채팅 높이 조절">${icons.handle}</button>
</main>
<dialog id="commentDialog"><form method="dialog" class="comment-panel"><header><h2>댓글 <small id="commentScope">나만 보기</small></h2><button value="cancel" aria-label="닫기">${icons.close}</button></header><ol id="comments" class="comment-list"></ol><label>댓글 <textarea id="commentInput" rows="3" placeholder="댓글을 입력하세요"></textarea></label><menu><button value="cancel">취소</button><button id="commentSubmit" type="button">등록</button></menu></form></dialog>`;
