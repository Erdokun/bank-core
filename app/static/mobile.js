/* Phone-only presentation. All money, authentication and profile actions stay in app.js. */
(function () {
  'use strict';
  var phone = window.matchMedia('(max-width: 600px)');
  var app = document.getElementById('app');
  var dock = document.querySelector('.mobile-dock');
  var profile = document.getElementById('m-profile');
  var signin = document.getElementById('m-signin');
  var form = document.getElementById('signinForm');
  var currentView = 'home';
  var sectionFor = {home: 'd-home', activity: 'd-activity', card: 'd-card'};
  var email = document.getElementById('siEmail');
  var password = document.getElementById('siPass');
  var code = document.getElementById('siCode');

  // Add an avatar without moving or replacing the desktop profile control.
  var avatarButton = document.createElement('button');
  avatarButton.type = 'button';
  avatarButton.className = 'mobile-only mobile-profile';
  avatarButton.dataset.action = 'profile';
  avatarButton.setAttribute('aria-label', 'Open your profile');
  avatarButton.setAttribute('aria-haspopup', 'dialog');
  var avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatarButton.appendChild(avatar);
  document.querySelector('.workspace-tools').appendChild(avatarButton);
  var originalAvatar = document.getElementById('uAvatar');
  function syncAvatar() { avatar.replaceChildren.apply(avatar, Array.from(originalAvatar.childNodes, function (node) { return node.cloneNode(true); })); }
  new MutationObserver(syncAvatar).observe(originalAvatar, {childList: true, subtree: true, characterData: true});
  syncAvatar();

  function syncDock() {
    var profileOpen = profile.classList.contains('is-open');
    dock.querySelectorAll('button').forEach(function (button) {
      var active = profileOpen ? button.hasAttribute('data-mobile-profile') : button.dataset.mobileView === currentView;
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }
  function setView(view, moveFocus) {
    if (!sectionFor[view]) return;
    currentView = view;
    app.dataset.mobileView = view;
    syncDock();
    if (phone.matches && moveFocus) {
      app.scrollTo({top: 0, behavior: 'instant'});
      var target = document.getElementById(sectionFor[view]);
      target.setAttribute('tabindex', '-1');
      target.focus({preventScroll: true});
    }
  }
  dock.addEventListener('click', function (event) {
    var button = event.target.closest('[data-mobile-view]');
    if (button) setView(button.dataset.mobileView, true);
  });
  // Reopening the workspace (including signing in as another user) always starts at Home.
  new MutationObserver(function () { if (!app.hidden) setView('home', false); }).observe(app, {attributes: true, attributeFilter: ['hidden']});
  new MutationObserver(syncDock).observe(profile, {attributes: true, attributeFilter: ['class']});
  document.addEventListener('click', function (event) {
    if (phone.matches && event.target.closest('[data-action="goto-spaces"]')) setView('home', false);
  }, true);
  setView('home', false);

  // Only present format/completeness feedback: credentials are verified by the existing API.
  [email, password, code].forEach(function (input) {
    var status = document.createElement('small');
    status.id = input.id + '-mobile-status';
    status.className = 'mobile-only mobile-field-status';
    input.closest('.field').appendChild(status);
    function feedback(force) {
      if (!phone.matches) return;
      var value = input.value;
      var valid = input === email ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()) : input === code ? /^\d{6}$/.test(value) : value.length > 0;
      var touched = force || input.dataset.mobileTouched === 'true';
      var invalid = touched && !valid;
      input.setAttribute('aria-invalid', String(invalid));
      if (invalid) input.setAttribute('aria-describedby', status.id);
      else input.removeAttribute('aria-describedby');
      status.dataset.state = invalid ? 'error' : valid ? 'ready' : '';
      status.textContent = invalid ? (input === email ? 'Enter a valid email address.' : input === code ? 'Enter the 6-digit email code.' : 'Enter your password.') : valid ? (input === email ? '✓ Email format looks right' : input === code ? '✓ Code is complete' : '✓ Password entered') : '';
    }
    input.addEventListener('blur', function () { input.dataset.mobileTouched = 'true'; feedback(true); });
    input.addEventListener('input', function () { feedback(false); });
    input._mobileFeedback = feedback;
  });
  form.addEventListener('submit', function (event) {
    if (!phone.matches) return;
    var inputs = [email, password];
    if (!document.getElementById('siCodeField').hidden) inputs.push(code);
    inputs.forEach(function (input) { input._mobileFeedback(true); });
    var invalid = inputs.find(function (input) { return input.getAttribute('aria-invalid') === 'true'; });
    if (invalid) {
      event.preventDefault();
      event.stopImmediatePropagation();
      invalid.focus();
    }
  }, true);
  new MutationObserver(function () {
    if (!phone.matches || signin.hidden) return;
    if (signin.classList.contains('is-open')) return;
    [email, password, code].forEach(function (input) {
      delete input.dataset.mobileTouched;
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
      document.getElementById(input.id + '-mobile-status').textContent = '';
    });
    password.type = 'password';
    var toggle = signin.querySelector('[data-target="siPass"]');
    toggle.textContent = 'Show';
    toggle.setAttribute('aria-pressed', 'false');
  }).observe(signin, {attributes: true, attributeFilter: ['class']});

  // iOS keyboards resize the visual viewport independently of fixed page elements.
  function viewportChanged() {
    if (!phone.matches || !window.visualViewport) return;
    var viewport = window.visualViewport;
    document.documentElement.style.setProperty('--mobile-viewport-height', viewport.height + 'px');
    document.documentElement.style.setProperty('--mobile-viewport-top', viewport.offsetTop + 'px');
    app.classList.toggle('mobile-keyboard', window.innerHeight - viewport.height > 120 && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName));
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', viewportChanged);
    window.visualViewport.addEventListener('scroll', viewportChanged);
    document.addEventListener('focusout', function () { app.classList.remove('mobile-keyboard'); });
  }
  if (phone.addEventListener) phone.addEventListener('change', function () {
    setView('home', false);
    [email, password, code].forEach(function (input) {
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    });
    viewportChanged();
  });
  viewportChanged();

  // Home Screen launch: use the existing sign-in action when there is no saved session.
  // Saved sessions are restored and verified by app.js, including its #workspace handling.
  try {
    if (new URLSearchParams(location.search).get('launch') === 'app' && phone.matches && !sessionStorage.getItem('veyra_token') && !localStorage.getItem('veyra_token')) {
      document.querySelector('.landing [data-action="signin"]').click();
    }
  } catch (_) { /* Storage may be unavailable in a private browsing session. */ }
})();
