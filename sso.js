/* ============================================================
   이은정 과학 연구소 - 통합 로그인(SSO) v2 (빠른 입장)
   - 대시보드에서 한 번 로그인하면, 이 파일을 넣은 퀴즈앱/면접앱에서
     이름·비밀번호를 다시 입력하지 않고 자동으로 입장합니다.
   - 대시보드에서 '개별 로그인'으로 지정한 사이트는 자동 로그인하지 않습니다.
   - 이 파일을 불러오지 못해도(404 등) 앱은 원래 로그인 화면 그대로 동작합니다.
   사용법: 각 앱 index.html 의 </head> 바로 앞에 아래 한 줄을 넣으세요. (defer 없이)
   <script src="https://eunjungcheer-collab.github.io/dashboard/sso.js"></script>

   [속도] 구글 앱스크립트 호출은 한 번에 1~3초가 걸려서, 자동 입장 경로에서는
   ① 로그인 설정(getPassword)은 지난번 값을 바로 쓰고 뒤에서 갱신,
   ② 계정 확인(getAcct)은 1시간에 한 번만, 그것도 입장 뒤에 뒤에서 확인,
   ③ 이전 기록(이어풀기) 조회는 화면을 먼저 보여준 뒤 뒤에서 가져옵니다.
   ============================================================ */
