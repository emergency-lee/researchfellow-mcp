# ResearchFellow MCP — Requirements v0.1 (2026-07-04)

> 유료 원격 계층. 비즈니스 자산(갱신형 지식 DB, 상주 감시, 서명 인증)을 제공한다.
> 설계 근거: `../docs/business-model-mcp-plugin_2026-07-04.md`

## 0. 원칙

1. **PHI 불수신** — 입력 스키마 자체가 비식별 파생물만 받도록 설계. 방어선 2중:
   스키마 제한(구조적) + 서버측 감지 시 거부·무저장(런타임).
2. **막지 말고 얕게** — 모든 도구는 미인증에도 응답한다(티저 모드). 차단 대신 깊이 차이.
3. **티저는 정직하게** — 개수·존재만 알리고 내용을 감추되, 감지 결과 자체는 진실.
4. **모트는 갱신** — 도구 로직보다 뒤의 DB(문헌 인덱스·룰셋·저널 DB)가 자산.
   모든 지식 자산은 버전 태그를 갖고 응답에 명시된다.

## 1. 프로토콜 · 인증 · 과금

| ID | 요구사항 |
|----|---------|
| PR-1 | MCP Streamable HTTP 서버. Claude Code(`.mcp.json`)와 Claude Desktop connector 양쪽 호환 |
| PR-2 | 인증: OAuth 2.1 (MCP 표준 플로우) + API 키 병행(헤드리스/CI용) |
| PR-3 | 티어: Free(티저) / **Per-Study Pass**(연구 1건, 유효기간 내 Brain 전체 + 무결성 리포트 1회) / Pro(월·연, Pass 무제한 + Watch) / Lab(시트, +팀 gate·감사) |
| PR-4 | Pass 미터링: 프로젝트 지문(`.research/` 프로젝트 UUID) 단위로 사용량 귀속. 도구 호출 횟수가 아니라 연구 단위 과금 |
| PR-5 | 과금·구독 관리는 외부 결제(Stripe 등) 연동, MCP 서버는 entitlement 검증만 담당 |
| PR-6 | 티저 응답에 업그레이드 안내 필드를 포함하되, 강제 아님 (표시는 플러그인 FR-X3 정책 소관) |

## 2. TL-B — Brain 도구군 (지식 자산)

각 도구는 `mode: teaser | full`을 entitlement에 따라 자동 결정하고 응답에 명시한다.

### TL-B1 `novelty_check` — P1 최우선 (전환력 최강)

- 입력: PICO(구조화), 키워드, 선택적으로 유저가 이미 아는 PMID 목록
- 처리: 큐레이션 문헌 인덱스 + PubMed 실시간 교차 검색, 유사도·가설 방향 분석
- full 출력: 유사 연구 목록(PMID, 유사도, 가설 방향 일치/상충, 설계 비교표), novelty 포지셔닝 제안문
- teaser 출력: `{similar_count, conflicting_count, most_recent_year}` — 내용 없이 개수·존재만

### TL-B2 `methodology_advisor`

- 입력: outcome 유형, 데이터 형태 요약(표본 수, 이벤트 수, 시간축 유무, 결측 프로파일 — **집계값만**), 연구 설계
- 처리: 방법론 결정트리(버전 관리되는 룰셋) 평가
- full 출력: 권장 모델 + 결정 근거, 필수 진단 절차, 대안과 트레이드오프, 리뷰어 예상 질문
- teaser 출력: "현재 선택보다 적합할 수 있는 모델 후보 N개 존재" + 첫 번째 후보명

### TL-B3 `checklist_map`

- 입력: 원고 텍스트(초안), 연구 설계 유형
- 처리: STROBE/RECORD/CONSORT 최신 룰셋 대조 (룰셋 버전 명시)
- full 출력: 항목별 충족/누락/부분 + 원고 내 위치 + 수정 제안문
- teaser 출력: 충족률 %와 누락 항목 개수만

### TL-B4 `journal_fit`

- 입력: 초록/요약, 연구 유형, 희망 impact 범위
- 처리: 저널 요건 DB(scope, 포맷 규정, 게재 통계) 매칭
- full 출력: 추천 저널 랭킹 + 근거 + 포맷 체크리스트
- teaser 출력: 적합 저널 개수와 최상위 1개 저널명

### TL-B5 `reviewer_playbook`

- 입력: 리뷰어 코멘트 텍스트, 원고 컨텍스트(해당 섹션)
- 처리: 코멘트 유형 분류 → 유형별 대응 전략 KB 매칭
- full 출력: 코멘트별 유형·대응 전략·응답서 초안 문단·수정 필요 범위
- teaser 출력: 코멘트 유형 분포와 "가장 까다로운 코멘트 1건" 지목

