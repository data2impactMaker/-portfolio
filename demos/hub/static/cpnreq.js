/* 쿠폰 운영 화면: 대시보드 다섯 번째 화면(?view=cpnreq). 현황(기본: 쿠폰 현황 → 신청 현황) · 요청 폼(&cr=new) · 요청 상세(&cpn=<id>).
 * views_ext.js 가 처음 열 때 CpnReq.mount(#view-cpnreq) 를 부른다. CRM 요청 화면과 같은 섀도 DOM 구조이고,
 * 카드 · 폼 · 목록 모양은 msgreq.css 를 그대로 불러 쓴다. 쿠폰 화면에만 있는 모양은 cpnreq.css.
 * 서버는 coupon_requests.py (/api/cpnreq/*). 검증 규칙의 기준은 서버이고, 화면은 그중 자주 걸리는 것을 미리 보여 준다.
 * 폼 상태는 F 한 곳에 두고, 선택 클릭은 폼 전체를 다시 그리고 글자 입력은 요약 · 오류 줄만 갱신한다. */
window.CpnReq = (function () {
  'use strict';

  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || 'static/cpnreq.js';
  var BASE_CSS = SCRIPT_SRC.replace(/cpnreq\.js(\?.*)?$/, 'msgreq.css');
  var OWN_CSS = SCRIPT_SRC.replace(/cpnreq\.js(\?.*)?$/, 'cpnreq.css');
  var host = null, R = null, view = null, toastEl = null, head = null;
  var WD = '일월화수목금토';
  var DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = String(s).slice(0, 10).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function md(s) { if (!s) return ''; var d = parse(s); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ')'; }
  function stamp(s) {
    if (!s) return '';
    var d = new Date(s);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function num(v) { var s = String(v == null ? '' : v).replace(/,/g, '').trim(); return /^\d+$/.test(s) ? Number(s) : null; }
  function comma(n) { return n == null || n === '' ? '' : Number(n).toLocaleString('ko-KR'); }
  function won(n) { return n == null || n === '' ? '-' : comma(n) + '원'; }
  function newKey() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

  var B = null;
  var F = blankForm();
  var U = { route: 'list', submitting: false, done: null, list: null, filter: '전체', q: '', page: 1,
            problems: [], warnings: [], pending: [], kw: null, lots: null, gaps: [], submitKey: newKey(),
            editId: null, editName: '', coupons: null, rank: undefined, stats: {}, statDays: 30, statAll: false, tlOpen: false, detail: null, pendingCnt: 0 };

  function blankForm() {
    return {
      team: '', couponName: '', purpose: '', neededBy: '', approvalDoc: '', planDoc: '', basedOn: '',
      publicationType: '', keyword: '', uniqueBy: 'USER', publicationMaximum: '', testQuantity: '',
      publicationStart: '', publicationEnd: '',
      usageDateType: 'STATIC', usageStart: '', usageEnd: '', usageDays: '',
      dayOfWeek: DAYS.slice(), usageMaximum: '1', minimumPrice: '0', limitType: 'NONE', parkinglots: '',
      pricingType: '', price: '', ratio: '', maxDiscount: '', caution: '', note: '',
    };
  }

  // ───────────── 공통 ─────────────
  function api(url, opt) {
    opt = opt || {};
    opt.credentials = 'same-origin';
    opt.headers = Object.assign({ 'X-Requested-With': 'XMLHttpRequest' }, opt.headers || {});
    if (opt.json !== undefined) {
      opt.method = opt.method || 'POST';
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(opt.json);
      delete opt.json;
    }
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (body) {
        if (!r.ok) {
          var e = new Error((body && body.error) || ('http_' + r.status));
          e.body = body || {};
          e.status = r.status;
          throw e;
        }
        return body;
      });
    });
  }
  var ERR = {
    invalid: '고칠 항목이 있어요', login_required: '로그인이 필요해요', editor_only: '편집자 명단 등록자만 할 수 있어요',
    busy: '동시에 저장이 몰렸어요. 잠시 뒤 다시 시도해 주세요', not_found: '요청을 찾지 못했어요',
    coupon_not_found: '그 번호의 쿠폰이 없거나 삭제됐어요', lookup_failed: '운영 DB를 조회하지 못했어요. 잠시 뒤 다시 시도해 주세요',
    not_configured: '이 기능은 지금 쓸 수 없어요', reason_required: '사유를 적어 주세요',
    done_by_verify: '세팅 완료는 세팅 대조를 거쳐 「세팅 완료」 버튼으로 처리해요',
    approval_required: '기안 번호를 적어 주세요. 기안 없이 세팅 완료할 수 없어요',
    verify_required: '이 쿠폰 번호로 먼저 세팅 대조를 해 주세요', verify_stale: '대조한 뒤 요청서가 바뀌었어요. 다시 대조해 주세요',
    verify_mismatch: '요청과 다른 항목이 있어요. 어드민을 고치거나 사유를 적어 주세요',
    closed: '세팅 완료 · 반려된 요청은 바꿀 수 없어요', locked_after_review: '검토가 시작된 요청은 기획운영팀이 수정해요',
    editor_or_requester_only: '요청자나 편집자만 할 수 있어요', nothing_to_update: '바뀐 내용이 없어요',
    submit_key_conflict: '같은 요청이 다른 내용으로 이미 접수됐어요. 새로 고친 뒤 다시 제출해 주세요',
    keyword_format: '키워드는 영문 대문자 · 숫자로 4자에서 20자(구분자는 _ - 만)', invalid_field: '입력값을 다시 확인해 주세요',
  };
  function errText(e) {
    var b = (e && e.body) || {};
    if (b.error === 'invalid' && (b.problems || []).length) return '고칠 항목이 ' + b.problems.length + '개 있어요';
    return ERR[b.error] || ERR[e && e.message] || '처리하지 못했어요. 잠시 뒤 다시 시도해 주세요';
  }
  var toastTimer = null;
  function toast(msg, bad) {
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (bad ? ' bad' : '');
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2800);
  }
  function opts(k) { return (B && B.options && B.options[k]) || []; }
  function labelOf(k, v) { var o = opts(k).filter(function (x) { return x.value === v; })[0]; return o ? o.label : ''; }
  function stClass(s) { return 's-' + (s === '세팅 완료' ? '완료' : s); }
  function copyText(t) {
    var done = function () { toast('세팅표를 복사했어요'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, function () { toast('복사하지 못했어요', true); });
    else toast('이 브라우저는 복사를 지원하지 않아요', true);
  }

  // ───────────── 폼 조각 ─────────────
  var REQ = '<span class="req">*</span>';
  function frow(label, inner, req, field, hint) {
    return '<div class="frow"><div class="fl">' + esc(label) + (req ? REQ : '') + '</div><div class="fv">' + inner +
      (hint ? '<div class="hint">' + hint + '</div>' : '') +
      (field ? '<div class="err-line" data-err="' + field + '"></div>' : '') + '</div></div>';
  }
  function optTx(k, v, name, sub) {
    var on = F[k] === v;
    return '<button type="button" class="opt tx' + (on ? ' on' : '') + '" data-act="set" data-k="' + k + '" data-v="' + esc(v) + '">' +
      (on ? '<span class="ck">✓</span>' : '') + '<span><span class="nm">' + esc(name) + '</span>' + (sub ? '<span class="sb">' + esc(sub) + '</span>' : '') + '</span></button>';
  }
  function choices(k, list, cls) {
    return '<div class="opts ' + (cls || 'fx3') + '">' + list.map(function (o) { return optTx(k, o.value, o.label, o.sub); }).join('') + '</div>';
  }
  function input(bind, ph, extra) {
    return '<input class="inp" data-bind="' + bind + '" value="' + esc(F[bind]) + '" placeholder="' + esc(ph || '') + '"' + (extra || '') + '>';
  }
  function numIn(bind, unit, ph) {
    return '<div class="inp-suf"><input class="inp" inputmode="numeric" data-bind="' + bind + '" value="' + esc(F[bind]) + '" placeholder="' + esc(ph || '') + '"><span>' + esc(unit) + '</span></div>';
  }
  function dateIn(bind) { return '<input type="date" class="inp" data-bind="' + bind + '" value="' + esc(F[bind]) + '">'; }
  function area(bind, ph, rows) {
    return '<textarea class="inp" rows="' + (rows || 3) + '" data-bind="' + bind + '" placeholder="' + esc(ph || '') + '">' + esc(F[bind]) + '</textarea>';
  }

  // ───────────── 화면에서 미리 보는 검사(서버 규칙의 일부) ─────────────
  // 받침 유무로 을/를 · 은/는 를 고른다(서버 coupon_requests.josa 와 같은 규칙)
  function josa(word, pair) {
    var c = word.charCodeAt(word.length - 1) - 0xAC00, two = pair.split('/');
    return word + (c >= 0 && c <= 11171 && c % 28 !== 0 ? two[0] : two[1]);
  }
  function localProblems() {
    var p = {}, t = (B && B.today) || '';
    function need(k, label) { if (String(F[k] == null ? '' : F[k]).trim() === '') p[k] = josa(label, '을/를') + ' 입력해 주세요'; }
    function int(k, label, min) {
      var raw = String(F[k] == null ? '' : F[k]).trim();
      if (raw === '') return;
      var n = num(raw);
      if (n === null) p[k] = josa(label, '은/는') + ' 숫자로만 적어 주세요';
      else if (min != null && n < min) p[k] = josa(label, '은/는') + ' ' + comma(min) + ' 이상이어야 해요';
    }
    need('team', '요청팀'); need('couponName', '쿠폰 이름'); need('purpose', '목적'); need('neededBy', '희망 세팅일');
    if (F.neededBy && t && F.neededBy < t) p.neededBy = '희망 세팅일이 이미 지났어요';
    if (!F.publicationType) p.publicationType = '발급 방식을 골라 주세요';
    if (F.publicationType === 'KEYWORD') {
      if (!F.keyword.trim()) p.keyword = '키워드를 입력해 주세요';
      else if (!/^[A-Za-z0-9_-]{4,20}$/.test(F.keyword.trim())) p.keyword = ERR.keyword_format + '. 한글은 딥링크에서 깨져요';
      else if (U.kw && U.kw.code === F.keyword.trim() && U.kw.res && U.kw.res.checked && !U.kw.res.free) p.keyword = '이미 쓴 키워드예요. 새 키워드를 정해 주세요';
    }
    need('publicationMaximum', '총 발행량'); int('publicationMaximum', '총 발행량', 1); int('testQuantity', '테스트 수량', 0);
    if (!p.publicationMaximum && num(F.testQuantity) > num(F.publicationMaximum)) p.testQuantity = '테스트 수량이 총 발행량보다 많아요';
    need('publicationStart', '발급 시작일'); need('publicationEnd', '발급 종료일');
    if (F.publicationStart && F.publicationEnd && F.publicationEnd < F.publicationStart) p.publicationEnd = '발급 종료일이 시작일보다 빨라요';
    if (F.usageDateType === 'STATIC') {
      need('usageStart', '사용 시작일'); need('usageEnd', '사용 종료일');
      if (F.usageStart && F.usageEnd && F.usageEnd < F.usageStart) p.usageEnd = '사용 종료일이 시작일보다 빨라요';
    } else { need('usageDays', '발급 후 사용 일수'); int('usageDays', '발급 후 사용 일수', 1); }
    if (!F.dayOfWeek.length) p.dayOfWeek = '사용 요일을 하나 이상 골라 주세요. 요일이 없으면 결제 화면에 쿠폰이 뜨지 않아요';
    need('usageMaximum', '사용 가능 횟수'); int('usageMaximum', '사용 가능 횟수', 1);
    need('minimumPrice', '최소 결제 금액'); int('minimumPrice', '최소 결제 금액', 0);
    if (F.limitType === 'PARKINGLOT' && !(F.parkinglots.match(/\d+/g) || []).length) p.parkinglots = '주차장 번호를 한 개 이상 적어 주세요. 목록이 비면 어느 주차장에서도 못 써요';
    if (!F.pricingType) p.pricingType = '할인 방식을 골라 주세요';
    if (F.pricingType === 'STATIC') { need('price', '할인 금액'); int('price', '할인 금액', 1); }
    if (F.pricingType === 'RATIO') {
      need('ratio', '할인율');
      var r = num(F.ratio);
      if (F.ratio !== '' && (r === null || r < 1 || r > 100)) p.ratio = '할인율은 1에서 100 사이로 적어 주세요';
      if (!num(F.maxDiscount)) p.maxDiscount = '퍼센트 할인은 최대 할인 금액이 꼭 필요해요';   // 왜 필요한지는 바로 아래 예시 상자가 숫자로 보여 준다
    }
    need('caution', '유의사항');
    return p;
  }
  // 서버가 돌려준 문제는 그 칸을 다시 고칠 때까지 보인다(키워드 · 주차장처럼 조회가 필요한 검사)
  function allProblems() {
    var p = localProblems();
    (U.problems || []).forEach(function (x) { if (x.field && !p[x.field]) p[x.field] = x.msg; });
    return p;
  }
  function paintErrors() {
    var p = allProblems();
    R.querySelectorAll('[data-err]').forEach(function (el) { el.textContent = (U.touched || {})[el.dataset.err] || U.showAll ? (p[el.dataset.err] || '') : ''; });
    return p;
  }

  // ───────────── 폼 절 ─────────────
  function secInfo() {
    var me = B.me || {}, teams = me.teams || [];
    if (!F.team && teams.length === 1) F.team = teams[0];
    var team = U.editId ? '<div class="hint" style="margin-top:10px"><b>' + esc(F.team) + '</b> · 요청 당시 팀</div>' : teams.length > 1
      ? '<div class="chips">' + teams.map(function (t) { return '<button type="button" class="chip' + (F.team === t ? ' on' : '') + '" data-act="set" data-k="team" data-v="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</div>'
      : (teams.length ? '<div class="hint" style="margin-top:10px"><b>' + esc(teams[0]) + '</b> · ' + esc(me.nickname || '') + '</div>' : input('team', '요청팀 이름'));
    var pre = (B.options.namePrefixes || []).map(function (x) { return '<button type="button" class="chip" data-act="prefix" data-v="' + esc(x) + '">[' + esc(x) + ']</button>'; }).join('');
    var load = '<div class="load-bar"><div><div class="nm">이전 쿠폰 불러오기</div><div class="sb">재발행이면 쿠폰 번호로 설정을 채워요. 기간 · 수량 · 키워드는 새로 적어요</div></div>' +
      '<div class="row-btn"><input class="inp" inputmode="numeric" id="load-id" placeholder="쿠폰 번호" value="' + esc(F.basedOn) + '"><button type="button" class="btn-ghost" data-act="load">불러오기</button></div></div>' +
      (U.gaps.length ? '<div class="notes" style="margin:-6px 0 14px">' + U.gaps.map(function (g) { return '<div class="note-i bad">' + esc(g) + '</div>'; }).join('') + '</div>' : '');
    return load +
      frow('요청팀', team, true, 'team') +
      frow('쿠폰 이름', input('couponName', '[이벤트] 롯데면세점 공항주차대행 할인쿠폰', ' maxlength="80"') + '<div class="chips" style="margin-top:8px">' + pre + '</div>', true, 'couponName',
        '앱 쿠폰함에 그대로 보여요. 앞에 [분류] 를 붙이면 어드민에서 찾기 쉬워요') +
      frow('목적', area('purpose', '예: 9월 연휴 공항 주차 수요 선점 · 제휴사 회원 대상 배포', 2), true, 'purpose') +
      frow('희망 세팅일', dateIn('neededBy'), true, 'neededBy', '어드민 등록을 마쳐야 하는 날이에요. 발급 시작일보다 하루 이상 앞이면 테스트할 수 있어요') +
      frow('기안 번호', input('approvalDoc', '그룹웨어 문서번호 또는 링크', ' maxlength="200"'), false, 'approvalDoc', '결재 전이어도 접수할 수 있어요. 세팅 완료 전에는 꼭 필요해요') +
      frow('기획안', input('planDoc', '기획안 · 추가 자료 링크', ' maxlength="300"'), false, 'planDoc');
  }
  function kwLine() {
    var k = U.kw;
    if (!k || k.code !== F.keyword.trim()) return '';
    if (k.state === 'loading') return '<div class="chk-line unk">조회하는 중</div>';
    var r = k.res || {};
    if (!r.checked) return '<div class="chk-line unk">' + esc(r.msg || '조회하지 못했어요. 세팅 담당이 등록 전에 확인해요') + '</div>';
    if (r.free) return '<div class="chk-line ok">쓴 적 없는 키워드예요</div>';
    return '<div class="chk-line bad">이미 쓴 키워드예요 · ' + esc((r.usedBy || []).map(function (u) { return u.couponId + '번 ' + u.name + (u.remaining ? ' (남은 코드 ' + comma(u.remaining) + ')' : ''); }).join(' · ')) + '</div>';
  }
  function secPub() {
    var kw = F.publicationType === 'KEYWORD'
      ? frow('키워드', '<div class="row-btn">' + input('keyword', '예: BUSANJS2510', ' maxlength="20" autocapitalize="characters"') +
        '<button type="button" class="btn-ghost" data-act="kw">사용 이력 확인</button></div><div id="kw-line">' + kwLine() + '</div>', true, 'keyword',
        '지역 + 주차장 + 연월을 영문 대문자 · 숫자로(예: BUSANJS2510). 한 번 쓴 키워드는 다시 쓰지 않아요(옛 쿠폰 코드가 먼저 잡혀요)')
      : '';
    var maxHint = F.publicationType === 'RANDOM' ? '난수 코드는 이 수만큼 만들어져요. 1만 장이 넘으면 세팅 담당과 생성 시간을 맞춰 주세요'
      : '테스트 수량을 포함한 전체 수량이에요. 무제한은 1,000,000';
    return frow('발급 방식', choices('publicationType', opts('pubTypes')), true, 'publicationType') + kw +
      frow('발급 단위', choices('uniqueBy', opts('uniqueBy')), true, 'uniqueBy') +
      frow('총 발행량', numIn('publicationMaximum', '장', '1,000'), true, 'publicationMaximum', maxHint) +
      frow('테스트 수량', numIn('testQuantity', '장', '0'), false, 'testQuantity', '세팅 확인용으로 쓸 장수(총 발행량에 포함)') +
      frow('발급 기간', '<div class="two">' + dateIn('publicationStart') + '<span class="to">부터</span>' + dateIn('publicationEnd') + '<span class="to">까지</span></div><div class="err-line" data-err="publicationStart"></div>', true, 'publicationEnd',
        '시작일 0시부터 종료일 23:59:59까지 받을 수 있어요. 발급만 멈출 때는 사용중지 대신 종료일을 당겨요');
  }
  function daysChips() {
    var all = F.dayOfWeek.length === 7;
    return '<div class="chips"><button type="button" class="chip all' + (all ? ' on' : '') + '" data-act="days-all">전체</button>' +
      DAYS.map(function (d, i) { return '<button type="button" class="chip' + (F.dayOfWeek.indexOf(d) >= 0 ? ' on' : '') + '" data-act="day" data-v="' + d + '">' + '월화수목금토일'[i] + '</button>'; }).join('') + '</div>';
  }
  function lotsLine() {
    var l = U.lots;
    if (!l || l.text !== F.parkinglots) return '';
    if (l.state === 'loading') return '<div class="chk-line unk">조회하는 중</div>';
    var r = l.res || {}, names = (r.found && r.found.parkinglotNames) || {};
    var bad = (r.problems || []).filter(function (x) { return x.field === 'parkinglots'; });
    var warn = (r.warnings || []).filter(function (x) { return x.field === 'parkinglots'; });
    var pend = (r.pending || []).filter(function (x) { return x.field === 'parkinglots'; });
    var out = bad.map(function (x) { return '<div class="chk-line bad">' + esc(x.msg) + '</div>'; }).join('') +
      warn.map(function (x) { return '<div class="chk-line unk">' + esc(x.msg) + '</div>'; }).join('') +
      pend.map(function (x) { return '<div class="chk-line unk">' + esc(x.msg) + '</div>'; }).join('');
    var keys = Object.keys(names);
    if (!bad.length && !pend.length && keys.length) {
      out += '<div class="chk-line ok">모두 있는 번호예요 · ' + esc(keys.slice(0, 3).map(function (k) { return names[k]; }).join(', ')) + (keys.length > 3 ? ' 외' : '') + '</div>';
    }
    return out;
  }
  function secUsage() {
    var lots = (F.parkinglots.match(/\d+/g) || []).filter(function (x, i, a) { return a.indexOf(x) === i; });
    var period = F.usageDateType === 'STATIC'
      ? frow('사용 기간', '<div class="two">' + dateIn('usageStart') + '<span class="to">부터</span>' + dateIn('usageEnd') + '<span class="to">까지</span></div><div class="err-line" data-err="usageStart"></div>', true, 'usageEnd',
        '사용 기간은 발급할 때 쿠폰에 복사돼요. 등록 뒤에 바꿔도 이미 받은 쿠폰에는 반영되지 않아요')
      : frow('사용 일수', numIn('usageDays', '일', '14'), true, 'usageDays',
        num(F.usageDays) ? '받은 날 0시부터 ' + num(F.usageDays) + '일 뒤 23:59:59까지라 실제로는 <b>' + (num(F.usageDays) + 1) + '일</b> 동안 쓸 수 있어요' : '받은 날 0시부터 N일 뒤 23:59:59까지 쓸 수 있어요');
    var lotsRow = F.limitType === 'PARKINGLOT'
      ? frow('주차장 번호', area('parkinglots', '주차장 번호(parkinglotSeq)를 쉼표 · 줄바꿈으로. 예: 270696, 270697', 3) +
        '<div class="row-btn" style="margin-top:8px"><span class="hint" style="margin:0">' + lots.length + '곳</span><button type="button" class="btn-ghost" data-act="lots">번호 확인</button></div><div id="lots-line">' + lotsLine() + '</div>', true, 'parkinglots',
        '제휴주차장 번호만 써요. 주차장 제한은 이미 받은 쿠폰에도 바로 반영돼요')
      : '';
    return frow('기간 방식', choices('usageDateType', opts('dateTypes'), 'fx2'), true, 'usageDateType') + period +
      frow('사용 요일', daysChips(), true, 'dayOfWeek', F.dayOfWeek.length && F.dayOfWeek.length < 7 ? '고른 요일에만 결제 화면에 보여요' : '') +
      frow('사용 가능 횟수', numIn('usageMaximum', '회', '1'), true, 'usageMaximum',
        num(F.usageMaximum) > 1 ? '<b>등록 뒤에 바꿀 수 없어요.</b> 코드 1장으로 ' + num(F.usageMaximum) + '번 쓰는 설정이에요' : '쿠폰 1장을 몇 번 쓰는지. 등록 뒤에 바꿀 수 없어요') +
      frow('최소 결제 금액', numIn('minimumPrice', '원', '0'), true, 'minimumPrice') +
      frow('주차장 제한', choices('limitType', opts('limitTypes'), 'fx2'), true, 'limitType') + lotsRow;
  }
  function priceExample() {
    var t = F.pricingType;
    if (!t) return '';
    var min = num(F.minimumPrice) || 0, amt = Math.max(12000, min);
    if (t === 'STATIC') {
      var p = num(F.price);
      if (!p) return '';
      var d = Math.min(p, amt);
      return '<div class="ex">' + comma(amt) + '원 결제하면 <b>' + comma(d) + '원 할인</b> · ' + comma(amt - d) + '원 결제</div>';
    }
    var r = num(F.ratio), m = num(F.maxDiscount);
    if (!r) return '';
    if (!m) return '<div class="ex bad">최대 할인 금액이 비어 있으면 ' + comma(amt) + '원 결제에 <b>0원 할인</b>으로 결제되고 쿠폰만 사라져요</div>';
    var raw = Math.round(amt * r / 100), dd = Math.min(raw, m);
    return '<div class="ex">' + comma(amt) + '원 결제하면 ' + r + '% = ' + comma(raw) + '원' + (raw > m ? ' → 최대 ' + comma(m) + '원' : '') +
      ' · <b>' + comma(dd) + '원 할인</b></div>';
  }
  function secPricing() {
    var body = F.pricingType === 'STATIC'
      ? frow('할인 금액', numIn('price', '원', '3,000'), true, 'price')
      : F.pricingType === 'RATIO'
        ? frow('할인율', numIn('ratio', '%', '50'), true, 'ratio') +
          frow('최대 할인 금액', numIn('maxDiscount', '원', '5,000'), true, 'maxDiscount', '퍼센트 쿠폰은 이 금액까지만 할인해요. <b>비우면 할인 0원</b>(1814번 사고)')
        : '';
    return frow('할인 방식', choices('pricingType', opts('pricingTypes'), 'fx2'), true, 'pricingType') + body + '<div id="px">' + priceExample() + '</div>';
  }
  function secText() {
    return frow('유의사항', area('caution', '쿠폰 상세에 그대로 보여요', 5) +
      '<div style="margin-top:8px"><button type="button" class="btn-ghost" data-act="caution">설정으로 기본 문구 만들기</button></div>', true, 'caution',
      '기존 쿠폰들의 문장 틀로 채워요. 주차장 제한 · 최소 금액 · 사용 횟수를 고친 뒤 다시 누르면 다시 만들어요') +
      frow('요청 메모', area('note', '세팅 담당에게 남길 말(배포 경로 · 제휴사 연락처 · 테스트 계정 등)', 2), false, 'note');
  }
  function kvv(k, v, req) {
    var on = v !== '' && v != null;
    return '<div class="kv has-st' + (!on && req ? ' need' : '') + '"><i class="kv-st' + (on ? ' on' : (req ? ' req' : '')) + '"></i><span>' + esc(k) + '</span><b title="' + esc(on ? v : '') + '">' + (on ? esc(v) : '<em class="miss-dash' + (req ? ' req' : '') + '">미입력</em>') + '</b></div>';
  }
  function dayText(list) {
    if (list.length === 7) return '전체';
    return DAYS.filter(function (d) { return list.indexOf(d) >= 0; }).map(function (d) { return '월화수목금토일'[DAYS.indexOf(d)]; }).join('·');
  }
  // 지금 고른 방식에서 필수인 칸 수(진행 막대의 분모)
  function requiredCount() {
    var n = 15;   // 요청팀 · 이름 · 목적 · 희망일 · 발급 방식 · 단위 · 총 발행량 · 발급 시작 · 종료 · 요일 · 횟수 · 최소 금액 · 주차장 제한 · 할인 방식 · 유의사항
    if (F.publicationType === 'KEYWORD') n += 1;
    n += F.usageDateType === 'STATIC' ? 2 : 1;
    if (F.limitType === 'PARKINGLOT') n += 1;
    n += F.pricingType === 'RATIO' ? 2 : (F.pricingType === 'STATIC' ? 1 : 0);
    return n;
  }
  var SEC_OF = { team: 'info', couponName: 'info', purpose: 'info', neededBy: 'info', approvalDoc: 'info',
    publicationType: 'pub', keyword: 'pub', uniqueBy: 'pub', publicationMaximum: 'pub', testQuantity: 'pub', publicationStart: 'pub', publicationEnd: 'pub',
    usageDateType: 'usage', usageStart: 'usage', usageEnd: 'usage', usageDays: 'usage', dayOfWeek: 'usage', usageMaximum: 'usage', minimumPrice: 'usage', limitType: 'usage', parkinglots: 'usage',
    pricingType: 'pricing', price: 'pricing', ratio: 'pricing', maxDiscount: 'pricing', caution: 'text', note: 'text' };
  var LABELS = { team: '요청팀', couponName: '쿠폰 이름', purpose: '목적', neededBy: '희망 세팅일', publicationType: '발급 방식', keyword: '키워드',
    uniqueBy: '발급 단위', publicationMaximum: '총 발행량', testQuantity: '테스트 수량', publicationStart: '발급 시작일', publicationEnd: '발급 종료일',
    usageStart: '사용 시작일', usageEnd: '사용 종료일', usageDays: '사용 일수', dayOfWeek: '사용 요일', usageMaximum: '사용 가능 횟수',
    minimumPrice: '최소 결제 금액', parkinglots: '주차장 번호', pricingType: '할인 방식', price: '할인 금액', ratio: '할인율', maxDiscount: '최대 할인 금액', caution: '유의사항' };
  function secSummary() {
    var p = allProblems(), keys = Object.keys(p);
    var total = requiredCount(), done = Math.max(total - keys.length, 0), pct = Math.round(done / total * 100);
    var head = '<div class="sm-head"><div class="sm-prog"><div class="sm-pt">' + (keys.length ? '<b>고칠 항목 ' + keys.length + '개</b>가 남았어요' : '<b>제출할 수 있어요</b>') +
      '</div><div class="sm-bar"><i style="width:' + pct + '%"></i></div></div>' +
      (keys.length ? '<div class="sm-miss">' + keys.map(function (k) { return '<button type="button" data-act="jump" data-v="' + (SEC_OF[k] || 'info') + '" data-f="' + k + '">' + esc(LABELS[k] || k) + '</button>'; }).join('') + '</div>' : '') + '</div>';
    function card(no, title, sec, body) {
      return '<div class="sc"><div class="sc-h"><span class="sc-no">' + no + '</span>' + esc(title) + '<button type="button" data-act="jump" data-v="' + sec + '">수정</button></div>' + body + '</div>';
    }
    var lots = (F.parkinglots.match(/\d+/g) || []).filter(function (x, i, a) { return a.indexOf(x) === i; });
    var usage = F.usageDateType === 'STATIC' ? (F.usageStart && F.usageEnd ? md(F.usageStart) + ' 부터 ' + md(F.usageEnd) + ' 까지' : '')
      : (num(F.usageDays) ? '발급 후 ' + num(F.usageDays) + '일' : '');
    var disc = F.pricingType === 'RATIO' ? (num(F.ratio) ? F.ratio + '%' + (num(F.maxDiscount) ? ' · 최대 ' + won(num(F.maxDiscount)) : '') : '')
      : (num(F.price) ? won(num(F.price)) : '');
    var cards = '<div class="sum">' +
      card('01', '기본 정보', 'info', kvv('쿠폰 이름', F.couponName, true) + kvv('유의사항', F.caution ? F.caution.split('\n')[0] + (F.caution.indexOf('\n') > 0 ? ' 외' : '') : '', true) + kvv('희망 세팅일', F.neededBy ? md(F.neededBy) : '', true)) +
      card('02', '발급', 'pub', kvv('발급 방식', labelOf('pubTypes', F.publicationType) + (F.keyword && F.publicationType === 'KEYWORD' ? ' · ' + F.keyword : ''), true) +
        kvv('발급 단위', labelOf('uniqueBy', F.uniqueBy), true) + kvv('총 발행량', num(F.publicationMaximum) ? comma(num(F.publicationMaximum)) + '장' : '', true) +
        kvv('발급 기간', F.publicationStart && F.publicationEnd ? md(F.publicationStart) + ' 부터 ' + md(F.publicationEnd) + ' 까지' : '', true)) +
      card('03', '사용', 'usage', kvv('사용 기간', usage, true) + kvv('사용 요일', F.dayOfWeek.length ? dayText(F.dayOfWeek) : '', true) +
        kvv('사용 가능 횟수', num(F.usageMaximum) ? num(F.usageMaximum) + '회' : '', true) + kvv('최소 결제', F.minimumPrice !== '' ? won(num(F.minimumPrice)) : '', true) +
        kvv('주차장', F.limitType === 'PARKINGLOT' ? (lots.length ? lots.length + '곳' : '') : '제한 없음', true)) +
      card('04', '할인', 'pricing', kvv('할인 방식', labelOf('pricingTypes', F.pricingType), true) + kvv('혜택', disc, true)) + '</div>';
    var notes = '';
    if ((U.warnings || []).length || (U.pending || []).length) {
      notes = '<div class="notes" style="margin-top:12px">' + (U.warnings || []).map(function (w) { return '<div class="note-i"><b>안내</b>' + esc(w.msg) + '</div>'; }).join('') +
        (U.pending || []).map(function (w) { return '<div class="note-i pend"><b>접수 후 확인</b>' + esc(w.msg) + '</div>'; }).join('') + '</div>';
    }
    return head + cards + notes + '<div class="submit" style="gap:8px"><button type="button" class="btn-ghost" data-act="precheck"' + (U.submitting ? ' disabled' : '') + '>제출 전 점검</button>' +
      '<button type="button" class="btn-co lg" data-act="submit"' + (keys.length || U.submitting ? ' disabled' : '') + '>' +
      (U.submitting ? (U.editId ? '저장하는 중' : '제출하는 중') : (U.editId ? '수정 저장' : '요청 제출')) + '</button></div>';
  }

  var SECTIONS = [
    ['info', '요청 정보', secInfo],
    ['pub', '발급', secPub],
    ['usage', '사용 조건', secUsage],
    ['pricing', '할인', secPricing],
    ['text', '안내 문구', secText],
    ['summary', '요약 확인 · 제출', secSummary],
  ];
  var SUBS = { info: '어드민 「할인쿠폰 등록」 화면과 같은 순서로 받아요', summary: '세팅 담당이 이 순서대로 어드민에 입력해요' };

  function renderForm() {
    if (U.done) { renderDone(); return; }
    var html = U.editId ? '<div class="edit-bar"><span><b>요청 수정 중</b> ' + esc(U.editName) + '</span><button type="button" class="btn-ghost" data-act="edit-cancel">수정 취소</button></div>' : '';
    SECTIONS.forEach(function (s, i) {
      html += '<section class="step" id="st-' + s[0] + '"><div class="st-h"><span class="st-no">' + pad(i + 1) + '</span><h2>' + esc(s[1]) + '</h2>' +
        (SUBS[s[0]] ? '<span class="st-sub">' + esc(SUBS[s[0]]) + '</span>' : '') + '</div><div class="st-b">' + s[2]() + '</div></section>';
    });
    view.innerHTML = html;
    paintErrors();
  }
  // 글자 입력: 폼 전체를 다시 그리지 않고(입력 중 커서 유지) 오류 줄 · 요약 · 예시만 바꾼다
  function refreshLive(field) {
    U.problems = (U.problems || []).filter(function (x) { return x.field !== field; });
    var sum = R.querySelector('#st-summary .st-b'); if (sum) sum.innerHTML = secSummary();
    var px = R.getElementById('px'); if (px) px.innerHTML = priceExample();
    var kl = R.getElementById('kw-line'); if (kl) kl.innerHTML = kwLine();
    var ll = R.getElementById('lots-line'); if (ll) ll.innerHTML = lotsLine();
    paintErrors();
  }

  function payload() {
    var o = {};
    Object.keys(F).forEach(function (k) { o[k] = typeof F[k] === 'string' ? F[k].trim() : F[k]; });
    o.submitKey = U.submitKey;
    return o;
  }
  function applyServer(body) {
    U.problems = body.problems || [];
    U.warnings = body.warnings || [];
    U.pending = body.pending || [];
  }
  function jumpTo(sec, field) {
    var s = R.getElementById('st-' + sec);
    if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (field) { U.touched = U.touched || {}; U.touched[field] = true; paintErrors(); }
  }
  function firstProblem() {
    var p = allProblems(), k = Object.keys(p)[0];
    if (k) jumpTo(SEC_OF[k] || 'info');
  }
  function precheck() {
    U.showAll = true;
    api('/api/cpnreq/check', { json: payload() }).then(function (b) {
      applyServer(b);
      renderForm();
      if (b.ok) toast('막는 항목 없이 제출할 수 있어요');
      else { toast('고칠 항목이 ' + b.problems.length + '개 있어요', true); firstProblem(); }
    }).catch(function (e) { toast(errText(e), true); });
  }
  function submit() {
    U.showAll = true;
    if (Object.keys(allProblems()).length) { renderForm(); firstProblem(); return; }
    U.submitting = true; refreshLive('');
    var url = U.editId ? '/api/cpnreq/requests/' + encodeURIComponent(U.editId) + '/update' : '/api/cpnreq/requests';
    api(url, { json: payload() }).then(function (b) {
      U.submitting = false;
      if (U.editId) { var id = U.editId; cancelEdit(true); toast('수정을 저장했어요'); go('r:' + id); return; }
      U.done = { id: b.id, warnings: b.warnings || [], pending: b.pending || [], again: !!b.again, name: F.couponName };
      U.list = null;
      renderDone();
    }).catch(function (e) {
      U.submitting = false;
      if (e.body && e.body.error === 'invalid') { applyServer(e.body); renderForm(); firstProblem(); }
      else refreshLive('');
      toast(errText(e), true);
    });
  }
  function renderDone() {
    var d = U.done;
    view.innerHTML = '<div class="done"><h2>' + (d.again ? '이미 접수된 요청이에요' : '요청이 접수됐어요') + '</h2>' +
      '<p>발급 완료가 아니에요. 세팅 담당이 어드민에 등록하고 세팅 대조를 마치면 슬랙 스레드로 알려 드려요.<br>요청 번호 <b>' + esc(d.id) + '</b></p>' +
      (d.pending.length || d.warnings.length ? '<div class="notes" style="text-align:left;max-width:560px;margin:0 auto 18px">' +
        d.pending.map(function (w) { return '<div class="note-i pend"><b>접수 후 확인</b>' + esc(w.msg) + '</div>'; }).join('') +
        d.warnings.map(function (w) { return '<div class="note-i"><b>안내</b>' + esc(w.msg) + '</div>'; }).join('') + '</div>' : '') +
      '<div class="acts"><button type="button" class="btn-co" data-act="open" data-v="' + esc(d.id) + '">요청 상세 보기</button>' +
      '<button type="button" class="btn-ghost" data-act="new">새 요청 쓰기</button></div></div>';
  }
  function resetForm() {
    F = blankForm(); U.done = null; U.problems = []; U.warnings = []; U.pending = []; U.kw = null; U.lots = null;
    U.gaps = []; U.touched = {}; U.showAll = false; U.submitKey = newKey();
  }

  // ───────────── 조회 버튼 ─────────────
  function checkKeyword() {
    var code = F.keyword.trim();
    if (!/^[A-Za-z0-9_-]{4,20}$/.test(code)) { U.touched = U.touched || {}; U.touched.keyword = true; paintErrors(); return; }
    U.kw = { code: code, state: 'loading' }; refreshLive('keyword');
    api('/api/cpnreq/keyword?code=' + encodeURIComponent(code)).then(function (r) {
      U.kw = { code: code, state: 'done', res: r }; refreshLive('keyword');
    }).catch(function (e) { U.kw = { code: code, state: 'done', res: { checked: false, msg: errText(e) } }; refreshLive('keyword'); });
  }
  function checkLots() {
    var text = F.parkinglots;
    U.lots = { text: text, state: 'loading' }; refreshLive('parkinglots');
    api('/api/cpnreq/check', { json: payload() }).then(function (r) {
      U.lots = { text: text, state: 'done', res: r };
      U.problems = (U.problems || []).filter(function (x) { return x.field !== 'parkinglots'; }).concat((r.problems || []).filter(function (x) { return x.field === 'parkinglots'; }));
      refreshLive('');
    }).catch(function (e) { U.lots = null; refreshLive(''); toast(errText(e), true); });
  }
  function loadCoupon() {
    var el = R.getElementById('load-id'), id = num(el && el.value);
    if (!id) { toast('쿠폰 번호를 숫자로 적어 주세요', true); return; }
    api('/api/cpnreq/coupon/' + id).then(function (r) {
      var keep = { team: F.team, purpose: F.purpose, neededBy: F.neededBy, approvalDoc: F.approvalDoc, note: F.note };
      var f = r.form || {};
      Object.keys(f).forEach(function (k) { if (k in F) F[k] = Array.isArray(f[k]) ? f[k].slice() : String(f[k] == null ? '' : f[k]); });
      Object.assign(F, keep, { keyword: '', publicationMaximum: '', testQuantity: '', publicationStart: '', publicationEnd: '', usageStart: '', usageEnd: '' });
      U.gaps = r.gaps || []; U.problems = []; U.kw = null; U.lots = null;
      renderForm();
      toast(id + '번 설정을 불러왔어요. 기간 · 수량 · 키워드는 새로 적어 주세요');
    }).catch(function (e) { toast(errText(e), true); });
  }
  function makeCaution() {
    api('/api/cpnreq/caution', { json: payload() }).then(function (r) { F.caution = r.caution || ''; renderForm(); jumpTo('text'); })
      .catch(function (e) { toast(errText(e), true); });
  }

  // ───────────── 현황: 위 = 쿠폰 현황(운영 중 쿠폰), 아래 = 신청 현황(요청 목록) ─────────────
  function loadList() {
    if (U.list) renderList(); else view.innerHTML = '<div class="loading"><span class="spin"></span></div>';
    api('/api/cpnreq/requests').then(function (L) { U.list = L; countPending(L); if (U.route === 'list') renderList(); })
      .catch(function (e) { if (U.route === 'list') view.innerHTML = '<div class="empty">' + esc(errText(e)) + '</div>'; });
    loadRank();
    loadStats(U.statDays);
    if (!U.coupons) {
      api('/api/cpnreq/coupons').then(function (C) { U.coupons = C; if (U.route === 'list' && U.list) renderList(); })
        .catch(function () { U.coupons = { rows: [], error: 'lookup_failed' }; if (U.route === 'list' && U.list) renderList(); });
    }
  }
  function kpi(label, v, sub, alert) {
    return '<div class="kpi' + (alert ? ' alert' : '') + '"><div class="k">' + esc(label) + '</div><div class="v">' + (v == null ? '-' : comma(v)) + '</div><div class="s">' + esc(sub) + '</div></div>';
  }
  function secHead(title, sub, extra) {
    return '<div class="sec-h"><h2>' + esc(title) + '</h2>' + (extra || '') + '<span class="sb">' + esc(sub) + '</span></div>';
  }
  // ── 쿠폰 현황 위 칸(드로우 대시보드 구성): 기간 전환 · 큰 숫자 · 일별 발급/사용 차트 · 쿠폰별 표. 원천 = 빅쿼리 미러(어제까지) ──
  function wonShort(n) {
    n = Number(n) || 0;
    if (n >= 100000000) return (Math.round(n / 10000000) / 10) + '억원';
    if (n >= 10000) return comma(Math.round(n / 10000)) + '만원';
    return comma(n) + '원';
  }
  function axisShort(n) { return n >= 10000 ? (Math.round(n / 1000) / 10) + '만' : comma(n); }
  // 눈금 간격 = 1 · 2 · 5 × 10의 거듭제곱(4칸 안팎) · 최댓값은 그 간격의 배수
  function niceScale(v) {
    var rough = Math.max(v, 1) / 4, p = Math.pow(10, Math.floor(Math.log10(rough))), f = rough / p;
    var step = Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p);
    return { step: step, max: Math.max(step, Math.ceil(Math.max(v, 1) / step) * step) };
  }
  // 올해가 아닌 날짜는 연도를 붙인다(무기한에 가까운 발급 종료일 2033-07-01 을 7/1 로 오해하지 않게)
  function mdy(s) {
    if (!s) return '';
    return String(s).slice(0, 4) === ((B && B.today) || '').slice(0, 4) ? md(s) : String(s).slice(0, 10).replace(/-0?/g, '/').replace(/^(\d{4})\//, '$1/');
  }
  function rangeSeg() {
    return '<span class="seg2" role="tablist" aria-label="기간">' + [7, 30].map(function (d) {
      return '<button type="button" role="tab" aria-selected="' + (U.statDays === d) + '" class="' + (U.statDays === d ? 'on' : '') + '" data-act="days" data-v="' + d + '">' + d + '일</button>';
    }).join('') + '</span>';
  }
  function statKpis(S) {
    var t = S.totals, risk = U.coupons && U.coupons.rows ? U.coupons.rows.filter(function (r) { return r.flags.some(function (f) { return f.level === '위험'; }); }).length : null;
    var active = U.coupons && U.coupons.rows ? U.coupons.rows.length : null;
    return '<div class="kpis">' +
      kpi('발급', t.issued, '쿠폰 ' + t.coupons + '종 · 하루 평균 ' + comma(Math.round(t.issued / S.daily.length)) + '건') +
      kpi('사용', t.used, '결제 완료 · 하루 평균 ' + comma(Math.round(t.used / S.daily.length)) + '건') +
      '<div class="kpi"><div class="k">할인액</div><div class="v">' + esc(wonShort(t.discount)) + '</div><div class="s">사용 1건당 ' + comma(t.used ? Math.round(t.discount / t.used) : 0) + '원</div></div>' +
      kpi('세팅 위험', risk, active == null ? '운영 중 쿠폰 점검' : '운영 중 ' + active + '종 중 · 상한 · 요일 · 주차장', risk > 0) + '</div>';
  }
  // 일별 막대 차트(막대 하나 = 하루). 막대 위에 마우스를 올리면 그날 값과 가장 많은 쿠폰
  // 그릴 칸의 실제 폭(px)으로 viewBox 를 잡아 글자가 줄거나 커지지 않게 한다
  function chartWidth() {
    var w = (view && view.clientWidth) || 920;
    return Math.round(Math.max(280, (w >= 820 ? (w - 12) / 2 : w) - 38));
  }
  function colChart(S, key) {
    var D = S.daily, n = D.length, W = chartWidth(), H = 176, L = 40, Rr = 6, T = 10, B = 26;
    var vmax = 0; D.forEach(function (d) { vmax = Math.max(vmax, d[key]); });
    var sc = niceScale(vmax), max = sc.max, pw = W - L - Rr, ph = H - T - B, bw = pw / n, barW = Math.min(18, bw * 0.64);
    var g = '';
    for (var v = 0; v <= max + 1e-9; v += sc.step) {
      var y = T + ph - ph * v / max;
      g += '<line x1="' + L + '" x2="' + (W - Rr) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" class="gl' + (v ? '' : ' base') + '"/>' +
        '<text x="' + (L - 6) + '" y="' + (y + 4).toFixed(1) + '" class="yt">' + axisShort(v) + '</text>';
    }
    var i;
    var step = n <= 7 ? 1 : (W < 420 ? 14 : 7);
    D.forEach(function (d, i) {
      var x = L + bw * i + (bw - barW) / 2, h = d[key] / max * ph, y = T + ph - h, r = Math.min(3, barW / 2, h);
      if (h > 0) g += '<path class="bar" data-bi="' + i + '" d="M' + x.toFixed(1) + ',' + (T + ph) + 'V' + (y + r).toFixed(1) + 'Q' + x.toFixed(1) + ',' + y.toFixed(1) + ' ' + (x + r).toFixed(1) + ',' + y.toFixed(1) +
        'H' + (x + barW - r).toFixed(1) + 'Q' + (x + barW).toFixed(1) + ',' + y.toFixed(1) + ' ' + (x + barW).toFixed(1) + ',' + (y + r).toFixed(1) + 'V' + (T + ph) + 'Z"/>';
      if ((n - 1 - i) % step === 0) g += '<text x="' + (L + bw * i + bw / 2).toFixed(1) + '" y="' + (H - 8) + '" class="xt">' + md(d.d).replace(/\(.\)$/, '') + '</text>';
      g += '<rect class="hit" data-ci="' + i + '" data-ck="' + key + '" x="' + (L + bw * i).toFixed(1) + '" y="' + T + '" width="' + bw.toFixed(1) + '" height="' + ph + '"/>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="' + (key === 'issued' ? '일별 발급' : '일별 사용') + '">' + g + '</svg>';
  }
  function chartCard(S, key, title, sub) {
    return '<div class="list-card ch-card"><div class="card-h"><h3>' + esc(title) + '</h3><span class="sb2">' + esc(sub) + '</span></div>' +
      '<div class="ch-wrap">' + colChart(S, key) + '<div class="ch-tip" hidden></div></div></div>';
  }
  function statTable(S) {
    var flagsOf = {};
    ((U.coupons && U.coupons.rows) || []).forEach(function (r) { flagsOf[r.couponId] = r.flags; });
    var list = S.coupons, shown = U.statAll ? list : list.slice(0, 10);
    var mi = 1, mu = 1; list.forEach(function (c) { mi = Math.max(mi, c.issued); mu = Math.max(mu, c.used); });
    var body = shown.map(function (c) {
      var unlimited = !c.maximum || c.maximum >= 1000000, p = unlimited ? 0 : Math.min(100, Math.round(c.issuedTotal / c.maximum * 100));
      var flags = (flagsOf[c.couponId] || []).filter(function (f) { return f.code !== 'pub_ending'; });
      return '<div class="st-row"><div class="st-c"><span class="ct-no">' + c.couponId + '</span><div class="ct-txt"><div class="nm" title="' + esc(c.name) + '">' + esc(c.name) + '</div><div class="sb">' +
        (c.pubType ? '<i class="tdot" style="background:' + (TYPE_COLOR[c.pubType] || '#71717a') + '"></i>' + esc(labelOf('pubTypes', c.pubType)) + ' · ' : '') + '발급 종료 ' + esc(mdy(c.pubEnd)) + '</div></div></div>' +
        '<div class="st-n" data-l="발급"><b>' + comma(c.issued) + '</b><span class="bar"><i style="width:' + (c.issued / mi * 100).toFixed(1) + '%"></i></span></div>' +
        '<div class="st-n" data-l="사용"><b>' + comma(c.used) + '</b><span class="bar"><i style="width:' + (c.used / mu * 100).toFixed(1) + '%"></i></span></div>' +
        '<div class="num st-d">' + esc(wonShort(c.discount)) + '</div>' +
        '<div class="st-t"><span class="num">' + comma(c.issuedTotal) + (unlimited ? '장 · 무제한' : ' / ' + comma(c.maximum)) + '</span>' + (unlimited ? '' : '<span class="bar"><i class="' + (p >= 100 ? 'full' : '') + '" style="width:' + p + '%"></i></span>') + '</div>' +
        '<div>' + (flags.length ? flags.map(function (f) { return '<span class="fl-p lv-' + f.level + '" title="' + esc(f.tip) + '">' + esc(f.label) + '</span>'; }).join('') : '') + '</div></div>';
    }).join('');
    var more = list.length > 10 ? '<button type="button" class="btn-ghost st-more" data-act="smore">' + (U.statAll ? '상위 10종만 보기' : '전체 ' + list.length + '종 보기') + '</button>' : '';
    return '<div class="list-card st-card"><div class="card-h"><h3>쿠폰별 발급 · 사용</h3><span class="sb2">사용 많은 순 · 최근 ' + S.daily.length + '일</span></div>' +
      '<div class="tbl"><div class="st-row lh"><span>쿠폰</span><span>발급</span><span>사용</span><span>할인액</span><span>누적 발급 / 총 발행량</span><span>점검</span></div>' +
      (body || '<div class="empty">기간 안에 발급 · 사용된 쿠폰이 없어요</div>') + '</div>' + more + '</div>';
  }
  // 맨 위: 최근 3개월 사용률 최고 · 최저(기간 전환과 무관 · 발급 후 2주 지난 발급분 · 100장 이상)
  function pctText(r) { var v = r * 100; return (v < 1 ? v.toFixed(2) : v.toFixed(1)) + '%'; }
  function rankCard(kind, list) {
    var best = kind === 'best', top = list[0];
    if (!top) return '<div class="list-card rk"><div class="empty">대상 쿠폰이 없어요</div></div>';
    var sub = function (x) { return esc((labelOf('pubTypes', x.pubType) || '방식 미상') + ' · 발급 ' + comma(x.issued) + ' · 사용 ' + comma(x.used)); };
    return '<div class="list-card rk ' + kind + '"><div class="rk-h"><span class="rk-tag">' + (best ? '사용률 최고' : '사용률 최저') + '</span></div>' +
      '<div class="rk-top"><div class="rk-rate">' + pctText(top.rate) + '</div><div class="rk-txt"><div class="rk-nm" title="' + esc(top.name) + '">' + top.couponId + ' · ' + esc(top.name) + '</div>' +
      '<div class="rk-sb">' + sub(top) + '</div></div></div>' +
      '<ol class="rk-list">' + list.slice(1).map(function (x, i) {
        return '<li title="' + sub(x) + '"><span class="no">' + (i + 2) + '</span><span class="nm">' + x.couponId + ' · ' + esc(x.name) + '</span><b>' + pctText(x.rate) + '</b></li>';
      }).join('') + '</ol></div>';
  }
  function rankCards() {
    var K = U.rank;
    if (!K) return '<div class="rk-row"><div class="list-card rk"><div class="loading"><span class="spin"></span></div></div><div class="list-card rk"></div></div>';
    if (K.error) return '';
    return '<div class="rk-row">' + rankCard('best', K.best) + rankCard('worst', K.worst) + '</div>' +
      '<div class="rk-note">사용률 = 발급분 중 한 번 이상 쓴 비율 · ' + esc(mdy(K.start)) + '부터 ' + esc(mdy(K.end)) + '까지 발급(최근 3개월 · 발급 후 2주 지난 것) · ' +
      comma(K.minIssued) + '장 이상 · 포인트 충전 · 테스트 쿠폰 제외 · 대상 ' + K.count + '종</div>';
  }
  function loadRank() {
    if (U.rank !== undefined) return;
    U.rank = null;
    api('/api/cpnreq/rank').then(function (K) { U.rank = K; if (U.route === 'list' && U.list) renderList(); })
      .catch(function () { U.rank = { error: 'lookup_failed' }; if (U.route === 'list' && U.list) renderList(); });
  }
  function couponBoard() {
    return rankCards() + statBoard();
  }
  function statBoard() {
    var S = U.stats[U.statDays];
    var timeline = '<details class="ct-wrap"' + (U.tlOpen ? ' open' : '') + '><summary>발급 기간 타임라인' + (U.coupons && U.coupons.rows ? '<span class="cnt">' + U.coupons.rows.length + '</span>' : '') + '</summary>' + couponsCard() + '</details>';
    if (!S) return '<div class="list-card"><div class="loading"><span class="spin"></span></div></div>' + timeline;
    if (S.error) return '<div class="list-card"><div class="empty">발급 · 사용 집계를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요</div></div>' + timeline;
    var ex = S.excluded && S.excluded.issued ? ' · 포인트 충전 ' + comma(S.excluded.issued) + '건 제외' : '';
    return statKpis(S) +
      '<div class="ch-row">' + chartCard(S, 'issued', '일별 발급', '합계 ' + comma(S.totals.issued) + '건') + chartCard(S, 'used', '일별 사용', '합계 ' + comma(S.totals.used) + '건 · 결제 완료') + '</div>' +
      statTable(S) + timeline +
      '<div class="defs"><div><b>기간</b>' + esc(md(S.start)) + '부터 ' + esc(md(S.end)) + '까지(어제까지 · 매일 갱신)' + esc(ex) + '</div>' +
      '<div><b>발급</b>쿠폰 등록 1건(빅쿼리 MDC_DB.tblMktCoupon_Register) <b style="margin-left:8px">사용</b>결제 완료 중 할인쿠폰이 적용된 결제(payment · tblMktCoupon_UsageLog) <b style="margin-left:8px">할인액</b>결제의 할인쿠폰 할인 금액</div></div>';
  }
  function loadStats(days) {
    if (U.stats[days]) return;
    U.stats[days] = null;
    api('/api/cpnreq/stats?days=' + days).then(function (S) { U.stats[days] = S; if (U.route === 'list' && U.list) renderList(); })
      .catch(function () { U.stats[days] = { error: 'lookup_failed' }; if (U.route === 'list' && U.list) renderList(); });
  }
  function requestKpis(rows) {
    var month = ((B && B.today) || '').slice(0, 7), today = (B && B.today) || '';
    var c = function (f) { return rows.filter(f).length; };
    var late = c(function (r) { return r.neededBy && r.neededBy < today && r.status !== '세팅 완료' && r.status !== '반려'; });
    return '<div class="kpis">' + kpi('접수 대기', c(function (r) { return r.status === '대기'; }), '담당 배정 전') +
      kpi('검토 · 보완', c(function (r) { return r.status === '검토' || r.status === '보완'; }), '세팅 · 대조 중') +
      kpi('이번 달 세팅 완료', c(function (r) { return r.status === '세팅 완료' && String(r.updatedAt || '').slice(0, 7) === month; }), '대조 끝난 요청') +
      kpi('희망일 지남', late, '세팅 완료 전인데 희망일 지남', late > 0) + '</div>';
  }
  function renderList() {
    var L = U.list;
    if (!L) return;
    var rows = L.rows;
    var counts = { '전체': rows.length };
    L.statusOptions.forEach(function (s) { counts[s] = rows.filter(function (r) { return r.status === s; }).length; });
    var q = U.q.trim().toLowerCase();
    var shown = rows.filter(function (r) {
      if (U.filter !== '전체' && r.status !== U.filter) return false;
      if (!q) return true;
      return [r.couponName, r.team, r.requesterNickname, r.requesterEmail, r.couponId].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var tabs = ['전체'].concat(L.statusOptions).map(function (s) {
      return '<button type="button" class="' + (U.filter === s ? 'on' : '') + '" data-act="filter" data-v="' + esc(s) + '">' + esc(s) + '<b>' + counts[s] + '</b></button>';
    }).join('');
    var PAGE = 20, pages = Math.max(1, Math.ceil(shown.length / PAGE));
    U.page = Math.min(Math.max(1, U.page || 1), pages);
    var pageRows = shown.slice((U.page - 1) * PAGE, U.page * PAGE);
    var pager = pages > 1 ? '<div class="pager"><button type="button" data-act="page" data-v="' + (U.page - 1) + '"' + (U.page === 1 ? ' disabled' : '') + '>‹</button>' +
      Array.apply(null, Array(pages)).map(function (_, i) { return '<button type="button" class="' + (i + 1 === U.page ? 'on' : '') + '" data-act="page" data-v="' + (i + 1) + '">' + (i + 1) + '</button>'; }).join('') +
      '<button type="button" data-act="page" data-v="' + (U.page + 1) + '"' + (U.page === pages ? ' disabled' : '') + '>›</button></div>' : '';
    var editors = L.editors || [];
    var body = pageRows.map(function (r) {
      var who = editors.filter(function (e) { return e.email === r.assignee; })[0];
      var assignee = L.isEditor
        ? '<select class="sel-s" data-patch="assignee" data-id="' + esc(r.id) + '"><option value="">미지정</option>' + editors.map(function (e) {
          return '<option value="' + esc(e.email) + '"' + (e.email === r.assignee ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('') + '</select>'
        : '<span class="ro">' + esc(who ? who.name : (r.assignee ? r.assignee.split('@')[0] : '미지정')) + '</span>';
      return '<div class="lr cr" data-act="open" data-v="' + esc(r.id) + '"><div class="lr-main"><span class="ty"><i class="tdot" style="background:' + (TYPE_COLOR[r.pubType] || '#71717a') + '"></i>' + esc(labelOf('pubTypes', r.pubType) || '-') + '</span><div><div class="nm">' +
        esc(r.couponName) + (r.warningCount ? '<span class="warn-dot" title="안내 · 확인 필요 항목">' + r.warningCount + '</span>' : '') + '</div><div class="sb">' +
        esc([r.requesterNickname || (r.requesterEmail || '').split('@')[0], r.team, stamp(r.createdAt) + ' 접수'].filter(Boolean).join(' · ')) +
        '</div></div></div><div class="lr-d">' + md(r.neededBy) + '</div><div class="num">' + esc(r.benefit || '') + '</div><div><span class="st-pill ' + stClass(r.status) + '">' + esc(r.status) + '</span></div><div>' +
        assignee + '</div><div class="num">' + (r.couponId ? esc(r.couponId) + '번' : '') + '</div></div>';
    }).join('');
    view.innerHTML =
      secHead('쿠폰 현황', '기간 발급 · 사용 · 할인액과 운영 중 쿠폰 점검', rangeSeg()) + couponBoard() +
      secHead('신청 현황', '기획운영팀에 들어온 쿠폰 발급 요청과 처리 상태') + requestKpis(rows) +
      '<div class="list-card"><div class="list-top"><div class="tabs">' + tabs + '</div><input class="inp srch" id="list-q" placeholder="쿠폰 이름, 요청자, 팀, 쿠폰 번호" value="' + esc(U.q) + '"></div>' +
      '<div class="tbl"><div class="lr cr lh"><span>요청</span><span>희망 세팅일</span><span>혜택</span><span>상태</span><span>담당자</span><span>쿠폰</span></div>' +
      (body || '<div class="empty">' + (rows.length ? '조건에 맞는 요청이 없어요' : '아직 접수된 요청이 없어요') + '</div>') + '</div>' + pager + '</div>' +
      '<div class="list-foot">' + (L.isEditor ? '담당자는 바꾸면 바로 저장돼요 · 상태 · 세팅 대조 · 완료는 요청 상세에서' : '상태는 기획운영팀이 요청 상세에서 바꿔요') + '</div>';
    var qEl = R.getElementById('list-q');
    qEl.addEventListener('input', function () { U.q = qEl.value; U.page = 1; var pos = qEl.selectionStart; renderList(); var n = R.getElementById('list-q'); n.focus(); n.setSelectionRange(pos, pos); });
  }
  // 쿠폰 현황 타임라인: 행 = 쿠폰 하나. 가운데 막대 = 발급 기간(진하게) · 사용 기간(옅게) · 오늘 선, 오른쪽 = 소진율 · 점검 신호.
  // 묶음 순서 = 확인 필요 → 발급 중 → 발급 예정 → 사용 기간만 남음. 묶음 안은 끝나는 날이 가까운 순
  var TYPE_COLOR = { NONE: '#2563eb', KEYWORD: '#0d9488', RANDOM: '#8b5cf6' };   // 범주색 3종(검증 통과 조합)
  var DAY = 86400000;
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
  function tlWindow() {
    var today = parse((B && B.today) || iso(new Date()));
    var start = addDays(today, -14);
    start = addDays(start, -((start.getDay() + 6) % 7));   // 월요일부터
    return { today: today, start: start, weeks: 10, end: addDays(start, 70) };
  }
  function pct(W, d) { return Math.max(0, Math.min(100, (d - W.start) / (W.end - W.start) * 100)); }
  function span(W, from, to, cls, color, alpha) {
    if (!from || !to) return '';
    var a = parse(from), b = addDays(parse(to), 1);
    if (b <= W.start || a >= W.end) return '';
    var l = pct(W, a), r = pct(W, b), open = b > W.end;
    return '<span class="' + cls + (open ? ' open' : '') + (a < W.start ? ' cut' : '') + '" style="left:' + l.toFixed(2) + '%;width:' + Math.max(r - l, 0.8).toFixed(2) +
      '%;background:' + color + (alpha ? alpha : '') + '"></span>';
  }
  function usageRange(r) {
    if (r.usageEnd) return [r.usageStart || r.pubStart, r.usageEnd];
    if (r.usageDays && r.pubEnd) return [r.pubStart, iso(addDays(parse(r.pubEnd), r.usageDays))];
    return null;
  }
  function tlRow(W, r) {
    var color = TYPE_COLOR[r.pubType] || '#71717a';
    var u = usageRange(r);
    var unlimited = r.maximum >= 1000000, p = r.maximum ? Math.min(100, Math.round(r.issued / r.maximum * 100)) : 0;
    var tip = [r.couponId + '번 ' + r.name, labelOf('pubTypes', r.pubType), r.benefit,
      '발급 ' + mdy(r.pubStart) + ' 부터 ' + mdy(r.pubEnd) + ' 까지',
      r.usageEnd ? '사용 ' + md(r.usageStart || r.pubStart) + ' 부터 ' + md(r.usageEnd) + ' 까지' : (r.usageDays ? '사용 발급 후 ' + r.usageDays + '일' : ''),
      comma(r.issued) + (unlimited ? '장 발급' : ' / ' + comma(r.maximum) + '장')].filter(Boolean).join('\n');
    var flags = r.flags.filter(function (f) { return f.code !== 'pub_ending'; });   // 발급 종료 임박은 막대 끝 날짜로 보인다
    return '<div class="ct-row" title="' + esc(tip) + '"><div class="ct-l"><span class="ct-no">' + r.couponId + '</span><div class="ct-txt"><div class="nm">' + esc(r.name) +
      '</div><div class="sb"><i class="tdot" style="background:' + color + '"></i>' + esc(labelOf('pubTypes', r.pubType)) + ' · ' + esc(r.benefit) + '</div></div></div>' +
      '<div class="ct-track">' + (u ? span(W, u[0], u[1], 'ct-use', color, '33') : '') + span(W, r.pubStart, r.pubEnd, 'ct-pub', color) +
      '<span class="ct-today" style="left:' + pct(W, W.today).toFixed(2) + '%"></span></div>' +
      '<div class="ct-r"><div class="ct-end">' + mdy(r.pubEnd) + ' 발급 종료</div>' +
      '<div class="ct-q"><span class="num">' + (unlimited ? comma(r.issued) + '장' : p + '%') + '</span>' + (unlimited ? '' : '<span class="bar"><i class="' + (p >= 100 ? 'full' : '') + '" style="width:' + p + '%"></i></span>') + '</div>' +
      (flags.length ? '<div>' + flags.map(function (f) { return '<span class="fl-p lv-' + f.level + '" title="' + esc(f.tip) + '">' + esc(f.label) + '</span>'; }).join('') + '</div>' : '') + '</div></div>';
  }
  function couponsCard() {
    var C = U.coupons;
    if (!C) return '<div class="list-card ck-card"><div class="loading"><span class="spin"></span></div></div>';
    if (C.error) return '<div class="list-card ck-card"><div class="empty">' + (C.error === 'not_configured' ? '이 환경에서는 운영 DB를 조회하지 않아요' : '운영 DB를 조회하지 못했어요. 잠시 뒤 다시 열어 주세요') + '</div></div>';
    var rows = C.rows || [], W = tlWindow(), t = iso(W.today);
    var groups = [
      { key: 'warn', name: '확인 필요', open: true, rows: [] }, { key: 'live', name: '발급 중', open: true, rows: [] },
      { key: 'soon', name: '발급 예정', open: true, rows: [] }, { key: 'used', name: '사용 기간만 남음', open: false, rows: [] },
    ];
    rows.forEach(function (r) {
      var g = r.flags.some(function (f) { return f.level === '위험' || f.level === '주의'; }) ? 0 : (r.pubStart > t ? 2 : (r.pubEnd < t ? 3 : 1));
      groups[g].rows.push(r);
    });
    groups.forEach(function (g) {
      g.rows.sort(function (a, b) { var x = g.key === 'used' ? (a.usageEnd || a.pubEnd) : a.pubEnd, y = g.key === 'used' ? (b.usageEnd || b.pubEnd) : b.pubEnd; return x < y ? -1 : x > y ? 1 : a.couponId - b.couponId; });
    });
    var ticks = '';
    for (var i = 0; i < W.weeks; i++) {
      var d = addDays(W.start, i * 7);
      ticks += '<span class="ct-tick" style="left:' + (i * 10) + '%"><span>' + (d.getMonth() + 1) + '/' + d.getDate() + '</span></span>';
    }
    var head = '<div class="ct-row ct-head"><div class="ct-l">쿠폰</div><div class="ct-track">' + ticks +
      '<span class="ct-today" style="left:' + pct(W, W.today).toFixed(2) + '%"></span></div><div class="ct-r">발급 종료 · 소진</div></div>';
    var legend = '<div class="ct-legend">' + ['NONE', 'KEYWORD', 'RANDOM'].map(function (k) { return '<span><i class="tdot" style="background:' + TYPE_COLOR[k] + '"></i>' + esc(labelOf('pubTypes', k)) + '</span>'; }).join('') +
      '<span class="sep"></span><span><i class="sw pub"></i>발급 기간</span><span><i class="sw use"></i>사용 기간</span><span><i class="sw now"></i>오늘</span></div>';
    var body = groups.filter(function (g) { return g.rows.length; }).map(function (g) {
      return '<details class="ct-grp g-' + g.key + '"' + (g.open ? ' open' : '') + '><summary><b>' + esc(g.name) + '</b><span class="cnt">' + g.rows.length + '</span></summary>' +
        g.rows.map(function (r) { return tlRow(W, r); }).join('') + '</details>';
    }).join('');
    return '<div class="list-card ck-card">' + legend + '<div class="ct">' + head + (body || '<div class="empty">발급 · 사용 기간이 남은 쿠폰이 없어요</div>') + '</div>' +
      '<div class="defs"><div><b>원천</b>운영 DB parkingshare.coupon(어드민과 같은 값) · 10분마다 다시 조회</div>' +
      '<div><b>위험</b>퍼센트 할인 최대 할인 없음 · 사용 요일 없음 · 주차장 제한인데 목록 빈 값 <b style="margin-left:8px">주의</b>발행량 소진 · 90% 이상</div>' +
      '<div><b>참고</b>요청서 없이 등록(' + esc((B && B.trackSince) || '') + ' 이후 등록 쿠폰)</div></div></div>';
  }
  function countPending(L) {
    U.pendingCnt = ((L && L.rows) || []).filter(function (r) { return r.status === '대기'; }).length;
    headBtn();
  }

  // ───────────── 상세 ─────────────
  function loadDetail(id) {
    view.innerHTML = '<div class="loading">불러오는 중</div>';
    api('/api/cpnreq/requests/' + encodeURIComponent(id)).then(function (d) { U.detail = d; renderDetail(); })
      .catch(function (e) { view.innerHTML = '<div class="empty">' + esc(e && e.body && e.body.error === 'not_found' ? '지워졌거나 없는 요청이에요' : errText(e)) + '<div style="margin-top:14px"><button type="button" class="btn-ghost" data-act="go" data-v="list">현황으로</button></div></div>'; });
  }
  function kvr(k, v) { return '<div class="kv"><span>' + esc(k) + '</span><b>' + (v === '' || v == null ? '<em class="miss-dash">없음</em>' : esc(v)) + '</b></div>'; }
  function settingsBlock(c) {
    var lots = c.parkinglots || [];
    var usage = c.usageDateType === 'STATIC' ? c.usageStart + ' 00:00:00 부터 ' + c.usageEnd + ' 23:59:59 까지' : '발급 후 ' + c.usageDays + '일 (실제 ' + (c.usageDays + 1) + '일)';
    return '<div class="blk"><h3>어드민 세팅표<button type="button" class="copy" data-act="copy">복사</button></h3>' +
      '<div class="grp">기본 정보</div>' + kvr('쿠폰 이름', c.couponName) + kvr('유의사항', c.caution) +
      '<div class="grp">발급</div>' + kvr('발급 방식', labelOf('pubTypes', c.publicationType) + (c.keyword ? ' · 키워드 ' + c.keyword : '')) +
      kvr('발급 단위', labelOf('uniqueBy', c.uniqueBy)) + kvr('총 발행량', comma(c.publicationMaximum) + '장' + (c.testQuantity ? ' (테스트 ' + comma(c.testQuantity) + '장 포함)' : '')) +
      kvr('발급 기간', c.publicationStart + ' 00:00:00 부터 ' + c.publicationEnd + ' 23:59:59 까지') +
      '<div class="grp">사용</div>' + kvr('사용 기간', usage) + kvr('사용 요일', dayText(c.dayOfWeek || [])) + kvr('사용 가능 횟수', c.usageMaximum + '회') +
      kvr('최소 결제 금액', won(c.minimumPrice)) + kvr('주차장 제한', c.limitType === 'PARKINGLOT' ? '특정 주차장 ' + lots.length + '곳 · ' + lots.slice(0, 12).join(', ') + (lots.length > 12 ? ' 외' : '') : '제한 없음') +
      '<div class="grp">할인</div>' + (c.pricingType === 'RATIO' ? kvr('할인', '퍼센트 ' + c.ratio + '% · 최대 할인 ' + won(c.maxDiscount)) : kvr('할인', '금액 ' + won(c.price))) + '</div>';
  }
  // 세팅 대조(왼쪽 넓은 칸): 쿠폰 번호 입력 + 항목별 표. 차이가 난 항목을 먼저 보인다
  function verifyBlock(rec, editor) {
    var v = rec.verify;
    var closed = rec.status === '세팅 완료' || rec.status === '반려';
    var table = '';
    if (v) {
      var stale = (v.rev || 0) !== (rec.rev || 1);
      var items = v.items.filter(function (it) { return !it.ok; }).concat(v.items.filter(function (it) { return it.ok; }));
      table = '<table class="vt"><tr><th>항목</th><th>요청</th><th>어드민(운영 DB)</th><th></th></tr>' + items.map(function (it) {
        return '<tr class="' + (it.ok ? '' : (it.must ? 'bad' : '')) + '"><td>' + esc(it.label) + '</td><td>' + esc(it.want) + '</td><td>' + esc(it.got) + '</td><td class="' + (it.ok ? 'o' : (it.must ? 'x' : 'i')) + '">' + (it.ok ? '✓' : (it.must ? '✗' : '!')) + '</td></tr>';
      }).join('') + '</table>' +
        '<div class="verdict ' + (v.ok && !stale ? 'ok' : 'bad') + '">' + v.couponId + '번 · ' + stamp(v.at) + ' · ' +
        (stale ? '대조 뒤 요청서가 바뀌었어요. 다시 대조해 주세요' : (v.ok ? v.checked + '개 항목 모두 일치' : '다른 항목 ' + v.mismatches.join(', '))) + '</div>' +
        ((v.linkedElsewhere || []).length ? '<div class="note-i" style="margin-top:6px">이 쿠폰 번호는 다른 요청에도 연결돼 있어요</div>' : '');
    }
    if (!editor || closed) {
      return '<div class="blk"><h3>세팅 대조</h3>' + (table || '<div class="hint" style="margin:0">' + (closed ? '대조 기록이 없어요' : '세팅 담당이 어드민 등록 후 대조해요') + '</div>') + '</div>';
    }
    var cid = (v && v.couponId) || rec.couponId || '';
    return '<div class="blk mgmt"><h3>세팅 대조</h3><div class="hint" style="margin:0 0 10px">어드민에 등록한 쿠폰 번호를 넣으면 운영 DB 값과 요청을 항목별로 비교해요</div>' +
      '<div class="row-btn"><input class="inp" inputmode="numeric" id="v-cid" value="' + esc(cid) + '" placeholder="예: 1933"><button type="button" class="btn-ghost" data-act="verify">대조</button></div>' +
      table + '</div>';
  }
  // 세팅 완료(오른쪽): 기안 번호 · 차이 사유 · 완료 버튼
  function completeBlock(rec, editor) {
    var v = rec.verify, c = rec.input || {};
    if (!editor || rec.status === '세팅 완료' || rec.status === '반려') return '';
    var canDone = v && (v.rev || 0) === (rec.rev || 1);
    return '<div class="blk mgmt"><h3>세팅 완료</h3>' +
      (canDone ? '' : '<div class="hint" style="margin:0 0 10px">' + (v ? '요청서가 바뀌어 다시 대조해야 해요' : '세팅 대조를 먼저 해 주세요') + '</div>') +
      '<div class="fieldrow"><label>기안 번호</label><input class="inp" id="v-doc" value="' + esc(rec.approvalDoc || c.approvalDoc || '') + '" placeholder="그룹웨어 문서번호"></div>' +
      (v && !v.ok ? '<div class="fieldrow"><label>다른 항목을 그대로 두는 사유</label><textarea class="inp" id="v-why" placeholder="예: 제휴사 요청으로 최소 결제 금액 변경(메일 10/23)"></textarea></div>' : '') +
      '<button type="button" class="btn-co" data-act="complete"' + (canDone ? '' : ' disabled') + '>세팅 완료</button>' +
      '<div class="hint">완료하면 요청자에게 슬랙 스레드로 쿠폰 번호를 알려요</div></div>';
  }
  function mgmtBlock(rec, d) {
    var editor = d.isEditor, closed = rec.status === '세팅 완료' || rec.status === '반려';
    var who = (d.editors || []).filter(function (e) { return e.email === rec.assignee; })[0];
    if (!editor || closed) {
      return '<div class="blk"><h3>요청 관리</h3>' + kvr('상태', rec.status) + kvr('담당자', who ? who.name : (rec.assignee || '미지정')) +
        kvr('쿠폰 번호', rec.couponId ? rec.couponId + '번' : '') + kvr('기안 번호', rec.approvalDoc || '') + (rec.reason ? kvr('사유', rec.reason) : '') +
        (rec.overrideReason ? kvr('차이 사유', rec.overrideReason) : '') + '</div>';
    }
    var stOpts = (d.statusOptions || []).filter(function (s) { return s !== '세팅 완료'; });
    return '<div class="blk mgmt"><h3>요청 관리</h3>' +
      '<div class="fieldrow"><label>상태</label><select class="sel-s" id="m-st">' + stOpts.map(function (s) { return '<option' + (s === rec.status ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></div>' +
      '<div class="fieldrow"><label>담당자</label><select class="sel-s" id="m-as"><option value="">미지정</option>' + (d.editors || []).map(function (e) {
        return '<option value="' + esc(e.email) + '"' + (e.email === rec.assignee ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="fieldrow"><label>보완 · 반려 사유</label><textarea class="inp" id="m-why" placeholder="보완 · 반려로 바꿀 때 요청자에게 보낼 사유"></textarea></div>' +
      '<button type="button" class="btn-ghost" data-act="mgmt-save">저장</button></div>';
  }
  function renderDetail() {
    var d = U.detail, rec = d.record, c = rec.input || {};
    var notes = (rec.warnings || []).map(function (w) { return '<div class="note-i"><b>안내</b>' + esc(w.msg) + '</div>'; }).join('') +
      (rec.pending || []).map(function (w) { return '<div class="note-i pend"><b>접수 후 확인</b>' + esc(w.msg) + '</div>'; }).join('');
    var hist = (rec.history || []).slice().reverse().map(function (h) {
      return '<li><span>' + stamp(h.at) + '</span>' + esc(h.text || h.kind) + (h.by ? ' · ' + esc(h.by.split('@')[0]) : '') +
        ((h.changes || []).length ? '<div class="hint" style="margin:2px 0 0">' + esc(h.changes.map(function (x) { return x.label; }).join(', ')) + '</div>' : '') + '</li>';
    }).join('');
    var acts = (d.canEdit ? '<button type="button" class="btn-ghost" data-act="edit">수정</button>' : '') +
      ((d.canEdit) ? '<button type="button" class="btn-ghost" data-act="del">삭제</button>' : '');
    view.innerHTML = '<div class="dt-head"><div><span class="st-pill ' + stClass(rec.status) + '">' + esc(rec.status) + '</span><h1>' + esc(c.couponName) + '</h1>' +
      '<div class="sb">' + esc([rec.requesterNickname, rec.team, stamp(rec.createdAt) + ' 접수', '희망 세팅일 ' + md(c.neededBy), '요청 번호 ' + rec.id].filter(Boolean).join(' · ')) + '</div></div>' +
      '<div class="row-btn"><button type="button" class="btn-ghost" data-act="go" data-v="list">현황으로</button>' + acts + '</div></div>' +
      '<div class="dt-grid"><div>' + settingsBlock(c) + verifyBlock(rec, d.isEditor) +
      (notes ? '<div class="blk"><h3>안내 · 확인 필요</h3><div class="notes">' + notes + '</div></div>' : '') +
      '<div class="blk"><h3>목적 · 메모</h3>' + kvr('목적', c.purpose) + kvr('기획안', c.planDoc) + kvr('요청 메모', c.note) + kvr('참고한 쿠폰', c.basedOn ? c.basedOn + '번' : '') + '</div></div>' +
      '<div>' + mgmtBlock(rec, d) + completeBlock(rec, d.isEditor) + '<div class="blk"><h3>이력</h3><ul class="hist">' + hist + '</ul></div></div></div>';
  }
  function verify() {
    var rec = U.detail.record, id = num((R.getElementById('v-cid') || {}).value);
    if (!id) { toast('어드민 쿠폰 번호를 숫자로 적어 주세요', true); return; }
    api('/api/cpnreq/requests/' + encodeURIComponent(rec.id) + '/verify', { json: { couponId: id } }).then(function (b) {
      U.detail.record = b.record; U.list = null; renderDetail();
      toast(b.verify.ok ? '모든 항목이 요청과 같아요' : '요청과 다른 항목이 ' + b.verify.mismatches.length + '개 있어요', !b.verify.ok);
    }).catch(function (e) { toast(errText(e), true); });
  }
  function complete() {
    var rec = U.detail.record;
    var body = { couponId: rec.verify && rec.verify.couponId, approvalDoc: (R.getElementById('v-doc') || {}).value || '', overrideReason: (R.getElementById('v-why') || {}).value || '' };
    api('/api/cpnreq/requests/' + encodeURIComponent(rec.id) + '/complete', { json: body }).then(function (b) {
      U.detail.record = b.record; U.list = null; renderDetail(); toast('세팅 완료로 바꿨어요');
    }).catch(function (e) { toast(errText(e), true); });
  }
  function saveMgmt() {
    var rec = U.detail.record;
    var st = R.getElementById('m-st').value, as = R.getElementById('m-as').value, why = R.getElementById('m-why').value.trim();
    var body = {};
    if (st !== rec.status) body.status = st;
    if ((as || null) !== (rec.assignee || null)) body.assignee = as || null;
    if (!Object.keys(body).length) { toast('바뀐 내용이 없어요'); return; }
    if (body.status && (st === '보완' || st === '반려')) { if (!why) { toast('보완 · 반려 사유를 적어 주세요', true); return; } body.reason = why; }
    api('/api/cpnreq/requests/' + encodeURIComponent(rec.id), { method: 'PATCH', json: body }).then(function (b) {
      U.detail.record = b.record; U.list = null; renderDetail(); toast('저장했어요');
    }).catch(function (e) { toast(errText(e), true); });
  }
  function patchAssignee(id, value, el) {
    var row = ((U.list && U.list.rows) || []).filter(function (r) { return r.id === id; })[0], prev = row ? row.assignee : '';
    api('/api/cpnreq/requests/' + encodeURIComponent(id), { method: 'PATCH', json: { assignee: value || null } }).then(function () {
      if (row) row.assignee = value || null; toast('담당자를 바꿨어요');
    }).catch(function (e) { el.value = prev || ''; toast(errText(e), true); });
  }
  function startEdit() {
    var rec = U.detail.record, c = rec.input || {};
    resetForm();
    Object.keys(F).forEach(function (k) {
      if (!(k in c)) return;
      var v = c[k];
      if (k === 'parkinglots') F[k] = (v || []).join(', ');
      else if (k === 'dayOfWeek') F[k] = (v || []).slice();
      else F[k] = v == null ? '' : String(v);
    });
    U.editId = rec.id; U.editName = c.couponName || '';
    go('new');
  }
  function cancelEdit(silent) {
    var id = U.editId;
    U.editId = null; U.editName = ''; resetForm();
    if (!silent && id) go('r:' + id);
  }
  // 확인 창(삭제 사유)
  function modal(title, text, needReason, onOk) {
    var bg = document.createElement('div');
    bg.className = 'cr-bg';
    bg.innerHTML = '<div class="cr-modal"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' + (needReason ? '<textarea class="inp" id="md-why" placeholder="사유"></textarea>' : '') +
      '<div class="acts"><button type="button" class="btn-ghost" data-md="no">취소</button><button type="button" class="btn-co" data-md="ok">확인</button></div></div>';
    R.appendChild(bg);
    bg.addEventListener('click', function (e) {
      var b = e.target.closest('[data-md]');
      if (e.target === bg || (b && b.dataset.md === 'no')) { bg.remove(); return; }
      if (b && b.dataset.md === 'ok') {
        var why = needReason ? bg.querySelector('#md-why').value.trim() : '';
        if (needReason && !why) { toast('사유를 적어 주세요', true); return; }
        bg.remove(); onOk(why);
      }
    });
  }
  function removeRequest() {
    var rec = U.detail.record, d = U.detail;
    var mine = (B.me.email || '').split('@')[0] === (rec.requesterEmail || '').split('@')[0];
    modal('요청을 삭제할까요', '삭제하면 되돌릴 수 없어요. 슬랙 스레드에 삭제를 알려요.', d.isEditor && !mine, function (why) {
      api('/api/cpnreq/requests/' + encodeURIComponent(rec.id) + '/delete', { json: { reason: why } }).then(function () {
        U.list = null; toast('삭제했어요'); go('list');
      }).catch(function (e) { toast(errText(e), true); });
    });
  }

  // ───────────── 라우팅 · 이벤트 ─────────────
  function readRoute() {
    try {
      var p = new URL(location.href).searchParams;
      if (p.get('cpn')) return 'r:' + p.get('cpn');
      if (p.get('cr') === 'new') return 'new';
    } catch (e) { /* noop */ }
    return 'list';   // 탭을 열면 현황(쿠폰 현황 → 신청 현황)부터
  }
  function go(r) {
    if (U.route === r) { route(); return; }
    view.classList.add('out');
    setTimeout(function () { view.classList.remove('out'); goNow(r); }, 80);
  }
  function goNow(r) {
    U.route = r;
    try {
      var u = new URL(location.href);
      u.searchParams.delete('cpn'); u.searchParams.delete('cr');
      if (r === 'new') u.searchParams.set('cr', 'new');
      if (r.indexOf('r:') === 0) u.searchParams.set('cpn', r.slice(2));
      history.replaceState(history.state, '', u.toString());
    } catch (e) { /* noop */ }
    route();
    if (host && host.getBoundingClientRect().top < 0) host.scrollIntoView({ block: 'start' });
  }
  function route() {
    var r = U.route || 'list';
    headBtn();
    view.classList.remove('in'); void view.offsetWidth; view.classList.add('in');
    if (r === 'list') return loadList();
    if (r.indexOf('r:') === 0) return loadDetail(r.slice(2));
    renderForm();
  }

  var IC_PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
  var IC_LIST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.1"/><circle cx="4.5" cy="12" r="1.1"/><circle cx="4.5" cy="18" r="1.1"/></svg>';
  // 우상단 보기 전환(현황 · 요청). 모양은 CRM 요청과 같은 .mr-sw(views_ext.css). 알약이 오른쪽(.admin)이면 요청 폼
  function headBtn() {
    if (!head) return;
    if (!B || !B.me) { head.innerHTML = ''; return; }
    var form = U.route === 'new';
    var showCnt = U.pendingCnt && B.me.isEditor;
    head.innerHTML = '<div class="mr-sw' + (form ? ' admin' : '') + '" role="tablist" aria-label="보기 전환">' +
      '<button type="button" role="tab" aria-selected="' + !form + '"' + (form ? '' : ' class="on"') + ' data-cr="list">' + IC_LIST + '<span>현황</span>' +
      (showCnt ? '<span class="cnt" title="대기 중인 요청">' + U.pendingCnt + '</span>' : '') + '</button>' +
      '<button type="button" role="tab" aria-selected="' + form + '"' + (form ? ' class="on"' : '') + ' data-cr="new">' + IC_PEN + '<span>요청</span></button></div>';
  }

  function mount(el) {
    if (R) return;
    host = el;
    R = el.attachShadow({ mode: 'open' });
    R.innerHTML = '<link rel="stylesheet" href="' + BASE_CSS + '"><link rel="stylesheet" href="' + OWN_CSS + '"><div class="mr cr" id="cr">' +
      '<div class="wrap" id="view"><div class="loading">불러오는 중</div></div></div><div class="toast" id="toast" hidden></div>';
    view = R.getElementById('view');
    toastEl = R.getElementById('toast');
    head = document.getElementById('cr-head');
    if (head) head.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cr]');
      if (!b || !B) return;
      if (b.dataset.cr === 'new' && U.done) resetForm();
      go(b.dataset.cr);
    });
    view.addEventListener('click', function (e) {
      var el2 = e.target.closest('[data-act]');
      if (!el2 || el2.disabled || !view.contains(el2)) return;
      if (e.target.closest('select, input, textarea') && el2.dataset.act === 'open') return;
      var act = el2.dataset.act, v = el2.dataset.v;
      if (act === 'set') {
        F[el2.dataset.k] = v;
        if (el2.dataset.k === 'publicationType' && v !== 'KEYWORD') U.kw = null;
        U.touched = U.touched || {}; U.touched[el2.dataset.k] = true;
        U.problems = (U.problems || []).filter(function (x) { return x.field !== el2.dataset.k; });
        renderForm();
      }
      else if (act === 'prefix') {
        var name = F.couponName.replace(/^\[[^\]]*\]\s*/, '');
        F.couponName = '[' + v + '] ' + name; renderForm();
        var ci = R.querySelector('[data-bind="couponName"]'); if (ci) { ci.focus(); ci.setSelectionRange(ci.value.length, ci.value.length); }
      }
      else if (act === 'day') {
        var i = F.dayOfWeek.indexOf(v);
        if (i >= 0) F.dayOfWeek.splice(i, 1); else F.dayOfWeek.push(v);
        F.dayOfWeek = DAYS.filter(function (d) { return F.dayOfWeek.indexOf(d) >= 0; });
        U.touched = U.touched || {}; U.touched.dayOfWeek = true; renderForm();
      }
      else if (act === 'days-all') { F.dayOfWeek = F.dayOfWeek.length === 7 ? [] : DAYS.slice(); U.touched = U.touched || {}; U.touched.dayOfWeek = true; renderForm(); }
      else if (act === 'kw') checkKeyword();
      else if (act === 'lots') checkLots();
      else if (act === 'load') loadCoupon();
      else if (act === 'caution') makeCaution();
      else if (act === 'jump') jumpTo(v, el2.dataset.f);
      else if (act === 'precheck') precheck();
      else if (act === 'submit') submit();
      else if (act === 'edit-cancel') cancelEdit();
      else if (act === 'new') { resetForm(); go('new'); }
      else if (act === 'go') go(v);
      else if (act === 'open') go('r:' + v);
      else if (act === 'filter') { U.filter = v; U.page = 1; renderList(); }
      else if (act === 'days') { U.statDays = Number(v); U.statAll = false; loadStats(U.statDays); renderList(); }
      else if (act === 'smore') { U.statAll = !U.statAll; renderList(); }
      else if (act === 'page') { U.page = Number(v); renderList(); }
      else if (act === 'copy') copyText(U.detail.record.settingsText || '');
      else if (act === 'verify') verify();
      else if (act === 'complete') complete();
      else if (act === 'mgmt-save') saveMgmt();
      else if (act === 'edit') startEdit();
      else if (act === 'del') removeRequest();
    });
    view.addEventListener('mousemove', function (e) {
      var hit = e.target.closest && e.target.closest('[data-ci]');
      var wrap = hit && hit.closest('.ch-wrap');
      R.querySelectorAll('.ch-tip').forEach(function (t) { if (!wrap || !wrap.contains(t)) t.hidden = true; });
      R.querySelectorAll('.bar-on').forEach(function (b) { b.classList.remove('bar-on'); });
      if (!hit || !wrap) return;
      var S = U.stats[U.statDays], d = S && S.daily[Number(hit.dataset.ci)], key = hit.dataset.ck;
      if (!d) return;
      var tip = wrap.querySelector('.ch-tip'), top = key === 'issued' ? d.topIssued : d.topUsed;
      tip.innerHTML = '<b>' + esc(md(d.d)) + '</b><div>' + (key === 'issued' ? '발급 ' : '사용 ') + comma(d[key]) + '건' + (key === 'used' ? ' · 할인 ' + esc(wonShort(d.discount)) : '') + '</div>' +
        (top ? '<div class="tp">가장 많은 쿠폰 · ' + esc(top) + '</div>' : '');
      tip.hidden = false;
      var box = wrap.getBoundingClientRect(), hb = hit.getBoundingClientRect();
      var x = hb.left - box.left + hb.width / 2, w = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(box.width - w, x - w / 2)) + 'px';
      var bar = wrap.querySelector('[data-bi="' + hit.dataset.ci + '"]');
      if (bar) bar.classList.add('bar-on');
    });
    view.addEventListener('mouseleave', function () { R.querySelectorAll('.ch-tip').forEach(function (t) { t.hidden = true; }); });
    view.addEventListener('toggle', function (e) { if (e.target.classList && e.target.classList.contains('ct-wrap')) U.tlOpen = e.target.open; }, true);
    view.addEventListener('input', function (e) {
      var b = e.target.dataset && e.target.dataset.bind;
      if (!b) return;
      F[b] = e.target.value;
      refreshLive(b);
    });
    // 칸을 벗어나면 그 칸의 오류를 보여 준다(입력 중에는 막 시작한 칸을 빨갛게 만들지 않는다)
    view.addEventListener('focusout', function (e) {
      var b = e.target.dataset && e.target.dataset.bind;
      if (!b) return;
      U.touched = U.touched || {}; U.touched[b] = true;
      // 사용 기간이 비어 있으면 발급 기간을 그대로 옮겨 둔다(가장 흔한 세팅). 다음 칸의 커서를 지키려고 그 칸 값만 바꾼다
      var pair = { publicationStart: 'usageStart', publicationEnd: 'usageEnd' }[b];
      if (pair && F[b] && !F[pair] && F.usageDateType === 'STATIC') {
        F[pair] = F[b];
        var tgt = R.querySelector('[data-bind="' + pair + '"]'); if (tgt) tgt.value = F[pair];
        refreshLive(pair);
        return;
      }
      paintErrors();
    });
    view.addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset && t.dataset.patch === 'assignee') patchAssignee(t.dataset.id, t.value, t);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { var m = R.querySelector('.cr-bg'); if (m) m.remove(); } });

    U.route = readRoute();
    api('/api/cpnreq/bootstrap').then(function (b) {
      B = b;
      api('/api/cpnreq/requests').then(function (L) { U.list = L; countPending(L); }).catch(function () { /* 건수만 빠진다 */ });
      route();
    }).catch(function (e) {
      if (e.status === 401) { view.innerHTML = '<div class="empty">로그인이 필요해요. <a href="/auth/login">구글 계정으로 로그인</a></div>'; return; }
      view.innerHTML = '<div class="empty">' + esc(errText(e)) + '</div>';
    });
  }

  return { mount: mount };
})();
