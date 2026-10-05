#!/usr/bin/env python3
"""index.html 빌드 스크립트. 카드 데이터(CARDS)와 섹션 정의(SECTIONS)를 바꾸고 실행하면 ../index.html을 다시 만든다.

사용: python3 build/build_index.py
썸네일: portfolio_images/thumbs/<이름>.jpg (원본 notion 폴더에서 make_thumbs()로 생성)
"""
import html
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = "portfolio_images/notion"
THUMB = "portfolio_images/thumbs"
FULL = "portfolio_images/full"

# 썸네일 규칙. 기본(auto): 원본이 세로로 길지 않으면(높이/폭 1.6 이하) 전체를 축소해 담고,
# 세로로 길면 폭 전체의 16:10 창을 상단(또는 y 지정 위치)에서 자른다. mode로 강제할 수 있다.
THUMB_CROP = {
    "notion_25": {"y": 0.03}, "notion_17": {"y": 0.02},
}

# ── 섹션 정의 ─────────────────────────────────────────────
SECTIONS = [
    {
        "id": "ai",
        "label": "AI 자동화",
        "title": "AI 기반 CRM 업무 자동화",
        "color": "#e67e22",
        "intro": [
            "에이전틱 워크플로우 개발로 CRM 전 과정 자동화",
            "CRM 캠페인별 성과지표 정의 및 A/B 테스트 분석 자동화 포함",
            "시니어 마케터 1인 채용 없이 운영, 연 약 5,000만원 절감 효과",
        ],
        "parts": ["CRM 마케팅 자동화", "AI 활용 프로젝트"],
    },
    {
        "id": "decision",
        "label": "데이터 분석",
        "title": "데이터 기반 의사결정 체계 고도화",
        "color": "#1a56db",
        "intro": [
            "인과추론(DID·CUPED·회귀) 기반 본부 액션별 순효과 측정",
            "CRM 대시보드·대화형 슬랙봇 개발로 마케팅 분석 요청 95% 감축",
            "Action Item까지 도출하는 분석 리포팅 표준화로 본부 의사결정 가속화",
        ],
        "parts": ["캠페인 효과 측정", "유저 행동 분석", "영업 관리 분석", "사업 기획 분석"],
    },
    {
        "id": "infra",
        "label": "데이터 인프라",
        "title": "지표 체계 설계 및 분석 인프라 구축",
        "color": "#0f9d58",
        "intro": [
            "비즈니스 질문·가설 수립에서 출발하는 이벤트 로그 설계 프레임워크 구축",
            "BigQuery 데이터마트·Git 기반 지표 SSOT 구축으로 지표 정의 단일화",
            "분석 결과·의사결정 맥락 통합 저장소 구축으로 AI 분석 컨텍스트 고도화",
        ],
        "parts": ["지표 정의·데이터 인프라"],
    },
    {
        "id": "viz",
        "label": "대시보드",
        "title": "Visualization",
        "color": "#7c3aed",
        "intro": ["Looker Studio · Google Sheets · Tableau · Kepler.gl 기반 대시보드 및 분석 리포트"],
        "parts": ["성과 추적", "공급 관리", "유저 분석"],
    },
]

