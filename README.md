# HOH Interface

Copyright (C) 2026 **MetaHumotonic Foundation** · [AGPL-3.0-only](LICENSE)

실행 가능한 콘텐츠와 AI 명령이 하나의 작업 맥락을 공유하는,
**최소한의 AI 네이티브 OS 인터페이스**다. 피드로 콘텐츠와 앱을 탐색하고,
프롬프트로 정밀 작업을 요청한다. HOH UI / HOH GUI는 기존 별칭이다.
[개념과 완성도 기준](docs/CONCEPT.md)에 역할·확장 원칙·현재 구현 범위를 정리했다.

로컬 **HOH 작업공간**은 이 인터페이스와 `backend/`에 옮긴 기존 웹백 전체를 함께 둔다.
백엔드는 자신의 Git 이력과 미커밋 자료를 보존하는 독립 checkout이며, 이 공개 UI 저장소에
자동 포함되지 않는다. 새 작업 경로와 실행 방법은 [작업공간 안내](docs/WORKSPACE.md)를 따른다.

## Semantic content · draft 0.1

**HOH의 핵심은 사람이 직접 편집하고, AI도 같은 의미·상태·행동 계약으로 조작하는 콘텐츠다.**
새 `HOH Content Contract`는 `describe → read → invoke → subscribe` 네 가지 연산을
정의한다. 명령은 현재 콘텐츠·상태 버전·권한·입출력 스키마를 검사한 뒤 실행하고,
실제 결과와 실행 기록을 돌려준다.

**HOH content is a semantic resource with observable state and declared actions.
People and agents operate it through the same host-owned interface.**

- [Specification](docs/CONTENT_CONTRACT.md) · [JSON Schema](protocol/descriptor.schema.json) · [Type contract](protocol/contracts.d.ts)
- [Build a content app](docs/BUILD_CONTENT.md) · [Reference board](examples/semantic/model.js)
- [Standards research](docs/research/SEMANTIC_CONTENT_2026-10-07.md) · [HSWM profile](docs/HSWM_CONTENT_PROFILE.md)
- [Conformance and examples](docs/CONFORMANCE.md) · [Adoption plan](docs/ADOPTION.md) · [Provenance graph](graph/semantic-content.jsonld)

```sh
npm ci
npm run preview -- --port 8022
# http://127.0.0.1:8022/semantic/
```

예제 보드에서 제목·할 일을 직접 바꾸거나 옆의 채팅에 `추가: 회의 준비`, `완료 1`을
입력한다. 다섯 가지 콘텐츠 조작 모두 같은 dispatcher를 사용한다. 삭제·초기화는
확인 후 적용하고, 사람이 먼저 변경한 상태를 오래된 AI 제안이 덮어쓰면 거절한다.
이 데모의 명령 해석은 **규칙 기반**이고 LLM·HSWM은 연결되지 않았다. 실제 모델은
호스트 `planner`에 주입한다. MCP는 도구·자원 payload 매핑까지만 제공한다.

공개 초안이며 업계 표준 채택·독립 인증·모든 기존 콘텐츠의 전환을 주장하지 않는다.

## 공통 화면

[입력·제스처 명세 0.1](docs/INTERACTION_PROFILE.md): 콘텐츠는 세로 스크롤만,
좌우 스와이프는 피드 이동, 화면 하단에서 위로는 AI, 상단에서 아래로는 앱 그리드를 연다.
웹은 단축키와 AI·대시보드 글래스 버튼을 제공하는 방향으로 정의했다.
원문과 8개 규칙을 [그래프](graph/interaction-profile.jsonld)에 연결했다.
현재 구현과 남은 차이는 명세에 별도로 표시했으며, 새 경계 제스처·단축키는 아직 미구현이다.

- **콘텐츠 뷰어**: 글, 작업 앱, 게임 등 등록된 프로그램과 데이터를 같은 자리에 표시한다.
- **AI 대화창**: 현재 콘텐츠와 작업 맥락을 바탕으로 정밀 작업을 요청하는 창이다.
- **대시보드**: 고정 앱과 즐겨찾기한 콘텐츠를 앱 아이콘으로 연다. 설정도 앱 하나다.
- **반응과 저장**: 콘텐츠 오른쪽에 좋아요·싫어요·댓글·공유, 왼쪽에 즐겨찾기를 둔다.
- **모바일 목표**: 좌우 피드, 하단 경계에서 올리는 채팅, 반화면 채팅, 상단 경계에서 내리는 앱 대시보드. 현재는 전용 손잡이를 사용한다.
- **PC·태블릿**: 콘텐츠는 왼쪽, AI 대화는 오른쪽에 표시한다.
- **실시간 콘텐츠**: 음성·영상 통화와 방송 발행·시청을 같은 콘텐츠 안에서 제어한다.

