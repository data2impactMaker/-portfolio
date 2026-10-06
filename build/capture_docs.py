#!/usr/bin/env python3
"""원본 문서(HTML)를 민감 문자열 블러 처리 후 헤드리스 크롬으로 캡처한다.

사용: python3 build/capture_docs.py
출력: portfolio_images/notion/notion_2026_<이름>.png
원본 문서 경로는 로컬 작업 폴더 기준이며 리포에는 포함하지 않는다.
"""
import os
import re
import subprocess
import tempfile
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.expanduser("~/Desktop/클로드/1_업무")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT = os.path.join(ROOT, "portfolio_images", "notion")

# 이름 → (원본 상대경로, 앵커, 폭, 높이)
SHOTS = {
    "crm_workflow": ("분석/crm_campaign_workflow.html", None, 1400, 1100),
    "crm_onboarding": ("분석/마케팅분석/CRM/onboarding_crm-workflow_260618.html", None, 1400, 1100),
    "crm_w36_auto": ("분석/마케팅분석/CRM/report_W36종합_자동_260913.html", None, 1400, 1100),
    "causal_4to6": ("분석/마케팅분석/CRM/report_4-6월캠페인종합증분_260707.html", None, 1400, 1100),
    "causal_optin": ("분석/마케팅분석/CRM/report_마케팅수신동의유도_260727.html", None, 1400, 1100),
    "impact_standard": ("분석/영향도분석/이벤트영향도분석_표준포맷.html", None, 1400, 1100),
    "moketer_system": ("AI 마케팅/agents/모케터_시스템_정리.html", None, 1400, 1100),
    "moketer_arch": ("AI 마케팅/agents/모케터_시스템_정리.html", "s2", 1400, 1100),
    "moketer_storage": ("AI 마케팅/agents/모케터_시스템_정리.html", "s2", 1400, 1600),
    "slackbots": ("레퍼런스/슬랙봇_통합관리.html", None, 1400, 1100),
    "ga_request": ("AI/업무효율화/이벤트_GA_텍소노미_설계_표준.html", None, 1400, 1100),
    "draw_taxonomy": ("분석/마케팅분석/드로우이벤트_텍소노미/드로우이벤트_GA_텍소노미_설계안.html", None, 1400, 1100),
    "atlas": ("AI/업무효율화/modu-data-AX_관리지도.html", None, 1400, 1100),
    "atlas_ssot": ("AI/업무효율화/modu-data-AX_관리지도.html", "s5", 1400, 1100),
    "atlas_buckets": ("AI/업무효율화/modu-data-AX_관리지도.html", "s7", 1400, 1100),
}

# 블러 대상: 인프라 식별자·연락처·닉네임. 텍스트 노드에만 적용한다.
SENSITIVE = [
    r"gs://[^\s<]+",
    r"https?://[^\s<]+",
    r"[\w.-]+\.(?:a\.)?run\.app",
    r"moduparking[\w.-]*",
    r"[\w-]+-html-viewer",
    r"litellm[\w.-]*",
    r"socar[\w.-]*",
    r"asia-northeast3[\w.-]*",
    r"[\w.+-]+@[\w-]+\.[\w.]+",
    r"\b[CDU]0[A-Z0-9]{8,10}\b",
    r"\b(?:darnell|isco|ivar|ina)\b",
    r"다넬|아이바|이스코|이나(?=[\s·,)]|$)",
    r"[\w-]+-(?:secret|token|client-id|signing-secret)\b",
]
RX = re.compile("|".join(f"(?:{p})" for p in SENSITIVE))
STYLE = "<style>.rx{filter:blur(5px);user-select:none}</style>"


def redact(html):
    parts = re.split(r"(<script\b.*?</script>|<style\b.*?</style>|<[^>]+>)", html, flags=re.S | re.I)
    out = []
    for p in parts:
        if p.startswith("<"):
            out.append(p)
        else:
            out.append(RX.sub(lambda m: f'<span class="rx">{m.group(0)}</span>', p))
    html = "".join(out)
    return html.replace("</head>", STYLE + "</head>", 1) if "</head>" in html else STYLE + html


def main():
    tmp = tempfile.mkdtemp(prefix="capture_")
    for name, (rel, anchor, w, h) in SHOTS.items():
        src = os.path.join(DOCS, rel)
        html = open(src, encoding="utf-8", errors="replace").read()
        red = os.path.join(tmp, name + ".html")
        open(red, "w", encoding="utf-8").write(redact(html))
        url = "file://" + urllib.parse.quote(red)
        if anchor:
            wrap = os.path.join(tmp, name + "_wrap.html")
            open(wrap, "w").write(
                f'<!doctype html><html><body style="margin:0"><iframe src="{url}#{anchor}" '
                f'style="border:0;width:{w}px;height:{h}px"></iframe></body></html>')
            url = "file://" + urllib.parse.quote(wrap)
        out = os.path.join(OUT, f"notion_2026_{name}.png")
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        "--allow-file-access-from-files", "--virtual-time-budget=6000",
                        f"--window-size={w},{h}", f"--screenshot={out}", url],
                       capture_output=True, text=True, timeout=120)
        print(name, os.path.getsize(out) if os.path.exists(out) else "FAILED")


if __name__ == "__main__":
    main()