# ── 카드 데이터 ───────────────────────────────────────────
# id, sec, part, year, title, tool, rows[(라벨, 내용)], imgs[(파일, 캡션)], dark
CARDS = [
    # AI 자동화 ─────────────────────────────────
    dict(id="ai-crm-agent", sec="ai", part="CRM 마케팅 자동화", year="2026", tool="Claude Code · Braze",
         title="CRM 에이전틱 워크플로우 구축",
         rows=[("목적", "CRM 캠페인 기획·세팅·발송·성과분석 전 과정의 에이전틱 워크플로우 자동화"),
               ("결과", "사람은 기획 방향·기획안·공지글·발송 4개 게이트에서만 개입, 주간 종합 성과분석까지 에이전트가 자동 작성")],
         imgs=[("notion_2026_crm_swimlane.png", "스윔레인: 마케터는 4개 게이트에서만 결정, 에이전트가 BigQuery·Braze·Slack·GCS를 호출해 처리"),
               ("notion_2026_crm_workflow.png", "CRM 캠페인 발송 에이전틱 워크플로우: 3개 검수 포인트 외 자동 처리"),
               ("notion_2026_crm_onboarding.png", "CRM 에이전트 워크플로우 온보딩 가이드: 4단계 진행과 4개 컨펌 게이트"),
               ("notion_2026_crm_w36_auto.png", "에이전트가 자동 작성한 W36 CRM 캠페인 종합 성과분석")]),
    dict(id="ai-a3", sec="ai", part="AI 활용 프로젝트", year="2025", tool="Claude API · Slack Bolt · Cloud Run",
         title="데이터업무 슬랙봇 설계 및 구축",
         rows=[("목적", "데이터업무 요청(추출·분석·해석·이벤트 설계)을 슬랙에서 AI로 자동 처리하는 봇 구축"),
               ("결과", "Slack Bolt, Claude API, Jira Cloud API를 GCP Cloud Run에 배포하여 요청을 자동 분류·처리·티켓 생성")],
         imgs=[("notion_2025_databot_chat.png", "데이터 요청 접수 대화 예시: 요청 분류와 Jira 티켓 자동 생성"),
               ("notion_29_slackbot.png", "데이터업무 슬랙봇 설계서: AI 응답 시뮬레이션 및 시스템 아키텍처")]),
    dict(id="ai-a1", sec="ai", part="AI 활용 프로젝트", year="2026", tool="Claude Code · Kakao Map API",
         title="BTS 광화문 콘서트 주차장 영향분석",
         rows=[("목적", "콘서트 대비 인근 주차장 수용 가능량 사전 분석 및 수요 예측"),
               ("결과", "카카오맵 API·BigQuery·웹서칭을 오케스트레이션한 IMPACT MAP 제작, 영업팀 사전 대비에 활용")],
         imgs=[("notion_28_bts_impact.png", "IMPACT MAP (2026.03.28 공연일 기준)")], dark=True),
    dict(id="ai-fireworks", sec="ai", part="AI 활용 프로젝트", year="2026", tool="Claude Code · Cloudflare",
         title="여의도 불꽃축제 관람 명소와 주차 안내 웹",
         rows=[("목적", "축제 당일 관람 명소·교통 통제·주차 경로를 한 페이지로 안내하는 대고객 웹 제작"),
               ("결과", "수요 분석 결과를 안내 페이지로 옮겨 공개 배포, 모바일 우선 레이아웃 (라이브 페이지 체험 가능)")],
         demo=("https://www.modubiz.cloud/fireworks-guide/", "불꽃축제 주차 안내 웹", "external"),
         imgs=[("notion_2026_fireworks_web.png", "불꽃축제 안내 웹: 데스크톱 화면"),
               ("notion_2026_fireworks_mobile.png", "불꽃축제 안내 웹: 모바일 화면")]),

    # 의사결정 체계 ─────────────────────────────
    dict(id="dc-causal", sec="decision", part="캠페인 효과 측정", year="2026", tool="DID · CUPED · 회귀 보정",
         title="인과추론 기반 본부 액션별 순효과 측정",
         rows=[("목적", "공급 확대·상품 조정·CRM 캠페인·신규 기능 등 본부 액션의 순효과 측정"),
               ("결과", "실험군 대비 대조군 증분(%p)과 평시 기준선 대비 판정으로 자연 증분·외부 요인을 제외한 순효과 산출")],
         imgs=[("notion_2026_causal_4to6.png", "4~6월 앱푸시 캠페인 종합 증분: 방문은 늘고 결제는 그대로"),
               ("notion_2026_causal_optin.png", "마케팅 수신동의 유도 인앱 상세 성과분석: 실험군 대비 대조군 증분"),
               ("notion_2026_impact_standard.png", "고수요 외부이벤트 영향도 분석 표준: 수요 예측·공급 산정·판매 실행·성과 네 축 판정")]),
    dict(id="dc-moketer", sec="decision", part="캠페인 효과 측정", year="2026", tool="Claude API · Slack · Cloud Run",
         title="대화형 슬랙봇 '모케터'",
         rows=[("목적", "마케팅 데이터 추출·분석 요청의 대화형 처리와 캠페인 일정·성과 공유"),
               ("결과", "슬랙 질의응답·운영 대시보드·자동화가 같은 GCS 저장소를 보는 구조로 마케팅 분석 요청 95% 감축")],
         demo=("demos/moketer.html", "모케터 슬랙봇"),
         imgs=[("notion_2026_moketer_chat.png", "모케터 대화 예시: 주간 캠페인 성과 조회와 기획 배경 질의"),
               ("notion_2026_moketer_system.png", "모케터 시스템 정리: 슬랙 질의응답 4종·운영 대시보드 4종·자동 실행 4종"),
               ("notion_2026_moketer_arch.png", "아키텍처: Cloud Run 한 서비스에 질의응답·운영 화면·자동 실행"),
               ("notion_2026_slackbots.png", "슬랙봇 통합관리: 봇별 역할·실행 형태·주기")]),
    dict(id="dc-dashboard", sec="decision", part="캠페인 효과 측정", year="2026", tool="Flask · GCS · Cloud Run",
         title="CRM 캠페인 대시보드 (마케팅 허브)",
         rows=[("목적", "캠페인 기획·실행·분석 상태와 앱 배너 운영·퍼포먼스 마케팅 성과를 한 화면에서 운영"),
               ("결과", "캠페인 폴더의 기획서·세팅 가이드·분석 보고를 자동 인식해 캘린더·KPI에 표시, 슬랙봇과 같은 저장소를 참조")],
         demo=("demos/crm-dashboard.html", "CRM 캠페인 대시보드"),
         imgs=[("notion_2026_hub_dashboard.png", "CRM 캠페인 대시보드: 이번 주 추천 · 다음 발송 · KPI · 주차 그리드 (체험판 화면)"),
               ("notion_2026_hub_banner.png", "앱 배너 운영: 라이브 슬롯 · 지면별 노출 현황 (체험판 화면)"),
               ("notion_2026_hub_pm.png", "퍼포먼스 마케팅: 전환 퍼널 · 일별 추이 · 채널별 성과 (체험판 화면)"),
               ("notion_2026_moketer_storage.png", "저장소 구성: campaigns·knowledge·banners·approvals 경로별 용도")]),
    dict(id="project1a", sec="decision", part="유저 행동 분석", year="2025", tool="BigQuery",
         title="미결제/결제 유저군 간 접속횟수 비교분석",
         rows=[("목적", "결제전환율 상승을 위한 우선순위 미결제 세그먼트 도출"),
               ("결과", "전체 미결제 유저의 80%가 접속 1~2회 신규유저, 저회차 접속자 결제유도 타겟 선정")],
         imgs=[("notion_01.png", "결제 여부에 따른 접속횟수별 유저비중")]),
    dict(id="project1b", sec="decision", part="유저 행동 분석", year="2025", tool="BigQuery",
         title="미결제/결제 유저군 간 행동 데이터 비교분석",
         rows=[("목적", "미결제유저의 탐색기능 인지·활용 부족이 결제전환 저해 요인인지 검증"),
               ("결과", "미결제유저는 탐색은 활발하나 결제퍼널에서 급격히 이탈 (주차권선택 단계 40.5%p Gap)")],
         imgs=[("notion_02.png", "미결제/결제 유저군 간 행동 데이터 비교분석")]),
    dict(id="project1c", sec="decision", part="유저 행동 분석", year="2025", tool="BigQuery · 카이제곱 검정",
         title="검색장소 인근 구매가능 주차장 분석",
         rows=[("목적", "검색위치 대비 인근 구매가능 주차장 수 차이 검증 (카이제곱 검정)"),
               ("결과", "미결제유저의 구매가능 주차장 0~1개 비율이 약 1.8배, 공급부족이 결제전환 저해 요인")],
         imgs=[("notion_03.png", "결제 vs 미결제 유저군 도넛차트 / 카이제곱 검정 결과")]),
    dict(id="project2a", sec="decision", part="영업 관리 분석", year="2025", tool="BigQuery",
         title="영업관리 프로세스 구축",
         rows=[("목적", "데이터기반 체계적이고 효율적인 영업관리 프로세스 구축"),
               ("결과", "영업단 자율적 판단 및 리서치를 위한 데이터 기반 프로세스 체계 완성")],
         imgs=[("notion_05.png", "Sales Process 영업관리 프로세스")]),
    dict(id="project2b", sec="decision", part="영업 관리 분석", year="2025", tool="BigQuery · Looker Studio",
         title="통합 데이터셋 구축 및 액션 매트릭스 수립",
         rows=[("목적", "영업관리와 자동화 추적 대시보드 제작을 위한 기반 마련"),
               ("결과", "클릭/거래/매진 데이터 통합 및 수요·공급 지표 기반 영업액션 자동화 체계 수립")],
         imgs=[("notion_06.png", "통합 데이터셋"), ("notion_07.png", "액션 매트릭스"),
               ("notion_08.png", "수량·가격 인상 현황: 매진추이 Weekly 모니터링")]),
    dict(id="project2c", sec="decision", part="영업 관리 분석", year="2025", tool="Looker Studio",
         title="액션제안 및 모니터링 대시보드 제작",
         rows=[("목적", "영업 액션(수량·가격 변경)의 효과를 추적하고 신규 액션을 제안하는 대시보드 제작"),
               ("결과", "주차권 수량·가격 변경 전후 거래건수·거래액 변화를 실시간 모니터링하는 체계 구축")],
         imgs=[("notion_09.png", "주차권수량 변경 전후 거래건수·거래액 추이 / 상품가격 변경 전후 거래액 추이")], dark=True),
    dict(id="project2d", sec="decision", part="영업 관리 분석", year="2025", tool="Looker Studio",
         title="액션제안 대시보드 1차 고도화",
         rows=[("목적", "인근대비 상대우위 지표 추가로 제안 수용률 증대"),
               ("결과", "Weekday/Weekend 분리 분석으로 구체적 가격인상 근거 제공")],
         imgs=[("notion_10.png", "가격인상 주차권: Weekday / Weekend 분석")], dark=True),
    dict(id="project2e", sec="decision", part="영업 관리 분석", year="2025", tool="Looker Studio",
         title="액션제안 대시보드 2차 고도화",
         rows=[("목적", "상품제안 대상 주차장 포함 상권의 종합적 분석자료 제공으로 제안 수용률 극대화"),
               ("결과", "상권·주차장·유저행동·매출 현황을 한 화면에서 확인 가능한 종합 분석 대시보드 완성")],
         imgs=[("notion_11.png", "Sales Analysis: 상권 종합 분석 대시보드")], dark=True),
    dict(id="project3a", sec="decision", part="사업 기획 분석", year="2025", tool="BigQuery · Simulation",
         title="첫결제 프로모션 쿠폰 최적 지급조건 설계",
         rows=[("목적", "첫결제 전환 극대화 및 Organic 유저 쿠폰사용 최소화 지급조건 도출"),
               ("결과", "약 1,500만원 잠재 GP Loss 방지에 기여")],
         imgs=[("notion_12.png", "첫결제분석: 가입후시간 Simulation")]),
    dict(id="project3b", sec="decision", part="사업 기획 분석", year="2025", tool="BigQuery · Simulation",
         title="신규주차장 사업계획 달성 시나리오 도출",
         rows=[("목적", "사업계획 달성을 위한 주요 레버별 달성 목표치 도출"),
               ("결과", "25년 상반기 사업계획 미달분 보완을 위한 구체적 목표와 수단 시나리오 수립")],
         imgs=[("notion_13.png", "사업계획 달성 Simulation")]),
    dict(id="project3c", sec="decision", part="사업 기획 분석", year="2025", tool="Z-score",
         title="통계 기반 클릭/거래 이상치 탐지 및 원인 분석",
         rows=[("목적", "Z-score 기반 이상치 탐지·분석으로 수요증가 및 이슈대응 속도 향상"),
               ("결과", "콘서트·스포츠 경기 등 고수요 이벤트와 특가상품 과다판매 이슈를 선제 탐지")],
         imgs=[("notion_14.png", "Z-score ≥ 7 조건 고수요 탐지 / Z-score < -3 조건 이슈 발견"),
               ("notion_15.png", "클릭/거래 이상치 상세: 실적 그래프 및 Z-score")]),

    # 지표·인프라 ───────────────────────────────
    dict(id="if-eventlog", sec="infra", part="지표 정의·데이터 인프라", year="2026", tool="GA4 · Claude Code",
         title="이벤트 로그 설계 프레임워크",
         rows=[("목적", "비즈니스 질문·가설 수립에서 출발하는 이벤트 로그 설계 표준 수립"),
               ("결과", "정책서·피그마 유저플로우 입력으로 KPI·비즈니스 질문·화면×이벤트·등록안을 표준 양식으로 산출하고 확인 필요 항목만 회신")],
         imgs=[("notion_2026_ga_request.png", "GA 설계 요청서: 자료 링크만으로 설계안 생성, 알 수 없는 것만 확인 필요로 회신"),
               ("notion_2026_draw_taxonomy.png", "드로우이벤트 GA 텍소노미 설계안: KPI·비즈니스 질문·측정 방식 체계")]),
    dict(id="if-ssot", sec="infra", part="지표 정의·데이터 인프라", year="2026", tool="BigQuery · GitHub",
         title="데이터마트·Git 기반 지표 SSOT",
         rows=[("목적", "부서·리포트마다 달랐던 지표·이벤트 정의의 단일화"),
               ("결과", "BigQuery 데이터마트와 Git 저장소(이벤트 마스터 YAML·값 체계·lint)로 정의 등록부터 배포까지 한 경로로 통일")],
         imgs=[("notion_2026_atlas.png", "modu-data-AX 관리 지도: 데이터 기반·실행·운영 규칙 3층 구조"),
               ("notion_2026_atlas_ssot.png", "이벤트 SSOT: 마스터 YAML 134건·값 체계·자동 lint·등록 흐름")]),
    dict(id="if-gcs", sec="infra", part="지표 정의·데이터 인프라", year="2026", tool="GCS · Claude Code",
         title="CRM 분석·의사결정 통합 저장소",
         rows=[("목적", "분석 결과와 의사결정 맥락을 AI 에이전트가 직접 참조하는 구조 구축"),
               ("결과", "GCS 버킷에 캠페인·지식·승인 기록을 적재하고 슬랙봇·대시보드·에이전트가 같은 원천을 읽는 컨텍스트 체계 구축")],
         imgs=[("notion_2026_moketer_storage.png", "CRM 저장소 구성: campaigns·knowledge·banners·approvals 경로별 용도"),
               ("notion_2026_atlas_buckets.png", "GCS 버킷 지도: 상태가 사는 곳과 자동 게이트·감시망")]),

    # Visualization ────────────────────────────
    dict(id="viz-v1a", sec="viz", part="성과 추적", year="2025", tool="Looker Studio",
         title="W-1(저번주) 성과예측 대시보드",
         rows=[("목적", "전체 주차장의 심층적 일정별 성과를 지표로 수치 확인"),
               ("활용", "주차장별 기여치를 매주 자동 집계하여 반복 리포팅 업무 대체")],
         imgs=[("notion_17.png", "ParkingZone Demand Dashboard: 지도 기반 수요 시각화")], dark=True),
    dict(id="viz-v1b", sec="viz", part="성과 추적", year="2025", tool="Looker Studio",
         title="마케팅 실적 리포트",
         rows=[("목적", "마케팅 부서의 실시간 실적 리포팅 자동화"),
               ("활용", "마케팅 부서에서 Weekly 운영현황을 실시간 조회하여 의사결정에 활용")],
         imgs=[("notion_18.png", "모두의주차장 운영현황: Weekly 리포트")], dark=True),
    dict(id="viz-v1c", sec="viz", part="성과 추적", year="2025", tool="Looker Studio",
         title="공유주차 서비스 자치구별 실적 대시보드",
         rows=[("목적", "공유사업본 주요 자치구별 실적을 한 곳에서 실시간 파악"),
               ("활용", "자치구별 실적·예약·충결 비중을 일괄 모니터링하여 지역별 사업 의사결정에 활용")],
         imgs=[("notion_19.png", "공유 자치구별 실적 대시보드")], dark=True),
    dict(id="viz-v2a", sec="viz", part="공급 관리", year="2025", tool="Looker Studio",
         title="제휴일반 대시보드",
         rows=[("목적", "제휴 주차장의 공급 현황 및 시간대별 마감 추이를 한 곳에서 파악"),
               ("활용", "공급/구매가능/미가동 현황과 SoldOut 추이를 확인하여 재고·가격 관리에 활용")],
         imgs=[("notion_20.png", "제휴일반: Key Index / SoldOut Trend / Heatmap & SoldOutRank")], dark=True),
    dict(id="viz-v2b", sec="viz", part="공급 관리", year="2025", tool="Looker Studio",
         title="판매중단 시설관리 대시보드",
         rows=[("목적", "판매중단 시설의 복구·관리 프로세스 자동화"),
               ("활용", "Long/Short Term 유형별로 판매중단 시설을 분류하여 복구 우선순위 관리에 활용")],
         imgs=[("notion_21.png", "Sales Off Partner: Long Term / Short Term 관리")], dark=True),
    dict(id="viz-v2c", sec="viz", part="공급 관리", year="2025", tool="Looker Studio",
         title="장기권 슬롯관리 대시보드",
         rows=[("목적", "제한된 정기권 슬롯 활용 극대화"),
               ("활용", "잔여슬롯을 파악하여 쏘카존 배치, 비연장기관 판매제안 등 자산 운용에 활용")],
         imgs=[("notion_22.png", "정기권 주차가능 현황: 주차가능현장 1,494 / 주차가능수량 26,333")], dark=True),
    dict(id="viz-v3a", sec="viz", part="유저 분석", year="2025", tool="Looker Studio",
         title="퍼널 대시보드",
         rows=[("목적", "주요 퍼널별 전환율 시각화를 통한 제품개선 인사이트 도출"),
               ("활용", "Total/iOS/AOS별 풀 퍼널 및 BM별 주요 퍼널을 실시간 모니터링하여 제품개선에 활용")],
         imgs=[("notion_23.png", "풀 퍼널: Total / iOS / AOS"), ("notion_24.png", "주요 퍼널 by BM")], dark=True),
    dict(id="viz-v3b", sec="viz", part="유저 분석", year="2025", tool="Google Sheets",
         title="신규가입유저 코호트 분석 리포트",
         rows=[("목적", "신규가입유저의 코호트별 주요 금액자료 확인을 통한 잔존 이해도 향상"),
               ("활용", "코호트별 전환율/기여도/잔존율을 비교하여 유저 잔존 전략 수립에 활용")],
         imgs=[("notion_25.png", "전환율 / 기여도 / 잔존율 / 관측값: 신규가입유저 코호트 분석")]),
    dict(id="viz-v3c-tab", sec="viz", part="유저 분석", year="2025", tool="Tableau · Kakao Map API",
         title="미결제 유저 검색수요 지리공간 분석",
         rows=[("목적", "카카오맵 API 역지오코딩으로 검색위치 주소 변환 (검색 이벤트 로깅 시 주소 미수집)"),
               ("활용", "미결제 유저 검색 집중 지역을 파악하여 영업(주차장 확보) 및 마케팅(유저 넛지)에 활용")],
         imgs=[("notion_04.png", "지역별 검색장소 데이터 / 검색 키워드 순위")]),
    dict(id="viz-v3c", sec="viz", part="유저 분석", year="2025", tool="Kepler.gl",
         title="여의도 불꽃축제 동적 수요지도",
         rows=[("목적", "동적 수요의 변화 양상 및 분포 분석을 통한 공급 확대 및 최적화 전략 수립"),
               ("활용", "오전 지도로 여의도 내 수요 집중 지점을, 오후 지도로 동작·용산·노량진 수요 분산을 파악하여 공급 전략에 활용")],
         imgs=[("notion_26.png", "오전 수요지도: 여의도 내 수요 집중 지점"), ("notion_27.png", "오후 수요지도: 인근 동작·용산·노량진 수요 분산")]),
]

