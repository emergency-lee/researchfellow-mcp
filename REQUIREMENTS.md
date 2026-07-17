# ResearchFellow MCP — Requirements v0.2 (2026-07-16 개정)

> 원격 강화 계층 + 텔레메트리 수집. **2026-07-16 정책: 전부 무료** — 모든 도구가
> 모든 호출자에게 full로 응답한다. 유료화는 언급하지 않으며 영구무료도 선언하지
> 않는다. 티어 구조는 휴면 상태로 보존(재활성화 이음매).
> 설계 근거: `../docs/business-model-mcp-plugin_2026-07-04.md` (경계 원칙),
> 2026-07-16 재설계 결정 (전부 무료 + 동의 기반 퍼널 텔레메트리).

## 0. 원칙

1. **PHI 불수신** — 입력 스키마 자체가 비식별 파생물만 받도록 설계. 방어선 2중:
   스키마 제한(구조적) + 서버측 감지 시 거부·무저장(런타임).
2. **전부 무료, 전부 full** — 미인증 포함 모든 호출자가 동일한 full 결과를 받는다.
   업그레이드 안내·티저 응답은 표시하지 않는다. (teaser 분기는 휴면 코드로 보존)
3. **모트는 갱신** — 도구 로직보다 뒤의 DB(문헌 인덱스·룰셋·저널 DB)가 자산.
   모든 지식 자산은 버전 태그를 갖고 응답에 명시된다.
4. **텔레메트리는 퍼널만** — 수집은 단계 번호·이벤트명·버전·익명 토큰뿐. 내용
   필드는 스키마에 존재 자체가 불가(`.strict()`). §9 참조.

## 1. 프로토콜 · 인증 · 과금

| ID | 요구사항 |
|----|---------|
| PR-1 | MCP Streamable HTTP 서버. Claude Code(`.mcp.json`)와 Claude Desktop connector 양쪽 호환 |
| PR-2 | 인증: OAuth 2.1 (MCP 표준 플로우) + API 키 병행(헤드리스/CI용) |
| PR-3 | **(2026-07-16 휴면)** 티어 enum(free/pass/pro)은 유지하되 현재 전원 free/full. 과금 티어 정의는 재활성화 시 재검토 |
| PR-4 | **(휴면)** Pass 미터링 인터페이스는 no-op 보존. 사용 통계는 §9 텔레메트리가 담당 |
| PR-5 | **(휴면)** 과금 연동 없음. entitlement 검증 구조만 보존 |
| PR-6 | **(폐지)** 업그레이드 안내 필드는 어떤 응답에도 포함하지 않는다 |

## 2. TL-B — Brain 도구군 (지식 자산)

**현재 정책 (2026-07-16 전원 무료): 모든 도구가 모든 호출자에게 `full`로 응답한다.**
아래 각 도구의 `teaser 출력` 스펙은 **휴면**이며(PR-3/PR-5), 과금 재개 시 재활성화되는
분기의 규격으로만 보존한다 — 현재 응답에는 사용되지 않는다.

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

## 8. TM — 텔레메트리 (2026-07-16 신설)

| ID | 요구사항 |
|----|---------|
| TM-1 | 일반 HTTP 라우트 `POST /api/token`(발급, consent:true 필수) / `DELETE /api/token`(철회 — 이벤트 행 삭제 + 토큰 revoked) / `POST /api/events`(배치 ≤50) — MCP 도구가 아님(미연동 유저도 수집되어야 하므로) |
| TM-2 | 모든 입력 스키마는 zod `.strict()` — 내용을 담을 수 있는 필드가 존재하지 않고, 알 수 없는 필드는 400으로 거부 (PH-1의 구조적 방어를 텔레메트리에 재적용) |
| TM-3 | 이벤트 8종: project_created / entry_point_selected / step_entered / step_completed / gate_approved / gate_rejected / gate_changes_requested / session_resumed. entry_point 도메인은 S1~S5 (S0 없음 — 재개는 session_resumed + 원래 진입점) |
| TM-4 | "멈춤"은 이벤트가 아니라 파생 지표 (step_entered 대비 step_completed 결손) |
| TM-5 | 서버는 sha256(token)만 저장 — 평문 토큰·요청 본문 무저장 (PH-3 정합) |
| TM-6 | 저장소 Neon Postgres (`migrations/001_telemetry.sql`, env `DATABASE_URL`). 미설정 시 503 — 클라이언트 유예 모드가 흡수 |
| TM-7 | 레이트리밋: 1차 Vercel WAF per-IP, 2차 인메모리(인스턴스 분할 한계 인지) |
| TM-8 | 텔레메트리 실패가 플러그인 워크플로우를 절대 차단하지 않는다 (NFR-2 확장) |
| TM-9 | 공개 프라이버시 고지(`web/privacy.html`, PH-4)에 수집/미수집 항목·철회 절차 명시 |

## 9. 로드맵

| 순위 | 범위 |
|------|------|
| ~~P1~~ | ~~서버 골격 + 인증/entitlement + novelty_check~~ (완료) |
| P2 | KB 갱신 파이프라인(저널 DB 확장·크론), OAuth 2.1, KB-1 임베딩 인덱스, `package_validate` |
| P3 | Watch 크론 + `watch_poll` |