(function () {
  'use strict';
  if (window.EJ_SSO) return;

  var KEY = 'ej_sso_v1';
  // 회원(가입·승인) 정보가 들어있는 과학 앱스크립트 (면접앱 3종과 같은 주소)
  var ACCT_URL = 'https://script.google.com/macros/s/AKfycbz13PbCOXl3A-RcF-sPaFb1YTMpbqYALuBH5_0ITR3yUtbPJauXjQnnrCkZKUyvLmvv4w/exec';
  var TTL = 30 * 24 * 3600 * 1000;   // 로그인 유지 기간: 30일
  var RECHECK = 60 * 60 * 1000;      // 계정 승인 상태 재확인 간격: 1시간

  function normPath(p) {
    try { p = new URL(p, location.href).pathname; } catch (e) {}
    return String(p).replace(/index\.html$/i, '').replace(/\/+$/, '').toLowerCase();
  }
  function read() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!s || !s.name || !s.h || !s.exp || s.exp < Date.now()) return null;
      return s;
    } catch (e) { return null; }
  }
  function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  // 방금 서버에서 확인한 경우(로그인 직후)에는 vt=지금으로 저장
  function save(name, h, off, verifiedNow) {
    write({ v: 2, name: name, h: h, off: off || [], exp: Date.now() + TTL, vt: verifiedNow === false ? 0 : Date.now() });
  }
  function setOff(off) {
    var s = read(); if (!s) return;
    s.off = off || [];
    write(s);
  }
  // 대시보드를 열 때마다: 제외 목록 갱신 + 유지기간 연장 (확인 시각은 그대로)
  function touch(off) {
    var s = read(); if (!s) return;
    s.off = off || [];
    s.exp = Date.now() + TTL;
    write(s);
  }
  function markVerified() {
    var s = read(); if (!s) return;
    s.vt = Date.now();
    write(s);
  }
  function clear() { try { localStorage.removeItem(KEY); } catch (e) {} }
  function allowedHere(s) {
    var me = normPath(location.pathname);
    var off = (s.off || []).map(normPath);
    return off.indexOf(me) === -1;
  }
  function needsVerify(s) { return !s.vt || (Date.now() - s.vt) > RECHECK; }

  // 계정이 아직 유효한지(승인 상태 · 비밀번호 초기화 여부) 서버에서 확인. 네트워크 오류면 null
  function verify(s) {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 7000);
    return fetch(ACCT_URL + '?action=getAcct&name=' + encodeURIComponent(s.name) + '&_=' + Date.now(), ctl ? { signal: ctl.signal } : {})
      .then(function (r) { return r.json(); })
      .then(function (j) {
        clearTimeout(t);
        if (!(j && j.ok && j.supported)) return null;
        return !!(j.exists && j.status !== '대기' && j.hash === s.h);
      })
      .catch(function () { clearTimeout(t); return null; });
  }

  window.EJ_SSO = { KEY: KEY, ACCT_URL: ACCT_URL, read: read, save: save, setOff: setOff, touch: touch, clear: clear, verify: verify, markVerified: markVerified, needsVerify: needsVerify, normPath: normPath };

  // 대시보드 자신에서는 아래 자동 입장 코드를 실행하지 않는다.
  if (window.EJ_SSO_PORTAL) return;

  var sess = read();
  if (!sess || !allowedHere(sess)) return;

  /* ---------- (1) 로그인 설정 조회를 '지난번 값 먼저, 갱신은 뒤에서'로 ----------
     퀴즈앱은 시작할 때 getPassword 응답을 기다린 뒤에야 첫 화면을 그립니다.
     통합 로그인 상태에서는 비밀번호가 필요 없으므로 지난번 응답을 바로 돌려줍니다. */
  var origFetch = window.fetch;
  if (typeof origFetch === 'function' && typeof Response === 'function') {
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : ((input && input.url) || '');
        var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        if (method === 'GET' && /[?&]action=getPassword(&|$)/.test(url)) {
          var ck = 'ej_fc_' + url, cached = null;
          try { cached = localStorage.getItem(ck); } catch (e) {}
          var net = origFetch.apply(this, arguments).then(function (res) {
            try {
              res.clone().text().then(function (t) {
                try { var j = JSON.parse(t); if (j && j.ok) localStorage.setItem(ck, t); } catch (e) {}
              });
            } catch (e) {}
            return res;
          });
          if (cached) { net.catch(function () {}); return Promise.resolve(new Response(cached, { status: 200, headers: { 'Content-Type': 'application/json' } })); }
          return net;
        }
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
  }

  /* ---------- (2) 첫 화면이 그려지기 전까지 로그인 화면 깜빡임 방지 ---------- */
  var hideStyle = null;
  function hideApp() {
    try {
      hideStyle = document.createElement('style');
      hideStyle.textContent = '#app{visibility:hidden}';
      (document.head || document.documentElement).appendChild(hideStyle);
      setTimeout(showApp, 4000); // 안전장치
    } catch (e) {}
  }
  function showApp() { if (hideStyle && hideStyle.parentNode) hideStyle.parentNode.removeChild(hideStyle); hideStyle = null; }
  hideApp();

  function run() {
    var s = sess;
    var phase = 0;           // 0=아직 / 1=자동 입장 시도함 / 2=앱 안으로 들어감
    var pendingLogout = false;
    var obs = null;

    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('#logoutBtn') : null;
      if (el) pendingLogout = true;
    }, true);

    // 입장 뒤에 뒤에서 계정 상태 확인 (1시간에 한 번). 무효면 세션을 지우고 새로고침 → 로그인 화면
    function backgroundVerify() {
      if (!needsVerify(s)) return;
      verify(s).then(function (ok) {
        if (ok === true) markVerified();
        else if (ok === false) { clear(); try { location.reload(); } catch (e) {} }
      });
    }

    // 이전 기록(이어풀기) 조회는 화면을 먼저 보여준 뒤 뒤에서 가져와 필요할 때만 다시 그림
    function loadResumeLater(name) {
      try {
        Promise.resolve(fetchServerResumeSnapshots(name)).then(function (c) {
          try {
            serverResumeCache = c;
            var has = c && (c.normal || c.wrong);
            if (has && screen === 'setup' && state.name === name) render();
          } catch (e) {}
        }).catch(function () {});
      } catch (e) {}
    }

    function enter() {
      var login = document.getElementById('loginNameInput');
      if (!login) { showApp(); return; }   // 그 사이에 직접 로그인했으면 그대로 둔다
      var name = s.name;

      // (A) 면접앱: 가입/승인 계정을 그대로 쓰므로 바로 입장
      if (typeof enterApp === 'function') {
        if (typeof hasStudentBank === 'function' && !hasStudentBank(name)) { showApp(); return; }
        try {
          if (typeof fetchServerResumeSnapshots === 'function' && typeof saveLastUsedName === 'function') {
            state.name = name; saveLastUsedName(name);
            serverResumeCache = { normal: null, wrong: null };
            screen = 'setup'; render();
            loadResumeLater(name);
          } else {
            enterApp(name);
          }
          backgroundVerify();
        } catch (e) { try { enterApp(name); } catch (e2) {} }
        showApp();
        return;
      }

      // (B) 단원 퀴즈앱: 비밀번호 확인 없이 바로 입장 (통합 로그인으로 이미 확인됨)
      if (typeof safeName === 'function') name = safeName(name);
      if (!name) { showApp(); return; }
      try {
        if (typeof fetchServerResumeSnapshots === 'function' && typeof APP_KEY !== 'undefined') {
          state.name = name;
          try { localStorage.setItem('lastname_' + APP_KEY, name); } catch (e) {}
          serverResumeCache = { normal: null, wrong: null };
          screen = 'setup'; render();
          loadResumeLater(name);
          backgroundVerify();
          showApp();
          return;
        }
      } catch (e) {}
      // 앱 구조가 다르면 예전 방식(입력칸을 채우고 입장 버튼 클릭)으로 대신한다
      login.value = name;
      var pw = document.getElementById('loginPwInput');
      var go = function () { var btn = document.getElementById('loginBtn'); if (btn) btn.click(); showApp(); backgroundVerify(); };
      if (pw && typeof getLoginConfig === 'function') {
        getLoginConfig().then(function (cfg) {
          if (cfg && cfg.loginEnabled !== false) pw.value = cfg.password;
          go();
        }).catch(function () { showApp(); });
      } else { go(); }
    }

    function check() {
      var login = document.getElementById('loginNameInput');
      if (login) {
        if (phase === 2) {
          showApp();
          if (pendingLogout) { clear(); if (obs) obs.disconnect(); }
          return;
        }
        if (phase === 0) { phase = 1; enter(); }
      } else {
        if (phase === 1) phase = 2;
        // 로그인 화면이 없는 옛 퀴즈앱(이름만 입력)은 이름만 채워 준다
        var nm = document.getElementById('nameInput');
        if (nm) {
          showApp();
          if (!nm.value && !nm.__ejFilled) {
            nm.__ejFilled = true;
            var n = (typeof safeName === 'function') ? safeName(s.name) : s.name;
            nm.value = n;
          }
        }
      }
    }

    obs = new MutationObserver(check);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    check();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