E = html.escape


def thumb(fname):
    return f"{THUMB}/{os.path.splitext(fname)[0]}.jpg"


def full(fname):
    return f"{FULL}/{os.path.splitext(fname)[0]}.jpg"


def render_card(c):
    sec = next(s for s in SECTIONS if s["id"] == c["sec"])
    imgs = c["imgs"]
    if imgs:
        first = imgs[0][0]
        srcs = "|".join(full(f) for f, _ in imgs)
        caps = "|".join(E(cap) for _, cap in imgs)
        count = f'<span class="thumb-count">{len(imgs)}장</span>' if len(imgs) > 1 else ""
        dark = " dark" if c.get("dark") else ""
        media = (f'<div class="thumb{dark}" data-srcs="{srcs}" data-caps="{caps}" onclick="openLightbox(this)">'
                 f'<img src="{thumb(first)}" alt="{E(c["title"])}" loading="lazy">{count}'
                 f'<div class="thumb-cap">{E(imgs[0][1])}</div></div>')
    else:
        media = '<div class="thumb thumb-empty"><span>스크린샷 준비 중</span></div>'
    rows = "".join(
        f'<div class="sum-row"><span class="sum-label">{E(l)}</span><span class="sum-value">{E(t)}</span></div>'
        for l, t in c["rows"])
    demo = ""
    if c.get("demo"):
        src, label = c["demo"][0], c["demo"][1]
        if len(c["demo"]) > 2 and c["demo"][2] == "external":
            demo = (f'<a class="demo-btn" href="{src}" target="_blank" rel="noopener">'
                    f'<svg viewBox="0 0 12 12" fill="currentColor"><path d="M2 1l8 5-8 5z"/></svg>{E(label)} 라이브 열기</a>')
        else:
            demo = (f'<button class="demo-btn" data-demo="{src}" data-title="{E(label)}" onclick="openDemo(this)">'
                    f'<svg viewBox="0 0 12 12" fill="currentColor"><path d="M2 1l8 5-8 5z"/></svg>{E(label)} 체험하기</button>')
    year_cls = "tag-year new" if c["year"] == "2026" else "tag-year"
    return f'''<article class="card" id="{c["id"]}" data-sec="{sec["label"]}" data-part="{E(c["part"])}" data-title="{E(c["title"])}" data-year="{c["year"]}">
  {media}
  <div class="card-body">
    <div class="card-meta"><span class="{year_cls}">{c["year"]}</span><span class="tag-tool">{E(c["tool"])}</span></div>
    <h3 class="card-title">{E(c["title"])}</h3>
    <div class="card-summary">{rows}</div>{demo}
  </div>
</article>'''


