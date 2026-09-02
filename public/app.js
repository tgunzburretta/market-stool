const appEl = document.getElementById('app');

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const body = isJson ? await res.json() : null;
  if (!res.ok) {
    const err = new Error((body && body.error) || `Request failed (${res.status})`);
    err.details = body;
    throw err;
  }
  return body;
}

function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function navigate(hash) {
  window.location.hash = hash;
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);

function route() {
  const hash = window.location.hash || '#/';
  const jobMatch = hash.match(/^#\/job\/(.+)$/);
  if (jobMatch) {
    renderJob(jobMatch[1]);
  } else if (hash === '#/new-property') {
    renderNewProperty();
  } else {
    renderHome();
  }
}

// ---------- Home ----------

async function renderHome() {
  appEl.innerHTML = `<div class="card"><p class="meta">Loading properties…</p></div>`;
  let properties;
  try {
    properties = await api('/api/properties');
  } catch (err) {
    appEl.innerHTML = `<div class="card"><p class="error">${err.message}</p></div>`;
    return;
  }

  const cards = properties
    .map(
      (p) => `
      <div class="card">
        <h2>${escapeHtml(p.name)}</h2>
        <p class="meta">${escapeHtml(p.address)}</p>
        <p class="meta">Host: ${escapeHtml(p.hostName || '—')} · ${escapeHtml(p.hostEmail)}</p>
        <p class="meta">${p.checklist.length} checklist items</p>
        <div class="field" style="margin-top:10px;">
          <label>Cleaner name</label>
          <input type="text" class="cleaner-name" placeholder="Your name" />
        </div>
        <button class="btn block start-btn" data-property="${p.id}">Start changeover</button>
        <p class="error start-error" data-property-error="${p.id}"></p>
      </div>
    `
    )
    .join('');

  appEl.innerHTML = `
    ${cards || '<div class="card"><p class="meta">No properties yet — add one to get started.</p></div>'}
    <div class="card">
      <button class="btn secondary block" id="add-property-btn">+ Add a property</button>
    </div>
  `;

  document.getElementById('add-property-btn').addEventListener('click', () => navigate('#/new-property'));

  appEl.querySelectorAll('.start-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const propertyId = btn.dataset.property;
      const card = btn.closest('.card');
      const cleanerName = card.querySelector('.cleaner-name').value.trim();
      const errorEl = card.querySelector('.start-error');
      errorEl.textContent = '';
      if (!cleanerName) {
        errorEl.textContent = 'Enter the cleaner name to start.';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Starting…';
      try {
        const job = await api('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ propertyId, cleanerName }),
        });
        navigate(`#/job/${job.id}`);
      } catch (err) {
        errorEl.textContent = err.message;
        btn.disabled = false;
        btn.textContent = 'Start changeover';
      }
    });
  });
}

// ---------- New property ----------

