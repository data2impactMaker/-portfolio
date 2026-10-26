/* ============================================================
   신규 최상위 뷰 — 앱 배너 운영 / 퍼포먼스 마케팅  (views_ext.js)

   - 뷰 전환: 캠페인(기존) | 앱 배너 | 퍼포먼스 마케팅 (?view= 딥링크)
   - 배너: /api/banners (GCS SSOT) + /api/banner-clicks (GA4 export)
   - 퍼마: /api/pm-report, /api/pm-creatives (에어브릿지 Actuals API)
   - 차트·표: tableau-theme (TL.chart / TL.heatTable), Vega-Lite는 지연 로드
   ============================================================ */
(function () {
  'use strict';

  var VX = {
    view: 'crm',
    reg: null,            // 배너 레지스트리
    clicks: null,         // 배너 클릭 (GA4)
    week: null,           // 보드에 표시 중인 주차 키 "2026-W29"
    dirty: false,         // 레지스트리 로컬 수정 여부
    pm: { from: null, to: null, data: null, period: 'lw', nDays: 7, crSort: null, crPage: 1, crSize: 20,
          pick: { cur: null, draft: null },   // 기간 선택기 상태
          crFilter: 'all' },
    bannerLoaded: false, pmLoaded: false,
    ckSt: { cur: null, draft: null },   // 배너 클릭 성과 기간 선택기 상태
    rotTimers: []   // 순환 타이머 핸들 — 지면보드/미리보기 렌더 순서와 무관하게 항상 존재해야 함
  };

  // ───────────────────── 공통 유틸 ─────────────────────
  function $id(s) { return document.getElementById(s); }
  function esc(s) {
    return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtN(v) { if (v == null || isNaN(v)) return '-'; return Math.round(v).toLocaleString(); }
  function fmtW(v) { if (v == null || isNaN(v)) return '-'; return '₩' + Math.round(v).toLocaleString(); }
  function fmtP(v, d) { if (v == null || isNaN(v)) return '-'; return (+v).toFixed(d == null ? 1 : d) + '%'; }
  function kstToday() {
    var d = new Date(Date.now() + 9 * 3600 * 1000);
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  // ISO 주차: 목요일 기준
  function isoWeekKey(d) {
    var t = new Date(d.getTime());
    t.setHours(0, 0, 0, 0);
    t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
    var w1 = new Date(t.getFullYear(), 0, 4);
    var wn = 1 + Math.round(((t - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
    return t.getFullYear() + '-W' + String(wn).padStart(2, '0');
  }
  function weekMonday(key) {
    var m = /^(\d{4})-W(\d{2})$/.exec(key);
    if (!m) return null;
    var y = +m[1], w = +m[2];
    var jan4 = new Date(y, 0, 4);
    var mon = new Date(jan4.getTime());
    mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (w - 1) * 7);
    return mon;
  }
  function weekShift(key, n) {
    var mon = weekMonday(key);
    if (!mon) return key;
    mon.setDate(mon.getDate() + n * 7);
    return isoWeekKey(mon);
  }
  function weekLabel(key) {
    var mon = weekMonday(key);
    if (!mon) return key;
    return key.replace(/^\d{4}-/, '') + ' (' + (mon.getMonth() + 1) + '/' + mon.getDate() + ' 시작)';
  }

  // Vega-Lite 지연 로드 — self-host 번들(/static/vendor) + 타임아웃 (CDN·네트워크 의존 제거)
  var _vegaP = null;
  function ensureVega() {
    if (_vegaP) return _vegaP;
    var urls = [
      'static/vendor/vega.min.js',
      'static/vendor/vega-lite.min.js',
      'static/vendor/vega-embed.min.js'
    ];
    _vegaP = urls.reduce(function (p, u) {
      return p.then(function () {
        return new Promise(function (res, rej) {
          var s = document.createElement('script');
          var t = setTimeout(function () { rej(new Error('script timeout: ' + u)); }, 12000);
          s.src = u;
          s.onload = function () { clearTimeout(t); res(); };
          s.onerror = function () { clearTimeout(t); rej(new Error('script error: ' + u)); };
          document.head.appendChild(s);
        });
      });
    }, Promise.resolve());
    _vegaP.catch(function () { _vegaP = null; }); // 실패 시 다음 시도에서 재로드
    return _vegaP;
  }

  function fetchJson(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'HTTP ' + r.status }; });
    });
  }

  // ── 표 페이지 나누기 (배너 운영 목록·클릭 성과 표 공용) ──────────
  // 등록이 100건을 넘어 한 표에 다 펴면 스크롤만 길어지고, 아래 카드가 밀려 무엇이 더
  // 있는지도 안 보인다. 한 쪽씩 끊어 보여 주고 표 아래에 페이저 한 줄을 둔다.
  function pageSlice(list, page, size) {
    var total = list.length;
    var pages = Math.max(1, Math.ceil(total / size));
    var p = Math.min(Math.max(1, page || 1), pages);
    var off = (p - 1) * size;
    return { rows: list.slice(off, off + size), page: p, pages: pages,
             total: total, offset: off, size: size };
  }
  // 번호는 처음·끝·현재 앞뒤 한 칸만 펴고 나머지는 접는다 — 쪽이 늘어도 한 줄을 안 넘는다.
  function pageNums(cur, pages) {
    var out = [];
    for (var i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - cur) <= 1) out.push(i);
      else if (out[out.length - 1] !== '…') out.push('…');
    }
    return out;
  }
  // 번호만 있으면 총량 감각이 사라진다 — '몇 개 중 어디' 를 왼쪽에 먼저 적는다.
  // sizes = 한 번에 볼 개수 후보(작은 것부터). 가장 작은 값으로도 한 페이지에 다 들어가면
  // 페이저를 아예 그리지 않는다 — 고를 것도 넘길 것도 없는 줄이 남지 않게.
  function pagerHtml(sl, sizes) {
    sizes = sizes || [sl.size];
    if (sl.total <= sizes[0]) return '';
    var nums = pageNums(sl.page, sl.pages).map(function (n) {
      return (n === '…') ? '<span class="vx-pg-gap">…</span>'
        : '<button type="button" class="vx-pg-n' + (n === sl.page ? ' on' : '') +
          '" data-pg="' + n + '"' + (n === sl.page ? ' aria-current="page"' : '') + '>' + n + '</button>';
    }).join('');
    return '<div class="vx-pager">' +
      '<div class="vx-pg-info"><b>' + fmtN(sl.offset + 1) + '-' + fmtN(sl.offset + sl.rows.length) +
      '</b> / ' + fmtN(sl.total) + '개</div>' +
      '<div class="vx-pg-ctl">' +
      '<button type="button" class="vx-pg-b" data-pg="prev"' + (sl.page <= 1 ? ' disabled' : '') +
      ' aria-label="이전 페이지">‹</button>' + nums +
      '<button type="button" class="vx-pg-b" data-pg="next"' + (sl.page >= sl.pages ? ' disabled' : '') +
      ' aria-label="다음 페이지">›</button></div>' +
      '<label class="vx-pg-size"><select class="vx-select" aria-label="한 번에 볼 개수">' +
      sizes.map(function (n) {
        return '<option value="' + n + '"' + (n === sl.size ? ' selected' : '') + '>' + n + '개씩</option>';
      }).join('') + '</select></label>' +
      '</div>';
  }
  function bindPager(host, sl, onPage, onSize) {
    if (!host) return;
    host.querySelectorAll('.vx-pager [data-pg]').forEach(function (b) {
      b.onclick = function () {
        var v = b.dataset.pg;
        var p = (v === 'prev') ? sl.page - 1 : (v === 'next') ? sl.page + 1 : +v;
        if (p < 1 || p > sl.pages || p === sl.page) return;
        onPage(p);
      };
    });
    var sel = host.querySelector('.vx-pager .vx-pg-size select');
    if (sel && onSize) sel.onchange = function () { onSize(+sel.value); };
  }
  // 쪽을 넘겼는데 표 머리가 화면 위로 벗어나 있으면 어디를 보는지 알 수 없다 — 카드 위로 되돌린다.
  function scrollToCard(el) {
    var card = (el && el.closest) ? el.closest('.vx-card') : null;
    if (card && card.getBoundingClientRect().top < 0) {
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ── 헤더 「수정 필요」 칩 (배너 운영) ─────────────────────────
  // CRM 뷰의 칩(campaign_rules.js mountSummary)과 같은 모양·같은 동작. 건수와 갈래만
  // 조용히 알리고, 누르면 목록이 열리고, 항목을 누르면 그 배너 편집으로 바로 간다.
  function renderBannerIssues() {
    var host = $id('bn-summary');
    if (!host) return;
    var items = VX._issues || [];
    if (!items.length) { host.innerHTML = ''; return; }
    var by = {};
    items.forEach(function (it) { by[it.kind] = (by[it.kind] || 0) + 1; });
    var kinds = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
    host.innerHTML = '<button class="cr-sum" id="bn-sum-btn"><i></i>' +
      '<b>수정 필요 ' + items.length + '건</b><span>' +
      esc(kinds.slice(0, 3).map(function (k) { return k + ' ' + by[k]; }).join(' · ')) +
      (kinds.length > 3 ? ' 외 ' + (kinds.length - 3) + '종' : '') + '</span></button>';
    $id('bn-sum-btn').onclick = openBannerIssues;
  }

  function openBannerIssues() {
    var items = VX._issues || [];
    var order = ['미등록', '기간 변경', '닫기 필요', '분류 미지정', '조기 종료', '앱 미노출', '순번 불일치'];
    var kinds = order.filter(function (k) {
      return items.some(function (it) { return it.kind === k; });
    });
    var body = kinds.map(function (k) {
      return '<div class="cr-sum-grp">' + esc(k) + '</div>' +
        items.filter(function (it) { return it.kind === k; }).map(function (it, i) {
          return '<div class="cr-sum-row ' + it.rail + '" data-bn-i="' + items.indexOf(it) + '"' +
            (it.bid || it.nid ? ' style="cursor:pointer"' : '') + '>' +
            '<div class="cr-sum-top"><span class="cr-sum-title">' + esc(it.name) + '</span>' +
              '<span class="cr-sum-meta">' + (it.num ? '#' + esc(it.num) : '') + '</span></div>' +
            '<div class="cr-sum-items"><span>' + esc(it.hint) + '</span></div></div>';
        }).join('');
    }).join('');

    var wrap = document.createElement('div');
    wrap.className = 'cr-modal cr-sum-modal';
    wrap.innerHTML = '<div class="cr-sheet"><div class="cr-sheet-head"><b>수정이 필요한 배너 ' +
      items.length + '건</b><span class="cr-hint">항목을 누르면 그 배너 편집이 열립니다</span>' +
      '<button class="cr-x">닫기</button></div><div class="cr-sum-list">' + body + '</div></div>';
    document.body.appendChild(wrap);
    document.body.classList.add('cr-modal-open');
    function close() { wrap.remove(); document.body.classList.remove('cr-modal-open'); }
    wrap.querySelector('.cr-x').onclick = close;
    wrap.onclick = function (e) { if (e.target === wrap) close(); };
    wrap.querySelectorAll('[data-bn-i]').forEach(function (row) {
      var it = items[Number(row.dataset.bnI)];
      if (!it || (!it.bid && !it.nid)) return;
      row.onclick = function () {
        close();
        if (it.bid) openBannerEditor(it.bid, null, it.focus);
        else openBannerEditor(null, VX._driftSeed[it.nid], it.focus);
      };
    });
  }

  // ───────────────────── 뷰 전환 ─────────────────────
  // 제목은 넷 다 「영역 + 하는 일」 두 마디다. 사이드바 타일은 짧은 이름, 제목은 온전한 이름을 쓴다
  // (타일 CRM 캠페인 ↔ 제목 CRM 캠페인 대시보드). CRM 요청만 한 마디라 양식이 어긋나 있었다.
  var VIEW_TITLES = { crm: 'CRM 캠페인 대시보드', banner: '앱 배너 운영', pm: '퍼포먼스 마케팅 성과', msgreq: 'CRM 발송 요청', cpnreq: '쿠폰 운영' };
  // 제목 아래 설명. crm 은 값이 없다 — 그 화면의 한 줄 요약이 캠페인 집계라 그것을 그대로 둔다.
  var VIEW_SUBS = {
    banner: '앱 배너 구좌 배정과 정책 검증, 클릭 성과를 봅니다',
    pm: '유료 매체별 광고비와 설치·가입·결제 성과를 봅니다',
    msgreq: '앱푸시·인앱메시지 발송을 기획운영팀에 요청하고 처리 현황을 봅니다',
    cpnreq: '운영 중 쿠폰 현황을 보고, 쿠폰 세팅을 기획운영팀에 요청 · 대조합니다'
  };

  function switchTopView(v, skipUrl) {
    // 헤더 칩은 지금 탭 것만 보인다 — 배너 탭에서 CRM 칩이, CRM 탭에서 배너 칩이 섞이면
    // 둘 다 「수정 필요」라 어느 쪽 일인지 구분이 안 된다. 보이고 숨기는 건 CSS(data-vt).
    var chips = document.querySelector('.header-chips');
    if (chips) chips.dataset.vt = v;
    // CRM 요청 화면은 폼이 넓어 사이드바를 자동으로 접는다. 다른 탭으로 나가면 접기 전 상태로 되돌린다
    var bodyCls = document.body.classList;
    if (v === 'msgreq' || v === 'cpnreq') { if (!bodyCls.contains('sidebar-collapsed')) { bodyCls.add('sidebar-collapsed'); VX.sbAuto = true; } }
    else if (VX.sbAuto) { bodyCls.remove('sidebar-collapsed'); VX.sbAuto = false; }
    // 제목 아래 줄은 그 화면을 설명하는 한 줄이다. 캠페인 집계는 CRM 캠페인 화면의 요약이라
    // 그 화면에서만 쓰고, 나머지 화면은 제 설명을 쓴다. 예전에는 CRM 요청만 설명으로 바꿔서
    // 배너·퍼마 화면에도 캠페인 집계가 그대로 남아 있었다. 집계 원문은 보관했다가 되돌린다.
    var tl = $id('today-label'), sub = VIEW_SUBS[v] || '';
    if (tl) {
      if (sub) { if (tl.dataset.orig == null) tl.dataset.orig = tl.textContent; tl.textContent = sub; }
      else if (tl.dataset.orig != null) { tl.textContent = tl.dataset.orig; delete tl.dataset.orig; }
      // 대시보드가 집계를 늦게 채워 넣어도 설명 줄을 쓰는 화면에서는 설명을 유지한다
      if (!tl._subObs && window.MutationObserver) {
        tl._subObs = new MutationObserver(function () {
          var want = VIEW_SUBS[VX.view];
          if (want && tl.textContent !== want) { tl.dataset.orig = tl.textContent; tl.textContent = want; }
        });
        tl._subObs.observe(tl, { childList: true, characterData: true, subtree: true });
      }
    }
    // 퍼마는 권한자 전용 — 비권한자가 시도하면 잠금 안내
    if (v === 'pm' && VX.isAdmin === false) {
      VX.view = v;
      document.querySelectorAll('.side-nav-tile').forEach(function (b) { b.classList.toggle('active', b.dataset.vt === v); });
      ['crm', 'banner', 'pm', 'msgreq', 'cpnreq'].forEach(function (k) { var el = $id('view-' + k); if (el) el.style.display = (k === v) ? '' : 'none'; });
      var h0 = document.querySelector('.main-header .header-left h2');
      if (h0) h0.textContent = '퍼포먼스 마케팅 성과';
      $id('view-pm').innerHTML =
        '<div class="vx-locked"><div class="lk-ic">🔒</div>' +
        '<div class="lk-t">접근 권한이 없습니다</div>' +
        '<div class="lk-s">퍼포먼스 마케팅 성과는 열람 권한이 있는 담당자(기획운영팀·조셉)만 볼 수 있습니다.<br>권한이 필요하면 기획운영팀에 문의하세요.</div></div>';
      return;
    }
    VX.view = v;
    ['crm', 'banner', 'pm', 'msgreq', 'cpnreq'].forEach(function (k) {
      var el = $id('view-' + k);
      if (el) el.style.display = (k === v) ? '' : 'none';
    });
    document.querySelectorAll('.side-nav-tile').forEach(function (b) {
      b.classList.toggle('active', b.dataset.vt === v);
    });
    var h = document.querySelector('.main-header .header-left h2');
    if (h) h.textContent = VIEW_TITLES[v] || VIEW_TITLES.crm;
    if (!skipUrl) {
      try {
        var u = new URL(location.href);
        if (v === 'crm') u.searchParams.delete('view'); else u.searchParams.set('view', v);
        if (v !== 'msgreq') { u.searchParams.delete('req'); u.searchParams.delete('mr'); }
        if (v !== 'cpnreq') { u.searchParams.delete('cpn'); u.searchParams.delete('cr'); }
        history.replaceState(null, '', u.toString());
      } catch (e) { /* noop */ }
    }
    if (v === 'banner' && !VX.bannerLoaded) { VX.bannerLoaded = true; loadBannerView(); }
    if (v === 'pm' && !VX.pmLoaded) { VX.pmLoaded = true; loadPmView(); }
    // CRM 요청 화면은 msgreq.js 가 격리 영역(섀도 DOM)에 그린다. 처음 열 때 한 번만 붙인다.
    if (v === 'msgreq' && !VX.msgreqLoaded && window.MsgReq) { VX.msgreqLoaded = true; window.MsgReq.mount($id('view-msgreq')); }
    // 쿠폰 발급 요청 화면도 같은 방식(cpnreq.js · 섀도 DOM)
    if (v === 'cpnreq' && !VX.cpnreqLoaded && window.CpnReq) { VX.cpnreqLoaded = true; window.CpnReq.mount($id('view-cpnreq')); }
  }

  // ═════════════════════ ① 앱 배너 운영 (v2 — 어드민 현황판 모델) ═════════════════════
  // 원천 개념: 어드민(메인공지) = 원천, 번호 = 어드민 등록번호 = GA4 배너 id.
  // 순서 규칙 = 등록 최신순(번호 큰 순)이 1순위. 메인 홈 팝업은 라이브 4개가 목표.

  function bannerById(id) {
    var bs = (VX.reg && VX.reg.banners) || [];
    for (var i = 0; i < bs.length; i++) if (bs[i].id === id) return bs[i];
    return null;
  }
  function surfaceByKey(k) {
    var ss = (VX.reg && VX.reg.surfaces) || [];
    for (var i = 0; i < ss.length; i++) if (ss[i].key === k) return ss[i];
    return null;
  }
  function classColor(b) {
    var cls = (VX.reg && VX.reg.classes) || {};
    return (b && (b.color || cls[b['class']])) || '#4E79A7';
  }
  function pd(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  // 미개시로 내린 계획 행 = 개시일이 지나도록 어드민에 안 올라가 서버 동기화가 꺼 둔 예정 행.
  // '예정 + 꺼짐' 만으로 판정하면 안 된다 — 편집 창에서 새로 만든 예정 행도 기본값이 꺼짐이다.
  // 서버(banner_admin_sync.retire_overdue_planned)가 남기는 retiredAt·메모 태그로만 판정한다.
  function isRetiredPlan(b) {
    return !!(b && b.planned && !b.active &&
      (b.retiredAt || /^\[미개시/.test(String(b.note || ''))));
  }
  // 기간 칸이 비어 있으면 제약 없음 — 어드민이 기간 없이 켜 두면 앱은 계속 노출한다.
  // (서버 판정 banner_store._compute_main_live·banner_alerts._reg_live_main 과 같은 규칙)
  function isLive(b, day) {
    if (!b || !b.active || b.planned) return false;
    var s = pd(b.startDate), e = pd(b.endDate);
    return (!s || s <= day) && (!e || day <= e);
  }
  function bannerStatus(b) {
    var today = kstToday();
    // 예정인데 꺼진 행 = 개시일이 지나도록 어드민에 안 올라간 계획(서버 동기화가 내림). 예정으로 세지 않는다.
    if (isRetiredPlan(b)) return { k: 'off', t: '미개시 · 개시일 지남, 어드민 미등록' };
    if (b.planned) return { k: 'plan', t: '예정 · 어드민 미등록' };
    if (!b.active) return { k: 'off', t: '비활성' };
    var s = pd(b.startDate), e = pd(b.endDate);
    if (s && today < s) return { k: 'wait', t: '노출 예정' };
    // 켜져 있는데 기간이 비면 지금 노출 중이다 — 무기한이라 종료 판단을 못 하니 따로 표시한다.
    if (!s || !e) return { k: 'urgent', t: '진행중 · ' + (!s && !e ? '기간' : (s ? '종료일' : '시작일')) + ' 미설정' };
    if (today > e) return { k: 'end', t: '닫아야 함 · 종료일 지남' };
    var dLeft = Math.round((e - today) / 86400000);
    if (dLeft <= 1) return { k: 'urgent', t: '만료임박 D-' + dLeft };
    return { k: 'live', t: '진행중 · D-' + dLeft };
  }
  // 슬롯 순서.
  // 하단·검색·플로팅은 어드민에 '순서' 값이 있고 **작은 숫자가 먼저 노출**된다
  // (99는 맨 뒤로 밀어두려는 운영 관례). 이 값이 있으면 그게 실제 노출 순서다.
  // 메인 홈 팝업은 어드민에 순서 칸이 없지만, 앱 실측 피드 동기화가 피드 배열 순서(=실제 노출
  // 순서)를 순서 값으로 적어 준다. 순서 값이 없는 행만 종전대로 등록 최신순(번호 내림차순).
  function slotSort(a, b) {
    var pa = (a && a.priority != null && a.priority !== '') ? +a.priority : null;
    var pb = (b && b.priority != null && b.priority !== '') ? +b.priority : null;
    if (pa != null && pb != null && pa !== pb) return pa - pb;
    if (pa != null && pb == null) return -1;
    if (pa == null && pb != null) return 1;
    return adminNo(b) - adminNo(a);
  }
  // 어드민 등록번호. 공지탭·이벤트탭 레코드는 adminId 가 비어 들어와 지면별 컨텐츠 번호(seq)로
  // 대신한다 — 비면 0 이 되어 정렬이 등록 순서(오래된 것부터)로 흘러 3월 공지가 1순위로 보였다.
  function adminNo(b) {
    var n = parseInt(b && b.adminId, 10);
    if (!isNaN(n)) return n;
    var cids = (b && b.contentIds) || {};
    for (var k in cids) { var m = parseInt(cids[k], 10); if (!isNaN(m)) return m; }
    var t = parseInt(String((b && b.id) || '').replace(/\D/g, ''), 10);
    return isNaN(t) ? 0 : t;
  }
  function liveBannersOf(surfaceKey, day) {
    return ((VX.reg && VX.reg.banners) || [])
      .filter(function (b) { return (b.surfaces || []).indexOf(surfaceKey) > -1 && isLive(b, day); })
      .sort(slotSort);
  }

  // ── 사이드 공지사항 구좌(공지탭·이벤트탭) ────────────────────
  // 어드민에 자동 종료 기능이 없어, 종료일이 지났는데도 아직 활성(ON)인 항목은
  // 운영자가 직접 닫아야 한다. 이 "닫아야 할 항목"을 구좌별로 최상단에 드러낸다.
  // 어드민 공지사항에는 종료일 칸이 아예 없다. 그래서 사람이 대시보드에 적어 넣기 전까지는
  // 아무리 오래 방치돼도 닫기 필요로 잡히지 않는다. 같은 소재가 다른 지면(메인 팝업·하단
  // 배너)에도 올라가 있으면 그쪽 종료일 중 **가장 늦은 것**을 이 공지의 종료일로 추정한다.
  // 어디까지나 추정이라 운영표에는 쓰지 않는다 — 화면에서만 쓰고 배지에 '추정' 을 붙인다.
  // 사람이 적어 넣은 종료일이 있으면 그것이 언제나 우선이다.
  function baseName(s) {
    // 서버의 중복 판정(banner_store._base_name)과 같은 규칙 — 꼬리 괄호를 떼고 비교한다.
    return String(s || '').replace(/[\(（][^\)）]*[\)）]/g, ' ')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function estimatedEnd(b) {
    if (!b || b.endDate) return '';
    var base = baseName(b.name);
    if (!base) return '';
    var best = '';
    ((VX.reg && VX.reg.banners) || []).forEach(function (o) {
      if (o === b || isSideTabRow(o) || !o.endDate) return;
      if (baseName(o.name) !== base) return;
      if (!best || o.endDate > best) best = o.endDate;
    });
    return best;
  }
  function effectiveEnd(b) { return (b && b.endDate) ? b.endDate : estimatedEnd(b); }
  function needsClose(b) {
    if (!b || !b.active) return false;
    var e = pd(effectiveEnd(b)), t = kstToday();
    return !!e && t > e;
  }
  function overdueDays(b) {
    var e = pd(effectiveEnd(b));
    return e ? Math.round((kstToday() - e) / 86400000) : 0;
  }
  function fmtPeriodShort(b) {
    function md(s) { var d = pd(s); return d ? (('0' + (d.getMonth() + 1)).slice(-2) + '/' + ('0' + d.getDate()).slice(-2)) : ''; }
    var end = effectiveEnd(b);
    return md(b.startDate) + ' ~ ' + (end ? md(end) + (b.endDate ? '' : ' 추정') : '미정');
  }
  // 탭 값만 보면 안 된다. 예전에 메인·하단 배너 행에도 탭을 적어 둔 것이 남아 있어,
  // 사이드배너 구좌가 아닌 행까지 이 보드에 섞여 뜬다. 지면으로 한 번 더 거른다.
  var SIDE_TAB_SURFACES = { side_notice: true, side_event: true };
  function isSideTabRow(b) {
    return (b.surfaces || []).some(function (sk) { return SIDE_TAB_SURFACES[sk]; });
  }
  function noticeTabItems(tab) {
    return ((VX.reg && VX.reg.banners) || [])
      .filter(function (b) { return b.noticeTab === tab && isSideTabRow(b); })
      .sort(function (a, b) {
        var na = needsClose(a) ? 0 : 1, nb = needsClose(b) ? 0 : 1;
        if (na !== nb) return na - nb;            // 닫아야 할 항목 먼저
        return (pd(effectiveEnd(b)) || 0) - (pd(effectiveEnd(a)) || 0);  // 최근 종료 먼저
      });
  }

  function renderNoticeBoards() {
    var host = $id('bn-notice');
    if (!host) return;
    function col(tab, accent) {
      var items = noticeTabItems(tab);
      var overdue = items.filter(needsClose);
      var rows = items.map(function (b) {
        var close = needsClose(b);
        var badge = close
          ? '<span class="bn-close-badge">닫기 필요' + (b.endDate ? '' : '(추정)')
              + ' · ' + overdueDays(b) + '일 경과</span>'
          : '<span class="vx-chip ' + (isLive(b, kstToday()) ? 'purpose-이벤트' : 'gray') + '">'
              + esc(bannerStatus(b).t) + '</span>';
        return '<div class="bn-notice-row' + (close ? ' overdue' : '') + '">' +
          '<div class="bn-notice-name">' + esc(cleanName(b.name)) + '</div>' +
          '<div class="bn-notice-meta">' + esc(fmtPeriodShort(b)) + '</div>' +
          badge + '</div>';
      }).join('') || '<div class="vx-empty">항목 없음</div>';
      return '<div class="bn-notice-col">' +
        '<div class="bn-notice-head" style="--accent:' + accent + '">' +
          '<span class="dot" style="background:' + accent + '"></span>' + tab + '탭' +
          (overdue.length ? '<span class="bn-notice-alert">닫아야 할 항목 ' + overdue.length + '</span>'
                          : '<span class="bn-notice-ok">정상</span>') +
        '</div>' + rows + '</div>';
    }
    host.innerHTML = col('공지', '#4E79A7') + col('이벤트', '#F28E2B');
  }

  // 클릭이 수집되는 지면과 그 원천 키.
  // main=메인배너_click(웹뷰 속성) / bottom=click_banner / search=click_searchbanner.
  // 플로팅(side)은 검색배너와 어드민 레코드를 공유하지만 별도 이벤트가 없어 search 로 함께 잡힌다.
  var CK_SRC_OF = { main: 'main', bottom: 'bottom', search: 'search', side: 'search' };

  // 한 배너가 클릭 집계에서 가질 수 있는 (지면:컨텐츠번호) 키 목록
  function bannerClickKeys(b) {
    if (!b) return [];
    var ci = b.contentIds || {};
    var keys = [];
    function add(src, cn) {
      if (cn == null || cn === '') return;
      var k = src + ':' + String(cn);
      if (keys.indexOf(k) < 0) keys.push(k);
    }
    Object.keys(CK_SRC_OF).forEach(function (sk) {
      if ((b.surfaces || []).indexOf(sk) < 0) return;
      add(CK_SRC_OF[sk], ci[sk] || (sk === 'main' ? b.adminId : ''));
    });
    if ((b.surfaces || []).indexOf('main') > -1) {
      (b.ga4Ids || []).forEach(function (id) { add('main', id); });
    }
    return keys;
  }

  // 최근 N일 클릭 합. 클릭 원천이 없는 지면(사이드배너 등)만 null.
  function clicksForBanner(b, days) {
    if (!VX.clicks || !VX.clicks.rows || !b) return null;
    var keys = bannerClickKeys(b);
    if (!keys.length) return null;
    var cutoff = ymd(new Date(kstToday().getTime() - days * 86400000)).replace(/-/g, '');
    var sum = 0, seen = false;
    VX.clicks.rows.forEach(function (r) {
      if (r.date >= cutoff && keys.indexOf(r.src + ':' + String(r.contentId)) > -1) {
        sum += r.clicks; seen = true;
      }
    });
    return seen ? sum : 0;
  }

  // 카드에 총합을 쓰면 노출 기간이 다른 배너끼리 비교가 안 된다(어제 올린 배너 vs 3주 된 배너).
  // 그래서 일평균으로 준다. ⚠️ 분모는 7 고정이 아니라 **실제 데이터가 있는 날 수** —
  // 이틀 전에 올라간 배너를 7로 나누면 실제의 1/3로 보인다.
  // 유저도 '기간 고유값 ÷ 일수' 가 아니라 **일별 고유값의 평균**이다(고유값은 나눌 수 없다).
  function clickAvgForBanner(b, days) {
    if (!b) return null;
    return clickAvgForKeys(bannerClickKeys(b), days);
  }
  function clickAvgForKeys(keys, days) {
    if (!VX.clicks || !VX.clicks.rows || !keys || !keys.length) return null;
    var cutoff = ymd(new Date(kstToday().getTime() - days * 86400000)).replace(/-/g, '');
    var byDate = {};
    VX.clicks.rows.forEach(function (r) {
      if (r.date < cutoff || keys.indexOf(r.src + ':' + String(r.contentId)) < 0) return;
      if (!byDate[r.date]) byDate[r.date] = { clicks: 0, users: 0 };
      byDate[r.date].clicks += r.clicks;
      byDate[r.date].users += r.users;   // 같은 날 여러 지면이면 합산(지면 간 중복은 감수)
    });
    var dates = Object.keys(byDate);
    if (!dates.length) return { clicks: 0, users: 0, days: 0 };
    var c = 0, u = 0;
    dates.forEach(function (d) { c += byDate[d].clicks; u += byDate[d].users; });
    return { clicks: Math.round(c / dates.length), users: Math.round(u / dates.length),
             days: dates.length };
  }

  // 같은 구좌 재등록의 직전 번호들. 어드민은 재등록마다 새 번호를 주고 동기화는 새 행을 만든다
  // (예: 드로우 메인 팝업 1116 → 1118). 라이브 카드가 새 번호만 세면 교체 당일부터 며칠간
  // 0 으로 보여 성과 없는 배너처럼 읽힌다. 그래서 카드에서는 같은 지면·같은 소재이고
  // 새 번호 시작일 무렵에 끝난(내려간) 행을 거슬러 올라가 함께 센다.
  // 성과 표·이력은 이와 별개로 '운영표 등록 하나 = 배너 하나' 단위를 그대로 쓴다.
  function predecessorsOf(b, surfaceKey) {
    var out = [], cur = b, banners = (VX.reg && VX.reg.banners) || [];
    for (var depth = 0; depth < 5 && cur && pd(cur.startDate); depth++) {
      var dayBefore = ymd(new Date(pd(cur.startDate).getTime() - 86400000));
      var from = cur, prev = null;
      banners.forEach(function (p) {
        if (p === from || p === b || p.planned || out.indexOf(p) > -1) return;
        if ((p.surfaces || []).indexOf(surfaceKey) < 0) return;
        if (!p.startDate || p.startDate >= from.startDate) return;
        if (!p.endDate || p.endDate < dayBefore || p.endDate > from.startDate) return;
        if (p.active && p.endDate >= ymd(kstToday())) return;   // 아직 함께 떠 있으면 교체가 아니다
        if (!sameCreative(p.name, b.name)) return;
        if (!prev || p.startDate > prev.startDate) prev = p;   // 가장 가까운 직전 행
      });
      if (!prev) break;
      out.push(prev);
      cur = prev;
    }
    return out;
  }
  // 한 지면에서의 클릭 키만(다른 지면에 함께 걸린 행이어도 그 지면 몫은 섞지 않는다)
  function surfaceClickKeys(b, surfaceKey) {
    var src = CK_SRC_OF[surfaceKey];
    if (!src) return [];
    return bannerClickKeys(b).filter(function (k) { return k.indexOf(src + ':') === 0; });
  }

  function loadBannerView() {
    var root = $id('view-banner');
    root.innerHTML = '<div class="vx-loading">배너 현황 불러오는 중…</div>';
    // 점진 렌더: 빠른 레지스트리(GCS)로 즉시 그리고, 클릭(BQ 적재 캐시)은 뒤에 채움
    fetchJson('/api/banners').then(function (regRes) {
      if (!regRes || !regRes.ok) {
        root.innerHTML = '<div class="vx-error">배너 데이터를 불러오지 못했습니다: ' +
          esc((regRes && regRes.error) || '알 수 없는 오류') + '</div>';
        return;
      }
      VX.reg = regRes.registry;
      VX.clicks = null; // 로딩 중 표시
      renderBannerView();
      // 콜드 스타트 첫 로드는 실패할 수 있어 자동 재시도(최대 2회, refresh로 재계산)
      (function loadFeed(attempt) {
        fetchJson('/api/main-notice-live' + (attempt ? '?refresh=1' : '')).then(function (f) {
          if ((!f || !f.ok) && attempt < 2) { setTimeout(function () { loadFeed(attempt + 1); }, 1500); return; }
          VX.mainFeed = (f && f.ok) ? f : { ok: false, notices: [] };
          renderMainLiveFeed();
        }).catch(function () {
          if (attempt < 2) { setTimeout(function () { loadFeed(attempt + 1); }, 1500); return; }
          VX.mainFeed = { ok: false, notices: [] }; renderMainLiveFeed();
        });
      })(0);
      fetchJson('/api/banner-clicks?days=30').then(function (c) {
        VX.clicks = (c && c.ok) ? c : { ok: false, rows: [] };
        renderBnKpis(); renderSurfaceView(); renderBannerList(); renderClickCharts();
        renderFreshness();
      }).catch(function () {
        VX.clicks = { ok: false, rows: [] };
        renderClickCharts();
      });
      // 이력 원장(2025-01-01~) — 90일 이상·직접 지정 구간을 조회 없이 그리는 원천.
      // 30일 이하 프리셋은 위 응답을 그대로 쓴다(기간 유니크 유저가 정확한 값이라서다).
      fetchJson('/api/banner-clicks-history').then(function (h) {
        VX.hist = (h && h.ok) ? h : { ok: false, rows: [], totals: [] };
        if (VX.view === 'banner' && VX.clickRange && VX.clickRange !== 7 && VX.clickRange !== 30) {
          renderClickCharts();
        }
      }).catch(function () { VX.hist = { ok: false, rows: [], totals: [] }; });
    });
  }

  function renderBannerView() {
    var root = $id('view-banner');
    var links = (((VX.reg.policy || {}).links) || []).map(function (l) {
      return '<a class="vx-btn sm" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + ' ↗</a>';
    }).join(' ');
    root.innerHTML =
      '<div class="bn-topbar">' + links +
      '  <span style="flex:1"></span>' +
      (VX.isAdmin ? '  <button class="vx-btn primary" id="bn-new">+ 배너 등록</button>' :
        '  <span class="vx-chip gray" title="기획운영팀·조셉만 편집 가능">🔒 열람 전용</span>') + '</div>' +
      '<div class="bn-kpis" id="bn-kpis"></div>' +
      '<div id="bn-fresh" class="bn-fresh"></div>' +
      '<div id="bn-save-msg"></div>' +
      '<div class="vx-card">' +
      '  <div class="vx-card-head"><div><div class="vx-title">실시간 메인 팝업</div>' +
      '    <div class="vx-sub">앱에 실제 노출 중인 팝업과 운영표가 일치하는지 점검</div></div>' +
      '    <div class="vx-actions">' +
      '      <a class="vx-btn sm ghost" href="https://cdn.modu.cloud/main-notice/notices.json" target="_blank" rel="noopener" title="앱이 실제로 그리는 메인 팝업 원천 JSON(원시 데이터)">원천 JSON ↗</a>' +
      '      <button class="vx-btn sm" id="bn-feed-refresh">↻ 새로고침</button></div></div>' +
      '  <div id="bn-mainfeed"><div class="vx-loading">앱 실측 불러오는 중…</div></div>' +
      '</div>' +
      '<div class="vx-card">' +
      '  <div class="vx-card-head">' +
      '    <div><div class="vx-title">지면별 노출 현황 · ' + esc(ymd(kstToday())) + '</div>' +
      '      <div class="vx-sub">오늘 라이브 슬롯과 노출 타임라인 · 순서는 앱 실제 노출 순서(메인 팝업은 앱 피드, 그 외는 어드민 순서 값)</div></div>' +
      '    </div>' +
      '  <div id="bn-surface-board"></div>' +
      '</div>' +
      '<div class="vx-card">' +
      '  <div class="vx-card-head"><div><div class="vx-title">배너 등록·관리</div>' +
      '    <div class="vx-sub">어드민이 원천 — 앱 실측·어드민 동기화로 자동 반영 · 예정(계획)만 직접 입력 · 변경은 즉시 저장·정책 검증</div></div>' +
      '    <div class="vx-actions"><div class="bn-seg" id="bn-filter">' +
      '      <button class="on" data-f="ops">운영·예정</button>' +
      '      <button data-f="all">전체</button>' +
      '    </div></div></div>' +
      '  <div class="bn-list-wrap"><table class="bn-list" id="bn-list"></table></div>' +
      '  <div id="bn-list-pager"></div>' +
      // 운영 규칙은 표 아래에 한 줄로 늘어놓으면 읽히지도 않으면서 자리만 먹는다.
      // 평소엔 개수만 접어 두고, 필요할 때 펼쳐서 항목별로 읽게 한다(내용은 정책 원천 그대로).
      (function () {
        var rules = ((VX.reg.policy || {}).rules) || [];
        if (!rules.length) return '';
        return '<details class="vx-rules"><summary>운영 규칙 ' + rules.length + '</summary>' +
          '<ul>' + rules.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') +
          '</ul></details>';
      })() +
      '</div>' +
      '<div class="vx-card">' +
      '  <div class="vx-card-head"><div><div class="vx-title">배너 클릭 성과</div>' +
      '    <div class="vx-sub">GA4 직접 집계 — 메인 홈 팝업·하단배너·검색배너 · 오늘 제외</div></div>' +
      // 검색은 필터가 아니다 — 지금 걸린 지면·기간을 무시하고 원장 전체에서 배너를 찾아
      // 그리로 데려간다. 필터 줄에 끼워 두면 '또 하나의 필터'로 읽히므로 제목 줄에 둔다.
      '    <div class="vx-actions">' +
      '      <span class="ck-search" id="bn-ck-search">' +
      '        <svg class="ck-search-ic" viewBox="0 0 24 24" aria-hidden="true">' +
      '          <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
      '        <input type="search" class="vx-input ck-q" id="bn-ck-q" placeholder="배너 찾기" ' +
      '               autocomplete="off" aria-label="배너 찾기 — 기간과 무관하게 전체에서">' +
      '        <div class="ck-sug" id="bn-ck-sug"></div></span>' +
      '    </div>' +
      '  </div>' +
      // 지면은 고르는 값이 아니라 지금 보고 있는 자리다 — 드롭다운에 숨기지 않고 탭으로 올린다.
      '  <div class="ck-surftabs" id="bn-click-surftabs" role="tablist"></div>' +
      // 왼쪽 = 어느 배너를, 오른쪽 = 어떻게 볼지. 시선이 한 방향으로만 흐르게 나눈다.
      // 필터 줄 — 옅은 바 하나로 묶고 라벨·구분선으로 무엇의 묶음인지 드러낸다.
      '  <div class="ck-picks">' +
      '    <div class="ck-group">' +
      '      <span class="ck-lbl">배너</span>' +
      '      <span class="ck-chip" id="bn-ck-chip" hidden></span>' +
      '      <select id="bn-click-pick" class="vx-select"></select>' +
      '    </div>' +
      '    <span class="ck-rule"></span>' +
      '    <div class="ck-group">' +
      '      <span class="ck-lbl">지표</span>' +
      '      <div class="bn-seg" id="bn-click-metric">' +
      '        <button class="on" data-m="clk">클릭수</button>' +
      '        <button data-m="usr">유저수</button>' +
      '      </div>' +
      '    </div>' +
      '    <span class="ck-rule"></span>' +
      '    <div class="ck-group">' +
      '      <span class="ck-lbl">기간</span>' +
      '      <div class="bn-seg" id="bn-click-range">' +
      '        <button data-r="7">7일</button>' +
      '        <button class="on" data-r="30">30일</button>' +
      '      </div>' +
      '      <span class="ck-datefield" id="bn-ck-datefield">' +
      '        <button type="button" class="ck-dtrigger" id="bn-ck-trigger" aria-haspopup="dialog">' +
      '          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/>' +
      '            <path d="M3 10h18M8 3v4M16 3v4"/></svg>' +
      '          <span id="bn-ck-lb-from"></span><span class="ck-dash">-</span><span id="bn-ck-lb-to"></span>' +
      '        </button>' +
      '        <div class="ck-pop" id="bn-ck-pop" role="dialog" aria-label="기간 선택"></div></span>' +
      '    </div>' +
      '  </div>' +
      '  <div id="bn-click-chart" class="tl-chart" style="min-height:220px"></div>' +
      '  <div id="bn-click-chart-note" class="vx-note" style="margin-top:6px"></div>' +
      '  <div id="bn-click-table" style="margin-top:12px"></div>' +
      '</div>' +
      '<div class="vx-modal-overlay" id="bn-modal"><div class="vx-modal" id="bn-modal-body"></div></div>';

    if ($id('bn-new')) $id('bn-new').onclick = function () { openBannerEditor(null); };
    VX.bnShowAll = false;
    VX.bnPage = 1;
    $id('bn-filter').querySelectorAll('button').forEach(function (btn) {
      btn.onclick = function () {
        VX.bnShowAll = btn.dataset.f === 'all';
        VX.bnPage = 1;   // 모수가 달라지면 보던 쪽 번호는 다른 목록의 자리다
        $id('bn-filter').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === btn); });
        renderBannerList();
      };
    });

    if ($id('bn-feed-refresh')) $id('bn-feed-refresh').onclick = function () {
      // 실측만 다시 그리면 운영표(레지스트리)는 옛 상태로 남는다. 관리자는 실측을 기준으로
      // 레지스트리까지 맞춘 뒤 전체를 다시 그린다 — 어드민에서 바꾼 즉시 여기서 보이도록.
      $id('bn-mainfeed').innerHTML = '<div class="vx-loading">앱 실측 새로고침 중…</div>';
      if (!VX.isAdmin) {
        fetchJson('/api/main-notice-live?refresh=1').then(function (f) { VX.mainFeed = f; renderMainLiveFeed(); });
        return;
      }
      fetchJson('/api/banner-sync-live', { method: 'POST' }).then(function (r) {
        return Promise.all([
          fetchJson('/api/main-notice-live?refresh=1'),
          fetchJson('/api/banners?refresh=1'),
          fetchJson('/api/banner-sync-status')
        ]).then(function (res) {
          VX.mainFeed = res[0];
          if (res[1] && res[1].registry) VX.reg = res[1].registry;
          VX.syncStatus = res[2];
          renderMainLiveFeed(); rerenderBanner();
          showBannerSyncMsg(r);
        });
      }).catch(function (err) {
        renderMainLiveFeed();
        showBannerSyncMsg({ ok: false, error: (err && err.message) || String(err) });
      });
    };

    renderBnKpis();
    renderSurfaceView();
    renderMainLiveFeed();
    renderBannerList();
    renderClickCharts();
    bindChartResize();
    // 동기화 시각은 화면을 막을 이유가 없다 — 늦게 와도 그 자리에만 채운다.
    fetchJson('/api/banner-sync-status').then(function (st) {
      VX.syncStatus = st; renderFreshness();
    });
  }

  function rerenderBanner() {
    renderBnKpis(); renderSurfaceView(); renderBannerList(); renderFreshness();
    // 드리프트 알림은 운영표를 그대로 읽어 만든다. 저장 뒤 여기서 다시 그리지 않으면
    // 방금 고친 항목이 알림에 그대로 남아 "고쳤는데 안 사라진다"가 된다.
    renderMainLiveFeed();
  }

  // 최상단 KPI 카드 — 라이브 중 / 종료 예정(7일 내) / 노출 예정 / 슬롯 공백 (캠페인 대시보드 양식)
  function renderBnKpis() {
    var host = $id('bn-kpis');
    if (!host) return;
    var today = kstToday();
    var liveList = [], endingSoon = [], waitPlan = [];
    (VX.reg.banners || []).forEach(function (b) {
      var st = bannerStatus(b);
      if (st.k === 'live' || st.k === 'urgent') {
        liveList.push(b);
        var e = pd(b.endDate);
        if (e && (e - today) / 86400000 <= 7) endingSoon.push(b);
      }
      if (st.k === 'wait' || st.k === 'plan') waitPlan.push(b);
    });
    endingSoon.sort(function (a, b) { return pd(a.endDate) - pd(b.endDate); });
    var gapTotal = 0, gapSub = [];
    var surfCnt = [];
    (VX.reg.surfaces || []).forEach(function (s) {
      var n = liveBannersOf(s.key, today).length;
      if (n) surfCnt.push(s.label.replace('메인 홈 팝업', '메인').replace('플로팅 배너', '플로팅') + ' ' + n);
      if (s.target && n < s.target) {
        gapTotal += s.target - n;
        gapSub.push(s.label + ' ' + (s.target - n) + '자리');
      }
    });
    var nextUp = waitPlan.filter(function (b) { return b.startDate; })
      .sort(function (a, b) { return pd(a.startDate) - pd(b.startDate); })[0];
    var e0 = endingSoon[0];
    var eDays = e0 ? Math.round((pd(e0.endDate) - today) / 86400000) : null;
    // '라이브 중' 밑에는 지면별 분포를 적는다. 클릭 합계는 아래 성과 카드가 이미 훨씬 자세히
    // 다루고 여기서는 판단할 게 없다 — 반면 지금 어느 지면에 몇 개가 걸려 있는지는
    // 구좌 배정을 정하는 값이라 이 자리에서 바로 쓰인다. (옆 카드가 잔여일·공백을 맡는다.)
    // 플로팅 계열(side·side_notice·side_event)은 하나로 묶는다 — 따로 세면 잔가지가 길어져
    // 정작 중요한 메인·하단이 묻힌다.
    var SURF_SHORT = { main: '메인', bottom: '하단', search: '검색', side: '플로팅' };
    var bySurf = {}, surfOrder = [];
    liveList.forEach(function (b) {
      var seen = {};
      (b.surfaces || []).forEach(function (raw) {
        var k = raw.indexOf('side') === 0 ? 'side' : raw;
        if (seen[k]) return;          // 같은 배너가 플로팅 두 종류면 한 번만 센다
        seen[k] = true;
        if (!bySurf[k]) { bySurf[k] = 0; surfOrder.push(k); }
        bySurf[k] += 1;
      });
    });
    var SURF_SEQ = ['main', 'bottom', 'search', 'side'];
    surfOrder.sort(function (a, b) {
      var ia = SURF_SEQ.indexOf(a), ib = SURF_SEQ.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    var surfSub = surfOrder.map(function (k) {
      return (SURF_SHORT[k] || k) + ' ' + bySurf[k];
    }).join(' · ');
    // CRM 캠페인 .A-kpi와 동일 위계 (라벨 15px + 컬러 닷, 값 44px, 단위 소형, 부제 11px)
    var cards = [
      { k: '라이브 중', num: liveList.length, unit: '개', state: 'live',
        sub: surfSub || '노출 중인 배너 없음' },
      { k: '종료 예정', num: endingSoon.length, unit: '개', state: endingSoon.length ? 'next' : 'cum',
        sub: e0 ? (cleanName(e0.name) + ' · D-' + eDays) : '7일 내 임박 없음' },
      { k: '노출 예정', num: waitPlan.length, unit: '개', state: 'cum',
        sub: nextUp ? ((nextUp.startDate || '').slice(5).replace('-', '/') + ' 시작 · ' + cleanName(nextUp.name)) : '기간 미정 포함' },
      { k: '슬롯 공백', num: gapTotal, unit: '개', state: gapTotal ? 'gap' : 'done',
        sub: gapSub.join(' · ') || '공백 없음' }
    ];
    host.innerHTML = cards.map(function (c) {
      return '<div class="bn-kpi ' + c.state + '">' +
        '<div class="l">' + esc(c.k) + '</div>' +
        '<div class="v">' + fmtN(c.num) + '<span class="unit">' + esc(c.unit) + '</span></div>' +
        '<div class="sub" title="' + esc(c.sub) + '">' + esc(c.sub) + '</div></div>';
    }).join('');
  }

  // 갱신 상태는 한 줄로 모은다. 카드마다 다른 배지("이상 없음"·"최신"·"GA4 집계")를 두면
  // 무엇이 언제 것인지 읽는 사람이 매번 다시 해석해야 한다. 원천별 칩 + 검증 결과 한 줄.
  function renderFreshness() {
    var el = $id('bn-fresh'); if (!el) return;
    var st = VX.syncStatus || {};
    function hm(v) { return v ? String(v).slice(5, 16) : ''; }
    // 노출 여부는 서버가 1시간마다 앱 공개 API·피드로 맞춘다(전 지면). 기간·배너명은 앱이
    // 주지 않아 어드민 동기화가 채운다. 둘은 주기도 범위도 달라 칩을 나눠 보여준다.
    var feedAt = (st.feed || {}).lastSyncAt || '';
    var adminAt = (st.admin || {}).lastSyncAt || '';
    function minsAgo(v) {
      var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(v || ''));
      if (!m) return null;
      var kstNow = new Date(Date.now() + new Date().getTimezoneOffset() * 60000 + 9 * 3600000);
      return Math.round((kstNow - new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) / 60000);
    }
    var feedMins = minsAgo(feedAt);
    var feedStale = feedMins == null || feedMins > 150;   // 정시 실행을 두 번 건너뛴 상태
    // 기간·배너명은 담당자 PC 가 8시~19시(KST)에 매시 어드민을 읽어 채운다. 19시~다음날 8시는
    // 키클락 로그인이 없어 돌지 않는다. PC 가 꺼졌거나 로그인이 만료되면 멈춘다.
    // 그래서 묵은 정도는 운영 시간(8~19시)에 흐른 분만 센다 — 밤새 쉰 것을 지연으로 보지 않게.
    var ADMIN_HOURS = [8, 19];
    function opMinsSince(v) {
      var m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(v || ''));
      if (!m) return null;
      var from = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
      var now = new Date(Date.now() + new Date().getTimezoneOffset() * 60000 + 9 * 3600000);
      var total = 0;
      for (var d = new Date(from.getFullYear(), from.getMonth(), from.getDate()); d <= now; d.setDate(d.getDate() + 1)) {
        var a = new Date(d.getFullYear(), d.getMonth(), d.getDate(), ADMIN_HOURS[0]);
        var b = new Date(d.getFullYear(), d.getMonth(), d.getDate(), ADMIN_HOURS[1]);
        var s = Math.max(a, from), e = Math.min(b, now);
        if (e > s) total += (e - s) / 60000;
      }
      return Math.round(total);
    }
    var adminMins = opMinsSince(adminAt);
    var adminStale = adminMins == null || adminMins > 150;
    // 기간·배너명이 빈 행 = 어드민 동기화가 채워야 할 몫. 날짜로 재촉하지 않고 실제 할 일로 센다.
    var needFill = ((VX.reg && VX.reg.banners) || []).filter(function (b) {
      if (!b.active || b.planned || isRetiredPlan(b)) return false;
      if (!(b.surfaces || []).some(function (k) { return !SV_NOEND[k]; })) return false;
      return !String(b.startDate || '').trim() || !String(b.endDate || '').trim() ||
        /^(하단배너|검색·플로팅 배너) \d+$/.test(String(b.name || ''));
    }).length;
    // 고른 기간에 따라 숫자의 출처가 갈린다. 어느 쪽이든 조회 때 BigQuery 를 치지는 않지만
    // 갱신 주기가 다르므로(1시간 vs 하루), 지금 보고 있는 쪽의 적재 시각을 보여준다.
    var rng = (VX.clickRange === undefined) ? 30 : VX.clickRange;
    var usingCache = (rng === 7 || rng === 30);
    var clicksAt = usingCache
      ? ((VX.clicks && VX.clicks.generatedAt) ? String(VX.clicks.generatedAt) : '')
      : ((VX.hist && VX.hist.generatedAt) ? String(VX.hist.generatedAt) : '');
    var through = usingCache
      ? ((VX.clicks && VX.clicks.through) ? String(VX.clicks.through) : '')
      : ((VX.hist && VX.hist.end) ? String(VX.hist.end) : '');

    function chip(opts) {
      return '<span class="bf-item' + (opts.warn ? ' warn' : '') + (opts.wide ? ' tip-r' : '') +
        '" data-tip="' + esc(opts.tip) + '">' +
        '<i class="bf-dot' + (opts.auto ? ' auto' : (opts.warn ? ' warn' : '')) + '"></i>' +
        '<b>' + esc(opts.label) + '</b>' +
        '<span class="bf-val">' + esc(opts.value) + '</span>' +
        (opts.note ? '<em>' + esc(opts.note) + '</em>' : '') + '</span>';
    }

    // 안내글은 '이게 무슨 숫자인가 / 얼마나 자주 바뀌나 / 내가 할 일이 있나' 세 줄로만 쓴다.
    var drift = VX._drift || { n: null };
    var verify = drift.n === null
      ? chip({ label: '검증', value: '확인 중',
               tip: '앱에 실제로 뜬 배너와 이 화면의 목록이 같은지 맞춰보는 중입니다.' })
      : chip({ label: '검증', value: drift.n === 0 ? '이상 없음' : '안 맞음 ' + drift.n + '건',
               warn: drift.n > 0, auto: drift.n === 0,
               tip: drift.n === 0
                 ? '앱에 실제로 뜬 배너와 이 화면의 목록이 같습니다.\n1시간마다 다시 맞춰봅니다.'
                 : '앱에 뜬 배너와 이 화면이 ' + drift.n + '건 다릅니다.\n' +
                   '아래 실시간 메인 팝업 카드에서 어떤 배너인지 볼 수 있습니다.' });

    el.innerHTML =
      '<span class="bf-title">데이터 갱신</span>' +
      chip({ label: '배너 현황', value: hm(feedAt) || '기록 없음',
             note: feedStale ? '갱신 지연' : '자동 1시간', warn: feedStale, auto: !feedStale,
             tip: '앱에 실제로 떠 있는 배너와 이 화면을 맞춘 시각입니다.\n' +
                  '메인 홈 팝업·하단·검색·플로팅·공지탭 모두 1시간마다 저절로 갱신됩니다.' +
                  (feedStale ? '\n→ 2시간 넘게 갱신되지 않았습니다. 서버 동기화를 확인해 주세요.' : '') }) +
      chip({ label: '기간·이름', value: hm(adminAt) || '기록 없음',
             note: needFill ? '확인 필요 ' + needFill + '건' : (adminStale ? '갱신 지연' : '8-19시 1시간'),
             warn: needFill > 0 || adminStale, auto: !needFill && !adminStale,
             tip: '기간과 배너명은 앱이 알려주지 않아 어드민에서만 확인됩니다.\n' +
                  '담당자 PC가 8시~19시에 1시간마다 어드민을 읽어 채웁니다.\n' +
                  '19시부터 다음 날 8시까지는 갱신하지 않습니다.\n' +
                  '노출 여부는 이 값과 무관하게 24시간 1시간마다 갱신됩니다.' +
                  (adminStale ? '\n→ 운영 시간 기준 2시간 넘게 갱신되지 않았습니다. 담당자 PC가 꺼져 있거나 어드민 로그인이 만료됐을 수 있습니다.' : '') +
                  (needFill ? '\n→ 기간이나 이름이 비어 있는 배너가 ' + needFill + '건 있습니다.' : '') }) +
      chip({ label: '클릭·유저', value: hm(clicksAt) || '집계 중',
             note: usingCache ? '최근 30일치' : '2025년부터 이력', auto: true,
             tip: '지금 고른 기간의 숫자를 마지막으로 계산한 시각입니다.\n' +
                  '기간을 바꿔도 그 자리에서 조회가 나가지는 않습니다 — 미리 계산해 둔 값을 읽습니다.\n' +
                  (usingCache
                    ? '7일·30일은 1시간마다 다시 계산합니다.'
                    : '그 밖의 기간은 하루 한 번(새벽) 갱신합니다.') + '\n' +
                  '오늘 숫자는 아직 다 안 모여서 ' +
                  (through ? through.slice(4, 6) + '월 ' + through.slice(6, 8) + '일' : '어제') +
                  '까지만 넣습니다.' }) +
      verify;
  }

  // ── 지면별 노출 현황 (오늘 라이브 슬롯 + 노출 타임라인 병합, 지면 드롭다운) ──
  // 공지탭·이벤트탭 = 어드민 '공지사항' 메뉴가 원천 — 종료일 칸이 없어 등록하면 상시 노출.
  // 서버 banner_store.NOTICE_TAB_SURFACES 와 같은 집합이어야 한다.
  var SV_NOEND = { side_notice: true, side_event: true };
  // 선택한 지면이 전부 공지탭·이벤트탭이면 종료일을 받을 수 없다(편집 창 필수 검증에서 뺀다).
  function noticeOnly(keys) {
    return !!(keys && keys.length) && keys.every(function (k) { return !!SV_NOEND[k]; });
  }
  // 구좌가 1-2개뿐이라 가로 한 줄을 다 쓰면 빈 공간만 넓어지는 지면 → 2열 배치
  var SV_NARROW = { search: true, side: true, side_notice: true, side_event: true };

  function svSurfaces() {
    return (VX.reg.surfaces || []).filter(function (s) {
      return (VX.reg.banners || []).some(function (b) { return (b.surfaces || []).indexOf(s.key) > -1; });
    });
  }
  // 기간 칸이 비면 제약 없음 — 어드민이 기간 없이 켜 두면 앱은 계속 노출한다(isLive 와 같은 규칙).
  function svIsLive(b, key, day) {
    if (!b || !b.active || b.planned) return false;
    var s = pd(b.startDate);
    if (s && s > day) return false;
    if (SV_NOEND[key]) return true;                 // 공지탭: 시작만 지나면 상시 라이브
    var e = pd(b.endDate);
    return !e || day <= e;
  }
  function svLiveOf(key, day) {
    return (VX.reg.banners || [])
      .filter(function (b) { return (b.surfaces || []).indexOf(key) > -1 && svIsLive(b, key, day); })
      .sort(slotSort);
  }

  // 배너 상세(읽기 전용). 지면별 노출 현황의 슬롯 카드·타임라인 막대를 누르면 뜬다.
  // 수정 창은 배너 관리자만 열 수 있어서, 누구나 내용을 볼 수 있게 따로 둔다. 관리자는 여기서 수정으로 넘어간다.
  function openBannerDetail(bid) {
    var b = bannerById(bid); if (!b) return;
    var today = kstToday();
    var labels = {};
    (VX.reg.surfaces || []).forEach(function (s) { labels[s.key] = s.label; });
    function md(v) { var d = pd(v); return d ? (d.getMonth() + 1) + '/' + d.getDate() : ''; }
    var status = b.planned ? (isRetiredPlan(b) ? '미개시' : '예정') : (b.active ? '활성' : '비활성');
    var surf = (b.surfaces || []).map(function (k) {
      var cn = (b.contentIds || {})[k];
      var idx = svLiveOf(k, today).indexOf(b);
      return '<div>' + esc(labels[k] || k) + (cn ? ' <b class="bn-cn-tag">#' + esc(cn) + '</b>' : '') +
        (idx > -1 ? ' · 오늘 ' + (idx + 1) + '순위' : '') + '</div>';
    }).join('');
    var slots = (Array.isArray(b.slots) ? b.slots : []).filter(function (g) { return pd(g.from); }).map(function (g) {
      return '<div>' + esc(md(g.from) + (g.to && g.to !== g.from ? ' - ' + md(g.to) : '')) +
        (g.rank ? ' · ' + esc(String(g.rank)) + '순위' : '') +
        (g.seq ? ' <b class="bn-cn-tag">#' + esc(String(g.seq)) + '</b>' : '') + '</div>';
    }).join('');
    var period = (b.startDate || '시작일 없음') + ' - ' + (b.endDate || '종료일 없음');
    var cond = [(b.startTime || b.endTime) ? (b.startTime || '') + ' - ' + (b.endTime || '') : '', b.dayCondition || '']
      .filter(Boolean).join(' · ');
    var avg = clickAvgForBanner(b, 7);
    // 이미지: 지면별 번호 → URL. 메인 홈 팝업은 메인 피드를 먼저 보고, 없으면 서버 목록(앱에 지금 떠 있는
    // 배너 + 어드민 스냅샷의 등록만 된 예정 배너)을 본다. 예정 행은 구좌 계획의 imgSeq(그 기간에 쓸 소재의
    // 어드민 번호)로 찾는다. 새 소재라 어드민에 아직 없으면 이미지가 없다.
    // 목록은 창을 처음 열 때 한 번 받아 두고, 받는 동안엔 비워 둔다.
    function imageOf(k, seq) {
      seq = String(seq || '');
      if (!seq) return '';
      if (k === 'main' && VX.mainFeed && VX.mainFeed.notices) {
        var n = VX.mainFeed.notices.filter(function (x) { return String(x.id) === seq && x.imgUrl; })[0];
        if (n) return n.imgUrl;
      }
      var ai = VX.appImages || {};
      return (ai[k] && ai[k][seq]) || '';
    }
    function images() {
      var out = [], seen = {};
      var cids = b.contentIds || {};
      function add(k, seq, label) {
        var url = imageOf(k, seq);
        if (url && !seen[url]) { seen[url] = true; out.push({ label: label, url: url }); }
      }
      (b.surfaces || []).forEach(function (k) {
        if (['main', 'bottom', 'search', 'side'].indexOf(k) < 0) return;
        add(k, cids[k] || (k === 'main' ? b.adminId : ''), labels[k] || k);
        (Array.isArray(b.slots) ? b.slots : []).forEach(function (g) {
          if (g.imgSeq) add(k, g.imgSeq, (labels[k] || k) + ' · ' + md(g.from) + ' 부터 · #' + g.imgSeq);
        });
      });
      return out;
    }
    function imgHtml() {
      var list = images();
      if (!list.length) return '';
      return '<div class="bd-imgs">' + list.map(function (x) {
        return '<figure class="bd-img"><img src="' + esc(x.url) + '" alt="" loading="lazy">' +
          (list.length > 1 || b.planned ? '<figcaption>' + esc(x.label) + '</figcaption>' : '') + '</figure>';
      }).join('') + '</div>';
    }
    var img = '<div id="bd-img-slot">' + imgHtml() + '</div>';
    var needApp = !VX.appImages;
    if (needApp && !VX._appImagesLoading) {
      VX._appImagesLoading = true;
      fetchJson('/api/banner-app-images').then(function (r) {
        VX.appImages = (r && r.ok) ? r : { main: {}, bottom: {}, search: {}, side: {} };
      }).catch(function () {
        VX.appImages = { main: {}, bottom: {}, search: {}, side: {} };
      }).then(function () {
        VX._appImagesLoading = false;
        var slot = $id('bd-img-slot');
        if (slot && slot.getAttribute('data-bid') === b.id) slot.innerHTML = imgHtml();
      });
    }
    function row(label, html) { return html ? '<span class="vx-label">' + label + '</span><div class="bd-val">' + html + '</div>' : ''; }
    var body = $id('bn-modal-body');
    body.innerHTML =
      '<button class="vx-modal-close" id="bd-close">×</button>' +
      '<h3>' + esc(b.name || '') + '</h3>' +
      '<div class="bd-chips"><span class="vx-chip cls-' + esc(b['class']) + '">' + esc(b['class'] || '분류 없음') + '</span>' +
      '<span class="vx-chip">' + esc(status) + '</span></div>' + img +
      '<div class="vx-form-grid bd-grid">' +
      row('지면 · 번호', surf) +
      row('기간', esc(period)) +
      row('구좌 계획', slots) +
      row('시간·요일', esc(cond)) +
      row('클릭', avg ? esc('클릭/일 ' + fmtN(avg.clicks) + ' · 유저/일 ' + fmtN(avg.users) + ' (노출된 ' + avg.days + '일 기준)') : '') +
      row('유형', esc(b.bannerType || '')) +
      row('담당', esc(b.owner || '')) +
      row('승인레벨', esc(b.approvalLevel || '')) +
      row('목적', esc(b.objective || '')) +
      row('메모', b.note ? '<div class="bd-note">' + esc(b.note) + '</div>' : '') +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">' +
      (VX.isAdmin ? '<button class="vx-btn" id="bd-edit">수정</button>' : '') +
      '<button class="vx-btn primary" id="bd-ok">닫기</button></div>';
    var ov = $id('bn-modal');
    ov.classList.add('open');
    $id('bd-img-slot').setAttribute('data-bid', b.id);
    function close() {
      ov.classList.remove('open');
      document.removeEventListener('keydown', onEsc);
    }
    function onEsc(e) { if (e.key === 'Escape' && ov.classList.contains('open')) { e.preventDefault(); close(); } }
    document.addEventListener('keydown', onEsc);
    $id('bd-close').onclick = close;
    $id('bd-ok').onclick = close;
    ov.onclick = function (e) { if (e.target === ov) close(); };
    if ($id('bd-edit')) $id('bd-edit').onclick = function () { close(); openBannerEditor(bid); };
  }

  // 한 지면의 인라인 간트 (그 지면 배너만, 공유 날짜창 ctx 사용)
  function svGanttHtml(s, ctx, noEnd) {
    var CW = ctx.CW, N = ctx.N, todayIdx = ctx.todayIdx, start = ctx.start, today = ctx.today, end = ctx.end;
    function colX(dt) { return Math.round((dt - start) / 86400000); }
    var list = (VX.reg.banners || []).filter(function (b) {
      if ((b.surfaces || []).indexOf(s.key) < 0) return false;
      if (!b.active && !b.planned) return false;      // 비활성(삭제)은 제외 — 진행·예정만
      if (isRetiredPlan(b)) return false;             // 미개시로 내린 계획은 예정이 아니다
      // 기간이 비어 있어도 켜져 있으면 노출 중이다 — 시작일 없음=이미 시작, 종료일 없음=무기한.
      var sd = pd(b.startDate);
      if (sd && sd > end) return false;              // 조회창 뒤에 시작 = 아직 볼 것 없음
      if (noEnd) return true;                        // 공지탭: 종료일 무시
      var ed = pd(b.endDate);
      return !ed || ed >= today;
    }).sort(slotSort);
    if (s.key === 'side_notice') list = list.slice(0, 5);   // 공지탭 최대 5개(최신순)
    if (!list.length) return '<div class="sv-gantt-empty">진행 중·예정 일정 없음</div>';
    var headCells = ctx.days.map(function (d, i) {
      var wd = d.getDay();
      var label = (d.getDate() === 1 || i === 0) ? (d.getMonth() + 1) + '/' + d.getDate() : d.getDate();
      return '<span class="sch-tick' + ((wd === 0 || wd === 6) ? ' wknd' : '') + (i === todayIdx ? ' today' : '') +
        '" style="left:' + (i * CW) + 'px;width:' + CW + 'px">' + label + '</span>';
    }).join('');
    var bg = ctx.days.map(function (d, i) {
      var wd = d.getDay();
      return (wd === 0 || wd === 6) ? '<span class="sch-wknd" style="left:' + (i * CW) + 'px;width:' + CW + 'px"></span>' : '';
    }).join('');
    var left = '<div class="sch-row sch-head-l">배너</div>';
    var lanes = '<div class="sch-row sch-head-r">' + headCells + '</div>';
    // 막대 안 순위 = 라이브 배너는 오늘 슬롯 카드와 같은 순위, 예정 배너는 계획한 구좌 번호.
    // 예정 행에 slots([{from,to,rank}])가 있으면 기간별로 막대를 나눠 그린다 — 구좌를 옮기거나
    // 중간에 쉬는 날이 있는 캠페인을 한 줄에 두면서도 실제 노출일과 순위가 보이게.
    var liveRank = {};
    svLiveOf(s.key, today).forEach(function (b, i) { liveRank[b.id] = i + 1; });
    function rankTag(rank, w, faded, color) {
      if (!rank) return '';
      return '<span class="sch-rank" style="color:' + (faded ? esc(color) : '#fff') + '">' +
        esc(String(rank)) + (w >= 52 ? '순위' : '') + '</span>';
    }
    list.forEach(function (b) {
      var sd = pd(b.startDate);
      var color = classColor(b);
      var faded = (!b.active || b.planned);
      left += '<div class="sch-row sch-name"><span class="gdot" style="background:' + esc(color) + '"></span>' +
        '<span class="gnm" title="' + esc(b.name) + (b.adminId ? ' (번호 ' + esc(b.adminId) + ')' : '') + '">' +
        esc(cleanName(b.name)) + '</span></div>';
      var fill = faded ? 'border:1.5px dashed ' + esc(color) + ';background:' + esc(color) + '26;' : 'background:' + esc(color) + ';';
      var segs = (b.planned && Array.isArray(b.slots)) ? b.slots.filter(function (g) { return pd(g.from) && pd(g.to); }) : [];
      if (segs.length) {
        var bars = segs.map(function (g) {
          var gx = colX(pd(g.from)), ge = colX(pd(g.to));
          if (ge < 0 || gx > N - 1) return '';
          gx = Math.max(0, gx); ge = Math.min(N - 1, ge);
          var gw = (ge - gx + 1) * CW - 6;
          return '<span class="sch-bar faded' + (g.rank ? ' has-rank' : '') + '" style="left:' + (gx * CW + 3) + 'px;width:' + gw + 'px;' + fill +
            '" data-bid="' + esc(b.id) + '">' + rankTag(g.rank, gw, true, color) + '</span>';
        }).join('');
        lanes += '<div class="sch-row sch-lane">' + bars + '</div>';
        return;
      }
      // 시작일이 없으면 조회창 왼쪽 끝부터, 종료일이 없으면 열린 막대로 그린다.
      var x = sd ? Math.max(0, colX(sd)) : 0, e, oneDay = false, openEnd = false;
      var ed = pd(b.endDate);
      if (noEnd || !ed) { e = N - 1; openEnd = true; }
      else { e = Math.min(N - 1, colX(ed)); oneDay = (e === x); }
      var w = (e - x + 1) * CW - 6;
      var rank = liveRank[b.id] || (b.planned && b.priority != null && b.priority !== '' ? b.priority : null);
      var barStyle = 'left:' + (x * CW + 3) + 'px;width:' + w + 'px;' + fill;
      lanes += '<div class="sch-row sch-lane"><span class="sch-bar' + (faded ? ' faded' : '') + (oneDay ? ' oneday' : '') +
        (openEnd ? ' openend' : '') + (rank && !oneDay ? ' has-rank' : '') + '" style="' + barStyle + '" data-bid="' + esc(b.id) + '">' +
        (oneDay ? '<span class="sch-1d" style="background:' + esc(color) + '"></span>' : rankTag(rank, w, faded, color)) +
        '</span></div>';
    });
    return '<div class="sv-gantt"><div class="sch"><div class="sch-left">' + left + '</div>' +
      '<div class="sch-scroll"><div class="sch-canvas" style="width:' + (N * CW) + 'px">' +
      '<span class="sch-todayline" style="left:' + (todayIdx * CW + CW / 2) + 'px"></span>' + bg + lanes +
      '</div></div></div></div>';
  }

  // 순서가 정해진 지면(메인 홈 팝업·하단배너)은 구좌(순위)별 줄로 그린다. 한 줄 = 한 순위,
  // 그 자리를 기간별로 어떤 배너가 차지하는지 막대로 보인다(운영 시트 '배너_타임라인'과 같은 모양).
  // 서버(banner_slots.py)가 같은 규칙으로 구좌 충돌을 찾아 모케터로 알린다. 한쪽을 고치면 같이 고친다.
  // - 그날 줄 세우기: 구좌 계획(점선)이 계획한 순위 자리에 들어가고, 어드민 행(실선)이 남은 자리를 앱 순서
  //   (slotSort)로 위에서부터 채운다. 계획 배너가 들어오면 아래 어드민 행은 한 칸씩 밀리고, 배너가 끝나면
  //   아래 배너가 올라온다. 앱처럼 빈 순위는 생기지 않는다. 오늘은 어드민 순서가 곧 슬롯 카드 순위다.
  // - 어드민 행의 구좌 계획은 내일 이후 시작하는 것만 점선으로 잇는다. 이미 시작한 계획은 쓰지 않는다. 오늘은
  //   실제 순위가 정답이다(2026-10-02 10/1 시작 계획이 라이브 배너를 점선으로 덮고 한 칸 아래 줄에 그리던 문제).
  // - 예정 행(점선): slots[{from,to,rank}] 또는 priority. 순위를 알 수 없으면 맨 아래 '순위 미정' 줄.
  // - 구좌 충돌: 계획 둘이 같은 날 같은 순위를 잡거나, 오늘 r순위로 떠 있는 어드민 행이 계획 없이 계속
  //   노출되는데 다른 배너가 r순위로 계획된 경우. 막대를 포개지 않고 줄을 위아래로 나누고 겹친 기간에 빨간 띠.
  var SV_SLOT_LANES = { main: true, bottom: true };
  var SV_END_PLUS1 = { bottom: true };
  function svSlotGanttHtml(s, ctx) {
    var CW = ctx.CW, N = ctx.N, todayIdx = ctx.todayIdx, today = ctx.today, end = ctx.end;
    var items = [];
    (VX.reg.banners || []).forEach(function (b) {
      if ((b.surfaces || []).indexOf(s.key) < 0) return;
      if (!b.active && !b.planned) return;
      if (isRetiredPlan(b)) return;
      var segs = Array.isArray(b.slots) ? b.slots.filter(function (g) { return pd(g.from) && pd(g.to); })
        .sort(function (x, y) { return pd(x.from) - pd(y.from); }) : [];
      function plan(g) { return { b: b, from: pd(g.from), to: pd(g.to), rank: +g.rank || null, adm: false }; }
      if (b.planned) {
        if (segs.length) segs.forEach(function (g) { items.push(plan(g)); });
        else items.push({ b: b, from: pd(b.startDate), to: pd(b.endDate), adm: false,
          rank: (b.priority != null && b.priority !== '') ? (+b.priority || null) : null });
        return;
      }
      var future = segs.filter(function (g) { return pd(g.from) > today; });
      future.forEach(function (g) { items.push(plan(g)); });
      // 하단배너는 어드민 종료일 당일 미노출이라 종료일을 하루 뒤로 입력한다(메인 팝업은 당일까지 노출).
      // 어드민 값이 들어오는 행은 실제 노출 마지막 날로 당겨 그린다. 예정 행은 노출일로 적는다.
      var to = pd(b.endDate);
      if (to && SV_END_PLUS1[s.key]) to = new Date(to.getTime() - 86400000);
      if (future.length) {
        var cut = new Date(pd(future[0].from).getTime() - 86400000);
        if (!to || to > cut) to = cut;
      }
      var from = pd(b.startDate);
      if (from && to && to < from) return;
      items.push({ b: b, from: from, to: to, rank: null, adm: true });
    });
    items = items.filter(function (it) {
      if (it.from && it.from > end) return false;
      return !it.to || it.to >= today;
    });
    if (!items.length) return '<div class="sv-gantt-empty">진행 중·예정 일정 없음</div>';

    function covers(it, d) { return (!it.from || it.from <= d) && (!it.to || d <= it.to); }
    function admOn(d) {
      return items.map(function (it, k) { return k; })
        .filter(function (k) { return items[k].adm && covers(items[k], d); })
        .sort(function (x, y) { return slotSort(items[x].b, items[y].b) || x - y; });
    }
    // 오늘 순위(슬롯 카드와 같다). 계획이 그 순위로 들어오는 날 이 배너가 계속 떠 있으면 충돌이다.
    var hold = {};
    admOn(today).forEach(function (k, n) { hold[k] = n + 1; });
    // 그날 막대별 순위. 계획이 제 순위에 들어가고 어드민 행이 남은 자리를 채운다.
    function rankDay(d) {
      var adm = admOn(d);
      var plan = items.map(function (it, k) { return k; })
        .filter(function (k) { return !items[k].adm && items[k].rank && covers(items[k], d); })
        .sort(function (x, y) { return items[x].rank - items[y].rank || x - y; });
      var out = {}, pos = 1, ai = 0, pi = 0;
      while (ai < adm.length || pi < plan.length) {
        if (pi < plan.length && (items[plan[pi]].rank <= pos || ai >= adm.length)) {
          var r = items[plan[pi]].rank;
          while (pi < plan.length && items[plan[pi]].rank === r) out[plan[pi++]] = pos;
          if (ai < adm.length && hold[adm[ai]] === r) out[adm[ai++]] = pos;
        } else {
          out[adm[ai++]] = pos;
        }
        pos++;
      }
      return out;
    }
    // 오늘 전 날짜는 오늘 자리를 그대로 뒤로 늘인다. 이미 끝난 배너가 목록에 없어 다시 셀 수 없다.
    var todayPos = rankDay(today);
    var dayPos = ctx.days.map(function (d, i) { return i < todayIdx ? todayPos : rankDay(d); });
    // 같은 순위가 이어지는 날끼리 막대 하나. 순위가 바뀌면 거기서 끊는다. p = -1 은 순위 미정 줄.
    var runs = [];
    items.forEach(function (it, k) {
      var cur = null;
      for (var i = 0; i < N; i++) {
        var p = !covers(it, ctx.days[i]) ? 0 : (!it.adm && !it.rank) ? -1 : (dayPos[i][k] || 0);
        if (cur && p === cur.p) { cur.e = i; continue; }
        cur = p ? { it: it, p: p, x: i, e: i } : null;
        if (cur) runs.push(cur);
      }
    });
    var maxRank = s.target || 0;
    runs.forEach(function (r) { if (r.p > maxRank) maxRank = r.p; });
    var hasUnranked = runs.some(function (r) { return r.p === -1; });

    var headCells = ctx.days.map(function (d, i) {
      var wd = d.getDay();
      var label = (d.getDate() === 1 || i === 0) ? (d.getMonth() + 1) + '/' + d.getDate() : d.getDate();
      return '<span class="sch-tick' + ((wd === 0 || wd === 6) ? ' wknd' : '') + (i === todayIdx ? ' today' : '') +
        '" style="left:' + (i * CW) + 'px;width:' + CW + 'px">' + label + '</span>';
    }).join('');
    var bg = ctx.days.map(function (d, i) {
      var wd = d.getDay();
      return (wd === 0 || wd === 6) ? '<span class="sch-wknd" style="left:' + (i * CW) + 'px;width:' + CW + 'px"></span>' : '';
    }).join('');
    function md(i) { var d = ctx.days[i]; return (d.getMonth() + 1) + '/' + d.getDate(); }
    var left = '<div class="sch-row sch-head-l">구좌</div>';
    var lanes = '<div class="sch-row sch-head-r">' + headCells + '</div>';
    function lane(p, label) {
      var mine = runs.filter(function (r) { return r.p === p; })
        .sort(function (a, b) { return a.x - b.x || a.e - b.e; });
      // 기간이 겹치는 막대는 포개지 않고 줄 안에서 위아래 칸으로 나눈다
      var tracks = [];
      mine.forEach(function (r) {
        var t = 0;
        while (t < tracks.length && tracks[t] >= r.x) t++;
        tracks[t] = r.e;
        r.t = t;
      });
      var nT = Math.max(1, tracks.length);
      // 충돌 띠: 같은 날 두 배너 이상이 이 순위를 잡은 기간. 순위 미정 줄은 충돌이 아니다.
      var bands = '', tips = [];
      if (p > 0) {
        var i0 = -1, names = {};
        for (var i = 0; i <= N; i++) {
          var ids = {};
          if (i < N) mine.forEach(function (r) { if (r.x <= i && i <= r.e) ids[r.it.b.id] = cleanName(r.it.b.name); });
          if (Object.keys(ids).length > 1) {
            if (i0 < 0) { i0 = i; names = {}; }
            Object.keys(ids).forEach(function (k) { names[k] = ids[k]; });
          } else if (i0 >= 0) {
            var tip = p + '순위 충돌 ' + md(i0) + (i - 1 > i0 ? '~' + md(i - 1) : '') + ': ' +
              Object.keys(names).map(function (k) { return names[k]; }).join(' · ');
            tips.push(tip);
            bands += '<span class="sch-clash" style="left:' + (i0 * CW) + 'px;width:' + ((i - i0) * CW) + 'px" title="' + esc(tip) + '"></span>';
            i0 = -1;
          }
        }
      }
      var bars = mine.map(function (r) {
        var it = r.it, color = classColor(it.b), faded = !it.adm;
        var w = (r.e - r.x + 1) * CW - 6;
        var openEnd = !it.to && r.e === N - 1;
        var place = nT > 1 ? 'top:' + (6 + r.t * 20) + 'px;height:16px;' : '';
        var fill = faded ? 'border:1.5px dashed ' + esc(color) + ';background:' + esc(color) + '26;' : 'background:' + esc(color) + ';';
        return '<span class="sch-bar slotbar' + (faded ? ' faded' : '') + (openEnd ? ' openend' : '') +
          '" style="left:' + (r.x * CW + 3) + 'px;width:' + w + 'px;' + place + fill + '" data-bid="' + esc(it.b.id) + '">' +
          '<span class="sch-bn" style="max-width:' + Math.max(0, w - 12) + 'px;color:' + (faded ? esc(color) : '#fff') + '">' +
          esc(cleanName(it.b.name)) + '</span></span>';
      }).join('');
      var hs = nT > 1 ? ' style="height:' + (8 + nT * 20) + 'px"' : '';
      left += '<div class="sch-row sch-name"' + hs + '><span class="gnm">' + esc(label) + '</span>' +
        (tips.length ? '<span class="gtag urgent" title="' + esc(tips.join('\n')) + '">충돌</span>' : '') + '</div>';
      lanes += '<div class="sch-row sch-lane"' + hs + '>' + bands + bars + '</div>';
    }
    for (var r = 1; r <= maxRank; r++) lane(r, r + '순위');
    if (hasUnranked) lane(-1, '순위 미정');
    return '<div class="sv-gantt"><div class="sch"><div class="sch-left">' + left + '</div>' +
      '<div class="sch-scroll"><div class="sch-canvas" style="width:' + (N * CW) + 'px">' +
      '<span class="sch-todayline" style="left:' + (todayIdx * CW + CW / 2) + 'px"></span>' + bg + lanes +
      '</div></div></div></div>';
  }

  // 한 지면 영역: 헤더 + 라이브 슬롯 + 인라인 간트
  function svSurfaceSection(s, ctx) {
    var noEnd = !!SV_NOEND[s.key];
    var live = svLiveOf(s.key, ctx.today);
    if (s.key === 'side_notice') live = live.slice(0, 5);   // 공지탭 최대 5개(최신순)
    var slots = live.map(function (b, i) {
      var cn = (b.contentIds || {})[s.key];
      var ownKeys = bannerClickKeys(b), keys = ownKeys.slice(), prevNos = [];
      predecessorsOf(b, s.key).forEach(function (p) {
        var pk = surfaceClickKeys(p, s.key);
        var pa = clickAvgForKeys(pk, 7);
        if (!pa || !pa.days) return;   // 7일 안에 클릭이 없으면 합쳐도 달라지지 않는다
        pk.forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); });
        var pn = (p.contentIds || {})[s.key] || p.adminId;
        if (pn && prevNos.indexOf(String(pn)) < 0) prevNos.push(String(pn));
      });
      var avg = clickAvgForKeys(keys, 7);
      // 클릭은 어제까지만 집계한다. 오늘 시작한 배너는 기록이 없어 0 이 아니라 '집계 전' 이다.
      var through = (VX.clicks && VX.clicks.through) ? String(VX.clicks.through) : '';
      var startYmd = String(b.startDate || '').replace(/-/g, '');
      var pending = !!(avg && !avg.days && through && startYmd && startYmd > through);
      var dd = noEnd ? '상시' : (function () {
        var e = pd(b.endDate);
        return e ? ('D-' + Math.round((e - ctx.today) / 86400000)) : '기간 미설정';
      })();
      // 값마다 이름표를 붙인다 — 숫자 둘을 라벨 하나로 설명하면 어느 게 어느 건지 매핑해야 한다.
      // 평균 기준(며칠)은 카드 상단에 한 번만 밝히고, 정확한 일수는 툴팁에 둔다.
      // 툴팁은 각 값에 직접 건다 — 바깥 한 겹에만 걸면 숫자·라벨 위에서 안 뜨고
      // 커서만 바뀌어, 뭔가 있는 줄 알고 기다리다 마는 일이 생긴다.
      var tipBase = avg ? ('노출된 ' + avg.days + '일 기준 일평균' +
        (prevNos.length ? '\n같은 구좌 이전 번호 #' + prevNos.join('·#') + ' 포함' : '')) : '';
      var clkHtml = pending
        ? '<span class="clk has-tip"><span class="clk-cell pend" data-tip="' +
          esc('클릭은 어제까지 집계합니다.\n오늘 시작한 배너는 내일부터 숫자가 나옵니다.') + '">' +
          '<b>집계 전</b><em>클릭·유저</em></span></span>'
        : avg
        ? '<span class="clk has-tip">' +
          '<span class="clk-cell" data-tip="' + esc('클릭 · ' + tipBase) + '">' +
          '<b>' + fmtN(avg.clicks) + '</b><em>클릭/일</em></span>' +
          '<span class="clk-cell sub" data-tip="' + esc('고유 유저 · ' + tipBase) + '">' +
          '<b>' + fmtN(avg.users) + '</b><em>유저/일</em></span></span>'
        : '<span class="clk"></span>';
      return '<div class="bnl-slot" data-bid="' + esc(b.id) + '" style="border-left-color:' + esc(classColor(b)) + '">' +
        '<div class="top"><span class="rank">' + (i + 1) + '순위</span>' +
        '<span class="vx-chip cls-' + esc(b['class']) + '">' + esc(b['class']) + '</span></div>' +
        '<div class="bnm" title="' + esc(b.name) + '">' + esc(cleanName(b.name)) +
        (cn ? ' <b class="bn-cn-tag">#' + esc([cn].concat(prevNos).join('·')) + '</b>' : '') + '</div>' +
        '<div class="ft">' + clkHtml +
        '<span class="dd">' + esc(dd) + '</span></div></div>';
    }).join('');
    var gap = (s.target && !noEnd) ? Math.max(0, s.target - live.length) : 0;
    for (var g = 0; g < gap; g++) slots += '<div class="bnl-slot empty">슬롯 공백 — 배너 추가 필요</div>';
    if (!slots) slots = '<div class="bnl-slot empty">라이브 없음</div>';
    var cnt = '라이브 ' + live.length + (s.max ? ' / 최대 ' + s.max : '');
    var bad = (s.target && live.length < s.target) || (s.max && live.length > s.max);
    // 슬롯이 1개뿐인 좁은 지면은 한 줄을 통째로 쓰면 여백만 커진다 → 2열로 나란히.
    return '<div class="sv-surface' + (SV_NARROW[s.key] ? ' sv-half' : '') + '">' +
      '<div class="sv-surf-hd"><span class="nm">' + esc(s.label) + (noEnd ? ' <span class="sch-noend">상시</span>' : '') + '</span>' +
      '<span class="sv-surf-cnt ' + (bad ? 'bad' : 'ok') + '">' + esc(cnt) + '</span></div>' +
      '<div class="sv-slots-row">' + slots + '</div>' +
      '<details class="sv-gantt-wrap"><summary class="sv-gantt-toggle">타임라인</summary>' +
      (SV_SLOT_LANES[s.key] ? svSlotGanttHtml(s, ctx) : svGanttHtml(s, ctx, noEnd)) + '</details></div>';
  }

  function renderSurfaceView() {
    var host = $id('bn-surface-board'); if (!host) return;
    var surfs = svSurfaces();
    var today = kstToday();
    var start = new Date(today.getTime() - 14 * 86400000);
    var end = new Date(today.getTime() + 42 * 86400000);
    var days = [];
    for (var d = new Date(start.getTime()); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d.getTime()));
    var ctx = { today: today, start: start, end: end, days: days, N: days.length, CW: 34, todayIdx: Math.round((today - start) / 86400000) };
    var sections = surfs.map(function (s) { return svSurfaceSection(s, ctx); }).join('');
    host.innerHTML = sections
      ? '<div class="sv-grid">' + sections + '</div>'
      : '<div class="vx-empty">표시할 지면이 없습니다.</div>';
    // 슬롯 카드·타임라인 막대를 누르면 그 배너 상세. 한 번만 건다(재렌더마다 innerHTML 만 바뀐다).
    if (!host._detailBound) {
      host._detailBound = true;
      host.addEventListener('click', function (e) {
        var el = e.target.closest && e.target.closest('[data-bid]');
        if (el && host.contains(el)) openBannerDetail(el.getAttribute('data-bid'));
      });
    }
    // 간트는 기본 접힘 — 펼칠 때 오늘 근처로 스크롤
    host.querySelectorAll('details.sv-gantt-wrap').forEach(function (d) {
      d.addEventListener('toggle', function () {
        if (!d.open) return;
        var w = d.querySelector('.sch-scroll');
        if (w) w.scrollLeft = Math.max(0, ctx.todayIdx * ctx.CW - 200);
      });
    });
    host.insertAdjacentHTML('beforeend',
      '<div class="vx-note" style="margin-top:12px">간트는 눌러서 펼침 · 노란 세로선 = 오늘 · 점선 막대 = 예정 · 빨간 테두리 = 같은 구좌 기간 겹침 · 오른쪽 페이드 = 상시(공지탭·종료일 없음) · 카드·막대를 누르면 배너 상세</div>');
  }

  // 오늘 라이브 보드 — 슬롯 레인형 (지면당 한 줄, 빈 슬롯은 점선 공백, 순환 하이라이트)
  function renderLiveBoard() {
    var host = $id('bn-board');
    var today = kstToday();
    (VX.rotTimers || []).forEach(clearInterval);
    VX.rotTimers = [];
    var html = '';
    var quiet = [];
    (VX.reg.surfaces || []).forEach(function (s) {
      var live = liveBannersOf(s.key, today);
      var upcoming = (VX.reg.banners || []).filter(function (b) {
        if ((b.surfaces || []).indexOf(s.key) < 0) return false;
        var sd = pd(b.startDate);
        return sd && sd > today && (sd - today) / 86400000 <= 14 && (b.active || b.planned);
      }).sort(function (a, b) { return pd(a.startDate) - pd(b.startDate); });
      if (!live.length && !upcoming.length) { quiet.push(s.label); return; }

      var gap = s.target ? Math.max(0, s.target - live.length) : 0;
      var stTxt = s.target
        ? ('라이브 ' + live.length + ' / 목표 ' + s.target + (gap ? ' · 공백 ' + gap : ''))
        : ('라이브 ' + live.length + ' / 최대 ' + s.max);
      var bad = s.target ? live.length !== s.target : live.length > (s.max || 99);

      var cards = live.map(function (b, i) {
        var st = bannerStatus(b);
        var clk = clicksForBanner(b, 7);
        var period = (b.startDate || '').slice(5).replace('-', '/') + ' - ' + (b.endDate || '').slice(5).replace('-', '/');
        var dLeft = st.t.indexOf('D-') > -1 ? st.t.slice(st.t.indexOf('D-')) : '';
        return '<div class="bnl-slot" data-rot-idx="' + i + '" style="border-left-color:' + esc(classColor(b)) + '">' +
          '<div class="top"><span class="rank">' + (i + 1) + '순위</span>' +
          (st.k === 'urgent'
            ? '<span class="bn-st st-urgent">' + esc(dLeft) + ' 만료임박</span>'
            : '<span class="vx-chip cls-' + esc(b['class']) + '">' + esc(b['class']) + '</span>') +
          '</div>' +
          '<div class="bnm" title="' + esc(b.name) + '">' + esc(cleanName(b.name)) + '</div>' +
          '<div class="ft"><span class="clk" title="최근 7일 클릭">' + (clk != null ? fmtN(clk) : '') + '</span>' +
          '<span class="dd" title="' + esc(period) + '">' + esc(dLeft || period) + '</span></div>' +
          '</div>';
      }).join('');
      for (var g = 0; g < gap; g++) {
        cards += '<div class="bnl-slot empty">슬롯 공백 — 배너 추가 필요</div>';
      }
      cards += upcoming.map(function (b) {
        return '<div class="bnl-slot next" style="border-left-color:' + esc(classColor(b)) + '">' +
          '<div class="top"><span class="rank">대기</span><span class="bn-st st-plan">예정</span></div>' +
          '<div class="bnm" title="' + esc(b.name) + '">' + esc(cleanName(b.name)) + '</div>' +
          '<div class="ft"><span class="clk"></span><span class="dd">' +
          esc((b.startDate || '').slice(5).replace('-', '/')) + ' 시작' + (b.planned ? ' · 어드민 미등록' : '') +
          '</span></div></div>';
      }).join('');

      html += '<div class="bnl" data-sk="' + esc(s.key) + '">' +
        '<div class="bnl-hd"><span class="nm">' + esc(s.label) + '</span>' +
        '<span class="st ' + (bad ? 'bad' : 'ok') + '">' + esc(stTxt) + '</span></div>' +
        '<div class="bnl-slots">' + cards + '</div></div>';
    });
    if (quiet.length) {
      html += '<div class="bnl-note">라이브 없음: ' + esc(quiet.join(' · ')) + '</div>';
    }
    host.innerHTML = html || '<div class="vx-empty">표시할 지면이 없습니다.</div>';

    // 노출 순환 하이라이트 (구좌 순서대로 4초, 호버 정지)
    host.querySelectorAll('.bnl').forEach(function (lane) {
      var slots = lane.querySelectorAll('.bnl-slot[data-rot-idx]');
      if (slots.length === 1) { slots[0].classList.add('on'); return; }
      if (slots.length < 2) return;
      var idx = 0, paused = false;
      slots[0].classList.add('on');
      var t = setInterval(function () {
        if (paused || VX.view !== 'banner') return;
        idx = (idx + 1) % slots.length;
        for (var k = 0; k < slots.length; k++) slots[k].classList.toggle('on', k === idx);
      }, 4000);
      VX.rotTimers.push(t);
      lane.addEventListener('mouseenter', function () { paused = true; });
      lane.addEventListener('mouseleave', function () { paused = false; });
    });
  }

  // 실시간 메인 팝업 (앱 실측 notices.json) — 운영표와 대조해 드리프트 감지 + 배너 이미지 표시
  function renderMainLiveFeed() {
    var host = $id('bn-mainfeed');
    if (!host) return;
    var f = VX.mainFeed;
    // 정상 표시된 미리보기가 로딩/실패 재렌더로 사라지지 않게: 한 번 뜬 뒤엔 빈 상태로 덮지 않는다.
    if ((!f || !f.ok) && VX._feedShown) return;
    if (!f) { host.innerHTML = '<div class="vx-loading">앱 실측 불러오는 중…</div>'; return; }
    if (!f.ok) {
      host.innerHTML = '<div class="vx-empty">앱 실측 피드를 불러오지 못했습니다' +
        (f.error ? ' (' + esc(f.error) + ')' : '') + '</div>';
      // 피드가 없어도 종료일 판정은 운영표만으로 된다. 앱 조회가 막혔다고 닫아야 할
      // 공지까지 안 보이면, 조회가 막힌 동안 방치가 그대로 쌓인다.
      VX._issues = ((VX.reg && VX.reg.banners) || []).filter(isSideTabRow).filter(needsClose)
        .map(function (b) {
          var cid = b.contentIds || {};
          return { kind: '닫기 필요', rail: 'rail-red', name: cleanName(b.name),
                   num: cid.side_notice || cid.side_event || '',
                   hint: (b.noticeTab || '') + '탭 · 종료일에서 ' + overdueDays(b) + '일 경과' +
                         (b.endDate ? '' : ' (같은 소재 배너로 추정한 종료일)') + ' → 어드민에서 내리기',
                   bid: b.id, nid: '', focus: 'period' };
        });
      renderBannerIssues();
      return;
    }
    // 앱 실측 vs 운영표 드리프트 — MECE 5분류(대시보드·슬랙 동일 기준)
    var today = kstToday();
    var regMainId = function (b) { return String((b.contentIds || {}).main || b.adminId || ''); };
    var feedLive = (f.notices || []).filter(function (n) { return n.live; })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });  // 앱 실제 노출 순서
    var feedLiveIds = feedLive.map(function (n) { return String(n.id); });
    var regLive = liveBannersOf('main', today);
    var regLiveIds = regLive.map(regMainId);
    // allRegIds = 운영표에 있는 메인 등록번호(존재 여부). 아래 분기가 이 참/거짓에 걸려 있어
    // 값을 배너 id 로 바꾸지 않는다. 편집 모달을 열려면 번호로 배너 id 를 찾아야 해서 맵을 따로 둔다.
    var allRegIds = {}, regBidByMainId = {};
    ((VX.reg && VX.reg.banners) || []).forEach(function (b) {
      if ((b.surfaces || []).indexOf('main') > -1) {
        var id = regMainId(b);
        if (id) { allRegIds[id] = true; regBidByMainId[id] = b.id; }
      }
    });

    // A. 앱 라이브 · 운영표 라이브 아님
    var unregistered = [], periodChange = [];
    feedLive.forEach(function (n) {
      var id = String(n.id);
      if (regLiveIds.indexOf(id) > -1) return;
      (allRegIds[id] ? periodChange : unregistered).push(n);
    });
    // B. 운영표 라이브 · 앱엔 없음
    var earlyEnd = [], notSet = [];
    regLive.forEach(function (b) {
      if (feedLiveIds.indexOf(regMainId(b)) > -1) return;
      var s = pd(b.startDate);
      (s && s < today ? earlyEnd : notSet).push(b);
    });
    // C. 순번 — 양쪽 라이브 id의 앱 순서 vs 운영표 기본 순서(번호 내림차순)
    var matchedApp = feedLiveIds.filter(function (id) { return regLiveIds.indexOf(id) > -1; });
    var matchedReg = matchedApp.slice().sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); });
    var orderApp = (matchedApp.join(',') !== matchedReg.join(',')) ? matchedApp : [];

    // 자동 등록분(어드민 푸시·앱 실측)은 분류를 비운 채 들어온다 — 사람이 정하는 값이라
    // 서버가 임의로 채우지 않는다. 비어 있으면 색·집계·승인레벨 판단이 다 빠지므로
    // 기간 불일치와 같은 급으로 드러낸다.
    var noClass = (VX.reg.banners || []).filter(function (b) {
      return (b.active || b.planned) && !isRetiredPlan(b) && !String(b['class'] || '').trim();
    }).sort(slotSort);
    var driftCount = unregistered.length + periodChange.length + earlyEnd.length + notSet.length +
      noClass.length + (orderApp.length ? 1 : 0);
    // 배지·시각은 상단 '데이터 갱신' 줄로 모았다. 여기서는 결과만 넘긴다.
    VX._drift = { n: driftCount };
    renderFreshness();

    // 같은 항목을 헤더 「수정 필요」 칩으로도 올린다 — 화면을 내려야 보이던 것을 첫 줄에서
    // 알게 한다(CRM 뷰의 칩과 같은 모양·같은 동작). 닫기 필요는 앱 실측 대조가 아니라
    // 종료일 판정이라 검증 건수에는 섞지 않고, 이 목록에만 함께 싣는다.
    var issues = [];
    function pushIssue(kind, rail, name, num, hint, bid, nid, focus) {
      issues.push({ kind: kind, rail: rail, name: name, num: num || '', hint: hint,
                    bid: bid || '', nid: nid || '', focus: focus || '' });
    }
    unregistered.forEach(function (n) {
      pushIssue('미등록', 'rail-red', cleanName(n.title || ''), n.id,
                '앱엔 라이브인데 운영표에 없음 → 운영표에 추가', '', String(n.id), 'class');
    });
    periodChange.forEach(function (n) {
      pushIssue('기간 변경', 'rail-red', cleanName(n.title || ''), n.id,
                '운영표 항목은 있으나 기간이 다름 → 운영표 기간 수정',
                regBidByMainId[String(n.id)], '', 'period');
    });
    earlyEnd.forEach(function (b) {
      pushIssue('조기 종료', 'rail-amber', cleanName(b.name), regMainId(b),
                '운영표는 라이브인데 앱에서 내려감 → 운영표 종료 처리', b.id, '', 'period');
    });
    notSet.forEach(function (b) {
      pushIssue('앱 미노출', 'rail-amber', cleanName(b.name), regMainId(b),
                '오늘 시작인데 앱에 세팅 안 됨 → 앱 세팅 확인', b.id, '', 'period');
    });
    noClass.forEach(function (b) {
      var cid = b.contentIds || {};
      pushIssue('분류 미지정', 'rail-red', cleanName(b.name),
                cid.main || cid.bottom || cid.search || cid.side || cid.side_event || cid.side_notice || '',
                '자동 등록되어 분류가 비어 있음 → 자체·광고·제휴·공공 중 지정', b.id, '', 'class');
    });
    if (orderApp.length) {
      pushIssue('순번 불일치', 'rail-amber', '메인 홈 팝업 노출 순서', '',
                '앱 실제 순서 ' + orderApp.map(function (id) { return '#' + id; }).join(' › ') +
                ' · 운영표 기본 순서와 다름');
    }
    ((VX.reg && VX.reg.banners) || []).filter(isSideTabRow).filter(needsClose).forEach(function (b) {
      var cid = b.contentIds || {};
      pushIssue('닫기 필요', 'rail-red', cleanName(b.name), cid.side_notice || cid.side_event || '',
                (b.noticeTab || '') + '탭 · 종료일에서 ' + overdueDays(b) + '일 경과' +
                (b.endDate ? '' : ' (같은 소재 배너로 추정한 종료일)') + ' → 어드민에서 내리기',
                b.id, '', 'period');
    });
    VX._issues = issues;
    renderBannerIssues();
    var badge = '';
    var when = f._stale ? '앱 실측 갱신 실패 — 직전 값 표시 중' : '';

    var cards = feedLive.map(function (n, i) {
      var id = String(n.id);
      var inRegLive = regLiveIds.indexOf(id) > -1;
      var tag, miss = !inRegLive;
      if (inRegLive) tag = '<span class="mf-tag ok">등록됨</span>';
      else if (allRegIds[id]) tag = '<span class="mf-tag warn">기간 변경</span>';
      else tag = '<span class="mf-tag warn">미등록</span>';
      var period = (n.start || '').slice(5).replace('-', '/') + ' - ' + (n.end || '').slice(5).replace('-', '/');
      var img = n.imgUrl
        ? '<div class="mf-thumb"><img src="' + esc(n.imgUrl) + '" alt="" loading="lazy" onerror="this.parentNode.classList.add(\'noimg\')"></div>'
        : '<div class="mf-thumb noimg"></div>';
      return '<div class="mf-card' + (miss ? ' miss' : '') + '">' +
        '<div class="mf-rank">' + (i + 1) + '순위</div>' + img +
        '<div class="mf-meta"><div class="mf-nm" title="' + esc(n.title) + '">' + esc(cleanName(n.title)) + '</div>' +
        '<div class="mf-sub">#' + esc(n.id) + ' · ' + esc(period) + '</div>' + tag + '</div></div>';
    }).join('');

    // 알림에서 편집 모달로 바로 — 고쳐야 할 배너를 목록에서 다시 찾게 만들지 않는다.
    // 운영표에 항목이 있으면 '수정하기', 앱에만 있고 운영표에 없으면 실측값을 채운 '등록하기'.
    VX._driftSeed = {};
    // focus = 편집 모달을 열었을 때 강조할 항목. 무엇을 고치러 들어왔는지 화면이 알려 준다.
    // fmt 는 {t: 표시할 텍스트, b: 버튼 HTML} 를 돌려준다 — 조립은 driftLine 이 한다.
    function fixBtn(bid, focus) {
      return bid ? '<button type="button" class="mf-fix" data-bid="' + esc(bid) + '"' +
        (focus ? ' data-focus="' + esc(focus) + '"' : '') + '>수정하기</button>' : '';
    }
    function addBtn(n) {
      var key = String(n.id);
      VX._driftSeed[key] = {
        name: cleanName(n.title || ''), surfaces: ['main'], contentIds: { main: key },
        startDate: n.start || '', endDate: n.end || '', active: true, planned: false
      };
      return '<button type="button" class="mf-fix" data-nid="' + esc(key) + '" data-focus="class">등록하기</button>';
    }
    function nFmt(focus) {
      return function (n) {
        return { t: cleanName(n.title || '') + ' (#' + n.id + ')',
                 b: fixBtn(regBidByMainId[String(n.id)], focus) };
      };
    }
    function bFmt(focus) {
      return function (b) {
        return { t: cleanName(b.name) + ' (#' + regMainId(b) + ')', b: fixBtn(b.id, focus) };
      };
    }
    // 미등록은 고칠 항목이 아직 없다 — 실측값을 채운 신규 등록으로 보낸다.
    var uFmt = function (n) {
      return { t: cleanName(n.title || '') + ' (#' + n.id + ')', b: addBtn(n) };
    };
    // 한 줄에 한 항목. 라벨·설명은 첫 줄 앞에 붙여 둔다 — 따로 한 줄을 잡아먹지 않게.
    // 버튼은 오른쪽 끝에 맞춘다(쉼표로 이어 붙이면 버튼이 이름 길이만큼 들쭉날쭉해진다).
    function driftLine(cls, label, desc, items, fmt) {
      if (!items.length) return '';
      return '<div class="mf-drift ' + cls + '">' + items.map(fmt).map(function (r, i) {
        var pre = i === 0 ? '<b>' + label + '</b> — ' + desc + ': ' : '';
        return '<div class="mf-item"><span class="mf-item-nm" title="' + esc(r.t) + '">' +
          pre + esc(r.t) + '</span>' + r.b + '</div>';
      }).join('') + '</div>';
    }
    var driftHtml =
      driftLine('miss', '미등록', '앱엔 라이브인데 운영표에 없음 → 운영표에 추가', unregistered, uFmt) +
      driftLine('miss', '기간 변경', '운영표 항목은 있으나 기간이 다름 → 운영표 기간 수정', periodChange, nFmt('period')) +
      driftLine('', '조기 종료', '운영표는 라이브인데 앱에서 내려감 → 운영표 종료 처리', earlyEnd, bFmt('period')) +
      driftLine('', '앱 미노출', '오늘 시작인데 앱에 세팅 안 됨 → 앱 세팅 확인', notSet, bFmt('period')) +
      driftLine('miss', '분류 미지정', '자동 등록되어 분류가 비어 있음 → 편집에서 자체·광고·제휴·공공 중 지정',
                noClass, function (b) {
                  var cid = (b.contentIds || {});
                  var n = cid.main || cid.bottom || cid.search || cid.side || cid.side_event || cid.side_notice || '';
                  return { t: cleanName(b.name) + (n ? ' (#' + n + ')' : ''),
                           b: fixBtn(b.id, 'class') };
                }) +
      (orderApp.length
        ? '<div class="mf-drift order"><b>순번 불일치</b> — 앱 실제 노출 순서(정답): ' +
          orderApp.map(function (id) { return '#' + esc(id); }).join(' › ') + ' · 운영표 기본 순서와 다름</div>'
        : '');

    // 실제 배너처럼 움직이는 미리보기 — 라이브 팝업 이미지를 지면 순서대로 순환(4초)
    // 좌우 수동 이동·정지/재생·고유번호+기간 캡션 지원
    var heroSlides = feedLive.filter(function (n) { return n.imgUrl; });
    function heroPeriod(n) {
      return (n.start || '').slice(5).replace('-', '/') + ' - ' + (n.end || '').slice(5).replace('-', '/');
    }
    var heroHtml = heroSlides.length
      ? '<div class="mf-hero" id="mf-hero">' +
        heroSlides.map(function (n, i) {
          return '<div class="mf-slide' + (i === 0 ? ' on' : '') + '">' +
            '<img src="' + esc(n.imgUrl) + '" alt="" loading="lazy">' +
            '<span class="mf-slide-cap">' +
              '<span class="mf-cap-nm">' + (i + 1) + '순위 · ' + esc(cleanName(n.title)) + '</span>' +
              '<span class="mf-cap-meta">#' + esc(n.id) + ' · ' + esc(heroPeriod(n)) + '</span>' +
            '</span></div>';
        }).join('') +
        (heroSlides.length > 1
          ? '<button class="mf-nav prev" id="mf-prev" aria-label="이전">‹</button>' +
            '<button class="mf-nav next" id="mf-next" aria-label="다음">›</button>' +
            '<button class="mf-play" id="mf-play" aria-label="정지/재생">❚❚</button>'
          : '') +
        '<div class="mf-dots">' + heroSlides.map(function (n, i) { return '<span class="mf-dot' + (i === 0 ? ' on' : '') + '" data-i="' + i + '"></span>'; }).join('') + '</div>' +
        '</div>'
      : '';

    host.innerHTML =
      '<div class="mf-head">' + badge + '<span class="mf-when">' + when + '</span></div>' +
      heroHtml +
      (heroSlides.length ? '' : '<div class="vx-empty">앱에 노출 중인 메인 팝업이 없습니다.</div>') +
      driftHtml;
    if (heroSlides.length) VX._feedShown = true;

    // 알림의 수정하기·등록하기 → 편집 모달 바로 열기
    host.querySelectorAll('.mf-fix').forEach(function (btn) {
      btn.onclick = function () {
        var bid = btn.dataset.bid, focus = btn.dataset.focus;
        if (bid) { openBannerEditor(bid, null, focus); return; }
        openBannerEditor(null, VX._driftSeed[btn.dataset.nid], focus);
      };
    });

    // hero 순환 + 수동 컨트롤
    var hero = $id('mf-hero');
    if (hero && heroSlides.length > 1) {
      var slides = hero.querySelectorAll('.mf-slide');
      var dots = hero.querySelectorAll('.mf-dot');
      var hi = 0, hpaused = false;
      function show(idx) {
        hi = (idx + slides.length) % slides.length;
        for (var k = 0; k < slides.length; k++) {
          slides[k].classList.toggle('on', k === hi);
          if (dots[k]) dots[k].classList.toggle('on', k === hi);
        }
      }
      var ht = setInterval(function () {
        if (hpaused || VX.view !== 'banner') return;
        show(hi + 1);
      }, 4000);
      VX.rotTimers.push(ht);
      function setPaused(p) {
        hpaused = p;
        var pb = $id('mf-play');
        if (pb) { pb.innerHTML = p ? '▶' : '❚❚'; pb.classList.toggle('paused', p); }
      }
      var prev = $id('mf-prev'), next = $id('mf-next'), play = $id('mf-play');
      if (prev) prev.onclick = function (e) { e.preventDefault(); setPaused(true); show(hi - 1); };
      if (next) next.onclick = function (e) { e.preventDefault(); setPaused(true); show(hi + 1); };
      if (play) play.onclick = function (e) { e.preventDefault(); setPaused(!hpaused); };
      dots.forEach(function (d) {
        d.onclick = function (e) { e.preventDefault(); setPaused(true); show(parseInt(d.dataset.i, 10)); };
      });
    }
  }

  // 노출 타임라인 — 오늘 기준 직전 2주에서 +6주, 일 단위 레인 바 (에디토리얼)
  function renderGantt() {
    var host = $id('bn-gantt');
    var today = kstToday();
    var start = new Date(today.getTime() - 14 * 86400000);
    var end = new Date(today.getTime() + 42 * 86400000);
    var days = [];
    for (var d = new Date(start.getTime()); d <= end; d.setDate(d.getDate() + 1)) days.push(new Date(d.getTime()));
    var N = days.length, CW = 34, LANE = 44, GRP = 34, HEAD = 34, CNT = 30;

    // 표시 행: 윈도우와 겹치는 배너 (지면 순 main → 기타, 슬롯순)
    var groups = [];
    (VX.reg.surfaces || []).forEach(function (s) {
      var list = (VX.reg.banners || []).filter(function (b) {
        if ((b.surfaces || []).indexOf(s.key) < 0) return false;
        var sd = pd(b.startDate), ed = pd(b.endDate);
        if (b.planned && !sd) return false; // 기간 미정 예정은 타임라인 제외 (관리 목록에서 확인)
        if (isRetiredPlan(b)) return false; // 미개시(개시일 지남·어드민 미등록)로 내린 계획은 제외
        if (sd && sd > end) return false;
        // 종료일이 지난 항목은 제외 — 진행 중(오늘 이후 종료)·예정만 노출 (어드민 OFF 여부와 무관).
        // 종료일이 없으면 무기한이라 계속 진행 중이다.
        return !ed || ed >= today;
      }).sort(slotSort);
      if (list.length) groups.push({ surface: s, list: list });
    });
    if (!groups.length) { host.innerHTML = '<div class="vx-empty">표시할 일정이 없습니다.</div>'; return; }

    var todayIdx = Math.round((today - start) / 86400000);
    function colX(dt) { return Math.round((dt - start) / 86400000); }

    // 좌측 라벨 + 우측 캔버스(같은 행 높이) 구성
    var left = '<div class="sch-row sch-head-l">지면 · 배너</div>';
    var lanes = '';
    var headCells = days.map(function (d, i) {
      var wd = d.getDay();
      var label = (d.getDate() === 1 || i === 0) ? (d.getMonth() + 1) + '/' + d.getDate() : d.getDate();
      return '<span class="sch-tick' + ((wd === 0 || wd === 6) ? ' wknd' : '') + (i === todayIdx ? ' today' : '') +
        '" style="left:' + (i * CW) + 'px;width:' + CW + 'px">' + label + '</span>';
    }).join('');
    // 주말 음영 배경
    var bg = days.map(function (d, i) {
      var wd = d.getDay();
      return (wd === 0 || wd === 6)
        ? '<span class="sch-wknd" style="left:' + (i * CW) + 'px;width:' + CW + 'px"></span>' : '';
    }).join('');

    lanes += '<div class="sch-row sch-head-r">' + headCells + '</div>';

    groups.forEach(function (grp) {
      left += '<div class="sch-row sch-grp-l">' + esc(grp.surface.label) + '</div>';
      lanes += '<div class="sch-row sch-grp-r"></div>';
      grp.list.forEach(function (b) {
        var sd = pd(b.startDate), ed = pd(b.endDate);
        var st = bannerStatus(b);
        var color = classColor(b);
        // 시작일 없음=창 왼쪽 끝부터, 종료일 없음=창 오른쪽 끝까지(무기한).
        var s = sd ? Math.max(0, colX(sd)) : 0, e = ed ? Math.min(N - 1, colX(ed)) : N - 1;
        var oneDay = (e === s);
        var w = (e - s + 1) * CW - 6;
        var faded = (!b.active || b.planned);
        left += '<div class="sch-row sch-name">' +
          '<span class="gdot" style="background:' + esc(color) + '"></span>' +
          '<span class="gnm" title="' + esc(b.name) + (b.adminId ? ' (번호 ' + esc(b.adminId) + ')' : '') + '">' + esc(cleanName(b.name)) + '</span>' +
          (b.planned ? '<span class="gtag">예정</span>' : (st.k === 'urgent' ? '<span class="gtag urgent">D-1</span>' : '')) +
          '</div>';
        // 막대 안 텍스트는 넣지 않는다(이름은 좌측 열). 1일짜리는 알약형 마커로 명확히.
        var barStyle = 'left:' + (s * CW + 3) + 'px;width:' + w + 'px;' +
          (faded ? 'border:1.5px dashed ' + esc(color) + ';background:' + esc(color) + '26;'
                 : 'background:' + esc(color) + ';');
        lanes += '<div class="sch-row sch-lane">' +
          '<span class="sch-bar' + (faded ? ' faded' : '') + (oneDay ? ' oneday' : '') + '" style="' + barStyle +
          '" title="' + esc(b.name + ' · ' + (b.startDate || '') + (b.endDate && b.endDate !== b.startDate ? (' - ' + b.endDate) : '') + (oneDay ? ' (하루)' : '')) + '">' +
          (oneDay ? '<span class="sch-1d" style="background:' + esc(color) + '"></span>' : '') + '</span></div>';
      });
      if (grp.surface.target) {
        left += '<div class="sch-row sch-cnt-l">라이브 수 · 목표 ' + grp.surface.target + '</div>';
        lanes += '<div class="sch-row sch-cnt-r">' + days.map(function (d, i) {
          var n = grp.list.filter(function (b) { return isLive(b, d); }).length;
          var ok = n === grp.surface.target;
          return '<span class="sch-c ' + (ok ? 'ok' : 'bad') + '" style="left:' + (i * CW) + 'px;width:' + CW + 'px">' + n + '</span>';
        }).join('') + '</div>';
      }
    });

    host.innerHTML =
      '<div class="sch">' +
      '  <div class="sch-left">' + left + '</div>' +
      '  <div class="sch-scroll"><div class="sch-canvas" style="width:' + (N * CW) + 'px">' +
      '    <span class="sch-todayline" style="left:' + (todayIdx * CW + CW / 2) + 'px"></span>' + bg + lanes +
      '  </div></div>' +
      '</div>' +
      '<div class="vx-note" style="margin-top:10px">범례: ' +
      Object.keys(VX.reg.classes || {}).map(function (k) {
        return '<span class="gdot" style="background:' + esc(VX.reg.classes[k]) + '"></span>' + esc(k);
      }).join(' &nbsp; ') + ' &nbsp;·&nbsp; 점선 막대 = 예정·비활성 &nbsp;·&nbsp; 노란 세로선 = 오늘</div>';

    var wrap = host.querySelector('.sch-scroll');
    if (wrap) wrap.scrollLeft = Math.max(0, todayIdx * CW - 300);
  }

  var BN_ST_CLS = { live: 'st-live', urgent: 'st-urgent', wait: 'st-wait', plan: 'st-plan', off: 'st-off', end: 'st-end' };

  function renderBannerList() {
    var tbl = $id('bn-list');
    var fmtD = function (dt) { return dt ? ymd(dt) : null; };
    // 동일 캠페인 병합 — 이름 정규화(campaignKey) + 접두어(브랜드) 통합
    // 예: "메리츠화재" ⊃ "메리츠화재 내보험 조회" → 짧은 실제 캠페인명을 뿌리로 묶음
    var _banners = VX.reg.banners || [];
    // 접두 일치(긴 이름이 짧은 이름으로 시작) + 같은 소재 판정을 함께 쓴다.
    var _keySet = {};
    _banners.forEach(function (b) { _keySet[campaignKey(b.name)] = true; });
    var _keys = Object.keys(_keySet).sort(function (a, b) { return a.length - b.length; });
    var _canon = creativeCanon(_keys);
    var rootKey = function (k) {
      for (var i = 0; i < _keys.length; i++) {
        var r = _keys[i];
        if (r === k) break;
        if (r && k.indexOf(r) === 0 && k.charAt(r.length) === ' ') return _canon[r] || r;
      }
      return _canon[k] || k;
    };
    var gmap = {};
    _banners.forEach(function (b) {
      var key = rootKey(campaignKey(b.name));
      (gmap[key] || (gmap[key] = [])).push(b);
    });
    var stRank = { live: 0, urgent: 0, wait: 1, plan: 1, end: 2, off: 3 };
    var groups = Object.keys(gmap).map(function (k) {
      var ms = gmap[k];
      var rep = ms.slice().sort(function (a, b) { return stRank[bannerStatus(a).k] - stRank[bannerStatus(b).k]; })[0];
      // 기간·클릭은 현재 유효(진행·예정) 건 기준 — 삭제·종료된 옛 항목이 기간을 왜곡하지 않게
      var cur = ms.filter(function (b) { var kk = bannerStatus(b).k; return kk === 'live' || kk === 'urgent' || kk === 'wait' || kk === 'plan'; });
      var basis = cur.length ? cur : ms;
      var starts = basis.map(function (b) { return pd(b.startDate); }).filter(Boolean);
      var ends = basis.map(function (b) { return pd(b.endDate); }).filter(Boolean);
      return {
        members: ms, rep: rep, name: cleanName(rep.name), cls: rep['class'], type: rep.bannerType,
        minStart: starts.length ? new Date(Math.min.apply(null, starts.map(Number))) : null,
        maxEnd: ends.length ? new Date(Math.max.apply(null, ends.map(Number))) : null,
        status: bannerStatus(rep)
      };
    });
    // 필터 (운영·예정 기본)
    if (!VX.bnShowAll) {
      groups = groups.filter(function (g) {
        return g.members.some(function (b) { var k = bannerStatus(b).k; return k === 'live' || k === 'urgent' || k === 'wait' || k === 'plan' || k === 'end'; });
      });
    }
    // 정렬: 카테고리(진행중 > 예정 > 종료) → 각 카테고리 안 시작일 내림차순
    var catRank = function (g) { var k = g.status.k; return (k === 'live' || k === 'urgent') ? 0 : (k === 'wait' || k === 'plan') ? 1 : 2; };
    groups.sort(function (a, b) {
      var ca = catRank(a), cb = catRank(b);
      if (ca !== cb) return ca - cb;
      var sa = a.minStart ? a.minStart.getTime() : -Infinity, sb = b.minStart ? b.minStart.getTime() : -Infinity;
      if (sa !== sb) return sb - sa;
      return slotSort(a.rep, b.rep);
    });
    // 한 쪽만 그린다 — 정렬까지 끝난 뒤에 자르므로 쪽을 넘겨도 순서는 이어진다.
    if (!VX.bnSize) VX.bnSize = 10;
    var sl = pageSlice(groups, VX.bnPage, VX.bnSize);
    VX.bnPage = sl.page;
    var head = '<thead><tr><th class="bn-caret-h"></th><th>배너</th><th>분류</th><th>유형</th><th>지면 · 컨텐츠 번호</th>' +
      '<th>기간</th><th>상태</th><th></th></tr></thead>';
    var rows = sl.rows.map(function (g, gi) {
      // 지면·컨텐츠 합집합 — 현재 유효(진행·예정) 건만; 없으면 전체
      var surfTags = [];
      var curM = g.members.filter(function (b) { var k = bannerStatus(b).k; return k === 'live' || k === 'urgent' || k === 'wait' || k === 'plan'; });
      (curM.length ? curM : g.members).forEach(function (b) {
        var ci = b.contentIds || {};
        (b.surfaces || []).forEach(function (sk) {
          var lb = (surfaceByKey(sk) || {}).label || sk;
          var tag = esc(lb) + (ci[sk] ? ' <b class="bn-cn-tag">#' + esc(ci[sk]) + '</b>' : '');
          if (surfTags.indexOf(tag) < 0) surfTags.push(tag);
        });
      });
      var period = (fmtD(g.minStart) || '미정') + ' ~ ' + (fmtD(g.maxEnd) || '상시');
      var expandable = g.members.length > 1 || surfTags.length > 1;
      var main = '<tr class="bn-grp' + (expandable ? ' expandable' : '') + '"' + (expandable ? ' data-grp="' + gi + '"' : '') + '>' +
        '<td class="bn-caret">' + (expandable ? '<span class="bn-caret-ic">▸</span>' : '') + '</td>' +
        '<td><span class="bn-color-dot" style="background:' + esc(classColor(g.rep)) + '"></span>' +
        '<span title="' + esc(g.rep.name) + '">' + esc(g.name) + '</span>' +
        (g.members.length > 1 ? ' <span class="bn-grp-n">' + g.members.length + '건</span>' : '') + '</td>' +
        '<td><span class="vx-chip cls-' + esc(g.cls) + '">' + esc(g.cls) + '</span></td>' +
        '<td>' + esc(g.type || '-') + '</td>' +
        '<td>' + (surfTags.join(', ') || '-') + '</td>' +
        '<td>' + esc(period) + '</td>' +
        '<td><span class="bn-st ' + BN_ST_CLS[g.status.k] + '">' + esc(g.status.t) + '</span></td>' +
        '<td>' + (VX.isAdmin ? '<button class="vx-btn sm" data-edit="' + esc(g.rep.id) + '">수정</button>' : '') + '</td>' +
        '</tr>';
      if (!expandable) return main;
      // 펼침: 각 건을 본 표와 동일한 컬럼 양식으로
      var detail = g.members.map(function (b) {
        var ci = b.contentIds || {};
        var surf = (b.surfaces || []).map(function (sk) {
          var lb = (surfaceByKey(sk) || {}).label || sk;
          return esc(lb) + (ci[sk] ? ' <b class="bn-cn-tag">#' + esc(ci[sk]) + '</b>' : '');
        }).join(', ') || '-';
        var per = (b.startDate || '미정') + ' ~ ' + (b.endDate || '상시');
        var st = bannerStatus(b);
        return '<tr class="bn-det" data-det="' + gi + '" hidden>' +
          '<td class="bn-caret"></td>' +
          '<td class="bn-sub-name"><span class="bn-color-dot" style="background:' + esc(classColor(b)) + '"></span>' +
          '<span title="' + esc(b.name + (b.note ? ' · ' + b.note : '')) + '">' + esc(cleanName(b.name)) + '</span></td>' +
          '<td><span class="vx-chip cls-' + esc(b['class']) + '">' + esc(b['class']) + '</span></td>' +
          '<td>' + esc(b.bannerType || '-') + '</td>' +
          '<td>' + surf + '</td>' +
          '<td>' + esc(per) + '</td>' +
          '<td><span class="bn-st ' + BN_ST_CLS[st.k] + '">' + esc(st.t) + '</span></td>' +
          '<td>' + (VX.isAdmin ? '<button class="vx-btn sm" data-edit="' + esc(b.id) + '">수정</button>' : '') + '</td>' +
          '</tr>';
      }).join('');
      return main + detail;
    }).join('');
    tbl.innerHTML = head + '<tbody>' + (rows ||
      '<tr><td colspan="9" class="vx-empty">등록된 배너가 없습니다.</td></tr>') + '</tbody>';
    tbl.querySelectorAll('tr.expandable').forEach(function (tr) {
      tr.onclick = function (e) {
        if (e.target.closest('[data-edit]')) return;
        var dets = tbl.querySelectorAll('tr.bn-det[data-det="' + tr.dataset.grp + '"]');
        if (!dets.length) return;
        var show = dets[0].hidden;
        dets.forEach(function (d) { d.hidden = !show; });
        tr.classList.toggle('open', show);
      };
    });
    tbl.querySelectorAll('[data-edit]').forEach(function (btn) {
      btn.onclick = function (e) { e.stopPropagation(); openBannerEditor(btn.dataset.edit); };
    });

    var pgHost = $id('bn-list-pager');
    if (pgHost) {
      pgHost.innerHTML = pagerHtml(sl, [10, 20, 50]);
      bindPager(pgHost, sl,
        function (p) { VX.bnPage = p; renderBannerList(); scrollToCard(pgHost); },
        function (n) { VX.bnSize = n; VX.bnPage = 1; renderBannerList(); });
    }
  }

  // seed  = 신규 등록 시 미리 채울 값(앱 실측에서 넘어온 이름·번호·기간). 저장은 하지 않는다.
  // focus = 알림에서 들어왔을 때 강조할 항목('class'|'period'|'name'). 무엇을 고치러 왔는지
  //         모달이 스스로 알려 준다 — 긴 폼에서 해당 칸을 눈으로 찾게 두지 않는다.
  function openBannerEditor(bid, seed, focus) {
    var b = bid ? bannerById(bid) : {
      id: 'bn_' + Date.now().toString(36), name: '', 'class': '자체', bannerType: '',
      surfaces: ['main'], contentIds: {}, devices: 'AOS·iOS', active: false, planned: true,
      startDate: '', endDate: '', startTime: '', endTime: '', dayCondition: '',
      approvalLevel: 'L1', bgColor: '', owner: '', objective: '', note: '',
      regDate: ymd(kstToday()), ga4Source: '', ga4Ids: [], color: ''
    };
    if (!bid && seed) {
      for (var sk in seed) if (seed[sk] !== undefined && seed[sk] !== '') b[sk] = seed[sk];
    }
    if (!b.contentIds) b.contentIds = {};
    var isNew = !bid;
    var classes = Object.keys(VX.reg.classes || { '자체': 1, '광고': 1, '제휴': 1, '공공': 1 });
    var body = $id('bn-modal-body');
    body.innerHTML =
      '<button class="vx-modal-close" id="bn-m-close">×</button>' +
      '<h3>' + (isNew ? '배너·예정 등록' : '배너 수정') + '</h3>' +
      '<div class="vx-note" style="margin-bottom:12px">어드민이 원천입니다 — 실제 노출 변경(등록·순서·ON/OFF)은 어드민에서 하고, 여기는 현황·예정 관리용입니다.</div>' +
      // ── AI 자동 채우기 ──
      '<div class="bm-ai">' +
      '  <div class="bm-ai-hd"><b>✨ AI 자동 채우기</b><span>요청서·티켓 텍스트를 붙여넣거나 캡처 이미지를 올리면 항목을 자동으로 채웁니다</span></div>' +
      '  <textarea class="vx-input bm-ai-text" id="bm-ai-text" rows="3" placeholder="예: [광고] 여수세계섬박람회 / 주차사업팀 / 메인배너 2순위 / 8월 1일~16일 라이브"></textarea>' +
      '  <div class="bm-ai-row">' +
      '    <label class="vx-btn sm" for="bm-ai-img">📷 이미지 첨부</label>' +
      '    <input type="file" id="bm-ai-img" accept="image/*" style="display:none">' +
      '    <span class="bm-ai-fname" id="bm-ai-fname"></span>' +
      '    <span style="flex:1"></span>' +
      '    <button class="vx-btn primary sm" id="bm-ai-go">자동 채우기</button>' +
      '  </div>' +
      '  <div id="bm-ai-msg"></div>' +
      '</div>' +
      '<div class="vx-form-grid">' +
      '<span class="vx-label req">배너명</span><input class="vx-input" id="bm-name" value="' + esc(b.name) + '">' +
      '<span class="vx-label req">지면 · 컨텐츠 번호</span><div class="bm-surf-grid" id="bm-surfaces">' +
      (VX.reg.surfaces || []).map(function (s) {
        var on = (b.surfaces || []).indexOf(s.key) > -1;
        var cn = (b.contentIds || {})[s.key] || '';
        return '<div class="bm-surf-row' + (on ? ' on' : '') + '" data-sk="' + esc(s.key) + '">' +
          '<label class="bm-surf-chk"><input type="checkbox" value="' + esc(s.key) + '"' + (on ? ' checked' : '') + '> ' + esc(s.label) + '</label>' +
          '<input class="vx-input bm-cn" data-sk="' + esc(s.key) + '" placeholder="컨텐츠 번호(seq)" value="' + esc(cn) + '"' + (on ? '' : ' disabled') + '>' +
          '</div>';
      }).join('') + '</div>' +
      // 분류가 비어 있으면 빈 선택지를 맨 앞에 세운다. 없으면 아무 option 도 selected 가
      // 아니라 브라우저가 첫 항목(가나다순이라 '공공')을 고르고, 사람이 고른 적 없는 값이
      // 그대로 저장된다 — 분류 미지정 알림을 고치러 들어와서 오분류를 만드는 셈이 된다.
      '<span class="vx-label req">분류</span><select class="vx-select" id="bm-class">' +
      (String(b['class'] || '').trim() ? ''
        : '<option value="" selected disabled>선택하세요</option>') +
      classes.map(function (p) { return '<option' + (p === b['class'] ? ' selected' : '') + '>' + esc(p) + '</option>'; }).join('') +
      '</select>' +
      '<span class="vx-label">유형</span><input class="vx-input" id="bm-type" placeholder="공지 · 기획전 · 광고 · 이벤트 등" value="' + esc(b.bannerType || '') + '">' +
      '<span class="vx-label">상태</span><div class="vx-check-row">' +
      '<label><input type="checkbox" id="bm-active"' + (b.active ? ' checked' : '') + '> 활성(어드민 ON)</label>' +
      '<label><input type="checkbox" id="bm-planned"' + (b.planned ? ' checked' : '') + '> 예정(어드민 미등록)</label></div>' +
      '<span class="vx-label req">시작일</span><input type="date" class="vx-input" id="bm-start" value="' + esc(b.startDate || '') + '">' +
      '<span class="vx-label req" id="bm-end-label">종료일</span><input type="date" class="vx-input" id="bm-end" value="' + esc(b.endDate || '') + '">' +
      '<span class="vx-label">시간 조건</span><div class="vx-check-row">' +
      '<input type="time" class="vx-input" id="bm-stime" value="' + esc(b.startTime || '') + '"> - ' +
      '<input type="time" class="vx-input" id="bm-etime" value="' + esc(b.endTime || '') + '"></div>' +
      '<span class="vx-label">요일 조건</span><input class="vx-input" id="bm-days" placeholder="예: 월,화,수 (비우면 매일)" value="' + esc(b.dayCondition || '') + '">' +
      '<span class="vx-label">승인레벨</span><select class="vx-select" id="bm-approval">' +
      '<option value="L1"' + (b.approvalLevel !== 'L2' ? ' selected' : '') + '>L1 (운영자)</option>' +
      '<option value="L2"' + (b.approvalLevel === 'L2' ? ' selected' : '') + '>L2 (부서협의)</option></select>' +
      '<span class="vx-label">담당</span><input class="vx-input" id="bm-owner" placeholder="담당 부서·담당자" value="' + esc(b.owner || '') + '">' +
      '<span class="vx-label">목적</span><input class="vx-input" id="bm-objective" value="' + esc(b.objective || '') + '">' +
      '<span class="vx-label">메모</span><input class="vx-input" id="bm-note" placeholder="슬롯 제약(예: 2순위 이상) 등" value="' + esc(b.note || '') + '">' +
      '<div class="bm-slots-wrap full"><span class="vx-label">구좌 계획</span>' +
      '<div class="bm-slots-hint">기간별 순위와 어드민 번호는 타임라인 구좌 줄과 상세 창 이미지에 쓰입니다. 소재 번호는 다른 번호 소재를 복사할 때만 적습니다.</div>' +
      '<div class="bm-slot-head"><span>시작</span><span>종료</span><span>순위</span><span>어드민 번호</span><span>소재 번호</span><span></span></div>' +
      '<div id="bm-slots"></div>' +
      '<button type="button" class="vx-btn sm" id="bm-slot-add">+ 기간 추가</button></div>' +
      '</div>' +
      '<div id="bm-errors"></div>' +
      '<div style="display:flex;justify-content:space-between;margin-top:18px">' +
      (isNew ? '<span></span>' : '<button class="vx-btn danger" id="bm-del">삭제</button>') +
      '<div style="display:flex;gap:8px"><button class="vx-btn" id="bm-cancel">취소</button>' +
      '<button class="vx-btn primary" id="bm-ok">' + (isNew ? '등록' : '반영') + '</button></div></div>';

    var ov = $id('bn-modal');
    ov.classList.add('open');
    // 브라우저 이력에 모달을 한 칸 얹는다 — ESC·뒤로가기가 모두 '직전 화면으로'가 되고,
    // 취소·× 로 닫아도 이력을 되감아 뒤로가기 한 번이 남지 않는다(캠페인 모달과 같은 방식).
    var pushed = false;
    try { history.pushState({ bnModal: b.id || 'new' }, '', location.href); pushed = true; } catch (e) { /* noop */ }

    // 알림에서 들어왔으면 고칠 칸을 짚어 준다 — 표시 + 스크롤 + 포커스.
    if (focus) {
      var FOCUS_FIELDS = { 'class': ['bm-class'], period: ['bm-start', 'bm-end'], name: ['bm-name'] };
      var ids = FOCUS_FIELDS[focus] || [];
      ids.forEach(function (id) {
        var el = $id(id);
        if (el) el.classList.add('bm-need');
      });
      var first = ids.length ? $id(ids[0]) : null;
      if (first) {
        // 모달이 그려진 다음에 옮겨야 위치가 잡힌다.
        setTimeout(function () {
          try { first.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { first.scrollIntoView(); }
          first.focus({ preventScroll: true });
        }, 60);
        // 강조는 안내일 뿐이라 손대면 바로 걷는다. 남겨 두면 오류 표시처럼 읽힌다.
        ids.forEach(function (id) {
          var el = $id(id);
          if (!el) return;
          var clear = function () { el.classList.remove('bm-need'); };
          el.addEventListener('change', clear);
          el.addEventListener('input', clear);
        });
      }
    }

    function close() {
      ov.classList.remove('open');
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('popstate', onPop);
      // 버튼·ESC 로 닫았으면 얹어 둔 이력을 되감아 직전 화면 상태로 돌아간다.
      if (pushed) { pushed = false; history.back(); }
    }
    // 뒤로가기(또는 close 가 되감은 이력)가 오면 모달만 닫는다 — 다시 되감지 않는다.
    function onPop() { pushed = false; close(); }
    // ESC = 뒤로가기와 같은 동작. 리스너는 닫을 때 걷어 다음 모달·다른 화면에 남지 않게 한다.
    function onEsc(e) { if (e.key === 'Escape' && ov.classList.contains('open')) { e.preventDefault(); close(); } }
    document.addEventListener('keydown', onEsc);
    window.addEventListener('popstate', onPop);
    $id('bn-m-close').onclick = close;
    $id('bm-cancel').onclick = close;
    ov.onclick = function (e) { if (e.target === ov) close(); };

    // 구좌 계획(slots) 행: 시작·종료·순위·어드민 번호(seq)·소재 번호(imgSeq)
    function slotRow(g) {
      g = g || {};
      return '<div class="bm-slot-row">' +
        '<input type="date" class="vx-input bs-from" value="' + esc(g.from || '') + '">' +
        '<input type="date" class="vx-input bs-to" value="' + esc(g.to || '') + '">' +
        '<input type="number" min="1" max="20" class="vx-input bs-rank" value="' + esc(g.rank != null ? String(g.rank) : '') + '">' +
        '<input class="vx-input bs-seq" placeholder="예: 1119" value="' + esc(g.seq || '') + '">' +
        '<input class="vx-input bs-img" placeholder="복사 원본" value="' + esc(g.imgSeq || '') + '">' +
        '<button type="button" class="vx-btn sm ghost bs-del" title="이 기간 삭제">×</button></div>';
    }
    $id('bm-slots').innerHTML = (Array.isArray(b.slots) ? b.slots : []).map(slotRow).join('');
    $id('bm-slot-add').onclick = function () {
      // 새 행은 직전 행 종료 다음 날에서 시작 — 이어지는 기간을 칸마다 다시 고르지 않게.
      var rows = $id('bm-slots').querySelectorAll('.bm-slot-row');
      var last = rows.length ? rows[rows.length - 1].querySelector('.bs-to').value : '';
      var nd = last && pd(last) ? ymd(new Date(pd(last).getTime() + 86400000)) : ($id('bm-start').value || '');
      $id('bm-slots').insertAdjacentHTML('beforeend', slotRow({ from: nd }));
    };
    $id('bm-slots').addEventListener('click', function (e) {
      var del = e.target.closest && e.target.closest('.bs-del');
      if (del) del.closest('.bm-slot-row').remove();
    });
    // 입력한 구좌 계획을 읽는다. 전부 빈 행은 버리고, 틀린 행은 사유를 모은다.
    function readSlots() {
      var out = [], errs = [];
      $id('bm-slots').querySelectorAll('.bm-slot-row').forEach(function (row, i) {
        var g = {
          from: row.querySelector('.bs-from').value, to: row.querySelector('.bs-to').value,
          rank: row.querySelector('.bs-rank').value.trim(),
          seq: row.querySelector('.bs-seq').value.trim(), imgSeq: row.querySelector('.bs-img').value.trim()
        };
        var bad = false;
        row.querySelectorAll('input').forEach(function (x) { x.classList.remove('invalid'); });
        if (!g.from && !g.to && !g.rank && !g.seq && !g.imgSeq) return;
        function mark(cls) { row.querySelector(cls).classList.add('invalid'); bad = true; }
        if (!g.from) mark('.bs-from');
        if (!g.to) mark('.bs-to');
        var r = parseInt(g.rank, 10);
        if (!(r >= 1 && r <= 20)) mark('.bs-rank');
        if (g.from && g.to && g.to < g.from) mark('.bs-to');
        if (bad) { errs.push('구좌 계획 ' + (i + 1) + '번째 줄'); return; }
        var o = { from: g.from, to: g.to, rank: r };
        if (g.seq) o.seq = g.seq;
        if (g.imgSeq) o.imgSeq = g.imgSeq;
        out.push(o);
      });
      out.sort(function (x, y) { return x.from < y.from ? -1 : x.from > y.from ? 1 : 0; });
      for (var i = 1; i < out.length; i++) {
        if (out[i].from <= out[i - 1].to) errs.push('구좌 계획 기간 겹침 (' + out[i - 1].from + ' - ' + out[i - 1].to + ' / ' + out[i].from + ')');
      }
      return { slots: out, errors: errs };
    }

    // 지면 체크 → 해당 컨텐츠 번호 입력 활성/비활성
    $id('bm-surfaces').addEventListener('change', function (e) {
      if (e.target && e.target.type === 'checkbox') {
        var sk = e.target.value;
        var cn = $id('bm-surfaces').querySelector('.bm-cn[data-sk="' + sk + '"]');
        var row = e.target.closest('.bm-surf-row');
        if (cn) { cn.disabled = !e.target.checked; if (e.target.checked) cn.focus(); }
        if (row) row.classList.toggle('on', e.target.checked);
        syncEndReq();
      }
    });
    // 공지탭·이벤트탭만 고른 배너는 어드민에 종료일 칸이 없다 — 필수에서 빼고 입력을 막는다.
    // 다른 지면이 하나라도 섞이면 다시 필수로 돌린다.
    function checkedSurfaces() {
      return Array.prototype.slice.call(document.querySelectorAll('#bm-surfaces input:checked')).map(function (c) { return c.value; });
    }
    function syncEndReq() {
      var only = noticeOnly(checkedSurfaces());
      var endEl = $id('bm-end'), lbl = $id('bm-end-label');
      if (!endEl || !lbl) return;
      endEl.disabled = only;
      endEl.title = only ? '공지탭·이벤트탭은 종료일 없이 상시 노출됩니다 (내릴 때 어드민에서 삭제)' : '';
      lbl.classList.toggle('req', !only);
      lbl.textContent = only ? '종료일 (상시)' : '종료일';
      if (only) endEl.classList.remove('invalid');
    }
    syncEndReq();

    // ── AI 자동 채우기 핸들러 ──
    var aiImage = null;
    $id('bm-ai-img').onchange = function () {
      var f = this.files && this.files[0];
      if (!f) { aiImage = null; $id('bm-ai-fname').textContent = ''; return; }
      if (f.size > 5 * 1024 * 1024) { alert('이미지는 5MB 이하로 올려주세요.'); this.value = ''; return; }
      var rd = new FileReader();
      rd.onload = function () { aiImage = rd.result; $id('bm-ai-fname').textContent = f.name; };
      rd.readAsDataURL(f);
    };
    $id('bm-ai-go').onclick = function () {
      var text = $id('bm-ai-text').value.trim();
      var msg = $id('bm-ai-msg');
      if (!text && !aiImage) { msg.innerHTML = '<div class="vx-warn">텍스트를 붙여넣거나 이미지를 첨부하세요.</div>'; return; }
      var btn = this; btn.disabled = true; btn.textContent = '분석 중…';
      msg.innerHTML = '<div class="vx-loading" style="padding:8px">AI가 항목을 추출하는 중…</div>';
      fetchJson('/api/banner-parse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, image: aiImage || '' })
      }).then(function (res) {
        btn.disabled = false; btn.textContent = '자동 채우기';
        if (!res || !res.ok) {
          msg.innerHTML = '<div class="vx-error">자동 채우기 실패: ' + esc((res && res.error) || '오류') + '</div>';
          return;
        }
        var applied = applyAiFields(res.fields || {});
        msg.innerHTML = '<div class="vx-warn" style="background:var(--success-soft);color:var(--success);border-color:#a7f3d0">' +
          applied + '개 항목을 채웠습니다. 값을 확인하고 등록하세요.</div>';
      });
    };

    if (!isNew) {
      $id('bm-del').onclick = function () {
        if (!confirm('배너 "' + b.name + '" 를 목록에서 삭제할까요? (어드민 원본에는 영향 없음)')) return;
        var snapshot = JSON.stringify(VX.reg.banners);
        VX.reg.banners = (VX.reg.banners || []).filter(function (x) { return x.id !== b.id; });
        persistRegistry().then(function (res) {
          if (res && res.ok) { close(); rerenderBanner(); }
          else {
            VX.reg.banners = JSON.parse(snapshot);
            $id('bm-errors').innerHTML = '<div class="vx-error">삭제 저장 실패:<br>' +
              ((res && (res.errors || [res.error])) || ['알 수 없는 오류']).map(esc).join('<br>') + '</div>';
          }
        });
      };
    }
    $id('bm-ok').onclick = function () {
      var name = $id('bm-name').value.trim();
      var checkedSurf = Array.prototype.slice.call(document.querySelectorAll('#bm-surfaces input:checked')).map(function (c) { return c.value; });
      var planned0 = $id('bm-planned').checked;
      // 지면별 컨텐츠 번호 수집
      var cids = {};
      document.querySelectorAll('#bm-surfaces .bm-cn').forEach(function (inp) {
        var v = inp.value.trim();
        if (checkedSurf.indexOf(inp.dataset.sk) > -1 && v) cids[inp.dataset.sk] = v;
      });
      var miss = [];
      var cls0 = $id('bm-class').value;
      if (!name) miss.push('배너명');
      // 분류는 사람이 정하는 값이라 서버가 채우지 않는다. 빈 채로 저장되면 색·집계·승인레벨
      // 판단이 다 빠지므로 여기서 막는다(자동 등록분은 비어 들어온다).
      if (!String(cls0 || '').trim()) miss.push('분류');
      if (!checkedSurf.length) miss.push('지면');
      // 예정 배너가 아니면 선택 지면마다 컨텐츠 번호 필수
      var cnMissing = planned0 ? [] : checkedSurf.filter(function (sk) { return !cids[sk]; });
      if (cnMissing.length) miss.push('컨텐츠 번호(' + cnMissing.map(function (sk) { var s = surfaceByKey(sk); return s ? s.label : sk; }).join(', ') + ')');
      if (!$id('bm-start').value) miss.push('시작일');
      // 공지탭·이벤트탭만 고른 배너는 종료일이 없는 게 정상 — 필수에서 뺀다.
      var endOptional = noticeOnly(checkedSurf);
      if (!endOptional && !$id('bm-end').value) miss.push('종료일');
      var slotRead = readSlots();
      // 필수 미입력 표시
      [['bm-name', name], ['bm-class', cls0],
       ['bm-start', $id('bm-start').value], ['bm-end', endOptional ? 'ok' : $id('bm-end').value]].forEach(function (p) {
        $id(p[0]).classList.toggle('invalid', !p[1]);
      });
      $id('bm-surfaces').classList.toggle('invalid', !checkedSurf.length || cnMissing.length > 0);
      document.querySelectorAll('#bm-surfaces .bm-cn').forEach(function (inp) {
        inp.classList.toggle('invalid', cnMissing.indexOf(inp.dataset.sk) > -1);
      });
      if (miss.length) {
        $id('bm-errors').innerHTML = '<div class="vx-error">필수 항목을 입력하세요: ' + miss.join(', ') + '</div>';
        return;
      }
      if (slotRead.errors.length) {
        $id('bm-errors').innerHTML = '<div class="vx-error">구좌 계획을 확인하세요: ' + slotRead.errors.map(esc).join(', ') + '</div>';
        return;
      }
      $id('bm-errors').innerHTML = '';
      var snapshot = JSON.stringify(VX.reg.banners);
      b.name = name;
      b.surfaces = checkedSurf;
      b.contentIds = cids;
      b['class'] = $id('bm-class').value;
      // 사람이 편집 창에서 저장했으면 분류는 더 이상 자동값이 아니다.
      // 근거 표시를 지워야 다음에 '왜 이 분류지' 하고 자동 근거를 다시 읽지 않는다.
      delete b.classAuto;
      b.bannerType = $id('bm-type').value.trim();
      b.active = $id('bm-active').checked;
      b.planned = planned0;
      b.startDate = $id('bm-start').value;
      b.endDate = $id('bm-end').value;
      b.startTime = $id('bm-stime').value;
      b.endTime = $id('bm-etime').value;
      b.dayCondition = $id('bm-days').value.trim();
      b.approvalLevel = $id('bm-approval').value;
      b.owner = $id('bm-owner').value.trim();
      b.objective = $id('bm-objective').value.trim();
      b.note = $id('bm-note').value.trim();
      if (slotRead.slots.length) b.slots = slotRead.slots;
      else delete b.slots;
      b.color = classColor(b);
      // 메인 지면 컨텐츠 번호 = GA4 메인배너_click content id (클릭 자동 매칭)
      b.adminId = cids.main || '';
      if (cids.main) { b.ga4Source = 'main'; b.ga4Ids = [cids.main]; }
      else { b.ga4Source = ''; b.ga4Ids = []; }
      if (isNew) (VX.reg.banners = VX.reg.banners || []).push(b);
      var okBtn = $id('bm-ok');
      okBtn.disabled = true; okBtn.textContent = '저장 중…';
      persistRegistry().then(function (res) {
        okBtn.disabled = false; okBtn.textContent = isNew ? '등록' : '반영';
        if (res && res.ok) { close(); rerenderBanner(); }
        else {
          VX.reg.banners = JSON.parse(snapshot); // 롤백 — 입력값은 모달에 유지
          $id('bm-errors').innerHTML = '<div class="vx-error">저장 실패:<br>' +
            ((res && (res.errors || [res.error])) || ['알 수 없는 오류']).map(esc).join('<br>') + '</div>';
        }
      });
    };
  }

  // AI 추출 결과 → 폼 필드 반영 (채워진 것만, 사용자 입력 덮어쓰기 최소화)
  function applyAiFields(f) {
    var n = 0;
    function setVal(id, v) { var el = $id(id); if (el && v != null && String(v).trim() !== '') { el.value = v; n++; } }
    setVal('bm-name', f.name);
    if (f['class'] && ['자체', '광고', '제휴', '공공'].indexOf(f['class']) > -1) { $id('bm-class').value = f['class']; n++; }
    setVal('bm-type', f.bannerType);
    setVal('bm-start', f.startDate);
    setVal('bm-end', f.endDate);
    setVal('bm-stime', f.startTime);
    setVal('bm-etime', f.endTime);
    setVal('bm-days', f.dayCondition);
    setVal('bm-owner', f.owner);
    setVal('bm-objective', f.objective);
    setVal('bm-note', f.note);
    if (f.approvalLevel === 'L2') { $id('bm-approval').value = 'L2'; n++; }
    if (Array.isArray(f.surfaces) && f.surfaces.length) {
      document.querySelectorAll('#bm-surfaces input[type="checkbox"]').forEach(function (c) {
        c.checked = f.surfaces.indexOf(c.value) > -1;
        var cn = $id('bm-surfaces').querySelector('.bm-cn[data-sk="' + c.value + '"]');
        var row = c.closest('.bm-surf-row');
        if (cn) cn.disabled = !c.checked;
        if (row) row.classList.toggle('on', c.checked);
      });
      n++;
    }
    // 광고면 예정으로 기본 (어드민 미등록 상태), 활성 유지
    if (f['class'] === '광고' && $id('bm-planned')) { $id('bm-planned').checked = true; }
    return n;
  }

  // 실측 동기화 결과 — 저장 결과와 같은 상단 스트립에 표시
  function showBannerSyncMsg(r) {
    var msg = $id('bn-save-msg');
    if (!msg) return;
    if (!r || !r.ok) {
      msg.innerHTML = '<div class="vx-warn">동기화 실패 — ' + esc((r && r.error) || '알 수 없는 오류') +
        '. 앱 실측만 다시 불러왔습니다.</div>';
      return;
    }
    var bits = [];
    if ((r.created || []).length) bits.push('신규 ' + r.created.map(esc).join('·'));
    if ((r.updated || []).length) bits.push('변경 ' + r.updated.map(esc).join('·'));
    if ((r.deactivated || []).length) bits.push('내림 ' + r.deactivated.map(esc).join('·'));
    msg.innerHTML = '<div class="vx-warn" style="background:var(--success-soft);color:var(--success);border-color:#a7f3d0">' +
      (bits.length ? '앱 실측 기준으로 반영했습니다 — ' + esc(bits.join(' / ')) : '앱 실측과 이미 일치합니다 — 변동 없음') +
      '</div>';
    setTimeout(function () { msg.innerHTML = ''; }, 8000);
  }

  // 변경 즉시 저장 (별도 저장 버튼 없음) — 결과는 상단 스트립에 표시
  function persistRegistry() {
    return fetchJson('/api/banners/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registry: VX.reg })
    }).then(function (res) {
      var msg = $id('bn-save-msg');
      if (msg && res && res.ok) {
        msg.innerHTML = ((res.warnings || []).length
          ? '<div class="vx-warn">저장됨 — 정책 경고: ' + res.warnings.map(esc).join(' / ') + '</div>'
          : '<div class="vx-warn" style="background:var(--success-soft);color:var(--success);border-color:#a7f3d0">변경 사항이 저장됐습니다.</div>');
        setTimeout(function () { msg.innerHTML = ''; }, 6000);
      }
      return res;
    });
  }

  // 콘텐츠명 정제 — 앞 태그([공지]·(상시) 등)와 뒤 부연((순서조정) 등) 제거
  function cleanName(s) {
    if (!s) return s;
    var t = String(s).trim();
    t = t.replace(/^\s*[\[\(（][^\]\)）]{0,20}[\]\)）]\s*/, '');   // 앞 태그 1개
    t = t.replace(/\s*[\(（][^\)）]{0,20}[\)）]\s*$/, '');           // 뒤 괄호 1개
    return t.trim() || String(s).trim();
  }

  // 재등록 병합용 정규화 키 — 앞 태그 + 뒤 괄호(연속 다수)를 모두 제거해 같은 캠페인끼리 묶는다.
  // 표시엔 쓰지 않고 클릭 성과 합산 그룹핑에만 사용(예: "…안내 (순서조정) (7/15~7/16)" → "…안내").
  function campaignKey(s) {
    var t = String(s || '').trim();
    t = t.replace(/^\s*[\[\(（][^\]\)）]{0,20}[\]\)）]\s*/, '');    // 앞 태그 1개
    t = t.replace(/(\s*[\(（][^\)）]{0,30}[\)）]\s*)+$/, '');        // 뒤 괄호 연속 전부
    return t.trim().toLowerCase() || String(s || '').trim().toLowerCase();
  }


  // 같은 소재인지 판정한다. 이름이 한 글자도 안 틀려야 같은 배너로 묶는 규칙은 현실과 안 맞는다 —
  // 실제로 '여수세계섬박람회'(메인)와 '여수섬세계박람회'(하단·검색)처럼 어순이 뒤바뀐 오타가 있다.
  //  ① 정규화 이름이 같으면 같은 소재
  //  ② 글자 구성이 완전히 같으면(애너그램) 같은 소재 — 어순 뒤바뀜·자리 바뀜 오타를 잡는다
  //  ③ 두 글자 묶음이 70% 이상 겹치면 같은 소재 — 한두 글자 오타를 잡는다
  function _norm(s) { return campaignKey(s).replace(/[\s·・\-_,]/g, ''); }
  function _sortedChars(s) { return _norm(s).split('').sort().join(''); }
  function _bigrams(s) {
    var t = _norm(s), out = [];
    for (var i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
    return out;
  }
  function sameCreative(a, b) {
    var na = _norm(a), nb = _norm(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.length >= 4 && _sortedChars(a) === _sortedChars(b)) return true;
    // ④ 짧은 쪽 글자가 긴 쪽에 전부 들어 있고 길이 차가 2글자 이내면 같은 소재로 본다.
    //    '세차주유소' 와 '주유소세차권' 처럼 같은 서비스를 어순·조사만 바꿔 등록한 경우.
    var lo = na.length <= nb.length ? na : nb, hi = na.length <= nb.length ? nb : na;
    if (lo.length >= 4 && hi.length - lo.length <= 2) {
      var rest = hi.split(''), all = true;
      lo.split('').forEach(function (ch) {
        var i = rest.indexOf(ch);
        if (i > -1) rest.splice(i, 1); else all = false;
      });
      if (all) return true;
    }
    var ga = _bigrams(a), gb = _bigrams(b);
    if (ga.length < 3 || gb.length < 3) return false;
    var pool = gb.slice(), hit = 0;
    ga.forEach(function (g) {
      var i = pool.indexOf(g);
      if (i > -1) { pool.splice(i, 1); hit++; }
    });
    return (2 * hit) / (ga.length + gb.length) >= 0.7;
  }
  // 이름 목록을 같은 소재끼리 묶어 대표 이름을 돌려준다(가장 짧은 이름 = 군더더기 적은 쪽).
  function creativeCanon(names) {
    var reps = [], map = {};
    names.forEach(function (n) {
      for (var i = 0; i < reps.length; i++) {
        if (sameCreative(n, reps[i])) {
          if (_norm(n).length < _norm(reps[i]).length) {   // 더 짧은 이름을 대표로 승격
            var old = reps[i]; reps[i] = n;
            Object.keys(map).forEach(function (k) { if (map[k] === old) map[k] = n; });
          }
          map[n] = reps[i];
          return;
        }
      }
      reps.push(n); map[n] = n;
    });
    return map;
  }

  // 사이드바를 접거나 창을 줄이면 카드 폭이 바뀐다. Vega 는 그린 시점의 폭으로 고정되므로
  // 다시 그려 주지 않으면 차트만 옛 폭으로 남아 잘리거나 여백이 뜬다.
  // 관측 → 재렌더가 다시 관측을 부르는 되먹임을 막으려고 폭이 실제로 달라졌을 때만 움직인다.
  function bindChartResize() {
    var host = $id('bn-click-chart');
    if (!host || VX._chartRO) return;
    var last = host.clientWidth, timer = null;
    var redraw = function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var w = host.clientWidth;
        if (!w || Math.abs(w - last) < 12) return;
        last = w;
        renderClickCharts();
      }, 180);
    };
    if (typeof ResizeObserver === 'function') {
      VX._chartRO = new ResizeObserver(redraw);
      VX._chartRO.observe(host.parentNode || host);
    }
    window.addEventListener('resize', redraw);
  }

  function renderClickCharts() {
    var host = $id('bn-click-chart');
    if (VX.clicks === null) {
      host.innerHTML = '<div class="vx-loading">클릭 데이터 불러오는 중…</div>';
      $id('bn-click-table').innerHTML = '';
      return;
    }
    if (!VX.clicks || !VX.clicks.rows || !VX.clicks.rows.length) {
      host.innerHTML = '<div class="vx-empty">클릭 데이터가 없습니다.</div>';
      $id('bn-click-table').innerHTML = '';
      return;
    }
    // 지면 라벨 — 표·선택지에 어느 구좌인지 드러낸다
    var SRC_LABEL = CK_SRC_LABEL, SRC_SHORT = CK_SRC_SHORT;
    function srcLabel(src, short) { return ckSrcLabel(src, short); }

    // (지면:번호) → 레지스트리 배너
    var byKey = {};
    (VX.reg.banners || []).forEach(function (b) {
      bannerClickKeys(b).forEach(function (k) { if (!byKey[k]) byKey[k] = b; });
    });
    function keyOf(r) { return r.src + ':' + String(r.contentId); }
    // 집계 단위 = 운영표 등록 하나(배너 하나). 이름이 같아도 재등록이면 다른 배너다 —
    // 이름으로 묶으면 어느 등록의 성과인지 고를 수가 없다. 한 등록이 메인·하단에 함께
    // 걸린 경우만 같은 배너로 본다(운영표에서 지면을 둘 다 체크한 한 줄이므로).
    function groupOf(r) {
      var b = byKey[keyOf(r)];
      if (!b) return 'id:' + (r.contentId || '없음');
      return 'b:' + b.id;
    }
    function labelOf(r) {
      var b = byKey[keyOf(r)];
      // 운영표에 없는 번호 = 오래전에 내린 배너이거나 테스트 등록. 지우지 않고 그대로 드러낸다.
      if (!b) return '#' + (r.contentId || '?') + ' (운영표 미등록)';
      return cleanName(b.name);
    }

    // 기간. 7·30일은 서버가 그 창의 유니크 유저를 함께 세어 주므로 그대로 쓴다.
    // 그보다 길거나 직접 지정한 구간은 클릭수를 이력 원장(2025-01-01~)에서 더해 즉시 그리고,
    // 유저수만 원본 이벤트 테이블에 따로 물어 뒤이어 채운다(일별 유니크는 더할 수 없다).
    if (VX.clickRange === undefined) VX.clickRange = 30;
    var RANGE = VX.clickRange;
    var PRESET_EXACT = (RANGE === 7 || RANGE === 30);   // 서버가 준 정확한 기간 유니크
    // empty = 서버에 원장이 아직 적재되지 않은 상태(크론 첫 실행 전). 실패와 같이 다룬다.
    var hist = (VX.hist && VX.hist.ok && !VX.hist.empty && VX.hist.rows) ? VX.hist : null;
    // 원장이 없는데 긴 기간을 고른 상태 — 실패를 '클릭 없음'으로 보이게 두지 않는다.
    if (!PRESET_EXACT && !hist) {
      host.innerHTML = VX.hist
        ? '<div class="vx-empty">이력 원장을 불러오지 못했습니다' +
          (VX.hist.note ? ' (' + esc(VX.hist.note) + ')' : '') +
          ' · 30일 이하 기간은 그대로 조회됩니다</div>'
        : '<div class="vx-loading">이력 원장 불러오는 중…</div>';
      $id('bn-click-table').innerHTML = '';
      return;
    }
    var METRIC = (VX.clickMetric === 'usr') ? 'usr' : 'clk';
    var METRIC_LABEL = (METRIC === 'usr') ? '유저수' : '클릭수';
    var metricSeg = $id('bn-click-metric');
    if (metricSeg && !metricSeg.__bound) {
      metricSeg.__bound = true;
      metricSeg.querySelectorAll('button').forEach(function (btn) {
        btn.onclick = function () {
          VX.clickMetric = btn.dataset.m;
          metricSeg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === btn); });
          renderClickCharts();
        };
      });
    }

    // 구간 경계(YYYYMMDD). 프리셋은 어제에서 역산하고, 직접 지정이면 입력값을 그대로 쓴다.
    var histStart = (hist && hist.start) || '20250101';
    var lastDay = ymd(new Date(kstToday().getTime() - 86400000)).replace(/-/g, '');
    var FROM, TO;
    if (RANGE === 'custom') {
      FROM = VX.clickFrom || histStart;
      TO = VX.clickTo || lastDay;
      if (FROM > TO) { var _s = FROM; FROM = TO; TO = _s; }
    } else if (RANGE === 'all') {
      FROM = histStart; TO = (hist && hist.end) || lastDay;
    } else {
      TO = lastDay;
      FROM = ymd(new Date(kstToday().getTime() - RANGE * 86400000)).replace(/-/g, '');
    }

    var rangeSeg = $id('bn-click-range');
    if (rangeSeg && !rangeSeg.__bound) {
      rangeSeg.__bound = true;
      rangeSeg.querySelectorAll('button').forEach(function (btn) {
        btn.onclick = function () {
          var r = btn.dataset.r;
          VX.clickRange = (r === 'all') ? 'all' : Number(r);
          VX.clickFrom = VX.clickTo = null;
          clearBannerSel();   // 기간을 직접 바꾸면 칩이 말하는 '그 배너 운영 기간'이 아니게 된다
          renderClickCharts();
        };
      });
    }
    if (rangeSeg) {
      rangeSeg.querySelectorAll('button').forEach(function (x) {
        x.classList.toggle('on', String(VX.clickRange) === x.dataset.r);
      });
    }

    // 날짜 직접 지정 — 한쪽만 바꿔도 즉시 반영한다. 나머지 한쪽은 현재 구간 값을 유지한다.
    // 기간 선택기(두 달 나란히)와 배너 검색은 따로 두고 여기서 상태만 물려 준다.
    setupDatePicker(FROM, TO, histStart, lastDay);
    setupBannerSearch(hist, histStart, lastDay);

    // 기간 합계. 7·30일은 서버가 기간 전체로 중복 제거한 값을 그대로 쓰고,
    // 그 밖의 구간은 원장의 일별 행을 더해 만든다(클릭은 정확, 유저는 연인원).
    var totals;
    if (PRESET_EXACT) {
      totals = (RANGE === 7 ? VX.clicks.totals7 : VX.clicks.totals) || [];
    } else {
      // 클릭수는 원장을 더하면 정확하다. 유저수만 원본 이벤트 테이블에 따로 묻는다
      // (일별 유니크는 더할 수 없다). 도착 전에는 클릭수만 그리고 유저수는 뒤에 채운다.
      var acc = {};
      hist.rows.forEach(function (r) {
        if (r.date < FROM || r.date > TO) return;
        var k = r.src + ':' + r.contentId;
        if (!acc[k]) acc[k] = { src: r.src, contentId: r.contentId, clicks: 0, users: null };
        acc[k].clicks += r.clicks;
      });
      // 유저수는 캠페인 묶음 단위로 따로 받는다(아래 agg 완성 후 붙인다).
      if (!(VX._ckUsers && VX._ckUsers.key === (FROM + ':' + TO))) loadRangeUsers(FROM, TO);
      totals = Object.keys(acc).map(function (k) { return acc[k]; });
    }
    var agg = {};
    totals.forEach(function (r) {
      var g = groupOf(r);
      if (!agg[g]) {
        var b = byKey[keyOf(r)];
        agg[g] = { g: g, name: labelOf(r), cls: b ? b['class'] : null, reg: !!b,
                   srcs: {}, src: '', ids: {}, clk: 0, usr: 0, usrExact: true };
      }
      agg[g].srcs[r.src] = true;
      agg[g].src = Object.keys(agg[g].srcs).join('·');
      if (r.contentId) agg[g].ids[String(r.contentId)] = true;   // 등록번호(seq)
      agg[g].clk += r.clicks;
      // 유저수가 아직 안 온 구간은 null 로 둔다 — 0 으로 더하면 '유저 없음'으로 읽힌다.
      if (r.users == null) agg[g].usrExact = false;
      else agg[g].usr += r.users;     // 7·30일은 서버가 준 기간 유니크(번호 단위)
    });
    // 임의 구간은 캠페인 묶음 단위로 받은 값을 그대로 얹는다 — 번호별로 더하지 않으므로
    // 두 번호를 다 누른 사람도 한 명이다.
    if (!PRESET_EXACT) {
      var gu = (VX._ckUsers && VX._ckUsers.key === (FROM + ':' + TO)) ? VX._ckUsers.map : null;
      if (gu) {
        Object.keys(agg).forEach(function (g) {
          agg[g].usr = gu[g] || 0;
          agg[g].usrExact = true;
        });
      }
    }
    // 운영표에 없는 번호 = 오래전 내린 배너·테스트 등록의 잔여 이벤트. 운영 판단에 쓸 수
    // 없는 값이라 뺀다. 다만 몇 건을 뺐는지는 표 아래에 남긴다 — 조용히 지우지 않는다.
    var allGroups = Object.keys(agg).map(function (k) { return agg[k]; });
    var orphanGroups = allGroups.filter(function (g) { return !g.reg; });
    VX._ckOrphan = {
      n: orphanGroups.length,
      clk: orphanGroups.reduce(function (a, g) { return a + g.clk; }, 0)
    };
    // 검색은 표를 거르지 않는다 — 배너를 찾아 그 운영 기간으로 데려다주는 역할만 한다.
    // (필터로 두면 고른 기간 밖의 배너는 이름을 정확히 쳐도 안 나온다.)
    var groups = allGroups.filter(function (g) { return g.reg; })
      .sort(function (a, b) { return b.clk - a.clk; });

    // 선택 상태 — 지면을 먼저 고르고, 그 지면의 배너만 목록에 올린다.
    // 배너를 한 통에 다 쏟으면 지면이 섞여 길기만 하고 고르기 어렵다.
    if (VX.clickPick === undefined) {          // 첫 진입 = 전체 지면·전체 합계
      VX.clickSurf = 'all';
      VX.clickPick = 'all';
    }
    // 차트의 계열은 '이름' 으로 묶인다. 집계 단위는 등록 하나라 재등록·지면별 등록으로
    // 같은 이름이 여럿이면 서로 다른 등록이 한 선으로 겹치고, 같은 날짜에 값과 0이 번갈아
    // 찍혀 톱니가 된다. 그래서 이름이 겹치는 것에만 등록번호를 붙여 각각 다른 선이 되게 한다.
    // (모두 붙이면 범례가 번호로 도배돼 읽기 어렵다.)
    var _nameCount = {};
    groups.forEach(function (g) { _nameCount[g.name] = (_nameCount[g.name] || 0) + 1; });
    groups.forEach(function (g) {
      var sq = seqLabel(g.ids);
      g.disp = (_nameCount[g.name] > 1 && sq) ? (g.name + ' ' + sq) : g.name;
    });

    var surf = VX.clickSurf || 'all';
    var inSurf = groups.filter(function (g) {
      return surf === 'all' || String(g.src).split('·').indexOf(surf) > -1;
    });
    // 고른 배너가 지금 지면·기간에 없으면 전체 합계로 되돌린다(임의의 다른 배너로 튀지 않게).
    if (VX.clickPick !== 'all' && VX.clickPick !== null &&
        !inSurf.some(function (g) { return g.g === VX.clickPick; })) {
      VX.clickPick = 'all';
    }

    // 지면 탭 — 드롭다운과 달리 지금 어느 지면을 보는 중인지 늘 드러나고, 지면마다 배너가
    // 몇 개인지도 함께 읽힌다(비어 있는 지면을 바로 알아챈다).
    var surfTabs = $id('bn-click-surftabs');
    if (surfTabs) {
      // 클릭이 실제로 잡히는 지면만 올린다.
      // 그룹의 src 는 합쳐진 값('main·bottom')일 수 있어 지면 하나씩으로 쪼갠다 —
      // 안 쪼개면 'main·bottom' 같은 내부 키가 그대로 탭에 나온다.
      var SRC_ORDER = ['main', 'bottom', 'search', 'side', 'side_notice', 'side_event'];
      var srcs = [], cnt = {};
      groups.forEach(function (g) {
        String(g.src || '').split('·').forEach(function (k) {
          if (!k) return;
          if (srcs.indexOf(k) < 0) { srcs.push(k); cnt[k] = 0; }
          cnt[k] += 1;
        });
      });
      srcs.sort(function (a, b) {
        var ia = SRC_ORDER.indexOf(a), ib = SRC_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      var tabs = [{ v: 'all', label: '전체 지면', n: groups.length }].concat(
        srcs.map(function (s) { return { v: s, label: SRC_LABEL[s] || s, n: cnt[s] }; }));
      surfTabs.innerHTML = tabs.map(function (t) {
        return '<button type="button" role="tab" class="ck-tab' + (t.v === surf ? ' on' : '') +
          '" aria-selected="' + (t.v === surf) + '" data-s="' + esc(t.v) + '">' +
          esc(t.label) + '<span class="ck-tab-n">' + t.n + '</span></button>';
      }).join('');
      if (!surfTabs.__bound) {
        surfTabs.__bound = true;
        surfTabs.addEventListener('click', function (ev) {
          var b = ev.target.closest('.ck-tab');
          if (!b) return;
          VX.clickSurf = b.dataset.s;
          VX.clickPick = 'all';   // 지면이 바뀌면 그 지면 전체 합계로 되돌린다
          clearBannerSel();
          renderClickCharts();
        });
      }
    }

    var pick = $id('bn-click-pick');
    if (pick) {
      pick.innerHTML =
        '<option value="all"' + (VX.clickPick === 'all' ? ' selected' : '') + '>' +
        (surf === 'all' ? '이 지면 전체 합계' : esc(SRC_LABEL[surf] || surf) + ' 전체 합계') + '</option>' +
        // 재등록이면 이름이 같으므로 등록번호를 함께 적는다 — 없으면 어느 쪽인지 못 고른다
        inSurf.map(function (g) {
          var sq = seqLabel(g.ids);
          return '<option value="' + esc(g.g) + '"' + (g.g === VX.clickPick ? ' selected' : '') + '>' +
            esc(g.name + (sq ? ' ' + sq : '')) + '</option>';
        }).join('');
      if (!pick.__bound) {
        pick.__bound = true;
        pick.addEventListener('change', function () {
          VX.clickPick = pick.value;
          clearBannerSel();   // 다른 배너를 고르면 검색으로 잡아 둔 선택은 더 이상 사실이 아니다
          renderClickCharts();
        });
      }
    }

    var sel = VX.clickPick || 'all';
    var keep = function (r) {
      if (!byKey[keyOf(r)]) return false;      // 운영표에 없는 번호는 차트에서도 뺀다
      if (sel !== 'all') return groupOf(r) === sel;
      return surf === 'all' || r.src === surf;
    };
    // 지면 필터를 건 채 소재를 고르면, 그 소재의 다른 지면 클릭까지 함께 본다
    // (합쳐 놓고 일부만 그리면 표의 합계와 차트가 어긋난다).
    if (sel !== 'all') keep = function (r) { return !!byKey[keyOf(r)] && groupOf(r) === sel; };

    // 일별 추이 — 클릭·유니크 유저 두 계열. 기간 선택을 차트에도 그대로 적용한다.
    // 원천은 합계와 같아야 한다. 30일 이하는 서버 응답, 그보다 길면 이력 원장이다 —
    // 둘을 섞으면 표의 합계와 차트의 선이 어긋난다.
    var dailySrc = PRESET_EXACT ? VX.clicks.rows : hist.rows;
    // 계열은 배너다. 클릭·유저 두 계열을 한 판에 겹치면 배너 간 비교가 안 되고,
    // 두 지표는 자릿수도 달라 한쪽 선이 바닥에 깔린다 → 지표는 필터로 하나만 고른다.
    // 선이 너무 많으면 아무것도 안 읽히므로 상위 6개만 그리고, 잘라낸 개수는 아래에 밝힌다.
    var TOP_N = 6;
    // ⚠️ 색은 '순위' 가 아니라 '배너' 에 붙어야 한다. 팔레트를 정렬 순서대로 나눠 주면
    // 지표를 클릭수↔유저수로 바꿀 때 순위가 뒤바뀌며 같은 배너의 색이 바뀐다.
    // 그래서 색 기준 순서는 클릭수 고정으로 한 번만 정하고, 표시 대상만 지표로 고른다.
    // 팔레트는 테마 SSOT(tableau-theme.js)를 그대로 쓴다. 여기서 따로 배열을 만들면
    // 순서가 어긋나 같은 배너가 화면마다 다른 색으로 나온다.
    var CK_PALETTE = (typeof TL !== 'undefined' && TL.PALETTE) ? TL.PALETTE
      : ['#4E79A7', '#F28E2B', '#E15759', '#76B7B2', '#59A14F', '#EDC948'];
    var colorOf = {};
    inSurf.slice().sort(function (a, b) { return b.clk - a.clk; })
      .forEach(function (g, i) { colorOf[g.g] = CK_PALETTE[i % CK_PALETTE.length]; });
    var ranked = inSurf.slice().sort(function (a, b) {
      return (METRIC === 'usr' ? b.usr - a.usr : b.clk - a.clk);
    });
    var shown = (sel !== 'all')
      ? ranked.filter(function (g) { return g.g === sel; })
      : ranked.slice(0, TOP_N);
    var hiddenCount = (sel !== 'all') ? 0 : Math.max(0, ranked.length - shown.length);
    var showSet = {}; shown.forEach(function (g) { showSet[g.g] = g.name; });

    var daily = {};
    dailySrc.forEach(function (r) {
      if (r.date < FROM || r.date > TO) return;
      if (!keep(r)) return;
      var g = groupOf(r);
      if (!showSet[g]) return;
      var d = r.date.slice(0, 4) + '-' + r.date.slice(4, 6) + '-' + r.date.slice(6, 8);
      if (!daily[d]) daily[d] = {};
      if (!daily[d][g]) daily[d][g] = { clk: 0, usr: 0 };
      daily[d][g].clk += r.clicks;
      daily[d][g].usr += (r.users || 0);
    });
    // x축은 순서형(하루=눈금 하나). 시간형으로 두면 데이터가 2-3일치일 때 축을 하루 안쪽으로
    // 쪼개 같은 날짜 라벨이 여러 번 반복된다. 시간대 보정으로 하루 밀리는 문제도 없앤다.
    var dates = Object.keys(daily).sort();
    var labelOfDate = function (d) { return d.slice(5).replace('-', '/'); };
    var order = dates.map(labelOfDate);
    var values = [];
    dates.forEach(function (d) {
      var lb = labelOfDate(d);
      shown.forEach(function (g) {
        var v = daily[d][g.g];
        // 그날 값이 없으면 0 — 선을 끊으면 노출이 멈춘 구간이 안 보인다.
        values.push({ 날짜: lb, 배너: g.disp,
                      지면: srcLabel(g.src),
                      값: v ? (METRIC === 'usr' ? v.usr : v.clk) : 0 });
      });
    });
    var seriesOrder = shown.map(function (g) { return g.disp; });
    var seriesColor = shown.map(function (g) { return colorOf[g.g] || '#9aa3b2'; });
    if (!values.length) {
      host.innerHTML = '<div class="vx-empty">선택한 배너의 클릭 데이터가 없습니다.</div>';
    } else {
      ensureVega().then(function () {
        TL.chart(host, {
          data: { values: values },
          mark: { type: 'line', point: true },
          encoding: {
            x: {
              field: '날짜', type: 'ordinal', title: null,
              scale: { domain: order },
              // 라벨은 마지막 날짜부터 같은 간격으로 솎는다.
              // 앞에서부터 세면서 "마지막은 무조건 포함"으로 하면 끝 두 개가 붙어 겹친다.
              axis: { labelAngle: 0, labelOverlap: 'greedy',
                      values: (function () {
                        var n = order.length;
                        var step = Math.max(1, Math.ceil(n / 10));
                        return order.filter(function (_, i) { return (n - 1 - i) % step === 0; });
                      })() }
            },
            y: { field: '값', type: 'quantitative', title: METRIC_LABEL },
            color: {
              field: '배너', type: 'nominal', title: null,
              scale: { domain: seriesOrder, range: seriesColor },
              // 범례는 아래로. 위에 두면 차트 폭의 3분의 1만 쓰면서 배너명이 잘렸다.
              // labelLimit 을 넉넉히 줘 긴 배너명도 끝까지 보이게 한다.
              legend: { orient: 'bottom', direction: 'horizontal', columns: 0,
                        labelLimit: 320, symbolType: 'stroke', symbolStrokeWidth: 3,
                        labelFontSize: 11, offset: 8 }
            },
            // 배너를 맨 위에 둔다 — 여러 선이 겹칠 때 가장 먼저 묻는 게 '어느 배너냐' 다.
            tooltip: [{ field: '배너', type: 'nominal', title: '배너' },
                      { field: '지면', type: 'nominal', title: '지면' },
                      { field: '날짜', type: 'ordinal', title: '날짜' },
                      { field: '값', type: 'quantitative', format: ',', title: METRIC_LABEL }]
          }
        }, { height: 210 });
      }).catch(function () {
        host.innerHTML = '<div class="vx-empty">차트 라이브러리 로드 실패 (네트워크 확인)</div>';
      });
    }
    // 잘라낸 계열은 반드시 밝힌다 — 안 그러면 상위 6개가 전부인 줄 읽힌다.
    var noteEl = $id('bn-click-chart-note');
    if (noteEl) {
      noteEl.innerHTML = hiddenCount
        ? esc('상위 ' + shown.length + '개만 표시 · 나머지 ' + hiddenCount + '개는 아래 표에')
        : '';
    }

    // 표는 차트와 같은 선택(지면·배너·기간)을 따른다 — 위아래가 다른 모수를 보여 주면
    // 표의 숫자가 차트의 어느 선인지 대응이 안 돼 둘 다 못 믿게 된다.
    // 배너 하나를 고른 상태에서도 표는 그 지면 전체를 유지한다 — 표가 한 줄로 줄면
    // 다른 배너로 갈아탈 수단이 사라져 표에서 고르는 흐름이 끊긴다. 대신 선택 행을 강조한다.
    // 지면·배너·기간이 바뀌면 순위가 통째로 다른 목록이다 — 보던 쪽 번호를 물려주지 않는다.
    var ckSig = [surf, sel, RANGE, FROM, TO].join('|');
    if (VX._ckSig !== ckSig) { VX._ckSig = ckSig; VX.ckPage = 1; VX._ckJump = true; }
    var tableRows = inSurf
      .map(function (g) {
        return { g: g.g, name: g.name, cls: g.cls, src: g.src, seq: seqLabel(g.ids),
                 srcFull: srcLabel(g.src), srcShort: srcLabel(g.src, true),
                 clk: g.clk, usr: g.usr, usrReady: PRESET_EXACT || g.usrExact,
                 on: sel !== 'all' && g.g === sel };
      })
      .sort(function (a, b) { return b.clk - a.clk; });
    function dot(s) { return s.slice(0, 4) + '.' + s.slice(4, 6) + '.' + s.slice(6, 8); }
    renderClickTable(tableRows, SRC_LABEL, {
      label: PRESET_EXACT ? ('직전 ' + RANGE + '일') : (dot(FROM) + ' - ' + dot(TO))
    });
    // 기간이 바뀌면 숫자의 출처도 바뀐다 — 상단 '데이터 갱신' 시각을 그 출처로 맞춘다.
    renderFreshness();
  }

  // 클릭 표 — 순위 + 배너 + 지면 + 분류 + 선택 기간의 클릭수·유저수 총계.
  // range = { label: '직전 30일' | '2025.03.01 - 2025.06.30' }
  // 유저수는 어느 구간이든 그 안에서 중복 제거한 고유값이다. 아직 안 온 행은 '…'로 둔다.
  // ───────────────── 기간 선택기 (두 달 나란히) ─────────────────
  // 브라우저 기본 날짜 입력은 표기(연도.월.일)도 달 이동(위아래 화살표)도 손댈 수 없다.
  // 이 카드가 다루는 구간이 1년 반이라 한 달짜리 달력으로는 먼 과거까지 화살표를 열 번 넘게
  // 눌러야 해서, 두 달을 함께 띄우고 좌우 화살표가 두 달을 같이 옮기게 했다.
  var CK_DOW = ['일', '월', '화', '수', '목', '금', '토'];

  function d8(d) {   // Date → 'YYYYMMDD'
    return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') +
           String(d.getDate()).padStart(2, '0');
  }
  function p8(s) {   // 'YYYYMMDD' → Date
    return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  }
  function hy(s) { return s ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : ''; }

  function ckMonthHtml(base, from, to, min, max) {
    var y = base.getFullYear(), m = base.getMonth();
    var lead = new Date(y, m, 1).getDay(), last = new Date(y, m + 1, 0).getDate();
    var h = '<div class="ck-cal"><div class="ck-cal-head"><span class="ck-cal-title">' +
      y + '-' + String(m + 1).padStart(2, '0') + '</span></div><div class="ck-grid">' +
      CK_DOW.map(function (d, i) {
        return '<span class="ck-dow' + (i === 0 ? ' sun' : '') + '">' + d + '</span>';
      }).join('');
    for (var i = 0; i < lead; i++) h += '<span class="ck-day out"></span>';
    for (var d = 1; d <= last; d++) {
      var key = d8(new Date(y, m, d));
      var dis = key < min || key > max;
      var isS = key === from, isE = key === to;
      var mid = from && to && key > from && key < to;
      h += '<button type="button" class="ck-day' + (mid ? ' in' : '') +
        (isS || isE ? ' edge' : '') + (isS ? ' s' : '') + (isE ? ' e' : '') + '"' +
        (dis ? ' disabled' : '') + ' data-d="' + key + '">' + d + '</button>';
    }
    return h + '</div></div>';
  }

  // 두 달 달력 기간 선택기. 배너 클릭 성과와 퍼포먼스 마케팅이 함께 쓴다.
  // 날짜는 모두 'YYYYMMDD'. 현재 구간·범위는 st 에 두어 이벤트 핸들러(한 번만 붙는다)가
  // 첫 호출 때의 값에 묶이지 않고 늘 마지막 값을 읽게 한다.
  // o = { trig, pop, lbFrom, lbTo, st, from, to, min, max,
  //       quick: [[이름, 키]], quickRange(키) → [시작 Date, 끝 Date], onApply(from, to) }
  function mountRangePicker(o) {
    var trig = o.trig, pop = o.pop, st = o.st;
    if (!trig || !pop) return;
    st.o = o; st.from = o.from; st.to = o.to;
    if (o.lbFrom) o.lbFrom.textContent = hy(o.from);
    if (o.lbTo) o.lbTo.textContent = hy(o.to);

    // 커서 달: 처음 열 때는 종료일이 오른쪽 달에 오도록 맞춘다.
    if (!st.cur) {
      var t = p8(o.to);
      st.cur = d8(new Date(t.getFullYear(), t.getMonth() - 1, 1));
    }
    // 고르는 중인 임시 범위(적용 전). 없으면 현재 구간을 그대로 보여 준다.
    if (!st.draft) st.draft = { from: o.from, to: o.to, next: 'from' };

    function draw() {
      var oo = st.o, min = oo.min, max = oo.max;
      var cur = p8(st.cur), dr = st.draft;
      // 좁은 화면에서는 한 달만 — 두 달을 나란히 두면 팝오버가 화면을 넘는다.
      var one = document.documentElement.clientWidth < 720;
      var months = one
        ? [new Date(cur.getFullYear(), cur.getMonth(), 1)]
        : [new Date(cur.getFullYear(), cur.getMonth(), 1),
           new Date(cur.getFullYear(), cur.getMonth() + 1, 1)];
      var prevOk = d8(new Date(cur.getFullYear(), cur.getMonth(), 0)) >= min;
      var nextOk = d8(new Date(cur.getFullYear(), cur.getMonth() + months.length, 1)) <= max;
      pop.innerHTML =
        '<div class="ck-pop-top">' +
        '  <button type="button" class="ck-nav" data-nav="-1" aria-label="이전 달"' +
             (prevOk ? '' : ' disabled') + '>' +
        '    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>' +
        '  <span class="ck-pop-range">' + esc(hy(dr.from)) + ' - ' + esc(hy(dr.to)) + '</span>' +
        '  <button type="button" class="ck-nav" data-nav="1" aria-label="다음 달"' +
             (nextOk ? '' : ' disabled') + '>' +
        '    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg></button>' +
        '</div>' +
        '<div class="ck-cals">' +
        months.map(function (b) { return ckMonthHtml(b, dr.from, dr.to, min, max); }).join('') +
        '</div>' +
        '<div class="ck-pop-foot"><div class="ck-quick">' +
        (oo.quick || []).map(function (q) {
          return '<button type="button" data-q="' + q[1] + '">' + q[0] + '</button>';
        }).join('') +
        '</div><button type="button" class="ck-apply">적용</button></div>';
    }

    // 팝오버가 화면 밖으로 나가지 않게 자리를 잡는다. 두 달을 나란히 띄우면 폭이 490px라
    // 분할 화면·모바일에서는 그대로 두면 잘린다 → 좁으면 한 달로 접고, 그래도 넘치면 민다.
    // 팝오버는 트리거 기준 절대배치라 right:0 으로는 화면 밖을 벗어나지 못한다.
    // 넘친 만큼 그대로 밀어 넣는다 — 분할 화면·모바일에서도 항상 화면 안에 들어온다.
    function place() {
      var M = 8, vw = document.documentElement.clientWidth;
      pop.style.transform = ''; pop.style.maxWidth = '';
      pop.classList.toggle('narrow', vw < 720);
      var r = pop.getBoundingClientRect();
      if (r.width > vw - M * 2) {                  // 화면보다 넓으면 폭부터 줄인다
        pop.style.maxWidth = (vw - M * 2) + 'px';
        r = pop.getBoundingClientRect();
      }
      var dx = 0;
      if (r.right > vw - M) dx = -(r.right - (vw - M));   // 오른쪽이 잘린다 → 왼쪽으로
      if (r.left + dx < M) dx = M - r.left;               // 그래도 왼쪽이 나가면 안쪽으로
      if (dx) pop.style.transform = 'translateX(' + Math.round(dx) + 'px)';
    }

    function open(v) {
      pop.classList.toggle('open', v);
      trig.classList.toggle('open', v);
      if (v) { st.draft = { from: st.from, to: st.to, next: 'from' }; draw(); place(); }
    }

    if (!trig.__bound) {
      trig.__bound = true;
      trig.onclick = function (ev) { ev.stopPropagation(); open(!pop.classList.contains('open')); };
      // 바깥을 누르면 닫는다. 팝오버 안쪽 클릭은 여기까지 오지 않게 막는다.
      pop.addEventListener('click', function (ev) { ev.stopPropagation(); });
      document.addEventListener('click', function () { open(false); });

      pop.addEventListener('click', function (ev) {
        var oo = st.o;
        var nav = ev.target.closest('.ck-nav');
        if (nav && !nav.disabled) {
          var c = p8(st.cur);
          st.cur = d8(new Date(c.getFullYear(), c.getMonth() + Number(nav.dataset.nav), 1));
          draw(); return;
        }
        var q = ev.target.closest('[data-q]');
        if (q && oo.quickRange) {
          var rg = oo.quickRange(q.dataset.q);
          var ff = d8(rg[0]) < oo.min ? oo.min : d8(rg[0]), tt = d8(rg[1]) > oo.max ? oo.max : d8(rg[1]);
          st.draft = { from: ff, to: tt, next: 'from' };
          st.cur = d8(new Date(p8(ff).getFullYear(), p8(ff).getMonth(), 1));
          draw(); return;
        }
        var day = ev.target.closest('.ck-day[data-d]');
        if (day && !day.disabled) {
          var k = day.dataset.d, dr = st.draft;
          // 첫 클릭은 시작을 잡고, 두 번째 클릭이 끝을 정한다. 거꾸로 고르면 뒤집는다.
          if (dr.next === 'from') { dr.from = k; dr.to = k; dr.next = 'to'; }
          else { if (k < dr.from) dr.from = k; else dr.to = k; dr.next = 'from'; }
          draw(); return;
        }
        if (ev.target.closest('.ck-apply')) {
          open(false);
          oo.onApply(st.draft.from, st.draft.to);
        }
      });
    }
    if (pop.classList.contains('open')) draw();
  }

  function setupDatePicker(FROM, TO, min, max) {
    mountRangePicker({
      trig: $id('bn-ck-trigger'), pop: $id('bn-ck-pop'),
      lbFrom: $id('bn-ck-lb-from'), lbTo: $id('bn-ck-lb-to'),
      st: VX.ckSt, from: FROM, to: TO, min: min, max: max,
      quick: [['이번 달', 'tm'], ['지난 달', 'lm'], ['올해', 'ty'], ['작년', 'ly']],
      quickRange: function (v) {
        var today = kstToday(), yy = today.getFullYear(), mm = today.getMonth();
        if (v === 'tm') return [new Date(yy, mm, 1), p8(max)];
        if (v === 'lm') return [new Date(yy, mm - 1, 1), new Date(yy, mm, 0)];
        if (v === 'ty') return [new Date(yy, 0, 1), p8(max)];
        return [new Date(yy - 1, 0, 1), new Date(yy - 1, 11, 31)];
      },
      onApply: function (f, t) {
        VX.clickRange = 'custom';
        VX.clickFrom = f; VX.clickTo = t;
        clearBannerSel();                 // 기간을 직접 잡으면 배너 선택 칩은 뗀다
        renderClickCharts();
      }
    });
  }

  // ───────────────── 배너 검색 (기간에 묶이지 않는 내비게이션) ─────────────────
  // 검색은 표를 거르지 않는다. 원장 전체에서 배너를 찾아 그 배너의 운영 구간으로 데려다준다.
  // 필터로 두면 "고른 기간 안에 없는 배너"는 이름을 정확히 쳐도 안 나와서 찾을 방법이 없다.
  // 임의 구간의 배너별 고유 유저를 원본 이벤트 테이블에서 받아온다. 같은 구간을 두 번
  // 부르지 않도록 진행 중인 요청을 기억해 둔다(구간을 빠르게 오갈 때 요청이 겹친다).
  // 캠페인 묶음(번호 여럿)을 그대로 보내 서버가 한 번에 세게 한다. 번호별로 받아 더하면
  // 두 번호를 다 누른 사람이 중복된다 — 재등록이 잦은 캠페인일수록 커지는 오차다.
  function loadRangeUsers(from, to) {
    var key = from + ':' + to;
    if (VX._ckUsersPending === key) return;
    VX._ckUsersPending = key;

    var idx = buildBannerIndex(VX.hist) || [];
    var groups = {};
    idx.forEach(function (e) {
      var ks = Object.keys(e.keys || {});
      if (ks.length) groups[e.g] = ks;
    });

    function done(map) {
      VX._ckUsersPending = null;
      VX._ckUsers = { key: key, map: map };
      if (VX.view === 'banner') renderClickCharts();
    }
    fetchJson('/api/banner-range-users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: from, to: to, groups: groups })
    }).then(function (res) {
      done((res && res.ok && res.groups) ? res.groups : {});
    }).catch(function () { done({}); });
  }

  // 검색으로 잡아 둔 배너 선택을 푼다. 칩은 "이 배너를, 이 기간으로 보는 중"이라는 뜻이라
  // 사용자가 기간·지면·배너를 직접 바꾸는 순간 사실이 아니게 된다. 남겨 두면 화면이 거짓말을 한다.
  function clearBannerSel() { VX._ckSel = null; VX._ckPrev = null; }

  // 등록번호(seq) 표기. 재등록으로 한 캠페인에 번호가 여럿 붙으면 최신 번호부터 그대로 잇는다.
  // 개수로 줄이면(+2) 무슨 번호인지 알 수 없어 어드민에서 찾을 수가 없다.
  function seqLabel(ids) {
    var ns = Object.keys(ids || {}).sort(function (a, b) { return (+b || 0) - (+a || 0); });
    return ns.length ? '#' + ns.join('·') : '';
  }

  // 지면 이름 — 표·차트와 검색이 같은 말을 쓰도록 한곳에 둔다.
  // 한 배너가 여러 지면에 걸리면 '메인 홈 팝업·하단배너' 처럼 길어져 좁은 칸에서 잘리므로,
  // 둘 이상일 때는 짧은 이름으로 줄인다.
  var CK_SRC_LABEL = { main: '메인 홈 팝업', bottom: '하단배너', search: '검색·플로팅' };
  var CK_SRC_SHORT = { main: '메인', bottom: '하단', search: '검색·플로팅' };
  var CK_SRC_ORDER = ['main', 'bottom', 'search'];
  function ckSrcLabel(src, short) {
    var ks = String(src || '').split('·').filter(Boolean);
    var map = (short && ks.length > 1) ? CK_SRC_SHORT : CK_SRC_LABEL;
    return ks.map(function (k) { return map[k] || k; }).join('·');
  }

  function buildBannerIndex(hist) {
    // 원장이 오기 전에 만들면 운영 구간을 못 채워 전부 걸러진다. 그 빈 결과를 캐시해 두면
    // 원장이 도착한 뒤에도 검색이 영영 비어 나온다 — 그래서 원장이 있을 때만 캐시한다.
    var ready = !!(hist && hist.rows && hist.rows.length);
    if (VX._ckIndex && VX._ckIndexReady) return VX._ckIndex;
  // 검색 단위도 표·차트와 같아야 한다 — 운영표 등록 하나가 배너 하나다.
    var banners = (VX.reg && VX.reg.banners) || [];
    var byGroup = {};
    banners.forEach(function (b) {
      var g = 'b:' + b.id;
      if (!byGroup[g]) byGroup[g] = { g: g, name: cleanName(b.name), keys: {}, ids: {}, srcs: {}, from: '', to: '' };
      bannerClickKeys(b).forEach(function (ck) {
        var parts = ck.split(':');                 // 'main:1101'
        byGroup[g].keys[ck] = true;
        byGroup[g].ids[parts[1]] = true;
        byGroup[g].srcs[parts[0]] = true;
      });
    });
    // 운영 구간은 클릭이 실제로 잡힌 날의 처음·마지막으로 잡는다. 운영표 날짜는 재등록·연장으로
    // 실제와 어긋나는 일이 잦은데, 클릭 발생일은 데이터가 말해 주는 사실이다.
    var keyToGroup = {};
    Object.keys(byGroup).forEach(function (g) {
      Object.keys(byGroup[g].keys).forEach(function (ck) { keyToGroup[ck] = g; });
    });
    ((hist && hist.rows) || []).forEach(function (r) {
      var g = keyToGroup[r.src + ':' + r.contentId];
      if (!g) return;
      var e = byGroup[g];
      if (!e.from || r.date < e.from) e.from = r.date;
      if (!e.to || r.date > e.to) e.to = r.date;
    });
    VX._ckIndex = Object.keys(byGroup).map(function (g) { return byGroup[g]; })
      .filter(function (e) { return e.from && e.to; })   // 클릭 이력이 있는 배너만
      .sort(function (a, b) { return b.to.localeCompare(a.to); });   // 최근 운영순
    VX._ckIndexReady = ready;
    return VX._ckIndex;
  }

  function setupBannerSearch(hist, min, max) {
    var qEl = $id('bn-ck-q'), sug = $id('bn-ck-sug'), chip = $id('bn-ck-chip');
    if (!qEl || !sug || !chip) return;

    // 선택된 배너가 있으면 칩으로 드러낸다. ×를 누르면 직전 기간으로 돌아간다.
    if (VX._ckSel) {
      chip.hidden = false;
      chip.innerHTML = '<span class="ck-chip-nm">' + esc(VX._ckSel.name) +
        (VX._ckSel.seq ? ' ' + esc(VX._ckSel.seq) : '') + '</span>' +
        '<span class="ck-chip-meta">' + esc(hy(VX._ckSel.from) + ' - ' + hy(VX._ckSel.to)) + '</span>' +
        '<button type="button" class="ck-chip-x" aria-label="선택 해제">×</button>';
      chip.querySelector('.ck-chip-x').onclick = function () {
        var prev = VX._ckPrev || { range: 30, from: null, to: null };
        VX.clickRange = prev.range; VX.clickFrom = prev.from; VX.clickTo = prev.to;
        VX.clickPick = 'all'; VX._ckSel = null; VX.ckSt.cur = null;
        renderClickCharts();
      };
    } else {
      chip.hidden = true;
      chip.innerHTML = '';
    }

    if (qEl.__bound) return;
    qEl.__bound = true;

    function close() { sug.classList.remove('open'); sug.innerHTML = ''; }

    function draw() {
      var q = String(qEl.value || '').trim().toLowerCase();
      if (!q) { close(); return; }
      // 핸들러는 한 번만 묶이므로 여기서 잡아 둔 hist 를 쓰면 첫 렌더 때의 값(대개 없음)에
      // 갇힌다. 매번 지금의 원장을 본다.
      var hit = buildBannerIndex(VX.hist).filter(function (e) {
        return e.name.toLowerCase().indexOf(q) > -1;
      }).slice(0, 12);
      if (!hit.length) {
        sug.classList.add('open');
        sug.innerHTML = '<div class="ck-sug-empty">이름이 맞는 배너가 없습니다</div>';
        return;
      }
      sug.classList.add('open');
      sug.innerHTML = '<div class="ck-sug-h">전체 기간에서 찾음 ' + hit.length + '건</div>' +
        hit.map(function (e) {
          var sq = seqLabel(e.ids);
          var sv = ckSrcLabel(CK_SRC_ORDER.filter(function (k) { return e.srcs && e.srcs[k]; }).join('·'), true);
          return '<button type="button" class="ck-sug-i" data-g="' + esc(e.g) + '">' +
            '<span class="ck-sug-nm">' + esc(e.name) +
              (sq ? '<span class="ck-seq">' + esc(sq) + '</span>' : '') + '</span>' +
            '<span class="ck-sug-meta">' + (sv ? esc(sv) + ' · ' : '') +
              esc(hy(e.from) + ' - ' + hy(e.to)) + '</span></button>';
        }).join('');
    }

    qEl.oninput = draw;
    qEl.onfocus = draw;
    qEl.onkeydown = function (ev) { if (ev.key === 'Escape') { qEl.value = ''; close(); } };
    qEl.addEventListener('click', function (ev) { ev.stopPropagation(); });
    sug.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var it = ev.target.closest('.ck-sug-i');
      if (!it) return;
      var e = (VX._ckIndex || []).filter(function (x) { return x.g === it.dataset.g; })[0];
      if (!e) return;
      // 돌아갈 자리를 기억해 둔다 — 칩의 ×가 되돌리는 지점이다.
      VX._ckPrev = { range: VX.clickRange, from: VX.clickFrom, to: VX.clickTo };
      VX._ckSel = { g: e.g, name: e.name, seq: seqLabel(e.ids), from: e.from, to: e.to };
      VX.clickRange = 'custom'; VX.clickFrom = e.from; VX.clickTo = e.to;
      VX.clickSurf = 'all';       // 지면 필터에 걸려 안 보이는 일이 없게
      VX.clickPick = e.g;         // 차트를 그 배너로 좁힌다
      VX.ckSt.cur = null;           // 달력 커서를 새 구간 기준으로 다시 잡는다
      qEl.value = ''; close();
      renderClickCharts();
    });
    document.addEventListener('click', close);
  }

  function renderClickTable(rows, SRC_LABEL, range) {
    var host = $id('bn-click-table');
    if (!rows.length) {
      host.innerHTML = '<div class="vx-empty">선택한 조건에 집계된 클릭이 없습니다.</div>';
      return;
    }
    // 막대 기준은 쪽이 아니라 표 전체의 최대값이다 — 쪽마다 기준이 바뀌면 길이를 못 믿는다.
    var max = rows.reduce(function (m, r) { return Math.max(m, r.clk); }, 0) || 1;
    if (!VX.ckSize) VX.ckSize = 10;
    // 고른 배너가 지금 쪽에 없으면 표에서 사라진 것처럼 보인다 — 그 배너가 있는 쪽으로 옮긴다.
    // 옮기는 건 새로 고른 그 순간뿐이다. 그 뒤로는 쪽 넘김이 우선이라 다시 끌어오지 않는다.
    if (VX._ckJump) {
      var onIdx = -1;
      rows.forEach(function (r, i) { if (r.on && onIdx < 0) onIdx = i; });
      if (onIdx >= 0) VX.ckPage = Math.floor(onIdx / VX.ckSize) + 1;
      VX._ckJump = false;
    }
    var sl = pageSlice(rows, VX.ckPage, VX.ckSize);
    VX.ckPage = sl.page;
    host.innerHTML =
      '<div class="ck-tbl wide">' +
      // 부연이 필요한 건 클릭수·유저수 둘뿐이다. 그 둘만 물음표를 달고, 물음표에만 툴팁을
      // 건다 — 열 이름 전체를 올려도 뜨면 어디를 가리켜야 하는지 알 수 없다.
      '<div class="ck-head"><span class="ck-rank"></span>' +
      '<span class="ck-nm">배너</span>' +
      '<span class="ck-src">지면</span><span class="ck-cls">분류</span>' +
      '<span class="ck-val">클릭수<i class="ck-help" data-tip="' +
        esc(range.label + ' 클릭 총계 · 오늘 제외\nGA4 적재 지연으로 최근 1-2일은 과소 집계될 수 있습니다') +
        '">?</i></span>' +
      '<span class="ck-usr">유저수<i class="ck-help tip-r" data-tip="' +
        esc(range.label + ' 고유 유저 · 기간 안에서 중복 제거한 사람 수\n' +
            '여러 날 온 사람도 한 명으로 셉니다') + '">?</i></span></div>' +
      sl.rows.map(function (r, i) {
        var w = Math.max(3, Math.round(r.clk / max * 100));
        // 행 클릭 = 그 배너로 필터. 다시 누르면 전체로 돌아온다(선택을 푸는 수단이 필요하다).
        return '<div class="ck-row pick' + (r.on ? ' on' : '') + '" data-g="' + esc(r.g || '') +
          '" role="button" tabindex="0">' +
          '<span class="ck-rank">' + (sl.offset + i + 1) + '</span>' +
          '<span class="ck-nm" title="' + esc(r.name + (r.seq ? ' ' + r.seq : '')) + '">' +
            esc(r.name) + (r.seq ? '<span class="ck-seq">' + esc(r.seq) + '</span>' : '') + '</span>' +
          // 지면은 부연이 필요한 열이 아니다 — 줄임말 원문만 기본 title 로 남긴다
          // (data-tip 을 쓰면 커서가 바뀌고 툴팁이 떠서 설명이 있는 열처럼 보인다).
          '<span class="ck-src" title="' + esc(r.srcFull || '') + '">' +
            esc(r.srcShort || r.srcFull || '') + '</span>' +
          '<span class="ck-cls">' + (r.cls ? '<span class="vx-chip cls-' + esc(r.cls) + '">' + esc(r.cls) + '</span>' : '') + '</span>' +
          '<span class="ck-val"><span class="ck-track"><span class="ck-bar" style="width:' + w + '%"></span></span>' +
          '<b>' + fmtN(r.clk) + '</b></span>' +
          '<span class="ck-usr">' + (r.usrReady ? fmtN(r.usr) : '<i class="ck-wait">…</i>') +
          '</span></div>';
      }).join('') + '</div>' +
      pagerHtml(sl, [10, 20, 50]) +
      // 각주에는 이 화면에서만 알 수 있는 '뺀 것'만 남긴다. 기간은 필터 줄에 이미 있고,
      // 지표의 정의·집계 한계는 해당 열에 마우스를 올리면 나오므로 여기 늘어놓지 않는다.
      ((VX._ckOrphan && VX._ckOrphan.n)
        ? '<div class="vx-note" style="margin-top:8px">운영표에 없는 번호 ' + VX._ckOrphan.n +
          '건(클릭 ' + fmtN(VX._ckOrphan.clk) + ')은 제외했습니다</div>'
        : '');

    host.querySelectorAll('.ck-row.pick').forEach(function (el) {
      function toggle() {
        var g = el.dataset.g;
        if (!g) return;
        VX.clickPick = (VX.clickPick === g) ? 'all' : g;
        clearBannerSel();   // 표에서 직접 고른 순간 검색 선택은 지난 이야기가 된다
        renderClickCharts();
      }
      el.onclick = toggle;
      el.onkeydown = function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      };
    });

    bindPager(host, sl,
      function (p) { VX.ckPage = p; renderClickTable(rows, SRC_LABEL, range); scrollToCard(host); },
      function (n) { VX.ckSize = n; VX.ckPage = 1; renderClickTable(rows, SRC_LABEL, range); });
  }

  // heatTable은 vega 불필요 — TL 전역만 있으면 됨 (const 선언이라 window.TL 아님)
  function TLReady(fn) { if (typeof TL !== 'undefined') fn(); }

  // ═════════════════════ ② 퍼포먼스 마케팅 ═════════════════════

  // 기본 기간은 지난 ISO 주(월~일)다. 서버는 같은 길이의 바로 앞 구간과 비교한다.
  var PM_PERIODS = [['lw', '저번주'], ['yd', '어제'], ['td', '오늘'], ['tm', '이번 달'], ['lm', '지난 달']];
  var PM_N_OPTS = [7, 14, 30];
  var PM_MIN = '20250401';   // 에어브릿지 앱 등록 이후

  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

  function pmRange(p, n) {
    var today = kstToday(), yd = addDays(today, -1);
    if (p === 'td') return [ymd(today), ymd(today)];
    if (p === 'yd') return [ymd(yd), ymd(yd)];
    if (p === 'n') return [ymd(addDays(yd, -(n - 1))), ymd(yd)];
    // 이번 달은 어제까지(오늘은 집계 중이라 합계를 흔들고 실시간 조회로 느려진다). 1일이면 오늘 하루
    if (p === 'tm') {
      var m1 = new Date(today.getFullYear(), today.getMonth(), 1);
      return today.getDate() === 1 ? [ymd(today), ymd(today)] : [ymd(m1), ymd(yd)];
    }
    if (p === 'lm') {
      return [ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
              ymd(new Date(today.getFullYear(), today.getMonth(), 0))];
    }
    var mon = addDays(today, -((today.getDay() + 6) % 7));   // 이번 주 월요일
    return [ymd(addDays(mon, -7)), ymd(addDays(mon, -1))];
  }

  // 금액은 표에서 원 단위 그대로, 카드에서 만·억으로 줄여 [숫자, 단위] 로 나눈다
  function pmWon(v) { return (v == null || isNaN(v)) ? '-' : Math.round(v).toLocaleString() + '원'; }
  function pmWonParts(v) {
    if (v == null || isNaN(v)) return ['-', ''];
    var a = Math.abs(v), sg = v < 0 ? '-' : '';
    if (a >= 1e8) {
      var t = (a / 1e8).toFixed(2);
      t = t.replace(/0+$/, '').replace(/\.$/, '');
      return [sg + t, '억 원'];
    }
    if (a >= 1e4) return [sg + Math.round(a / 1e4).toLocaleString(), '만 원'];
    return [sg + Math.round(a).toLocaleString(), '원'];
  }
  function pmWonShort(v) { var q = pmWonParts(v); return q[0] + q[1]; }
  function pmRate(v) { return v == null || isNaN(v) ? '-' : fmtP(v, v < 10 ? 1 : 0); }

  function pmHelp(tip, right, title) {
    return '<i class="ck-help tip-w' + (right ? ' tip-r' : '') + '" tabindex="0" data-tip="' + esc(tip) + '"' + (title ? ' data-title="' + esc(title) + '"' : '') + '>?</i>';
  }

  // 퍼마 화면의 [data-tip] 은 요소 옆 CSS 말풍선 대신 화면 기준 고정 상자로 띄운다.
  // 카드 오른쪽 끝의 도움말이 카드 밖에서 잘리던 문제. 아래 자리가 모자라면 위로, 좌우는 화면 안으로 민다
  function pmTipInit() {
    if ($id('pm-tipbox')) return;
    var box = document.createElement('div');
    box.id = 'pm-tipbox';
    document.body.appendChild(box);
    function rows(lines) {
      return lines.map(function (line) {
        var m = /^([^:：]{1,18}):\s+(.+)$/.exec(line);
        return m ? '<div class="tb-row"><b>' + esc(m[1]) + '</b><i>:</i><span>' + esc(m[2]) + '</span></div>'
                 : '<div class="tb-row"><span>' + esc(line) + '</span></div>';
      }).join('');
    }
    function show(el) {
      var lines = String(el.getAttribute('data-tip') || '').split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      var title = el.getAttribute('data-title');
      if (!title && lines.length > 1) title = lines.shift();
      box.innerHTML = (title ? '<div class="tb-title">' + esc(title) + '</div>' : '') + rows(lines);
      box.style.display = 'block';
      var pos = pmTipPlace(el, box.offsetWidth, box.offsetHeight);
      box.style.left = pos[0] + 'px'; box.style.top = pos[1] + 'px';
    }
    // 자리 잡기: 화면 밖으로 안 나가고, 마우스를 올린 카드 바깥(오른쪽 → 왼쪽 → 아래 → 위)에 둔다.
    // 카드가 화면 폭을 다 차지해 바깥이 없으면(표 등) 올린 단어를 가리지 않게 단어 바로 아래, 자리가 없으면 위에
    function pmTipPlace(el, bw, bh) {
      // 단어 바로 아래(왼쪽 맞춤). 아래가 모자라면 단어 위. 화면 밖으로는 나가지 않는다
      var M = 8, W = window.innerWidth, H = window.innerHeight;
      var a = el.getBoundingClientRect();
      var x = Math.max(M, Math.min(a.left - 10, W - bw - M));
      var y = a.bottom + 8;
      if (y + bh > H - M) y = a.top - bh - 8;
      return [x, Math.max(M, Math.min(y, H - bh - M))];
    }
    function hide() { box.style.display = 'none'; }
    function target(e) { return e.target && e.target.closest ? e.target.closest('#view-pm [data-tip]') : null; }
    document.addEventListener('mouseover', function (e) { var el = target(e); if (el) show(el); });
    document.addEventListener('mouseout', function (e) { var el = target(e); if (el && !el.contains(e.relatedTarget)) hide(); });
    document.addEventListener('focusin', function (e) { var el = target(e); if (el) show(el); });
    document.addEventListener('focusout', function (e) { if (target(e)) hide(); });
    window.addEventListener('scroll', hide, true);
  }

  function loadPmView() {
    var root = $id('view-pm');
    pmTipInit();
    var r = pmRange(VX.pm.period, VX.pm.nDays);
    VX.pm.from = r[0]; VX.pm.to = r[1];
    root.innerHTML =
      '<div class="pm-controls">' +
      '  <div class="bn-seg pm-seg" id="pm-period">' +
      PM_PERIODS.map(function (x) { return '<button type="button" data-p="' + x[0] + '">' + x[1] + '</button>'; }).join('') +
      '    <span class="pm-nwrap"><button type="button" data-p="n" id="pm-n-btn" aria-haspopup="menu">' +
      '      <span id="pm-n-lb">최근 N일</span>' +
      '      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>' +
      '      <div class="pm-nmenu" id="pm-nmenu" role="menu">' +
      PM_N_OPTS.map(function (n) { return '<button type="button" role="menuitem" data-n="' + n + '">최근 ' + n + '일</button>'; }).join('') +
      '      </div></span>' +
      '  </div>' +
      '  <span class="ck-datefield">' +
      '    <button type="button" class="ck-dtrigger" id="pm-ck-trigger" aria-haspopup="dialog">' +
      '      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/>' +
      '        <path d="M3 10h18M8 3v4M16 3v4"/></svg>' +
      '      <span id="pm-ck-lb-from"></span><span class="ck-dash">-</span><span id="pm-ck-lb-to"></span><span class="ck-wk" id="pm-badge"></span>' +
      '    </button>' +
      '    <div class="ck-pop" id="pm-ck-pop" role="dialog" aria-label="기간 선택"></div></span>' +
      // 오늘이 몇 주차인지 늘 보이게. '저번주'·비교 줄의 주차가 어느 주인지 여기서 맞춘다

      '  <span class="pm-spacer"></span>' +
      '  <span id="pm-mode"></span>' +
      '  <button type="button" class="vx-btn sm" id="pm-refresh">새로고침</button>' +
      '</div>' +
      '<div id="pm-body"><div class="vx-loading">에어브릿지 성과를 불러오는 중</div></div>' +
      '<div class="vx-modal-overlay" id="pm-bg-modal"><div class="vx-modal" id="pm-bg-modal-body"></div></div>';

    var seg = $id('pm-period'), menu = $id('pm-nmenu');
    seg.querySelectorAll('[data-p]').forEach(function (b) {
      b.onclick = function (ev) {
        if (b.dataset.p === 'n') {             // 최근 N일은 고를 일수를 먼저 연다
          ev.stopPropagation();
          menu.classList.toggle('open');
          return;
        }
        pmSetPeriod(b.dataset.p);
      };
    });
    menu.querySelectorAll('[data-n]').forEach(function (b) {
      b.onclick = function (ev) {
        ev.stopPropagation();
        menu.classList.remove('open');
        VX.pm.nDays = +b.dataset.n;
        pmSetPeriod('n');
      };
    });
    document.addEventListener('click', function () { menu.classList.remove('open'); });
    $id('pm-refresh').onclick = function () {
      fetchJson('/api/pm-refresh', { method: 'POST' }).then(fetchPm);
    };
    pmSyncControls();
    fetchPm();
  }

  // 비교 구간: 저번주는 직전 주(WoW), 이번 달은 전월 같은 기간, 지난 달은 그 전달(MoM). 다른 기간은 기준이 흐려 비교하지 않는다
  // 비교 구간 둘: 배지는 첫째 기준, 배지 아래 '전주 얼마 · 전월 얼마' 두 줄
  //   저번주 → 전주(한 주 전) · 전월(한 달 전 같은 날짜) / 어제 → 전일 · 전주(같은 요일)
  //   이번 달·지난 달 → 전월(같은 기간) · 전년(같은 기간) / 오늘·최근 N일·직접 지정 → 없음
  function pmShiftMonth(d, n) {   // 달을 옮기되 날짜는 그 달 말일로 자른다
    var last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
    return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
  }
  function pmPrevRange() {
    var p = VX.pm.period, f = VX.pm.from, t = VX.pm.to;
    if (!f || !t) return null;
    var fd = new Date(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10)), td = new Date(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
    var R = function (a, b, label, basis) { return { from: ymd(a), to: ymd(b), label: label, basis: basis }; };
    if (p === 'lw') return { a: R(addDays(fd, -7), addDays(td, -7), '전주', '전주 대비'), b: R(pmShiftMonth(fd, -1), pmShiftMonth(td, -1), '전월', '전월 같은 날짜') };
    if (p === 'yd') return { a: R(addDays(fd, -1), addDays(fd, -1), '전일', '전일 대비'), b: R(addDays(fd, -7), addDays(fd, -7), '전주', '전주 같은 요일') };
    if (p === 'tm' || p === 'lm') {
      var pf = new Date(fd.getFullYear(), fd.getMonth() - 1, 1), plast = new Date(fd.getFullYear(), fd.getMonth(), 0);
      var pt = p === 'lm' ? plast : new Date(pf.getFullYear(), pf.getMonth(), Math.min(td.getDate(), plast.getDate()));
      var yf = new Date(fd.getFullYear() - 1, fd.getMonth(), 1), ylast = new Date(fd.getFullYear() - 1, fd.getMonth() + 1, 0);
      var yt = p === 'lm' ? ylast : new Date(yf.getFullYear(), yf.getMonth(), Math.min(td.getDate(), ylast.getDate()));
      return { a: R(pf, pt, '전월', p === 'tm' ? '전월 같은 기간 대비' : '전월 대비'), b: R(yf, yt, '전년', '전년 같은 기간') };
    }
    return null;
  }

  function pmSetPeriod(p, from, to) {
    VX.pm.period = p;
    if (p === 'custom') { VX.pm.from = from; VX.pm.to = to; }
    else { var r = pmRange(p, VX.pm.nDays); VX.pm.from = r[0]; VX.pm.to = r[1]; }
    VX.pm.pick.cur = null;   // 달력 커서를 새 구간 기준으로 다시 잡는다
    pmSyncControls();
    fetchPm();
  }

  function pmSyncControls() {
    var p = VX.pm.period;
    $id('pm-period').querySelectorAll('[data-p]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.p === p);
    });
    $id('pm-n-lb').textContent = p === 'n' ? '최근 ' + VX.pm.nDays + '일' : '최근 N일';
    // 기간 배지: 고른 기간이 무엇인지 한 단어로. 한 주면 W39, 한 달이면 9월, 하루면 9/29 화, 그 밖은 일수
    var fd0 = new Date(+VX.pm.from.slice(0, 4), +VX.pm.from.slice(5, 7) - 1, +VX.pm.from.slice(8, 10));
    var td0 = new Date(+VX.pm.to.slice(0, 4), +VX.pm.to.slice(5, 7) - 1, +VX.pm.to.slice(8, 10));
    var nd = Math.round((td0 - fd0) / 864e5) + 1, DOW = ['일', '월', '화', '수', '목', '금', '토'];
    var badge, tip = pmMd(VX.pm.from) + (nd > 1 ? '~' + pmMd(VX.pm.to) : '') + ' · ' + nd + '일';
    if (nd === 7 && fd0.getDay() === 1) { badge = pmWeekNo(fd0); tip = pmWeekRange(fd0) + ' · ' + (p === 'lw' ? '저번주' : '한 주'); }
    else if (nd === 1) badge = pmMd(VX.pm.from) + ' ' + DOW[fd0.getDay()];
    else if (fd0.getDate() === 1 && (p === 'tm' || p === 'lm' || td0.getDate() === new Date(td0.getFullYear(), td0.getMonth() + 1, 0).getDate())) badge = (fd0.getMonth() + 1) + '월';
    else badge = nd + '일간';
    var bd = $id('pm-badge'); bd.textContent = badge; bd.title = tip;
    $id('pm-nmenu').querySelectorAll('[data-n]').forEach(function (b) {
      b.classList.toggle('on', p === 'n' && +b.dataset.n === VX.pm.nDays);
    });
    mountRangePicker({
      trig: $id('pm-ck-trigger'), pop: $id('pm-ck-pop'),
      lbFrom: $id('pm-ck-lb-from'), lbTo: $id('pm-ck-lb-to'),
      st: VX.pm.pick,
      from: VX.pm.from.replace(/-/g, ''), to: VX.pm.to.replace(/-/g, ''),
      min: PM_MIN, max: d8(kstToday()),
      quick: [],   // 이번 달·지난 달은 상단 버튼으로 꺼냈다
      onApply: function (f, t) { pmSetPeriod('custom', hy(f), hy(t)); }
    });
  }

  function pmErrorText(err) {
    var e = String(err || '');
    if (/403|401|Forbidden|토큰/i.test(e)) return '에어브릿지 토큰이 만료되었거나 권한이 없습니다. 기획운영팀에 알려 주세요.';
    if (/timed out|timeout/i.test(e)) return '에어브릿지 응답이 늦습니다. 잠시 뒤 새로고침하세요.';
    return '잠시 뒤 새로고침하세요. 계속되면 기획운영팀에 알려 주세요.';
  }

  function fetchPm() {
    // 이미 그려진 화면은 지우지 않고 흐리게만 둔다. 지우면 아래 예산·매체별 카드가 위로 튀어 올랐다가
    // 응답 뒤 다시 내려가 카드가 스쳐 지나가는 것처럼 보인다
    var body0 = $id('pm-body');
    if (body0.querySelector('.pm-kpis')) body0.classList.add('pm-stale');
    else body0.innerHTML = '<div class="vx-loading">에어브릿지 성과를 불러오는 중</div>';
    var want = VX.pm.from + ':' + VX.pm.to;
    var pr = pmPrevRange();
    fetchJson('/api/pm-report?from=' + VX.pm.from + '&to=' + VX.pm.to +
      (pr ? '&prevFrom=' + pr.a.from + '&prevTo=' + pr.a.to + '&prev2From=' + pr.b.from + '&prev2To=' + pr.b.to : '')).then(function (res) {
      if (want !== VX.pm.from + ':' + VX.pm.to) return;   // 그 사이 기간을 바꿨으면 버린다
      $id('pm-body').classList.remove('pm-stale');
      if (!res || !res.ok) {
        $id('pm-body').innerHTML =
          '<div class="vx-error">퍼포먼스 성과를 불러오지 못했습니다. ' + esc(pmErrorText(res && res.error)) + '</div>';
        $id('pm-mode').innerHTML = '';
        return;
      }
      VX.pm.data = res;
      var meta = res.meta || {};
      // 최근 갱신 시각만 적는다(예: 9/29 14:45). 적재본이든 실시간이든 보는 사람에게는 같은 질문이다
      var at = meta.updatedAt || meta.lastSync || meta.generatedAt || '';
      var mt = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(at);
      // 초록 점은 데이터가 제때 들어올 때만 켠다. 매일 07:50 적재라 26시간을 넘기면 멈춘 것으로 보고
      // 주황 '갱신 지연'으로 바꾼다(2026-08 적재가 한 달 멈춘 채 화면이 멀쩡해 보였던 일 재발 방지)
      if (mt) {
        var hm = mt[4].split(':');
        var at0 = Date.UTC(+mt[1], +mt[2] - 1, +mt[3], +hm[0] - 9, +hm[1]);
        var stale = (Date.now() - at0) > 26 * 3600 * 1000;
        var when = (+mt[2]) + '/' + (+mt[3]) + ' ' + mt[4];
        $id('pm-mode').innerHTML = '<span class="pm-mode' + (stale ? ' stale tip-r" tabindex="0" data-tip="마지막 갱신 후 하루 넘게 새 데이터가 없습니다\n일별 적재가 멈췄는지 확인이 필요합니다' : '') + '">' +
          '<i class="dot" aria-hidden="true"></i>' + (stale ? '갱신 지연 · ' : '최근 갱신 ') + when + '</span>';
      } else {
        $id('pm-mode').innerHTML = '';
      }
      renderPm();
    }).catch(function (e) {
      // 요청 자체가 실패해도(네트워크 끊김 등) 흐림과 클릭 차단은 반드시 푼다
      if (want !== VX.pm.from + ':' + VX.pm.to) return;
      $id('pm-body').classList.remove('pm-stale');
      $id('pm-body').innerHTML = '<div class="vx-error">퍼포먼스 성과를 불러오지 못했습니다. ' + esc(pmErrorText(String(e && e.message || e))) + '</div>';
      $id('pm-mode').innerHTML = '';
    });
  }

  // 광고비 회수 기준: 구매액의 순매출 몫(기본 15%)이 광고비와 같아지는 지점. 순매출 ROAS 100% = 구매액 ROAS 667%.
  // 구매액 ROAS 100% 는 광고비의 15% 만 회수한 상태라 기준선으로 쓰지 않는다
  // 순매출 환산율은 서버가 회계 매출 테이블에서 조회 기간 기준으로 잰 값(실측). 못 쟀으면 기본값이라 도움말에 적는다
  function pmTake() { return (VX.pm.data && VX.pm.data.meta && VX.pm.data.meta.netTakeRate) || 0.176; }
  function pmTakeText(rate, measured) {
    return (rate * 100).toFixed(1) + '%' + (measured ? ' (이 기간 회계 매출 실측)' : ' (기본값, 실측 조회 실패)');
  }
  function pmBreakEven() { return 100 / pmTake(); }
  var PM_ROAS_TIP = function () {
    var m = (VX.pm.data && VX.pm.data.meta) || {};
    return 'ROAS (순매출 기준)\n계산: 순매출 ÷ 광고비\n순매출: 구매액 × ' + pmTakeText(pmTake(), m.netTakeMeasured) +
      '\n강조: 100% 이상이면 광고비를 회수한 것이라 코발트\n구매액 기준: ' + Math.round(pmBreakEven()) + '%가 순매출 100%와 같은 지점';
  };
  // 표의 ROAS 는 순매출 기준. 100% 가 광고비 회수 지점이라 그 위만 코발트(판정색을 여럿 쓰지 않는다)
  function pmRoasHtml(r) {
    var v = r && r.cost ? (r.roasNet != null ? r.roasNet : (r.roas != null ? r.roas * pmTake() : null)) : null;
    if (v == null) return '<span class="pm-roas na">-</span>';
    return '<span class="pm-roas' + (v >= 100 ? ' hi' : '') + '">' + fmtP(v, 0) + '</span>';
  }
  function pmRoasGross(r) { return r && r.cost && r.roas != null ? fmtP(r.roas, 0) : '-'; }

  // ISO 주차 표기(W40)와 그 주의 월~일 날짜
  function pmWeekNo(d) { return isoWeekKey(d).split('-')[1]; }   // 'W40'
  function pmMd(iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); }
  function pmWeekRange(d) {
    var mon = addDays(d, -((d.getDay() + 6) % 7));
    return pmMd(ymd(mon)) + '~' + pmMd(ymd(addDays(mon, 6)));
  }

  // KPI 카드의 직전 기간 비교 한 줄: 'W38 15,378 · +5%'. '전주'라고만 적으면 저번주 화면에서 어느 주인지
  // 헷갈리므로 주차나 날짜로 부른다. 오늘은 집계 중이라 비교하지 않는다
  function pmCmpLabel(d) {
    var f = d && d.prevFrom, t = d && d.prevTo;
    if (!f || !t) return '직전 기간';
    var fd = new Date(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10));
    var n = Math.round((Date.parse(t) - Date.parse(f)) / 864e5) + 1;
    if (n === 7 && fd.getDay() === 1) return pmWeekNo(fd);   // 월~일 한 주면 주차로
    if (n === 1) return pmMd(f);
    return pmMd(f) + '~' + pmMd(t);
  }
  // C안: 증감 배지는 제목 줄 오른쪽 끝, 직전 값은 숫자 아래 회색 한 줄. {badge, prev} 로 돌려주고 카드가 자리에 놓는다
  function pmFmt(v, kind) { return kind === 'pp' ? fmtP(v, 0) : (kind === 'won' || kind === 'cost') ? pmWonShort(v) : fmtN(v); }
  function pmCmp(d, cur, prev, kind, prev2) {
    var pr0 = pmPrevRange(), pr = pr0 && pr0.a;
    if (!pr || cur == null || prev == null || isNaN(cur) || isNaN(prev)) return null;
    var pv = kind === 'pp' ? fmtP(prev, 0) : (kind === 'won' || kind === 'cost') ? pmWonShort(prev) : fmtN(prev);
    var diff = kind === 'pp' ? cur - prev : (prev ? (cur - prev) / prev * 100 : null);
    if (diff == null) return null;
    var unit = kind === 'pp' ? '%p' : '%', n = Math.round(Math.abs(diff));
    // 광고비는 늘어도 줄어도 좋고 나쁨이 아니라 중립색에 부호만. 나머지는 오름 초록 ▲, 내림 빨강 ▼
    var cls = n === 0 ? 'flat' : kind === 'cost' ? 'neu' : diff > 0 ? 'up' : 'down';
    var txt = cls === 'up' ? '▲ ' + n + unit : cls === 'down' ? '▼ ' + n + unit : (diff > 0 ? '+' : diff < 0 ? '-' : '') + n + unit;
    // '전주 15,378 대비  ▲ 5%'. 알약 툴팁에 실제 비교 구간(W38 · 9/14~9/20)
    var rng = pmCmpLabel(d) === pmMd(pr.from) + '~' + pmMd(pr.to) ? pmCmpLabel(d) : pmCmpLabel(d) + ' · ' + pmMd(pr.from) + (pr.from === pr.to ? '' : '~' + pmMd(pr.to));
    // 직전 값 줄은 '전주' 같은 상대어 대신 실제 기간으로: W38 · 9/28 · 8/1~29 · 8월. 상대어(전주 대비)는 배지 툴팁에
    var pf = new Date(+pr.from.slice(0, 4), +pr.from.slice(5, 7) - 1, +pr.from.slice(8, 10));
    var when = VX.pm.period === 'lw' ? pmWeekNo(pf) : VX.pm.period === 'yd' ? pmMd(pr.from) :
               VX.pm.period === 'lm' ? (pf.getMonth() + 1) + '월' : pmMd(pr.from) + '~' + (+pr.to.slice(8, 10));
    // 배지 아래 한 줄: 첫째 기준의 직전 값('전주 15,378'). 둘째 기준(전월 등)은 배지 툴팁에
    var tip = pr.basis + ' · ' + rng + '\n' + pr.label + ': ' + pv +
      (pr0.b && prev2 != null && !isNaN(prev2) ? '\n' + pr0.b.label + ': ' + pmFmt(prev2, kind) : '');
    return { badge: '<span class="cmpg"><b class="dl ' + cls + '" tabindex="0" data-tip="' + esc(tip) + '">' + txt + '</b>' +
               '<span class="pv">' + esc(pr.label + ' ' + pv) + '</span></span>' };
  }

  function renderPm() {
    var d = VX.pm.data;
    var s = d.summary || {}, p = d.summaryPrev || {}, p2 = d.summaryPrev2 || {};
    var take = pmTake();
    var oneDay = d.from === d.to;
    var body = $id('pm-body');
    body.innerHTML =
      '<div class="pm-kpis" id="pm-kpis"></div>' +
      '<div class="vx-card" id="pm-budget"></div>' +
      (oneDay ? '' :
      '<div class="vx-card"><div class="vx-card-head"><div class="vx-title">일별 추이</div></div>' +
      '  <div class="pm-trend" id="pm-daily"></div></div>') +
      '<div class="vx-card"><div class="vx-card-head"><div class="vx-title">매체별 성과</div></div>' +
      '  <div id="pm-channels"></div></div>' +
      '<div class="vx-card"><div class="vx-card-head"><div class="vx-title">캠페인별 성과</div>' +
      '  <div class="vx-actions">' +
      '    <input class="vx-input pm-cr-q" id="pm-cr-q" type="search" placeholder="캠페인·광고그룹 검색 (예: 세차)" aria-label="캠페인 검색">' +
      '    <select class="vx-select" id="pm-cr-ch"><option value="">전체 매체</option></select>' +
      '    <div class="bn-seg" id="pm-cr-name"><button type="button" class="on" data-raw="0">한글 이름</button>' +
      '      <button type="button" data-raw="1">원래 이름</button></div>' +
      '  </div></div>' +
      '  <div id="pm-creatives"><div class="vx-loading">캠페인 성과를 불러오는 중</div></div></div>' +
      '<div class="vx-card"><div class="vx-card-head"><div class="vx-title">무료 유입 채널</div>' +
      '  <div class="vx-actions"><button type="button" class="vx-btn sm" id="pm-org-toggle">펼치기</button></div></div>' +
      '  <div id="pm-organic" style="display:none"></div></div>';

    // KPI: ROAS 히어로, 광고비 보조 히어로, 나머지 넷은 작은 카드. 값 아래 회색 한 줄이 직전 기간 비교
    var aov = s.purchase ? s.revenue / s.purchase : null;
    function ab(code, def) { return '<span class="ab" tabindex="0" data-tip="' + esc(def) + '">' + code + '</span>'; }
    var AB = {
      cpc: ab('클릭당', '클릭당 · CPC(Cost Per Click)\n뜻: 클릭당 광고비\n계산: 광고비 ÷ 클릭'),
      cpi: ab('설치당', '설치당 · CPI(Cost Per Install)\n뜻: 설치당 광고비\n계산: 광고비 ÷ 설치'),
      cpaS: ab('가입당', '가입당 · CPA(Cost Per Action)\n뜻: 가입 1건당 광고비\n계산: 광고비 ÷ 가입'),
      cpaP: ab('결제당', '결제당 · CPA(Cost Per Action)\n뜻: 결제 1건당 광고비\n계산: 광고비 ÷ 결제'),
      aov: ab('결제당 구매액', '결제당 구매액 · AOV(Average Order Value)\n뜻: 결제 1건 평균 구매액\n계산: 구매액 ÷ 결제')
    };
    // 옅은 판: '라벨 … 값' 행. 단가 행, 그 아래 신규 가입자(막대 + 비율) 행
    function det(rows) {
      rows = rows.filter(Boolean);
      return rows.length ? '<div class="det">' + rows.map(function (r) {
        return '<div class="r"><span class="l">' + r.cap + '</span><span class="vv">' + r.val + '</span></div>';
      }).join('') + '</div>' : '';
    }
    function card(cls, label, parts, cmp, unit, extra, foot) {
      return '<div class="pm-kpi ' + cls + '"><div class="k">' + label + (cmp ? cmp.badge : '') + '</div>' +
        '<div class="v">' + esc(parts[0]) + '<span class="u">' + esc(parts[1]) + '</span></div>' +
        det([unit, extra]) + (foot || '') + '</div>';
    }
    // 신규 가입자 몫: 이 기간에 가입한 사람이 이 기간 안에 한 결제
    var NEW_TIP = '이 기간에 가입한 사람이 이 기간 안에 한 결제만 셉니다';
    function newCell(v, total, won) {
      if (v == null) return null;
      var pct = total ? Math.round(v / total * 100) : 0;
      // 같은 개념의 설명은 한 번만: 결제 카드에만 툴팁, 구매액 카드는 라벨만
      var cap = won ? '신규 가입자' : '<span class="tip-w" tabindex="0" data-tip="' + esc('신규 가입자\n결제: ' + fmtN(v) + '건 (' + (total ? pct + '%' : '-') + ')\n기준: ' + NEW_TIP) + '">신규 가입자</span>';
      return { cap: cap,
               val: '<span class="nw"><span class="bar"><i style="width:' + pct + '%"></i></span><b>' + (total ? pct + '%' : '-') + '</b></span>' };
    }
    // 히어로 두 장의 아래 칸: 매체별 ROAS, 매체별 광고비 비중
    var spent = (d.channels || []).filter(function (c) { return c.cost > 0; })
      .sort(function (a, b) { return b.cost - a.cost; });
    var maxRoas = Math.max.apply(null, spent.map(function (c) { return c.roasNet || 0; }).concat([1]));
    var roasFoot = spent.length ? '<div class="pm-hx"><div class="hx-t">매체별 ROAS</div>' +
      spent.map(function (c) {
        var w = Math.max(2, Math.round((c.roasNet || 0) / maxRoas * 100));
        return '<div class="hx-r"><span class="hx-n">' + esc(c.label || c.channel) + '</span>' +
          '<span class="hx-track"><i style="width:' + w + '%"></i></span>' +
          '<b>' + (c.roasNet == null ? '-' : fmtP(c.roasNet, 0)) + '</b></div>';
      }).join('') + '</div>' : '';
    var SHADE = ['#2563eb', '#60a5fa', '#bfdbfe', '#d4d4d8'];
    var spendFoot = spent.length ? '<div class="pm-hx"><div class="hx-t">매체별 비중</div>' +
      '<div class="hx-stack">' + spent.map(function (c, i) {
        return '<i style="width:' + (c.cost / s.cost * 100).toFixed(2) + '%;background:' + SHADE[Math.min(i, 3)] + '"></i>';
      }).join('') + '</div>' +
      spent.map(function (c, i) {
        return '<div class="hx-r"><span class="hx-n"><span class="hx-dot" style="background:' + SHADE[Math.min(i, 3)] + '"></span>' +
          esc(c.label || c.channel) + '</span><span class="hx-amt">' + esc(pmWonShort(c.cost)) + '</span>' +
          '<b>' + Math.round(c.cost / s.cost * 100) + '%</b></div>';
      }).join('') + '</div>' : '';
    // ROAS 는 순매출 기준이 본 지표라 앞에 크게, 구매액 기준은 뒤에 참고로. 광고비 회수 기준선(100%)은
    // 순매출 막대에만 둔다. 구매액 기준 100% 는 광고비의 15% 만 회수한 상태라 선을 그으면 흑자로 읽힌다
    var be = Math.round(pmBreakEven());
    var heroCmp = pmCmp(d, s.roasNet, p.roasNet, 'pp', p2.roasNet);
    // 히어로 가운데: 일별 ROAS 추이(광고비 있는 날만). 튀는 날이 보이게 누적이 아니라 그날 값. 점선이 100% 선
    function heroSpark() {
      // 오늘 것은 뺀다. 매체 광고비는 다음 날 아침에 들어와 오늘 칸은 매출만 있어 ROAS가 몇 배로 튄다
      var todayKey = ymd(kstToday());
      var days = (d.daily || []).filter(function (r) { return r.cost > 0 && r.date < todayKey; });
      var pts = days.map(function (r) { return r.revenue * take / r.cost * 100; });
      if (pts.length < 2) return '';
      var hi = 0, lo = 0;
      pts.forEach(function (v, i) { if (v > pts[hi]) hi = i; if (v < pts[lo]) lo = i; });
      // 차트에는 최고·최저 자리에 색점만 찍고, 값·날짜는 오른쪽 범례가 같은 색점으로 알려준다. 끝점 표시는 두지 않는다
      function mark(i, cls) {
        return '<i class="mk ' + cls + '" style="left:' + (i / (pts.length - 1) * 100).toFixed(1) + '%;top:' + (y(pts[i]) / H * 100).toFixed(1) + '%"></i>';
      }
      function when(i) { var dt = new Date(days[i].date + 'T00:00:00'); return (dt.getMonth() + 1) + '/' + dt.getDate() + ' ' + '일월화수목금토'[dt.getDay()]; }
      var W = 200, H = 48, top = 4, bot = 44;
      var mx = Math.max.apply(null, pts.concat([100])) * 1.08;
      var x = function (i) { return (i / (pts.length - 1) * W).toFixed(1); };
      var y = function (v) { return (bot - v / mx * (bot - top)).toFixed(1); };
      // 꺾은선 대신 부드러운 곡선(Catmull-Rom 을 3차 베지어로)
      var P = pts.map(function (v, i) { return [+x(i), +y(v)]; });
      var line = 'M' + P[0][0] + ' ' + P[0][1];
      for (var i = 0; i < P.length - 1; i++) {
        var p0 = P[Math.max(i - 1, 0)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(i + 2, P.length - 1)];
        var c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        line += ' C' + c1[0].toFixed(1) + ' ' + c1[1].toFixed(1) + ' ' + c2[0].toFixed(1) + ' ' + c2[1].toFixed(1) + ' ' + p2[0] + ' ' + p2[1];
      }
      var last = pts.length - 1;
      return '<div class="hero-spark">' +
        '<div class="hs-c"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<defs><linearGradient id="pm-hsg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#93c5fd" stop-opacity=".28"/><stop offset="1" stop-color="#93c5fd" stop-opacity="0"/></linearGradient></defs>' +
        '<path d="' + line + ' L' + W + ' ' + bot + ' L0 ' + bot + ' Z" fill="url(#pm-hsg)"/>' +
        '<line x1="0" x2="' + W + '" y1="' + y(100) + '" y2="' + y(100) + '" stroke="rgba(255,255,255,.45)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>' +
        '<path d="' + line + '" fill="none" stroke="#93c5fd" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>' +
        mark(hi, 'hi') + (lo !== hi ? mark(lo, 'lo') : '') +
        '<em class="hs-100" style="top:' + (y(100) / H * 100).toFixed(1) + '%">100%</em></div>' +
        '<div class="hs-cap">일별 ROAS</div>' +
        '</div>' +
        '<div class="hero-mm"><div class="r"><i class="mk hi"></i><b>' + Math.round(pts[hi]) + '%</b><em>' + when(hi) + '</em></div>' +
        (lo !== hi ? '<div class="r"><i class="mk lo"></i><b>' + Math.round(pts[lo]) + '%</b><em>' + when(lo) + '</em></div>' : '') + '</div>';
    }
    var heroHtml = '<div class="pm-kpi hero"><div class="k">ROAS' +
      pmHelp('계산: 순매출 ÷ 광고비\n순매출: 구매액 × ' + pmTakeText(take, (d.meta || {}).netTakeMeasured) +
        '\n기준: 결제일에 잡힌 매출 ÷ 같은 날 광고비\n100% 선: 광고비를 다 회수한 지점\n구매액 기준 ROAS: ' + (s.roas == null ? '-' : Math.round(s.roas) + '%') +
        '\n환산: 구매액 ROAS ' + be + '% = 순매출 ROAS 100%', false, 'ROAS (순매출 기준)') +
      (heroCmp ? heroCmp.badge.replace(/<span class="pv">[^<]*<\/span>/, '') : '') + '</div>' +
      '<div class="hero-row"><div class="v">' + (s.roasNet == null ? '-' : Math.round(s.roasNet).toLocaleString()) + '<span class="u">%</span></div>' +
      '<div class="hero-bot">' + heroSpark() + '</div></div>' +
      (VX.pm.period === 'td' ? '<div class="sub2">오늘 광고비는 늦게 반영돼 ROAS가 높게 나옵니다</div>' : '') +
      roasFoot + '</div>';
    $id('pm-kpis').innerHTML = heroHtml +
      // 단가는 CPC 하나만(집행 매체가 모두 클릭 과금). 과금 방식이 다른 매체가 들어오면 그때 나눈다
      card('spend', '광고비', pmWonParts(s.cost), pmCmp(d, s.cost, p.cost, 'cost', p2.cost), s.cpc != null ? { cap: AB.cpc, val: pmWon(s.cpc) } : null, null, spendFoot) +
      card('', '설치', [fmtN(s.install), '건'], pmCmp(d, s.install, p.install, '', p2.install), s.cpi != null ? { cap: AB.cpi, val: pmWon(s.cpi) } : null) +
      card('', '가입', [fmtN(s.signup), '건'], pmCmp(d, s.signup, p.signup, '', p2.signup), s.cpaSignup != null ? { cap: AB.cpaS, val: pmWon(s.cpaSignup) } : null) +
      card('', '결제', [fmtN(s.purchase), '건'], pmCmp(d, s.purchase, p.purchase, '', p2.purchase),
        s.cpaPurchase != null ? { cap: AB.cpaP, val: pmWon(s.cpaPurchase) } : null, newCell(s.newPurchase, s.purchase)) +
      card('', '구매액', pmWonParts(s.revenue), pmCmp(d, s.revenue, p.revenue, 'won', p2.revenue),
        aov != null ? { cap: AB.aov, val: pmWon(aov) } : null, newCell(s.newRevenue, s.revenue, true));

    if (!oneDay) renderPmTrend(d, s);
    renderPmChannels();

    // 캠페인별 성과: 검색, 매체 필터, 이름 표기 전환
    var qi = $id('pm-cr-q'), qt = null;
    qi.value = VX.pm.crQ || '';
    qi.oninput = function () {
      clearTimeout(qt);
      qt = setTimeout(function () { VX.pm.crQ = qi.value; VX.pm.crPage = 1; renderCreatives(); }, 150);
    };
    var sel = $id('pm-cr-ch');
    (d.channels || []).forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.channel; o.textContent = c.label || c.channel;
      sel.appendChild(o);
    });
    sel.onchange = function () {
      VX.pm.crPage = 1;
      document.querySelectorAll('#pm-channels tr.pm-ch').forEach(function (x) { x.classList.toggle('sel', sel.value === x.dataset.ch); });
      loadCreatives();
    };
    VX.pm.crRaw = false;
    VX.pm.crPage = 1;
    $id('pm-cr-name').querySelectorAll('button').forEach(function (b) {
      b.onclick = function () {
        VX.pm.crRaw = b.dataset.raw === '1';
        $id('pm-cr-name').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        renderCreatives();
      };
    });
    loadCreatives();
    loadPmBudget();

    // 무료 유입 채널
    $id('pm-org-toggle').onclick = function () {
      var el = $id('pm-organic');
      var open = el.style.display !== 'none';
      el.style.display = open ? 'none' : '';
      this.textContent = open ? '펼치기' : '접기';
      if (!open && !el.innerHTML) {
        // 미귀속은 채널이 아니다. 광고·추적 링크 경로가 없는 이벤트(대부분 기존 회원의 직접 실행)라
        // 앱 전체 거래 규모에 가깝다. 순위 표에서 빼고 표 위에 한 줄로 따로 둔다.
        var org = d.organic || [];
        var un = org.filter(function (c) { return c.channel === 'unattributed'; })[0];
        var rows = org.filter(function (c) { return c.channel !== 'unattributed'; }).slice(0, 12).map(function (c) {
          return { 채널: c.label || c.channel, 설치: c.install, 가입: c.signup, 결제: c.purchase, 구매액: Math.round(c.revenue) };
        });
        var head = un ? '<div class="pm-direct"><span class="t">광고 경로 없음' +
          pmHelp('에어브릿지가 광고·추적 링크 경로를 찾지 못한 설치·가입·결제입니다\n대부분 기존 회원이 앱을 직접 열어 결제한 건이라 채널 비교에서 뺐습니다') +
          '</span><span class="s">직접 실행·자연 설치</span><span class="m">' +
          [['설치', fmtN(un.install) + '건'], ['가입', fmtN(un.signup) + '건'], ['결제', fmtN(un.purchase) + '건'],
           ['구매액', pmWonShort(un.revenue)]].map(function (x) {
            return '<span><i>' + x[0] + '</i><b>' + esc(x[1]) + '</b></span>';
          }).join('') + '</span></div>' : '';
        if (!rows.length) {
          el.innerHTML = head + '<div class="vx-empty">이 기간에 광고 외 유입 채널이 없습니다.</div>';
          return;
        }
        el.innerHTML = head + '<div id="pm-organic-t"></div>';
        TL.heatTable($id('pm-organic-t'), {
          columns: [
            { key: '채널', label: '채널', type: 'text' },
            { key: '설치', label: '설치', type: 'num' }, { key: '가입', label: '가입', type: 'num' },
            { key: '결제', label: '결제', type: 'num' }, { key: '구매액', label: '구매액(원)', type: 'num' }],
          rows: rows
        });
      }
    };
  }

  // 일별 추이: 지표 넷을 같은 모양의 작은 차트로 나란히. 색은 코발트 하나, 축은 지표마다 따로
  function renderPmTrend(d, s) {
    var host = $id('pm-daily');
    var M = [
      { k: 'cost', l: '광고비', total: pmWonShort(s.cost), won: true },
      { k: 'install', l: '설치', total: fmtN(s.install) + '건' },
      { k: 'signup', l: '가입', total: fmtN(s.signup) + '건' },
      { k: 'purchase', l: '결제', total: fmtN(s.purchase) + '건' }
    ];
    host.innerHTML = M.map(function (m, i) {
      return '<div class="pm-tr"><div class="pm-tr-h"><span>' + m.l + '</span><b>' + esc(m.total) + '</b></div>' +
        '<div class="pm-tr-c" id="pm-tr-' + i + '"></div></div>';
    }).join('');
    ensureVega().then(function () {
      M.forEach(function (m, i) {
        var vals = (d.daily || []).map(function (r) {
          var p = r.date.split('-');
          return { 날짜: (+p[1]) + '/' + (+p[2]), 정렬: r.date, 값: Math.round(r[m.k] || 0) };
        });
        var n = vals.length, marks = n ? [vals[0].날짜, vals[Math.floor((n - 1) / 2)].날짜, vals[n - 1].날짜] : [];
        var x = { field: '날짜', type: 'ordinal', sort: vals.map(function (v) { return v.날짜; }), title: null,
                  scale: { paddingInner: 0, paddingOuter: 0 },
                  axis: { values: marks, labelAngle: 0, ticks: false, domain: true, domainColor: '#e4e4e7',
                          labelColor: '#71717a', labelFontSize: 11, labelPadding: 8, labelFlush: true } };
        var y = { field: '값', type: 'quantitative', title: null,
                  axis: { labels: false, tickCount: 3, domain: false, ticks: false, gridColor: '#f4f4f5' } };
        TL.chart($id('pm-tr-' + i), {
          data: { values: vals },
          encoding: { x: x },
          layer: [
            { mark: { type: 'area', interpolate: 'monotone', line: { color: '#2563eb', strokeWidth: 2 },
                      color: { x1: 1, y1: 1, x2: 1, y2: 0, gradient: 'linear',
                               stops: [{ offset: 0, color: 'rgba(37,99,235,0)' }, { offset: 1, color: 'rgba(37,99,235,0.16)' }] } },
              encoding: { y: y } },
            { params: [{ name: 'hv', select: { type: 'point', on: 'pointerover', clear: 'pointerout', fields: ['날짜'] } }],
              mark: { type: 'bar', color: '#18181b', opacity: 0.001 },
              encoding: { tooltip: [{ field: '날짜', title: '날짜' },
                                    { field: '값', type: 'quantitative', format: ',', title: m.l + (m.won ? '(원)' : '') }] } },
            { mark: { type: 'rule', color: '#d4d4d8', strokeDash: [3, 3] },
              encoding: { opacity: { condition: { param: 'hv', empty: false, value: 1 }, value: 0 } } },
            { mark: { type: 'point', filled: true, size: 46, color: '#2563eb', stroke: '#fff', strokeWidth: 1.5 },
              encoding: { y: y, opacity: { condition: { param: 'hv', empty: false, value: 1 }, value: 0 } } }
          ]
        }, { height: 160 });
      });
    }).catch(function () {
      host.innerHTML = '<div class="vx-empty">차트를 불러오지 못했습니다.</div>';
    });
  }

  // ── 월 예산 소진: 조회 기간 끝 날짜가 속한 달의 예산·광고비·마감 예상 ─────────────
  // 광고비는 에어브릿지 광고비(자동)이고, 청구서 기준 마감 확정액은 관리자가 따로 입력한다.
  function pmSum(o) { var t = 0; Object.keys(o || {}).forEach(function (k) { t += +o[k] || 0; }); return t; }

  function loadPmBudget() {
    var host = $id('pm-budget');
    if (!host) return;
    var month = VX.pm.to.slice(0, 7);
    // 다시 불러오는 동안에도 카드를 비우지 않는다: 직전 데이터로 먼저 그리고 흐리게 둔 뒤 응답이 오면 바꾼다
    if (VX.pm.month && VX.pm.month.ok) { renderPmBudget(); host.classList.add('pm-stale'); }
    else host.innerHTML = '<div class="vx-loading">예산 소진을 불러오는 중</div>';
    fetchJson('/api/pm-month?month=' + month).then(function (res) {
      if (VX.pm.to.slice(0, 7) !== month || !$id('pm-budget')) return;
      host = $id('pm-budget');
      host.classList.remove('pm-stale');
      if (!res || !res.ok) {
        host.innerHTML = '<div class="vx-error">예산 소진을 불러오지 못했습니다. ' + esc(pmErrorText(res && res.error)) + '</div>';
        return;
      }
      VX.pm.month = res;
      renderPmBudget();
    });
  }

  // 월 안 주차: 월요일 시작, 달 경계에서 자른다(9월이면 9/1~6, 7~13, 14~20, 21~27, 28~30)
  function pmWeeksOf(month, days) {
    var y = +month.slice(0, 4), m = +month.slice(5, 7) - 1, out = [], start = 1;
    for (var d = 1; d <= days; d++) {
      var dow = new Date(y, m, d).getDay();
      if (dow === 0 || d === days) { out.push([start, d]); start = d + 1; }
    }
    return out;
  }

  // 매체 이름표. 에어브릿지는 광고 계정 이름을 주지 않으므로 이름이 같은 채널이 둘이면(네이버 검색광고(구))
  // 이달 상태(광고비 미연동·데이터 없음)로 가른다. 채널 키를 사람에게 보이지 않는다
  function pmLabelMap(M) {
    var label = {};
    (M.paidChannels || []).forEach(function (c) { label[c.channel] = c.label; });
    (M.channels || []).forEach(function (c) { label[c.channel] = c.label || c.channel; });
    return label;
  }
  function pmChNote(M, ch) {
    var c = (M.channels || []).filter(function (x) { return x.channel === ch; })[0];
    if (!c) return '이달 데이터 없음';
    if (pmAbCost(c) <= 0 && c.manualCost) return '광고비 직접 입력';
    if (!c.cost) return (c.install || c.purchase) ? '광고비 미연동 · 전환만 집계' : '이달 광고비 없음';
    return '';
  }
  // 광고비 입력 방식 아이콘: 연동은 연결 고리, 수기 입력은 연필. 이모지는 OS마다 모양이 달라 선 아이콘으로 그린다
  var PM_IC_LINK = '<svg class="pm-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>';
  var PM_IC_HIST = '<svg class="pm-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
  var PM_IC_PLUS = '<svg class="pm-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  var PM_IC_X = '<svg class="pm-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var PM_IC_GEAR = '<svg class="pm-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.5l2.1 1.2M17.7 15.3l2.1 1.2M4.2 16.5l2.1-1.2M17.7 8.7l2.1-1.2"/></svg>';
  var PM_IC_BACK = '<svg class="pm-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';
  var PM_IC_PEN = '<svg class="pm-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
  // 에어브릿지에서 들어온 광고비(직접 입력분을 뺀 값). 0 이면 예산 창에서 광고비를 직접 넣는 매체
  function pmAbCost(c) { return c ? (c.cost || 0) - (c.manualCost || 0) : 0; }
  // 매체 이름 옆 상태는 같은 줄에(줄이 하나만 높아지지 않게). 직접 입력은 다른 표와 같은 '수기 입력' 알약
  function pmChName(M, label, ch) {
    var note = pmChNote(M, ch);
    var tag = !note ? '' : note === '광고비 직접 입력' ? '<span class="pm-st m">' + PM_IC_PEN + '수기 입력</span>' : '<small>' + esc(note) + '</small>';
    return '<span class="pm-chn">' + esc(label[ch] || ch) + tag + '</span>';
  }

  function renderPmBudget() {
    var M = VX.pm.month, host = $id('pm-budget');
    var mm = +M.month.slice(5, 7);
    var label = pmLabelMap(M);
    var spent = (M.daily || []).reduce(function (a, d) { return a + d.cost; }, 0);
    var budget = pmSum(M.budget), closing = pmSum(M.closing);
    var elapsed = M.elapsed || 0, days = M.days, left = days - elapsed;
    var last7 = (M.daily || []).slice(-7);
    var avg7 = last7.length ? last7.reduce(function (a, d) { return a + d.cost; }, 0) / last7.length : 0;
    var forecast = spent + avg7 * left;
    var timePct = days ? elapsed / days * 100 : 0;
    var spendPct = budget ? spent / budget * 100 : null;
    var allow = budget && left > 0 ? Math.max(0, budget - spent) / left : null;
    var prev = M.prevMonthCost;
    // 마감 확정액은 입력한 매체의 광고비와만 비교한다(일부만 입력했을 때 차이가 부풀지 않게)
    var closingSpent = 0;
    (M.channels || []).forEach(function (c) { if ((M.closing || {})[c.channel] != null) closingSpent += c.cost; });

    // 머리 버튼: 각진 버튼, 보조는 연회색 바탕·주 버튼은 코발트 바탕(둥근 증감 태그와 구분). 입력 이력은 입력 창 머리로.
    // 입력 권한이 없으면 입력 창 대신 이력만 글자 버튼으로 연다
    var editBtn = (M.canEdit ? '<button type="button" class="pm-hd-btn pri" id="pm-bg-edit">' + PM_IC_PEN + '입력</button>'
                 : '<button type="button" class="pm-hd-btn" id="pm-bg-hist">' + PM_IC_HIST + '입력 이력</button>');
    var who = M.budgetUpdatedAt ? '<span class="pm-bg-who">최근 입력 ' + esc(M.budgetUpdatedAt.slice(5).replace('-', '/')) +
      (M.budgetUpdatedBy ? ' · ' + esc(String(M.budgetUpdatedBy).split('@')[0]) : '') + '</span>' : '';
    var head = '<div class="vx-card-head"><div class="vx-title">' + mm + '월 예산 소진' +
      pmHelp('광고비: 에어브릿지 연동 광고비 + 수기 입력 광고비\n월 마감 예상액: 광고비 + 최근 7일 일평균 × 남은 일수\n일 가용 예산: (예산 − 광고비) ÷ 남은 일수. 끝난 달은 예산 대비 차액\n마감 확정액: 청구서 기준 금액(VAT·대행 수수료 포함)을 직접 입력') +
      '</div><div class="vx-actions">' + who + editBtn + '</div></div>' +
      (M.todayOnly ? '<div class="pm-bg-today">오늘 광고비 반영 중입니다. 매체 광고비는 다음 날 아침 확정되고, 마감 예상은 하루치가 쌓인 뒤 정확해집니다.</div>' : '');

    if (!elapsed) {
      host.innerHTML = head + '<div class="vx-empty">' + mm + '월은 아직 광고비 데이터가 없습니다.</div>';
      bindBudgetEdit();
      return;
    }

    // 1) 요약 네 칸. 위는 핵심(라벨·값), 구분선 아래는 부연을 '라벨: 값' 불릿으로 한 줄씩.
    //    값이 없으면 '-' 대신 이유(미입력·마감)를 적는다
    var md = function (iso) { return (+iso.slice(5, 7)) + '/' + (+iso.slice(8, 10)); };
    var prevM = mm === 1 ? 12 : mm - 1;
    function kv(k, v, cls) {
      return '<li><span>' + k + ':</span> <b' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</b></li>';
    }
    function stat(label, value, rows, bar, na) {
      var items = rows.filter(Boolean);
      return '<div class="st"><div class="core"><span class="k">' + label + '</span>' +
        '<span class="v' + (na ? ' na' : '') + '">' + value + '</span>' + (bar || '') + '</div>' +
        (items.length ? '<ul class="det">' + items.join('') + '</ul>' : '') + '</div>';
    }
    var ps = M.prevSame;
    var chg = ps && ps.cost ? (spent - ps.cost) / ps.cost * 100 : null;
    var stats = '<div class="pm-bg-stats">' +
      stat('광고비', esc(pmWonShort(spent)), [
        kv('예산', budget ? esc(pmWonShort(budget)) + ' 중 ' + Math.round(spendPct) + '%' : '미입력', budget ? '' : 'mu'),
        kv('경과일', elapsed + '일 / ' + days + '일'),
        chg == null ? '' : kv('전월 ' + md(ps.from) + '~' + md(ps.to), esc(pmWonShort(ps.cost)) + ' 대비 ' + (chg >= 0 ? '+' : '') + Math.round(chg) + '%')
      ]) +
      stat(left ? '월 마감 예상액' : '월 광고비 합계', esc(pmWonShort(forecast)), [
        left ? kv('최근 7일 일평균', esc(pmWonShort(avg7))) : '',
        left ? kv('남은 일수', left + '일') : '',
        budget ? kv('예산 대비', Math.round(forecast / budget * 100) + '%') : '',
        prev ? kv(prevM + '월 광고비 대비', (forecast / prev).toFixed(1) + '배') : ''
      ]) +
      // 끝난 달은 '일 가용 예산' 대신 예산과 광고비의 차액(남으면 +, 넘으면 -)
      (left ? stat('일 가용 예산', allow != null ? esc(pmWonShort(allow)) : '예산 미입력', [
        budget ? kv('잔여 예산', esc(pmWonShort(Math.max(0, budget - spent)))) : '',
        kv('남은 일수', left + '일'),
        kv('최근 7일 일평균', esc(pmWonShort(avg7)))
      ], '', allow == null) :
      stat('예산 대비 차액', budget ? esc((budget - spent >= 0 ? '+' : '-') + pmWonShort(Math.abs(budget - spent))) : '예산 미입력', [
        budget ? kv('예산', esc(pmWonShort(budget))) : '',
        budget ? kv('광고비', esc(pmWonShort(spent)) + ' (' + Math.round(spendPct) + '%)') : ''
      ], '', !budget)) +
      stat('마감 확정액', closing ? esc(pmWonShort(closing)) : '미입력', closing ? [
        kv('입력 매체 광고비', esc(pmWonShort(closingSpent))),
        kv('차이', (closing >= closingSpent ? '+' : '-') + esc(pmWonShort(Math.abs(closing - closingSpent))))
      ] : [
        kv('기준', '청구서 금액'),
        kv('포함', 'VAT·대행 수수료')
      ], '', !closing) +
      '</div>';

    // 2) 매체별 예산·광고비 표
    var chs = [];
    (M.channels || []).forEach(function (c) { if (c.cost > 0 || (M.budget || {})[c.channel] || (M.closing || {})[c.channel]) chs.push(c.channel); });
    Object.keys(M.budget || {}).concat(Object.keys(M.closing || {})).forEach(function (k) { if (chs.indexOf(k) < 0) chs.push(k); });
    var costOf = {};
    (M.channels || []).forEach(function (c) { costOf[c.channel] = c.cost; });
    var mrows = chs.map(function (ch) {
      var b = (M.budget || {})[ch], c = costOf[ch] || 0, cl = (M.closing || {})[ch];
      var pe = (M.period || {})[ch], pmd = function (iso) { return +iso.slice(5, 7) + '/' + +iso.slice(8, 10); };
      return '<tr><th>' + pmChName(M, label, ch) + (pe ? '<small class="pm-bg-pd">기간 ' + pmd(pe.from) + '-' + pmd(pe.to) + '</small>' : '') +
        '</th><td>' + (b ? pmNum(b) : '-') + '</td><td class="key">' + pmNum(c) + '</td>' +
        '<td>' + (b ? Math.round(c / b * 100) + '%' : '-') + '</td><td>' + (cl != null ? pmNum(cl) : '-') + '</td></tr>';
    }).join('');
    var mtable = '<div class="tl-table-wrap"><table class="tl-table pm-table pm-bg-t"><thead><tr><th class="tl-th-l">매체</th>' +
      '<th>예산(원)</th><th class="key">광고비(원)</th><th>소진율</th><th>마감 확정액(원)</th></tr></thead><tbody>' +
      mrows + '<tr class="pm-tot"><th>합계</th><td>' + (budget ? pmNum(budget) : '-') + '</td><td class="key">' + pmNum(spent) + '</td>' +
      '<td>' + (budget ? Math.round(spendPct) + '%' : '-') + '</td><td>' + (closing ? pmNum(closing) : '-') + '</td></tr></tbody></table></div>';

    // 3) 주차별 표(ISO 주차, 월요일 시작, 달 경계에서 자름). 전체면 매체별 광고비 열 + 합계,
    //    매체를 고르면 그 매체의 광고비·누적·예산 대비(그 매체 예산)·ROAS
    var byDay = {};
    (M.daily || []).forEach(function (d) { byDay[+d.date.slice(8, 10)] = d; });
    var wch = (M.channels || []).filter(function (c) { return c.cost > 0; }).map(function (c) { return c.channel; });
    // 전체 보기의 매체 열은 광고비 상위 3개까지, 나머지는 '기타'로 묶어 매체가 늘어도 표 폭이 그대로다
    var wTop = wch.slice(0, 3), wEtc = wch.length > 3;
    var wk = VX.pm.wkCh || '';
    if (wk && wch.indexOf(wk) < 0) wk = VX.pm.wkCh = '';
    var wBudget = wk ? (+(M.budget || {})[wk] || 0) : budget;
    var cum = 0;
    var wrows = pmWeeksOf(M.month, days).map(function (w, i) {
      var cost = 0, rev = 0, per = {}, n = 0, lastD = 0;
      for (var d = w[0]; d <= w[1]; d++) {
        var r = byDay[d];
        if (!r) continue;
        n++; lastD = d;
        if (wk) {
          var bc = (r.byChannel || {})[wk] || {};
          cost += bc.cost || 0; rev += bc.revenue || 0;
        } else {
          cost += r.cost; rev += r.revenue;
          Object.keys(r.byChannel || {}).forEach(function (ch) { per[ch] = (per[ch] || 0) + r.byChannel[ch].cost; });
        }
      }
      if (!n) return '';
      cum += cost;
      // 기간은 데이터가 있는 날까지로 적는다. 이번 주면 오늘 것이 아직 없다는 뜻이라 '당일 미반영'을 붙인다
      var partial = n < (w[1] - w[0] + 1);
      var today = kstToday(), thisWeek = M.month === ymd(today).slice(0, 7) && today.getDate() >= w[0] && today.getDate() <= w[1];
      var wkNo = isoWeekKey(new Date(+M.month.slice(0, 4), mm - 1, w[0])).split('-')[1];   // ISO 주차(W36 등)
      return '<tr><th>' + wkNo + ' <span class="pm-bg-rng">' + mm + '/' + w[0] + '~' + mm + '/' + (partial ? lastD : w[1]) +
        (thisWeek && lastD < today.getDate() ? ' · 당일 미반영' : '') + '</span></th>' +
        (wk ? '' : wTop.map(function (ch) { return '<td>' + pmNum(per[ch] || 0) + '</td>'; }).join('') +
          (wEtc ? '<td>' + pmNum(wch.slice(3).reduce(function (a, ch) { return a + (per[ch] || 0); }, 0)) + '</td>' : '')) +
        '<td class="key">' + pmNum(cost) + '</td><td class="mu">' + pmNum(cost / n) + '</td><td>' + pmNum(cum) + '</td>' +
        '<td>' + (wBudget ? Math.round(cum / wBudget * 100) + '%' : '-') + '</td>' +
        '<td class="key">' + pmRoasHtml({ cost: cost, roasNet: cost ? rev * (M.netTakeRate || pmTake()) / cost * 100 : null }) + '</td></tr>';
    }).join('');
    // 매체가 늘어도 한 줄에 머물도록 버튼 대신 드롭다운
    var wseg = '<select class="vx-select pm-wk-sel" id="pm-wk-sel" aria-label="주차별 매체">' +
      [['', '전체 매체']].concat(wch.map(function (ch) { return [ch, label[ch] || ch]; })).map(function (x) {
        return '<option value="' + esc(x[0]) + '"' + (wk === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>';
      }).join('') + '</select>';
    var wtable = '<div class="tl-table-wrap"><table class="tl-table pm-table pm-bg-w"><thead><tr><th class="tl-th-l">주차</th>' +
      (wk ? '' : wTop.map(function (ch) { return '<th>' + esc(label[ch] || ch) + '</th>'; }).join('') + (wEtc ? '<th>기타</th>' : '')) +
      // 달 경계에서 잘린 주(이틀치·하루치)를 온전한 주와 견줄 수 있게 일평균 열을 둔다
      '<th class="key">광고비(원)</th><th class="mu">일평균(원)</th><th>누적(원)</th><th>' + (wk ? '매체 예산 대비' : '예산 대비') +
      '</th><th class="key">ROAS(순매출)</th></tr></thead><tbody>' +
      wrows + '</tbody></table></div>';

    host.innerHTML = head + stats +
      '<div class="pm-bg-grid"><div class="pm-bg-chart"><div class="pm-bg-sub">누적 광고비' +
      '<span class="pm-bg-lg"><span class="a">실제</span>' + (left ? '<span class="f">예상</span>' : '') +
      (budget ? '<span class="b">예산 기준선</span>' : '') + '</span></div>' +
      '<div class="tl-chart" id="pm-bg-cum" style="min-height:280px"></div></div>' +
      '<div class="pm-bg-media"><div class="pm-bg-sub">매체별 예산·광고비</div>' + mtable + '</div></div>' +
      '<div class="pm-bg-sub" style="margin-top:18px">주차별' + wseg + '</div>' + wtable;

    // 누적 광고비 차트: 실제(실선) · 예상(점선) · 예산 기준선(예산을 날짜 비율로 나눈 회색 점선).
    // 날짜 칸 전체가 마우스오버 영역이고, 툴팁에 그날의 당일·누적 광고비(남은 날은 예상 누적)과 기준선을 보인다
    ensureVega().then(function () {
      var vals = [], wide = [], c = 0, labels = [];
      var won = function (v) { return Math.round(v).toLocaleString() + '원'; };
      for (var d = 1; d <= days; d++) {
        var lb = mm + '/' + d, r = byDay[d], tip = { 날짜: lb };
        labels.push(lb);
        if (d <= elapsed) {
          c += r ? r.cost : 0;
          vals.push({ 날짜: lb, 구분: '실제', 값: Math.round(c) });
          tip['당일 광고비'] = won(r ? r.cost : 0);
          tip['누적 광고비'] = won(c);
        }
        if (left && d >= elapsed) {
          var f = spent + avg7 * (d - elapsed);
          vals.push({ 날짜: lb, 구분: '예상', 값: Math.round(f) });
          if (d > elapsed) tip['예상 누적'] = won(f);
        }
        if (budget) {
          vals.push({ 날짜: lb, 구분: '예산 기준선', 값: Math.round(budget * d / days) });
          tip['예산 기준선'] = won(budget * d / days);
        }
        wide.push({ 날짜: lb, tip: tip });
      }
      var x = { field: '날짜', type: 'ordinal', sort: labels, title: null,
                scale: { paddingInner: 0, paddingOuter: 0 },
                axis: { values: [labels[0], labels[Math.floor(days / 2)], labels[days - 1]], labelAngle: 0, ticks: false,
                        domainColor: '#e4e4e7', labelColor: '#71717a', labelFontSize: 11, labelPadding: 8, labelFlush: true } };
      var y = { field: '값', type: 'quantitative', title: null,
                axis: { labelExpr: "datum.value >= 10000 ? format(datum.value / 10000, ',') + '만' : format(datum.value, ',')",
                        tickCount: 4, domain: false, ticks: false, gridColor: '#f4f4f5', labelColor: '#a1a1aa', labelFontSize: 10.5 } };
      var on = { condition: { param: 'hv', empty: false, value: 1 }, value: 0 };
      TL.chart($id('pm-bg-cum'), {
        encoding: { x: x },
        layer: [
          { data: { values: vals }, mark: { type: 'line', strokeWidth: 2, tooltip: false },
            encoding: { y: y,
              color: { field: '구분', type: 'nominal', legend: null,
                       scale: { domain: ['실제', '예상', '예산 기준선'], range: ['#2563eb', '#93c5fd', '#a1a1aa'] } },
              strokeDash: { field: '구분', type: 'nominal', legend: null,
                            scale: { domain: ['실제', '예상', '예산 기준선'], range: [[1, 0], [5, 4], [3, 3]] } } } },
          { data: { values: wide },
            params: [{ name: 'hv', select: { type: 'point', on: 'pointerover', clear: 'pointerout', fields: ['날짜'] } }],
            mark: { type: 'bar', color: '#18181b', opacity: 0.001 },
            // 그날 있는 칸만 담은 묶음(tip)을 그대로 툴팁으로 넘긴다. 칸을 나열하면 없는 칸이 undefined 로,
            // content:data 로 넘기면 차트 내부 정렬 칸까지 보인다
            encoding: { tooltip: { value: { expr: 'datum.tip' } } } },
          { data: { values: wide }, mark: { type: 'rule', color: '#d4d4d8', strokeDash: [3, 3], tooltip: false },
            encoding: { opacity: on } },
          { data: { values: vals }, transform: [{ filter: "datum['구분'] !== '예산 기준선'" }],
            mark: { type: 'point', filled: true, size: 46, color: '#2563eb', stroke: '#fff', strokeWidth: 1.5, tooltip: false },
            encoding: { y: y, opacity: on } }
        ]
      }, { height: 280 });
    }).catch(function () { $id('pm-bg-cum').innerHTML = '<div class="vx-empty">차트를 불러오지 못했습니다.</div>'; });

    var wsel = $id('pm-wk-sel');
    if (wsel) wsel.onchange = function () { VX.pm.wkCh = wsel.value; renderPmBudget(); };
    bindBudgetEdit();
  }

  function bindBudgetEdit() {
    var b = $id('pm-bg-edit');
    if (b) b.onclick = openBudgetEditor;

    var h = $id('pm-bg-hist');
    if (h) h.onclick = openBudgetHistory;
  }

  // 예산·마감 확정액 입력 이력: 누가·언제·어디서(슬랙·대시보드)·무엇을 얼마에서 얼마로
  function openBudgetHistory(fromEditor, keepH) {
    var M = VX.pm.month, mm = +M.month.slice(5, 7);
    var label = pmLabelMap(M);
    var KIND = { budget: '예산', closing: '마감 확정액', spend: '광고비', period: '광고 기간' }, SRC = { slack: '슬랙', dashboard: '대시보드' };
    var ov = $id('pm-bg-modal'), body = $id('pm-bg-modal-body');
    // 예산 창에서 열면 창 크기를 그대로 둔다(폭은 넓은 창, 높이는 직전 예산 창 높이)
    body.classList.toggle('wide', !!fromEditor);
    body.style.minHeight = fromEditor && keepH ? keepH + 'px' : '';
    body.innerHTML = '<button class="vx-modal-close" id="pm-bg-x" aria-label="닫기">×</button>' +
      '<div class="pm-hist-hd">' + (fromEditor ? '<button type="button" class="pm-back" id="pm-bg-back" aria-label="뒤로" title="뒤로">' + PM_IC_BACK + '</button>' : '') +
      '<h3>' + mm + '월 입력 이력</h3></div><div id="pm-bg-hist-list"><div class="vx-loading">불러오는 중</div></div>';
    ov.classList.add('open');
    function close() { ov.classList.remove('open'); body.classList.remove('wide'); body.style.minHeight = ''; document.removeEventListener('keydown', onKey); }
    // 예산 창에서 연 이력은 Esc·뒤로 아이콘이 예산 창으로 돌아간다(닫기 X 는 창을 닫는다)
    function back() { document.removeEventListener('keydown', onKey); body.style.minHeight = ''; openBudgetEditor(); }
    function onKey(e) { if (e.key === 'Escape') { if (fromEditor) back(); else close(); } }
    if (fromEditor) $id('pm-bg-back').onclick = back;
    document.addEventListener('keydown', onKey);
    ov.onclick = function (e) { if (e.target === ov) close(); };
    $id('pm-bg-x').onclick = close;
    var md = function (iso) { return +iso.slice(5, 7) + '/' + +iso.slice(8, 10); };
    var won = function (v) {
      if (v == null) return '미입력';
      if (typeof v === 'object') return v.amount == null ? md(v.from) + '-' + md(v.to)
        : Math.round(v.amount || 0).toLocaleString() + '원' + (v.from ? ' (' + md(v.from) + '-' + md(v.to) + ')' : '');
      return Math.round(v).toLocaleString() + '원';
    };
    fetchJson('/api/pm-budget-history?month=' + M.month).then(function (res) {
      var host = $id('pm-bg-hist-list');
      if (!host) return;
      if (!res || !res.ok) { host.innerHTML = '<div class="vx-error">이력을 불러오지 못했습니다.</div>'; return; }
      if (!(res.rows || []).length) { host.innerHTML = '<div class="vx-empty">아직 입력 이력이 없습니다.</div>'; return; }
      host.innerHTML = '<ul class="pm-bg-hl">' + res.rows.map(function (r) {
        return '<li><div class="h"><b>' + esc(r.ts.slice(5, 16).replace('-', '/')) + '</b><span>' +
          esc(r.editorName || String(r.editor || '').split('@')[0]) + '</span></div>' +
          '<ul class="c">' + (r.changes || []).map(function (c) {
            return '<li><span>' + esc(label[c.channel] || c.channel) + ' ' + KIND[c.kind] + ':</span> ' +
              won(c.before) + ' → <b>' + won(c.after) + '</b></li>';
          }).join('') + '</ul></li>';
      }).join('') + '</ul>';
    });
  }

  // 매체 관리: 매체 추가와 이름 변경만. 광고비·매출 입력 방식은 이달 데이터로 자동 표시한다.
  // 바꾸면 분류표(gs://moduparking-crm/pm/channel_map.json)에 바로 저장되고 매체 변경 이력에 남는다
  // 새 매체 추가: 별도 작은 팝업(이름 · 유형 · 추가/취소). 예산 창·매체 관리 위에 겹쳐 뜨고 Esc 로 닫힌다.
  // 유형은 기본 넷 + 지금까지 만든 유형, 맨 끝 '새 유형'을 고르면 이름 칸이 열려 새 유형으로 추가된다
  function pmAddChannelPopup(onAdded) {
    var TYPES = (VX.pm.chTypes || [{ type: 'DA', label: '디스플레이' }, { type: 'SA', label: '검색광고' },
      { type: 'BSA', label: '브랜드검색' }, { type: 'ETC', label: '기타' }]).map(function (t) { return [t.type, t.label]; });
    var opts = function () {
      return TYPES.map(function (t) { return '<option value="' + esc(t[0]) + '">' + esc(t[1]) + '</option>'; }).join('') +
        '<option value="__new">+ 새 유형</option>';
    };
    var ov = document.createElement('div');
    ov.className = 'vx-modal-overlay open pm-pop';
    ov.innerHTML = '<div class="vx-modal pm-pop-box"><button class="vx-modal-close" aria-label="닫기" data-x>×</button><h3>새 매체</h3>' +
      '<label class="pm-pop-f"><span>매체 이름</span><input class="vx-input" data-n placeholder="예: 토스페이"></label>' +
      '<label class="pm-pop-f"><span>유형</span><select class="vx-select" data-t>' + opts() + '</select></label>' +
      '<label class="pm-pop-f" data-tw hidden><span>새 유형 이름</span><input class="vx-input" data-tn maxlength="20" placeholder="예: 제휴 광고"></label>' +
      '<div class="vx-error" data-e style="display:none"></div>' +
      '<div class="pm-pop-ft"><button class="vx-btn" data-x>취소</button><button class="vx-btn primary" data-ok>추가</button></div></div>';
    document.body.appendChild(ov);
    var inp = ov.querySelector('[data-n]'), sel = ov.querySelector('[data-t]'), tn = ov.querySelector('[data-tn]');
    sel.onchange = function () { ov.querySelector('[data-tw]').hidden = sel.value !== '__new'; if (sel.value === '__new') tn.focus(); };
    // 다른 사람이 만든 유형까지 보이게 목록을 한 번 새로 받는다(고른 값은 유지)
    if (!VX.pm.chTypes) fetchJson('/api/pm-channels').then(function (res) {
      if (!res || !res.ok || !res.types) return;
      VX.pm.chTypes = res.types;
      var cur = sel.value;
      TYPES = res.types.map(function (t) { return [t.type, t.label]; });
      sel.innerHTML = opts(); sel.value = cur;
    });
    function close() { ov.remove(); document.removeEventListener('keydown', onKey, true); }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } if (e.key === 'Enter' && (e.target === inp || e.target === tn)) ok(); }
    document.addEventListener('keydown', onKey, true);
    ov.querySelectorAll('[data-x]').forEach(function (b) { b.onclick = close; });
    ov.onclick = function (e) { if (e.target === ov) close(); };
    function ok() {
      var name = inp.value.trim(), type = sel.value, er = ov.querySelector('[data-e]');
      if (!name) { er.style.display = ''; er.textContent = '매체 이름을 적어 주세요'; return; }
      if (type === '__new') {
        type = tn.value.trim();
        if (!type) { er.style.display = ''; er.textContent = '새 유형 이름을 적어 주세요'; tn.focus(); return; }
      }
      fetchJson('/api/pm-channels', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ op: 'add', label: name, type: type }) }).then(function (res) {
        if (!res || !res.ok) { er.style.display = ''; er.textContent = (res && res.error) || '추가하지 못했습니다'; return; }
        var added = (res.channels || []).filter(function (c) { return c.label === name; })[0];
        if (res.types) VX.pm.chTypes = res.types;
        close();
        if (onAdded) onAdded(added, res);
      });
    }
    ov.querySelector('[data-ok]').onclick = ok;
    inp.focus();
  }

  // 매체 관리는 예산 창 머리의 [매체 관리]에서 연다. 창 크기를 그대로 두고, 뒤로 아이콘·Esc 로 돌아간다
  function openChannelAdmin(keepH) {
    var ov = $id('pm-bg-modal'), body = $id('pm-bg-modal-body');
    var changed = false;
    function close() { ov.classList.remove('open'); body.classList.remove('wide'); body.style.minHeight = ''; document.removeEventListener('keydown', onKey); }
    function done() { close(); if (changed) { loadPmBudget(); fetchPm(); } }
    function back() {
      document.removeEventListener('keydown', onKey); body.style.minHeight = '';
      if (!changed) { openBudgetEditor(); return; }
      // 매체를 바꿨으면 그달 데이터를 다시 받아 새 매체가 예산 창에 보이게
      fetchJson('/api/pm-month?month=' + VX.pm.month.month).then(function (res) {
        if (res && res.ok) VX.pm.month = res;
        openBudgetEditor(); fetchPm();
      });
    }
    function onKey(e) { if (e.key === 'Escape') back(); }
    document.addEventListener('keydown', onKey);
    ov.onclick = function (e) { if (e.target === ov) done(); };
    ov.classList.add('open');
    body.classList.add('wide');
    body.style.minHeight = keepH ? keepH + 'px' : '';
    body.innerHTML = '<button class="vx-modal-close" id="pm-bg-x" aria-label="닫기">×</button>' +
      // 머리 줄은 예산 창과 같은 구조: 왼쪽 뒤로·제목, 오른쪽 [매체 추가](편집 권한이 확인되면 보인다)
      '<div class="pm-be-hd"><span class="pm-hist-hd" style="margin:0"><button type="button" class="pm-back" id="pm-ca-back" aria-label="뒤로" title="뒤로">' + PM_IC_BACK + '</button><h3>매체 관리</h3></span>' +
      '<span class="pm-be-acts"><button type="button" class="pm-hd-btn" id="pm-ca-addopen" hidden>' + PM_IC_PLUS + '매체 추가</button></span></div>' +
      '<div id="pm-ca-body"><div class="vx-loading">불러오는 중</div></div>';
    $id('pm-bg-x').onclick = done;
    $id('pm-ca-back').onclick = back;
    function post(payload) {
      return fetchJson('/api/pm-channels', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                             body: JSON.stringify(payload) }).then(function (res) {
        if (!res || !res.ok) { var e = $id('pm-ca-err'); if (e) { e.style.display = ''; e.textContent = (res && res.error) || '저장하지 못했습니다'; } return; }
        changed = true; render(res);
      });
    }
    var last = null;
    function render(res) {
      last = res;
      var host = $id('pm-ca-body');
      if (!host) return;
      var chs = res.channels || [], ed = res.canEdit;
      var types = res.types || [];
      if (res.types) VX.pm.chTypes = res.types;
      var lbOf = {}; chs.forEach(function (c) { lbOf[c.key] = c.label; });
      var tsel = function (cur, attr) {
        return '<select class="vx-select" ' + attr + '>' + types.map(function (t) {
          return '<option value="' + t.type + '"' + (t.type === cur ? ' selected' : '') + '>' + esc(t.label) + '</option>'; }).join('') + '</select>';
      };
      var paid = chs.filter(function (c) { return c.paid; });
      // 이달 데이터로 광고비만 손으로 넣는 매체(전환·매출은 들어오는데 광고비가 없음)를 가른다
      var MM = (VX.pm.month && VX.pm.month.channels) || [];
      var costManual = {};
      MM.forEach(function (x) { if (pmAbCost(x) <= 0 && (x.install || x.purchase || x.revenue || x.manualCost)) costManual[x.channel] = 1; });
      // 두 가지. 직접 고른 값(costInput)이 있으면 그것, 없으면 이달 데이터로 자동. 뒤의 [수정]으로 바꾼다
      var modeOf = function (c) { return c.manual ? 'manual' : (c.costInput || (costManual[c.key] ? 'manual' : 'auto')); };
      var state = function (c) {
        var m = modeOf(c);
        return m === 'manual' ? '<span class="pm-st m">' + PM_IC_PEN + '수기 입력</span>' : '<span class="pm-st a">' + PM_IC_LINK + '에어브릿지 연동</span>';
      };
      var editBtnOf = function (c) {
        return ed && !c.manual ? '<button type="button" class="vx-btn sm pm-ca-ed" data-key="' + esc(c.key) + '" data-mode="' + modeOf(c) + '">수정</button>' : '';
      };
      host.innerHTML =
        
        '<div id="pm-ca-err" class="vx-error" style="display:none;margin-bottom:10px"></div>' +
        // 고칠 수 있는 것은 이름 하나(누르면 입력, 엔터·칸 밖 클릭 시 저장). 광고비·매출 입력은 이달 데이터로 자동 표시
        '<div class="tl-table-wrap"><table class="tl-table pm-table pm-ca-t"><thead><tr><th class="tl-th-l">매체</th><th class="tl-th-l">유형</th>' +
        '<th class="tl-th-l">광고비 입력</th><th class="pm-ca-act"></th></tr></thead><tbody>' +
        paid.filter(function (c) { return !c.hidden && !c.mergeInto; }).map(function (c) {
          return '<tr><th>' + (ed ? '<input class="pm-ca-name" data-key="' + esc(c.key) + '" value="' + esc(c.label) + '" aria-label="매체 이름">' : esc(c.label)) +
            '<small>' + esc(c.key) + '</small></th><td>' + esc(c.typeLabel) + '</td><td class="pm-ca-in" data-key="' + esc(c.key) + '">' + state(c) + '</td>' +
            '<td class="pm-ca-act">' + editBtnOf(c) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      $id('pm-ca-addopen').hidden = !ed;
      if (!ed) return;
      $id('pm-ca-addopen').onclick = function () { pmAddChannelPopup(function (c, res) { changed = true; render(res); }); };
      // [수정] → 그 칸에서 에어브릿지 연동 / 수기 입력 고르고 저장
      host.querySelectorAll('.pm-ca-ed').forEach(function (btn) {
        btn.onclick = function () {
          var k = btn.dataset.key, cell = host.querySelector('.pm-ca-in[data-key="' + k + '"]'), cur = btn.dataset.mode;
          btn.hidden = true;
          cell.innerHTML = '<span class="pm-ca-pick"><select class="vx-select">' +
            '<option value="auto"' + (cur === 'auto' ? ' selected' : '') + '>에어브릿지 연동</option>' +
            '<option value="manual"' + (cur === 'manual' ? ' selected' : '') + '>수기 입력</option></select>' +
            '<button type="button" class="vx-btn sm primary" data-go>저장</button><button type="button" class="vx-btn sm" data-no>취소</button></span>';
          cell.querySelector('[data-go]').onclick = function () { post({ op: 'input', key: k, label: cell.querySelector('select').value }); };
          cell.querySelector('[data-no]').onclick = function () { render(last); };
        };
      });
      host.querySelectorAll('.pm-ca-name').forEach(function (inp) {
        var save = function () { var v = inp.value.trim(); if (v && v !== lbOf[inp.dataset.key]) post({ op: 'rename', key: inp.dataset.key, label: v }); };
        inp.onkeydown = function (e) { if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = lbOf[inp.dataset.key]; inp.blur(); } };
        inp.onblur = save;
      });
    }
    fetchJson('/api/pm-channels').then(function (res) {
      if (!res || !res.ok) { $id('pm-ca-body').innerHTML = '<div class="vx-error">매체 목록을 불러오지 못했습니다.</div>'; return; }
      render(res);
    });
  }



  // 예산 소진 입력 창(기획운영팀). 카드 머리 [입력]으로 열고 창 제목은 카드 제목과 같다. 매체 하나에 한 줄: 광고 기간 · 예산 · 마감 확정액 · 광고비 · 구매액.
  // 연동(에어브릿지에 광고비가 들어오는 매체)은 광고비·구매액을 숫자로만 보여 주고, 수기 입력 매체만 입력칸을 둔다.
  // 수기 매체(에어브릿지 채널 없음)는 구매액도 넣어 ROAS 에 들어간다. 광고 기간은 그달 안에서 매체마다, MM/DD 로 적는다.
  // 맨 위 합계 예산·광고비·소진율은 칸을 고칠 때마다 다시 계산한다. 이달 집행도 입력도 없는 매체는 아래로 접는다
  // focusCh: 매체별 성과의 '입력 필요'에서 열 때 그 매체 카드를 수정 상태로 펼쳐 광고비 칸에 커서를 둔다
  function openBudgetEditor(focusCh) {
    if (typeof focusCh !== 'string') focusCh = '';
    var M = VX.pm.month, yy = +M.month.slice(0, 4), mm = +M.month.slice(5, 7);
    var list = [], label = pmLabelMap(M), manualMap = {}, inputMode = {};
    (M.paidChannels || []).forEach(function (c) {
      if (list.indexOf(c.channel) < 0) list.push(c.channel);
      if (c.manual) manualMap[c.channel] = 1;
      if (c.costInput) inputMode[c.channel] = c.costInput;   // 매체 관리에서 고른 광고비 입력 방식
    });
    (M.channels || []).forEach(function (c) { if (list.indexOf(c.channel) < 0) list.push(c.channel); if (c.manual) manualMap[c.channel] = 1; });
    var abCost = {}, needIn = {}, SP = M.spend || {}, PE = M.period || {};
    (M.channels || []).forEach(function (c) {
      abCost[c.channel] = Math.round(pmAbCost(c));
      // 전환·구매는 들어오는데 에어브릿지 광고비가 없는 매체(당근 등)는 광고비를 손으로 넣는다
      if (!abCost[c.channel] && (c.install || c.purchase || c.revenue || c.manualCost)) needIn[c.channel] = 1;
    });
    // 수기 입력: 손으로 추가한 매체 + 광고비 미연동 매체(이미 넣은 광고비 포함). 나머지는 연동
    var isManual = function (ch) {
      if (manualMap[ch]) return true;
      if (inputMode[ch]) return inputMode[ch] === 'manual';
      return !!(needIn[ch] || (SP[ch] && SP[ch].amount));
    };
    var idle = list.filter(function (ch) {
      return !abCost[ch] && !needIn[ch] && ch !== focusCh && (M.budget || {})[ch] == null && (M.closing || {})[ch] == null && !SP[ch];
    });
    var active = list.filter(function (ch) { return idle.indexOf(ch) < 0; });
    var mFirst = M.month + '-01', mLast = M.month + '-' + String(M.days).padStart(2, '0');
    var mdOf = function (iso) { return iso.slice(5, 7) + '/' + iso.slice(8, 10); };
    function fmt(v) { return v == null || v === '' ? '' : Math.round(+v).toLocaleString(); }
    function dateBtn(ch, key, iso) {
      return '<label class="pm-bd"><span>' + mdOf(iso) + '</span><input type="date" data-ch="' + esc(ch) + '" data-pk="' + key +
        '" min="' + mFirst + '" max="' + mLast + '" value="' + iso + '" aria-label="' + (key === 'from' ? '시작일' : '종료일') + '"></label>';
    }
    // 매체마다 세로 카드 한 장: 광고 기간 → 예산 → 마감 확정액 → 광고비 → 구매액.
    // 예산 창에는 이달 데이터·입력값이 있는 매체와 수기 매체만. 새로 시작하는 매체는 아래 '다른 매체 추가'로 꺼낸다
    function card(ch) {
      var sp = SP[ch] || {}, pe = PE[ch] || (sp.from ? sp : {}), manual = isManual(ch), full = !!manualMap[ch];
      var st = manual ? '<span class="pm-st m">' + PM_IC_PEN + '수기 입력</span>' : '<span class="pm-st a">' + PM_IC_LINK + '에어브릿지 연동</span>';
      var inp = function (k, v, ph) {
        return '<input class="vx-input" inputmode="numeric" readonly data-k="' + k + '" data-ch="' + esc(ch) + '" value="' + fmt(v) + '" placeholder="' + (ph || '미입력') + '">';
      };
      return '<div class="pm-bc" data-card="' + esc(ch) + '"><div class="h"><b>' + esc(label[ch] || ch) + '</b>' + st + '</div>' +
        '<div class="f"><span>광고 기간</span><span class="pw">' + dateBtn(ch, 'from', pe.from || mFirst) + '<i>–</i>' + dateBtn(ch, 'to', pe.to || mLast) + '</span></div>' +
        '<label class="f"><span>예산(원)</span>' + inp('budget', (M.budget || {})[ch]) + '</label>' +
        '<label class="f"><span>마감 확정액(원)<small class="pm-vat">VAT·대행 수수료 포함</small></span>' + inp('closing', (M.closing || {})[ch]) + '</label>' +
        (manual ? '<label class="f"><span>광고비(원)</span>' + inp('spend', sp.amount) + '</label>'
                : '<div class="f"><span>광고비(원)</span><b class="ro" data-ab="' + esc(ch) + '">' + (abCost[ch] ? pmNum(abCost[ch]) : '-') + '</b></div>') +
        // 구매액은 에어브릿지 채널이 없는 수기 매체만(ROAS 매출을 직접 넣어야 할 때). 나머지는 줄 자체를 두지 않는다
        (full ? '<label class="f"><span>구매액(원)</span>' + inp('mrev', sp.revenue) + '</label>' : '') +
        '</div>';
    }
    // 순서: 에어브릿지 연동(광고비 큰 순) → 수기 입력(광고비 미연동) → 수기 매체
    var rank = function (ch) { return manualMap[ch] ? 2 : (isManual(ch) ? 1 : 0); };
    var shown = list.filter(function (ch) { return active.indexOf(ch) >= 0 || manualMap[ch]; })
      .sort(function (x, y) { return rank(x) - rank(y) || (abCost[y] || 0) - (abCost[x] || 0); });
    var rest = list.filter(function (ch) { return shown.indexOf(ch) < 0; });
    var ov = $id('pm-bg-modal');
    var thisYear = kstToday().getFullYear();
    $id('pm-bg-modal-body').innerHTML =
      '<button class="vx-modal-close" id="pm-bg-x" aria-label="닫기">×</button>' +
      '<div class="pm-be-hd"><span class="pm-hist-hd" style="margin:0"><button type="button" class="pm-back" id="pm-bg-eback" aria-label="수정 취소" title="수정 취소" hidden>' + PM_IC_BACK + '</button>' +
      '<h3>' + (yy !== thisYear ? yy + '년 ' : '') + mm + '월 예산 소진</h3></span>' +
      '<span class="pm-be-acts"><button type="button" class="pm-hd-btn" id="pm-bg-admin">' + PM_IC_GEAR + '매체 관리</button>' +
      '<button type="button" class="pm-hd-btn" id="pm-bg-hist2" hidden>' + PM_IC_HIST + '입력 이력</button>' +
      '<button type="button" class="pm-hd-btn pri" id="pm-bg-em">' + PM_IC_PEN + '수정</button></span></div>' +
      '<div class="pm-bs"><div><span>합계 예산</span><b id="pm-bs-b">-</b></div><div><span>광고비</span><b id="pm-bs-s">-</b></div>' +
      '<div><span>소진율</span><b id="pm-bs-p">-</b></div></div>' +
      '<div class="pm-bcs" id="pm-bcs">' + shown.map(card).join('') +
      '<div class="pm-bc-addc" id="pm-bc-addw" hidden><button type="button" class="pm-bc-addb" id="pm-bc-add"' + (rest.length ? '' : ' hidden') + '>' + PM_IC_PLUS + '매체 추가</button>' +
        '<span class="pm-bc-picks" id="pm-bc-picks" hidden>' + rest.map(function (ch) {
          return '<button type="button" class="pm-bc-pick" data-ch="' + esc(ch) + '">' + esc(label[ch] || ch) + '</button>'; }).join('') +
        '<button type="button" class="pm-bc-pick new" id="pm-bc-new">' + PM_IC_PLUS + '새 매체</button></span>' +
        (rest.length ? '' : '<button type="button" class="pm-bc-addb" id="pm-bc-new2">' + PM_IC_PLUS + '새 매체</button>') + '</div>' +
      '</div>' +

      '<div id="pm-bg-err" class="vx-error" style="display:none;margin-top:10px"></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px">' +
      '<button class="vx-btn" id="pm-bg-cancel">취소</button><button class="vx-btn primary" id="pm-bg-save">저장</button></div>';
    ov.classList.add('open');
    var box = $id('pm-bg-modal-body');
    box.classList.add('wide');
    function close() { ov.classList.remove('open'); box.classList.remove('wide'); document.removeEventListener('keydown', onKey); }
    // 수정 중 Esc·뒤로 아이콘은 고친 내용을 버리고 보기 화면으로, 보기 화면에서 Esc 는 닫기
    function onKey(e) { if (e.key === 'Escape') { if (editAll) exitEdit(); else close(); } }
    function exitEdit() { document.removeEventListener('keydown', onKey); openBudgetEditor(); }
    document.addEventListener('keydown', onKey);
    ov.onclick = function (e) { if (e.target === ov) close(); };
    $id('pm-bg-x').onclick = close;
    $id('pm-bg-cancel').onclick = close;
    $id('pm-bg-hist2').onclick = function () { var h = box.offsetHeight; close(); openBudgetHistory(true, h); };
    var num = function (v) { return +(String(v || '').replace(/[^0-9]/g, '')) || 0; };
    function sums() {
      var bsum = 0, sp = 0;
      box.querySelectorAll('input[data-k="budget"]').forEach(function (i) { bsum += num(i.value); });
      box.querySelectorAll('input[data-k="spend"]').forEach(function (i) { sp += num(i.value); });
      box.querySelectorAll('[data-ab]').forEach(function (e) { sp += abCost[e.dataset.ab] || 0; });
      var wonU = function (v) { return Math.round(v).toLocaleString() + '<span class="u">원</span>'; };
      $id('pm-bs-b').innerHTML = bsum ? wonU(bsum) : '<span class="na">미입력</span>';
      $id('pm-bs-s').innerHTML = wonU(sp);
      $id('pm-bs-p').textContent = bsum ? Math.round(sp / bsum * 100) + '%' : '-';
    }
    // 기본은 읽기 전용: 값이 있는 칸은 글자처럼 보이고, 비어 있는 칸(미입력)은 눌러야 입력된다.
    // 제목 옆 [수정]을 누르면 모든 칸과 광고 기간을 고칠 수 있다([수정 끝]으로 되돌림)
    var editAll = false;
    function bind(root) {
      root.querySelectorAll('input[data-k]').forEach(function (inp) {
        inp.onblur = function () { var n = inp.value.replace(/[^0-9]/g, ''); inp.value = n ? (+n).toLocaleString() : ''; };
        inp.oninput = sums;
        inp.onclick = function () {
          if (!inp.readOnly) return;
          if (!inp.value) { inp.readOnly = false; inp.classList.add('on'); inp.focus(); }
        };
        if (editAll) { inp.readOnly = false; inp.classList.add('on'); }
      });
      // 날짜 버튼: 수정 모드에서만. 누르면 달력, 고르면 MM/DD 로 다시 적는다
      root.querySelectorAll('.pm-bd input[type=date]').forEach(function (inp) {
        var lab = inp.parentNode;
        inp.disabled = !editAll;
        var pick = function (e) {
          if (inp.disabled) { if (e) e.preventDefault(); return; }
          if (e) e.preventDefault();
          try { inp.showPicker(); } catch (x) { inp.focus(); }
        };
        lab.onclick = pick;
        inp.onclick = pick;
        inp.onchange = function () { if (inp.value) lab.querySelector('span').textContent = mdOf(inp.value); };
      });
    }
    // [수정]: 모든 칸·광고 기간·매체 추가가 열린다. 버튼은 사라지고 바닥 [취소]/[저장]으로 끝낸다
    $id('pm-bg-eback').onclick = exitEdit;
    $id('pm-bg-admin').onclick = function () { var h = box.offsetHeight; document.removeEventListener('keydown', onKey); openChannelAdmin(h); };
    $id('pm-bg-em').onclick = function () {
      editAll = true;
      this.hidden = true;
      $id('pm-bg-eback').hidden = false;
      $id('pm-bg-admin').hidden = true;
      $id('pm-bg-hist2').hidden = false;
      var aw = $id('pm-bc-addw');
      if (aw && aw.querySelector('.pm-bc-pick:not([hidden])')) aw.hidden = false;
      box.classList.add('pm-edit');
      box.querySelectorAll('input[data-k]').forEach(function (inp) {
        inp.readOnly = !editAll && !!inp.value;
        inp.classList.toggle('on', !inp.readOnly);
      });
      box.querySelectorAll('.pm-bd input[type=date]').forEach(function (inp) { inp.disabled = !editAll; });
    };
    bind(box);
    sums();
    if (focusCh) {
      $id('pm-bg-em').click();
      var fc = box.querySelector('.pm-bc[data-card="' + CSS.escape(focusCh) + '"]');
      if (fc) {
        var fi = fc.querySelector('input[data-k="spend"]') || fc.querySelector('input[data-k="budget"]');
        fc.scrollIntoView({ block: 'center' });
        if (fi) fi.focus({ preventScroll: true });
      }
    }
    // [+ 매체 추가] → 이번 달 카드가 없는 매체 이름이 펼쳐지고, 고르면 카드를 꺼낸다. 꺼낸 카드는 × 로 뺀다
    // (값을 하나도 안 넣은 카드는 저장할 때 잘못 누른 것으로 보고 버린다)
    var addBtn = $id('pm-bc-add'), picks = $id('pm-bc-picks');
    function syncAdd() { $id('pm-bc-addw').hidden = !editAll; }
    // [+ 새 매체]: 매체 관리로 넘어가 새 매체를 추가한다(창 크기 그대로, 뒤로 아이콘으로 돌아옴)
    ['pm-bc-new', 'pm-bc-new2'].forEach(function (id) {
      var b = $id(id);
      if (b) b.onclick = function () {
        pmAddChannelPopup(function (c) {
          if (!c) return;
          label[c.key] = c.label; manualMap[c.key] = 1;
          var wrap = document.createElement('div');
          wrap.innerHTML = card(c.key);
          var el = wrap.firstChild;
          $id('pm-bcs').insertBefore(el, $id('pm-bc-addw'));
          bind(el);
          var ib = el.querySelector('input[data-k="budget"]');
          ib.readOnly = false; ib.classList.add('on'); ib.focus();
          VX.pm.month.paidChannels = (VX.pm.month.paidChannels || []).concat([{ channel: c.key, label: c.label, manual: true }]);
        });
      };
    });
    if (addBtn) addBtn.onclick = function () { picks.hidden = false; addBtn.hidden = true; };
    if (picks) picks.querySelectorAll('.pm-bc-pick:not(.new)').forEach(function (pb) {
      pb.onclick = function () {
        var ch = pb.dataset.ch, wrap = document.createElement('div');
        wrap.innerHTML = card(ch);
        var el = wrap.firstChild;
        $id('pm-bcs').insertBefore(el, $id('pm-bc-addw'));
        bind(el);
        pb.hidden = true; picks.hidden = true; addBtn.hidden = false; syncAdd();
        var x = document.createElement('button');
        x.type = 'button'; x.className = 'pm-bc-x'; x.title = '빼기'; x.setAttribute('aria-label', '빼기'); x.innerHTML = PM_IC_X;
        el.querySelector('.h').appendChild(x);
        x.onclick = function () { el.remove(); pb.hidden = false; syncAdd(); sums(); };
        var ib = el.querySelector('input[data-k="budget"]');
        ib.readOnly = false; ib.classList.add('on'); ib.focus();
      };
    });
    $id('pm-bg-save').onclick = function () {
      var body = { month: M.month, budget: {}, closing: {}, spend: {}, period: {} };
      function perOf(ch) {
        var f = box.querySelector('input[data-pk="from"][data-ch="' + ch + '"]'), t = box.querySelector('input[data-pk="to"][data-ch="' + ch + '"]');
        return { from: (f && f.value) || mFirst, to: (t && t.value) || mLast };
      }
      // 값이 하나도 없는 카드(추가만 하고 입력 안 함)는 잘못 누른 것으로 보고 광고 기간도 저장하지 않는다
      var hasVal = function (ch) {
        if (abCost[ch]) return true;
        return [].some.call(box.querySelectorAll('input[data-k][data-ch="' + ch + '"]'), function (i) { return i.value.replace(/[^0-9]/g, ''); });
      };
      box.querySelectorAll('input[data-pk="from"]').forEach(function (f) { if (hasVal(f.dataset.ch)) body.period[f.dataset.ch] = perOf(f.dataset.ch); });
      box.querySelectorAll('input[data-k]').forEach(function (inp) {
        var n = inp.value.replace(/[^0-9]/g, ''), ch = inp.dataset.ch, k = inp.dataset.k;
        if (!n) return;
        if (k === 'spend' || k === 'mrev') {
          var e = body.spend[ch] || (body.spend[ch] = perOf(ch));
          e[k === 'spend' ? 'amount' : 'revenue'] = +n;
        } else body[k][ch] = +n;
      });
      var btn = this;
      btn.disabled = true;
      fetchJson('/api/pm-budget', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify(body) }).then(function (res) {
        btn.disabled = false;
        if (!res || !res.ok) {
          var e = $id('pm-bg-err'); e.style.display = ''; e.textContent = (res && res.error) || '저장하지 못했습니다';
          return;
        }
        close();
        loadPmBudget();
        if (Object.keys(body.spend).length || Object.keys(SP).length) fetchPm();   // 직접 입력은 KPI·ROAS에도 들어가므로 위 카드도 다시
      });
    };
  }

  function loadCreatives() {
    var host = $id('pm-creatives');
    if (!host) return;
    host.innerHTML = '<div class="vx-loading">캠페인 성과를 불러오는 중</div>';
    var ch = $id('pm-cr-ch') ? $id('pm-cr-ch').value : '';
    fetchJson('/api/pm-creatives?from=' + VX.pm.from + '&to=' + VX.pm.to +
      (ch ? '&channel=' + encodeURIComponent(ch) : '')).then(function (res) {
      if (!res || !res.ok) {
        host.innerHTML = '<div class="vx-error">캠페인 성과를 불러오지 못했습니다. ' + esc(pmErrorText(res && res.error)) + '</div>';
        return;
      }
      VX.pm.creatives = res.rows || [];
      renderCreatives();
    });
  }

  // 캠페인별 성과: 열 제목을 눌러 정렬, 한 번에 10개씩
  var PM_CR_COLS = [
    { k: 'campaign', l: '캠페인 · 광고그룹', t: 'text' },
    { k: 'cost', l: '광고비(원)', key: 1 }, { k: 'revenue', l: '구매액(원)', key: 1 }, { k: 'roas', l: 'ROAS(순매출)', key: 1 },
    { k: 'install', l: '설치' }, { k: 'signup', l: '가입' }, { k: 'purchase', l: '결제' },
    { k: 'clk', l: '클릭', m: 1, opt: 1 }, { k: 'ctr', l: '클릭률', m: 1, opt: 2 }, { k: 'cpi', l: '설치당(원)', m: 1, opt: 1 }
  ];

  function renderCreatives() {
    var host = $id('pm-creatives');
    var raw = !!VX.pm.crRaw;
    var rows = (VX.pm.creatives || []).map(function (r) {
      return {
        campaign: raw ? r.campaign : (r.campaignLabel || r.campaign),
        channel: r.channelLabel || r.channel,
        adGroup: raw ? (r.adGroup || '(미지정)') : (r.adGroupLabel || r.adGroup || '(미지정)'),
        cost: r.cost, imp: r.imp, clk: r.clk, ctr: r.ctr, install: r.install,
        cpi: r.cost ? r.cpi : null, signup: r.signup, purchase: r.purchase, revenue: r.revenue,
        roas: r.cost ? r.roasNet : null, _r: r,
        _conv: (r.install || 0) + (r.signup || 0) + (r.purchase || 0) > 0,
        _ios: /ios/i.test((r.campaign || '') + ' ' + (r.adGroup || ''))
      };
    });
    // 검색: 한글 이름·원래 이름의 캠페인·광고그룹에서 찾는다(여러 낱말은 모두 포함). 칩 개수·광고비 합도 검색 결과 기준
    var q = (VX.pm.crQ || '').trim().toLowerCase();
    if (q) {
      var words = q.split(/\s+/);
      rows = rows.filter(function (r) {
        var hay = [r.campaign, r.adGroup, r._r.campaign, r._r.adGroup, r._r.campaignLabel, r._r.adGroupLabel, r.channel].join(' ').toLowerCase();
        return words.every(function (w) { return hay.indexOf(w) >= 0; });
      });
    }
    if (!rows.length) {
      host.innerHTML = '<div class="vx-empty">' + (q ? '\'' + esc(VX.pm.crQ.trim()) + '\'에 맞는 캠페인이 없습니다.' : '이 기간에 광고비나 전환이 잡힌 캠페인이 없습니다.') + '</div>';
      return;
    }
    // 이상치: 광고비 10만 원 이상인데 설치당 비용이 같은 매체 평균의 5배를 넘는 광고그룹.
    // 매체마다 설치 단가가 크게 달라(앱 설치 광고 수백 원, 검색광고 수만 원) 전체 평균과 비교하면 검색광고가 다 걸린다
    var avgBy = {};
    rows.forEach(function (r) {
      if (r.install > 0) {
        var a = avgBy[r.channel] || (avgBy[r.channel] = { i: 0, c: 0 });
        a.i += r.install; a.c += r.cost || 0;
      }
    });
    rows.forEach(function (r) {
      var a = avgBy[r.channel];
      if (a && a.i && r.install > 0 && (r.cost || 0) >= 100000) {
        var avg = a.c / a.i, k = r.cost / r.install / avg;
        if (k > 5) { r._hiCpi = k; r._avgCpi = avg; }
      }
    });
    // 전환(설치·가입·결제)이 하나도 없는 광고그룹을 따로 모아 볼 수 있게 표 위에 거르기 칩을 둔다
    var none = rows.filter(function (r) { return !r._conv; });
    var totCost = rows.reduce(function (a, r) { return a + (r.cost || 0); }, 0);
    var odd = rows.filter(function (r) { return r._hiCpi; });
    var flt = VX.pm.crFilter || 'all';
    if (flt === 'odd' && !odd.length) flt = VX.pm.crFilter = 'all';   // 이상치가 사라진 기간으로 옮기면 전체로
    // 칩에는 이름과 개수만. 전환 없는 광고비의 금액·비중은 칩 오른쪽에 막대와 함께 따로 둔다
    var chips = '<div class="pm-cr-bar"><div class="bn-seg pm-cr-flt" id="pm-cr-flt">' +
      [['all', '전체', rows.length], ['conv', '전환 있음', rows.length - none.length], ['none', '전환 없음', none.length],
       ['odd', '이상치', odd.length]]
        .map(function (x) {
          // 이상치는 0건이어도 칩을 남긴다(기준이 있다는 걸 보이게). 0건이면 누를 수 없게
          return '<button type="button" data-f="' + x[0] + '"' + (flt === x[0] ? ' class="on"' : '') +
            (x[0] === 'odd' && !x[2] ? ' disabled' : '') + '>' + x[1] + '<span class="n">' + x[2] + '</span></button>';
        }).join('') + '</div>' +
      '<div class="pm-cr-waste" id="pm-cr-sum"></div></div>';
    if (flt === 'conv') rows = rows.filter(function (r) { return r._conv; });
    if (flt === 'none') rows = none.slice();
    if (flt === 'odd') rows = odd.slice();
    // 오른쪽 금액은 고른 거르기를 따른다: 그 행들의 광고비와 (매체 필터 기준) 전체 광고비 대비 비중
    var FLT_NAME = { all: '전체', conv: '전환 있음', none: '전환 없음', odd: '이상치' };
    var fCost = rows.reduce(function (a, r) { return a + (r.cost || 0); }, 0);
    var fPct = totCost ? fCost / totCost * 100 : 0;
    var sumHtml = totCost ? '<span class="l">' + FLT_NAME[flt] + ' 광고비</span><b>' + esc(pmWonShort(fCost)) + '</b>' +
      '<span class="t"><i style="width:' + (fCost ? Math.max(2, fPct) : 0).toFixed(1) + '%"></i></span>' +
      '<span class="p">광고비의 ' + Math.round(fPct) + '%</span>' : '';
    var st = VX.pm.crSort || (VX.pm.crSort = { k: 'cost', dir: -1 });
    rows.sort(function (a, b) {
      var x = a[st.k], y = b[st.k];
      if (x == null && y == null) return 0;
      if (x == null) return 1;                 // 값 없는 행은 방향과 무관하게 맨 뒤
      if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y, 'ko') : x - y) * st.dir;
    });
    var sl = pageSlice(rows, VX.pm.crPage || 1, VX.pm.crSize || 20);
    function cell(c, r) {
      var v = r[c.k];
      if (c.t === 'text') {   // 이름은 자르지 않고 두 줄로: 캠페인, 그 아래 매체·광고그룹
        return '<th class="pm-cr-nm"><span class="c">' + esc(r.campaign) +
          (r._hiCpi ? '<span class="pm-tag warn" tabindex="0" data-tip="' + esc('설치당 비용 ' + pmNum(r.cost / r.install) + '원, ' + r.channel + ' 평균 ' + pmNum(r._avgCpi) + '원의 ' + r._hiCpi.toFixed(0) + '배\n' +
            (r._ios ? 'iOS 캠페인은 앱 추적 동의 제한으로 설치가 적게 잡혀 성과 문제가 아닐 수 있습니다\n' : '') +
            '기준: 광고비 10만 원 이상, 설치당 비용이 같은 매체 평균의 5배 초과') + '">이상치</span>' : '') +
          '</span><span class="g">' + esc(r.channel) + ' · ' + esc(r.adGroup) + '</span></th>';
      }
      var txt;
      if (c.k === 'roas') return '<td class="key">' + pmRoasHtml(r._r) + '</td>';
      if (c.k === 'ctr') txt = v == null ? '-' : v.toFixed(2) + '%';
      else if (c.k === 'cpi') txt = pmNum(v);
      else txt = pmNum(v);
      return '<td class="' + (c.key ? 'key' : c.m ? 'mu' : '') + (c.opt ? ' opt' + c.opt : '') + '">' + txt + '</td>';
    }
    chips = chips.replace('<div class="pm-cr-waste" id="pm-cr-sum"></div>', '<div class="pm-cr-waste" id="pm-cr-sum">' + sumHtml + '</div>');
    host.innerHTML = chips +
      (rows.length ? '' : '<div class="vx-empty">해당하는 광고그룹이 없습니다.</div>') +
      '<div class="tl-table-wrap"' + (rows.length ? '' : ' hidden') + '><table class="tl-table pm-table pm-sort"><thead><tr>' +
      PM_CR_COLS.map(function (c) {
        var on = st.k === c.k;
        return '<th class="' + (c.t === 'text' ? 'tl-th-l' : '') + (c.key ? ' key' : '') + (c.opt ? ' opt' + c.opt : '') + (on ? ' on' : '') + '">' +
          '<button type="button" data-k="' + c.k + '">' + c.l +
          '<span class="ar">' + (on ? (st.dir < 0 ? '▼' : '▲') : '') + '</span></button></th>';
      }).join('') + '</tr></thead><tbody>' +
      sl.rows.map(function (r) { return '<tr>' + PM_CR_COLS.map(function (c) { return cell(c, r); }).join('') + '</tr>'; }).join('') +
      '</tbody></table></div>' + pagerHtml(sl, [10, 20, 50]);
    host.querySelectorAll('#pm-cr-flt [data-f]').forEach(function (b) {
      b.onclick = function () { VX.pm.crFilter = b.dataset.f; VX.pm.crPage = 1; renderCreatives(); };
    });
    host.querySelectorAll('thead [data-k]').forEach(function (b) {
      b.onclick = function (ev) {
        if (ev.target.classList.contains('ck-help')) return;   // 도움말 아이콘을 누른 것은 정렬이 아니다
        var k = b.dataset.k, col = PM_CR_COLS.filter(function (c) { return c.k === k; })[0];
        if (st.k === k) st.dir = -st.dir;
        else { st.k = k; st.dir = col.t === 'text' ? 1 : -1; }   // 숫자는 큰 값부터, 글자는 가나다순부터
        VX.pm.crPage = 1;
        renderCreatives();
      };
    });
    bindPager(host, sl,
      function (p) { VX.pm.crPage = p; renderCreatives(); scrollToCard(host); },
      function (n) { VX.pm.crSize = n; VX.pm.crPage = 1; renderCreatives(); });
  }

  // 매체별 성과: 한 표에 매체 행, 유형에 매체가 둘 이상이면 유형 소계, 맨 아래 합계.
  // 핵심 열(광고비·구매액·ROAS)은 열 전체에 옅은 배경, ROAS 는 순매출 기준으로 100% 넘으면 강조, 보조 지표는 회색
  function pmNum(v) { return (v == null || isNaN(v)) ? '-' : Math.round(v).toLocaleString(); }
  function pmPer(r, v) { return r.cost ? pmNum(v) : '-'; }   // 광고비가 없으면 단가를 말할 수 없다
  var PM_COLS = [
    ['광고비(원)', 'cost'],
    ['순매출(원)', 'net'],   // 순매출 = 구매액 × 순매출률. 광고비·순매출·ROAS(순매출) 가 나란히 분모·분자·결과
    ['ROAS(순매출)', 'roas'],
    ['ROAS(구매액)', pmRoasGross, 1, 2],
    ['설치', function (r) { return fmtN(r.install); }],
    ['설치당(원)', function (r) { return pmPer(r, r.cpi); }, 1, 1],
    ['가입', function (r) { return fmtN(r.signup); }],
    ['가입당(원)', function (r) { return pmPer(r, r.cpaSignup); }, 1, 1],
    ['결제', function (r) { return fmtN(r.purchase); }],
    ['결제당(원)', function (r) { return pmPer(r, r.cpaPurchase); }],
    ['클릭률', function (r) { return r.ctr == null ? '-' : r.ctr.toFixed(2) + '%'; }, 1, 2]
  ];

  function renderPmChannels() {
    var d = VX.pm.data;
    var host = $id('pm-channels');
    var chs = d.channels || [];
    if (!chs.length) { host.innerHTML = '<div class="vx-empty">이 기간에 유료 매체 데이터가 없습니다.</div>'; return; }
    function cells(r) {
      return PM_COLS.map(function (c) {
        if (c[1] === 'cost') return '<td class="key">' + pmNum(r.cost) + '</td>';
        // 매출액은 ROAS 칸과 같은 값에서 나온다(ROAS × 광고비). 광고비가 없으면 구매액 × 순매출률
        if (c[1] === 'net') return '<td class="key">' + pmNum(r.cost && r.roasNet != null ? r.roasNet * r.cost / 100 : (r.revenue || 0) * pmTake()) + '</td>';
        if (c[1] === 'roas') return '<td class="key">' + pmRoasHtml(r) + '</td>';
        return '<td class="' + (c[2] ? 'mu' : '') + (c[3] ? ' opt' + c[3] : '') + '">' + c[1](r) + '</td>';
      }).join('');
    }
    var html = '';
    var types = (d.types || []).map(function (t) { return t.type; });
    chs.forEach(function (c) { if (types.indexOf(c.type) < 0) types.push(c.type); });
    types.forEach(function (tk) {
      var list = chs.filter(function (c) { return c.type === tk; });
      if (!list.length) return;
      var grouped = list.length > 1;
      if (grouped) {
        var t = (d.types || []).filter(function (x) { return x.type === tk; })[0] || {};
        html += '<tr class="pm-grp"><th>' + esc(t.typeLabel || tk) + '</th>' + cells(t) + '</tr>';
      }
      list.forEach(function (c) {
        var chips = '';
        // 유형 태그는 두지 않는다(매체가 하나뿐인 유형만 붙어 들쭉날쭉했다). 유형은 매체 관리에서 본다
        if (c.unmapped) chips += '<span class="pm-tag warn" data-tip="매체 분류표에 없는 채널입니다\n광고비가 잡혀 유료 매체로 넣었습니다">분류 미등록</span>';
        // 연동 / 수기 입력 두 가지만. 수기 입력은 예산 창에서 광고비(수기 매체는 구매액까지)을 넣는 매체
        // 광고비를 손으로 넣어야 하는데 아직 비어 있는 매체만 '입력 필요'. 누르면 예산 창이 그 매체 카드에서 수정 상태로 열린다
        if (!c.manualCost && (c.manual || (!c.cost && (c.install || c.purchase) && d.to < ymd(kstToday())))) {
          chips += '<button type="button" class="pm-st m pm-need" data-need="' + esc(c.channel) + '">' + PM_IC_PEN + '입력 필요</button>';
        }
        html += '<tr class="pm-ch' + (grouped ? ' in' : '') + '" data-ch="' + esc(c.channel) + '" data-lb="' + esc(c.label || c.channel) + '">' +
          '<th><span class="nm">' + esc(c.label || c.channel) + '</span>' + chips + '</th>' +
          cells(c) + '</tr>';
      });
    });
    html += '<tr class="pm-tot"><th>합계</th>' + cells(d.summary || {}) + '</tr>';
    host.innerHTML = '<div class="tl-table-wrap"><table class="tl-table pm-table"><thead><tr><th class="tl-th-l">매체</th>' +
      PM_COLS.map(function (c) {
        return '<th class="' + (typeof c[1] === 'string' ? 'key' : (c[2] ? 'mu' : '')) + (c[3] ? ' opt' + c[3] : '') + '">' + c[0] +
          '</th>';
      }).join('') + '</tr></thead><tbody>' + html + '</tbody></table></div>';
    // 매체 행을 누르면 아래 캠페인별 성과를 그 매체로 거른다. 같은 행을 다시 누르면 전체로
    var sel = $id('pm-cr-ch');
    host.querySelectorAll('tr.pm-ch').forEach(function (tr) {
      tr.classList.toggle('sel', !!sel && sel.value === tr.dataset.ch);
      tr.onclick = function () {
        if (!sel) return;
        sel.value = sel.value === tr.dataset.ch ? '' : tr.dataset.ch;
        host.querySelectorAll('tr.pm-ch').forEach(function (x) { x.classList.toggle('sel', sel.value === x.dataset.ch); });
        VX.pm.crPage = 1;
        loadCreatives();
        var card = $id('pm-creatives').closest('.vx-card');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
    host.querySelectorAll('[data-need]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        if (VX.pm.month && VX.pm.month.ok) openBudgetEditor(b.dataset.need);
      };
    });
  }

  // ───────────────────── 초기화 ─────────────────────
  function applyPmLock() {
    // 퍼마 타일에 자물쇠 표시 (비권한자)
    var tile = document.querySelector('.side-nav-tile[data-vt="pm"]');
    if (tile && VX.isAdmin === false && !tile.querySelector('.nav-lock')) {
      var lk = document.createElement('span');
      lk.className = 'nav-lock'; lk.textContent = '🔒'; lk.title = '권한 필요';
      tile.appendChild(lk);
    }
  }

  function init() {
    document.querySelectorAll('.side-nav-tile').forEach(function (b) {
      b.onclick = function () { switchTopView(b.dataset.vt); };
    });
    var v = 'crm';
    try { v = new URL(location.href).searchParams.get('view') || 'crm'; } catch (e) { /* noop */ }
    // 권한 먼저 확인 후 뷰 진입 (배너 편집·퍼마 접근 제어)
    fetchJson('/api/me').then(function (me) {
      VX.isAdmin = !!(me && me.ok && me.isBannerAdmin);
      VX.email = (me && me.email) || '';
      applyPmLock();
      if (v !== 'crm') switchTopView(v, true);
    }).catch(function () {
      VX.isAdmin = false; applyPmLock();
      if (v !== 'crm') switchTopView(v, true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
