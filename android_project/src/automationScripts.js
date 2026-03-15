import { FLOW, URLS } from './constants';

function escapeForJsString(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\\$');
}

function baseHelpersScript() {
  return `
(function() {
  if (window.__dropboxAutomationHelpersInstalled) return;
  window.__dropboxAutomationHelpersInstalled = true;

  window.__wait = function(ms) {
    return new Promise(function(resolve) { setTimeout(resolve, ms); });
  };

  window.__postRN = function(payload) {
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } catch (e) {}
  };

  window.__randomBetween = function(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  window.__pace = async function(min, max) {
    await window.__wait(window.__randomBetween(min, max));
  };

  window.__clickElement = function(el) {
    if (!el) return false;
    try {
      el.scrollIntoView({ behavior: 'auto', block: 'center' });
      if (typeof el.focus === 'function') el.focus();
      el.click();
      return true;
    } catch (e) {
      try {
        el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      } catch (err) {
        return false;
      }
    }
  };

  window.__humanTypeDOM = async function(element, text) {
    if (!element) return;
    var value = String(text || '');

    element.focus();
    element.value = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));

    var setter = null;
    var proto = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) setter = descriptor.set;

    var current = '';
    for (var i = 0; i < value.length; i++) {
      current += value[i];
      if (setter) setter.call(element, current);
      else element.value = current;
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await window.__wait(Math.floor(Math.random() * 70) + 40);
    }

    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.blur();
  };

  // Keep popup-style navigations in the same tab so Android WebView does not render tiny windows.
  window.open = function(url) {
    if (url) {
      try {
        window.location.assign(url);
      } catch (e) {
        window.location.href = url;
      }
    }
    return null;
  };
})();
`;
}