def render_section(s):
    cards = [c for c in CARDS if c["sec"] == s["id"]]
    intro = "".join(f"<li>{E(t)}</li>" for t in s["intro"])
    out = [f'<section class="sec" id="{s["id"]}" data-sec="{s["id"]}">',
           f'<div class="sec-head"><div class="sec-label" style="color:{s["color"]}">{E(s["label"])}</div>'
           f'<h2 class="sec-title">{E(s["title"])}</h2><ul class="sec-intro">{intro}</ul></div>']
    for p in s["parts"]:
        pc = [c for c in cards if c["part"] == p]
        if not pc:
            continue
        out.append(f'<div class="part-head"><span class="part-title">{E(p)}</span><span class="part-count">{len(pc)}</span></div>')
        out.append('<div class="grid">' + "\n".join(render_card(c) for c in pc) + "</div>")
    out.append("</section>")
    return "\n".join(out)


def render_nav(prefix):
    btns = []
    for s in SECTIONS:
        items = []
        for p in s["parts"]:
            pc = [c for c in CARDS if c["sec"] == s["id"] and c["part"] == p]
            if not pc:
                continue
            items.append(f'<div class="vd-group">{E(p)}</div>')
            items += [f'<a class="vd-item" data-target="{c["id"]}">{E(c["title"])}</a>' for c in pc]
        btns.append(f'''<div class="viz-wrap">
  <button class="nav-btn" id="{prefix}{s["id"]}Toggle" data-section="{s["id"]}">{E(s["label"])} <span class="caret">&#9662;</span></button>
  <div class="viz-dropdown" id="{prefix}{s["id"]}Dropdown"><div class="vd-panel">{"".join(items)}</div></div>
</div>''')
    return "\n".join(btns)


