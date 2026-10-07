# HOH 작업공간

2026-10-07 사용자의 폴더 통합 요청에 따라 로컬 작업 기준을 `CD/HOH`로 모았다.
기존 HOH Interface는 루트에, 기존 `metahumotonic_web_back`의 모든 내용은 `backend/`에 있다.
두 프로젝트의 Git 이력은 각각 유지한다. `backend/`는 이 UI 저장소의 Git 추적에서 제외한다.
따라서 공개 저장소를 새로 clone하면 백엔드 작업 사본과 개인 자료는 포함되지 않는다.

| 위치 | 내용 |
| --- | --- |
| `ui/`, `adapters/`, `realtime/` | 공통 HOH Interface 구현 |
| `backend/` | 기존 웹백 전체: API, 위키, 그래프, 콘텐츠 원본, 개발 환경, Git 이력 |
| `graph/` | 인터페이스 계약과 출처 그래프 |
| `.usl/resource-bindings.json` | 저장소 ID와 작업공간 상대 경로의 연결 |
| `.usl/local/` | Git에서 제외한 실제 경로 설정과 이동 검증 기록 |

기존 형제 경로 `CD/metahumotonic_web_back`은 `HOH/backend`를 가리키는 호환 심볼릭 링크다.
기존 실행 명령, 가상환경 진입점, 연결된 Git worktree가 이 경로를 사용할 수 있다.
작업 사본의 물리적 루트는 `HOH/backend`이며 백엔드 수정·커밋은 그 저장소에서 수행한다.
기존 패키지명·API·환경변수·배포 원격은 이번 로컬 이동으로 바꾸지 않았다.
백엔드의 `AGENTS.md`와 `docs/DEV_STACK.md`는 계속 해당 checkout에 적용된다.

HOH 루트에서 실행한다:

```sh
# 백엔드 빌드와 로컬 피드 서버
bash backend/ts/scripts/with-node.sh npm --prefix backend/ts run build
bash backend/ts/scripts/with-node.sh node backend/ts/scripts/program-feed-local.mjs
```

별도 터미널에서 인터페이스 미리보기를 연다:

```sh
npm run preview -- --port 8021 --backend http://127.0.0.1:8018
```

인터페이스 검사와 백엔드 검사·소스 동기화는 각각 실행한다:

```sh
npm test
bash backend/ts/scripts/with-node.sh npm --prefix backend/ts test -- program-feed
node scripts/export-metahumotonic.mjs --target ./backend --check
git -C backend status --short --branch
```

이동 직후 파일 24,172개를 포함한 27,126개 항목의 inode·메타데이터, Git HEAD와
미커밋 상태가 이동 전과 일치했다. UI 검사 14개, 백엔드 피드 검사 15개 및
UI 복사본 18개 파일 일치 검사가 통과했다. 실행 중인 로컬 피드·실시간 예제도 응답했다.
이는 로컬 경로 이동 검증이며 원격 배포나 두 Git 저장소의 이력 병합을 뜻하지 않는다.
