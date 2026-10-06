#!/usr/bin/env python3
"""검토용 자기완결 미리보기 생성. 썸네일을 base64로 내장한 사본을 만든다.

사용: python3 build/make_preview.py <출력 html> [--artifact]
  --artifact: DOCTYPE·html·head·body 래퍼를 제거한 아티팩트용 본문만 출력
"""
import base64
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

out_path = sys.argv[1]
artifact = "--artifact" in sys.argv
# --demo-base=<prefix>: 데모 링크 앞에 붙일 경로(로컬 뷰어용)
demo_base = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--demo-base=")), "")

html = open("index.html", encoding="utf-8").read()
cache = {}


def data_uri(path):
    if path not in cache:
        ext = os.path.splitext(path)[1].lower()
        mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
        cache[path] = "data:%s;base64,%s" % (mime, base64.b64encode(open(path, "rb").read()).decode())
    return cache[path]


# 아티팩트본은 이미지 파일을 함께 발행하므로 경로를 그대로 둔다. 로컬 뷰어본만 base64로 내장한다.
if not artifact:
    html = re.sub(r'src="(portfolio_images/thumbs/[^"]+|portfolio_images/notion/notion_00\.jpg)"',
                  lambda m: 'src="%s"' % data_uri(m.group(1)), html)


def srcs(m):
    files = m.group(1).split("|")
    return 'data-srcs="%s"' % "|".join(
        data_uri("portfolio_images/thumbs/" + os.path.splitext(os.path.basename(f))[0] + ".jpg") for f in files)


if not artifact:
    html = re.sub(r'data-srcs="([^"]+)"', srcs, html)
if demo_base:
    html = html.replace('data-demo="demos/', f'data-demo="{demo_base}demos/')

if artifact:
    head = re.search(r"<title>.*?</style>", html, re.S).group(0)
    head = head.replace("<title>정한얼 포트폴리오 | Data Analyst</title>", "<title>정한얼 포트폴리오</title>")
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    html = (head + "\n" + body).replace(".page{max-width:980px;margin:0 auto;padding:0 32px}",
                                        ".page{max-width:980px;margin:0 auto;padding-inline:32px}")

with open(out_path, "w", encoding="utf-8") as f:
    f.write(html)
print(out_path, len(html))
