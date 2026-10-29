import { api } from './common.js';

const form = document.getElementById('login-form');
const error = document.getElementById('login-error');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  error.hidden = true;
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    await api('/api/login', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
    location.href = '/';
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
    button.disabled = false;
  }
});