공통 화면과 제품 연결 코드는 분리한다. 콘텐츠·앱·추천·권한·계정·AI 서비스는
각 제품의 어댑터와 백엔드가 제공한다. 콘텐츠 데이터가 임의의 코드를 설치하거나
실행하지 않는다. 실행할 렌더러는 호스트가 코드로 등록한다.

## 적용 범위

| 호스트 | 현재 상태 |
| --- | --- |
| MetaHumotonic | 첫 적용 대상. Program Feed 백엔드 어댑터와 로컬 실행 검증을 제공한다. |
| 회사 업무 / 좋좋공 일 | 좋좋공은 MM 안의 범위로 같은 화면을 쓴다(보이는 자료·조작만 좁다). 회사 업무는 MM을 통해 연결한다. |
| MM | 연구 서버 프로그램(metahumo_manufacture, 비공개 저장소). 고치지 않은 사본과 자체 어댑터·렌더러로 연결해 기본 화면으로 운영한다(2026-10-07, [관측 기록](provenance/host-mm-2026-10-07.json)). AI 대화는 호스트의 제공자이며 `readiness.chat`으로 알린다 — HSWM 연결이 아니다. |

현재 산출물은 브라우저에서 실행되는 UI 셸과 연결 계약이다. 커널·드라이버·네이티브
앱 스토어 배포는 구현 범위에 들어 있지 않다. MetaHumotonic의 HSWM 채팅은 연결 준비
전까지 `NOT_READY`를 유지한다. CHU·USL·HSWM 실행 권한은 UI 등록에서 생기지 않는다.

## 통화·영상·방송 실행 예제

```sh
npm run preview -- --port 8021
```

`http://127.0.0.1:8021/realtime/`를 같은 브라우저의 두 탭에서 열면 실제 WebRTC
연결을 시험할 수 있다. 통화는 두 탭에서 같은 앱으로 참여하고, 방송은 발행 앱과
시청 앱을 각각 연다. 참여 전에는 캡처하지 않고, 시청자는 마이크·카메라 권한을 요청하지 않는다.

연결은 `realtime: { provider, authorize }`로 주입한다. 호스트가 방과 역할을 승인하고,
제공자가 미디어·신호를 처리한다. 화면 갱신은 세션을 유지하고 콘텐츠 이동 시에는 종료를
확인한다. [기술 계약·연결 예제](docs/REALTIME.md), [타입 계약](realtime/contracts.d.ts),
[출처가 연결된 실시간 그래프](graph/realtime.jsonld)에 구현 범위와 운영 책임을 구분했다.
이 예제는 같은 브라우저의 탭 사이에서 동작한다. 다른 기기 사이의 서비스나 대규모 방송은
인증·신호 서버·TURN/SFU를 갖춘 호스트 제공자가 필요하다.

## 소스 사용

Node 버전은 `.node-version`에 기록한다. 런타임 npm 의존성은 없다.

```sh
npm test
npm run preview
```

호스트 연결 예제(`/host/`)는 백엔드 없이 호스트가 정하는 것 — 대시보드 아이콘, 콘텐츠마다 받는 반응·댓글·공유·저장(`accepts`),
사람이 기다리는 AI 답을 지우지 않는 호스트의 열기(`initiator: 'host'`) — 을 보인다. 브라우저 확인: `npm run test:host -- --playwright-module PATH --browser-executable PATH`.

기본 미리보기는 로컬 셸을 제공하고 백엔드 미연결 상태를 표시한다. 실행 중인
MetaHumotonic 로컬 백엔드를 명시적으로 연결하려면:

```sh
npm run preview -- --backend http://127.0.0.1:8018
```

미리보기는 loopback에만 바인딩하며 외부 서비스에 자동으로 연결하지 않는다.
실제 호스트는 `mountHohInterface`와 어댑터를 함께 배치한다.
기존 `mountHohUI`도 호환 별칭으로 제공한다. 연결 계약은
[어댑터 문서](docs/ADAPTER.md)에 있다.

렌더러의 화면 맥락과 비동기 작업 수명은 실제 Chromium으로 검사할 수 있다.
실행 중인 로컬 미리보기와 설치된 Playwright 모듈·브라우저 경로를 명시한다:

```sh
npm run test:browser -- --url http://127.0.0.1:8020/feed/ \
  --playwright-module /path/to/playwright-core \
  --browser-executable /path/to/chromium
```

MetaHumotonic 배포는 HOH 소스의 검증된 복사본을 포함한다. 실행 시 형제 저장소의
절대경로에 의존하지 않는다. 동기화는 명시적인 내보내기로 하고, 파일 해시를 남긴다:

```sh
npm run export:metahumotonic -- --target /path/to/metahumotonic_web_back --check
npm run export:metahumotonic -- --target /path/to/metahumotonic_web_back --write
```

## 원문과 출처

사용자의 명명·OS GUI 정의 원문은 `sources/`, 그에 대한 구현 해석과 연결은
`graph/`에 구분해 보관한다. 기존 HOH 세계관·게임·방송 플랫폼 기록은 출처로
참조하며, 이번 GUI 구현과 동일한 실행물이라고 간주하지 않는다.

초기 UI는 MetaHumotonic Program Feed에서 추출했다. 원본 경로·바이트 해시와
라이선스는 [추출 기록](provenance/metahumotonic-extraction-2026-10-06.json)에 있다.
공개 저장소: [gj3447/HOH-Interface](https://github.com/gj3447/HOH-Interface).
초기 검증 기록의 공개 여부는 각 기록을 작성한 시점의 상태다.

## 저작권과 라이선스

HOH Interface의 저작권 표기는 **MetaHumotonic Foundation**이다.
GNU Affero General Public License, version 3 only로 배포한다.
원본 MetaHumotonic Web Backend 코드의 저작자 표기는 [NOTICE](NOTICE)에 보존한다.
전체 이용 조건은 [LICENSE](LICENSE)를 따른다.
생성된 검증 코드의 제삼자 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있다.

## 검증 기록

0.3.0 / Content Contract 0.1의 [검증 기록](provenance/verification-content-0.1.json):
패키지 검사 37개, 브라우저 검사 24개, 생성 검증기 7개 일치 확인을 통과했다.
JSON-LD를 실제 RDF로 파싱하고 SHACL의 정상·거절 사례와 질의 6개를 검사했다.
사람과 채팅의 동일 콘텐츠 조작, 충돌·확인·취소, 키보드와 모바일 화면을 검증했다.
[PC](docs/screenshots/content-0.1-desktop.png),
[모바일 반화면 채팅](docs/screenshots/content-0.1-mobile.png)을 보관한다.
예제는 규칙 기반 명령과 메모리 상태를 사용하며, 외부 AI·HSWM·MCP 서버 연동 검증은 아니다.

0.2.0의 [검증 기록](provenance/verification-interface-0.2.0.json)은 실제 브라우저의
음성·영상 데이터 전송, 다중 시청자, 권한 거부, 화면 공유 트랙 정리와 GUI 검사를 포함한다.
캡처 장치는 테스트용 합성 영상·음원을 사용했으며, 실제 카메라 영상이나 개인정보를
저장하지 않았다. [PC](docs/screenshots/interface-0.2.0-realtime-desktop.png),
[모바일](docs/screenshots/interface-0.2.0-realtime-mobile.png),
[라이트 모드](docs/screenshots/interface-0.2.0-light.png) 검증 화면을 보관한다.

브라우저 검사는 설치된 도구 경로를 명시해서 실행한다:

```sh
npm run test:realtime -- --playwright-module /path/to/playwright-core \
  --browser-executable /path/to/chromium --url http://127.0.0.1:8021/realtime/
```

0.1.1의 [검증 기록](provenance/verification-interface-0.1.1.json): 패키지 검사 3개,
참조 호스트 검사 15개와 빌드, 화면 맥락 브라우저 검사 16개, 실제 호스트 검사 8개가
통과했다. 이름·정의와 다섯 원칙을 출처가 있는 그래프로 연결했다.
[0.1.1 모바일 화면](docs/screenshots/interface-0.1.1-host-390.png),
[0.1.1 PC 화면](docs/screenshots/interface-0.1.1-host-1440.png)을 보관한다.

초기 0.1.0 [검증 기록](provenance/verification-2026-10-06.json): 패키지 검사 3개, 참조 호스트 검사
15개와 빌드, 기존 브라우저 동작 19개 및 HOH 재사용 검사 12개가 통과했다.
[모바일 화면](docs/screenshots/host-390.png), [PC 화면](docs/screenshots/host-1440.png),
[별도 어댑터·렌더러 검증 화면](docs/screenshots/standalone-custom-900.png)을 보관한다.
