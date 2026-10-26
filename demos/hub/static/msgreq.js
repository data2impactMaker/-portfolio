/* CRM 요청 화면: 대시보드 네 번째 화면(?view=msgreq). 요청 폼 · 요청 현황(&mr=list) · 요청 상세(&req=<id>).
 * views_ext.js 가 처음 열 때 MsgReq.mount(#view-msgreq) 를 부른다. 대시보드 스타일과 섞이지 않게 섀도 DOM 에 그린다.
 * 서버는 message_requests.py (/api/msgreq/*). 선택지·일정·딥링크·요청자는 bootstrap 한 번으로 받는다.
 * 폼 상태는 F 한 곳에 두고, 선택 클릭은 폼 전체를 다시 그리고 글자 입력은 미리보기·요약만 갱신한다. */
window.MsgReq = (function () {
  'use strict';

  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || 'static/msgreq.js';
  var CSS_URL = SCRIPT_SRC.replace(/msgreq\.js(\?.*)?$/, 'msgreq.css');
  var host = null, R = null, view = null, toastEl = null;
  var WD = '일월화수목금토';

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

  var B = null;
  var F = blankForm();
  var U = { calMonth: null, suggest: { state: 'idle', variants: [], picked: -1 }, submitting: false, done: null,
            list: null, filter: '전체', q: '', fileChecking: false, route: 'new' };

  function blankForm() {
    return {
      team: '', campaignName: '', messageType: 'push',
      inappMode: 'recommend', inappContentCategory: '', inappMessageFormat: '', layoutGroup: '', inappLayout: '',
      inappLayoutSubtype: '', inappHtmlType: '',
      quiz: { importance: '', position: '', image: '', hasText: '', cta: '', htmlBehavior: '' },
      inappTriggerType: '', inappTriggerEventName: '', inappTriggerDelaySeconds: '',
      desiredSendDate: '', sendTimeBand: '', sendTimeNote: '',
      targetSheet: '', targetHow: '', targetConditionType: '', targetConditionBasis: '', targetConditionPeriod: '', targetDetail: '', estimatedAudience: '',
      copyTitle: '', copyBody: '', copyEyebrow: '', copyCta: '', copyCta2: '', imageUrl: '', slideVisual: 'image', slideEmoji: '',
      dlGroup: '', dlId: '', dlValues: {}, dlFree: '',
      deliveryMethod: '', sqlQuery: '', planningTeamNote: '', file: null, fileInfo: null, fileErr: null,
    };
  }

  // ───────────── 공통 ─────────────
  function api(url, opt) {
    opt = opt || {};
    opt.credentials = 'same-origin';
    opt.headers = Object.assign({ 'X-Requested-With': 'XMLHttpRequest' }, opt.headers || {});
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
    missing_fields: '필수 항목이 비어 있어요', too_soon: '발송 희망일이 영업일 기준으로 너무 가까워요',
    invalid_deeplink: '딥링크 문서에 없는 링크예요', unsupported_type: '아직 지원하지 않는 채널이에요',
    invalid_field: '입력값을 다시 확인해 주세요', busy: '동시에 제출이 몰렸어요. 잠시 뒤 다시 시도해 주세요',
    login_required: '로그인이 필요해요', editor_only: '편집자 명단 등록자만 바꿀 수 있어요',
    not_configured: 'AI 제안을 지금은 쓸 수 없어요', generation_failed: 'AI 제안을 만들지 못했어요. 다시 시도해 주세요',
    not_csv: 'CSV 파일만 올릴 수 있어요', empty: '빈 파일이에요', encoding: 'UTF-8 이나 CP949 로 저장한 CSV 만 읽을 수 있어요',
    no_external_id: 'external_id 열이 없어요', no_rows: 'external_id 값이 한 줄도 없어요', not_found: '요청을 찾지 못했어요',
    card_failed: '캠페인 카드를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요',
    reject_reason_required: '반려 사유를 적어 주세요', reason_required: '사유를 적어 주세요',
    locked_after_review: '검토가 시작된 요청은 기획운영팀이 수정해요', closed: '완료·반려된 요청은 수정할 수 없어요',
    send_date_needs_reason: '발송일은 요청 상세의 발송일 변경에서 사유와 함께 바꿔 주세요',
    card_sent: '이미 발송된 캠페인이라 바꿀 수 없어요', card_not_found: '연결된 캠페인 카드를 찾지 못했어요',
    card_delete_failed: '캠페인 카드를 지우지 못했어요. 잠시 뒤 다시 시도해 주세요', nothing_to_update: '바뀐 내용이 없어요',
    done_by_card: '완료는 캠페인 카드가 발송·운영 상태가 되면 자동으로 바뀌어요',
    braze_stop_required: '발송예정 카드예요. Braze 캔버스 예약을 먼저 중지해 주세요',
    card_unreadable: '연결 카드를 읽지 못했어요. 잠시 뒤 다시 시도해 주세요',
  };
  function errText(e) {
    var b = (e && e.body) || {};
    if (b.error === 'too_large') return '용량은 ' + b.maxMb + 'MB 까지 올릴 수 있어요';
    if (b.error === 'too_soon' && b.minSendDate) return '발송 희망일은 ' + md(b.minSendDate) + '부터 고를 수 있어요';
    if (b.error === 'date_taken') return '그날은 이미 발송이 잡혀 있어요' + ((b.names || []).length ? ' · ' + b.names.filter(Boolean).join(', ') : '') + '. 다른 날을 골라 주세요';
    if (b.error === 'no_external_id' && b.hasUserSeq) return 'userSeq 열 이름을 external_id 로 바꿔서 다시 올려 주세요';
    if (b.error === 'card_blocked') return '카드 규칙에 걸려 승인하지 못했어요 · ' + (b.reasons || []).filter(Boolean).join(', ');
    return ERR[b.error] || ERR[e && e.message] || '처리하지 못했어요. 잠시 뒤 다시 시도해 주세요';
  }
  var toastTimer = null;
  function toast(msg, bad) {
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (bad ? ' bad' : '');
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }
  function opt(k) { return B.options[k]; }
  function layoutOf(key) { return opt('inappLayouts').filter(function (l) { return l.key === key; })[0] || null; }
  function htmlTypeOf(v) { return opt('inappHtmlTypes').filter(function (t) { return t.value === v; })[0] || null; }
  function subtypeOf(layout, key) { return layout ? layout.subtypes.filter(function (s) { return s.key === key; })[0] || null : null; }
  function band(v) { return opt('timeBands').filter(function (b) { return b.value === v; })[0] || null; }
  function bandLabel(v) { var b = band(v); return b ? (b.start != null ? b.label + ' ' + b.range : b.label) : ''; }
  function typeLabel(v) { var m = opt('messageTypes').filter(function (x) { return x.value === v; })[0]; return m ? m.label : v; }
  function deliveryLabel(v) { var m = opt('deliveryMethods').filter(function (x) { return x.value === v; })[0]; return m ? m.label : ''; }

  // ───────────── 휴대폰 픽토그램 ─────────────
  function pic(inner) { return '<svg class="pic" viewBox="0 0 64 108" aria-hidden="true">' + inner + '</svg>'; }
  var PH = '<rect x="1" y="1" width="62" height="106" rx="10" class="ph"/><rect x="24" y="5" width="16" height="3" rx="1.5" class="lf"/>';
  var APP = '<rect x="7" y="14" width="30" height="4" rx="2" class="lf"/><rect x="7" y="22" width="50" height="14" rx="3" class="lf"/>' +
    '<rect x="7" y="40" width="24" height="16" rx="3" class="lf"/><rect x="33" y="40" width="24" height="16" rx="3" class="lf"/>' +
    '<rect x="7" y="60" width="50" height="30" rx="3" class="lf"/><rect x="1" y="1" width="62" height="106" rx="10" class="dim"/>';
  var TEMPLATE = '<rect x="11" y="28" width="42" height="52" rx="5" class="wh"/><rect x="11" y="28" width="42" height="20" rx="5" class="acl"/>' +
    '<rect x="16" y="53" width="26" height="3" rx="1.5" class="ln"/><rect x="16" y="59" width="32" height="3" rx="1.5" class="lf2"/>' +
    '<rect x="15" y="68" width="34" height="7" rx="3" class="ac"/>';
  var PICS = {
    push: pic(PH + '<rect x="20" y="18" width="24" height="7" rx="2" class="lf"/>' +
      '<rect x="6" y="34" width="52" height="20" rx="5" class="wh sh"/><rect x="10" y="39" width="10" height="10" rx="3" class="ac"/>' +
      '<rect x="24" y="40" width="28" height="3" rx="1.5" class="ln"/><rect x="24" y="46" width="20" height="3" rx="1.5" class="lf2"/>' +
      '<rect x="6" y="58" width="52" height="16" rx="5" class="wh sh"/><rect x="10" y="62" width="8" height="8" rx="2.5" class="lf2"/>' +
      '<rect x="22" y="64" width="26" height="3" rx="1.5" class="lf2"/>'),
    inapp: pic(PH + APP + TEMPLATE),
    email: pic(PH + '<rect x="7" y="14" width="22" height="4" rx="2" class="lf"/>' +
      '<rect x="12" y="38" width="40" height="28" rx="3" class="wh st"/><path d="M12 40 L32 55 L52 40" class="st" fill="none"/>'),
    sms: pic(PH + '<path d="M10 13 L7 16.5 L10 20" class="stk"/><circle cx="32" cy="15" r="5" class="ln"/>' +
      '<rect x="25" y="22.5" width="14" height="2.5" rx="1.25" class="lf2"/><rect x="2" y="28" width="60" height="1" class="lf"/>' +
      '<rect x="25" y="33" width="14" height="3.5" rx="1.75" class="lf"/>' +
      '<path d="M12 41 H40 A6 6 0 0 1 46 47 V67 A6 6 0 0 1 40 73 H13 Q9 76 4 77 Q7 74 7 70 V47 A6 6 0 0 1 12 41 Z" class="bb"/>' +
      '<rect x="11" y="46" width="16" height="2.6" rx="1.3" class="ln"/><rect x="11" y="52" width="30" height="2.6" rx="1.3" class="lf2"/>' +
      '<rect x="11" y="57.5" width="28" height="2.6" rx="1.3" class="lf2"/><rect x="11" y="63" width="20" height="2.6" rx="1.3" class="lf2"/>' +
      '<rect x="6" y="92" width="41" height="9" rx="4.5" class="wh st"/><circle cx="54" cy="96.5" r="4.5" class="ac"/>'),
    kakao: pic(PH + '<rect x="2" y="2" width="60" height="104" rx="9" class="kbg"/><rect x="24" y="5" width="16" height="3" rx="1.5" class="lf2"/>' +
      '<path d="M9 12 L6 15.5 L9 19" class="stk"/><rect x="13" y="14" width="16" height="3" rx="1.5" class="ln"/>' +
      '<rect x="5" y="25" width="10" height="10" rx="4" class="ln"/><rect x="18" y="25" width="13" height="2.5" rx="1.25" class="ln"/>' +
      '<rect x="18" y="30" width="38" height="52" rx="5" class="wh"/><path d="M18 35 A5 5 0 0 1 23 30 H51 A5 5 0 0 1 56 35 V40 H18 Z" class="ky"/>' +
      '<ellipse cx="24.5" cy="35" rx="3.4" ry="2.6" class="wh"/><path d="M22.4 36.6 L21.4 39 L24.8 37.3 Z" class="wh"/>' +
      '<rect x="22" y="45" width="26" height="2.6" rx="1.3" class="ln"/><rect x="22" y="51" width="30" height="2.6" rx="1.3" class="lf2"/>' +
      '<rect x="21" y="70" width="32" height="8" rx="2" class="kbtn"/>' +
      '<path d="M2 90 H62 V97 A9 9 0 0 1 53 106 H11 A9 9 0 0 1 2 97 Z" class="wh"/>' +
      '<rect x="6" y="94" width="40" height="8" rx="4" class="lf"/><rect x="50" y="94" width="9" height="8" rx="2.5" class="ky"/>'),
    custom: pic(PH + APP + '<rect x="9" y="22" width="46" height="64" rx="7" class="ac"/><circle cx="50" cy="27" r="8" class="wh" opacity=".18"/>' +
      '<rect x="20" y="30" width="24" height="5" rx="2.5" class="wh" opacity=".55"/><text x="32" y="54" text-anchor="middle" class="big">50%</text>' +
      '<rect x="17" y="59" width="30" height="3" rx="1.5" class="wh" opacity=".7"/><rect x="14" y="70" width="36" height="9" rx="4.5" class="wh"/>' +
      '<rect x="22" y="73" width="20" height="3" rx="1.5" class="ac"/>'),
  };
  // 세부 타입 그림: 모달 상자 안의 버튼 개수·배치와 닫기(×) 위치
  function subPic(inner) { return '<svg viewBox="0 0 72 48" aria-hidden="true"><rect x="1" y="1" width="70" height="46" rx="6" class="bx"/>' + inner + '</svg>'; }
  var X_TR = '<path d="M60 8l6 6M66 8l-6 6" class="x"/>', LINES = '<rect x="14" y="12" width="30" height="4" rx="2" class="ln"/><rect x="14" y="20" width="44" height="3" rx="1.5" class="lf"/>';
  var SUB_PIC = {
    A: subPic(X_TR + LINES + '<rect x="14" y="30" width="44" height="10" rx="4" class="bt"/>'),
    B: subPic(LINES + '<path d="M17 32l6 6M23 32l-6 6" class="x"/><rect x="28" y="30" width="30" height="10" rx="4" class="bt"/>'),
    C_lr: subPic(X_TR + LINES + '<rect x="14" y="30" width="20" height="10" rx="4" class="bt2"/><rect x="38" y="30" width="20" height="10" rx="4" class="bt"/>'),
    C_tb: subPic(X_TR + '<rect x="14" y="9" width="30" height="4" rx="2" class="ln"/><rect x="14" y="17" width="44" height="8" rx="3" class="bt"/><rect x="14" y="29" width="44" height="8" rx="3" class="bt2"/>'),
    D: subPic(LINES + '<rect x="14" y="30" width="44" height="10" rx="4" class="bt2"/><path d="M32 32.5l5 5M37 32.5l-5 5" class="x"/>'),
  };
  var ARROW = '<svg class="land-arr" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5 L16 12 L9 19" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ───────────── 조각 ─────────────
  // 필수 항목은 라벨 뒤 빨간 별표(세 번째 인자 'req'). 선택 항목은 따로 표시하지 않는다.
  var REQ = '<span class="req" aria-label="필수">*</span>';
  // 라벨은 값 칸의 첫 요소 세로 중앙에 맞춘다(칩·입력칸·프로필·모수 막대는 높이가 달라 클래스로 나눈다)
  function alignOf(inner) {
    var h = String(inner).replace(/^\s+/, '');
    if (/^<div class="(chips|fchips)"/.test(h)) return ' al-chip';
    if (/^<(input|textarea)\b/.test(h) || /^<div class="inp-pre"/.test(h) || /^<div id="dl-out"/.test(h)) return ' al-inp';
    if (/^<div class="prof"/.test(h)) return ' al-prof';
    if (/^<div class="aud/.test(h)) return ' al-aud';
    if (/^<div class="(dwrap2|cpane|topts)/.test(h)) return ' al-top';
    return '';
  }
  function frow(label, inner, flag, cls) {
    return '<div class="frow' + alignOf(inner) + (cls ? ' ' + cls : '') + '"><div class="fl">' + esc(label) + (flag === 'req' ? REQ : '') +
      '</div><div class="fv">' + inner + '</div></div>';
  }
  function optTx(k, v, name, sub, on, icon, noCheck) {
    return '<button type="button" class="opt tx' + (on ? ' on' : '') + '" data-act="set" data-k="' + k + '" data-v="' + esc(v) + '">' +
      (on && !noCheck ? '<span class="ck">✓</span>' : '') + (icon ? '<i>' + esc(icon) + '</i>' : '') +
      '<span><span class="nm">' + esc(name) + '</span>' + (sub ? '<span class="sb">' + esc(sub) + '</span>' : '') + '</span></button>';
  }
  function optTh(k, v, name, sub, thumb, on, off) {
    if (off) {
      return '<div class="opt th off" aria-disabled="true"><span class="off-b">미지원</span><div class="thumb">' + thumb +
        '</div><div class="cp"><span class="nm">' + esc(name) + '</span><span class="sb">' + esc(sub) + '</span></div></div>';
    }
    return '<button type="button" class="opt th' + (on ? ' on' : '') + '" data-act="set" data-k="' + k + '" data-v="' + esc(v) + '">' +
      (on ? '<span class="ck">✓</span>' : '') + '<div class="thumb">' + thumb + '</div><div class="cp"><span class="nm">' +
      esc(name) + '</span>' + (sub ? '<span class="sb">' + esc(sub) + '</span>' : '') + '</div></button>';
  }
  function img(url, alt) { return '<img src="' + esc(url) + '" alt="' + esc(alt || '') + '" loading="lazy">'; }
  function input(bind, value, ph, extra, maxlen) {
    return '<input class="inp" data-bind="' + bind + '" value="' + esc(value) + '" placeholder="' + esc(ph || '') + '"' + (maxlen ? ' maxlength="' + maxlen + '"' : '') + (extra || '') + '>';
  }
  function area(bind, value, ph, cls, maxlen) {
    return '<textarea class="inp' + (cls ? ' ' + cls : '') + '" data-bind="' + bind + '" placeholder="' + esc(ph || '') + '"' + (maxlen ? ' maxlength="' + maxlen + '"' : '') + '>' + esc(value) + '</textarea>';
  }

  // ───────────── 인앱: 추천 받기 (프로토타입 질문 흐름 그대로) ─────────────
  function ctaChoicesFor(position, image) {
    if (position === 'top') return [];
    if (position === 'bottom' && image === 'full') return [];
    if (position === 'center' && image === 'full') return [0, 1, 2];
    return [0, 1];
  }
  function imageChoicesFor(position) {
    return position === 'bottom' ? ['full', 'thumb', 'none'] : ['full', 'none'];
  }
  function resolveQuiz() {
    var q = F.quiz;
    if (!F.inappContentCategory || !q.importance) return null;
    if (q.importance === 'yes') return q.htmlBehavior ? { html: q.htmlBehavior } : null;
    if (!q.position) return null;
    if (q.position === 'top') return { layout: 'slideup', sub: 'single' };
    if (!q.image) return null;
    if (q.position === 'center' && q.image === 'full' && q.hasText === '') return null;
    var ctas = ctaChoicesFor(q.position, q.image);
    var cta = ctas.length ? (q.cta === '' ? null : Number(q.cta)) : 0;
    if (cta === null) return null;
    if (q.position === 'bottom') {
      if (q.image === 'full') return { layout: 'bottom_image_full', sub: 'single' };
      if (q.image === 'thumb') return { layout: 'bottom_thumbnail', sub: cta >= 1 ? 'A' : 'B' };
      return cta >= 1 ? { layout: 'bottom_text_button_none', sub: 'single' } : { layout: 'bottom_text_none', sub: 'single' };
    }
    if (q.image === 'full') {
      return { layout: q.hasText === 'yes' ? 'modal_text_button_full' : 'modal_button_full', sub: cta === 0 ? 'D' : cta === 1 ? 'A' : 'C_lr' };
    }
    return cta >= 1 ? { layout: 'modal_text_button_none', sub: 'single' } : { layout: 'modal_text_none', sub: 'single' };
  }
  function applyQuiz() {
    var r = resolveQuiz();
    F.inappMessageFormat = ''; F.layoutGroup = ''; F.inappLayout = ''; F.inappLayoutSubtype = ''; F.inappHtmlType = '';
    if (!r) return;
    if (r.html) { F.inappMessageFormat = 'HTML'; F.inappHtmlType = r.html; return; }
    var l = layoutOf(r.layout);
    F.inappMessageFormat = '기본'; F.layoutGroup = l.group; F.inappLayout = l.key; F.inappLayoutSubtype = r.sub;
  }

  // ───────────── 상태 변경 ─────────────
  function setField(k, v) {
    if (U.editId && U.editLocked && (k === 'messageType' || k === 'desiredSendDate')) {   // 서버도 막는다
      toast(k === 'messageType' ? '검토가 시작된 요청은 메시지 유형을 바꿀 수 없어요' : ERR.send_date_needs_reason, true);
      return;
    }
    if (k.indexOf('quiz.') === 0) {
      var qk = k.slice(5);
      F.quiz[qk] = v;
      if (qk === 'importance') { F.quiz.position = F.quiz.image = F.quiz.hasText = F.quiz.cta = F.quiz.htmlBehavior = ''; }
      if (qk === 'position') { F.quiz.image = F.quiz.hasText = F.quiz.cta = ''; }
      if (qk === 'image') { F.quiz.hasText = F.quiz.cta = ''; }
      if (qk === 'hasText') { F.quiz.cta = ''; }
      applyQuiz();
      return;
    }
    if (k.indexOf('dl.') === 0) { F.dlValues[k.slice(3)] = v; return; }
    switch (k) {
      case 'messageType': F.messageType = v; U.suggest = { state: 'idle', variants: [], picked: -1 }; break;
      case 'inappContentCategory': F.inappContentCategory = v; if (F.inappMode === 'recommend') applyQuiz(); break;
      case 'inappMode': F.inappMode = v; if (v === 'recommend') applyQuiz(); break;
      case 'inappMessageFormat': F.inappMessageFormat = v; F.layoutGroup = ''; F.inappLayout = ''; F.inappLayoutSubtype = ''; F.inappHtmlType = ''; break;
      case 'layoutGroup': F.layoutGroup = v; F.inappLayout = ''; F.inappLayoutSubtype = ''; break;
      case 'inappLayout':
        F.inappLayout = v;
        var l = layoutOf(v);
        F.inappLayoutSubtype = l && l.subtypes.length === 1 ? l.subtypes[0].key : '';
        break;
      case 'inappTriggerType': F.inappTriggerType = v; break;
      case 'targetSheet': F.targetSheet = v; if (v === '전체') { F.targetHow = ''; F.targetConditionType = F.targetConditionBasis = F.targetConditionPeriod = ''; F.estimatedAudience = ''; F.deliveryMethod = 'none'; } else if (F.deliveryMethod === 'none') F.deliveryMethod = ''; break;
      case 'targetHow': F.targetHow = v; F.deliveryMethod = v === 'ask' ? 'unknown' : (F.deliveryMethod === 'unknown' || F.deliveryMethod === 'none' ? '' : F.deliveryMethod); break;
      case 'targetConditionType': F.targetConditionType = v; F.targetConditionBasis = ''; F.targetConditionPeriod = ''; break;
      case 'targetConditionBasis':
        F.targetConditionBasis = v;
        var pl = condPeriods().list;   // 기준마다 기간이 다르면 맞지 않는 기간은 비우고, 하나뿐이면 바로 채운다
        if (pl.indexOf(F.targetConditionPeriod) < 0) F.targetConditionPeriod = pl.length === 1 ? pl[0] : '';
        break;
      case 'estimatedAudience': F.estimatedAudience = F.estimatedAudience === v ? '' : v; break;
      case 'sendTimeBand': F.sendTimeBand = F.sendTimeBand === v ? '' : v; break;
      case 'audIdx': F.estimatedAudience = audBuckets()[Number(v)] || ''; break;
      case 'dlGroup': F.dlGroup = v; F.dlId = ''; F.dlValues = {}; F.dlFree = ''; break;
      case 'dlId': F.dlId = v; F.dlValues = {}; F.dlFree = ''; break;
      case 'deliveryMethod': F.deliveryMethod = v; break;
      default: F[k] = v;
    }
  }

  // ───────────── 딥링크 ─────────────
  function dlItems() { return B.deeplinks.items; }
  function dlDest() { return dlItems().filter(function (d) { return d.id === F.dlId; })[0] || null; }
  function composeLink() {
    var d = dlDest();
    if (!d) return { link: '', ok: !F.dlGroup, reason: F.dlGroup ? 'dest' : '' };
    if (d.free) {
      var q = F.dlFree.trim().replace(/^\?/, '');
      return { link: 'parkingshare://' + d.path + (q ? '?' + q : ''), ok: true };
    }
    var parts = [], ok = true;
    d.params.forEach(function (p) {
      var v = String(F.dlValues[p.key] || '').trim();
      if (!v) ok = false;
      if (p.choices && v && !p.choices.some(function (c) { return c[0] === v; })) ok = false;
      parts.push(p.key + '=' + (p.encode ? encodeURIComponent(v) : v));
    });
    return { link: 'parkingshare://' + d.path + (parts.length ? '?' + parts.join('&') : ''), ok: ok, reason: ok ? '' : 'param' };
  }

  // ───────────── 필수 항목 ─────────────
  // 슬라이드업은 왼쪽 그림을 직접 만든 이미지로 넣거나 브레이즈 기본 아이콘(이모지)으로 둘 수 있다
  function slideVisualFields() {
    var pick = { field: 'slideVisual', label: '왼쪽 그림', choice: [{ v: 'image', l: '이미지 직접 넣기' }, { v: 'emoji', l: '브레이즈 기본 아이콘' }] };
    return F.slideVisual === 'emoji'
      ? [pick, { field: 'slideEmoji', label: '아이콘', required: true, hint: '이모지 하나. 예) 🚗' }]   // 이모지는 글자 수 계산이 달라 카운터를 두지 않는다
      : [pick, { field: 'imageUrl', label: '이미지 주소', required: true, hint: '이미지를 올린 주소. 아직 없으면 준비 중이라고 적어 주세요' }];
  }
  function copyFieldsFor() {
    if (F.messageType === 'push') {
      // 제한(넘겨 쓸 수 없음): 제목 20자 · 본문 100자. 경고(줄바꿈·영역 넘침)는 미리보기를 재서 띄운다
      return [{ field: 'copyTitle', label: '제목', required: true, maxlen: 20 }, { field: 'copyBody', label: '본문', required: true, area: true, maxlen: 100 }];
    }
    if (F.inappMessageFormat === 'HTML') {
      var t = htmlTypeOf(F.inappHtmlType);
      if (!t) return null;
      var hf = t.copy_fields.map(function (f) {
        return { field: f.field, label: f.label, hint: f.hint, maxlen: f.maxlen, required: f.required !== false, area: f.field === 'copyBody' };
      });
      return t.value === 'S' ? slideVisualFields().concat(hf) : hf;
    }
    var l = layoutOf(F.inappLayout), s = subtypeOf(l, F.inappLayoutSubtype);
    if (!l || !s) return null;
    var out = [];
    if (l.key === 'slideup') out = out.concat(slideVisualFields());
    else if (l.has_image) out.push({ field: 'imageUrl', label: l.has_image === 'thumbnail' ? '썸네일 이미지 주소' : '이미지 주소', required: true, hint: '이미지를 올린 주소. 아직 없으면 준비 중이라고 적어 주세요' });
    // 인앱 기본 레이아웃: 제목 25자 · 본문 80자(팀 확인 전 잠정값). HTML 타입은 서버 정의를 따른다
    if (l.has_title) out.push({ field: 'copyTitle', label: '제목', required: true, maxlen: 25 });
    if (l.has_body) out.push({ field: 'copyBody', label: '본문', required: true, area: true, maxlen: 80 });
    if (s.cta_count >= 1) out.push({ field: 'copyCta', label: s.cta_count >= 2 ? '첫 번째 버튼 문구' : '버튼 문구', required: true, maxlen: s.cta_maxlen });
    if (s.cta_count >= 2) out.push({ field: 'copyCta2', label: '두 번째 버튼 문구', required: true, maxlen: s.cta_maxlen });
    return out;
  }
  function missing() {
    var m = [];
    function add(label, sec) { m.push({ label: label, sec: sec }); }
    if (!F.team.trim()) add('요청팀', 'requester');
    if (!F.campaignName.trim()) add('캠페인명', 'requester');
    if (F.messageType === 'inapp') {
      if (!F.inappContentCategory) add('내용 분류', 'inapp');
      var okLayout = F.inappMessageFormat === 'HTML' ? !!F.inappHtmlType : !!(F.inappLayout && F.inappLayoutSubtype);
      if (!okLayout) add('형태·레이아웃', 'inapp');
      if (!F.inappTriggerType) add('노출 트리거', 'inapp');
      else if (F.inappTriggerType === 'event' && !F.inappTriggerEventName.trim()) add('트리거 이벤트', 'inapp');
    }
    if (!F.desiredSendDate) add('발송 희망일', 'schedule');
    else if (F.desiredSendDate < B.schedule.minSendDate && !(U.editId && F.desiredSendDate === U.editDate)) add('발송 희망일', 'schedule');
    if (!F.targetSheet) add('타겟 그룹', 'target');
    var cc = F.targetSheet === '타겟' && F.targetHow === 'ask' ? curCond() : null;
    if (cc && cc.bases && cc.bases.length && !F.targetConditionBasis) add('조건 기준', 'target');
    var cf = copyFieldsFor();
    if (cf) {
      cf.forEach(function (f) {
        if (f.required && !String(F[f.field] || '').trim()) add(f.label, 'copy');
        if (f.maxlen && String(F[f.field] || '').length > f.maxlen) add(f.label + ' 글자 수', 'copy');
      });
    }
    var lk = composeLink();
    if (!lk.ok) add(lk.reason === 'dest' ? '도착 화면' : '링크 입력 항목', 'link');
    if (F.targetSheet === '타겟') {
      if (!F.targetHow) add('대상 준비', 'target');
      else if (F.targetHow === 'self') {
        if (F.deliveryMethod !== 'sql' && F.deliveryMethod !== 'file') add('전달 방식', 'target');
        else if (F.deliveryMethod === 'sql' && !F.sqlQuery.trim()) add('SQL문', 'target');
        else if (F.deliveryMethod === 'file' && !F.fileInfo) add('회원번호 파일', 'target');
      } else if (!F.targetConditionType) add('조건 유형', 'target');
    }
    return m;
  }

  // ───────────── 폼 섹션 ─────────────
  function secRequester() {
    if (U.editId && U.editRequester) {   // 수정 중에는 로그인한 편집자가 아니라 원 요청자를 보인다(요청자·팀은 바뀌지 않는다)
      var rq = U.editRequester;
      return frow('요청자', '<div class="prof"><span class="av">' + esc((rq.nickname || rq.email || '?').slice(0, 1)) + '</span><div><div class="nm">' +
        esc(rq.nickname || rq.email) + (F.team ? ' · ' + esc(F.team) : '') + '</div><div class="sb">' + esc(rq.email) + '</div></div><span class="tag-co">원 요청자</span></div>') +
        frow('캠페인명', input('campaignName', F.campaignName, '예) 8월 여름휴가 프로모션'), 'req');
    }
    var me = B.me, teams = me.teams || [];
    if (teams.length === 1 && !F.team) F.team = teams[0];
    var name = esc(me.nickname || me.email) + (teams.length === 1 ? ' · ' + esc(teams[0]) : '');
    var html = frow('요청자', '<div class="prof"><span class="av">' + esc((me.nickname || '?').slice(0, 1)) + '</span><div><div class="nm">' +
      name + '</div><div class="sb">' + esc(me.email) + '</div></div><span class="tag-co">로그인 계정 자동 입력</span></div>');
    if (teams.length > 1) {
      html += frow('요청팀', '<div class="chips">' + teams.map(function (t) {
        return '<button type="button" class="chip' + (F.team === t ? ' on' : '') + '" data-act="set" data-k="team" data-v="' + esc(t) + '">' + esc(t) + '</button>';
      }).join('') + '</div><div class="hint">겸직이라 팀이 둘이에요. 이번 요청을 보내는 팀을 골라 주세요</div>', 'req');
    } else if (!teams.length) {
      html += frow('요청팀', input('team', F.team, '예) 기획운영팀') + '<div class="hint">조직도에서 팀을 찾지 못했어요. 직접 적어 주세요</div>', 'req');
    }
    html += frow('캠페인명', input('campaignName', F.campaignName, '예) 8월 여름휴가 프로모션'), 'req');
    return html;
  }

  function secType() {
    var ms = opt('messageTypes');
    return '<div class="opts c5">' + ms.map(function (m) {
      return optTh('messageType', m.value, m.label, m.desc, PICS[m.value] || '', F.messageType === m.value, !m.supported);
    }).join('') + '</div>';
  }

  function recoCard() {
    var r = resolveQuiz();
    if (!r) return '';
    if (r.html) {
      var t = htmlTypeOf(r.html);
      return '<div class="reco">' + (t.screenshotUrl ? img(t.screenshotUrl, t.label) : PICS.custom) + '<div><b>추천: ' + esc(t.label) + '</b><span>' + esc(t.detail) +
        '. 다른 형태가 필요하면 직접 선택에서 바꿀 수 있어요</span></div></div>';
    }
    var l = layoutOf(r.layout), s = subtypeOf(l, r.sub);
    return '<div class="reco">' + img(l.screenshotUrl, l.label) + '<div><b>추천: ' + esc(l.group + ' · ' + l.label) +
      (l.subtypes.length > 1 ? ', ' + esc(s.label) : '') + '</b><span>메시지 문구에 이 레이아웃에 맞는 입력칸이 열려요. 다른 레이아웃은 직접 선택에서 바꿀 수 있어요</span></div></div>';
  }

  function quizHtml() {
    var q = F.quiz, h = '';
    if (!F.inappContentCategory) return '';
    h += frow('중요도', '<div class="opts c2">' +
      optTx('quiz.importance', 'yes', '꼭 확인해야 해요', '놓치면 예약·이용에 영향', q.importance === 'yes') +
      optTx('quiz.importance', 'no', '참고만 하면 돼요', '알리는 정도로 충분', q.importance === 'no') + '</div>');
    if (q.importance === 'yes') {
      h += frow('직후 화면', '<div class="opts c2">' +
        optTx('quiz.htmlBehavior', 'S', '잠깐 보여 주고 넘어가요', '뒤 화면은 계속 쓸 수 있어요', q.htmlBehavior === 'S') +
        optTx('quiz.htmlBehavior', 'M', '확인할 때까지 멈춰요', '확인하고 전환까지 이어져요', q.htmlBehavior === 'M') + '</div>');
    }
    if (q.importance === 'no') {
      var pos = [['center', '전면팝업'], ['bottom', '하단팝업'], ['top', '슬라이드업']];
      h += frow('노출 강도', '<div class="opts c3">' + pos.map(function (p) {
        var g = opt('layoutGroups').filter(function (x) { return x.value === p[1]; })[0];
        return optTh('quiz.position', p[0], p[1], g ? g.desc : '', img(g.sampleUrl, p[1]), q.position === p[0]);
      }).join('') + '</div>');
      if (q.position && q.position !== 'top') {
        var names = { full: ['큰 이미지', '이미지가 주인공'], thumb: ['작은 썸네일', '텍스트 옆 작은 이미지'], none: ['텍스트만', '이미지 없이'] };
        var ic = imageChoicesFor(q.position);
        h += frow('이미지', '<div class="opts c' + ic.length + '">' + ic.map(function (v) {
          return optTx('quiz.image', v, names[v][0], names[v][1], q.image === v);
        }).join('') + '</div>');
        if (q.position === 'center' && q.image === 'full') {
          h += frow('글자', '<div class="opts c2">' + optTx('quiz.hasText', 'yes', '제목·본문도 보여요', '', q.hasText === 'yes') +
            optTx('quiz.hasText', 'no', '이미지와 버튼만', '', q.hasText === 'no') + '</div>');
        }
        var ready = q.image && !(q.position === 'center' && q.image === 'full' && !q.hasText);
        var cc = ctaChoicesFor(q.position, q.image);
        if (ready && cc.length) {
          var cl = { 0: '버튼 없음', 1: '버튼 1개', 2: '버튼 2개' };
          h += frow('버튼', '<div class="opts c' + cc.length + ' tm">' + cc.map(function (c) {
            return optTx('quiz.cta', String(c), cl[c], '', q.cta === String(c), '', true);
          }).join('') + '</div>');
        }
      }
    }
    return h + recoCard();
  }

  function directHtml() {
    var h = frow('형태', '<div class="opts c2">' +
      optTh('inappMessageFormat', '기본', '기본 인앱메시지', 'Braze 템플릿 9종에서 선택', PICS.inapp, F.inappMessageFormat === '기본') +
      optTh('inappMessageFormat', 'HTML', '커스텀 인앱메시지', '직접 디자인한 HTML 2종', PICS.custom, F.inappMessageFormat === 'HTML') + '</div>', 'req');
    if (F.inappMessageFormat === '기본') {
      h += frow('레이아웃 분류', '<div class="opts c3">' + opt('layoutGroups').map(function (g) {
        return optTh('layoutGroup', g.value, g.value, g.desc, img(g.sampleUrl, g.value), F.layoutGroup === g.value);
      }).join('') + '</div>', 'req');
      if (F.layoutGroup) {
        var ls = opt('inappLayouts').filter(function (l) { return l.group === F.layoutGroup; });
        h += frow('레이아웃', '<div class="opts c' + Math.min(ls.length, 4) + '">' + ls.map(function (l) {
          return optTh('inappLayout', l.key, l.label, '', img(l.screenshotUrl, l.label), F.inappLayout === l.key);
        }).join('') + '</div>', 'req');
      }
      var l = layoutOf(F.inappLayout);
      if (l && l.subtypes.length > 1) {
        h += frow('세부 타입', '<div class="opts c' + Math.min(l.subtypes.length, 5) + ' subs">' + l.subtypes.map(function (s) {
          var on = F.inappLayoutSubtype === s.key, lb = s.label.split(' · ');
          return '<button type="button" class="opt sub' + (on ? ' on' : '') + '" data-act="set" data-k="inappLayoutSubtype" data-v="' + esc(s.key) + '">' +
            (on ? '<span class="ck">✓</span>' : '') + '<span class="sub-pic">' + (SUB_PIC[s.key] || SUB_PIC.A) + '</span><span class="nm">' + esc(lb[0]) + '</span><span class="sb">' + esc(lb[1] || '') + '</span></button>';
        }).join('') + '</div>', 'req');
      }
    }
    if (F.inappMessageFormat === 'HTML') {
      h += frow('타입', '<div class="opts c2">' + opt('inappHtmlTypes').map(function (t) {
        return optTx('inappHtmlType', t.value, t.label, t.detail, F.inappHtmlType === t.value);
      }).join('') + '</div>', 'req');
    }
    return h;
  }

  function specLine() {
    if (F.inappMessageFormat === 'HTML') {
      var t = htmlTypeOf(F.inappHtmlType);
      return t ? '<div class="spec">' + esc(t.label) + ' · ' + esc(t.purpose) + '</div>' : '';
    }
    var l = layoutOf(F.inappLayout), s = subtypeOf(l, F.inappLayoutSubtype);
    if (!l || !s) return '';
    return '<div class="spec">닫기 버튼: ' + esc(s.close) + ' · 버튼 ' + s.cta_count + '개' +
      (s.cta_maxlen ? ' · 버튼 문구 ' + s.cta_maxlen + '자 이내' : '') + '</div>';
  }

  function secInapp() {
    var h = '<div class="seg"><button type="button" class="' + (F.inappMode === 'recommend' ? 'on' : '') + '" data-act="set" data-k="inappMode" data-v="recommend">추천 받기</button>' +
      '<button type="button" class="' + (F.inappMode === 'direct' ? 'on' : '') + '" data-act="set" data-k="inappMode" data-v="direct">직접 선택</button></div>';
    h += frow('내용 분류', '<div class="opts c2">' + opt('inappContentCategories').map(function (c) {
      return optTx('inappContentCategory', c.value, c.label, '', F.inappContentCategory === c.value, c.icon);
    }).join('') + '</div>', 'req');
    h += F.inappMode === 'recommend' ? quizHtml() : directHtml();
    h += specLine();
    h += frow('노출 트리거', '<div class="opts c2">' +
      optTx('inappTriggerType', 'event', '커스텀 이벤트 발생 시', '지정한 이벤트 직후 노출', F.inappTriggerType === 'event') +
      optTx('inappTriggerType', 'session_start', '세션 시작 시', '앱 실행 후 지연 시간 뒤 노출', F.inappTriggerType === 'session_start') + '</div>', 'req');
    if (F.inappTriggerType === 'event') {
      var evs = opt('customEvents');
      // 큰 카드: 상황 이름과 어느 화면인지. 이벤트명은 세팅 담당자용이라 보여 주지 않는다
      h += frow('트리거 이벤트', '<div class="opts c3">' + evs.map(function (e) {
        return optTx('inappTriggerEventName', e.value, e.label, e.desc || '', F.inappTriggerEventName === e.value);
      }).join('') + '</div><div class="field" style="margin-top:12px">' +
        input('inappTriggerEventName', evs.some(function (e) { return e.value === F.inappTriggerEventName; }) ? '' : F.inappTriggerEventName,
          '목록에 없는 상황이면 어떤 화면의 어떤 순간인지 적어 주세요') + '</div>', 'req');
    }
    if (F.inappTriggerType === 'session_start') {
      h += frow('지연 시간', input('inappTriggerDelaySeconds', F.inappTriggerDelaySeconds, '예) 3', ' inputmode="numeric" style="max-width:160px"') +
        '<div class="hint">세션 시작 후 몇 초 뒤에 띄울지 적어 주세요. 비워 두면 기획운영팀이 정해요</div>', true);
    }
    return h;
  }

  // 실제로 고를 수 있는 첫날: 영업일 기준 최소일에서 시작해 발송이 이미 잡힌 날은 건너뛴다(요청 종류와 무관)
  function firstOpenDate() {
    var S = B.schedule, d = parse(S.minSendDate);
    for (var n = 0; n < 120; n++, d.setDate(d.getDate() + 1)) {
      if (!((S.busy || {})[iso(d)] || []).length) return iso(d);
    }
    return S.minSendDate;
  }

  // 달력 한 달. nav 는 'L'(이전 달 버튼만) · 'R'(다음 달 버튼만) · 기본(둘 다)
  function calendar(foot, offset, nav) {
    var S = B.schedule, min = S.minSendDate, open = firstOpenDate(), today = S.today;
    var hol = {};
    S.holidays.forEach(function (h) { hol[h.date] = h.name; });
    var base = U.calMonth || parse(F.desiredSendDate || min);
    base = new Date(base.getFullYear(), base.getMonth(), 1);
    U.calMonth = base;
    if (offset) base = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    var minM = parse(min), first = new Date(minM.getFullYear(), minM.getMonth(), 1);
    var last = new Date(first.getFullYear(), first.getMonth() + 4, 1);
    var cells = '일월화수목금토'.split('').map(function (c) { return '<span class="dn">' + c + '</span>'; }).join('');
    for (var i = 0; i < base.getDay(); i++) cells += '<span></span>';
    for (var d = new Date(base); d.getMonth() === base.getMonth(); d.setDate(d.getDate() + 1)) {
      var s = iso(d), cls = ['c'], sub = '';
      if (d.getDay() === 0) cls.push('sun');
      if (hol[s]) { cls.push('hol'); sub = hol[s].split(' ')[0]; }
      if (s === today) { cls.push('today'); sub = '오늘'; }
      if (s === open) { cls.push('min'); sub = '최소'; }
      if (s === F.desiredSendDate) { cls.push('sel'); sub = '선택'; }
      var bz = (S.busy || {})[s] || [], hasPush = bz.some(function (b) { return b.type === 'push'; }), hasIn = bz.some(function (b) { return b.type !== 'push'; });
      var blocked = bz.length > 0;   // 앱푸시·인앱 구분 없이 발송이 잡힌 날은 막는다
      if (blocked && !cls.some(function (c) { return c === 'sel' || c === 'today'; })) sub = '예정';
      cells += '<button type="button" class="' + cls.join(' ') + (blocked ? ' blk' : '') + '"' + (s < min || blocked ? ' disabled' : ' data-act="set" data-k="desiredSendDate" data-v="' + s + '"') +
        (bz.length ? ' title="' + esc(bz.map(function (b) { return b.name; }).join(', ')) + (blocked ? ' · 발송이 잡힌 날은 고를 수 없어요' : '') + '"' : '') +
        '><b>' + d.getDate() + '</b><i>' + esc(sub) + '</i>' + (hasPush ? '<em class="bz"></em>' : '') + (hasIn ? '<em class="bz in"></em>' : '') + '</button>';
    }
    var prev = '<button type="button" data-act="cal" data-v="-1"' + (nav === 'R' ? ' class="hd"' : '') + (U.calMonth <= first ? ' disabled' : '') + ' aria-label="이전 달">‹</button>';
    var next = '<button type="button" data-act="cal" data-v="1"' + (nav === 'L' ? ' class="hd"' : '') + (new Date(U.calMonth.getFullYear(), U.calMonth.getMonth() + 2, 1) >= last ? ' disabled' : '') + ' aria-label="다음 달">›</button>';
    return '<div class="cal"><div class="cal-h">' + prev + '<span>' + base.getFullYear() + '년 ' + (base.getMonth() + 1) + '월</span>' +
      next + '</div><div class="cal-g">' + cells + '</div>' + (foot || '') + '</div>';
  }

  var MOON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  // 시간대 특징 썸네일(이모지). 선택지 값이 바뀌면 시계로 대신한다.
  var BAND_EMO = { am: '🌅', lunch: '🍱', pm: '☕', eve: '🌆', any: '🎯' };

  // 방해금지 안내 문구는 여기 한 곳에서만 정한다(법정 21시보다 1시간 앞당긴 사내 기준)
  function quietNote() {
    var Q = B.schedule.quietHours, range = pad(Q.start) + ':00-' + pad(Q.end) + ':00';
    return { label: '방해금지', range: range, help: '광고 푸시 발송 불가' };
  }

  // 달력 오른쪽 세 칸: 최소 발송일 설명 · 급한 건 안내 · 달력 선택 가이드(고르면 선택한 날로 바뀜)
  var IC_CALOK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4M9 15.5l2 2 4-4"/></svg>';
  var IC_FLAG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4h12l-2.5 4L17 12H5"/></svg>';
  var IC_RUSH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/></svg>';
  var IC_TAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11.5V6a2 2 0 0 1 4 0v5"/><path d="M13 10.5a2 2 0 0 1 4 0v2M17 12a2 2 0 0 1 3 1.7V16a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.2L5.2 16a1.8 1.8 0 0 1 2.6-2.5L9 15v-3.5"/></svg>';
  function busyOn(day) { return (B.schedule.busy || {})[day] || []; }
  // 달력 오른쪽 패널: 위는 고른 날짜 한 줄, 아래는 이달 일정(잡힌 발송·연휴)을 날짜순 목록으로. 문장 설명은 두지 않는다
  function ruleFoot() {
    var S = B.schedule, sel = F.desiredSendDate, minD = parse(S.minSendDate), open = firstOpenDate();
    // 설명은 물음표를 눌렀을 때만 말풍선으로
    var pop = '<div class="tl-pop">' + IC_CALOK + '<div><b>최소 발송일 ' + esc(md(open)) + '</b><span>접수일 + 영업일 ' + S.leadDays + '일 뒤부터 고를 수 있어요</span>' +
      (open !== S.minSendDate ? '<span>발송이 이미 잡힌 날은 건너뛰어요</span>' : '') + '<span class="dim">더 급하면 요청사항에 사유를 적어 주세요</span></div></div>';
    var head = '<span class="k">발송 희망일<span class="qwrap' + (U.sqOpen ? ' open' : '') + '"><button type="button" class="qb" data-act="sq" aria-label="최소 발송일 설명">?</button>' + pop + '</span></span>';
    if (sel) head += '<div class="dl"><b>' + esc(md(sel)) + '</b></div>';
    else head += '<div class="dl"><b class="dim">선택 전</b><span class="from">' + esc(md(open)) + '부터</span></div>';
    var ym = (U.calMonth ? iso(U.calMonth) : S.minSendDate).slice(0, 7), mo = Number(ym.slice(5, 7));
    var rows = [];
    Object.keys(S.busy || {}).forEach(function (k) {
      if (k.slice(0, 7) !== ym) return;
      busyOn(k).forEach(function (x) { rows.push({ d: parse(k).getDate(), end: 0, n: x.name, t: x.type === 'push' ? 'bz' : 'bz in', on: k === sel }); });
    });
    var hol = {};
    S.holidays.forEach(function (h) { if (h.date.slice(0, 7) === ym) { var n = h.name.split(' ')[0]; (hol[n] = hol[n] || []).push(parse(h.date).getDate()); } });
    Object.keys(hol).forEach(function (n) { var ds = hol[n]; rows.push({ d: ds[0], end: ds.length > 1 ? ds[ds.length - 1] : 0, n: n, t: 'hol' }); });
    rows.sort(function (a, b) { return a.d - b.d; });
    var list = rows.length ? rows.map(function (r) {
      return '<div class="ev' + (r.on ? ' on' : '') + '"><span class="ev-d">' + r.d + (r.end ? '-' + r.end : '') + '</span><i class="ev-i ' + r.t + '"></i><span class="ev-n">' + esc(r.n) + '</span></div>';
    }).join('') : '<div class="ev none">예정된 발송이나 연휴가 없어요</div>';
    return '<div class="cal-side"><div class="sidep"><div class="sp-h">' + head + '</div>' +
      '<div class="sp-b"><span class="k">' + mo + '월 발송 일정</span><span class="sub">' + '예정된 발송·요청 · 잡힌 날은 선택 불가' + '</span>' + list + '</div>' +
      '<div class="sp-f"><span><i class="ev-i bz"></i>앱푸시</span><span><i class="ev-i bz in"></i>인앱</span><span><i class="ev-i hol"></i>연휴</span></div></div></div>';
  }

  function timeOpts() {
    return '<div class="topts">' + opt('timeBands').map(function (b) {
      return '<button type="button" class="topt' + (F.sendTimeBand === b.value ? ' on' : '') + '" data-act="set" data-k="sendTimeBand" data-v="' + b.value + '">' +
        '<span class="emo" aria-hidden="true">' + (BAND_EMO[b.value] || '🕒') + '</span><span class="nm">' + esc(b.label) + '</span><span class="rg">' + esc(b.range) + '</span></button>';
    }).join('') + '</div>';
  }

  var IC_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/></svg>';
  // 하루 막대: 방해금지 구간은 밤(어두운 띠 + 달), 낮은 밝은 띠, 고른 시간대는 파란 칸. 설명은 아래 회색 글자를 누르면 말풍선으로
  function timeline(quiet) {
    var Q = B.schedule.quietHours, b = band(F.sendTimeBand), qn = quietNote();
    function pct(h) { return (h / 24 * 100).toFixed(3) + '%'; }
    var sel = b && b.start != null ? '<span class="sel" style="left:' + pct(b.start) + ';width:' + pct(b.end - b.start) + '"></span>' : '';
    // 눈금은 시간대 경계마다: 0 · 8 · 12 · 14 · 18 · 20 · 24
    var edges = [0, 24].concat(opt('timeBands').filter(function (x) { return x.start != null; }).map(function (x) { return [x.start, x.end]; }).reduce(function (a, c) { return a.concat(c); }, []));
    if (quiet) edges.push(Q.start, Q.end);
    var ticks = edges.slice();
    var dv = edges.filter(function (h) { return h > 0 && h < 24; }).map(function (h) { return '<span class="dv" style="left:' + pct(h) + '"></span>'; }).join('');
    var seen = {}, tk = ticks.filter(function (h) { if (seen[h]) return false; seen[h] = 1; return true; }).sort(function (a, c) { return a - c; });
    var q = '<span class="q-in">' + MOON + '<span class="qt">방해금지</span></span>';
    var qs = quiet ? '<span class="q" style="left:0;width:' + pct(Q.end) + '">' + q + '</span><span class="q r" style="left:' + pct(Q.start) + ';width:' + pct(24 - Q.start) + '">' + q + '</span>' : '';
    return '<div class="tl"><div class="tl-track">' + dv + qs + sel + '</div>' +
      '<div class="tl-ticks">' + tk.map(function (h) { return '<span style="left:' + pct(h) + '">' + h + '시</span>'; }).join('') + '</div>' +
      (quiet ? '<div class="tl-info' + (U.qtOpen ? ' open' : '') + '"><button type="button" data-act="qt">' + IC_INFO + '<span>방해금지 시간이 뭔가요</span></button>' +
      '<div class="tl-pop">' + MOON + '<div><b>' + esc(qn.label + ' ' + qn.range) + '</b><span>' + esc(qn.help) + '</span><span class="dim">법정 야간 광고 제한(21시)보다 1시간 앞당긴 사내 기준</span></div></div></div>' : '') + '</div>';
  }

  function secSchedule() {
    var push = F.messageType === 'push';
    // 두 달을 나란히 두고, 최소 발송일·선택한 날은 그 아래 한 줄
    return frow('발송 희망일', '<div class="dwrap2">' + calendar('') + ruleFoot() + '</div>', 'req') +
      frow(push ? '발송 시간' : '노출 시작', timeOpts() + timeline(push)) +
      frow('요청사항', input('sendTimeNote', F.sendTimeNote, '예) 점검 시간대 제외, 10시 정각 발송 희망'), '', 'sp');
  }

  // 타겟 그룹을 고를 때 볼 장단점(선택지 값이 바뀌면 문구는 빠진다)
  var TG_NOTE = {
    '전체': ['가장 넓게 도달 · 준비가 간단', '관심 없는 회원의 피로도·수신 거부 증가'],
    '타겟': ['관련 있는 회원이라 반응률이 높음', '모수가 작고 조건 추출 준비가 필요'],
  };
  var IC_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  // 인앱메시지는 수신 동의 확인이 없어 전체·타겟 설명을 따로 둔다
  function scopeDesc(t) { return F.messageType === 'push' ? t.desc : (t.value === '전체' ? '앱을 여는 회원 전체 · 넓게 닿지만 피로도 주의' : '조건에 맞는 회원만 · 반응률 높고 모수 작음'); }
  function allLabel(type) { return type === 'inapp' ? '앱 사용자 전체' : '수신 동의 회원 전체'; }
  var IC_OK = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8"/><path d="M4.7 8.3l2.1 2.1 4.5-4.7" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var IC_WARN = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8"/><path d="M8 4.3v4.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/><circle cx="8" cy="11.5" r="1.05" fill="#fff"/></svg>';
  var IC_USERS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/><circle cx="17" cy="9" r="2.6"/><path d="M16 14.2c3 .2 5.5 2.7 5.5 5.8"/></svg>';
  var IC_FUNNEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 5h17l-6.5 8v6l-4 2v-8z"/></svg>';
  var COND_IC = {
    '최근 이용': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    '지역': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6.5 9 4l6 2.5 5.5-2.5v13.5L15 20l-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/></svg>',
    '이벤트·캠페인 참여': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l1.9 4.6 5 .4-3.8 3.3 1.2 4.9L12 14.1l-4.3 2.6 1.2-4.9L5.1 8.5l5-.4z"/><path d="M19.5 17.5v3M18 19h3"/></svg>',
    '기타': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/></svg>',
  };
  var IC_DB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/></svg>';
  var IC_HAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5V7a1.5 1.5 0 0 1 3 0v5M7 11V5a1.5 1.5 0 0 1 3 0v6M10 11V6a1.5 1.5 0 0 1 3 0v6M13 12V8a1.5 1.5 0 0 1 3 0v6.5c0 3.6-2.4 6.5-6 6.5s-6-2.5-6-6.5l-1.6-3.2a1.4 1.4 0 0 1 2.4-1.3L4 12.5"/></svg>';
  // 선택지가 둘뿐인 행은 내용 폭 알약으로 두고, 고른 항목의 설명 한 줄만 아래에 보여 준다
  function pillRow(k, cur, items) {
    return '<div class="opts c2">' + items.map(function (x) {
      return '<button type="button" class="opt tx card-ic' + (x.v === cur ? ' on' : '') + '" data-act="set" data-k="' + k + '" data-v="' + esc(x.v) + '">' +
        (x.v === cur ? '<span class="ck">✓</span>' : '') + (x.ic ? '<span class="pi">' + x.ic + '</span>' : '') +
        '<span><span class="nm">' + esc(x.nm) + '</span>' + (x.sb ? '<span class="sb">' + esc(x.sb) + '</span>' : '') + '</span></button>';
    }).join('') + '</div>';
  }
  function secTarget() {
    var h = frow('타겟 그룹', pillRow('targetSheet', F.targetSheet, opt('targetScopes').map(function (t) {
      return { v: t.value, nm: t.value, sb: scopeDesc(t), ic: t.value === '전체' ? IC_USERS : IC_FUNNEL };
    })), 'req');
    if (F.targetSheet === '타겟') {
      h += frow('대상 준비', pillRow('targetHow', F.targetHow, [
        { v: 'self', nm: '직접 뽑아서 전달', sb: 'SQL문 또는 회원번호 파일로 대상을 넘겨요', ic: IC_DB },
        { v: 'ask', nm: '조건으로 요청', sb: '조건을 적으면 기획운영팀이 대상을 뽑아요', ic: IC_HAND }]), 'req');
      if (F.targetHow === 'self') h += deliveryRows();
      if (F.targetHow === 'ask') h += conditionRows();
    }
    return h + frow('예상 모수', audBlock());
  }
  function conditionRows() {
    var cs = conds(), cur = curCond();
    var h = frow('조건 유형', '<div class="opts c' + Math.min(Math.max(cs.length, 2), 4) + '">' + cs.map(function (c) {
      var on = F.targetConditionType === c.value;
      return '<button type="button" class="opt cnd' + (on ? ' on' : '') + '" data-act="set" data-k="targetConditionType" data-v="' + esc(c.value) + '">' +
        (on ? '<span class="ck">✓</span>' : '') + '<span class="cic">' + (COND_IC[c.value] || '') + '</span><span class="nm">' + esc(c.value) + '</span><span class="sb">' + esc(c.desc || '') + '</span></button>';
    }).join('') + '</div>', 'req');
    // 고른 유형의 기준과 세부 조건은 한 판에. 기간·반경은 팀이 정하니 요청자에게 묻지 않는다
    var pane = '';
    if (cur && cur.bases && cur.bases.length) {
      pane += '<div class="pl">기준' + REQ + '</div><div class="radios">' + cur.bases.map(function (b) {
        var on = F.targetConditionBasis === b.value;
        return '<button type="button" class="radio' + (on ? ' on' : '') + '" data-act="set" data-k="targetConditionBasis" data-v="' + esc(b.value) + '">' +
          '<i></i><span><span class="rn">' + esc(b.value) + '</span><span class="rd">' + esc(b.desc || '') + '</span></span></button>';
      }).join('') + '</div>';
    }
    pane += '<div class="pl">부연 설명</div>' + area('targetDetail', F.targetDetail, (cur && cur.hint) || '예) 작년 불꽃축제 기간 여의도 주차장 이용 회원');
    return h + frow('세부 조건', '<div class="cpane' + (cur ? '' : ' off') + '">' + (cur ? pane : '<div class="cp-empty">조건 유형을 먼저 골라 주세요</div>') + '</div>');
  }

  function conds() { return opt('targetConditions').map(function (c) { return typeof c === 'string' ? { value: c } : c; }); }
  function curCond() { var v = F.targetConditionType; return conds().filter(function (c) { return c.value === v; })[0] || null; }
  function curBasis() { var c = curCond(), v = F.targetConditionBasis; return c && c.bases ? c.bases.filter(function (b) { return b.value === v; })[0] || null : null; }
  // 기간 선택지: 고른 기준에 기간이 있으면 그것(행사장 반경처럼 라벨이 다를 수 있다), 기준에 기간이 없으면 조건 유형의 기간
  function condPeriods() {
    var c = curCond(), b = curBasis();
    if (b && b.periods && b.periods.length) return { label: b.periodLabel || '기간', list: b.periods };
    var perBasis = c && c.bases && c.bases.some(function (x) { return x.periods; });
    if (c && !perBasis && c.periods && c.periods.length) return { label: c.periodLabel || '기간', list: c.periods };
    return { label: '기간', list: [] };
  }
  // 요약·상세에 쓰는 조건 한 줄: 유형 · 기준 · 기간
  function condLabel(r) {
    if (r.targetSheet === '전체') return '해당 없음';
    return [r.targetConditionType, r.targetConditionBasis, r.targetConditionPeriod].filter(Boolean).join(' · ');
  }

  // ───────────── 예상 모수: 굵은 막대와 값 말풍선 ─────────────
  // 보이지 않는 range 입력을 위에 깔아 끌기·키보드 조작을 받는다
  function audBuckets() { return opt('audienceBuckets').filter(function (a) { return a !== '모름'; }); }
  function audShort(a) { return String(a || '').replace('명', ''); }
  function audBlock() {
    var bs = audBuckets(), last = Math.max(bs.length - 1, 1), all = F.targetSheet === '전체', unk = F.estimatedAudience === '모름';
    var idx = bs.indexOf(F.estimatedAudience), lock = all || unk;
    var notch = '';
    for (var k = 1; k < last; k++) notch += '<i style="left:' + (k / last * 100) + '%"></i>';
    var stops = bs.map(function (a, i) {
      return '<button type="button" class="' + (i === idx ? 'on' : '') + '" data-i="' + i + '" data-act="set" data-k="audIdx" data-v="' + i + '"' + (lock ? ' disabled' : '') +
        '><span data-s="' + esc(audShort(a).replace(/(\d+)만-(\d+)만/, '$1-$2만').replace(/(\d+)만 이상/, '$1만+')) + '">' + esc(audShort(a)) + '</span></button>';
    }).join('');
    return '<div class="aud' + (all ? ' all' : '') + (unk ? ' unk' : '') + (idx < 0 && !all ? ' unset' : '') + '" id="aud">' +
      '<div class="a1" style="--f:' + (all ? 1 : (idx >= 0 ? idx / last : 0)) + '"><div class="a1-r"><div class="a1-trk"><div class="a1-fill"></div>' + notch + '</div>' +
      '<div class="a1-th"><span class="a1-bub" data-aud-b>' + esc(idx >= 0 ? audShort(bs[idx]) : '') + '</span></div>' +
      '<input type="range" min="0" max="' + last + '" step="1" value="' + (idx >= 0 ? idx : 0) + '" data-aud aria-label="예상 모수"' + (lock ? ' disabled' : '') + '></div>' +
      '<div class="stops">' + stops + '</div></div>' +
      (all ? '<div class="aud-unk"><span class="aud-lock">' + IC_LOCK + esc(allLabel(F.messageType)) + ' · 모수 선택 없음</span></div>'
           : '<label class="aud-unk"><input type="checkbox" data-act="unk"' + (unk ? ' checked' : '') + '><span>모수는 잘 모르겠어요</span></label>') + '</div>';
  }
  // 막대를 끄는 동안에는 폼을 다시 그리지 않고 값·표시만 바꾼다(끄는 입력칸이 바뀌면 끌기가 끊긴다)
  function audPick(el) {
    var bs = audBuckets(), idx = Number(el.value), last = Math.max(bs.length - 1, 1);
    F.estimatedAudience = bs[idx] || '';
    var box = R.getElementById('aud');
    if (!box) return;
    box.classList.remove('unset');
    box.querySelector('.a1').style.setProperty('--f', String(idx / last));
    box.querySelector('[data-aud-b]').textContent = audShort(bs[idx]);
    box.querySelectorAll('[data-i]').forEach(function (x) { x.classList.toggle('on', Number(x.dataset.i) === idx); });
    refreshLive('estimatedAudience');
  }

  function pushPreview() {
    var d = F.desiredSendDate ? parse(F.desiredSendDate) : parse(B.schedule.minSendDate);
    var title = F.copyTitle.trim() || '제목을 입력하면 여기에 보여요';
    var body = F.copyBody.trim() || '본문을 입력하면 여기에 보여요';
    // lint-ok(광고표기) 미리보기는 실제 표기와 같게 뒤에 한 칸을 둔다
    return '<div class="lock" id="pv"><div class="lk-time">9:41</div><div class="lk-date">' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' +
      WD[d.getDay()] + '요일</div><div class="noti"><div class="nh"><span class="ic"></span>모두의주차장<em>지금</em></div>' +
      '<div class="nt">(광고) ' + esc(title) + '</div><div class="nb">' + esc(body) + '</div><div class="nb opt-out">' + esc(opt('pushOptout')) + '</div></div></div>';
  }

  // 인앱메시지 목업 — 화면 이미지 대신 CSS 로 그려서 입력한 문구가 그 자리에 바로 들어간다
  function mockText(field, cls, ph) {
    var v = String(F[field] || '').trim();
    return '<span class="' + cls + (v ? '' : ' ph') + '">' + esc(v || ph) + '</span>';
  }
  // 입력한 이미지가 없을 때 쓰는 샘플 소재. 파일이 /static/msgreq/img/sample_<kind>.png 로 있으면 그걸 쓰고, 없으면 회색 자리
  function mockImg(cls, kind) {
    var own = String(F.imageUrl || '').trim(), u = own || (opt('sampleImages') || {})[kind] || '';
    if (!u) return '<span class="' + cls + '"><i></i>이미지</span>';
    return '<span class="' + cls + ' real" style="background-image:url(' + esc(JSON.stringify(u)).replace(/&quot;/g, '') + ')">' + (own ? '' : '<em class="im-smp">샘플 소재</em>') + '</span>';
  }
  // 문구를 넣기 전 자리 표시는 레이아웃 카드의 예시 화면과 같은 문구를 쓴다
  var PH = {
    modal: { eye: '신규 회원 전용', title: '포르쉐 911 4시간 무료', body: '포도호텔부터 파라나스까지! 대여 40분에 1만원의 요청이 필요해요', cta: '크레딧 받기', cta2: '기획 찾기' },
    sheet: { title: '쿠폰 골라받기 깜짝 찬스', body: '받고 싶은 쿠폰을 선택하면 쿠폰이 드려요!', cta: '쿠폰 받으러 가기', cta2: '공지사항 보러 가기' },
    slide: { title: '안전운전하고 실내가 누구나', body: '운전점수 80점 챌린지' },
  };
  function mockButtons(count, close, ph) {
    var b1 = mockText('copyCta', 'im-btn', ph.cta || '버튼 문구'), b2 = mockText('copyCta2', 'im-btn sec', ph.cta2 || '두 번째 버튼');
    if (count === 2) return close === 'C_tb' ? '<div class="im-acts tb">' + b1 + b2 + '</div>' : '<div class="im-acts lr">' + b2 + b1 + '</div>';
    if (count === 1) return '<div class="im-acts' + (close === 'B' ? ' withx' : '') + '">' + (close === 'B' ? '<span class="im-x-text">닫기</span>' : '') + b1 + '</div>';
    return '<div class="im-acts"><span class="im-btn sec close">닫기</span></div>';
  }
  // 형태만 골랐을 때 미리 보여 줄 기본 예시. 타입·레이아웃을 고르면 그걸로 바뀐다
  function mockDefaults() {
    var html = F.inappMessageFormat === 'HTML';
    var t = html ? (htmlTypeOf(F.inappHtmlType) || htmlTypeOf('M')) : null;
    var l = null;
    if (!html && F.inappMessageFormat === '기본') {
      // 그룹만 골랐을 때의 대표 예시: 전면은 이미지+제목+본문+버튼, 하단은 썸네일형(전체 이미지형은 전면처럼 보여 대표로 부적합)
      var REP = { '전면팝업': 'modal_text_button_full', '하단팝업': 'bottom_thumbnail', '슬라이드업': 'slideup' };
      l = layoutOf(F.inappLayout) || layoutOf(REP[F.layoutGroup] || 'modal_text_button_full') || null;
    }
    var st = l ? (subtypeOf(l, F.inappLayoutSubtype) || l.subtypes[0]) : null;
    return { html: html, t: t, l: l, st: st, isDefault: html ? !F.inappHtmlType : !F.inappLayout };
  }
  function inappMockInner() {
    var d = mockDefaults(), html = d.html, t = d.t, l = d.l, st = d.st;
    var kind = html ? (t && t.value === 'S' ? 'slide' : t ? 'modal' : '') : l ? (l.key === 'slideup' ? 'slide' : l.group === '하단팝업' ? 'sheet' : 'modal') : '';
    if (!kind) return '';
    // 닫기 위치는 세부 타입의 설명(우측 상단 · 버튼 왼쪽 · 모달 안)을 그대로 따른다
    var cnt = st ? st.cta_count : (html ? 1 : 0), closeAt = st ? st.close : '우측 상단';
    var close = closeAt === '버튼 왼쪽' ? 'B' : closeAt === '모달 안' ? 'D' : (st && st.key === 'C_tb' ? 'C_tb' : st && st.key === 'C_lr' ? 'C_lr' : 'A');
    var hasImg = html ? true : l.has_image, hasTitle = html ? true : l.has_title, hasBody = html ? true : l.has_body;
    var ph = PH[kind] || {};
    var eyebrow = html && t.value === 'M' ? mockText('copyEyebrow', 'im-eye', ph.eye || '자격 조건 문구') : '';
    var title = hasTitle ? mockText('copyTitle', 'im-t', ph.title || '제목') : '', body = hasBody ? mockText('copyBody', 'im-b', ph.body || (kind === 'slide' ? '보조 문구' : '본문')) : '';
    var x = closeAt === '우측 상단' ? '<span class="im-x">×</span>' : '';
    if (kind === 'slide') return '<div class="im-slide">' + (F.slideVisual === 'emoji' ? '<span class="im-emo' + (F.slideEmoji ? '' : ' ph') + '">' + esc(F.slideEmoji || '🚗') + '</span>' : (hasImg ? mockImg('im-thumb', 'slide') : '')) + '<span class="im-sl"><b>' + (title || mockText('copyTitle', 'im-t', ph.title)) + '</b>' + body + '</span></div>';
    if (kind === 'sheet') {
      if (l.key === 'bottom_image_full') return '<div class="im-dim"></div><div class="im-sheet">' + x + mockImg('im-img tall', 'sheet') + '</div>';
      var thumb = l.has_image === 'thumbnail' ? mockImg('im-thumb', 'thumb') : '';
      return '<div class="im-dim"></div><div class="im-sheet">' + x + '<div class="im-row">' + thumb + '<div class="im-txt">' + title + body + '</div></div>' + mockButtons(cnt, close, ph) + '</div>';
    }
    return '<div class="im-dim"></div><div class="im-modal">' + x + (hasImg ? mockImg('im-img', 'modal') : '') + '<div class="im-txt">' + eyebrow + title + body + '</div>' + mockButtons(cnt, close, ph) + '</div>';
  }
  function appBg() { return '<img class="ap-bg" src="' + esc(CSS_URL.replace(/msgreq\.css.*$/, 'msgreq/img/app_home.jpg')) + '" alt="">'; }   // 실제 앱 홈 화면 캡처, 정적 경로는 CSS 와 같은 곳
  // 크게 보기 — 폰 목업만 화면 가운데에 크게 띄운다. 배경을 누르거나 Esc 로 닫는다
  function openZoom() {
    closeZoom();
    var z = document.createElement('div');
    z.className = 'pvz'; z.id = 'pvz';
    z.innerHTML = '<div class="pvz-in">' + inappMock() + '</div><button type="button" class="pvz-x" aria-label="닫기">×</button>';
    z.addEventListener('click', function (e) { if (e.target === z || e.target.closest('.pvz-x')) closeZoom(); });
    R.appendChild(z);
  }
  function closeZoom() { var z = R.getElementById('pvz'); if (z) z.remove(); }
  function inappMock() { return '<div class="phn"><div class="phn-scr">' + appBg() + inappMockInner() + '</div></div>'; }
  function inappPreview() {
    var cap = '';
    var d = mockDefaults();
    if (d.html) cap = d.isDefault ? '타입을 고르면 바뀌어요 · 지금은 ' + d.t.label + ' 예시' : d.t.label;
    else if (d.l) cap = (d.isDefault ? '레이아웃을 고르면 바뀌어요 · 지금은 ' : '') + d.l.group + ' · ' + d.l.label + (d.st && d.l.subtypes.length > 1 && !d.isDefault ? ' · ' + d.st.label.split(' · ')[0] : '');
    else cap = '형태를 고르면 여기에 그려져요';
    return '<div class="shot mock" id="pv">' + inappMock() + '<div class="cap">' + esc(cap) + '</div></div>';
  }

  function aiBlock(fields) {
    if (!fields.length) return '';
    var sg = U.suggest, can = !!F.campaignName.trim();
    var ctaOnly = fields.every(function (f) { return /^copyCta/.test(f.field); });
    var sub = sg.state === 'loading' ? (ctaOnly ? '버튼 문구 3안을 만드는 중이에요' : '소구 축이 다른 3안을 만드는 중이에요') : sg.state === 'error' ? sg.error :
      (can ? (ctaOnly ? '캠페인명 기준, 버튼에 넣을 짧은 문구 3안' : '캠페인명 기준, 소구 축이 다른 3안') : '캠페인명을 먼저 입력하면 쓸 수 있어요');
    var h = '<div class="ai-bar"><div><div class="nm">' + (ctaOnly ? 'AI 버튼 문구 제안' : 'AI 문구 제안') + '</div><div class="sb" id="ai-sub">' + esc(sub) + '</div></div>' +
      '<button type="button" class="btn-co" id="ai-btn" data-act="suggest"' + (!can || sg.state === 'loading' ? ' disabled' : '') + '>' +
      (sg.state === 'done' ? '다시 받기' : '3안 받기') + '</button></div>';
    if (sg.variants.length) {
      h += '<div class="opts c3 ai">' + sg.variants.map(function (v, i) {
        var t = v.fields.copyTitle || v.fields[fields[0].field] || '', b = v.fields.copyBody || '';
        return '<button type="button" class="opt sg' + (sg.picked === i ? ' on' : '') + '" data-act="apply" data-v="' + i + '">' +
          (sg.picked === i ? '<span class="ck">✓</span>' : '') + '<span class="axis">' + esc(v.axis) + '</span><span class="sg-t">' + esc(t) +
          '</span>' + (b ? '<span class="sg-b">' + esc(b) + '</span>' : '') + adBadge(v) + '</button>';
      }).join('') + '</div>';
    }
    return h;
  }

  function adBadge(v) {
    var words = [];
    Object.keys(v.adClaims || {}).forEach(function (k) { v.adClaims[k].forEach(function (h) { if (words.indexOf(h.match) < 0) words.push(h.match); }); });
    return words.length ? '<span class="sg-warn">표시광고법 확인 · ' + esc(words.join(', ')) + '</span>' : '';
  }

  function fieldInput(f) {
    if (f.choice) {
      return '<div class="field"><div class="fl2">' + esc(f.label) + '</div><div class="pills">' + f.choice.map(function (c) {
        return '<button type="button" class="pill' + (F[f.field] === c.v ? ' on' : '') + '" data-act="set" data-k="' + f.field + '" data-v="' + c.v + '">' + esc(c.l) + '</button>';
      }).join('') + '</div></div>';
    }
    var v = F[f.field] || '';
    var cnt = f.maxlen ? '<div class="cnt' + (v.length > f.maxlen ? ' over' : '') + '" data-cnt="' + f.field + '">' + v.length + '/' + f.maxlen + '</div>' : '';
    var control;
    if (F.messageType === 'push' && f.field === 'copyTitle') {
      // lint-ok(광고표기) 입력칸 앞 칩은 붙어 보이게 둔다
      control = '<div class="inp-pre"><span class="ad">(광고)</span>' + input('copyTitle', v, '예) 주차비 아까워서 미루셨나요?', '', f.maxlen) + '</div>';
    } else if (f.area) {
      control = area(f.field, v, f.hint || '', '', f.maxlen);
    } else {
      control = input(f.field, v, f.hint || '', '', f.maxlen);
    }
    return '<div class="field"><div class="fl2">' + esc(f.label) + (f.required ? REQ : '') + '<button type="button" class="clr" data-act="clr" data-v="' + f.field + '"' + (v ? '' : ' hidden') + '>지우기</button></div>' + control + cnt + '<div class="hint warn" data-warn="' + f.field + '" hidden></div>' +
      (f.hint && !f.area && f.field !== 'copyTitle' ? '' : '') + '</div>';
  }

  function secCopy() {
    var fields = copyFieldsFor();
    if (!fields) return '<div class="empty">인앱메시지 세부 설정에서 형태와 레이아웃을 먼저 골라 주세요</div>';
    var textFields = fields.filter(function (f) { return f.field !== 'imageUrl' && !f.choice; });
    var h = aiBlock(textFields);
    h += '<div class="cp-wrap"><div>' + fields.map(fieldInput).join('') +
      (F.messageType === 'push' ? '<div class="auto"><span class="tag-g">' + esc(opt('pushOptout')) + '</span>자동 추가</div>' : '') +
      '</div>' + (F.messageType === 'push' ? pushPreview() : inappPreview()) + '</div>';
    return h;
  }
  // 인앱 문구 모형: 화면 이미지는 고정이라 입력한 글이 들어가는 자리를 따로 보여 준다
  function linkOutput() {
    var d = dlDest();
    if (!d) return '';
    var r = composeLink();
    var tag = '';
    if (!d.free && d.params.length) {
      var p = d.params[0], v = F.dlValues[p.key];
      tag = v ? p.label + ' ' + v : '';
    }
    var title = F.copyTitle.trim() || '메시지 문구의 제목';
    // lint-ok(광고표기) 미리보기 표기
    var land = '<div class="land"><div class="noti"><div class="nh"><span class="ic"></span>모두의주차장<em>지금</em></div><div class="nt">' +
      (F.messageType === 'push' ? '(광고) ' : '') + esc(title) + '</div></div>' + ARROW +
      '<div class="lp"><div class="lp-h"><i>‹</i>' + esc(d.name.split(' › ')[0]) + '</div><div class="lp-b">' + (tag ? '<span class="lp-tag">' + esc(tag) + '</span>' : '') +
      '<div class="lp-l t"></div><div class="lp-l"></div><div class="lp-l"></div><div class="lp-l s"></div><div class="lp-img"></div><div class="lp-l"></div></div></div></div>';
    return '<div class="link-pv' + (r.ok ? '' : ' bad') + '"><code>' + esc(r.link) + '</code>' +
      (r.ok ? '<span class="tag-co">' + (B.deeplinks.source === 'doc' ? '딥링크 문서 기준 확인' : '형식 확인') + '</span>' : '<span class="st-sub">입력 항목을 채워 주세요</span>') +
      '</div>' + land;
  }

  // 도착 화면 아이콘(딥링크 경로 앞부분 기준). 실제 앱 화면 이미지가 생기면 이 자리를 썸네일로 바꾼다.
  var DL_IC = { main: 'home', maps: 'pin', 'partner-maps': 'bolt', coupon: 'coupon', voucher: 'wallet', share: 'park', 'ticket-list': 'ticket',
    refund: 'refund', notification: 'bell', inbox: 'inbox', notice: 'mega', autopay: 'card', website: 'globe', 'open-url': 'link', openapp: 'app',
    'referral-code': 'gift', 'ticket-group': 'plane' };
  var DL_SVG = {
    home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>',
    pin: '<path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
    coupon: '<path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z"/><path d="M14 7.5v9" stroke-dasharray="1.6 2.2"/>',
    wallet: '<rect x="3.5" y="6" width="17" height="13" rx="2.5"/><path d="M3.5 10h17M15.5 14.5h2"/>',
    lot: '<rect x="4.5" y="3.5" width="15" height="17" rx="3.5"/><path d="M10 16.5v-9h2.8a2.6 2.6 0 0 1 0 5.2H10"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    target: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h3M13 14h3"/>',
    park: '<circle cx="6" cy="12" r="2.2"/><circle cx="17" cy="6" r="2.2"/><circle cx="17" cy="18" r="2.2"/><path d="M8 11l7-4M8 13l7 4"/>',
    ticket: '<path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8z"/><path d="M9 8.5h6M9 12.5h6"/>',
    refund: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
    bell: '<path d="M6.5 16v-5a5.5 5.5 0 0 1 11 0v5l1.5 2h-14z"/><path d="M10.2 20.5a2 2 0 0 0 3.6 0"/>',
    inbox: '<path d="M3.5 13 6 5.5h12l2.5 7.5v5.5h-17z"/><path d="M3.5 13h5l1.3 2h4.4l1.3-2h5"/>',
    mega: '<path d="M4 10.5v3h3l6 4v-11l-6 4z"/><path d="M16.5 9.5a3.5 3.5 0 0 1 0 5"/>',
    card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M6.5 14.5h4"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.2-3.6-8.5S9.6 5.8 12 3.5z"/>',
    link: '<path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"/>',
    app: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><path d="M16.5 13.5v6M13.5 16.5h6"/>',
    gift: '<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5.5 12.5v7h13v-7M12 8.5v11"/><path d="M12 8.5c-1.5-3-4.5-3.8-5.2-2.2-.6 1.4 1.5 2.2 5.2 2.2zm0 0c1.5-3 4.5-3.8 5.2-2.2.6 1.4-1.5 2.2-5.2 2.2z"/>',
    plane: '<path d="M20.5 15.5v-1.8L13.5 9V4.8a1.5 1.5 0 0 0-3 0V9l-7 4.7v1.8l7-2.1v4.8l-2 1.4v1.6l3.5-1 3.5 1v-1.6l-2-1.4v-4.8z"/>',
  };
  // 같은 지도라도 주차장·날짜/시간·내 위치·월정기권은 다른 아이콘
  var DL_ID_IC = { 'maps?parkinglotType&parkinglotSeq&lat&lng': 'lot', 'maps?parkinglotType&parkinglotSeq&lat&lng&startDate&durationId': 'clock',
    'maps?lat&lng&startDate&durationId': 'clock', 'maps?currentLocation': 'target', 'maps?monthlyMode': 'cal' };
  // 지도 계열은 화면보다 '어떤 상태의 지도인지'가 핵심이라 상태를 굵게. 날짜/시간을 정하는 링크는 예매 진입이라 (예매)를 붙인다
  var DL_SUB = {
    'main': ['지도', '기본 화면'],
    'maps?parkinglotType&parkinglotSeq&lat&lng': ['지도', '<b>특정 주차장</b>으로 이동'],
    'maps?parkinglotType&parkinglotSeq&lat&lng&startDate&durationId': ['지도(예매)', '<b>특정 주차장</b> · <b>날짜/시간</b> 지정'],
    'maps?lat&lng': ['지도', '<b>특정 위경도</b>로 이동'],
    'maps?lat&lng&startDate&durationId': ['지도(예매)', '<b>특정 위경도</b> · <b>날짜/시간</b> 지정'],
    'maps?currentLocation': ['지도', '<b>내 위치</b> 켜짐'],
    'maps?monthlyMode': ['지도', '<b>월정기권 필터</b> 켜짐'],
    'partner-maps?filterTicketTypeName': ['빠른구매', '<b>주차권 종류</b> 필터'],
    'partner-maps?filterTicketTypeName&lat&lng': ['빠른구매', '<b>주차권 종류</b> 필터 · <b>특정 위경도</b>'],
  };
  function dstCard(d) {
    var k = DL_ID_IC[d.id] || DL_IC[String(d.id).split(/[?/]/)[0]] || 'link';
    var raw = String(d.name).split(' › '), parts = DL_SUB[d.id] ? DL_SUB[d.id].slice() : [esc(raw[0])].concat(raw.length > 1 ? ['<b>' + esc(raw.slice(1).join(' › ')) + '</b>'] : []);
    return '<button type="button" class="opt dst' + (F.dlId === d.id ? ' on' : '') + '" data-act="set" data-k="dlId" data-v="' + esc(d.id) + '">' +
      '<span class="dic"><svg viewBox="0 0 24 24" aria-hidden="true">' + DL_SVG[k] + '</svg></span><span class="dtx"><span class="t1">' + parts[0] + '</span>' +
      (parts.length > 1 ? '<span class="t2">' + parts[1] + '</span>' : '') + '</span></button>';
  }

  function secLink() {
    var groups = B.deeplinks.groups, cnt = {};
    dlItems().forEach(function (d) { cnt[d.group] = (cnt[d.group] || 0) + 1; });
    // 링크 그룹은 회색 분류 알약, 도착 화면은 아이콘이 붙은 흰 선택 카드로 모양을 달리한다
    function pill(v, label, n) {
      return '<button type="button" class="fchip' + (F.dlGroup === v ? ' on' : '') + '" data-act="set" data-k="dlGroup" data-v="' + esc(v) + '">' +
        esc(label) + (n ? '<span class="n">' + n + '</span>' : '') + '</button>';
    }
    var h = frow('링크 그룹', '<div class="fchips">' + pill('', '링크 없음') + groups.map(function (g) { return pill(g, g, cnt[g]); }).join('') + '</div>');
    if (F.dlGroup) {
      h += frow('도착 화면', '<div class="opts fx3">' + dlItems().filter(function (d) { return d.group === F.dlGroup; }).map(dstCard).join('') + '</div>', 'req');
    }
    var d = dlDest();
    if (d) {
      if (d.free) {
        h += frow('파라미터', input('dlFree', F.dlFree, '예) noticeSeq=12345') + '<div class="hint">딥링크 문서를 읽지 못해 파라미터를 직접 적어요</div>');
      }
      (d.params || []).forEach(function (p) {
        if (p.choices) {
          h += frow(p.label, '<div class="chips">' + p.choices.map(function (c) {
            return '<button type="button" class="chip' + (F.dlValues[p.key] === c[0] ? ' on' : '') + '" data-act="set" data-k="dl.' + esc(p.key) + '" data-v="' + esc(c[0]) + '">' + esc(c[1]) + '</button>';
          }).join('') + '</div>', 'req');
        } else {
          h += frow(p.label, input('dl.' + p.key, F.dlValues[p.key] || '', p.placeholder ? '예) ' + p.placeholder : '') +
            (p.encode ? '<div class="hint">주소 그대로 붙여 넣으면 링크에는 자동으로 인코딩해 넣어요</div>' : ''), 'req');
        }
      });
      h += frow('이동 미리보기', '<div id="dl-out">' + linkOutput() + '</div>');
    }
    return h;
  }

  function idGuide() {
    return '<div class="idnote"><div class="idhead"><b>userSeq 열 이름을 external_id로 바꿔서 업로드</b>' +
      '<div class="sub">Braze가 회원을 external_id로 찾기 때문에 값은 그대로 두고 열 이름만 변경</div></div>' +
      '<div class="idbody"><div class="rename"><div class="sheet"><div class="sh-h old">userSeq</div><div class="sh-c"><i></i></div><div class="sh-c"><i></i></div></div>' +
      ARROW + '<div class="sheet"><div class="sh-h">external_id</div><div class="sh-c"><i></i></div><div class="sh-c"><i></i></div></div></div>' +
      '<div class="tips"><div class="tip"><span class="tk">BigQuery</span><span><code>userSeq AS external_id</code>로 추출</span></div>' +
      '<div class="tip"><span class="tk">Claude</span><span>external_id 열 이름으로 저장 요청</span></div></div></div></div>';
  }

  function deliveryRows() {
    var h = frow('전달 방식', pillRow('deliveryMethod', F.deliveryMethod, opt('deliveryMethods').filter(function (m) { return m.value === 'sql' || m.value === 'file'; }).map(function (m) {
      return { v: m.value, nm: m.label, sb: m.desc, ic: '<b class="gl">' + esc(m.glyph) + '</b>' };
    })), 'req');
    if (F.deliveryMethod === 'sql') {
      h += frow('SQL문', area('sqlQuery', F.sqlQuery, 'SELECT userSeq AS external_id FROM ...', 'mono') +
        '<div class="hint">결과 열 이름을 external_id 로 뽑아 주세요</div>', 'req');
    }
    if (F.deliveryMethod === 'file') {
      var inner;
      if (U.fileChecking) {
        inner = '<div class="drop"><b>파일을 확인하는 중이에요</b></div>';
      } else if (F.fileInfo) {
        inner = '<div class="file"><span class="gl on">CSV</span><div><div class="nm" style="font-weight:700">' + esc(F.file ? F.file.name : (F.fileInfo.name || '')) + (F.fileInfo.keep ? ' <span class="st-sub">(기존 파일 유지)</span>' : '') + '</div>' +
          '<div class="sb" style="font-size:13px;color:var(--ink3)">회원번호 ' + F.fileInfo.rows.toLocaleString() + '건' +
          (F.fileInfo.blankIds ? ' · 빈 값 ' + F.fileInfo.blankIds + '줄 제외' : '') + '</div></div>' +
          '<label class="lnk" for="file-in">다시 올리기</label></div><div class="checks"><span>✓ CSV 형식</span><span>✓ external_id 열 확인</span><span>✓ 용량 상한 이내</span></div>';
      } else {
        inner = '<label class="drop" for="file-in" id="drop"><b>CSV 파일을 끌어 놓거나 눌러서 고르세요</b><span>external_id 열 필수 · ' +
          opt('maxFileMb') + 'MB 이하</span></label>' + (F.fileErr ? '<div class="err-line">' + esc(F.fileErr) + '</div>' : '');
      }
      h += frow('첨부 파일', inner + '<input type="file" id="file-in" accept=".csv,text/csv" hidden>' + idGuide(), 'req');
    }
    return h;
  }

  // 왼쪽 상태 원: 채움(파랑) · 필수 미입력(점선 원, "입력 필요") · 선택 미입력(옅은 빈 원, "비워도 돼요")
  // 미입력 표시를 누르면 그 항목이 있는 절로 간다
  var KV_SEC = { '메시지 유형': 'type', '요청팀': 'requester', '캠페인명': 'requester', '발송 희망일': 'schedule', '발송 시간': 'schedule',
    '타겟 그룹': 'target', '조건 유형': 'target', '부연 설명': 'target', '예상 모수': 'target', '전달 방식': 'target', '문구 제목': 'copy', '랜딩 링크': 'link' };
  function kvv(k, v, req) {
    var val = v ? esc(v) : '<button type="button" class="miss-dash' + (req ? ' req' : '') + '" data-act="jump" data-v="' + (KV_SEC[k] || 'requester') + '">' + (req ? '입력 필요' : '비워도 돼요') + '</button>';
    return '<div class="kv has-st' + (!v && req ? ' need' : '') + '"><i class="kv-st' + (v ? ' on' : (req ? ' req' : '')) + '"></i><span>' + esc(k) + '</span><b title="' + esc(v || '') + '">' + val + '</b></div>';
  }
  // 요약: 필수 진행률 + 빠진 항목 칩, 절별 카드, 제출 띠
  var REQ_TOTAL = 7;   // 캠페인명·발송 희망일·타겟 그룹·문구 제목·본문·전달 방식·유형(고정) 기준의 대략적 필수 개수
  function secSummary() {
    var m = missing();
    var done = Math.max(REQ_TOTAL - m.length, 0), pct = Math.round(done / REQ_TOTAL * 100);
    var head = '<div class="sm-head"><div class="sm-prog"><div class="sm-pt">' + (m.length ? '<b>필수 ' + m.length + '개</b>가 남았어요' : '<b>필수 항목을 모두 채웠어요</b>') +
      '</div><div class="sm-bar"><i style="width:' + pct + '%"></i></div></div>' +
      (m.length ? '<div class="sm-miss">' + m.map(function (x) { return '<button type="button" data-act="jump" data-v="' + x.sec + '">' + esc(x.label) + '</button>'; }).join('') + '</div>' : '') + '</div>';
    var kind = typeLabel(F.messageType);
    if (F.messageType === 'inapp') {
      var l = layoutOf(F.inappLayout), t = htmlTypeOf(F.inappHtmlType);
      if (F.inappMessageFormat === '기본' && l) kind += ' · ' + l.group;
      if (F.inappMessageFormat === 'HTML' && t) kind += ' · ' + t.label.split(' · ')[0];
    }
    var lk = composeLink(), d = dlDest();
    var titleVal = F.messageType === 'push' ? F.copyTitle.trim() : F.copyTitle.trim();
    function card(no, title, sec, body, wide) {
      return '<div class="sc' + (wide ? ' wide' : '') + '"><div class="sc-h"><span class="sc-no">' + no + '</span>' + esc(title) +
        '<button type="button" data-act="jump" data-v="' + sec + '">수정</button></div>' + (wide ? '<div class="kvs">' + body + '</div>' : body) + '</div>';
    }
    var cards = '<div class="sum">' +
      card('01', '기본 정보·일정', 'requester',
        kvv('메시지 유형', kind) + kvv('요청팀', F.team, true) + kvv('캠페인명', F.campaignName, true) +
        kvv('발송 희망일', F.desiredSendDate ? md(F.desiredSendDate) : '', true) + kvv('발송 시간', bandLabel(F.sendTimeBand))) +
      card('04', '발송 타겟', 'target',
        kvv('타겟 그룹', F.targetSheet, true) + kvv('조건 유형', condLabel(F)) +
        kvv('부연 설명', F.targetSheet === '전체' ? '해당 없음' : F.targetDetail) +
        kvv('예상 모수', F.targetSheet === '전체' ? allLabel(F.messageType) : F.estimatedAudience) +
        kvv('전달 방식', F.targetSheet === '전체' ? '해당 없음' : deliveryLabel(F.deliveryMethod), F.targetSheet !== '전체')) +
      card('05', '문구·링크', 'copy',
        kvv('문구 제목', titleVal, F.messageType === 'push' || (copyFieldsFor() || []).some(function (f) { return f.field === 'copyTitle'; })) +
        kvv('랜딩 링크', d && lk.ok ? d.name : ''), true) + '</div>';
    return head + cards + '<div class="submit"><button type="button" class="btn-co lg" data-act="submit"' +
      (m.length || U.submitting ? ' disabled' : '') + '>' + (U.submitting ? (U.editId ? '저장하는 중' : '제출하는 중') : (U.editId ? '수정 저장' : '요청 제출')) + '</button></div>';
  }

  var SECTIONS = [
    ['requester', '요청자 정보', secRequester],
    ['type', '메시지 유형', secType],
    ['inapp', '인앱메시지 세부 설정', secInapp],
    ['schedule', '발송 일정', secSchedule],
    ['target', '발송 타겟', secTarget],
    ['copy', '메시지 문구', secCopy],
    ['link', '랜딩 링크', secLink],
    ['summary', '요약 확인·제출', secSummary],
  ];
  var SUBS = {};

  function floatPreview() {
    var box = R.getElementById('fpv');
    if (!box) return;
    var inner = '';
    if (F.messageType === 'push') inner = pushPreview().replace('id="pv"', '');
    else {
      inner = inappPreview().replace('id="pv"', '');   // 형태·레이아웃을 아직 안 골랐어도 앱 화면은 그려 둔다
    }
    box.classList.toggle('open', !!U.fpvOpen);
    var IC_PHONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18.5h4"/></svg>';
    var IC_ZOOM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    var IC_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    var zoomBtn = U.fpvOpen && F.messageType === 'inapp' ? '<button type="button" class="fpv-t ghost" data-act="pvz">' + IC_ZOOM + '크게 보기</button>' : '';
    box.innerHTML = '<div class="fpv-tb">' + zoomBtn + '<button type="button" class="fpv-t" data-act="fpv">' + (U.fpvOpen ? IC_DOWN + '접기' : IC_PHONE + '미리보기') + '</button></div>' + (U.fpvOpen ? '<div class="fpv-b">' + inner + '</div>' : '');
    var z = R.getElementById('pvz');
    if (z) z.querySelector('.pvz-in').innerHTML = inappMock();   // 크게 보기가 열려 있으면 같이 갱신
  }
  // 저장된 요청을 폼 상태로 되돌린다(수정 모드)
  function fromRecord(r) {
    var f = blankForm();
    Object.keys(f).forEach(function (k) { if (typeof f[k] === 'string' && r[k] != null) f[k] = String(r[k]); });
    f.messageType = r.messageType || 'push';
    f.inappMode = 'direct';
    if (r.inappHtmlType) f.inappMessageFormat = 'HTML';
    else if (r.inappLayout) { f.inappMessageFormat = '기본'; var l = layoutOf(r.inappLayout); f.layoutGroup = l ? l.group : ''; }
    f.targetHow = r.targetSheet === '타겟' ? (r.deliveryMethod === 'unknown' ? 'ask' : 'self') : '';
    if (f.messageType === 'push') { var oo = opt('pushOptout'); if (f.copyBody.slice(-oo.length) === oo) f.copyBody = f.copyBody.slice(0, -oo.length).replace(/\n$/, ''); }
    if (r.memberFileName) f.fileInfo = { rows: r.memberFileRows || 0, blankIds: 0, keep: true, name: r.memberFileName };
    // 딥링크는 주소를 도착 화면·파라미터로 되돌린다
    var link = String(r.deepLink || '');
    if (link.indexOf('parkingshare://') === 0) {
      var rest = link.slice('parkingshare://'.length), path = rest.split('?')[0], q = rest.split('?')[1] || '';
      var kv = {}; q.split('&').filter(Boolean).forEach(function (p) { var i = p.indexOf('='); var k = i < 0 ? p : p.slice(0, i); kv[k] = i < 0 ? '' : decodeURIComponent(p.slice(i + 1)); });
      var keys = Object.keys(kv).sort().join('&');
      var hit = dlItems().filter(function (d) { return d.path === path && (d.free || (d.params || []).map(function (p) { return p.key; }).sort().join('&') === keys); })[0];
      if (hit) { f.dlGroup = hit.group; f.dlId = hit.id; if (hit.free) f.dlFree = q; else f.dlValues = kv; }
    }
    return f;
  }
  function startEdit(id) {
    api('/api/msgreq/requests/' + encodeURIComponent(id)).then(function (D) {
      F = fromRecord(D.record); U.editId = id; U.editName = D.record.campaignName || ''; U.done = null; U.suggest = { state: 'idle', variants: [], picked: -1 };
      U.editLocked = D.record.status !== '대기'; U.editDate = D.record.desiredSendDate || ''; U.editCard = !!D.record.campaignId;
      U.editRequester = { nickname: D.record.requesterNickname || '', email: D.record.requesterEmail || '' };
      goNow('new');
      if (host) host.scrollIntoView({ block: 'start' });
    }).catch(function (e) { toast(errText(e), true); });
  }
  function cancelEdit() { var id = U.editId; U.editId = null; F = blankForm(); goNow(U.editLocked ? 'r:' + id : 'list'); }
  function removeRequest(id, name) { withCardStatus(id, function (cs) { removeRequestWith(id, name, cs); }); }
  function removeRequestWith(id, name, cs) {
    var rec = recOf(id) || {};
    openReason({ title: '"' + (name || id) + '" 요청 건을 삭제할까요', danger: true, ok: '삭제', confirm: cs === '발송예정' ? BRAZE_STOP : '',
      sub: '되돌릴 수 없어요. ' + (rec.campaignId ? '연결된 캠페인 카드는 지운 카드로 옮겨지고, ' : '') + '사유는 슬랙 인입 글 스레드에 남겨요',
      placeholder: '예) 세차 제휴가 끝나 캠페인을 진행하지 않아요',
      onOk: function (reason, _, fail) {
        api('/api/msgreq/requests/' + encodeURIComponent(id) + '/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason, brazeStopped: cs === '발송예정' }) })
          .then(function () { closeApprove(); toast('삭제했어요'); U.list = null; if (U.route === 'list') loadList(); else goNow('list'); })
          .catch(function (e) { toast(errText(e), true); fail(); });
      } });
  }
  // 발송 일정 절과 요약·미리보기만 갱신
  function renderSchedule() {
    var b = R.querySelector('#st-schedule .st-b');
    if (!b) { renderForm(); return; }
    b.innerHTML = secSchedule();
    var sum = R.querySelector('#st-summary .st-b'); if (sum) sum.innerHTML = secSummary();
    floatPreview();
  }
  function renderForm() {
    if (U.done) { renderDone(); return; }
    var n = 0, html = U.editId ? '<div class="edit-bar"><span>' + IC_EDIT + '<b>요청 수정 중</b> ' + esc(U.editName) + '</span><button type="button" class="btn-ghost" data-act="edit-cancel">수정 취소</button>' +
      '</div>' : '';
    SECTIONS.forEach(function (s) {
      if (s[0] === 'inapp' && F.messageType !== 'inapp') return;
      n += 1;
      var sub = SUBS[s[0]] || '';
      html += '<section class="step" id="st-' + s[0] + '"><div class="st-h"><span class="st-no">' + pad(n) + '</span><h2>' + esc(s[1]) + (s[0] === 'type' ? REQ : '') + '</h2>' +
        (sub ? '<span class="st-sub">' + esc(sub) + '</span>' : '') + '</div><div class="st-b">' + s[2]() + '</div></section>';
    });
    view.innerHTML = html + '<div class="fpv" id="fpv"></div>';
    bindDrop();
    copyWarnings();
    floatPreview();
  }

  // 잠금화면 미리보기를 재서 제목 줄바꿈·본문 넘침 경고를 띄운다(앱푸시만)
  function copyWarnings() {
    var w = adClaimWarnings();
    if (F.messageType === 'push') pushLineWarnings(w);
    R.querySelectorAll('[data-warn]').forEach(function (el) { var m = w[el.dataset.warn]; el.hidden = !m; el.textContent = m || ''; });
  }
  // 표시광고법 주의 워딩(policies/ad_claim_rules.json). 법무 검토 전 내부 기준이라 막지 않고 알려만 준다
  var AD_RE = null;
  function adClaimHits(field, text) {
    if (!AD_RE) AD_RE = (opt('adClaimRules') || []).map(function (r) { return { r: r, re: new RegExp(r.pattern, 'i') }; });
    if (!text) return [];
    return AD_RE.filter(function (x) { return !(x.r.scope === 'push_title' && !(field === 'copyTitle' && F.messageType === 'push')); })
      .map(function (x) { var m = text.match(x.re); return m ? { r: x.r, word: m[0].trim() } : null; }).filter(Boolean);
  }
  function adClaimWarnings() {
    var w = {};
    (copyFieldsFor() || []).forEach(function (f) {
      var hits = adClaimHits(f.field, F[f.field] || '');
      if (hits.length) w[f.field] = '표시광고법 확인 · ' + hits.map(function (h) { return "'" + h.word + "' " + h.r.why + '. 대신 ' + h.r.instead; }).join(' / ');
    });
    return w;
  }
  // 잠금화면 미리보기를 재서 제목 줄바꿈·본문 넘침 경고를 덧붙인다
  function pushLineWarnings(w) {
    var pv = R.getElementById('pv'); if (!pv) return;
    var nt = pv.querySelector('.nt'), nb = pv.querySelector('.nb:not(.opt-out)');
    function lines(el) { var lh = parseFloat(getComputedStyle(el).lineHeight) || 16; return Math.round(el.getBoundingClientRect().height / lh); }
    var typed = F.copyBody.trim() ? F.copyBody.trim().split('\n').length : 0, rendered = lines(nb), lw = {};
    if (F.copyTitle.trim() && lines(nt) > 1) lw.copyTitle = '제목이 잠금화면에서 두 줄로 넘어가요. ' + (nt.textContent.length - 5) + '자보다 짧게 줄여 주세요';
    if (typed && rendered > 3) lw.copyBody = '본문이 3줄을 넘어 잠금화면에서 잘릴 수 있어요';
    else if (typed && rendered > typed) lw.copyBody = '문장이 잠금화면에서 자동으로 줄바꿈돼요. 가독성이 떨어지니 한 줄을 짧게 줄여 주세요';
    Object.keys(lw).forEach(function (k) { w[k] = w[k] ? w[k] + ' · ' + lw[k] : lw[k]; });
  }
  function refreshLive(bind) {
    if (/^(copyTitle|copyBody|copyCta|copyCta2|copyEyebrow|imageUrl|slideEmoji)$/.test(bind)) {
      var pv = R.getElementById('pv');
      if (pv) pv.outerHTML = F.messageType === 'push' ? pushPreview() : inappPreview();
      floatPreview();
      var c = R.querySelector('[data-cnt="' + bind + '"]');
      var f = (copyFieldsFor() || []).filter(function (x) { return x.field === bind; })[0];
      if (c && f && f.maxlen) { c.textContent = F[bind].length + '/' + f.maxlen; c.className = 'cnt' + (F[bind].length > f.maxlen ? ' over' : ''); }
      copyWarnings();
      var cb = R.querySelector('.clr[data-v="' + bind + '"]'); if (cb) cb.hidden = !F[bind];
    }
    if (bind.indexOf('dl.') === 0 || bind === 'dlFree' || bind === 'copyTitle') {
      var out = R.getElementById('dl-out');
      if (out) out.innerHTML = linkOutput();
    }
    if (bind === 'campaignName') {
      var btn = R.getElementById('ai-btn'), sub = R.getElementById('ai-sub');
      if (btn && U.suggest.state !== 'loading') btn.disabled = !F.campaignName.trim();
      if (sub && U.suggest.state === 'idle') sub.textContent = F.campaignName.trim() ? '캠페인명 기준, 소구 축이 다른 3안' : '캠페인명을 먼저 입력하면 쓸 수 있어요';
    }
    var sum = R.querySelector('#st-summary .st-b');
    if (sum) sum.innerHTML = secSummary();
  }

  // ───────────── 동작 ─────────────
  function suggest() {
    var fields = (copyFieldsFor() || []).filter(function (f) { return f.field !== 'imageUrl'; });
    U.suggest = { state: 'loading', variants: U.suggest.variants, picked: -1 };
    renderForm();
    var brief = { campaignName: F.campaignName, team: F.team, messageType: F.messageType, targetSheet: F.targetSheet,
                  targetDetail: F.targetDetail, desiredSendDate: F.desiredSendDate };
    if (F.messageType !== 'push') {
      brief.copyFields = fields.map(function (f) { return { key: f.field, label: f.label, hint: (f.hint || (/^copyCta/.test(f.field) ? '버튼에 들어갈 문구. 동사로 끝나는 짧은 말' : '')) + (f.maxlen ? ' ' + f.maxlen + '자 이내' : (/^copyCta/.test(f.field) ? ' 10자 이내' : '')) }; });
    }
    api('/api/msgreq/suggest-copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(brief) })
      .then(function (r) { U.suggest = { state: 'done', variants: r.variants || [], picked: -1 }; })
      .catch(function (e) { U.suggest = { state: 'error', variants: [], picked: -1, error: errText(e) }; })
      .then(renderForm);
  }

  function applySuggestion(i) {
    var v = U.suggest.variants[i];
    if (!v) return;
    Object.keys(v.fields).forEach(function (k) { if (k in F) F[k] = v.fields[k]; });
    U.suggest.picked = i;
    renderForm();
  }

  function checkFile(file) {
    if (!file) return;
    F.file = file; F.fileInfo = null; F.fileErr = null; U.fileChecking = true;
    renderForm();
    var fd = new FormData();
    fd.append('memberFile', file);
    api('/api/msgreq/check-file', { method: 'POST', body: fd })
      .then(function (r) { F.fileInfo = r; })
      .catch(function (e) { F.fileErr = errText(e); F.file = null; })
      .then(function () { U.fileChecking = false; renderForm(); });
  }

  function bindDrop() {
    var drop = R.getElementById('drop');
    if (!drop) return;
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) checkFile(e.dataTransfer.files[0]); });
  }

  function submit() {
    if (missing().length || U.submitting) return;
    U.submitting = true;
    renderForm();
    var fd = new FormData(), lk = composeLink(), d = dlDest();
    ['messageType', 'team', 'campaignName', 'desiredSendDate', 'sendTimeBand', 'sendTimeNote', 'targetSheet', 'targetConditionType',
     'targetConditionBasis', 'targetConditionPeriod',
     'targetDetail', 'estimatedAudience', 'copyTitle', 'copyBody', 'copyEyebrow', 'copyCta', 'copyCta2', 'imageUrl', 'slideVisual', 'slideEmoji', 'deliveryMethod',
     'sqlQuery', 'planningTeamNote', 'inappContentCategory', 'inappMessageFormat', 'inappLayout', 'inappLayoutSubtype', 'inappHtmlType',
     'inappTriggerType', 'inappTriggerEventName', 'inappTriggerDelaySeconds'].forEach(function (k) {
      var v = F[k];
      if (F.messageType !== 'inapp' && k.indexOf('inapp') === 0) v = '';
      if (F.targetSheet !== '타겟' && /^target(Condition|Detail)/.test(k)) v = '';
      if (F.targetHow !== 'ask' && /^targetCondition/.test(k)) v = '';
      fd.append(k, v == null ? '' : v);
    });
    if (F.messageType === 'push') {
      var body = F.copyBody.trim();
      fd.set('copyBody', body ? body + '\n' + opt('pushOptout') : '');
    }
    fd.append('deepLink', d && lk.ok ? lk.link : '');
    fd.append('deepLinkName', d && lk.ok ? d.name : '');
    if (F.deliveryMethod === 'file' && F.file) fd.append('memberFile', F.file);
    var editing = U.editId;
    function stop() { U.submitting = false; renderForm(); }
    function send() {
    api(editing ? '/api/msgreq/requests/' + encodeURIComponent(editing) + '/update' : '/api/msgreq/requests', { method: 'POST', body: fd })
      .then(function (r) { U.done = { id: editing || r.id, edited: !!editing, card: !!(r && r.cardUpdated) }; U.editId = null; U.list = null; U.submitting = false; F = blankForm(); U.suggest = { state: 'idle', variants: [], picked: -1 }; renderForm(); })
      .catch(function (e) {
        U.submitting = false;
        if (e.body && e.body.error === 'too_soon' && e.body.minSendDate) { B.schedule.minSendDate = e.body.minSendDate; }
        renderForm();
        toast(errText(e), true);
      });
    }
    // 카드 문구·타겟이 바뀌는데 Braze 에 이미 세팅된 캠페인이 있으면 저장 전에 한 번 알린다(막지 않는 안내)
    if (!(editing && U.editLocked && U.editCard)) { send(); return; }
    api('/api/msgreq/requests/' + encodeURIComponent(editing) + '/braze-check', { method: 'POST', body: fd })
      .then(function (r) { if (r && r.notice) openBrazeNotice(r.name, send, stop); else send(); })
      .catch(function (e) { if (e && e.body && e.body.error) { stop(); toast(errText(e), true); } else send(); });
  }
  function openBrazeNotice(name, onOk, onCancel) {
    closeApprove();
    apvEl = document.createElement('div');
    apvEl.className = 'apv-bg';
    apvEl.innerHTML = '<div class="apv"><div class="apv-h"><b>이미 세팅된 Braze 캠페인이 있어요</b>' +
      '<span>저장하면 캠페인 카드만 바뀌고 Braze 세팅은 그대로예요. 세팅된 캠페인의 문구·타겟도 같이 확인해 주세요</span></div>' +
      (name ? '<div class="apv-rule"><i></i><span>' + esc(name) + '</span></div>' : '') +
      '<div class="apv-acts"><button type="button" class="btn-ghost" data-act="bz-cancel">취소</button>' +
      '<button type="button" class="btn-co" data-act="bz-ok">확인하고 저장</button></div></div>';
    R.appendChild(apvEl);
    apvEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (e.target === apvEl || (b && b.dataset.act === 'bz-cancel')) { closeApprove(); onCancel(); return; }
      if (b && b.dataset.act === 'bz-ok') { closeApprove(); onOk(); }
    });
  }

  function renderDone() {
    var id = U.done.id;
    view.innerHTML = '<div class="done"><h2>' + (U.done.edited ? '요청을 수정했어요' : '요청이 접수됐어요') + '</h2><p>' + (U.done.edited ? '바뀐 내용이 저장됐어요' + (U.done.card ? '. 연결된 캠페인 카드에도 반영했어요' : '') + '. ' : '기획분석팀 슬랙 채널로 알림이 갔어요. ') + '요청 번호 ' + esc(id) + '</p>' +
      '<div class="acts"><button type="button" class="btn-co" data-act="go" data-v="r:' + esc(id) + '">요청 상세 보기</button>' +
      '<button type="button" class="btn-ghost" data-act="new">새 요청 쓰기</button></div></div>';
  }

  // ───────────── 요청 목록 ─────────────
  function selectHtml(field, id, options, value, placeholder) {
    return '<select class="sel-s" data-patch="' + field + '" data-id="' + esc(id) + '">' + (placeholder != null ? '<option value="">' + esc(placeholder) + '</option>' : '') +
      options.map(function (o) {
        var v = typeof o === 'string' ? o : o.value, l = typeof o === 'string' ? o : o.label;
        return '<option value="' + esc(v) + '"' + (v === value ? ' selected' : '') + '>' + esc(l) + '</option>';
      }).join('') + '</select>';
  }
  // 상태 선택: 완료는 카드가 정하므로 고를 수 없고, 카드가 생긴 요청은 대기·검토로 되돌릴 수 없다
  function statusSelect(r, options) {
    return '<select class="sel-s" data-patch="status" data-id="' + esc(r.id) + '">' + options.map(function (v) {
      var off = v !== r.status && v === '완료';   // 대기·검토로 되돌리기는 허용 — 카드는 서버가 거둔다(2026-10-08)
      return '<option value="' + esc(v) + '"' + (v === r.status ? ' selected' : '') + (off ? ' disabled' : '') + '>' + esc(v) + '</option>';
    }).join('') + '</select>';
  }
  function editorName(email) {
    if (!email) return '';
    var e = (U.list && U.list.editors || []).filter(function (x) { return x.email === email; })[0];
    return e ? e.name : email.split('@')[0];
  }

  var IC_EDIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
  var IC_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
  // 대기일 때는 요청자·편집자, 검토·승인 뒤에는 편집자만 고친다(완료·반려 제외). 삭제는 편집자라면 검토 뒤에도 사유를 받고 한다.
  function isMine(r) { return !!(B && B.me && B.me.email && r.requesterEmail && r.requesterEmail.toLowerCase() === B.me.email.toLowerCase()); }
  function canEdit(r) {
    if (!(B && B.me)) return false;
    return r.status === '대기' ? (B.me.isEditor || isMine(r)) : (B.me.isEditor && r.status !== '완료' && r.status !== '반려');
  }
  function canDelete(r) { return !!(B && B.me) && (B.me.isEditor || (r.status === '대기' && isMine(r))); }
  function sendDay(r) { return r.confirmedSendDate || r.desiredSendDate; }   // 확정 발송일이 있으면 그 날짜
  // ───────────── 요청 → 카드 진행 단계 ─────────────
  // 요청 상태와 카드 상태를 한 줄로 잇는다. 승인 뒤부터는 카드 상태가 원천이다.
  var CARD_DONE = { '발송완료': 1, '운영중': 1, '운영완료': 1 };
  function flowStep(r, cs) {
    if (r.status === '완료' || CARD_DONE[cs]) return 4;
    if (r.campaignId) return cs === '발송예정' ? 3 : 2;
    return r.status === '승인' ? 1 : 0;
  }
  function flowHtml(r, cs, mini) {
    var rej = r.status === '반려', cur = rej ? 0 : flowStep(r, cs);
    var names = [rej ? '반려' : (r.status === '검토' ? '검토' : '접수'), '승인', '카드 기획', '발송예정', '완료'];
    return '<div class="flow' + (mini ? ' mini' : '') + '">' + names.map(function (n, i) {
      var cls = rej && i === 0 ? 'rej' : (i < cur ? 'fin' : (i === cur ? 'on' : 'todo'));
      return '<div class="fs ' + cls + '"><i></i><span>' + esc(n) + '</span></div>';
    }).join('') + '</div>';
  }
  function recOf(id) {
    var rec = null;
    ((U.list && U.list.rows) || []).forEach(function (row) { if (row.id === id) rec = row; });
    if (!rec && U.detailRec && U.detailRec.id === id) rec = U.detailRec;
    return rec;
  }
  var apvEl = null;
  function closeApprove() { if (apvEl) { apvEl.remove(); apvEl = null; } }
  function openApprove(id) {
    closeApprove();
    apvEl = document.createElement('div');
    apvEl.className = 'apv-bg';
    apvEl.innerHTML = '<div class="apv"><div class="loading"><span class="spin"></span></div></div>';
    R.appendChild(apvEl);
    apvEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (e.target === apvEl || (b && b.dataset.act === 'apv-close')) { closeApprove(); return; }
      if (b && b.dataset.act === 'apv-ok') {
        var cIn = apvEl.querySelector('#apv-concept');
        var body = { status: '승인' };
        if (cIn) {   // 묶음 이름은 카드로만 가고 요청서 필드는 아니다. 비우면 승인을 막는다(보고서 묶음 열쇠)
          if (!cIn.value.trim()) { cIn.focus(); return; }
          body.concept = cIn.value.trim();
        }
        b.disabled = true; b.textContent = '카드 만드는 중';
        patch(id, body, null, function () {
          closeApprove();
          if (U.route === 'list') renderList(); else if (U.route === 'r:' + id) loadDetail(id);
        }, function () { closeApprove(); });
      }
    });
    api('/api/msgreq/requests/' + encodeURIComponent(id) + '/card-preview').then(function (pv) {
      if (!apvEl) return;
      var rec = recOf(id) || {};
      var html;
      if (pv.exists) {
        html = '<div class="apv-h"><b>이미 카드가 있어요</b><span>승인 상태만 저장해요</span></div>' +
          flowHtml({ status: '승인', campaignId: pv.campaignId }, pv.campaignStatus, true) +
          '<div class="apv-card"><div class="apv-fold">' + esc((pv.campaignPath || '').split('/').pop()) + '</div>' +
          '<div class="apv-kv"><span>상태</span><b>' + esc(pv.campaignStatus || '확인 불가') + '</b></div></div>' +
          '<div class="apv-acts"><button type="button" class="btn-ghost" data-act="apv-close">취소</button><button type="button" class="btn-co" data-act="apv-ok">승인</button></div>';
      } else {
        var bad = pv.blocked;
        html = '<div class="apv-h"><b>승인하면 캠페인 카드가 생겨요</b><span>요청서는 원본으로 남고, 카드는 기획 상태로 대시보드에 올라가요</span></div>' +
          flowHtml({ status: '승인' }, '', true) +
          '<div class="apv-card"><div class="apv-fold">' + esc(pv.folder) + '</div>' +
          '<div class="apv-kv"><span>유형</span><b>' + esc(pv.type + ' · ' + pv.medium) + '</b></div>' +
          '<div class="apv-kv"><span>담당</span><b>' + esc(pv.owner) + '</b></div>' +
          '<div class="apv-kv"><span>발송일</span><b>' + esc(md(pv.sendDate)) + '</b></div>' +
          '<div class="apv-kv"><span>상태</span><b>기획 <em>실모수는 카드에서 채워요</em></b></div>' +
          '<div class="apv-kv apv-concept"><label for="apv-concept">묶음</label><div>' +
          '<input type="text" class="inp" id="apv-concept" list="apv-concept-list" maxlength="60" autocomplete="off" placeholder="같은 기획의 카드를 묶는 이름" value="' + esc(pv.concept || '') + '">' +
          '<datalist id="apv-concept-list">' + (pv.conceptChoices || []).map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
          '<em>' + esc(pv.conceptSource ? '제안 근거 · ' + pv.conceptSource : '') + ' 같은 기획의 카드와 글자까지 같아야 주간 보고서에서 한 묶음이 돼요</em></div></div></div>' +
          (bad ? '<div class="apv-rule bad"><i></i><span>규칙에 걸려 카드를 만들 수 없어요 · ' + esc(pv.reasons.join(', ')) + '</span></div>'
               : '<div class="apv-rule"><i></i><span>카드 규칙 통과</span></div>') +
          (pv.warnings && pv.warnings.length ? '<div class="apv-warn">카드에서 확인 · ' + esc(pv.warnings.join(', ')) + '</div>' : '') +
          '<div class="apv-acts"><button type="button" class="btn-ghost" data-act="apv-close">취소</button>' +
          '<button type="button" class="btn-co" data-act="apv-ok"' + (bad ? ' disabled' : '') + '>승인하고 카드 만들기</button></div>';
      }
      apvEl.querySelector('.apv').innerHTML = html;
      var cIn = apvEl.querySelector('#apv-concept'), ok = apvEl.querySelector('[data-act="apv-ok"]');
      if (cIn && ok && !pv.blocked) {
        var sync = function () { ok.disabled = !cIn.value.trim(); };
        cIn.addEventListener('input', sync); sync();
      }
    }).catch(function (e) { toast(errText(e), true); closeApprove(); });
  }
  // 사유를 받는 확인 창(반려·삭제·발송일 변경). 사유는 요청자를 태그해 슬랙 인입 글 스레드에 남는다.
  // o: {title, sub, placeholder, ok, date(발송일 입력을 같이 받을 때 현재 값), onOk(reason, date, fail)}
  function openReason(o) {
    closeApprove();
    apvEl = document.createElement('div');
    apvEl.className = 'apv-bg';
    apvEl.innerHTML = '<div class="apv"><div class="apv-h"><b>' + esc(o.title) + '</b><span>' + esc(o.sub) + '</span></div>' +
      (o.date != null ? '<div class="apv-date"><label for="rsn-date">바꿀 발송일</label><input type="date" class="inp" id="rsn-date" min="' + esc(B.schedule.today) + '" value="' + esc(o.date) + '"></div>' : '') +
      '<textarea class="inp" id="rsn-text" maxlength="500" placeholder="' + esc(o.placeholder) + '"></textarea>' +
      (o.confirm ? '<label class="apv-chk"><input type="checkbox" id="rsn-chk"> ' + esc(o.confirm) + '</label>' : '') +
      '<div class="apv-acts"><button type="button" class="btn-ghost" data-act="apv-close">취소</button>' +
      '<button type="button" class="btn-co' + (o.danger ? ' danger' : '') + '" data-act="rsn-ok" disabled>' + esc(o.ok) + '</button></div></div>';
    R.appendChild(apvEl);
    var ta = apvEl.querySelector('#rsn-text'), dt = apvEl.querySelector('#rsn-date'), ck = apvEl.querySelector('#rsn-chk'), ok = apvEl.querySelector('[data-act="rsn-ok"]');
    function ready() { return !!ta.value.trim() && (!dt || (dt.value && dt.value !== o.date)) && (!ck || ck.checked); }
    (dt || ta).focus();
    [ta, dt, ck].forEach(function (x) { if (x) { x.addEventListener('input', function () { ok.disabled = !ready(); }); x.addEventListener('change', function () { ok.disabled = !ready(); }); } });
    apvEl.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (e.target === apvEl || (b && b.dataset.act === 'apv-close')) { closeApprove(); return; }
      if (b && b.dataset.act === 'rsn-ok' && ready()) {
        b.disabled = true;
        o.onOk(ta.value.trim(), dt ? dt.value : '', function () { b.disabled = false; });
      }
    });
  }
  function afterChange(id) {
    closeApprove();
    U.list = null;
    if (U.route === 'list') loadList(); else if (U.route === 'r:' + id) loadDetail(id);
  }
  var BRAZE_STOP = 'Braze 캔버스 예약을 중지했어요(카드가 발송예정이라 캔버스는 그대로 나가요)';
  function withCardStatus(id, fn) {   // 연결된 카드의 지금 상태를 읽고 창을 연다
    api('/api/msgreq/requests/' + encodeURIComponent(id)).then(function (D) { fn(D.campaignStatus || ''); })
      .catch(function () { fn(''); });
  }
  function openReject(id) { withCardStatus(id, function (cs) { openRejectWith(id, cs); }); }
  function openRejectWith(id, cs) {
    var rec = recOf(id) || {};
    openReason({ title: '요청 건을 반려할까요', ok: '반려', confirm: cs === '발송예정' ? BRAZE_STOP : '',
      sub: (rec.campaignId ? '연결된 캠페인 카드는 지운 카드로 옮겨져요. ' : '') + '사유는 요청자를 태그해 슬랙 인입 글 스레드에 남겨요',
      placeholder: '예) 발송 희망일에 같은 대상 캠페인이 잡혀 있어 일정 조정이 필요해요',
      onOk: function (reason, _, fail) { patch(id, { status: '반려', rejectReason: reason, brazeStopped: cs === '발송예정' }, null, function () { afterChange(id); }, fail); } });
  }
  function openSendDate(id) {
    var rec = recOf(id) || {};
    openReason({ title: '발송일을 바꿀까요', ok: '발송일 변경',
      sub: '연결된 캠페인 카드 발송일도 같이 바뀌어요. 사유는 카드가 발송예정이 될 때 바뀐 항목과 함께 요청자에게 알려요',
      date: sendDay(rec) || '', placeholder: '예) 같은 날 대상이 겹치는 캠페인이 있어 이틀 뒤로 옮겨요',
      onOk: function (reason, day, fail) {
        api('/api/msgreq/requests/' + encodeURIComponent(id) + '/send-date', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sendDate: day, reason: reason }) })
          .then(function () { toast('발송일을 바꿨어요'); afterChange(id); })
          .catch(function (e) { toast(errText(e), true); fail(); });
      } });
  }
  function cardLink(r) {
    if (!r.campaignId) return '';
    return ' <a class="cardlk" data-act="card" href="/dashboard?cid=' + encodeURIComponent(r.campaignId) + '" target="_blank" rel="noopener" title="캠페인 카드 열기">카드</a>';
  }
  // 상세 화면은 목록 행보다 자리가 넓어 수정 버튼에 글자를 붙인다(아이콘만 있으면 상세에서 고치는 길을 못 찾았다)
  function detailActs(r) {
    if (!canEdit(r) && !canDelete(r)) return '';
    return '<div class="acts-i">' + (canEdit(r) ? '<button type="button" class="btn-ghost dt-edit" data-act="edit" data-v="' + esc(r.id) + '">' + IC_EDIT + '수정</button>' : '') +
      (canDelete(r) ? '<button type="button" class="ib del" data-act="del" data-v="' + esc(r.id) + '" title="삭제">' + IC_TRASH + '</button>' : '') + '</div>';
  }
  function rowActs(r) {
    if (!canEdit(r) && !canDelete(r)) return '<div></div>';
    return '<div class="acts-i">' + (canEdit(r) ? '<button type="button" class="ib" data-act="edit" data-v="' + esc(r.id) + '" title="수정">' + IC_EDIT + '</button>' : '') +
      (canDelete(r) ? '<button type="button" class="ib del" data-act="del" data-v="' + esc(r.id) + '" title="삭제">' + IC_TRASH + '</button>' : '') + '</div>';
  }
  function renderList() {
    var L = U.list;
    var rows = L.rows;
    var counts = { '전체': rows.length };
    L.statusOptions.forEach(function (s) { counts[s] = rows.filter(function (r) { return r.status === s; }).length; });
    var q = U.q.trim().toLowerCase();
    var shown = rows.filter(function (r) {
      if (U.filter !== '전체' && r.status !== U.filter) return false;
      if (!q) return true;
      return [r.campaignName, r.team, r.requesterNickname, r.requesterEmail].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    var editors = L.editors.map(function (e) { return { value: e.email, label: e.name }; });
    var tabs = ['전체'].concat(L.statusOptions).map(function (s) {
      return '<button type="button" class="' + (U.filter === s ? 'on' : '') + '" data-act="filter" data-v="' + esc(s) + '">' + esc(s) + '<b>' + counts[s] + '</b></button>';
    }).join('');
    var PAGE = 20, pages = Math.max(1, Math.ceil(shown.length / PAGE));
    U.page = Math.min(Math.max(1, U.page || 1), pages);
    var pageRows = shown.slice((U.page - 1) * PAGE, U.page * PAGE);
    var pager = pages > 1 ? '<div class="pager"><button type="button" data-act="page" data-v="' + (U.page - 1) + '"' + (U.page === 1 ? ' disabled' : '') + '>‹</button>' +
      Array.apply(null, Array(pages)).map(function (_, i) { return '<button type="button" class="' + (i + 1 === U.page ? 'on' : '') + '" data-act="page" data-v="' + (i + 1) + '">' + (i + 1) + '</button>'; }).join('') +
      '<button type="button" data-act="page" data-v="' + (U.page + 1) + '"' + (U.page === pages ? ' disabled' : '') + '>›</button></div>' : '';
    var body = pageRows.map(function (r) {
      var ctrl = L.isEditor
        ? statusSelect(r, L.statusOptions) + '</div><div>' + selectHtml('assignee', r.id, editors, r.assignee || '', '담당자') +
          '</div><div><input type="date" class="sel-s" data-patch="dueDate" data-id="' + esc(r.id) + '" value="' + esc(r.dueDate || '') + '">'
        : '<span class="st-pill s-' + esc(r.status) + '">' + esc(r.status) + '</span></div><div class="ro">' + esc(editorName(r.assignee) || '미지정') +
          '</div><div class="ro">' + esc(r.dueDate ? md(r.dueDate) : '');
      return '<div class="lr" data-act="open" data-v="' + esc(r.id) + '"><div class="lr-main"><span class="ty ' + esc(r.messageType) + '">' +
        (r.messageType === 'push' ? '푸시' : '인앱') + '</span><div><div class="nm">' + esc(r.campaignName) + cardLink(r) + '</div><div class="sb">' +
        esc([r.requesterNickname || (r.requesterEmail || '').split('@')[0], r.team, stamp(r.createdAt) + ' 접수'].filter(Boolean).join(' · ')) +
        '</div></div></div><div class="lr-d">' + md(sendDay(r)) + '</div><div>' + ctrl + '</div>' + rowActs(r) + '</div>';
    }).join('');
    view.innerHTML = '<div class="list-card"><div class="list-top"><div class="tabs">' + tabs + '</div><input class="inp srch" id="list-q" placeholder="요청자, 팀, 캠페인명 검색" value="' + esc(U.q) + '"></div>' +
      '<div class="tbl"><div class="lr lh"><span>요청</span><span>발송 희망일</span><span>상태</span><span>담당자</span><span>처리기한</span><span></span></div>' +
      (body || '<div class="empty">' + (rows.length ? '조건에 맞는 요청이 없어요' : '아직 접수된 요청이 없어요') + '</div>') + '</div>' + pager + '</div>' +
      '<div class="list-foot">' + (L.isEditor ? '상태·담당자·처리기한은 바꾸면 바로 저장돼요' : '상태·담당자·처리기한은 편집자 명단 등록자만 수정') + '</div>';
    var qEl = R.getElementById('list-q');
    qEl.addEventListener('input', function () { U.q = qEl.value; U.page = 1; var pos = qEl.selectionStart; renderList(); var n = R.getElementById('list-q'); n.focus(); n.setSelectionRange(pos, pos); });
  }

  function loadList() {
    if (U.list) renderList(); else view.innerHTML = '<div class="loading"><span class="spin"></span></div>';
    api('/api/msgreq/requests').then(function (L) { U.list = L; countPending(L); if (U.route === 'list') renderList(); })
      .catch(function (e) { view.innerHTML = '<div class="empty">' + esc(errText(e)) + '</div>'; });
  }

  // field 자리에 객체를 주면 여러 값을 한 번에 저장한다(반려 상태 + 사유)
  function patch(id, field, value, after, onFail) {
    var body = {};
    if (typeof field === 'object') body = field; else body[field] = value;
    api('/api/msgreq/requests/' + encodeURIComponent(id), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) {
        ((U.list && U.list.rows) || []).forEach(function (row) { if (row.id === id) { Object.keys(body).forEach(function (k) { if (k in r.record) row[k] = r.record[k]; }); row.campaignId = r.record.campaignId; row.campaignPath = r.record.campaignPath; } });
        if (U.detailRec && U.detailRec.id === id) U.detailRec = r.record;   // 실패 시 되돌릴 기준값도 저장된 값으로
        toast(body.status === '승인' && r.record.campaignId ? '승인 · 캠페인 카드를 만들었어요' : '저장했어요');
        if (after) after(r.record);
      })
      .catch(function (e) { toast(errText(e), true); if (onFail) onFail(e); });
  }

  // ───────────── 요청 상세 ─────────────
  function renderDetail(D) {
    var r = D.record, ed = D.isEditor;
    U.detailRec = r; U.detailCS = D.campaignStatus || '';
    var editors = D.editors.map(function (e) { return { value: e.email, label: e.name }; });
    U.list = U.list || { editors: D.editors };
    function blk(title, rows, extra) {
      var inner = rows.filter(function (x) { return x && x[1]; }).map(function (x) { return '<div class="kv"><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('');
      return inner || extra ? '<div class="blk"><h3>' + esc(title) + '</h3>' + inner + (extra || '') + '</div>' : '';
    }
    var layout = layoutOf(r.inappLayout), sub = subtypeOf(layout, r.inappLayoutSubtype), ht = htmlTypeOf(r.inappHtmlType);
    var inapp = r.messageType === 'inapp' ? blk('인앱 설정', [
      ['내용 분류', (opt('inappContentCategories').filter(function (c) { return c.value === r.inappContentCategory; })[0] || {}).label],
      ['형태', r.inappMessageFormat === 'HTML' ? '커스텀 인앱메시지' : '기본 인앱메시지'],
      ['레이아웃', layout ? layout.group + ' · ' + layout.label + (sub && layout.subtypes.length > 1 ? ', ' + sub.label : '') : (ht ? ht.label : '')],
      ['노출 트리거', r.inappTriggerType === 'event' ? '커스텀 이벤트 ' + r.inappTriggerEventName : r.inappTriggerType === 'session_start' ? '세션 시작' + (r.inappTriggerDelaySeconds ? ' + ' + r.inappTriggerDelaySeconds + '초' : '') : ''],
    ]) : '';
    var copyRows = r.messageType === 'push'
      ? [['제목', r.copyTitle ? '(광고) ' + r.copyTitle : ''], ['본문', r.copyBody]] // lint-ok(광고표기) 표기 확인용
      : [['이미지 주소', r.imageUrl], ['아이콘', r.slideVisual === 'emoji' ? r.slideEmoji : ''], ['자격 조건 문구', r.copyEyebrow], ['제목', r.copyTitle], ['본문', r.copyBody], ['버튼 문구', r.copyCta], ['두 번째 버튼', r.copyCta2]];
    var deliveryExtra = '';
    if (r.deliveryMethod === 'sql' && r.sqlQuery) deliveryExtra = '<pre>' + esc(r.sqlQuery) + '</pre>';
    if (r.deliveryMethod === 'file' && r.memberFileName) {
      deliveryExtra = '<div class="file" style="margin-top:6px"><span class="gl on">CSV</span><div><div style="font-weight:700">' + esc(r.memberFileName) +
        '</div><div style="font-size:13px;color:var(--ink3)">회원번호 ' + (r.memberFileRows || 0).toLocaleString() + '건</div></div>' +
        (ed ? '<a class="lnk" href="/api/msgreq/requests/' + esc(r.id) + '/file">내려받기</a>' : '<span class="lnk" style="color:var(--ink4)">편집자만 열람</span>') + '</div>';
    }
    var rejHtml = r.status === '반려' && r.rejectReason ? '<div class="kv rej"><span>반려 사유</span><b>' + esc(r.rejectReason) + '</b></div>' : '';
    var mgmt = ed
      ? '<div class="blk mgmt"><h3>요청 관리</h3><div class="fieldrow"><label>상태</label>' + statusSelect(r, D.statusOptions) + '</div>' +
        '<div class="fieldrow"><label>우선순위</label>' + selectHtml('priority', r.id, D.priorityOptions, r.priority || '', '미지정') + '</div>' +
        '<div class="fieldrow"><label>담당자</label>' + selectHtml('assignee', r.id, editors, r.assignee || '', '담당자') + '</div>' +
        '<div class="fieldrow"><label>처리기한</label><input type="date" class="inp" data-patch="dueDate" data-id="' + esc(r.id) + '" value="' + esc(r.dueDate || '') + '"></div>' +
        rejHtml +
        (r.status !== '완료' && r.status !== '반려' ? '<button type="button" class="btn-ghost sd-btn" data-act="send-date" data-v="' + esc(r.id) + '">발송일 변경</button>' : '') +
        '<div class="hint">바꾸면 바로 저장돼요' + (r.updatedBy ? ' · 마지막 수정 ' + esc(r.updatedBy.split('@')[0]) + ' ' + esc(stamp(r.updatedAt)) : '') + '</div></div>'
      : '<div class="blk"><h3>요청 관리</h3>' + [['상태', r.status], ['우선순위', r.priority || '미지정'], ['담당자', editorName(r.assignee) || '미지정'],
        ['처리기한', r.dueDate ? md(r.dueDate) : '미정']].map(function (x) { return '<div class="kv"><span>' + x[0] + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') +
        rejHtml +
        '<div class="hint">편집자 명단 등록자만 바꿀 수 있어요</div></div>';
    var preview = '';
    if (r.messageType === 'push') {
      var d = parse(r.desiredSendDate);
      preview = '<div class="lock" style="margin-bottom:14px"><div class="lk-time">9:41</div><div class="lk-date">' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 ' + WD[d.getDay()] + '요일</div>' +
        '<div class="noti"><div class="nh"><span class="ic"></span>모두의주차장<em>지금</em></div><div class="nt">(광고) ' + esc(r.copyTitle) + '</div>' + // lint-ok(광고표기)
        '<div class="nb">' + esc(r.copyBody) + '</div></div></div>';
    }
    var BACK = '<button type="button" class="back" data-act="go" data-v="list"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>현황으로</button>';
    view.innerHTML = BACK + '<div class="dt-head"><div><span class="ty ' + esc(r.messageType) + '">' + esc(typeLabel(r.messageType)) + '</span><h1>' + esc(r.campaignName) + '</h1>' +
      '<div class="sb">' + esc([r.requesterNickname, r.team, stamp(r.createdAt) + ' 접수', '요청 번호 ' + r.id].join(' · ')) + '</div></div>' +
      '<div class="dt-right"><span class="st-pill s-' + esc(r.status) + '" style="font-size:13.5px;padding:3px 12px">' + esc(r.status) + '</span>' + detailActs(r) + '</div>' +
      flowHtml(r, D.campaignStatus || '', false) + '</div>' +
      '<div class="dt-grid"><div>' +
      blk('요청 정보', [['메시지 유형', typeLabel(r.messageType)], ['요청자', (r.requesterNickname || '') + ' · ' + r.requesterEmail], ['요청팀', r.team], ['캠페인명', r.campaignName]],
        r.campaignId ? '<div class="kv"><span>캠페인 카드</span><b><a class="lnk" href="/dashboard?cid=' + encodeURIComponent(r.campaignId) + '" target="_blank" rel="noopener">' + esc((r.campaignPath || '').split('/').pop() || r.campaignId) + '</a></b></div>' : '') +
      blk('일정', [['발송 희망일', md(r.desiredSendDate)],
        ['확정 발송일', r.confirmedSendDate && r.confirmedSendDate !== r.desiredSendDate ? md(r.confirmedSendDate) : ''],   // 희망일은 원본으로 두고 바뀐 날짜만 따로
        ['발송 시간', bandLabel(r.sendTimeBand)], ['시간 요청사항', r.sendTimeNote]]) +
      blk('타겟', [['타겟 그룹', r.targetSheet], ['조건 유형', condLabel(r)], ['부연 설명', r.targetDetail],
        ['예상 모수', r.targetSheet === '전체' ? allLabel(r.messageType) : r.estimatedAudience]]) +
      inapp + blk('메시지 문구', copyRows) +
      blk('랜딩 링크', [['도착 화면', r.deepLinkName], ['딥링크', r.deepLink]]) +
      blk('발송 타겟 전달', [['전달 방식', deliveryLabel(r.deliveryMethod)], ['메모', r.planningTeamNote]], deliveryExtra) +
      '</div><div>' + mgmt + changesHtml(r) + historyHtml(r) + preview + '</div></div>';
  }
  // 카드가 발송예정이 될 때 요청 원본과 견준 바뀐 항목(스레드로 요청자에게 한 번에 알린 내용)
  function changesHtml(r) {
    if (!r.scheduledNoticeAt) return '';
    var cs = r.scheduledChanges || [];
    return '<div class="blk hist"><h3>발송 확정 때 바뀐 항목</h3>' + (cs.length ? cs.map(function (c) {
      return '<div class="h-row"><div class="h-what">' + esc(c.label) + ': ' + esc(c.old || '없음') + ' → ' + esc(c.new || '없음') + '</div>' +
        (c.reason ? '<div class="h-why">사유: ' + esc(c.reason) + '</div>' : '') + '</div>';
    }).join('') : '<div class="h-row"><div class="h-what">요청 내용 그대로 확정</div></div>') + '</div>';
  }
  // 수정 이력: 대기 중 요청자 수정, 검토 뒤 담당자 수정, 발송일 변경(사유)
  function historyHtml(r) {
    var hs = (r.history || []).slice().reverse();
    if (!hs.length) return '';
    return '<div class="blk hist"><h3>수정 이력</h3>' + hs.map(function (h) {
      var mine = h.by && r.requesterEmail && h.by.split('@')[0] === r.requesterEmail.split('@')[0];
      var who = h.by === 'campaign' ? '캠페인 카드' : mine ? (r.requesterNickname || '요청자') + ' (요청자)' : editorName(h.by);
      var what = (h.changes || []).map(function (c) {
        var isDay = /SendDate$/.test(c.field), o = isDay ? md(c.old) : c.old, n = isDay ? md(c.new) : c.new;
        var short = String(o || '').length <= 40 && String(n || '').length <= 40 && String(o || '').indexOf('\n') < 0 && String(n || '').indexOf('\n') < 0;
        return esc(c.label) + (short ? ' ' + esc(o || '없음') + ' → ' + esc(n || '없음') : ' 변경');
      }).join(', ');
      return '<div class="h-row"><div class="h-meta">' + esc(stamp(h.at)) + ' · ' + esc(who) + '</div><div class="h-what">' + what + '</div>' +
        (h.reason ? '<div class="h-why">사유: ' + esc(h.reason) + '</div>' : '') + '</div>';
    }).join('') + '</div>';
  }

  function loadDetail(id) {
    view.innerHTML = '<div class="loading">불러오는 중</div>';
    api('/api/msgreq/requests/' + encodeURIComponent(id)).then(renderDetail)
      .catch(function (e) { view.innerHTML = '<div class="empty">' + esc(e && e.body && e.body.error === 'not_found' ? '지워졌거나 없는 요청이에요' : errText(e)) + '<div style="margin-top:14px"><button type="button" class="btn-ghost" data-act="go" data-v="list">현황으로</button></div></div>'; });
  }

  // ───────────── 라우팅·이벤트 ─────────────
  function readRoute() {
    try {
      var p = new URL(location.href).searchParams;
      if (p.get('req')) return 'r:' + p.get('req');
      if (p.get('mr') === 'list') return 'list';
    } catch (e) { /* noop */ }
    return 'new';
  }
  // 대시보드 뒤로 가기 기록을 건드리지 않게 replaceState 로 주소 값만 바꾼다.
  // 화면 전환: 지금 화면을 살짝 내리며 지우고, 다음 화면을 띄운다
  function go(r) {
    if (U.route === r) { route(); return; }   // 같은 화면이면 애니메이션 없이 다시 그린다(제출 뒤 새 요청 쓰기)
    view.classList.add('out');
    setTimeout(function () { view.classList.remove('out'); goNow(r); }, 80);
  }
  function goNow(r) {
    U.route = r;
    try {
      var u = new URL(location.href);
      u.searchParams.delete('req'); u.searchParams.delete('mr');
      if (r === 'list') u.searchParams.set('mr', 'list');
      if (r.indexOf('r:') === 0) u.searchParams.set('req', r.slice(2));
      history.replaceState(history.state, '', u.toString());
    } catch (e) { /* noop */ }
    route();
    if (host && host.getBoundingClientRect().top < 0) host.scrollIntoView({ block: 'start' });
  }
  function route() {
    var r = U.route || 'new';
    headBtn();
    R.getElementById('mr').classList.toggle('wide', r !== 'new');
    // 화면이 바뀔 때 살짝 떠오르게(같은 요소라 애니메이션을 다시 시작시킨다)
    view.classList.remove('in'); void view.offsetWidth; view.classList.add('in');
    if (r === 'list') return loadList();
    if (r.indexOf('r:') === 0) return loadDetail(r.slice(2));
    if (U.done) { renderDone(); return; }
    renderForm();
  }

  // ───────────── 우상단 보기 전환: 요청하기(폼) · 요청 현황(접수된 요청 목록·상세). 누구나 볼 수 있고, 상태·담당자 수정은 기획운영팀 편집자만 ─────────────
  var head = null;
  var IC_PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>';
  var IC_LIST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.1"/><circle cx="4.5" cy="12" r="1.1"/><circle cx="4.5" cy="18" r="1.1"/></svg>';
  function countPending(L) {
    U.pending = ((L && L.rows) || []).filter(function (r) { return r.status === '대기'; }).length;
    headBtn();
  }
  function headBtn() {
    if (!head) return;
    if (!B || !B.me) { head.innerHTML = ''; return; }
    var admin = (U.route || 'new') !== 'new';
    // 이미 그려져 있으면 다시 만들지 않고 상태만 바꾼다(그래야 알약이 미끄러진다)
    var sw = head.querySelector('.mr-sw');
    if (sw) {
      sw.classList.toggle('admin', admin);
      sw.querySelectorAll('button').forEach(function (b) { var on = (b.dataset.mr === 'list') === admin; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
      var c = sw.querySelector('.cnt');
      var showCnt = U.pending && B.me.isEditor;   // 대기 건수 배지는 기획운영팀만
      if (showCnt && !c) sw.querySelector('[data-mr=list]').insertAdjacentHTML('beforeend', '<span class="cnt" title="대기 중인 요청">' + U.pending + '</span>');
      else if (c) { if (showCnt) c.textContent = U.pending; else c.remove(); }
      return;
    }
    head.innerHTML = '<div class="mr-sw' + (admin ? ' admin' : '') + '" role="tablist" aria-label="보기 전환">' +
      '<button type="button" role="tab" aria-selected="' + !admin + '"' + (admin ? '' : ' class="on"') + ' data-mr="new">' + IC_PEN + '<span>요청</span></button>' +
      '<button type="button" role="tab" aria-selected="' + admin + '"' + (admin ? ' class="on"' : '') + ' data-mr="list">' + IC_LIST + '<span>현황</span>' +
      (U.pending && B.me.isEditor ? '<span class="cnt" title="대기 중인 요청">' + U.pending + '</span>' : '') + '</button></div>';
  }

  function mount(el) {
    if (R) return;
    host = el;
    R = el.attachShadow({ mode: 'open' });
    R.innerHTML = '<link rel="stylesheet" href="' + CSS_URL + '"><div class="mr" id="mr">' +
      '<div class="wrap" id="view"><div class="loading">불러오는 중</div></div></div><div class="toast" id="toast" hidden></div>';
    view = R.getElementById('view');
    toastEl = R.getElementById('toast');
    head = document.getElementById('mr-head');
    if (head) head.addEventListener('click', function (e) {
      var b = e.target.closest('[data-mr]');
      if (!b || !B) return;
      if (b.dataset.mr === 'new') U.done = null;
      go(b.dataset.mr);
    });
    view.addEventListener('click', function (e) {
      // 막대의 맨 앞 점처럼 값이 그대로여도 누르면 고른 것으로 친다
      if (e.target.matches && e.target.matches('input[data-aud]')) { if (!e.target.disabled) audPick(e.target); return; }
      if (e.target.matches && e.target.matches('input[data-act=unk]')) { F.estimatedAudience = e.target.checked ? '모름' : ''; renderForm(); return; }
      var el = e.target.closest('[data-act]');
      if (!el || el.disabled || !view.contains(el)) return;
      if (el.dataset.act === 'edit' || el.dataset.act === 'del') e.stopPropagation();
      if (el.dataset.act === 'card') { e.stopPropagation(); return; }   // 새 탭으로 카드를 연다
      if (e.target.closest('select, input')) return;
      var act = el.dataset.act, v = el.dataset.v;
      if (act === 'set') {
        // 이미 고른 카드를 다시 누르면 해제한다(메시지 유형·날짜·추천 질문은 제외)
        var offable = !/^(messageType|desiredSendDate|quiz\.|dl\.)/.test(el.dataset.k) && el.classList.contains('on') && F[el.dataset.k] === v;
        setField(el.dataset.k, offable ? '' : v);
        if (el.dataset.k === 'desiredSendDate' || el.dataset.k === 'sendTimeBand') renderSchedule(); else renderForm();
      }
      else if (act === 'cal') {
        U.calMonth = new Date(U.calMonth.getFullYear(), U.calMonth.getMonth() + Number(v), 1);
        renderSchedule();
      }
      else if (act === 'clr') { F[v] = ''; renderForm(); var f0 = R.querySelector('[data-bind="' + v + '"]'); if (f0) f0.focus(); }
      else if (act === 'fpv') { U.fpvOpen = !U.fpvOpen; floatPreview(); }
      else if (act === 'pvz') { openZoom(); }
      else if (e.target.closest('.fpv-b .phn')) { openZoom(); }
      else if (act === 'sq') { U.sqOpen = !U.sqOpen; var qw = R.querySelector('.qwrap'); if (qw) qw.classList.toggle('open', U.sqOpen); }
      else if (act === 'qt') { U.qtOpen = !U.qtOpen; var ti = R.querySelector('.tl-info'); if (ti) ti.classList.toggle('open', U.qtOpen); }
      else if (act === 'suggest') suggest();
      else if (act === 'apply') applySuggestion(Number(v));
      else if (act === 'jump') { var s = R.getElementById('st-' + v); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      else if (act === 'submit') submit();
      else if (act === 'edit') startEdit(v);
      else if (act === 'send-date') openSendDate(v);
      else if (act === 'edit-cancel') cancelEdit();
      else if (act === 'del') { var row = ((U.list && U.list.rows) || []).filter(function (x) { return x.id === v; })[0]; removeRequest(v, row ? row.campaignName : (U.editName || '')); }
      else if (act === 'new') { U.done = null; go('new'); }
      else if (act === 'go') go(v);
      else if (act === 'filter') { U.filter = v; U.page = 1; renderList(); }
      else if (act === 'page') { U.page = Number(v); renderList(); }
      else if (act === 'open') go('r:' + v);
    });
    view.addEventListener('input', function (e) {
      var el = e.target, b = el.dataset && el.dataset.bind;
      if (el.matches && el.matches('input[data-aud]')) { audPick(el); return; }
      if (!b) return;
      if (b.indexOf('dl.') === 0) F.dlValues[b.slice(3)] = el.value; else F[b] = el.value;
      if (b === 'inappTriggerEventName') {
        R.querySelectorAll('[data-k="inappTriggerEventName"].on').forEach(function (x) { x.classList.remove('on'); var ck = x.querySelector('.ck'); if (ck) ck.remove(); });
      }
      refreshLive(b);
    });
    view.addEventListener('change', function (e) {
      var el = e.target;
      if (el.id === 'file-in') { checkFile(el.files && el.files[0]); return; }
      if (el.dataset && el.dataset.patch) {
        var field = el.dataset.patch, id = el.dataset.id;
        if (field === 'status' && el.value === '승인') {
          var cur = recOf(id);
          if (cur && !cur.campaignId) { el.value = cur.status || '대기'; openApprove(id); return; }   // 카드가 없으면 확인 창을 거친다
        }
        if (field === 'status' && el.value === '반려') {
          var cur2 = recOf(id);
          if (!cur2 || cur2.status !== '반려') { el.value = (cur2 && cur2.status) || '대기'; openReject(id); return; }   // 사유를 받는 창을 거친다
        }
        var prev = (recOf(id) || {})[field];   // 저장이 거절되면(카드 연결·완료 차단 등) 고르기 전 값으로 되돌린다
        patch(id, field, el.value || null, function (rec) {
          if (U.route.indexOf('r:') === 0) {
            var pill = R.querySelector('.dt-head .st-pill');
            if (pill) { pill.textContent = rec.status; pill.className = 'st-pill s-' + rec.status; }
            if (rec.campaignId && !R.querySelector('.dt-grid .lnk[href*="cid="]')) loadDetail(rec.id);   // 카드가 막 생겼으면 링크가 보이게
          }
        }, function () { el.value = prev == null ? '' : prev; });
      }
    });

    function closePops() {
      if (!U.sqOpen && !U.qtOpen) return;
      U.sqOpen = U.qtOpen = false;
      R.querySelectorAll('.qwrap.open, .tl-info.open').forEach(function (x) { x.classList.remove('open'); });
    }
    document.addEventListener('click', function (e) {
      var path = e.composedPath ? e.composedPath() : [];
      if (path.some(function (n) { return n.classList && (n.classList.contains('qwrap') || n.classList.contains('tl-info')); })) return;
      closePops();
    });
    document.addEventListener('keydown', function (e) { if (e.key !== 'Escape') return; if (R.getElementById('pvz')) closeZoom(); else if (apvEl) closeApprove(); else closePops(); });

    U.route = readRoute();
    U.fpvOpen = true;   // 우하단 미리보기는 기본으로 열어 둔다
    // 직전 방문의 옵션 묶음이 있으면 먼저 그리고, 서버 응답이 오면 바꿔 끼운다(인스턴스 재기동 직후 몇 초를 기다리지 않게)
    var BOOT_KEY = 'msgreq.boot.' + CSS_URL, cached = null;
    try { cached = JSON.parse(localStorage.getItem(BOOT_KEY) || 'null'); } catch (e) { cached = null; }
    if (cached && cached.options && cached.me) { B = cached; route(); }
    api('/api/msgreq/bootstrap').then(function (b) {
      var same = cached && JSON.stringify(cached) === JSON.stringify(b);
      try { localStorage.setItem(BOOT_KEY, JSON.stringify(b)); } catch (e) { /* 저장 못 해도 동작에는 영향 없음 */ }
      B = b;
      var me = b.me || {};
      if (cached && same) { api('/api/msgreq/requests').then(function (L) { U.list = L; countPending(L); if (U.route === 'list') renderList(); }).catch(function () { /* noop */ }); return; }
      // 우상단 요청 목록 버튼의 대기 건수(편집자만). 못 불러오면 건수만 빠진다.
      api('/api/msgreq/requests').then(function (L) { U.list = L; countPending(L); }).catch(function () { /* noop */ });
      route();
    }).catch(function (e) {
      if (e.status === 401) {
        view.innerHTML = '<div class="empty">로그인이 필요해요. <a href="/auth/login">구글 계정으로 로그인</a></div>';
        return;
      }
      view.innerHTML = '<div class="empty">' + esc(errText(e)) + '</div>';
    });
  }

  return { mount: mount };
})();
