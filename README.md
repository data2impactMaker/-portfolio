# 정한얼 — Data Analyst

> 분석을 액션으로 바꾸는 데이터 분석가

## 👉 [포트폴리오 바로 보기](https://data2impactmaker.github.io/-portfolio/)

---

## 포트폴리오 보는 법

이 레포지토리의 포트폴리오는 **단일 HTML 파일**로 제작되어 있으며, 별도 설치 없이 브라우저에서 바로 열 수 있습니다.

**네비게이션 바** — 스크롤하면 상단에 플로팅 네비게이션이 나타납니다. Analysis · Visualization · AI Usage 버튼을 클릭하면 드롭다운이 열리고, Part별 세부 프로젝트로 바로 이동할 수 있습니다.

**검색 기능** — `Ctrl + K` (Mac: `Cmd + K`)를 누르거나 상단의 검색 버튼을 클릭하면 검색창이 열립니다. 키워드를 입력하면 프로젝트명·분석 내용·도구명 등을 실시간으로 검색할 수 있어, 관심 있는 주제로 바로 이동할 수 있습니다. 추천 태그도 제공되니 활용해 보세요.

---

## About

쏘카(SOCAR) CGO 산하 플랫폼데이터팀에서 주차 비즈니스 데이터 분석을 담당하고 있습니다.

화려하고 복잡한 분석보다 **간결하고 직관적인 분석**으로 조직의 성과에 기여하는 것을 지향합니다. 최근에는 AI를 적극 활용하며, 풀어야 할 비즈니스 문제 자체에 더 집중하고 있습니다.

결과물은 **Analysis** · **Visualization** · **AI Usage** 세 카테고리로 구분하여 정리했습니다.

---

## Highlights

### 1. 미결제자 원인분석 — 결제전환율 상승 전략 도출
`Analysis` · `BigQuery` · `카이제곱 검정`

미결제/결제 유저군을 접속횟수 · 행동 데이터 · 인근 주차장 공급량 세 축으로 비교 분석하여 결제전환 저해 요인을 구조적으로 분리했습니다.

- 전체 미결제 유저의 80%가 접속 1~2회 신규유저 → 저회차 접속자 결제유도 타겟 선정
- 결제퍼널 주차권선택 단계에서 40.5%p Gap 발견 → UX 개선 포인트 특정
- 미결제유저의 구매가능 주차장 0~1개 비율이 약 1.8배 → 공급부족이 핵심 저해 요인임을 통계적으로 검증

### 2. 데이터기반 영업관리 프로세스 구축 → 대시보드 2차 고도화
`Analysis` · `BigQuery` · `Looker Studio`

프로세스 설계부터 통합 데이터셋, 액션 매트릭스, 모니터링 대시보드까지 일관된 체계를 구축하고, 현업 피드백을 반영해 **2차에 걸친 고도화**를 수행했습니다.

- 클릭/거래/매진 데이터를 통합하고 수요·공급 지표 기반 영업액션 자동화 체계 수립
- Weekday/Weekend 분리 분석으로 구체적 가격인상 근거 제공 (1차 고도화)
- 상권·주차장·유저행동·매출을 한 화면에서 확인 가능한 종합 분석 대시보드 완성 (2차 고도화)

### 3. 통계 기반 클릭/거래 이상치 탐지
`Analysis` · `Z-score`

Z-score 기반 이상치 탐지·분석 체계를 구축하여 수요 증가 및 이슈 대응 속도를 향상시켰습니다.

- 콘서트·스포츠 경기 등 고수요 이벤트 선제 발견
- 특가상품 과다판매 이슈 조기 탐지

### 4. 데이터업무 슬랙봇 설계 및 구축
`AI Usage` · `Claude Code` · `Slack Bolt` · `GCP Cloud Run`

현업 부서의 데이터업무 요청(추출·분석·해석·이벤트 설계)을 슬랙에서 AI로 자동 처리하는 봇을 구축했습니다.

- Slack Bolt + Claude API + Jira Cloud API를 GCP Cloud Run에 배포
- 데이터업무 요청을 자동 분류·처리·티켓 생성하여 반복 업무 제거

---

## Visualization

Looker Studio · Tableau · Google Sheets · Kepler.gl을 활용한 대시보드와 분석 리포트를 제작했습니다.

| 카테고리 | 대시보드 | 도구 |
|---------|---------|------|
| 성과 추적 | W-1 성과예측, 마케팅 실적 리포트, 자치구별 실적 | Looker Studio |
| 공급 관리 | 제휴일반, 판매중단 시설관리, 장기권 슬롯관리 | Looker Studio |
| 유저 상세 | 퍼널, 코호트 분석, 검색수요 지리공간 분석, 여의도 불꽃축제 동적 수요지도 | Looker Studio · Sheets · Tableau · Kepler.gl |

---

## AI Usage

Claude Code를 활용하여 분석 오케스트레이션 및 업무 자동화를 수행했습니다.

| 프로젝트 | 설명 |
|---------|------|
| BTS 광화문 콘서트 주차장 영향분석 | 카카오맵 API · BigQuery · 웹서칭을 오케스트레이션하여 IMPACT MAP 제작 |
| Airbridge 앱 설치 유입경로 분석 | BigQuery 데이터 추출·시각화로 채널별 인스톨 비중 및 캠페인 성과 분석 |
| 데이터업무 슬랙봇 | Slack Bolt + Claude API + Jira + GCP Cloud Run으로 데이터업무 자동화 |

---

## Tech Stack

**Query & Data** — BigQuery · SQL · Python · Google Sheets

**Visualization** — Looker Studio · Tableau · Kepler.gl

**AI & Automation** — Claude Code · Claude API · Slack Bolt

**Infra & API** — GCP Cloud Run · Jira Cloud API · Kakao Map API

---

## Contact

📧 data2impacts@gmail.com