## 3. TL-W — Watch (컴패니언, Pro 전용)

| ID | 요구사항 |
|----|---------|
| TL-W1 | `watch_register`: PICO 기반 감시 구독 등록 (프로젝트당 1개, Pro 전용) |
| TL-W2 | 서버 크론이 주기(기본 주 1회) PubMed 검색 → 신규 경쟁·유사 논문을 인덱스와 대조 |
| TL-W3 | `watch_poll`: 플러그인이 세션 시작 시 호출 → 미확인 발견 카드 반환 (Layer 3 Insight Feed의 원격 소스). 푸시 채널 없이도 성립하는 pull 모델 우선 |
| TL-W4 | 발견 카드 스키마: `{type, severity(critical/notable/info), summary, evidence_refs[], suggested_action}` — 플러그인 Insight Feed와 동일 |
| TL-W5 | 심각도 판정: 동일 가설 기출판 감지 = critical (novelty 붕괴 경보) |

## 4. TL-S — 무결성 인증 (integrity certification)

| ID | 요구사항 |
|----|---------|
| TL-S1 | `integrity_report`: audit.jsonl 이벤트 체인의 해시 + gate 기록 + SAP 사전등록 시점 증빙을 받아 **서버 서명된 무결성 리포트**(PDF/JSON) 발급 |
| TL-S2 | 입력은 해시·타임스탬프·이벤트 메타만 — 원고 본문·데이터 불필요 (PHI 원칙과 정합) |
| TL-S3 | 해시 앵커: 발급 시점의 audit 체인 해시를 서버에 영구 기록 → 사후 변조 검증 가능 (`verify_report` 공개 무료 엔드포인트) |
| TL-S4 | `package_validate`: 제출 패키지 구성 완전성(필수 산출물·gate 승인·체크리스트) 검증 리포트 |
| TL-S5 | 검증(verify)은 누구나 무료 — 인증서의 신뢰는 검증 가능성에서 나온다 |

## 5. KB — 지식 자산 요구

| ID | 자산 | 갱신 |
|----|------|------|
| KB-1 | 문헌 인덱스 (novelty/Watch용 임베딩 인덱스) | 주간 배치 (PubMed 증분) |
| KB-2 | 방법론 결정트리 룰셋 | 버전 태그, 분기별 검토 |
| KB-3 | STROBE/RECORD/CONSORT 룰셋 | 버전 태그, 개정 추적 |
| KB-4 | 저널 요건 DB | 분기별 크롤·검수 |
| KB-5 | 리뷰어 대응 전략 KB | 지속 큐레이션 |
| KB-6 | 모든 응답에 사용된 KB 버전을 명시 (재현성 — 이 제품의 철학과 일관) |

## 6. PHI 방어 (2중)

| ID | 요구사항 |
|----|---------|
| PH-1 | 구조적: 모든 도구 입력 스키마에 자유형 tabular 데이터 필드 부재. 데이터 관련 입력은 집계 통계·스키마 메타로 타입 제한 |
| PH-2 | 런타임: 입력 텍스트에서 PHI 패턴 감지 시 요청 거부 + 요청 본문 무저장 + 클라이언트에 로컬 스크리닝 안내 반환 |
| PH-3 | 로깅 정책: 요청 페이로드 본문은 저장하지 않음. 미터링에 필요한 메타(도구명, 프로젝트 지문, 토큰량)만 기록 |
| PH-4 | 데이터 보존·처리 정책 문서를 공개 (의료기관 도입 심사 대응) |

## 7. NFR

| ID | 요구사항 |
|----|---------|
| NFR-1 | Brain 도구 p95 응답 < 30s (novelty full 기준), teaser < 5s |
| NFR-2 | 서버 불가용이 플러그인 워크플로우를 차단하지 않음 (클라이언트 degradation은 플러그인 FR-X5) |
| NFR-3 | 스택: MCP 공식 SDK 기반 (TypeScript `@modelcontextprotocol/sdk` 또는 Python FastMCP — P1 착수 시 결정), 상태 저장은 Postgres, 인덱스는 pgvector로 시작 |
| NFR-4 | 지역: 초기 단일 리전. PHI를 받지 않으므로 데이터 주권 이슈 최소화되나 PH-4 문서에 명시 |

## 8. 로드맵

| 순위 | 범위 |
|------|------|
| P1 | 서버 골격 + 인증/entitlement + `novelty_check` (teaser/full) + KB-1 초기 구축 |
| P2 | `methodology_advisor`, `checklist_map`, `integrity_report`+`verify_report` |
| P3 | `journal_fit`, `reviewer_playbook`, Watch 크론, Lab 티어 |
