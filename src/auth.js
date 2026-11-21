const $ = (id) => document.getElementById(id);

const els = {
  form: $('auth-form'),
  email: $('email'),
  password: $('password'),
  confirm: $('confirm'),
  confirmGroup: $('confirm-group'),
  submit: $('submit-btn'),
  toggle: $('toggle-password'),
  error: $('error'),
  subtitle: $('subtitle'),
  demoBlock: $('demo-block'),
  demoBtn: $('demo-btn'),
  dividerText: $('divider-text'),
};

let mode = 'login';

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || (data.errors && data.errors[0] && data.errors[0].msg) || 'Request failed';
    throw new Error(msg);
  }
  return data;
}

function showError(msg) {
  if (els.error) els.error.textContent = msg || '';
}

function setBusy(busy) {
  [els.submit, els.demoBtn].forEach((b) => { if (b) b.disabled = busy; });
}

function enterSetupMode() {
  mode = 'setup';
  if (els.confirmGroup) els.confirmGroup.hidden = false;
  if (els.confirm) els.confirm.required = true;
  if (els.password) els.password.autocomplete = 'new-password';
  if (els.submit) els.submit.textContent = 'Create account';
  if (els.subtitle) els.subtitle.textContent = 'Create the admin account to get started';
  document.title = 'CattleTrack - Create your account';
}

els.form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const email = els.email.value.trim();
  const password = els.password.value;

  if (!email || !password) return showError('Enter your email and password.');
  if (mode === 'setup') {
    if (password.length < 10) return showError('Password must be at least 10 characters.');
    if (password !== els.confirm.value) return showError('Passwords do not match.');
  }

  setBusy(true);
  try {
    await post(mode === 'setup' ? '/api/auth/setup' : '/api/auth/login', { email, password });
    const status = await fetch('/api/auth/status', { credentials: 'same-origin' }).then((r) => r.json());
    if (!status.authenticated) {
      throw new Error('Signed in, but the session was not saved. Check COOKIE_SECURE=false when using plain HTTP.');
    }
    location.replace('/');
  } catch (err) {
    showError(err.message);
    setBusy(false);
  }
});

els.demoBtn?.addEventListener('click', async () => {
  showError('');
  setBusy(true);
  try {
    await post('/api/auth/demo');
    const status = await fetch('/api/auth/status', { credentials: 'same-origin' }).then((r) => r.json());
    if (!status.authenticated) throw new Error('Demo session was not saved. Check COOKIE_SECURE=false on HTTP.');
    location.replace('/');
  } catch (err) {
    showError(err.message);
    setBusy(false);
  }
});

els.toggle?.addEventListener('click', () => {
  const show = els.password.type === 'password';
  els.password.type = show ? 'text' : 'password';
  els.toggle.textContent = show ? 'Hide' : 'Show';
});

async function init() {
  try {
    const status = await fetch('/api/auth/status', { credentials: 'same-origin' }).then((r) => r.json());
    if (status.authenticated) return location.replace('/');
    if (status.setupRequired) enterSetupMode();
    else if (status.demoEnabled && els.demoBlock) els.demoBlock.hidden = false;
  } catch {
    showError("Can't reach the server. Please try again.");
  }
}

init();