TEMPLATE = open(os.path.join(ROOT, "build", "template.html"), encoding="utf-8").read()


def build():
    out = (TEMPLATE
           .replace("{{FLOAT_NAV}}", render_nav("fn-"))
           .replace("{{COVER_NAV}}", render_nav("cv-"))
           .replace("{{SECTIONS}}", "\n\n".join(render_section(s) for s in SECTIONS))
           .replace("{{SECTION_IDS}}", ",".join(f"'{s['id']}'" for s in SECTIONS))
           .replace("{{CARD_COUNT}}", str(len(CARDS))))
    with open(os.path.join(ROOT, "index.html"), "w", encoding="utf-8") as f:
        f.write(out)
    print(f"index.html written: {len(CARDS)} cards, {len(out):,} bytes")


def make_thumbs():
    from PIL import Image
    import glob
    os.makedirs(os.path.join(ROOT, THUMB), exist_ok=True)
    os.makedirs(os.path.join(ROOT, FULL), exist_ok=True)
    used = {os.path.splitext(f)[0] for c in CARDS for f, _ in c["imgs"]}
    for f in sorted(glob.glob(os.path.join(ROOT, IMG, "notion_*"))):
        name = os.path.splitext(os.path.basename(f))[0]
        if name not in used:
            continue
        im = Image.open(f).convert("RGB")
        w, h = im.size
        # 라이트박스용: 원본 비율 유지, 최대 폭 1400
        fw = min(w, 1400)
        im.resize((fw, int(h * fw / w)), Image.LANCZOS).save(os.path.join(ROOT, FULL, name + ".jpg"), quality=80, optimize=True)
        # 썸네일
        spec = THUMB_CROP.get(name, {})
        mode = spec.get("mode") or ("contain" if h / w <= 1.6 else "cover")
        if mode == "contain":
            # 배경은 원본 가장자리 평균색으로 맞춰 어두운 대시보드도 자연스럽게 담는다
            small = im.resize((64, 64))
            edge = [small.getpixel((x, y)) for x in range(64) for y in (0, 63)] + [small.getpixel((x, y)) for y in range(64) for x in (0, 63)]
            bg = tuple(sum(c[i] for c in edge) // len(edge) for i in range(3))
            canvas = Image.new("RGB", (720, 450), bg)
            fit = im.copy()
            fit.thumbnail((690, 420), Image.LANCZOS)
            canvas.paste(fit, ((720 - fit.size[0]) // 2, (450 - fit.size[1]) // 2))
            canvas.save(os.path.join(ROOT, THUMB, name + ".jpg"), quality=82, optimize=True)
            continue
        cw = int(min(w, spec.get("w", w)))
        ch = int(cw * 10 / 16)
        if ch > h:
            ch = h
            cw = int(min(w, ch * 16 / 10))
        x0 = int(min(max(0, spec.get("x", 0.0)) * w, w - cw))
        y0 = int(min(max(0, spec.get("y", 0.0)) * h, h - ch))
        im = im.crop((x0, y0, x0 + cw, y0 + ch))
        im = im.resize((720, int(720 * im.size[1] / im.size[0])), Image.LANCZOS)
        im.save(os.path.join(ROOT, THUMB, name + ".jpg"), quality=82, optimize=True)


if __name__ == "__main__":
    if "--thumbs" in sys.argv:
        make_thumbs()
    build()
