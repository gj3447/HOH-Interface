# HOH Interface 호스트 연결 계약

시맨틱 콘텐츠의 공통 조작 계약은 [HOH Content Contract](CONTENT_CONTRACT.md)를 따른다.
`renderers.SEMANTIC` 예제는 기존 렌더러 확장 지점에서 동작하며, 직접 편집과 `chat()`의
호스트 planner가 같은 `runtime.invoke()`를 호출한다. `saveState()`를 AI에 무제한
노출하는 방식으로 바꾸지 않는다. 기존 어댑터는 계속 사용할 수 있지만 새 계약의
적합성이 자동으로 부여되지는 않는다.

HOH Interface는 한 문서의 전체 화면 셸이다. 동일 문서에 여러 인스턴스를 동시에
배치하는 위젯 계약은 아니다. 새 인스턴스를 장착하기 전 기존 `destroy()`를 호출한다.

[입력 프로파일 초안](INTERACTION_PROFILE.md)은 렌더러의 세로 전용 스크롤과 셸의
가로 피드·경계 제스처·단축키 책임을 정의한다. 새 정책은 아직 전체 런타임에 적용되지
않았으며, 여기서 선언한 의미적 셸 명령을 기존 어댑터 메서드와 혼동하지 않는다.

```js
const ui = mountHohInterface({
  root: document.querySelector('#hoh-root'),
  adapter,
  workspaceName: '제품 이름',
  homeContentId: 'dashboard-home',
  renderers: { WORK_APP: ({ item, view, payload, context, signal, isCurrent, open, saveState }) => node },
  renderAnswer: ({ answer, partial, ...result }) => node   // 선택: 호스트가 답을 그린다(정제한 Markdown 등)
});
await ui.ready;
// ui.open(contentId, { initiator }), ui.refresh(), ui.destroy()
```

`ui.open(contentId)`은 사람이 시작한 탐색과 같다 — 진행 중이던 작업(AI 답·저장)의 늦은 결과는
새 화면에 적용되지 않는다. 호스트·에이전트가 스스로 여는 경우(CLI의 «보여 주기», 에이전트의 화면 지시)는
`ui.open(contentId, { initiator: 'host' })`로 연다. 이 열기는 사람이 기다리는 진행 중 작업을 취소하지 않고,
그 작업이 끝나 적용된 뒤에 연다. 그동안 사람이 직접 탐색하면 사람의 탐색이 앞선다.
`renderAnswer`는 AI 답을 호스트가 그리는 함수다 — 흘러오는 중(`partial: true`)과 끝난 답(`chat()` 결과 전체)을 받아 **정제된** DOM Node를 돌려준다.
HOH는 외부 라이브러리 없이 돌므로 Markdown을 직접 그리지 않는다. 없으면 답을 글자 그대로 보인다.

`ui.open`은 결과를 돌려준다 — 화면에 올라오면 `{applies:true, contentId}`, 아니면 `{applies:false, reason}`
(`superseded` 뒤의 탐색이 앞섬 · `navigation_cancelled` · `disposed` · `failed`와 `message`·`status`).

렌더러는 호스트 코드에 등록한 함수이며 DOM Node를 반환한다. `saveState(next)`는
렌더러가 생성된 앱의 상태를 어댑터에 저장한다. `open(contentId)`는 권한 검사를 거쳐
해당 콘텐츠를 연다. 원격 콘텐츠의 문자열이나 URL을 코드로 가져오지 않는다.
기본 렌더러는 ARTICLE·CHECKLIST·GAME·ACCOUNT·DASHBOARD·REALTIME이다.
REALTIME의 호스트 인증·미디어 제공자·수명 계약은 [실시간 콘텐츠 문서](REALTIME.md)에 있다.
일반 렌더러의 `signal`은 화면마다 갱신되지만, 미디어 세션은 셸이 소유하므로 같은 콘텐츠의
좋아요·저장에 따른 재렌더링은 통화를 끊지 않는다.

`context`는 생성 당시의 `contentId`, `viewRevision`, `manifestId`, `manifestRevision`을
담는 읽기 전용 값이다. `isCurrent()`로 화면 맥락이 유효한지 확인할 수 있다.
화면 이동·다시 렌더링·새로고침·해제 때 `signal`이 중단되므로 호스트는 타이머와
구독도 정리할 수 있다. 오래된 렌더러의 `open`과 `saveState`는 어댑터를 호출하지 않고
`{applies:false, reason:'stale_context'}`를 반환한다. 저장 성공은
`{applies:true, appState}`이며 실패 결과를 성공으로 취급하지 않는다.

피드 항목은 탐색용 스냅샷이다. 실제 화면은 `open()`이 반환한 최신 콘텐츠·프로그램
버전·앱 상태를 사용한다. `mountHohUI`는 `mountHohInterface`의 호환 별칭이다.

## 어댑터 메서드

각 메서드는 Promise를 반환한다. 실패는 `Error`로 reject하고, HTTP 오류가 있으면
`status`를 붙인다. UI는 실패한 저장을 성공으로 표시하지 않으며 채팅 초안을 유지한다.

