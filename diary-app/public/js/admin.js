import { api, toast, el } from './common.js';

const list = document.getElementById('user-list');
const form = document.getElementById('add-user');
let me = null;

async function load() {
  const { users } = await api('/api/admin/users');
  list.replaceChildren(...users.map(row));
}

function row(u) {
  const self = me && u.id === me.id;
  const patch = async (body, done) => {
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body });
      toast(done);
      load();
    } catch (err) { toast(err.message, 5000); }
  };
  return el('li', {},
    el('div', { class: 'who' }, u.displayName,
      u.isAdmin ? el('span', { class: 'badge' }, 'owner') : null,
      u.disabled ? el('span', { class: 'badge off' }, 'no access') : null,
      self ? el('span', { class: 'badge' }, 'you') : null),
    el('div', { class: 'meta' }, `Login ID: ${u.username} · added ${new Date(u.createdAt).toLocaleDateString()}`),
    el('div', { class: 'actions' },
      el('button', { class: 'btn', type: 'button', onclick: () => {
        const pw = prompt(`New password for ${u.displayName} (at least 8 characters):`);
        if (pw) patch({ password: pw }, 'Password reset. They will need to sign in again.');
      } }, 'Reset password'),
      el('button', { class: 'btn', type: 'button', onclick: () => {
        const name = prompt('Name shown on their pages:', u.displayName);
        if (name && name.trim()) patch({ displayName: name.trim() }, 'Name updated');
      } }, 'Rename'),
      self ? null : el('button', { class: 'btn', type: 'button', onclick: () => patch({ isAdmin: !u.isAdmin }, 'Updated') },
        u.isAdmin ? 'Remove manage rights' : 'Allow managing people'),
      self ? null : el('button', { class: `btn${u.disabled ? '' : ' btn-danger'}`, type: 'button', onclick: () => {
        if (u.disabled || confirm(`Remove ${u.displayName}'s access? Their pages are kept and you can restore access later.`)) {
          patch({ disabled: !u.disabled }, u.disabled ? 'Access restored' : 'Access removed');
        }
      } }, u.disabled ? 'Restore access' : 'Remove access'),
    ),
  );
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = form.querySelector('.form-error');
  err.hidden = true;
  const data = Object.fromEntries(new FormData(form));
  data.isAdmin = !!data.isAdmin;
  try {
    await api('/api/admin/users', { method: 'POST', body: data });
    toast(`${data.displayName} can now open the diary with login ID "${data.username}".`, 6000);
    form.reset();
    load();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

(async () => {
  me = (await api('/api/me')).user;
  await load();
})();
