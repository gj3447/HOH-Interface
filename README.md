# HOH UI / HOH GUI

콘텐츠 피드와 AI 에이전트 대화창을 중심으로 하는 공통 인터페이스다.
피드에서 콘텐츠와 앱을 탐색하고, AI 프롬프트로 현재 맥락의 정밀 작업을 수행한다.
사용자는 이 구조를 **AI 네이티브 OS의 기본 GUI**로 정의했다.

## 공통 화면

- **콘텐츠 뷰어**: 글, 작업 앱, 게임 등 등록된 프로그램과 데이터를 같은 자리에 표시한다.
- **AI 대화창**: 현재 콘텐츠와 작업 맥락을 바탕으로 정밀 작업을 요청하는 창이다.
- **대시보드**: 고정 앱과 즐겨찾기한 콘텐츠를 앱 아이콘으로 연다. 설정도 앱 하나다.
- **반응과 저장**: 콘텐츠 오른쪽에 좋아요·싫어요·댓글·공유, 왼쪽에 즐겨찾기를 둔다.
- **모바일**: 좌우 피드, 아래에서 올리는 채팅, 반화면 채팅, 위쪽 앱 손잡이를 내리는 대시보드.
- **PC·태블릿**: 콘텐츠는 왼쪽, AI 대화는 오른쪽에 표시한다.

공통 화면과 제품 연결 코드는 분리한다. 콘텐츠·앱·추천·권한·계정·AI 서비스는
각 제품의 어댑터와 백엔드가 제공한다. 콘텐츠 데이터가 임의의 코드를 설치하거나
실행하지 않는다. 실행할 렌더러는 호스트가 코드로 등록한다.

## 적용 범위

| 호스트 | 현재 상태 |
| --- | --- |
| MetaHumotonic | 첫 적용 대상. Program Feed 백엔드 어댑터와 로컬 실행 검증을 제공한다. |
| 회사 업무 / 좋좋공 일 | 같은 UI 적용 방향을 기록했다. 업무 시스템 연결은 후속 작업이다. |
| MM | 사용자 지정 적용 대상. 약어의 의미와 대상 저장소는 아직 정하지 않았다. |

현재 산출물은 브라우저에서 실행되는 UI 셸과 연결 계약이다. 커널·드라이버·네이티브
앱 스토어 배포는 구현 범위에 들어 있지 않다. MetaHumotonic의 HSWM 채팅은 연결 준비
전까지 `NOT_READY`를 유지한다. CHU·USL·HSWM 실행 권한은 UI 등록에서 생기지 않는다.

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
실제 호스트는 `mountHohUI`와 어댑터를 함께 배치한다. 연결 계약은
[어댑터 문서](docs/ADAPTER.md)에 있다.

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
공개 원격 저장소 생성이나 업로드는 수행하지 않았다.

[검증 기록](provenance/verification-2026-10-06.json): 패키지 검사 3개, 참조 호스트 검사
15개와 빌드, 기존 브라우저 동작 19개 및 HOH 재사용 검사 12개가 통과했다.
[모바일 화면](docs/screenshots/host-390.png), [PC 화면](docs/screenshots/host-1440.png),
[별도 어댑터·렌더러 검증 화면](docs/screenshots/standalone-custom-900.png)을 보관한다.
