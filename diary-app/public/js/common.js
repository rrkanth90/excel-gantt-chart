// Small helpers shared by every page.

export async function api(path, { method = 'GET', body, form, keepalive = false } = {}) {
  const options = { method, headers: { 'X-Diary-Client': '1' }, credentials: 'same-origin', keepalive };
  if (form) options.body = form;
  else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(path, options);
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && path !== '/api/login') {
    location.href = '/login';
    throw Object.assign(new Error('Signed out'), { status: 401 });
  }
  if (!res.ok) {
    throw Object.assign(new Error((data && data.error) || `Request failed (${res.status})`), { status: res.status, data });
  }
  return data;
}

// YYYY-MM-DD in the device's own time zone (so "today" matches the writer's day).
export function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return localDate(d);
}

let toastTimer;
export function toast(message, ms = 3500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}