function tempMailScript(flowData) {
  return `
${baseHelpersScript()}
(async function() {
  if (window.__tempMailAutomationRunning) return;
  window.__tempMailAutomationRunning = true;

  var flowState = '${escapeForJsString(flowData.flowState)}';
  var getEmailDeleteDone = ${flowData.getEmailDeleteDone ? 'true' : 'false'};

  function isElementClickable(el) {
    if (!el) return false;

    try {
      var style = window.getComputedStyle(el);
      var rect = el.getBoundingClientRect();
      var ariaDisabled = (el.getAttribute('aria-disabled') || '').toLowerCase() === 'true';

      if (el.disabled || ariaDisabled) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
      if (rect.width < 2 || rect.height < 2) return false;
    } catch (e) {
      return false;
    }

    return true;
  }

  function clickRefreshButton() {
    var selectors = [
      'button[data-qa="refresh-button"]',
      '[data-qa="refresh-button"]',
      'button[title*="Refresh"]',
      'button[aria-label*="Refresh"]'
    ];

    for (var i = 0; i < selectors.length; i++) {
      var btn = document.querySelector(selectors[i]);
      if (btn && window.__clickElement(btn)) return true;
    }

    var all = Array.from(document.querySelectorAll('button, a, span, div'));
    var byText = all.find(function(el) {
      var t = (el.innerText || '').trim().toLowerCase();
      return t === 'refresh' || t.indexOf(' refresh') >= 0;
    });

    return window.__clickElement(byText);
  }

  function clickDeleteButton() {
    function resolveDeleteButton() {
      var directSelectors = [
        'button[data-qa="delete-button"]',
        '[data-qa="menu"] button[data-qa="delete-button"]',
        '[data-qa="menu"] [data-qa="delete-button"]',
        'main div[data-qa="menu"] button:nth-of-type(4)'
      ];

      for (var s = 0; s < directSelectors.length; s++) {
        var direct = document.querySelector(directSelectors[s]);
        if (direct) return direct;
      }

      // Fallback to user-provided XPath.
      var xpaths = [
        '/html/body/div[1]/main/div[3]/button[4]',
        '//*[@data-qa="delete-button"]'
      ];

      for (var x = 0; x < xpaths.length; x++) {
        try {
          var node = document.evaluate(xpaths[x], document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
          if (node) return node;
        } catch (e) {}
      }

      return null;
    }

    function dispatchPointerClick(el) {
      try {
        var rect = el.getBoundingClientRect();
        var cx = rect.left + rect.width / 2;
        var cy = rect.top + rect.height / 2;
        var opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };

        el.dispatchEvent(new PointerEvent('pointerdown', opts));
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new PointerEvent('pointerup', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
      } catch (e) {
        try {
          el.click();
        } catch (err) {}
      }
    }

    var selectors = [
      '[data-qa="menu"] button[data-qa="delete-button"]',
      '[data-qa="menu"] [data-qa="delete-button"]',
      'button[data-qa="delete-button"]',
      '[data-qa="delete-button"]',
      'button[data-testid*="delete" i]',
      '[data-testid*="delete" i]',
      'button[data-test-id*="delete" i]',
      'button[title*="Delete"]',
      'button[aria-label*="Delete"]',
      'button[aria-label*="Trash"]',
      'button[title*="Trash"]'
    ];

    for (var i = 0; i < selectors.length; i++) {
      var btn = document.querySelector(selectors[i]);
      if (isElementClickable(btn)) {
        window.__clickElement(btn);
        dispatchPointerClick(btn);
        return true;
      }
    }

    var strictBtn = resolveDeleteButton();
    if (isElementClickable(strictBtn)) {
      window.__clickElement(strictBtn);
      dispatchPointerClick(strictBtn);
      return true;
    }

    var all = Array.from(document.querySelectorAll('button, a, span, div'));
    var byText = all.find(function(el) {
      var t = (el.innerText || '').trim().toLowerCase();
      return (
        t === 'delete' ||
        t.indexOf('delete') >= 0 ||
        t.indexOf('trash') >= 0 ||
        t.indexOf('clear') >= 0
      );
    });

    if (!isElementClickable(byText)) return false;
    return window.__clickElement(byText);
  }

  function getCurrentTempMailAddress() {
    var input = document.querySelector('input[id="email"], input[type="text"]');
    return input && input.value ? input.value.trim() : '';
  }

  async function waitForDeleteControls(maxWaitMs) {
    var start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      var menu = document.querySelector('[data-qa="menu"]');
      var deleteBtn = document.querySelector('[data-qa="menu"] [data-qa="delete-button"], button[data-qa="delete-button"], [data-qa="delete-button"]');
      if (menu && isElementClickable(deleteBtn)) return true;
      await window.__wait(350);
    }
    return false;
  }

  function confirmDeleteIfPrompted() {
    var selectors = [
      'button[data-qa="confirm-delete-button"]',
      '[data-qa="confirm-delete-button"]',
      'button[data-testid*="confirm" i]',
      'button[data-testid*="delete" i]',
      'button[aria-label*="Confirm" i]',
      'button[aria-label*="Delete" i]'
    ];

    for (var i = 0; i < selectors.length; i++) {
      var btn = document.querySelector(selectors[i]);
      if (btn && window.__clickElement(btn)) return true;
    }

    var all = Array.from(document.querySelectorAll('button, a, span, div'));
    var byText = all.find(function(el) {
      var t = (el.innerText || '').trim().toLowerCase();
      return (
        t === 'confirm' ||
        t === 'ok' ||
        t.indexOf('confirm delete') >= 0 ||
        t.indexOf('yes, delete') >= 0 ||
        t.indexOf('delete all') >= 0
      );
    });

    return window.__clickElement(byText);
  }

  function findDropboxMessageRow() {
    var rows = Array.from(document.querySelectorAll('li[data-qa="message"], .message.list-complete-item, ul.email-list li.message'));
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var sender = ((row.querySelector('[title*="dropbox" i], .truncate') || {}).textContent || '').toLowerCase();
      var subject = ((row.querySelector('[data-qa="message-subject"], .message__subject') || {}).textContent || '').toLowerCase();
      var body = (row.textContent || '').toLowerCase();

      if (sender.indexOf('dropbox') >= 0 || subject.indexOf('verify your email') >= 0 || body.indexOf('dropbox') >= 0) {
        return row;
      }
    }

    return null;
  }

  async function performTempMailCleanup() {
    var ready = await waitForDeleteControls(30000);
    if (!ready) {
      window.__postRN({ type: 'LOG', level: 'warn', message: 'Delete button did not become enabled within timeout.' });
      return false;
    }

    var emailBefore = getCurrentTempMailAddress();
    var clickedDelete = false;

    for (var d = 0; d < 10; d++) {
      clickedDelete = clickDeleteButton();
      if (clickedDelete) {
        await window.__wait(900);
        confirmDeleteIfPrompted();

        // Wait for temp-mail to actually rotate the address after delete.
        for (var r = 0; r < 12; r++) {
          await window.__wait(500);
          var emailAfter = getCurrentTempMailAddress();
          if (emailBefore && emailAfter && emailAfter !== emailBefore) {
            window.__postRN({ type: 'LOG', level: 'info', message: 'Temp-mail address changed after delete.' });
            return true;
          }
        }
      }

      await window.__wait(900);
    }

    if (clickedDelete) {
      window.__postRN({ type: 'LOG', level: 'warn', message: 'Delete was clicked but email did not rotate yet.' });
    } else {
      window.__postRN({ type: 'LOG', level: 'warn', message: 'Delete button was not clicked in temp-mail cleanup.' });
    }

    return false;
  }

  if (flowState === '${FLOW.DELETE_EMAIL}') {
    var step8Deleted = await performTempMailCleanup();
    window.__postRN({
      type: 'PATCH_STATE',
      patch: {
        flowState: '${FLOW.GET_EMAIL}',
        // If Step 8 delete failed, keep this false so GET_EMAIL retries cleanup.
        getEmailDeleteDone: step8Deleted,
        email: ''
      }
    });
    window.__tempMailAutomationRunning = false;
    return;
  }

  if (flowState === '${FLOW.GET_EMAIL}') {
    if (!getEmailDeleteDone) {
      var cleanedInGetEmail = await performTempMailCleanup();

      window.__postRN({ type: 'PATCH_STATE', patch: { getEmailDeleteDone: cleanedInGetEmail } });
      if (!cleanedInGetEmail) {
        window.__tempMailAutomationRunning = false;
        return;
      }

      await window.__wait(2500);
    }

    var email = '';
    for (var j = 0; j < 15; j++) {
      await window.__wait(1000);
      var input = document.querySelector('input[id="email"], input[type="text"]');
      if (input && input.value && input.value.indexOf('@') >= 0) {
        email = input.value;
        break;
      }
    }

    if (email) {
      window.__postRN({ type: 'EMAIL_COPIED', email: email });
    } else {
      window.__postRN({ type: 'LOG', level: 'error', message: 'Could not capture generated temp email.' });
    }

    window.__tempMailAutomationRunning = false;
    return;
  }

  if (flowState === '${FLOW.WAIT_VERIFICATION}') {
    function findVerifyLink(doc) {
      if (!doc) return null;

      var anchors = Array.from(doc.querySelectorAll('a[href]'));
      for (var i = 0; i < anchors.length; i++) {
        var a = anchors[i];
        var href = (a.href || '').toLowerCase();
        var text = (a.innerText || a.textContent || '').trim().toLowerCase();

        var looksLikeDropboxVerify =
          href.indexOf('dropbox.com/emailverified') >= 0 ||
          href.indexOf('dropbox.com') >= 0 && (
            href.indexOf('verify') >= 0 ||
            href.indexOf('emailverified') >= 0 ||
            href.indexOf('confirm') >= 0
          );

        var looksLikeVerifyText =
          text.indexOf('verify your email') >= 0 ||
          text.indexOf('verify email') >= 0 ||
          text.indexOf('verify') >= 0 ||
          text.indexOf('confirm') >= 0;

        if (looksLikeDropboxVerify || looksLikeVerifyText) {
          return { href: a.href, element: a };
        }
      }

      var buttonLike = Array.from(doc.querySelectorAll('button, [role="button"], div, span'));
      for (var j = 0; j < buttonLike.length; j++) {
        var el = buttonLike[j];
        var label = (el.innerText || el.textContent || '').trim().toLowerCase();
        if (label.indexOf('verify') >= 0 || label.indexOf('confirm') >= 0) {
          var parentLink = el.closest('a[href]');
          if (parentLink && parentLink.href) {
            return { href: parentLink.href, element: parentLink };
          }
        }
      }

      return null;
    }

    var foundEmailRow = false;

    for (var poll = 0; poll < 60; poll++) {
      clickRefreshButton();
      await window.__wait(2500);

      var row = findDropboxMessageRow();
      if (row) {
        var subjectNode = row.querySelector('[data-qa="message-subject"], .message__subject');
        if (!window.__clickElement(subjectNode)) {
          window.__clickElement(row);
        }
        foundEmailRow = true;
        break;
      }

      await window.__wait(10000);
    }

    if (foundEmailRow) {
      await window.__wait(3000);

      for (var attempts = 0; attempts < 30; attempts++) {
        var verify = findVerifyLink(document);

        if (verify && verify.href) {
          // Trigger the button click for human-like behavior, but also pass href explicitly.
          window.__clickElement(verify.element);
          window.__postRN({ type: 'EMAIL_VERIFIED', href: verify.href });
          window.__tempMailAutomationRunning = false;
          return;
        }

        var iframes = document.querySelectorAll('iframe');
        for (var k = 0; k < iframes.length; k++) {
          try {
            var doc = iframes[k].contentDocument;
            if (!doc) continue;

            var iframeVerify = findVerifyLink(doc);
            if (iframeVerify && iframeVerify.href) {
              window.__clickElement(iframeVerify.element);
              window.__postRN({ type: 'EMAIL_VERIFIED', href: iframeVerify.href });
              window.__tempMailAutomationRunning = false;
              return;
            }
          } catch (e) {}
        }

        await window.__wait(3000);
      }
    }

    window.__postRN({ type: 'LOG', level: 'warn', message: 'Verification email was not found within polling window.' });
    window.__tempMailAutomationRunning = false;
  }
})();
`;
}

