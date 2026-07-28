(function (global) {
  'use strict';

  var POLL_MS = 8000;
  var pollTimer = null;

  function inviteShareText(code) {
    var origin = (global.location && global.location.origin) || 'https://my-inscape.com';
    var base = origin.replace(/\/$/, '');
    return 'INSCAPE — 表現者のための聖域へ、あなたを招待します。\n招待コード: ' + code + '\n' + base + '/';
  }

  function copyCode(code) {
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      return global.navigator.clipboard.writeText(code);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = code;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) resolve();
        else reject(new Error('copy failed'));
      } catch (e) {
        reject(e);
      }
    });
  }

  function shareViaLineOrDm(code) {
    var text = inviteShareText(code);
    if (global.navigator && global.navigator.share) {
      return global.navigator.share({
        title: 'INSCAPE 招待',
        text: text
      }).catch(function () {
        openLineShare(text);
      });
    }
    openLineShare(text);
    return Promise.resolve();
  }

  function openLineShare(text) {
    var url = 'https://line.me/R/msg/text/?' + encodeURIComponent(text);
    global.open(url, '_blank', 'noopener,noreferrer');
  }

  function renderInviteList(container, codes) {
    if (!container) return;
    container.innerHTML = '';

    if (!codes || !codes.length) {
      container.innerHTML = '<p class="invite-empty">招待コードを読み込んでいます…</p>';
      return;
    }

    codes.forEach(function (row) {
      var item = document.createElement('div');
      item.className = 'invite-row' + (row.is_used ? ' is-used' : '');
      item.dataset.code = row.code;

      var codeEl = document.createElement('span');
      codeEl.className = 'invite-code';
      codeEl.textContent = row.code;

      var statusEl = document.createElement('span');
      statusEl.className = 'invite-status';
      statusEl.textContent = row.is_used ? '使用済み' : '未使用';

      var actions = document.createElement('div');
      actions.className = 'invite-actions';

      var copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'invite-btn invite-btn-copy';
      copyBtn.textContent = 'コピー';
      copyBtn.disabled = !!row.is_used;

      var shareBtn = document.createElement('button');
      shareBtn.type = 'button';
      shareBtn.className = 'invite-btn invite-btn-share';
      shareBtn.textContent = 'LINE/DMで送る';
      shareBtn.disabled = !!row.is_used;

      copyBtn.addEventListener('click', function () {
        copyCode(row.code).then(function () {
          copyBtn.textContent = 'コピーしました';
          global.setTimeout(function () {
            copyBtn.textContent = 'コピー';
          }, 1600);
        }).catch(function () {
          copyBtn.textContent = '失敗';
        });
      });

      shareBtn.addEventListener('click', function () {
        shareViaLineOrDm(row.code);
      });

      actions.appendChild(copyBtn);
      actions.appendChild(shareBtn);

      item.appendChild(codeEl);
      item.appendChild(statusEl);
      item.appendChild(actions);
      container.appendChild(item);
    });
  }

  function refreshInviteList(container) {
    if (!global.INSCAPE_AUTH || !INSCAPE_AUTH.fetchMyInviteCodes) {
      return Promise.resolve();
    }
    return INSCAPE_AUTH.fetchMyInviteCodes().then(function (codes) {
      renderInviteList(container, codes);
    }).catch(function (err) {
      if (container) {
        container.innerHTML = '<p class="invite-error">' +
          (err.message || '招待コードの取得に失敗しました') + '</p>';
      }
    });
  }

  function startInvitePolling(container) {
    stopInvitePolling();
    refreshInviteList(container);
    pollTimer = global.setInterval(function () {
      refreshInviteList(container);
    }, POLL_MS);
  }

  function stopInvitePolling() {
    if (pollTimer != null) {
      global.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function mountInviteSection(containerId) {
    var container = document.getElementById(containerId);
    if (!container) return;
    startInvitePolling(container);
    global.addEventListener('pagehide', stopInvitePolling);
    global.addEventListener('beforeunload', stopInvitePolling);
  }

  global.INSCAPE_INVITES = {
    mountInviteSection: mountInviteSection,
    refreshInviteList: refreshInviteList,
    stopInvitePolling: stopInvitePolling,
    copyCode: copyCode,
    shareViaLineOrDm: shareViaLineOrDm
  };
})(typeof window !== 'undefined' ? window : globalThis);
