# HSWM content profile — proposed mapping

이 프로파일은 HOH 콘텐츠를 HSWM이 읽을 수 있는 출처·역할·상태·행동 근거로
연결하는 설계다. HSWM 실행·학습·원격 접근을 활성화하지 않는다.
현재 참조 구현 상태는 `NOT_CONNECTED`이며, HSWM 연결 실행은 `NOT_READY`다.

HSWM의 현행 원문은 LLM을 계산 자원으로 사용하는 지속적 하이퍼그래프 인지체라는
목표와, 실제로 검증된 구현·효능을 구분한다. 기존 KG의 고정 `H/W/A/F/Π` 설명은
최신 로컬 정전과 일치하지 않아 이번 계약의 고정 데이터 구조로 채택하지 않았다.
조회한 파일·리비전·바이트 해시와 권위 구분은 [조사 출처](research/semantic-content-references.json)에 있다.

| HOH 근거 | HSWM 호스트로 넘길 수 있는 참조 | 보존할 것 |
| --- | --- | --- |
| 콘텐츠 descriptor | 자원·schema-relative 의미 참조 | 안정 ID, descriptor revision, 원문 출처 |
| 관찰 상태 | 특정 시점·revision의 관찰 | 권한에 따라 정제된 값, 관측 시각, 증거 |
| 선언된 action | 실행 후보·도구 계약 참조 | 입력/출력 schema, effect, 허용 조건 |
| 실행 receipt | outcome의 원천 근거 | 요청·행위자·전후 상태·결과, 실행 여부 |
| 의미 관계 | 선택된 n항 관계의 projection | 관계 ID, predicate, 참여자별 role, 출처·상태 |

HOH는 임의의 유사도나 모델 확신을 HSWM의 W로 승격하지 않는다. 학습·가중치 갱신은
해당 HSWM 소유자의 정의, 실행·결과 계약과 평가 절차에 속한다. 단순 RDF 노드 집합을
HSWM 인지 객체 자체라고 부르지 않는다.

최소 호스트 확장 문서는 `profileId`, `resourceId`, `representationId`,
`schemaRevision`, `sourceRevision`, `sourceDigest`, `authorityClass`,
`observedAt`, `executionStatus`와 역할이 보존된 관계를 포함하도록 설계한다.
이는 아직 동작하는 HSWM 어댑터의 wire schema가 아니다. 실제 호스트의 정전·스키마와
대조한 뒤 버전을 고정해야 한다. USL 자원 ID와 표현을 재사용하고 절대 로컬 경로는
공개 descriptor에 넣지 않는다.

연결 실행 전에는 선택 자원의 USL 매핑, 지정 수신자, 소유자 승인, 최소 접근 범위·
만료·철회 수단, 승인된 경로의 읽기 전용 도달성 확인이 모두 필요하다.
이번 작업은 로컬 계약·구현·검증으로 한정되며 해당 연결 절차를 수행하지 않았다.
