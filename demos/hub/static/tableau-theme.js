/* ============================================================
   Tableau-style 범용 테마 헬퍼  (tableau-theme.js)
   의존성: vega@5, vega-lite@5, vega-embed@6  (CDN script 3개)

   사용법 (데이터만 넘기면 테마+인터랙티브 자동 적용):
     TL.chart('#myChart', { mark:'bar', encoding:{ ... } }, { hover:['x'] });
     TL.heatTable('#myTable', { columns:[...], rows:[...], heat:[...], pp:'증분 %p' });
   ============================================================ */
const TL = (function () {

  // ── 토큰 (CSS 변수와 동일 값) ──
  const PALETTE = ['#4E79A7','#F28E2B','#E15759','#76B7B2','#59A14F','#EDC948','#B07AA1','#FF9DA7','#9C755F','#BAB0AC'];
  const T = { ink:'#2B2B2B', sub:'#5A5A5A', grid:'#ECECEC', axis:'#D7D7D7',
              pos:'#4E79A7', neg:'#E15759',
              font:'Pretendard, -apple-system, BlinkMacSystemFont, sans-serif' };

  // ── Vega-Lite 공유 config (태블로 톤) ──
  const vlConfig = {
    font: T.font, background: null, padding: 5,
    view: { stroke: null },
    axis: {
      labelColor: T.sub, titleColor: T.sub, gridColor: T.grid,
      domainColor: T.axis, tickColor: T.axis,
      labelFontSize: 12, titleFontSize: 12, titleFontWeight: 600, titlePadding: 10
    },
    axisX: { grid: false },
    legend: { labelColor: T.sub, titleColor: T.sub, labelFontSize: 12,
              symbolType: 'circle', orient: 'top', titleFontWeight: 600 },
    range: { category: PALETTE }
  };
  const embedOpt = { actions: false, renderer: 'svg', config: vlConfig };

  let _seq = 0;

  /* 차트 1개 렌더.
     spec : Vega-Lite 스펙 (width/height 생략 가능)
     opts.hover : 호버 시 강조할 필드 배열 (예: ['주차']). 주면 툴팁+나머지 흐림 자동.
     opts.height : 높이(기본 240) */
  function chart(sel, spec, opts) {
    opts = opts || {};
    const s = Object.assign({ width: 'container', height: opts.height || 240 }, spec);
    s.encoding = s.encoding || {};

    if (opts.hover && opts.hover.length) {
      const pname = 'hov' + (_seq++);
      s.params = (s.params || []).concat([{
        name: pname,
        select: { type: 'point', on: 'pointerover', clear: 'pointerout', fields: opts.hover }
      }]);
      s.encoding.opacity = { condition: { param: pname, value: 1, empty: true }, value: 0.45 };
    }
    // 툴팁: 호출자가 직접 지정 안 했으면 인코딩된 필드 전부 자동 표시
    if (typeof s.mark === 'string') s.mark = { type: s.mark };
    if (s.mark && s.mark.tooltip === undefined && !s.encoding.tooltip) s.mark.tooltip = true;

    const p = vegaEmbed(sel, s, embedOpt);
    // 8091 iframe 뷰어 등 컨테이너 폭이 0으로 잡혀 차트가 안 그려지는 문제 대응:
    // 폭이 생기거나 바뀌면 view.resize()로 다시 그린다.
    p.then(function (res) {
      const el = (typeof sel === 'string') ? document.querySelector(sel) : sel;
      if (!el || !window.ResizeObserver || !res || !res.view) return;
      let last = 0;
      new ResizeObserver(function () {
        const w = el.clientWidth;
        if (w > 0 && Math.abs(w - last) > 1) { last = w; try { res.view.resize().runAsync(); } catch (e) {} }
      }).observe(el);
    }).catch(function () {});
    return p;
  }

  /* 하이라이트(heat) 테이블 렌더.
     cfg.columns : [{key, label, type}]  type: 'text'|'num'|'pct'|'pp'|'rtx'
       - 'text' = 왼쪽 정렬 라벨(th), 'rtx' = 오른쪽 정렬 텍스트(포맷된 수치 문자열용)
       - 헤더 정렬은 본문 정렬을 따라감 (text=왼쪽, 나머지=오른쪽)
     cfg.rows    : [{...}] 객체 배열
     cfg.heat    : heat 음영 줄 컬럼 key 배열 (옵션) — 값 클수록 진하게
     각 heat 컬럼 색은 PALETTE 순서로 자동 배정 (파랑→주황…) */
  function heatTable(sel, cfg) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    const cols = cfg.columns, rows = cfg.rows, heatKeys = cfg.heat || [];
    const heatRGB = { /* key → 'r,g,b' */ };
    heatKeys.forEach((k, i) => { heatRGB[k] = hexToRGB(PALETTE[i % PALETTE.length]); });

    // heat 범위 + pp 최대절대값 사전 계산
    const range = {}; heatKeys.forEach(k => {
      const vs = rows.map(r => +r[k]); range[k] = [Math.min(...vs), Math.max(...vs)];
    });
    const ppKey = (cols.find(c => c.type === 'pp') || {}).key;
    const maxAbsPP = ppKey ? Math.max(...rows.map(r => Math.abs(+r[ppKey]))) : 1;

    const thead = '<tr>' + cols.map((c, ci) =>
      `<th${(c.type === 'text' || ci === 0) ? ' class="tl-th-l"' : ''}>${esc(c.label)}</th>`).join('') + '</tr>';

    const tbody = rows.map(r => '<tr>' + cols.map((c, ci) => {
      const v = r[c.key];
      if (c.type === 'text' || ci === 0) return `<th>${esc(v)}</th>`;
      if (c.type === 'rtx') return `<td class="tl-cell">${esc(v)}</td>`;
      if (c.type === 'pp') {
        const n = +v, w = Math.round(Math.abs(n) / maxAbsPP * 54) + 6;
        const cls = n >= 0 ? 'pos' : 'neg';
        const txt = (n >= 0 ? '+' : '') + n.toFixed(1);
        const bar = `<span class="tl-bar" style="width:${w}px"></span>`;
        return `<td class="tl-cell"><span class="tl-pp ${cls}">${n < 0 ? bar : ''}` +
               `<span class="tl-val">${txt}</span>${n >= 0 ? bar : ''}</span></td>`;
      }
      let disp = c.type === 'pct' ? (+v).toFixed(1) + '%' :
                 c.type === 'num' ? (+v).toLocaleString() : esc(v);
      let style = '';
      if (heatKeys.indexOf(c.key) > -1) {
        const [mn, mx] = range[c.key], t = (+v - mn) / (mx - mn || 1);
        style = `background:rgba(${heatRGB[c.key]},${(0.06 + t * 0.30).toFixed(3)});`;
      }
      return `<td class="tl-cell" style="${style}">${disp}</td>`;
    }).join('') + '</tr>').join('');

    el.innerHTML =
      `<div class="tl-table-wrap"><table class="tl-table">` +
      `<thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
  }

  // ── util ──
  function hexToRGB(h){ const n=parseInt(h.slice(1),16); return `${(n>>16)&255},${(n>>8)&255},${n&255}`; }
  function esc(s){ return String(s).replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m])); }

  return { PALETTE, TOKENS: T, vlConfig, embedOpt, chart, heatTable };
})();