function renderNewProperty() {
  appEl.innerHTML = `
    <div class="card">
      <h2>Add a property</h2>
      <p class="meta">Set up the checklist once — every changeover reuses it.</p>
      <div class="field">
        <label>Property name</label>
        <input type="text" id="f-name" placeholder="e.g. Riverside Loft" />
      </div>
      <div class="field">
        <label>Address</label>
        <input type="text" id="f-address" placeholder="Street, city, postcode" />
      </div>
      <div class="field">
        <label>Host name</label>
        <input type="text" id="f-hostname" placeholder="e.g. Priya Shah" />
      </div>
      <div class="field">
        <label>Host email (report goes here)</label>
        <input type="email" id="f-hostemail" placeholder="host@example.com" />
      </div>
      <div class="field">
        <label>Checklist — one item per line</label>
        <textarea id="f-checklist" class="checklist-input" placeholder="Kitchen surfaces wiped\nBathroom cleaned\nBeds made with fresh linen"></textarea>
      </div>
      <p class="error" id="f-error"></p>
      <div class="row">
        <button class="btn" id="f-save">Save property</button>
        <button class="btn secondary" id="f-cancel">Cancel</button>
      </div>
    </div>
  `;

  document.getElementById('f-cancel').addEventListener('click', () => navigate('#/'));
  document.getElementById('f-save').addEventListener('click', async () => {
    const name = document.getElementById('f-name').value.trim();
    const address = document.getElementById('f-address').value.trim();
    const hostName = document.getElementById('f-hostname').value.trim();
    const hostEmail = document.getElementById('f-hostemail').value.trim();
    const checklist = document
      .getElementById('f-checklist')
      .value.split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const errorEl = document.getElementById('f-error');
    errorEl.textContent = '';

    try {
      await api('/api/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, address, hostName, hostEmail, checklist }),
      });
      navigate('#/');
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}

// ---------- Job (checklist) ----------

async function renderJob(jobId) {
  appEl.innerHTML = `<div class="card"><p class="meta">Loading job…</p></div>`;
  let job, property;
  try {
    job = await api(`/api/jobs/${jobId}`);
    property = await api(`/api/properties/${job.propertyId}`);
  } catch (err) {
    appEl.innerHTML = `<div class="card"><p class="error">${err.message}</p></div>`;
    return;
  }

  if (job.status === 'completed') {
    renderCompleted(job, property);
    return;
  }

  const doneCount = job.items.filter((i) => i.done && i.afterPhoto).length;
  const pct = Math.round((doneCount / job.items.length) * 100);

  appEl.innerHTML = `
    <div class="card">
      <h2>${escapeHtml(property.name)}</h2>
      <p class="meta">${escapeHtml(property.address)}</p>
      <p class="meta">Cleaner: ${escapeHtml(job.cleanerName)} · Started ${fmtTime(job.startedAt)}</p>
      <div class="progress-bar"><div style="width:${pct}%"></div></div>
      <p class="meta">${doneCount} / ${job.items.length} items complete</p>
    </div>
    <div id="items"></div>
    <div class="card">
      <button class="btn block" id="complete-btn" ${doneCount === job.items.length ? '' : 'disabled'}>
        Complete &amp; send report to host
      </button>
      <p class="error" id="complete-error"></p>
    </div>
  `;

  const itemsEl = document.getElementById('items');
  job.items.forEach((item, index) => {
    itemsEl.appendChild(renderItem(job.id, item, index));
  });

  document.getElementById('complete-btn').addEventListener('click', async () => {
    const btn = document.getElementById('complete-btn');
    const errorEl = document.getElementById('complete-error');
    errorEl.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Generating report…';
    try {
      const completed = await api(`/api/jobs/${job.id}/complete`, { method: 'POST' });
      renderCompleted(completed, property);
    } catch (err) {
      errorEl.textContent = err.message;
      btn.disabled = false;
      btn.textContent = 'Complete & send report to host';
    }
  });
}

function renderItem(jobId, item, index) {
  const wrap = document.createElement('div');
  wrap.className = `checklist-item ${item.done ? 'done' : ''}`;
  wrap.innerHTML = `
    <div class="spread">
      <h3>${index + 1}. ${escapeHtml(item.name)}</h3>
      <span class="badge ${item.done ? 'done' : 'pending'}">${item.done ? 'Done' : 'Pending'}</span>
    </div>
    <div class="photo-row">
      ${photoSlot('before', item.beforePhotoUrl, item.beforePhotoAt)}
      ${photoSlot('after', item.afterPhotoUrl, item.afterPhotoAt)}
    </div>
    <div class="field">
      <label>Notes (optional)</label>
      <input type="text" class="notes-input" value="${escapeAttr(item.notes || '')}" placeholder="Anything the host should know" />
    </div>
    <label class="row" style="cursor:pointer;">
      <input type="checkbox" class="done-checkbox" ${item.done ? 'checked' : ''} />
      Mark as done
    </label>
    <p class="error item-error"></p>
  `;

  ['before', 'after'].forEach((type) => {
    const input = wrap.querySelector(`input[data-type="${type}"]`);
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const errorEl = wrap.querySelector('.item-error');
      errorEl.textContent = '';
      const form = new FormData();
      form.append('photo', file);
      form.append('type', type);
      try {
        await api(`/api/jobs/${jobId}/items/${index}/photo`, { method: 'POST', body: form });
        renderJob(jobId);
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });
  });

  const notesInput = wrap.querySelector('.notes-input');
  notesInput.addEventListener('change', () => {
    patchItem(jobId, index, { notes: notesInput.value });
  });

  const doneCheckbox = wrap.querySelector('.done-checkbox');
  doneCheckbox.addEventListener('change', async () => {
    const errorEl = wrap.querySelector('.item-error');
    if (doneCheckbox.checked && !item.afterPhoto) {
      errorEl.textContent = 'Add an "after" photo before marking this done.';
      doneCheckbox.checked = false;
      return;
    }
    await patchItem(jobId, index, { done: doneCheckbox.checked });
    renderJob(jobId);
  });

  return wrap;
}

async function patchItem(jobId, index, payload) {
  try {
    await api(`/api/jobs/${jobId}/items/${index}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(err);
  }
}

function photoSlot(type, url, at) {
  const label = type === 'before' ? 'Before' : 'After';
  const image = url
    ? `<img src="${url}" alt="${label} photo" />`
    : `<div class="placeholder">Tap to add</div>`;
  const stamp = at ? `<p class="meta" style="font-size:11px;">${fmtTime(at)}</p>` : '';
  return `
    <div class="photo-slot">
      <label style="cursor:pointer;">
        ${image}
        <label>${label}</label>
        <input type="file" accept="image/*" capture="environment" data-type="${type}" />
      </label>
      ${stamp}
    </div>
  `;
}

function renderCompleted(job, property) {
  appEl.innerHTML = `
    <div class="card success">
      <h2>Report sent ✅</h2>
      <p class="meta">${escapeHtml(property.name)} · ${escapeHtml(job.cleanerName)}</p>
      <p class="meta">Completed ${fmtTime(job.completedAt)}</p>
      ${
        job.emailSent
          ? `<p>The timestamped PDF report was emailed to <strong>${escapeHtml(property.hostEmail)}</strong>.</p>`
          : `<p>Report generated. Email delivery isn't configured on this server, so download it below and forward it to <strong>${escapeHtml(
              property.hostEmail
            )}</strong> yourself.</p>`
      }
      <a class="btn block" href="${job.pdfUrl}" target="_blank" rel="noopener">View / download PDF report</a>
    </div>
    <div class="card">
      <button class="btn secondary block" id="back-home">Back to properties</button>
    </div>
  `;
  document.getElementById('back-home').addEventListener('click', () => navigate('#/'));
}

// ---------- utils ----------

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}