function dropboxScript(flowData) {
  return `
${baseHelpersScript()}
(async function() {
  if (window.__dropboxAutomationRunning) return;
  window.__dropboxAutomationRunning = true;

  var flowState = '${escapeForJsString(flowData.flowState)}';
  var email = '${escapeForJsString(flowData.email)}';

  function randomFrom(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function randomLetters(length) {
    var chars = 'abcdefghijklmnopqrstuvwxyz';
    var out = '';
    for (var i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function shuffleText(text) {
    var arr = text.split('');
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr.join('');
  }

  function generateStrongPassword() {
    var lower = 'abcdefghijklmnopqrstuvwxyz';
    var upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var nums = '0123456789';
    var syms = '!@#$%^&*()_+-=';
    var all = lower + upper + nums + syms;
    var length = Math.floor(Math.random() * 5) + 14; // 14-18

    var password =
      lower[Math.floor(Math.random() * lower.length)] +
      upper[Math.floor(Math.random() * upper.length)] +
      nums[Math.floor(Math.random() * nums.length)] +
      syms[Math.floor(Math.random() * syms.length)];

    for (var i = 4; i < length; i++) {
      password += all[Math.floor(Math.random() * all.length)];
    }

    return shuffleText(password);
  }

  function buildUniqueProfile() {
    var firstPool = [
      'Aarav','Liam','Noah','Ethan','Mason','Lucas','Elijah','Logan','Benjamin','Henry',
      'Olivia','Emma','Ava','Sophia','Mia','Amelia','Harper','Evelyn','Aria','Ella',
      'Riya','Anaya','Zara','Nora','Lina','Ira','Kiran','Aanya','Meera','Sia'
    ];
    var lastPool = [
      'Carter','Brooks','Hayes','Reed','Morris','Wright','Foster','Hunter','Porter','Bennett',
      'Shaw','Miller','Turner','Parker','Cooper','Ward','Dawson','Hayden','Griffin','Sutton',
      'Kapoor','Mehta','Sharma','Patel','Verma','Reddy','Nair','Iyer','Malik','Bhat'
    ];

    var firstName = randomFrom(firstPool) + randomLetters(2);
    var lastName = randomFrom(lastPool) + randomLetters(3);

    return {
      firstName: firstName,
      lastName: lastName,
      password: generateStrongPassword()
    };
  }

  function uniqueAppName() {
    var base = randomFrom(['AURORA','NEXORA','CLOUDMINT','SYNCLEAF','DATAHIVE','DROPNEST','FLOWVAULT','SKYPULSE']);
    var rand = Math.random().toString(36).slice(2, 10);
    return base + rand;
  }

  function findAccountMenuTrigger() {
    var container =
      document.querySelector('#account-menu-trigger__browse') ||
      document.querySelector('[data-test-id="account-menu-trigger"]') ||
      document.querySelector('[data-testid="account-menu-trigger"]');

    if (container) {
      var innerButton = container.querySelector('button');
      if (innerButton) return innerButton;
      if ((container.tagName || '').toLowerCase() === 'button') return container;
    }

    return (
      document.querySelector('button[aria-label*="Account menu" i]') ||
      document.querySelector('button[aria-haspopup="true"][aria-label*="account" i]')
    );
  }

  function findLogoutButton() {
    var direct =
      document.querySelector('a[href*="/logout"]') ||
      document.querySelector('a[href*="logout"]') ||
      document.querySelector('button[aria-label*="log out" i]') ||
      document.querySelector('button[aria-label*="sign out" i]') ||
      document.querySelector('[data-testid*="logout" i]') ||
      document.querySelector('[data-testid*="signout" i]') ||
      document.querySelector('[data-test-id*="logout" i]') ||
      document.querySelector('[role="menuitem"][href*="logout"]');
    if (direct) return direct;

    var candidates = Array.from(document.querySelectorAll('a, button, div, span'));
    var titleNode = candidates.find(function(el) {
      var text = (el.textContent || '').trim().toLowerCase();
      var compact = text.replace(/\s+/g, '');
      return (
        text === 'log out' ||
        text === 'sign out' ||
        compact === 'logout' ||
        compact === 'signout' ||
        text.indexOf('log out') >= 0 ||
        text.indexOf('sign out') >= 0
      );
    });

    if (!titleNode) return null;

    return titleNode.closest('a, button, [role="menuitem"]') || titleNode.parentElement || titleNode;
  }

  function isLoggedOutPage() {
    var path = (location.pathname || '').toLowerCase();
    if (path.indexOf('/login') >= 0 || path.indexOf('/register') >= 0 || path.indexOf('/logout') >= 0) {
      return true;
    }

    var loginForm = document.querySelector('input[name="login_email"], input[name="susi_email"], input[type="email"], input[type="password"]');
    return !!loginForm;
  }

  async function waitForLogoutButton(timeoutMs, stepMs) {
    var start = Date.now();
    while (Date.now() - start < timeoutMs) {
      var btn = findLogoutButton();
      if (btn) return btn;
      await window.__wait(stepMs);
    }
    return null;
  }

  async function performLogoutSequence() {
    if (isLoggedOutPage()) {
      window.__postRN({ type: 'LOGOUT_COMPLETED' });
      return true;
    }

    var logoutBtn = findLogoutButton();

    for (var attempt = 1; !logoutBtn && attempt <= 4; attempt++) {
      var menuTrigger = findAccountMenuTrigger();
      if (!menuTrigger) {
        await window.__pace(700, 1200);
        continue;
      }

      window.__clickElement(menuTrigger);
      await window.__pace(900, 1500);
      logoutBtn = await waitForLogoutButton(4200, 260);
    }

    if (logoutBtn) {
      var clickedLogout = window.__clickElement(logoutBtn);
      if (!clickedLogout) {
        try {
          logoutBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        } catch (e) {}
      }

      await window.__pace(2800, 4200);
      if (isLoggedOutPage()) {
        window.__postRN({ type: 'LOGOUT_COMPLETED' });
        return true;
      }
    }

    // Fallback route if menu item was rendered but not clickable in WebView.
    try {
      location.href = '/logout';
      await window.__pace(2200, 3400);
      if (isLoggedOutPage()) {
        window.__postRN({ type: 'LOGOUT_COMPLETED' });
        return true;
      }
    } catch (e) {}

    return false;
  }

  async function fillRegisterStep() {
    function isRegisterPath() {
      var path = (location.pathname || '').toLowerCase();
      return path === '/register' || path.indexOf('/register/') === 0;
    }

    function isPostSignupPath() {
      var path = (location.pathname || '').toLowerCase();
      return (
        path.indexOf('/trial_first') === 0 ||
        path.indexOf('/home') === 0 ||
        path.indexOf('/account') === 0 ||
        path.indexOf('/plans') === 0
      );
    }

    async function waitForRedirectOutOfRegister(maxPolls, intervalMs) {
      for (var poll = 0; poll < maxPolls; poll++) {
        await window.__wait(intervalMs);
        if (!isRegisterPath()) return true;
      }
      return false;
    }

    if (window.__signupAwaitingRedirect) {
      var existingRedirect = await waitForRedirectOutOfRegister(40, 500);
      if (existingRedirect) {
        window.__signupAwaitingRedirect = false;
        window.__postRN({ type: 'SIGNUP_COMPLETED' });
      } else {
        window.__postRN({
          type: 'LOG',
          level: 'info',
          message: 'Signup submitted. Waiting for redirect before advancing flow.'
        });
      }
      return;
    }

    // If the page already moved away from /register (for example to /trial_first),
    // advance to verification immediately even after a full document reload.
    if (!isRegisterPath() && isPostSignupPath()) {
      window.__postRN({ type: 'SIGNUP_COMPLETED' });
      return;
    }

    var emailInput = document.querySelector('input[type="email"], input[name="login_email"], input[name="susi_email"]');
    if (!emailInput) {
      window.__dropboxAutomationRunning = false;
      return;
    }

    await window.__humanTypeDOM(emailInput, email || '');
    await window.__wait(700);

    var continueBtn = document.querySelector('button.email-submit-button, button[type="submit"]');
    if (continueBtn) window.__clickElement(continueBtn);
    else emailInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));

    await window.__wait(3500);

    if (!window.__dropboxSignupProfile) {
      window.__dropboxSignupProfile = buildUniqueProfile();
    }

    var firstName = window.__dropboxSignupProfile.firstName;
    var lastName = window.__dropboxSignupProfile.lastName;
    var password = window.__dropboxSignupProfile.password;

    await window.__humanTypeDOM(document.querySelector('input[name="fname"], input[name="first_name"]'), firstName);
    await window.__wait(300);
    await window.__humanTypeDOM(document.querySelector('input[name="lname"], input[name="last_name"]'), lastName);
    await window.__wait(300);
    await window.__humanTypeDOM(document.querySelector('input[name="password"], input[type="password"]'), password);
    await window.__wait(600);

    var submit = Array.from(document.querySelectorAll('button')).find(function(b) {
      var t = (b.innerText || '').toLowerCase();
      return t.indexOf('agree and sign up') >= 0 || t.indexOf('create an account') >= 0;
    });

    if (submit) {
      window.__clickElement(submit);
      window.__signupAwaitingRedirect = true;

      var redirected = await waitForRedirectOutOfRegister(70, 500);

      if (!redirected) {
        window.__postRN({
          type: 'LOG',
          level: 'warn',
          message: 'Signup submitted but redirect not detected yet. Flow will wait until redirect occurs.'
        });
        return;
      }

      window.__signupAwaitingRedirect = false;
      window.__dropboxSignupProfile = null;
      window.__postRN({ type: 'SIGNUP_COMPLETED' });
    }
  }

  async function ensureCreateAppPage() {
    if (location.pathname === '/developers/apps') {
      var createBtn = document.querySelector('a.app-list__create-btn, .app-list__header a[href="/developers/apps/create"]');
      if (createBtn) {
        await window.__pace(350, 900);
        window.__clickElement(createBtn);
      }
      return;
    }

    if (location.pathname === '/developers/apps/create') {
      var scoped = document.querySelector('#scoped');
      if (scoped && !scoped.checked) window.__clickElement(scoped);

      var appFolder = document.querySelector('#app_folder_permission');
      if (appFolder && !appFolder.checked) window.__clickElement(appFolder);

      var nameInput = document.querySelector('#app-name, input[name="name"]');
      var appName = null;
      if (nameInput && !nameInput.value) {
        appName = uniqueAppName();
        await window.__humanTypeDOM(nameInput, appName);
      }

      var tos = document.querySelector('#accept-tos');
      if (tos && !tos.checked) window.__clickElement(tos);

      await window.__pace(500, 1000);
      var createButton = document.querySelector('#create-button.button-primary, #create-button, button#create-button');
      if (createButton) {
        window.__clickElement(createButton);
        window.__postRN({ type: 'APP_CREATED', appName: appName });
      }
    }
  }

  async function configureAppSettings() {
    var isDevelopersSettings = location.pathname.indexOf('/developers/apps/') >= 0 && location.pathname.lastIndexOf('/create') !== location.pathname.length - 7;
    if (!isDevelopersSettings) return;

    var redirectInput = document.querySelector('form#oauth-add-uri-form input[name="oauth_uri"], input.app-info__url-input[name="oauth_uri"]');
    if (redirectInput) {
      var redirectUri = '${URLS.BRIDGE_CALLBACK}';
      var currentUris = ((document.querySelector('#oauth-uri-list') || {}).innerText || '').toLowerCase();
      if (currentUris.indexOf(redirectUri.toLowerCase()) < 0) {
        await window.__humanTypeDOM(redirectInput, redirectUri);
        var addBtn = document.querySelector('form#oauth-add-uri-form input[type="submit"], form#oauth-add-uri-form .freshbutton-silver');
        if (addBtn) {
          await window.__pace(350, 900);
          window.__clickElement(addBtn);
          await window.__wait(1200);
        }
      }
    }

    var appKey = (((document.querySelector('.app-key') || {}).textContent) || '').trim();
    var appSecretContainer = document.querySelector('.app-secret');
    var secretShow = appSecretContainer ? appSecretContainer.querySelector('a') : null;
    if (secretShow) {
      window.__clickElement(secretShow);
      await window.__wait(500);
    }

    var appSecret = appSecretContainer ? (appSecretContainer.getAttribute('data-app-secret') || (appSecretContainer.textContent || '').trim()) : '';

    var permissionsTab =
      document.querySelector('a[data-hash="permissions"]') ||
      Array.from(document.querySelectorAll('a.c-tabs__label')).find(function(a) {
        return (a.textContent || '').trim().toLowerCase() === 'permissions';
      });

    if (permissionsTab) {
      await window.__pace(350, 900);
      window.__clickElement(permissionsTab);
      await window.__wait(1200);
    }

    var panel = document.querySelector('div.c-tabs__content--selected') || document.querySelector('#pyxl3564164188837752160');
    if (panel) {
      var checkboxes = Array.from(panel.querySelectorAll('input[type="checkbox"]'));
      for (var i = 0; i < checkboxes.length; i++) {
        var cb = checkboxes[i];
        if (!cb.disabled && !cb.checked) window.__clickElement(cb);
      }

      await window.__wait(700);
      var submitPermissions = document.querySelector('.permissions-submit-button, button.permissions-submit-button');
      if (submitPermissions) window.__clickElement(submitPermissions);
    }

    if (appKey && appSecret) {
      window.__postRN({
        type: 'OAUTH_BRIDGE_READY',
        appKey: appKey,
        appSecret: appSecret
      });
    }
  }

  async function handleOAuthAuthorizePages() {
    if (flowState !== '${FLOW.OAUTH_AUTHORIZE}') return;

    var continueBtn = document.querySelector('#warning-button-continue, .auth-button-continue');
    if (continueBtn) {
      await window.__pace(450, 1000);
      window.__clickElement(continueBtn);
      await window.__wait(900);
    }

    var allowBtn = document.querySelector('.auth-button-allow, button.auth-button-allow');
    if (allowBtn) {
      await window.__pace(450, 1000);
      window.__clickElement(allowBtn);
    }
  }

  if (flowState === '${FLOW.LOGOUT_DROPBOX}') {
    var done = await performLogoutSequence();
    if (!done) {
      window.__postRN({ type: 'LOG', level: 'warn', message: 'Logout attempt did not complete on this pass.' });
    }
    window.__dropboxAutomationRunning = false;
    return;
  }

  if (flowState === '${FLOW.FILL_DROPBOX}') {
    await fillRegisterStep();
    window.__dropboxAutomationRunning = false;
    return;
  }

  if (flowState === '${FLOW.CREATE_DROPBOX_APP}') {
    await ensureCreateAppPage();
    window.__dropboxAutomationRunning = false;
    return;
  }

  if (flowState === '${FLOW.CONFIGURE_DROPBOX_APP}') {
    await configureAppSettings();
    window.__dropboxAutomationRunning = false;
    return;
  }

  await handleOAuthAuthorizePages();
  window.__dropboxAutomationRunning = false;
})();
`;
}

