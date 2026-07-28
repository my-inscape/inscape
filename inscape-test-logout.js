/**
 * Mobile / QA helper — session-only logout (keeps inscape_invite_codes_db intact).
 */
(function (global) {
  'use strict';

  var STYLE_ID = 'inscape-test-logout-style';
  var BTN_ID = 'inscape-test-logout-btn';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.inscape-test-logout{' +
      'position:fixed;' +
      'right:calc(0.45rem + env(safe-area-inset-right,0px));' +
      'bottom:calc(0.55rem + env(safe-area-inset-bottom,0px));' +
      'z-index:99999;' +
      'max-width:11rem;' +
      'padding:0.5rem 0.65rem;' +
      'border:0.5px solid rgba(201,122,122,0.38);' +
      'border-radius:2px;' +
      'background:rgba(8,8,10,0.88);' +
      'color:rgba(201,122,122,0.82);' +
      'font-family:"Hiragino Mincho ProN","Yu Mincho","Hiragino Sans",serif;' +
      'font-size:0.48rem;' +
      'letter-spacing:0.06em;' +
      'line-height:1.5;' +
      'cursor:pointer;' +
      'backdrop-filter:blur(6px);' +
      '-webkit-backdrop-filter:blur(6px);' +
      '}' +
      '.inscape-test-logout:active{' +
      'background:rgba(201,122,122,0.12);' +
      'border-color:rgba(201,122,122,0.55);' +
      '}';
    document.head.appendChild(style);
  }

  function mountTestLogout() {
    if (!global.INSCAPE_AUTH || !INSCAPE_AUTH.logoutToLp) return;
    if (document.getElementById(BTN_ID)) return;

    injectStyles();

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = BTN_ID;
    btn.className = 'inscape-test-logout';
    btn.textContent = '【テスト】ログアウト（LPに戻る）';
    btn.addEventListener('click', function () {
      INSCAPE_AUTH.logoutToLp();
    });
    document.body.appendChild(btn);
  }

  global.INSCAPE_TEST = {
    mountTestLogout: mountTestLogout
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountTestLogout);
  } else {
    mountTestLogout();
  }
})(typeof window !== 'undefined' ? window : globalThis);
