# HOH Interface 호스트 연결 계약

HOH Interface는 한 문서의 전체 화면 셸이다. 동일 문서에 여러 인스턴스를 동시에
배치하는 위젯 계약은 아니다. 새 인스턴스를 장착하기 전 기존 `destroy()`를 호출한다.

```js
const ui = mountHohInterface({
  root: document.querySelector('#hoh-root'),
  adapter,
  workspaceName: '제품 이름',
  homeContentId: 'dashboard-home',
  renderers: { WORK_APP: ({ item, view, payload, context, signal, isCurrent, open, saveState }) => node }
});
await ui.ready;
// ui.open(contentId), ui.refresh(), ui.destroy()
```

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
| `list()` | `{items}`. 각 항목은 `{content, manifest, reasons?}`다. |
| `open({contentId, expectedViewRevision})` | `{content, manifest, viewRevision, appState?, favorite?, reaction?, comments?, dashboard?}` |
| `favorite({contentId, favorite, viewRevision})` | 확인된 저장 결과 |
| `react({contentId, reaction, viewRevision})` | `LIKE`, `DISLIKE`, `CLEAR`에 대한 확인된 결과 |
| `comment({contentId, body, viewRevision})` | `{comments}` 또는 확인된 댓글 결과 |
| `saveState({contentId, state, viewRevision})` | `{appState}` |
| `chat({contentId, message, viewRevision})` | 실제 제공자의 `{answer}` 또는 오류 |
| `profile()` | `{profile}`. 즐겨찾기는 `{id,title,kind}` 목록이다. |
| `status()` | `{readiness}`. 참조 어댑터는 `readiness.hswm.status/reason`을 제공한다. |

`content`는 `{id,title,payload}`, `manifest`는 `{kind}`를 포함한다.
대시보드의 `dashboard`는 `{fixed:[{id,title,kind}], favorites:[{id,title,kind}]}`다.
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

HSWM·CHU·USL은 백엔드 연결에 속한다. UI의 등록이나 그래프 관계는 실행 권한,
HSWM admission, 모델의 준비 상태를 만들어 내지 않는다. 현재 참조 백엔드의
HSWM 채팅은 `NOT_READY`다.

이 문서는 구현 계약에 대한 AI 작성 설명이다. 사용자의 명명과 OS GUI 방향 원문은
[`user-hoh-ui-2026-10-06.txt`](../sources/user-hoh-ui-2026-10-06.txt)에 별도로 보존한다.