function bridgeScript(flowData) {
  return `
${baseHelpersScript()}
(async function() {
  if (window.__bridgeAutomationRunning) return;
  window.__bridgeAutomationRunning = true;

  var flowState = '${escapeForJsString(flowData.flowState)}';
  var appKey = '${escapeForJsString(flowData.appKey)}';
  var appSecret = '${escapeForJsString(flowData.appSecret)}';
  var oauthRetryCount = ${Number(flowData.oauthRetryCount || 0)};

  function looksLikeToken(value) {
    if (!value) return false;
    var token = value.trim();
    if (token.length < 30) return false;
    return /^[A-Za-z0-9._-]+$/.test(token);
  }

  async function fillBridgeOAuthForm() {
    if (window.__bridgeSubmitAttempted) return;

    var form =
      document.querySelector('#oauthForm') ||
      document.querySelector('form[action*="oauth" i]') ||
      document.querySelector('form');

    if (!form) {
      window.__postRN({ type: 'LOG', level: 'warn', message: 'Bridge form not found yet.' });
      return;
    }

    var appKeyInput =
      document.querySelector('#appKey') ||
      form.querySelector('input[name="appKey" i], input[name="app_key" i], input[placeholder*="app key" i]');
    var appSecretInput =
      document.querySelector('#appSecret') ||
      form.querySelector('input[name="appSecret" i], input[name="app_secret" i], input[placeholder*="app secret" i]');

    var submitBtn =
      form.querySelector('button[type="submit"], input[type="submit"]') ||
      Array.from(form.querySelectorAll('button, a, div, span')).find(function(b) {
        var t = (b.textContent || b.innerText || '').toLowerCase();
        return (
          t.indexOf('get refresh token') >= 0 ||
          t.indexOf('get access token') >= 0 ||
          t.indexOf('refresh token') >= 0 ||
          t.indexOf('get token') >= 0
        );
      });

    if (!appKeyInput || !appSecretInput || !submitBtn) {
      window.__postRN({ type: 'LOG', level: 'warn', message: 'Bridge controls not ready yet (app key/secret/submit).' });
      return;
    }

    var desiredKey = appKey || '';
    var desiredSecret = appSecret || '';

    if ((appKeyInput.value || '').trim() !== desiredKey) {
      await window.__humanTypeDOM(appKeyInput, desiredKey);
    }

    if ((appSecretInput.value || '').trim() !== desiredSecret) {
      await window.__humanTypeDOM(appSecretInput, desiredSecret);
    }

    await window.__wait(500);

    window.__bridgeSubmitAttempted = true;
    if (!window.__clickElement(submitBtn)) {
      try {
        form.requestSubmit ? form.requestSubmit() : form.submit();
      } catch (e) {}
    }

    window.__postRN({ type: 'PATCH_STATE', patch: { flowState: '${FLOW.OAUTH_AUTHORIZE}' } });
  }

  function extractTokenPayloadFromPage() {
    var preNode = document.querySelector('pre');
    var preText = preNode ? (preNode.textContent || '').trim() : '';

    if (preText) {
      try {
        var json = JSON.parse(preText);
        if (json && json.refresh_token) {
          return {
            refreshToken: json.refresh_token,
            accessToken: json.access_token || null,
            accountId: json.account_id || null,
            uid: json.uid || null,
            scope: json.scope || null
          };
        }
      } catch (e) {
        if (looksLikeToken(preText)) {
          return {
            refreshToken: preText,
            accessToken: null,
            accountId: null,
            uid: null,
            scope: null
          };
        }
      }
    }

    var bodyText = ((document.body || {}).innerText || '').trim();
    if (!bodyText) return null;

    var refreshMatch = bodyText.match(/"refresh_token"\s*:\s*"([^"]+)"/i);
    if (refreshMatch && looksLikeToken(refreshMatch[1])) {
      var accessMatch = bodyText.match(/"access_token"\s*:\s*"([^"]+)"/i);
      var accountMatch = bodyText.match(/"account_id"\s*:\s*"([^"]+)"/i);
      var uidMatch = bodyText.match(/"uid"\s*:\s*"([^"]+)"/i);
      var scopeMatch = bodyText.match(/"scope"\s*:\s*"([^"]+)"/i);

      return {
        refreshToken: refreshMatch[1],
        accessToken: accessMatch ? accessMatch[1] : null,
        accountId: accountMatch ? accountMatch[1] : null,
        uid: uidMatch ? uidMatch[1] : null,
        scope: scopeMatch ? scopeMatch[1] : null
      };
    }

    if (looksLikeToken(bodyText)) {
      return {
        refreshToken: bodyText,
        accessToken: null,
        accountId: null,
        uid: null,
        scope: null
      };
    }

    return null;
  }

  var bodyText = ((document.body || {}).innerText || '').toLowerCase();
  if (bodyText.indexOf('invalid or expired state') >= 0) {
    if (oauthRetryCount >= 3) {
      window.__postRN({ type: 'PATCH_STATE', patch: { flowState: '${FLOW.OAUTH_FAILED}' } });
      window.__bridgeAutomationRunning = false;
      return;
    }

    window.__postRN({
      type: 'PATCH_STATE',
      patch: { flowState: '${FLOW.OAUTH_BRIDGE}', oauthRetryCount: oauthRetryCount + 1 }
    });

    setTimeout(function() {
      location.href = '${URLS.BRIDGE}';
    }, 1200);

    window.__bridgeAutomationRunning = false;
    return;
  }

  if (flowState === '${FLOW.OAUTH_BRIDGE}') {
    await fillBridgeOAuthForm();
  }

  var tokenPayload = extractTokenPayloadFromPage();
  if (tokenPayload && tokenPayload.refreshToken) {
    window.__postRN({ type: 'TOKEN_CAPTURED', payload: tokenPayload });
  }

  window.__bridgeAutomationRunning = false;
})();
`;
}

export function getInjectionScript(url, flowData) {
  if (!url) return '';
  const normalized = url.toLowerCase();

  if (normalized.includes('temp-mail.io')) {
    return tempMailScript(flowData);
  }

  if (normalized.includes('dropbox.com')) {
    return dropboxScript(flowData);
  }

  if (normalized.includes('dropboxrefesh.vercel.app')) {
    return bridgeScript(flowData);
  }

  return '';
}