| 메서드 | 입력 / 반환 |
| --- | --- |
| `bootstrap()` | `{profile, readiness?}`. 세션·CSRF는 어댑터 내부에서 처리한다. |
| `list({cursor?})` | `{items, hasMore?, cursor?}`. 처음에는 `{}`로 부른다. 피드 끝에서 `hasMore`면 받은 `cursor`로 다음 묶음을 부르고, 없으면 처음으로 돌아간다. 각 항목은 `{content, manifest, reasons?}`다. `reasons`는 호스트의 추천이 그 항목을 고른 까닭(짧은 문장 목록)이며 UI가 카드와 콘텐츠 아래에 보인다. |
| `open({contentId, expectedViewRevision})` | `{content, manifest, viewRevision, appState?, favorite?, reaction?, reactionCounts?, reactedBy?, comments?, commentScope?, accepts?, dashboard?}`. `reactionCounts`는 `{like, dislike}` 수(반응 단추에 보임), `reactedBy`는 `{like:[이름], dislike:[이름]}`(단추의 설명), `comments`는 `[{id?, body, author?, at?, canDelete?}]`(쓴 사람·시각, `canDelete`면 «지우기»), `commentScope`는 댓글을 누가 보는지(없으면 «나만 보기»). `accepts`는 셸의 호스트 자원 — `reaction`(좋아요·싫어요)·`comment`·`share`·`favorite`(저장) — 가운데 이 콘텐츠가 받는 것이다. `false`인 것은 셸이 숨기고, 적지 않은 것은 받는다. |
| `favorite({contentId, favorite, viewRevision})` | 확인된 저장 결과 |
| `react({contentId, reaction, viewRevision})` | `LIKE`, `DISLIKE`, `CLEAR`에 대한 확인된 결과. `reactionCounts`·`reactedBy`를 함께 돌려주면 단추의 수가 바뀐다. |
| `comment({contentId, body, viewRevision})` | `{comments}` 또는 확인된 댓글 결과 |
| `deleteComment({contentId, commentId, viewRevision})` | `{comments}`. 선택 메서드 — 있으면 `canDelete`인 댓글에 «지우기»가 보인다. |
| `saveState({contentId, state, viewRevision})` | `{appState}` |
| `chat({contentId, message, viewRevision, onProgress?, signal?})` | 실제 제공자의 `{answer, open?}` 또는 오류. 답을 받는 동안 `onProgress({step})`·`onProgress({answer})`(지금까지의 답) 또는 `onProgress({delta})`로 알리면 «받는 중» 말풍선에 단계와 답이 흐르고 «멈추기»가 `signal`을 끊는다 — 그때는 받은 만큼으로 끝내거나 `AbortError`로 거절한다. 답은 사람이 다른 화면으로 넘어가도 대화에 남는다. `open`은 답을 보인 뒤 호스트가 시작한 열기로 연다 — 그사이 사람이 화면을 옮겼으면 열지 않는다. |
| `profile()` | `{profile}`. 즐겨찾기는 `{id,title,kind}` 목록이다. |
| `status()` | `{readiness}`. `readiness.chat`은 AI 대화 제공자의 `{status, reason}`이다 — `READY`면 «AI 채팅을 사용할 수 있습니다», 아니면 `reason`을 보인다. 없으면 `readiness.hswm`을 같은 뜻으로 읽는다(참조 어댑터는 HSWM 채팅을 `readiness.hswm`으로 제공한다). |

`content`는 `{id,title,payload}`, `manifest`는 `{kind}`를 포함한다.
대시보드의 `dashboard`는 `{fixed:[{id,title,kind,icon?,badge?,description?}], favorites:[{id,title,kind,icon?,badge?}]}`다. `icon`은 호스트가 정하는 두 글자 이하의 글자 아이콘이며, 없거나 길면 종류의 기본 아이콘을 쓴다. `badge`는 아이콘에 붙는 수(새 쪽지·답장 등, 양의 정수 — 99 넘으면 «99+»)이며 화면 읽기에는 «새 항목 N개»로 읽힌다.
일반 피드에 어떤 앱을 포함할지는 호스트가 결정한다. UI는 대시보드에 추천 피드
바로가기를 추가하며, 설정 앱도 호스트가 공급하는 고정 앱 목록으로 받는다.

## 책임과 상태

UI는 화면, 제스처, 대화 초안, 작업 순서, 최신 선택 화면을 관리한다.
빠른 연속 탐색에서는 처리된 서버의 view revision을 보존하고 마지막 의도만 표시한다.
어댑터는 API 경로·세션·CSRF·request ID·오류 변환을 맡고, 백엔드는 프로필 격리,
권한·revision 검증, 영속 저장, 추천 정책, 실행 권한을 맡는다.

현재 `adapters/program-feed.js`가 MetaHumotonic의 실제 `/api/program-feed/v1`
프로토콜을 연결한다. 다른 호스트는 같은 메서드를 구현하고 자신이 제공할 앱과
렌더러를 등록한다. 이 계약은 회사 업무 시스템이나 MM의 연결 완료를 뜻하지 않는다.

AI 대화 제공자가 HSWM이 아닌 호스트(예: MM의 자체 AI)는 `readiness.chat`을 채우고 `readiness.hswm`을 채우지 않는다.
`readiness.hswm`이 `READY`인 것은 HSWM 채팅이 연결됐다는 뜻으로만 쓴다.

HSWM·CHU·USL은 백엔드 연결에 속한다. UI의 등록이나 그래프 관계는 실행 권한,
HSWM admission, 모델의 준비 상태를 만들어 내지 않는다. 현재 참조 백엔드의
HSWM 채팅은 `NOT_READY`다.

이 문서는 구현 계약에 대한 AI 작성 설명이다. 사용자의 명명과 OS GUI 방향 원문은
[`user-hoh-ui-2026-10-06.txt`](../sources/user-hoh-ui-2026-10-06.txt)에 별도로 보존한다.
