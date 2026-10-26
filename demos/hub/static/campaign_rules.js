/* 캠페인 카드 작성 제약 — 규칙은 이 파일이 아니라 GCS(knowledge/_campaign_rules.json)에 있다.
 * 이 파일은 규칙을 읽어 화면에서 평가하고, 회차 단위로 카드를 쪼개 등록하는 UI만 담는다.
 * 규칙을 바꾸려면 대시보드 규칙 패널이나 GCS 문서를 고치면 되고, 배포는 필요 없다.
 * 서버(campaign_rules.py)도 같은 문서를 읽어 저장 직전에 다시 검사한다 — 화면을 우회해도 막힌다. */
(function () {
  'use strict';

  var DOC = null;            // {version, structures, rules[]}
  var VIOLATIONS = {};       // {카드 id: [위반...]} — 이미 등록된 카드의 전수 검사 결과

  // ── 규칙 평가 (서버 campaign_rules.py 와 같은 규칙 문법) ──────────────
  function get(obj, path) {
    var cur = obj;
    var parts = String(path || '').split('.');
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function isEmpty(v) {
    return v === null || v === undefined || (typeof v === 'string' && !v.trim()) ||
           (Array.isArray(v) && !v.length);
  }
  function isNum(v) { return v !== '' && v !== null && v !== undefined && !isNaN(Number(v)); }

  function cmp(op, left, value, obj) {
    switch (op) {
      case 'eq': return left === value;
      case 'ne': return left !== value;
      case 'in': return (value || []).indexOf(left) >= 0;
      case 'not_in': return (value || []).indexOf(left) < 0;
      case 'empty': return isEmpty(left);
      case 'not_empty': return !isEmpty(left);
      case 'lt': case 'lte': case 'gt': case 'gte': {
        if (isEmpty(left) || !isNum(left) || !isNum(value)) return false;
        var a = Number(left), b = Number(value);
        return op === 'lt' ? a < b : op === 'lte' ? a <= b : op === 'gt' ? a > b : a >= b;
      }
      case 'eq_field': return left === get(obj, value);
      case 'gt_field':
      case 'gte_field': {
        var other = get(obj, value);
        if (isEmpty(left) || isEmpty(other)) return false;
        var l = isNum(left) && isNum(other) ? Number(left) : String(left);
        var r = isNum(left) && isNum(other) ? Number(other) : String(other);
        return op === 'gt_field' ? l > r : l >= r;
      }
      case 'regex':
      case 'not_regex': {
        var hit = new RegExp(value).test(String(left == null ? '' : left));
        return op === 'regex' ? hit : !hit;
      }
      default: return false;
    }
  }
  function evalCond(cond, obj) {
    if (!cond) return true;
    if (cond.all) return cond.all.every(function (c) { return evalCond(c, obj); });
    if (cond.any) return cond.any.some(function (c) { return evalCond(c, obj); });
    if (cond.not) return !evalCond(cond.not, obj);
    return cmp(cond.op || 'eq', get(obj, cond.field || ''), cond.value, obj);
  }

  function evalCard(card, siblings, scope) {
    if (!DOC) return [];
    var key = card.seriesKey || card.concept || '';
    var same = key ? (siblings || []).filter(function (c) {
      return (c.seriesKey || c.concept) === key;
    }) : [];
    var span = 0;
    if (card.sendDate && card.endDate) {
      span = Math.round((new Date(card.endDate + 'T00:00:00') - new Date(card.sendDate + 'T00:00:00')) / 86400000);
      if (isNaN(span)) span = 0;
    }
    var age = 99999;
    if (card.sendDate) {
      var days = Math.round((Date.now() - new Date(card.sendDate + 'T00:00:00')) / 86400000);
      if (!isNaN(days)) age = days;
    }
    var t = Object.assign({}, card,
      { _seriesCardCount: same.length || 1, _sendSpanDays: span, _ageDays: age });
    var hit = DOC.rules.filter(function (r) {
      // 전수 검사(all)에서는 새 카드 전용 규칙을 건너뛴다 — 옛 카드에 소급하면 경고만 쌓인다
      if (scope === 'all' && (r.appliesTo || 'all') === 'new') return false;
      return evalCond(r.when, t) && !evalCond(r.assert, t);
    });
    // 상위 위반이 있으면 하위 위반을 가린다(서버 campaign_rules 의 같은 표) — 기획서가 없으면 기획서에서 정할 값은 묻지 않는다
    var ids = hit.map(function (r) { return r.id; });
    return hit.filter(function (r) {
      return !(AFTER[r.id] || []).some(function (p) { return ids.indexOf(p) >= 0; });
    });
  }
  var AFTER = { 'goal-metric-declared': ['plan-doc-missing'], 'purchase-scope-declared': ['plan-doc-missing'],
                'category-declared': ['plan-doc-missing'] };

  // ── 로딩 ────────────────────────────────────────────────────────
  var LOADED_AT = 0;

  function load(injected) {
    if (injected) {  // 이미 읽어 둔 문서로 초기화 (테스트·재사용)
      DOC = { version: injected.version, structures: injected.structures || [], rules: injected.rules || [],
              types: injected.types || [], targets: injected.targets || [], mediums: injected.mediums || [] };
      if (injected.violations) VIOLATIONS = injected.violations;
      return Promise.resolve(DOC);
    }
    return fetch('/api/campaign-rules?check=1', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok) return null;
        DOC = { version: d.version, structures: d.structures || [], rules: d.rules || [],
                types: d.types || [], targets: d.targets || [], mediums: d.mediums || [] };
        VIOLATIONS = d.violations || {};
        LOADED_AT = Date.now();
        return DOC;
      })
      .catch(function () { return null; });
  }

  // 규칙을 읽는 자리는 정책·가이드 패널의 "캠페인 카드 작성 규칙" 항목이다(/rules/campaign-cards).
  // 여기서는 카드를 쓸 때 그 규칙으로 검사만 한다 — 대시보드 상단에 상시 패널을 두지 않는다.
  var CAN_EDIT = false;

  function loadMe() {
    return fetch('/api/me', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { CAN_EDIT = !!(d && d.isTeamEditor); return CAN_EDIT; })
      .catch(function () { CAN_EDIT = false; return false; });
  }

  // 수동 카드 추가 화면은 없앴다(2026-08-21 담당자 지시). 카드는 CRM 파이프라인이 만들고,
  // 사람이 고치는 일은 카드 상세에서 그 자리에서 한다.
  // 카드 추가 플로팅 버튼은 없앴다(2026-08-21). 카드는 CRM 파이프라인이 만들고,
  // 사람이 고치는 일은 카드 상세에서 값을 눌러 그 자리에서 한다.
  function mountButton() {
    var stale = document.getElementById('cr-fab');
    if (stale) stale.remove();          // 옛 화면이 남긴 버튼이 있으면 치운다
    var pg = document.getElementById('pgFab');
    if (pg && !pg._tipped) {
      pg._tipped = true;
      pg.removeAttribute('title');
      tip(pg, '정책 · 가이드', '운영 정책 문서를 열고 질문할 수 있습니다');
    }
  }

  // 플로팅 버튼 설명 — 마우스를 올리면 무슨 기능인지 한 줄로만 보여준다
  function tip(el, title, desc) {
    var box;
    el.addEventListener('mouseenter', function () {
      box = document.getElementById('cr-tip');
      if (!box) {
        box = document.createElement('div');
        box.id = 'cr-tip';
        document.body.appendChild(box);
      }
      box.innerHTML = '<b>' + esc(title) + '</b><span>' + esc(desc) + '</span>';
      var r = el.getBoundingClientRect();
      box.style.display = 'block';
      box.style.top = (r.top + r.height / 2 - box.offsetHeight / 2) + 'px';
      box.style.left = (r.left - box.offsetWidth - 12) + 'px';
    });
    el.addEventListener('mouseleave', function () {
      if (box) box.style.display = 'none';
    });
  }

  // ── 카드 작성 모달 — 회차 하나가 카드 하나 ────────────────────────
  var ROUND_SEQ = 0;

  // 인앱은 보내는 게 아니라 조건이 맞을 때 노출된다. 채널에 맞는 말을 쓴다.
  var EXPOSURE_CHANNELS = ['인앱메시지'];
  var LABELS = {
    send: { section: '발송 정보', structure: '발송 방식', verb: '발송',
            start: '발송 시작', end: '발송 종료',
            audience: '타겟 모수 (Braze 기준)', audienceHint: '예: 66749' },
    show: { section: '노출 정보', structure: '노출 방식', verb: '노출',
            start: '노출 시작', end: '노출 종료',
            audience: '타겟 모수 (Braze 기준)', audienceHint: '예: 264217' },
  };

  var STORABLE_STATUS = ['기획', '발송예정', '발송완료', '운영중', '운영완료'];

  // 저장되는 값은 단회·분할·상시 셋이다. 상시는 종료일 유무로 성격이 갈리므로 고르는 자리에서만 둘로 나눈다.
  function structureChoices(medium) {
    var verb = labelsFor(medium).verb;
    return [
      { value: '단회', label: '단회', desc: '1번만 ' + verb },
      { value: '분할', label: '분할', desc: '여러 차수로 나눠 ' + verb },
      { value: '상시', endless: true, label: '무기한 상시',
        desc: '끝나는 날 없이 조건 충족 시 자동 ' + verb },
      { value: '상시', endless: false, label: '기간 내 상시',
        desc: '정해진 기간 동안 조건 충족 시 자동 ' + verb },
    ];
  }

  function structureOptions() {
    return '<option value="">선택</option>' +
      (DOC.structures || ['단회', '분할', '상시']).map(function (v) {
        return '<option value="' + v + '">' + v + '</option>';
      }).join('');
  }

  // 브라우저 기본 선택 상자는 닫힌 표시와 펼친 목록의 글자를 따로 정할 수 없다.
  // 옵션 글자를 바꿔치기하는 방식은 열림·닫힘 신호가 브라우저마다 달라 설명이 남거나 곧바로 사라진다.
  // 그래서 발송 방식만 직접 만든다 — 값은 원래 select 에 그대로 담기므로 저장 경로는 바뀌지 않는다.
  function buildStructureSelect(row) {
    var sel = row.querySelector('[data-f="structure"]');
    if (sel._custom) { paintStructure(row); return; }
    sel._custom = true;
    sel.classList.add('cr-native-hidden');
    var box = document.createElement('div');
    box.className = 'cr-sel';
    box.innerHTML = '<button type="button" class="cr-sel-btn"><span></span>' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">' +
      '<path d="M6 9l6 6 6-6"/></svg></button><div class="cr-sel-list"></div>';
    sel.parentNode.appendChild(box);

    var btn = box.querySelector('.cr-sel-btn');
    var list = box.querySelector('.cr-sel-list');
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var open = box.classList.toggle('open');
      if (open) closeOtherSelects(box);
    });
    list.addEventListener('click', function (e) {
      var item = e.target.closest('[data-i]');
      if (!item) return;
      var c = structureChoices(row.querySelector('[data-f="medium"]').value)[+item.getAttribute('data-i')];
      sel.value = c.value;
      // 무기한을 고르면 종료를 비운다. 종료를 채우면 아래에서 기간 내 상시로 저절로 바뀐다.
      if (c.endless === true) {
        row.querySelector('[data-d="end"]').value = '';
        row.querySelector('[data-t="end"]').value = '';
      }
      box.classList.remove('open');
      paintStructure(row);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      if (c.endless === false && !row.querySelector('[data-d="end"]').value) {
        row.querySelector('[data-d="end"]').focus();
      }
    });
    paintStructure(row);
  }

  function closeOtherSelects(except) {
    document.querySelectorAll('.cr-sel.open').forEach(function (el) {
      if (el !== except) el.classList.remove('open');
    });
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('.cr-sel')) closeOtherSelects(null);
  });

  // 닫힌 칸에는 고른 값만, 펼친 목록에는 값과 설명을 함께 보여 준다
  function paintStructure(row) {
    var sel = row.querySelector('[data-f="structure"]');
    var box = sel.parentNode.querySelector('.cr-sel');
    if (!box) return;
    var hasEnd = !!(row.querySelector('[data-d="end"]') || {}).value;
    var choices = structureChoices(row.querySelector('[data-f="medium"]').value);
    var current = choices.filter(function (c) {
      return c.value === sel.value && (c.endless === undefined || c.endless === !hasEnd);
    })[0];
    box.querySelector('.cr-sel-btn span').textContent = current ? current.label : '선택';
    box.querySelector('.cr-sel-list').innerHTML = choices.map(function (c, i) {
      var on = current && c.label === current.label;
      return '<div class="cr-sel-item' + (on ? ' on' : '') + '" data-i="' + i + '">' +
        '<b>' + c.label + '</b><span> - ' + c.desc + '</span></div>';
    }).join('');
  }

  function labelsFor(medium) {
    return EXPOSURE_CHANNELS.indexOf(medium) >= 0 ? LABELS.show : LABELS.send;
  }

  function applyLabels(row) {
    var medium = row.querySelector('[data-f="medium"]').value;
    var L = labelsFor(medium);
    var aud = row.querySelector('[data-f="detail.audience"]');
    aud.parentNode.querySelector('span').textContent = L.audience;
    aud.placeholder = L.audienceHint;
    var st = row.querySelector('[data-f="structure"]');
    st.parentNode.querySelector('span').textContent = L.structure;
    buildStructureSelect(row);
    row.querySelector('[data-d="start"]').closest('.cr-field').querySelector('span').textContent = L.start;
    row.querySelector('[data-d="end"]').closest('.cr-field').querySelector('span').textContent = L.end;
    var head = row.querySelector('.cr-rhead b');
    if (!/회차$/.test(head.textContent)) head.textContent = L.section;
  }

  function roundRow(n) {
    var id = 'r' + (++ROUND_SEQ);
    var structs = (DOC.structures || ['단일발송', '드립', '트리거', '상시']);
    return '<div class="cr-round" data-rid="' + id + '">' +
      '<div class="cr-rhead"><b>' + n + '회차</b>' +
        '<button class="cr-del" data-del="' + id + '">삭제</button></div>' +
      '<div class="cr-grid">' +
        field('채널', '<select data-f="medium"><option>푸시</option><option>인앱메시지</option>' +
          '<option>알림톡</option><option>문자</option><option>이메일</option></select>') +
        field('발송 방식', '<select data-f="structure">' + structureOptions() + '</select>') +
        field('상태', '<select data-f="status"><option value="">선택</option>' +
          STORABLE_STATUS.map(function (v) { return '<option>' + v + '</option>'; }).join('') +
          '</select>') +
        whenField('발송 시작', 'start') +
        whenField('발송 종료', 'end') +
        field('발송 모수', '<input data-f="detail.audience" inputmode="numeric" maxlength="11" ' +
          'placeholder="예: 66749"><span class="cr-unit">명</span>') +

      '</div>' +
      '</div>';
  }

  function field(label, input) {
    return '<label class="cr-field"><span>' + label + '</span>' + input + '</label>';
  }

  // 날짜 칸과 시각 칸을 나란히 둔다. 한 칸에 합치면 시각을 적는 자리인지 알 수 없다.
  function whenField(label, key) {
    return '<div class="cr-field cr-when"><span>' + label + '</span><div class="cr-when-row">' +
      '<input data-d="' + key + '" inputmode="numeric" maxlength="10" placeholder="YYYY-MM-DD">' +
      '<input data-t="' + key + '" inputmode="numeric" maxlength="5" placeholder="HH:MM">' +
      '</div></div>';
  }

  function openModal(prefill) {
    var wrap = document.createElement('div');
    wrap.className = 'cr-modal';
    wrap.innerHTML =
      '<div class="cr-sheet">' +
        '<div class="cr-sheet-head"><b>캠페인 카드 추가</b>' +
          '<span class="cr-hint">회차마다 카드가 따로 생깁니다. 기획서에 2회차가 있으면 카드도 2개입니다.</span>' +
          '<button class="cr-x">닫기</button></div>' +
        '<div class="cr-grid cr-series">' +
          field('시리즈 키', '<input data-s="seriesKey" maxlength="24" placeholder="예: 세차인지여의도샛강탐색">') +
          field('유형', '<select data-s="type"><option>Promo</option><option>Info</option><option>CRM</option></select>') +
          field('대상', '<select data-s="target"><option>타겟</option><option>전체</option></select>') +
          field('담당', '<input data-s="owner" maxlength="8" placeholder="예: 이나">') +
          '<label class="cr-field cr-planned"><span>계획 회차 수</span>' +
            '<input type="number" data-s="plannedRounds" min="1"></label>' +
        '</div>' +
        '<div class="cr-rounds" id="cr-rounds">' + roundRow(1) + '</div>' +
        '<div class="cr-issues" id="cr-issues"></div>' +
        '<div class="cr-sheet-foot">' +
          '<button class="cr-btn" id="cr-add-round">회차 추가</button>' +
          '<div class="cr-flex"></div>' +
          '<button class="cr-btn" id="cr-check">검증만</button>' +
          '<button class="cr-btn primary" id="cr-save">저장</button>' +
        '</div>' +
        '<div class="cr-result" id="cr-result"></div>' +
      '</div>';
    document.body.appendChild(wrap);
    document.body.classList.add('cr-modal-open');   // 플로팅 버튼이 저장 버튼을 가리지 않게
    if (typeof prefill === 'string') prefill = { series: { seriesKey: prefill } };
    if (prefill) applyPrefill(wrap, prefill);
    syncRoundLabels(wrap);
    syncChannelLabels(wrap);

    function close() {
      wrap.remove();
      document.body.classList.remove('cr-modal-open');
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    wrap.querySelector('.cr-x').onclick = close;
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    wrap.querySelector('#cr-add-round').onclick = function () {
      var host = wrap.querySelector('#cr-rounds');
      host.insertAdjacentHTML('beforeend', roundRow(host.children.length + 1));
      bindRounds(wrap);
      syncRoundLabels(wrap);
      syncChannelLabels(wrap);
      liveCheck(wrap);
    };
    wrap.querySelector('#cr-check').onclick = function () { submit(wrap, true); };
    wrap.querySelector('#cr-save').onclick = function () { submit(wrap, false); };
    wrap.addEventListener('input', function (e) {
      var d = e.target.dataset || {};
      if (d.f === 'detail.audience') formatNumber(e.target);
      if (d.d) {
        formatDate(e.target);
        markFormat(e.target);
        if (d.d === 'end') paintStructure(e.target.closest('.cr-round'));
      }
      if (d.t) { formatTime(e.target); markFormat(e.target); }
      liveCheck(wrap);
    });
    wrap.addEventListener('click', function (e) {
      var item = e.target.closest && e.target.closest('[data-jump]');
      if (item) flashField(wrap, item.getAttribute('data-jump'), Number(item.getAttribute('data-ri')));
    });
    wrap.addEventListener('blur', function (e) {
      var d = e.target.dataset || {};
      if (d.d || d.t) markFormat(e.target);
    }, true);
    wrap.addEventListener('change', function (e) {
      if (e.target.dataset && e.target.dataset.f === 'medium') applyLabels(e.target.closest('.cr-round'));
      liveCheck(wrap);
    });
    bindRounds(wrap);
  }

  function applyPrefill(wrap, prefill) {
    var s = prefill.series || {};
    wrap.querySelectorAll('[data-s]').forEach(function (el) {
      var v = get(s, el.dataset.s);
      if (v !== undefined && v !== null && v !== '') el.value = v;
    });
    var rounds = prefill.rounds || [];
    var host = wrap.querySelector('#cr-rounds');
    while (host.children.length < rounds.length) {
      host.insertAdjacentHTML('beforeend', roundRow(host.children.length + 1));
    }
    rounds.forEach(function (r, i) {
      var row = host.children[i];
      row.dataset.gcspath = r.gcsPath || '';
      row.querySelectorAll('[data-f]').forEach(function (el) {
        var v = get(r, el.dataset.f);
        if (v === undefined || v === null || v === '') return;
        if (el.tagName === 'SELECT' && el.dataset.f !== 'status') {
          var has = Array.prototype.some.call(el.options, function (o) { return o.value === v; });
          if (!has) el.insertAdjacentHTML('beforeend', '<option value="' + esc(v) + '">' + esc(v) + '</option>');
        }
        if (el.dataset.f === 'detail.audience') {
          // "약 287,790명 (수신동의 ON 기준)" 처럼 설명이 섞인 값에서 숫자를 전부 긁으면
          // 28,779,020,260,814 같은 값이 된다. 사람 수로 읽히는 첫 숫자만 가져온다.
          var m = String(v).match(/\d{1,3}(?:,\d{3})+\s*명|\d+\s*명|\d{1,3}(?:,\d{3})+/);
          el.value = m ? m[0] : '';
          formatNumber(el);
          return;
        }
        el.value = v;
      });
      var tm = String((r.detail && r.detail.sendTime) || '').match(/(\d{1,2}:\d{2})(?:\s*[-~–]\s*(\d{1,2}:\d{2}))?/);
      var pad = function (t) { return t && t.length === 4 ? '0' + t : t; };
      if (r.sendDate) row.querySelector('[data-d="start"]').value = r.sendDate;
      if (r.endDate) row.querySelector('[data-d="end"]').value = r.endDate;
      if (tm) row.querySelector('[data-t="start"]').value = pad(tm[1]);
      if (tm && tm[2]) row.querySelector('[data-t="end"]').value = pad(tm[2]);
    });
    if (rounds.some(function (r) { return r.gcsPath; })) {
      wrap.querySelector('.cr-sheet-head b').textContent = '캠페인 카드 수정';
      wrap.querySelector('.cr-hint').textContent = '기존 카드를 고칩니다. 폴더와 문서 링크는 그대로 유지됩니다.';
    }
    bindRounds(wrap);
    syncRoundLabels(wrap);
    syncChannelLabels(wrap);
    liveCheck(wrap, prefill.issues || []);
    // 조치로 들어왔으면 어느 칸이 문제인지 바로 짚어 준다
    var first = wrap.querySelector('[data-jump]');
    if (first) setTimeout(function () {
      flashField(wrap, first.getAttribute('data-jump'), Number(first.getAttribute('data-ri') || 0));
    }, 300);
  }

  // 회차가 하나뿐이면 회차라는 말 자체를 쓰지 않는다. 둘 이상일 때만 번호를 붙인다.
  function syncChannelLabels(wrap) {
    wrap.querySelectorAll('.cr-round').forEach(applyLabels);
  }

  function syncRoundLabels(wrap) {
    var host = wrap.querySelector('#cr-rounds');
    var multi = host.children.length > 1;
    Array.prototype.forEach.call(host.children, function (el, i) {
      el.querySelector('.cr-rhead b').textContent = multi ? (i + 1) + '회차'
        : labelsFor(el.querySelector('[data-f="medium"]').value).section;
      el.querySelector('.cr-del').style.display = multi ? '' : 'none';
    });
    var pr = wrap.querySelector('.cr-planned');
    if (pr) {
      pr.style.display = multi ? '' : 'none';
      var input = pr.querySelector('[data-s="plannedRounds"]');
      if (!multi) input.value = '';
      else if (!input.value) input.value = host.children.length;
    }
  }

  function bindRounds(wrap) {
    wrap.querySelectorAll('[data-del]').forEach(function (b) {
      b.onclick = function () {
        var host = wrap.querySelector('#cr-rounds');
        if (host.children.length <= 1) return;
        wrap.querySelector('[data-rid="' + b.dataset.del + '"]').remove();
        syncRoundLabels(wrap);
        liveCheck(wrap);
      };
    });
  }

  function formatDate(el) {
    var d = el.value.replace(/[^0-9]/g, '').slice(0, 8);
    var out = d.slice(0, 4);
    if (d.length > 4) out += '-' + d.slice(4, 6);
    if (d.length > 6) out += '-' + d.slice(6, 8);
    el.value = out;
  }

  function formatTime(el) {
    var d = el.value.replace(/[^0-9]/g, '').slice(0, 4);
    if (d.length >= 2 && Number(d.slice(0, 2)) > 23) d = '23' + d.slice(2);   // 24시간제 밖은 막는다
    if (d.length === 4 && Number(d.slice(2)) > 59) d = d.slice(0, 2) + '59';
    el.value = d.length > 2 ? d.slice(0, 2) + ':' + d.slice(2) : d;
  }

  // 형식이 덜 채워진 값은 남겨 두되 눈에 띄게 표시한다 — 조용히 지우면 무엇을 잘못 썼는지 모른다
  function markFormat(el) {
    var v = (el.value || '').trim();
    var ok = !v || (el.dataset.d ? /^\d{4}-\d{2}-\d{2}$/.test(v) : /^\d{2}:\d{2}$/.test(v));
    el.classList.toggle('cr-bad', !ok);
  }

  function formatNumber(el) {
    var digits = el.value.replace(/[^0-9]/g, '');
    el.value = digits ? Number(digits).toLocaleString('ko-KR') : '';
  }

  function setPath(obj, path, val) {
    var parts = path.split('.'), cur = obj;
    for (var i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] = cur[parts[i]] || {};
    cur[parts[parts.length - 1]] = val;
  }

  function collect(wrap) {
    var series = { detail: {} };
    wrap.querySelectorAll('[data-s]').forEach(function (el) {
      if (el.value !== '') setPath(series, el.dataset.s, el.value);
    });
    if (series.plannedRounds) series.plannedRounds = Number(series.plannedRounds);
    var rounds = [];
    wrap.querySelectorAll('.cr-round').forEach(function (row, i) {
      var r = { round: i + 1, detail: {} };
      row.querySelectorAll('[data-f]').forEach(function (el) {
        if (el.value !== '') setPath(r, el.dataset.f, el.value);
      });
      // 발송 시각은 위젯 두 개로 받아 한 줄로 합친다 — 사람마다 다른 표기가 섞이지 않게
      if (r.detail && r.detail.audience) {
        var digits = String(r.detail.audience).replace(/[^0-9]/g, '');
        r.detail.audience = digits ? Number(digits).toLocaleString('ko-KR') + '명' : '';
      }
      // 시작·종료는 날짜+시각 한 칸으로 받고, 저장할 때 날짜와 시각으로 나눈다
      var val = function (sel) { return (row.querySelector(sel).value || '').trim(); };
      var sd = val('[data-d="start"]'), stime = val('[data-t="start"]');
      var ed = val('[data-d="end"]'), etime = val('[data-t="end"]');
      if (sd) r.sendDate = sd;
      if (stime) r.detail.sendTime = etime ? stime + ' - ' + etime : stime;
      r.endDate = ed || r.sendDate || '';
      r._rid = row.dataset.rid;
      if (row.dataset.gcspath) r.gcsPath = row.dataset.gcspath;
      rounds.push(r);
    });
    return { series: series, rounds: rounds };
  }

  function preview(payload) {
    // 서버 _build_round_cards 와 같은 병합 순서 — 화면에서 미리 같은 결과를 본다
    var s = payload.series;
    return payload.rounds.map(function (r) {
      var c = Object.assign({}, s, r);
      c.detail = Object.assign({}, s.detail || {}, r.detail || {});
      c.seriesKey = s.seriesKey || '';
      c.endDate = r.endDate || r.sendDate || '';
      c.plannedRounds = s.plannedRounds || payload.rounds.length;
      c.namingValid = true;   // 폴더명은 서버가 SSOT 로 만든다
      return c;
    });
  }

  function violationsFor(cid) { return VIOLATIONS[cid] || []; }

  // 위반마다 "그래서 어떻게 고치나"를 그 카드 값으로 적는다. 규칙 문구(how)의 원천은 규칙 파일(GCS)이지만,
  // 기획서·실모수 두 규칙은 폴더 키·발송일을 알아야 바로 따라 할 수 있어 여기서 카드 사정에 맞춘다.
  // short 는 목록용 한 줄, how 는 카드 상세용 설명이다 — 목록에 설명까지 넣으면 줄마다 문장이 쌓여 읽히지 않는다.
  // auto=true 는 시스템이 알아서 채우는 건 — 칩 숫자에서 빼고 목록에서는 초록 ✓ 로만 보인다.
  function daysToSend(c) {
    if (!c || !c.sendDate) return null;
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var d = new Date(String(c.sendDate).slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? null : Math.round((d - t) / 86400000);
  }
  function fixFor(v, c) {
    c = c || {};
    if (v.id === 'plan-doc-missing') {
      // 기획서는 모두렌즈에 올리면 인덱스 재빌드 때 키·발송일로 카드를 찾아 폴더로 복사된다.
      var leaf = String(c.gcsPath || '').replace(/\/+$/, '').split('/').pop();
      var key = leaf.split('_').slice(2).join('_');
      var ymd = String(c.sendDate || '').replace(/-/g, '').slice(2, 8);
      if (key && /^\d{6}$/.test(ymd)) {
        var file = 'plan_' + key + '_' + ymd + '.html';
        return { short: file + ' 올리기', file: file, auto: false,
                 how: '모두렌즈 기획분석팀/CRM 폴더에 ' + file + ' 로 올리면 다음 재빌드 때 카드에 붙습니다' };
      }
    }
    if (v.id === 'audience-required') {
      var dd = daysToSend(c);
      if (dd === 0) {
        return { short: '발송 뒤 자동 기재 · 조치 불필요', auto: true,
                 how: '발송 뒤 매시 Braze 대사가 실측 모수를 자동 기재합니다 · 조치 불필요' };
      }
      if (dd !== null && dd < 0) {
        return { short: '자동 기재 안 됨 · Braze 캔버스 확인', auto: false,
                 how: '발송일이 지났는데 자동 기재가 안 된 건입니다 · Braze 캔버스 이름의 키·날짜가 카드와 맞는지, 실제로 발송됐는지 확인하거나 실측 모수를 직접 입력' };
      }
      return { short: '예상 도달 모수 입력', auto: false,
               how: 'Braze 세팅 화면의 예상 도달 모수를 카드에 숫자로 입력' };
    }
    return { short: v.how || '', how: v.how || '', auto: false };
  }
  // 목록 한 줄에 여러 할 일이 나란히 설 때 무엇에 대한 일인지 가리키는 짧은 말머리.
  var FIX_TAG = { 'audience-required': '실모수', 'plan-doc-missing': '기획서',
                  'deeplink-incomplete': '딥링크', 'send-time-required': '발송 시각',
                  'structure-required': '구조', 'meta-conflict': '값 갈림', 'concept-required': '묶음' };

  function cardOf(id) { return (window.findCampaign && window.findCampaign(id)) || {}; }
  function actionable(id) {
    var c = cardOf(id);
    return violationsFor(id).filter(function (v) { return !fixFor(v, c).auto; });
  }

  function canEdit() { return CAN_EDIT; }

  // 상태 배지 옆 표기. 건수만 알리고, 무엇을 고칠지는 눌러서 수정 폼에서 본다.
  function badgeHtml(cid) {
    var vs = violationsFor(cid);
    if (!vs.length) return '';
    return '<span class="cr-chip" ' + (CAN_EDIT ? 'data-cr-fixnow="1" role="button" ' : '') +
      'title="' + esc(vs.map(function (v) { return v.what; }).join(' · ')) + '">' +
      '<i></i>조치 ' + vs.length + '건</span>';
  }

  function noticeHtml(cid) {
    var vs = violationsFor(cid);
    if (!vs.length) return '';
    var top = vs.slice(0, 3).map(function (v) { return v.what; }).join(' · ');
    return '<div class="cr-notice"><span><b>채우지 않은 항목 ' + vs.length + '건</b> ' + esc(top) +
      (vs.length > 3 ? ' 외 ' + (vs.length - 3) + '건' : '') + '</span>' +
      (CAN_EDIT ? '<button class="cr-noticebtn" data-cr-fixnow="1">채우기</button>' : '') +
      '</div>';
  }

  // 상세 가이드 본문에는 넣지 않는다 — 조치는 수정 폼 하단에서 본다.
  // 카드 상세 맨 아래 조치 목록. 항목을 누르면 그 값이 있는 자리로 데려가 편집 상태로 연다.
  function issueList(cid) {
    var vs = violationsFor(cid);
    if (!vs.length) return '';
    var FIELD = {
      'audience-required': 'detail.audience', 'audience-numeric': 'detail.audience',
      'send-time-required': 'detail.sendTime',
      'structure-required': 'structure', 'deeplink-incomplete': 'dl.url',
      'needs-check-marker': 'detail.targetPersona',
      'concept-required': 'concept',   // 기획 탭 개요의 묶음 행(data-edit="concept")
    };
    return '<div class="cr-issues" style="margin:14px 0 4px">' +
      '<div class="cr-issues-head">채워야 할 항목 ' + vs.length + '건</div>' +
      vs.map(function (v, i) {
        var f = FIELD[v.id];
        var how = fixFor(v, cardOf(cid)).how;   // 요약 목록과 같은 안내를 카드 상세에도
        return '<div class="cr-vitem ' + (v.severity === 'block' ? 'blk' : 'wrn') + '"' +
          (f ? ' data-cr-goto-field="' + f + '" style="cursor:pointer"' : '') + '>' +
          '<b>' + (i + 1) + '. ' + esc(v.what || v.label) + '</b>' +
          (how ? '<span>' + esc(how) + '</span>' : '') + '</div>';
      }).join('') + '</div>';
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-cr-fixnow]')) {
      setEditMode(true);
      var first = document.querySelector('[data-cr-goto-field]');
      if (first) first.click();
      return;
    }
    var row = e.target.closest && e.target.closest('[data-cr-goto-field]');
    if (!row) return;
    if (!document.body.classList.contains('cr-editmode')) setEditMode(true);
    var target = document.querySelector('[data-edit="' + row.getAttribute('data-cr-goto-field') + '"]');
    if (!target) return;
    // 값이 다른 탭에 있으면 그 탭부터 연다 — 숨은 요소는 눌러도 보이지 않는다
    var pane = target.closest('.tab-content');
    if (pane && !pane.classList.contains('active') && window.switchTab) {
      window.switchTab(pane.id.replace('tab-', ''));
    }
    setTimeout(function () {
      target.scrollIntoView({ block: 'center' });
      target.click();
    }, 60);
  });

  function detailHtml() { return ''; }

  // 카드 수정 폼이 없어졌으므로 제목 줄 진입점도 두지 않는다. 값은 상세에서 눌러 고친다.
  function editButtonHtml() { return ''; }

  // 메인 화면 요약 — 건수와 담당자만 넘긴다. 칩은 dashboard.html 이 다른 갈래와 합쳐 「확인 필요」 하나로 그린다.
  function mountSummary() {
    // 시스템이 알아서 채울 건만 남은 카드는 세지 않는다 — 칩은 손댈 것이 있을 때만 뜬다.
    var ids = Object.keys(VIOLATIONS).filter(function (id) { return actionable(id).length; });
    var owners = ids.map(function (id) {
      var c = window.findCampaign ? window.findCampaign(id) : null;
      return (c && c.owner) || '';
    });
    window.CRM_ISSUES = window.CRM_ISSUES || {};
    window.CRM_ISSUES.rules = { label: '수정 필요', unit: '건', count: ids.length, owners: owners, open: openSummary };
    if (window.renderCrmIssues) window.renderCrmIssues();
  }

  function openSummary() {
    var ids = Object.keys(VIOLATIONS);
    // 심각도 레일(2026-08-28 A안) — 발송이 코앞인 것부터 위로. 급한 건 빨강 레일.
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var rows = ids.map(function (id) {
      var c = cardOf(id);
      var diff = c.sendDate ? Math.round((new Date(c.sendDate) - today) / 86400000) : null;
      var items = VIOLATIONS[id].map(function (v) { return { v: v, fix: fixFor(v, c) }; });
      var act = items.filter(function (x) { return !x.fix.auto; }).length;
      // 손댈 것이 없는 카드는 맨 아래 「자동 처리 예정」으로 모은다 — 급한 줄 사이에 섞이면 읽을 필요 없는 줄을 읽게 된다.
      var grp = !act ? '자동 처리 예정'
        : (diff !== null && diff >= 0 && diff <= 1) ? '발송 임박'
        : (diff !== null && diff > 1) ? '발송 예정' : '발송 지난 건';
      return { id: id, name: c.name || id, owner: c.owner || '담당 미지정',
               date: c.sendDate || '', grp: grp, items: items, act: act };
    });
    var nAct = rows.filter(function (r) { return r.act; }).length;
    var GRPS = [{ t: '발송 임박', rail: 'rail-red', asc: true },
                { t: '발송 예정', rail: 'rail-amber', asc: true },
                { t: '발송 지난 건', rail: '', asc: false },
                { t: '자동 처리 예정', rail: 'rail-ok', asc: true }];
    var body = GRPS.map(function (g) {
      var list = rows.filter(function (r) { return r.grp === g.t; })
        .sort(function (a, b) { return g.asc ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date); });
      if (!list.length) return '';
      return '<div class="cr-sum-grp">' + g.t + '</div>' + list.map(function (r) {
        // 할 일은 명령형 한 줄로만 — 설명 문장까지 넣으면 줄마다 글이 쌓여 목록이 읽히지 않는다(카드 상세에 남긴다).
        // 여러 건은 순서가 아니라 나란한 일이라 화살표로 잇지 않고, 무엇에 대한 일인지 앞에 붙여 짝을 보인다.
        var fixes = r.items.filter(function (x) { return x.fix.short; }).map(function (x) {
          var s = esc(x.fix.short);
          if (x.fix.file) s = s.replace(esc(x.fix.file), '<code>' + esc(x.fix.file) + '</code>');
          var tag = FIX_TAG[x.v.id];
          return '<span class="' + (x.fix.auto ? 'cr-fix-auto' : '') + '">' +
            (tag ? '<b>' + tag + '</b> ' : '') + s + '</span>';
        }).join('');
        return '<div class="cr-sum-row ' + g.rail + '" data-cr-goto="' + r.id + '">' +
          '<div class="cr-sum-top"><span class="cr-sum-title">' + esc(r.name) + '</span>' +
            '<span class="cr-sum-meta">' + esc(r.date) + (r.owner ? ' · <b>' + esc(r.owner) + '</b>' : '') + '</span></div>' +
          '<div class="cr-sum-items">' + r.items.map(function (x) {
            return '<span' + (x.fix.auto ? ' class="cr-auto"' : '') + '>' + esc(x.v.what) + '</span>'; }).join('') + '</div>' +
          (fixes ? '<div class="cr-sum-fix">' + fixes + '</div>' : '') + '</div>';
      }).join('');
    }).join('');

    var wrap = document.createElement('div');
    wrap.className = 'cr-modal cr-sum-modal';
    wrap.innerHTML = '<div class="cr-sheet"><div class="cr-sheet-head"><b>수정이 필요한 ' +
      nAct + '건</b><span class="cr-hint">항목을 누르면 해당 카드가 열립니다 · ✓ 표시는 시스템이 자동으로 채우는 항목이라 손댈 것이 없습니다</span>' +
      '<button class="cr-x">닫기</button></div><div class="cr-sum-list">' + body + '</div></div>';
    document.body.appendChild(wrap);
    document.body.classList.add('cr-modal-open');
    function close() {
      wrap.remove();
      document.body.classList.remove('cr-modal-open');
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    wrap.querySelector('.cr-x').onclick = close;
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) return close();
      var row = e.target.closest && e.target.closest('[data-cr-goto]');
      if (!row) return;
      close();
      if (window.openCampaign) window.openCampaign(row.getAttribute('data-cr-goto'));
    });
  }

  var STORABLE_STATUS_LIST = STORABLE_STATUS;

  function statusForForm(c) {
    var raw = c.statusRaw !== undefined ? c.statusRaw : c.status;
    return STORABLE_STATUS_LIST.indexOf(raw) >= 0 ? raw : '';   // 없으면 비워 두고 직접 고르게 한다
  }

  // 기존 카드를 그 값 그대로 폼에 올린다. 저장하면 폴더는 그대로 두고 meta 만 갱신된다.
  function editCard(c) {
    if (!c || !CAN_EDIT) return;
    var d = c.detail || {};
    openModal({
      series: { seriesKey: c.seriesKey || c.concept || '', type: c.type, target: c.target,
                owner: c.owner, plannedRounds: c.plannedRounds },
      issues: violationsFor(c.id),
      rounds: [{ round: c.round, medium: c.medium, structure: c.structure,
                 status: statusForForm(c),   // 표시값(진행중)이 아니라 저장된 상태만 싣는다
                 sendDate: c.sendDate, endDate: c.endDate, gcsPath: c.gcsPath,
                 detail: { sendTime: d.sendTime, audience: d.audience } }],
    });
  }

  // 무엇을 고쳐야 하는지와 어떻게 고치는지만 남긴다. 차단·경고 표기는 쓰지 않는다.
  function violationHtml(v, no, round, roundIndex) {
    return '<div class="cr-vitem ' + (v.severity === 'block' ? 'blk' : 'wrn') + '"' +
      (RULE_FIELD[v.id] ? ' data-jump="' + v.id + '" data-ri="' + (roundIndex || 0) + '"' : '') + '>' +
      '<b>' + (no ? no + '. ' : '') + (round ? round + '회차 · ' : '') + esc(v.what || v.label) + '</b>' +
      (v.how ? '<span>' + esc(v.how) + '</span>' : '') + '</div>';
  }

  var RULE_FIELD = {
    'structure-required': '[data-f="structure"]',
    'single-send-enddate': '[data-d="end"]',
    'split-send-window': '[data-d="end"]',
    'finite-send-not-ongoing': '[data-f="status"]',
    'always-on-status': '[data-f="status"]',
    'series-key-no-round': '[data-s="seriesKey"]',
    'audience-numeric': '[data-f="detail.audience"]',
    'send-time-required': '[data-t="start"]',
    'one-card-per-round': '#cr-add-round',
  };

  function flashField(wrap, ruleId, roundIndex) {
    var sel = RULE_FIELD[ruleId];
    if (!sel) return;
    var scope = wrap;
    if (sel.indexOf('data-s') < 0 && sel.charAt(0) !== '#') {
      var rows = wrap.querySelectorAll('.cr-round');
      scope = rows[roundIndex || 0] || wrap;
    }
    var el = scope.querySelector(sel) || wrap.querySelector(sel);
    if (!el) return;
    var box = el.closest('.cr-field') || el;
    if (el.classList.contains('cr-native-hidden')) box = el.parentNode;  // 직접 만든 선택 상자
    box.classList.remove('cr-flash');
    void box.offsetWidth;                 // 애니메이션 재시작
    box.classList.add('cr-flash');
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(function () { box.classList.remove('cr-flash'); }, 1600);
  }

  function liveCheck(wrap, stored) {
    if (!DOC) return;
    var payload = collect(wrap);
    var cards = preview(payload);
    var multi = cards.length > 1;
    var html = '', no = 1, blocked = false, seen = {};
    cards.forEach(function (c, i) {
      var vs = evalCard(c, cards);
      vs.forEach(function (v) {
        if (v.severity === 'block') blocked = true;
        seen[v.id] = true;
        html += violationHtml(v, no++, multi ? (payload.rounds[i].round || i + 1) : 0, i);
      });
    });
    // 카드에 남아 있던 항목 중 폼에서 이미 정리된 것도 한 번은 보여 준다
    (stored || []).forEach(function (v) {
      if (seen[v.id]) return;
      html += violationHtml(v, no++, 0, 0);
    });
    var slot = wrap.querySelector('#cr-issues');
    slot.innerHTML = html ? '<div class="cr-issues-head">채워야 할 항목</div>' + html : '';
    wrap.querySelector('#cr-save').disabled = blocked;
  }

  function submit(wrap, dryrun) {
    var payload = collect(wrap);
    payload.rounds.forEach(function (r) { delete r._rid; });
    payload.dryrun = !!dryrun;
    var out = wrap.querySelector('#cr-result');
    out.textContent = '검사 중...';
    fetch('/api/campaign-cards', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json().then(function (d) { return { s: r.status, d: d }; }); })
      .then(function (res) {
        var d = res.d;
        if (!d.ok && d.error) { out.innerHTML = '<div class="cr-vitem blk">' + esc(d.error) + '</div>'; return; }
        if (d.blocked) {
          var why = (d.cards || []).map(function (c) {
            var blk = (c.violations || []).filter(function (v) { return v.severity === 'block'; });
            if (!blk.length) return '';
            return '<div class="cr-round-why"><b>' + c.round + '회차</b>' +
              blk.map(function (v, i) { return violationHtml(v, i + 1); }).join('') + '</div>';
          }).join('');
          out.innerHTML = '<div class="cr-vitem blk"><b>규칙을 어겨 하나도 저장하지 않았습니다</b></div>' + why;
          return;
        }
        if (dryrun) {
          out.innerHTML = '<div class="cr-vitem ok"><b>검증 통과 — 카드 ' + d.cards.length + '개가 만들어집니다</b>' +
            '<span>' + d.cards.map(function (c) { return esc(c.folder); }).join(' · ') + '</span></div>';
          return;
        }
        out.innerHTML = '<div class="cr-vitem ok"><b>카드 ' + (d.written || []).length + '개 저장</b>' +
          '<span>' + (d.written || []).map(esc).join(' · ') + '</span>' +
          '<span>기획분석즈 채널에 등록 결과를 올렸습니다.</span></div>';
      })
      .catch(function (e) { out.innerHTML = '<div class="cr-vitem blk">' + esc(String(e)) + '</div>'; });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ── 카드 값 인라인 편집 ───────────────────────────────────────
  // 값을 누르면 그 자리에서 입력창이 열린다. 강조 색을 칠하지 않고 테두리만 한 번 번진다.
  function inlineEdit(el, opts) {
    if (!CAN_EDIT || el._editing) return;
    if (!document.body.classList.contains('cr-editmode')) return;   // 수정 모드에서만 고친다
    el._editing = true;
    // 입력창을 새로 만들지 않는다. 보이던 자리에서 그대로 고친다 —
    // 상자를 만들면 폭이 줄어 긴 값이 잘리고, 글꼴도 달라져 다른 값처럼 보인다.
    var host = el.querySelector('code') || el;
    var raw = el.dataset.value !== undefined ? el.dataset.value : host.textContent.trim();
    var placeholder = el.classList.contains('cr-missing');
    if (placeholder) host.textContent = '';
    host.setAttribute('contenteditable', 'plaintext-only');
    // plaintext-only를 모르는 브라우저는 이 값을 무시해 아예 못 고치는 칸이 된다(파이어폭스).
    if (!host.isContentEditable) host.setAttribute('contenteditable', 'true');
    el.classList.add('cr-editing');
    host.focus();
    // 커서를 값 끝에 둔다. 그냥 focus만 하면 맨 앞에 놓여 새로 친 글자가 기존 값 앞에 붙는다.
    try {
      var range = document.createRange();
      range.selectNodeContents(host);
      range.collapse(false);
      var sel0 = window.getSelection();
      sel0.removeAllRanges();
      sel0.addRange(range);
    } catch (err) { /* 선택 영역을 못 잡아도 편집 자체는 된다 */ }

    var closed = false;
    function finish(save) {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeyEdit, true);
      delete el._editing;
      host.removeAttribute('contenteditable');
      el.classList.remove('cr-editing');
      if (document.activeElement === host) host.blur();
      var v = host.textContent.trim();
      if (!save) {
        host.textContent = raw || (placeholder ? '미기재' : '');
        return;
      }
      if (v === raw) {
        if (!v) host.textContent = '미기재';
        return;
      }
      el.dataset.value = v;
      host.textContent = v || '미기재';
      el.classList.toggle('cr-missing', !v);
      opts.onSave(v, el);
    }
    host.addEventListener('blur', function () { finish(true); }, { once: true });
    // 키는 문서에서 먼저 받는다. 값 안에 커서가 없을 때도 Enter·ESC가 듣게 하려는 것이다 —
    // 칸에만 걸어 두면 초점이 살짝 어긋난 순간 저장도 취소도 되지 않는다(2026-08-21).
    function onKeyEdit(e) {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      else return;
      document.removeEventListener('keydown', onKeyEdit, true);
    }
    document.addEventListener('keydown', onKeyEdit, true);
  }

  // 값이 있던 자리는 그대로 두고 그 위에 입력칸을 띄운다.
  // 자리를 입력칸으로 바꿔 끼우면, 달력이나 목록처럼 값보다 넓은 칸이 열릴 때마다
  // 그 줄과 아래 줄이 밀린다. 자리를 남겨 두면 문서는 한 픽셀도 움직이지 않는다.
  function _mountOver(el, ctl) {
    el.classList.add('cr-hosting');
    el.appendChild(ctl);
  }

  function _unmountOver(el, ctl) {
    if (ctl.parentNode === el) el.removeChild(ctl);
    el.classList.remove('cr-hosting');
  }

  // 꼴이 정해진 값(날짜·숫자)은 그 꼴의 입력칸으로 연다.
  // 자유 입력으로 두면 2026.8.25, 25일, 약 2만명처럼 제각각 들어와 규칙 검사가 무의미해진다.
  function inlineInput(el, opts, onSave) {
    if (!CAN_EDIT || el._editing) return;
    if (!document.body.classList.contains('cr-editmode')) return;
    el._editing = true;
    var raw = el.dataset.value !== undefined ? el.dataset.value : el.textContent.trim();
    var box = el.getBoundingClientRect();
    var input = document.createElement('input');
    input.className = 'cr-inline';
    input.type = opts.type === 'date' ? 'date' : 'text';
    if (opts.type === 'number') { input.inputMode = 'numeric'; input.maxLength = 13; }
    if (opts.placeholder) input.placeholder = opts.placeholder;
    input.value = opts.type === 'number' ? raw.replace(/[^0-9]/g, '') : raw;
    input.style.minWidth = Math.max(box.width, opts.type === 'date' ? 104 : 72) + 'px';
    // 고를 수 있는 값 목록(datalist) — 자유 입력은 그대로 두고 있는 값을 쉽게 집게 한다
    var dl = null;
    if (opts.list && opts.list.length) {
      dl = document.createElement('datalist');
      dl.id = 'cr-dl-' + Date.now();
      opts.list.forEach(function (v) { var o = document.createElement('option'); o.value = v; dl.appendChild(o); });
      document.body.appendChild(dl);
      input.setAttribute('list', dl.id);
      input.style.minWidth = Math.max(box.width, 160) + 'px';
    }
    _mountOver(el, input);
    input.focus();
    if (input.select && opts.type !== 'date') input.select();
    // 달력 아이콘을 지웠으므로 칸을 열 때 달력도 같이 띄운다
    if (opts.type === 'date' && input.showPicker) { try { input.showPicker(); } catch (err) {} }
    var closed = false;
    function finish(save) {
      if (closed) return;
      closed = true;
      delete el._editing;
      var v = (input.value || '').trim();
      if (opts.type === 'number') {
        var digits = v.replace(/[^0-9]/g, '');
        v = digits ? Number(digits).toLocaleString('ko-KR') + '명' : '';
      }
      _unmountOver(el, input);
      if (dl && dl.parentNode) dl.parentNode.removeChild(dl);
      if (!save || v === raw) return;
      el.dataset.value = v;
      el.textContent = v || '미기재';
      el.classList.toggle('cr-missing', !v);
      onSave(v, el);
    }
    input.addEventListener('blur', function () { finish(true); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
  }

  // 고르는 값(방식·상태·채널)은 목록으로 연다. 입력형과 저장 경로는 같다.
  function inlineSelect(el, options, onSave) {
    if (!CAN_EDIT || el._editing) return;
    if (!document.body.classList.contains('cr-editmode')) return;
    el._editing = true;
    var raw = el.dataset.value !== undefined ? el.dataset.value : el.textContent.trim();
    var box = el.getBoundingClientRect();
    var sel = document.createElement('select');
    sel.className = 'cr-inline cr-editing';
    sel.style.minWidth = box.width + 'px';
    sel.innerHTML = options.map(function (o) {
      var v = o.value !== undefined ? o.value : o;
      var label = o.label !== undefined ? o.label : v;
      return '<option value="' + esc(v) + '"' + (v === raw ? ' selected' : '') + '>' + esc(label) + '</option>';
    }).join('');
    _mountOver(el, sel);
    sel.focus();
    // 누르는 순간 목록이 펼쳐진다. 이 호출이 없으면 닫힌 칸이 한 번 떴다가
    // 한 번 더 눌러야 목록이 열려, 고르는 데 두 번이 든다.
    if (sel.showPicker) { try { sel.showPicker(); } catch (err) { /* 사용자 동작 없이 열린 경우 */ } }
    var closed = false;
    function finish(save) {
      if (closed) return;
      closed = true;
      delete el._editing;
      var v = sel.value;
      _unmountOver(el, sel);
      if (!save || v === raw) return;
      var picked = options.filter(function (o) { return (o.value !== undefined ? o.value : o) === v; })[0];
      el.textContent = picked && picked.label !== undefined ? picked.label : v;
      el.dataset.value = v;
      el.classList.toggle('cr-missing', !v);
      onSave(v, el);
    }
    sel.addEventListener('change', function () { finish(true); });
    sel.addEventListener('blur', function () { finish(false); });
    sel.addEventListener('keydown', function (e) { if (e.key === 'Escape') finish(false); });
  }

  // 수정 모드 — 여러 값을 문서와 대조하며 채울 때 쓴다. 켜면 고칠 수 있는 자리가 모두 드러나고,
  // 원본 문서 링크가 위에 붙는다. 한 값만 고칠 때는 모드를 켜지 않고 그 값만 눌러도 된다.
  function editModeToggleHtml() {
    if (!CAN_EDIT) return '';
    return '<button class="cr-btn cr-modebtn" data-cr-editmode>수정 모드</button>';
  }

  // 수정 모드에서 띄우던 원본 문서 줄은 없앴다(2026-08-21 담당자 지시).
  // 기획서·세팅 가이드 원본 링크는 이미 각 탭 아래에 있어 같은 링크를 두 번 두는 셈이었다.
  function setEditMode(on) {
    document.body.classList.toggle('cr-editmode', on);
    var btn = document.querySelector('[data-cr-editmode]');
    if (btn) {
      btn.textContent = on ? '수정 끝내기' : '수정 모드';
      btn.classList.toggle('primary', on);
    }
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-cr-editmode]');
    if (!btn) return;
    setEditMode(!document.body.classList.contains('cr-editmode'));
  });

  // 카드 값을 저장한다. 카드가 원천이므로 여기서 쓴 값이 기준이 된다.
  function saveDetail(gcsPath, patch) {
    return fetch('/api/campaign-detail', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gcsPath: gcsPath, patch: patch }),
    }).then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) { alert(d.error || '저장하지 못했습니다'); return null; }
        return d;
      });
  }

  window.CampaignRules = { load: load, evalCard: evalCard, open: openModal, edit: editCard,
                           mount: mountButton, editButton: editButtonHtml, badge: badgeHtml,
                           detail: detailHtml, notice: noticeHtml, issueList: issueList,
                           summary: mountSummary,
                           violationsFor: violationsFor, canEdit: canEdit,
                           inlineEdit: inlineEdit, inlineSelect: inlineSelect, inlineInput: inlineInput,
                           saveDetail: saveDetail,
                           editModeButton: editModeToggleHtml, setEditMode: setEditMode,
                           doc: function () { return DOC; } };

  // 화면을 오래 열어 두면 조치 목록이 실제와 어긋난다(고친 뒤에도 배지가 남는다).
  // 탭으로 돌아올 때 1분 이상 지났으면 조용히 다시 읽는다.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || Date.now() - LOADED_AT < 60000) return;
    load().then(function (d) {
      if (!d) return;
      mountSummary();
      var open = document.getElementById('modal-overlay');
      if (open && open.classList.contains('open') && window.refreshOpenCampaign) window.refreshOpenCampaign();
    });
  });

  document.addEventListener('DOMContentLoaded', function () {
    Promise.all([load(), loadMe()]).then(function (r) {
      if (!r[0]) return;
      mountButton();
      mountSummary();
      // (폼 제거) 슬랙 알림의 옛 링크로 들어와도 주소만 정리하고 아무것도 열지 않는다.
      // 열고 나서 주소에서 지운다 — 안 지우면 새로고침할 때마다 폼이 다시 열린다.
      var q = new URLSearchParams(location.search);
      if (q.get('newcard') === '1') {
        var series = q.get('series') || '';
        q.delete('newcard'); q.delete('series');
        var rest = q.toString();
        history.replaceState({}, '', location.pathname + (rest ? '?' + rest : ''));
      }
    });
  });
})();
