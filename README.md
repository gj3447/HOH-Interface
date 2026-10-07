# HOH Interface

Copyright (C) 2026 **MetaHumotonic Foundation** · [AGPL-3.0-only](LICENSE)

실행 가능한 콘텐츠와 AI 명령이 하나의 작업 맥락을 공유하는,
**최소한의 AI 네이티브 OS 인터페이스**다. 피드로 콘텐츠와 앱을 탐색하고,
프롬프트로 정밀 작업을 요청한다. HOH UI / HOH GUI는 기존 별칭이다.
[개념과 완성도 기준](docs/CONCEPT.md)에 역할·확장 원칙·현재 구현 범위를 정리했다.

## 공통 화면

- **콘텐츠 뷰어**: 글, 작업 앱, 게임 등 등록된 프로그램과 데이터를 같은 자리에 표시한다.
- **AI 대화창**: 현재 콘텐츠와 작업 맥락을 바탕으로 정밀 작업을 요청하는 창이다.
- **대시보드**: 고정 앱과 즐겨찾기한 콘텐츠를 앱 아이콘으로 연다. 설정도 앱 하나다.
- **반응과 저장**: 콘텐츠 오른쪽에 좋아요·싫어요·댓글·공유, 왼쪽에 즐겨찾기를 둔다.
- **모바일**: 좌우 피드, 아래에서 올리는 채팅, 반화면 채팅, 위쪽 앱 손잡이를 내리는 대시보드.
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

## 검증 기록

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
