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

function fmtDate(iso) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function navigate(hash) {
  window.location.hash = hash;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function stalePill(listing) {
  return listing.lastRefreshedAt
    ? `<span class="stale-pill">Refreshed ${fmtDate(listing.lastRefreshedAt)}</span>`
    : `<span class="stale-pill never">Never refreshed</span>`;
}

function tagPills(tags, cls = '') {
  return tags.map((t) => `<span class="tag-pill ${cls}">${escapeHtml(t)}</span>`).join('');
}

// First line of a description is what shows in Etsy search results — the rest is
// preserved as-is when a rewrite is saved back.
function splitDescription(description) {
  const text = description || '';
  const idx = text.indexOf('\n');
  if (idx === -1) return { firstLine: text, rest: '' };
  return { firstLine: text.slice(0, idx), rest: text.slice(idx + 1) };
}

async function seasonalBannerHtml() {
  try {
    const { keywords } = await api('/api/seasonal');
    return `<div class="seasonal-banner"><strong>This month's angle:</strong> ${keywords.map(escapeHtml).join(' · ')} — weave one of these into titles, tags or first lines while it's relevant.</div>`;
  } catch (err) {
    return '';
  }
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);

function route() {
  const hash = window.location.hash || '#/';
  const refreshMatch = hash.match(/^#\/refresh\/(.+)$/);

  let activeTab = hash;
  if (refreshMatch) activeTab = '/listings';

  document.querySelectorAll('.tabs a').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === activeTab.replace(/^#/, ''));
  });

  if (refreshMatch) {
    renderRefreshWorkspace(refreshMatch[1]);
  } else if (hash === '#/listings') {
    renderListings();
  } else if (hash === '#/rewrite') {
    renderRewriteTool();
  } else {
    renderQueue();
  }
}

// ---------- This week's queue ----------

async function renderQueue() {
  appEl.innerHTML = `<div class="card"><p class="meta">Loading this week's queue…</p></div>`;
  let queue, banner;
  try {
    [queue, banner] = await Promise.all([api('/api/queue'), seasonalBannerHtml()]);
  } catch (err) {
    appEl.innerHTML = `<div class="card"><p class="error">${escapeHtml(err.message)}</p></div>`;
    return;
  }

  const total = queue.listings.length;
  const pct = total ? Math.round((queue.refreshedCount / total) * 100) : 0;

  if (total === 0) {
    appEl.innerHTML = `
      ${banner}
      <div class="card">
        <h2>No listings yet</h2>
        <p class="meta">Add your listings and a weekly queue of the 5 stalest ones will show up here.</p>
        <button class="btn block" id="go-listings">Add listings</button>
      </div>
    `;
    document.getElementById('go-listings').addEventListener('click', () => navigate('#/listings'));
    return;
  }

  const cards = queue.listings
    .map(
      (l) => `
      <div class="card">
        <div class="spread">
          <h2>${escapeHtml(l.title)}</h2>
          ${stalePill(l)}
        </div>
        <p class="meta">${escapeHtml(l.category || 'Uncategorised')} · ${l.tags.length} tags</p>
        <div class="row wrap" style="margin: 8px 0;">${tagPills(l.tags)}</div>
        <button class="btn block" data-refresh="${l.id}">Refresh this listing</button>
      </div>
    `
    )
    .join('');

  appEl.innerHTML = `
    ${banner}
    <div class="card">
      <h2>Week ${queue.week.split('-W')[1]} queue</h2>
      <p class="meta">${queue.refreshedCount} of ${total} refreshed this week</p>
      <div class="progress-bar"><div style="width:${pct}%"></div></div>
      ${total > 0 && queue.refreshedCount === total ? '<p class="success" style="margin-top:10px;">All caught up for this week. New picks land next week.</p>' : ''}
    </div>
    ${cards}
  `;

  appEl.querySelectorAll('[data-refresh]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(`#/refresh/${btn.dataset.refresh}`));
  });
}

// ---------- All listings ----------

async function renderListings() {
  appEl.innerHTML = `<div class="card"><p class="meta">Loading listings…</p></div>`;
  let listings;
  try {
    listings = await api('/api/listings');
  } catch (err) {
    appEl.innerHTML = `<div class="card"><p class="error">${escapeHtml(err.message)}</p></div>`;
    return;
  }

  const rows = listings
    .map(
      (l) => `
      <div class="card">
        <div class="spread">
          <h2>${escapeHtml(l.title)}</h2>
          ${stalePill(l)}
        </div>
        <p class="meta">${escapeHtml(l.category || 'Uncategorised')} · created ${fmtDate(l.createdAt)}</p>
        <div class="row wrap" style="margin: 8px 0;">${tagPills(l.tags)}</div>
        <div class="row">
          <button class="btn small" data-refresh="${l.id}">Refresh</button>
          <button class="link-btn" data-delete="${l.id}">Delete</button>
        </div>
      </div>
    `
    )
    .join('');

  appEl.innerHTML = `
    <div class="card">
      <h2>Add a listing</h2>
      <p class="meta">Paste in what's live on Etsy today — you'll rewrite it later from the queue or right here.</p>
      <div class="field">
        <label>Title</label>
        <input type="text" id="f-title" placeholder="e.g. Personalised Dog Mum Sweatshirt" />
      </div>
      <div class="field">
        <label>Tags (comma-separated)</label>
        <input type="text" id="f-tags" placeholder="dog mum gift, personalised jumper, ..." />
      </div>
      <div class="field">
        <label>Description</label>
        <textarea id="f-description" placeholder="First line matters most — it's what shows in search."></textarea>
      </div>
      <div class="field">
        <label>Category (optional)</label>
        <input type="text" id="f-category" placeholder="e.g. Apparel" />
      </div>
      <p class="error" id="f-error"></p>
      <button class="btn block" id="f-save">Save listing</button>
    </div>
    ${rows || '<div class="card"><p class="meta">No listings yet.</p></div>'}
  `;

  document.getElementById('f-save').addEventListener('click', async () => {
    const title = document.getElementById('f-title').value.trim();
    const tags = document.getElementById('f-tags').value;
    const description = document.getElementById('f-description').value.trim();
    const category = document.getElementById('f-category').value.trim();
    const errorEl = document.getElementById('f-error');
    errorEl.textContent = '';
    if (!title) {
      errorEl.textContent = 'Title is required.';
      return;
    }
    try {
      await api('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, tags, description, category }),
      });
      renderListings();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });

  appEl.querySelectorAll('[data-refresh]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(`#/refresh/${btn.dataset.refresh}`));
  });

  appEl.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this listing?')) return;
      try {
        await api(`/api/listings/${btn.dataset.delete}`, { method: 'DELETE' });
        renderListings();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

// ---------- Standalone rewrite tool ----------

function rewriteResultHtml(original, rewrite) {
  return `
    <div class="card">
      <h2>Suggested rewrite</h2>
      <div class="compare">
        <div class="compare-col">
          <h4>Original title</h4>
          <div class="text-block">${escapeHtml(original.title)}</div>
        </div>
        <div class="compare-col after">
          <h4>Rewritten title</h4>
          <div class="text-block">${escapeHtml(rewrite.title)}</div>
        </div>
      </div>
      <div class="compare" style="margin-top:12px;">
        <div class="compare-col">
          <h4>Original tags</h4>
          <div class="text-block">${tagPills(original.tags) || '<span class="meta">None</span>'}</div>
        </div>
        <div class="compare-col after">
          <h4>Rewritten tags</h4>
          <div class="text-block">${tagPills(rewrite.tags, 'new')}</div>
        </div>
      </div>
      <div class="compare" style="margin-top:12px;">
        <div class="compare-col">
          <h4>Original first line</h4>
          <div class="text-block">${escapeHtml(splitDescription(original.description).firstLine) || '<span class="meta">None</span>'}</div>
        </div>
        <div class="compare-col after">
          <h4>Rewritten first line</h4>
          <div class="text-block">${escapeHtml(rewrite.firstLine)}</div>
        </div>
      </div>
      <div class="seasonal-banner" style="margin-top:14px;">
        <strong>Seasonal keyword prompts:</strong> ${rewrite.seasonalKeywords.map(escapeHtml).join(' · ')}
      </div>
    </div>
  `;
}

async function renderRewriteTool() {
  appEl.innerHTML = `
    <div class="card">
      <h2>Rewrite tool</h2>
      <p class="meta">Paste any listing — saved or not — and get a rewritten title, tags and opening line back.</p>
      <div class="field">
        <label>Title</label>
        <input type="text" id="f-title" placeholder="Paste the current listing title" />
      </div>
      <div class="field">
        <label>Tags (comma-separated)</label>
        <input type="text" id="f-tags" placeholder="Paste the current tags" />
      </div>
      <div class="field">
        <label>Description</label>
        <textarea id="f-description" placeholder="Paste the current description"></textarea>
      </div>
      <p class="error" id="f-error"></p>
      <button class="btn block" id="f-generate">Generate rewrite</button>
    </div>
    <div id="result"></div>
  `;

  document.getElementById('f-generate').addEventListener('click', async () => {
    const title = document.getElementById('f-title').value.trim();
    const tags = document.getElementById('f-tags').value;
    const description = document.getElementById('f-description').value.trim();
    const errorEl = document.getElementById('f-error');
    errorEl.textContent = '';
    if (!title) {
      errorEl.textContent = 'Title is required.';
      return;
    }

    const btn = document.getElementById('f-generate');
    btn.disabled = true;
    btn.textContent = 'Generating…';
    try {
      const rewrite = await api('/api/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, tags, description }),
      });
      const resultEl = document.getElementById('result');
      resultEl.innerHTML =
        rewriteResultHtml({ title, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), description }, rewrite) +
        `<div class="card"><button class="btn secondary block" id="save-as-listing">Save as a new listing</button></div>`;

      document.getElementById('save-as-listing').addEventListener('click', async () => {
        const { rest } = splitDescription(description);
        const newDescription = rest ? `${rewrite.firstLine}\n${rest}` : rewrite.firstLine;
        try {
          const listing = await api('/api/listings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: rewrite.title, tags: rewrite.tags, description: newDescription }),
          });
          await api(`/api/listings/${listing.id}/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: rewrite.title, tags: rewrite.tags, description: newDescription }),
          });
          navigate('#/listings');
        } catch (err) {
          alert(err.message);
        }
      });
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate rewrite';
    }
  });
}

// ---------- Refresh workspace for a saved listing ----------

async function renderRefreshWorkspace(id) {
  appEl.innerHTML = `<div class="card"><p class="meta">Loading listing…</p></div>`;
  let listing, rewrite;
  try {
    listing = await api(`/api/listings/${id}`);
    rewrite = await api('/api/rewrite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: listing.title, tags: listing.tags, description: listing.description }),
    });
  } catch (err) {
    appEl.innerHTML = `<div class="card"><p class="error">${escapeHtml(err.message)}</p></div>`;
    return;
  }

  const { rest } = splitDescription(listing.description);
  const composedDescription = rest ? `${rewrite.firstLine}\n${rest}` : rewrite.firstLine;

  appEl.innerHTML = `
    <div class="card">
      <h2>Refresh: ${escapeHtml(listing.title)}</h2>
      <p class="meta">${listing.lastRefreshedAt ? `Last refreshed ${fmtDate(listing.lastRefreshedAt)}` : 'Never refreshed'}</p>
    </div>
    ${rewriteResultHtml(listing, rewrite)}
    <div class="card">
      <h2>Save this refresh</h2>
      <p class="meta">Tweak anything below before saving — this becomes the listing's new title, tags and description.</p>
      <div class="field">
        <label>Title</label>
        <input type="text" id="e-title" value="${escapeHtml(rewrite.title)}" />
      </div>
      <div class="field">
        <label>Tags (comma-separated)</label>
        <input type="text" id="e-tags" value="${escapeHtml(rewrite.tags.join(', '))}" />
      </div>
      <div class="field">
        <label>Description</label>
        <textarea id="e-description">${escapeHtml(composedDescription)}</textarea>
      </div>
      <p class="error" id="e-error"></p>
      <div class="row">
        <button class="btn" id="e-save">Save refresh</button>
        <button class="btn secondary" id="e-cancel">Cancel</button>
      </div>
    </div>
  `;

  document.getElementById('e-cancel').addEventListener('click', () => navigate('#/'));
  document.getElementById('e-save').addEventListener('click', async () => {
    const title = document.getElementById('e-title').value.trim();
    const tags = document.getElementById('e-tags').value;
    const description = document.getElementById('e-description').value.trim();
    const errorEl = document.getElementById('e-error');
    errorEl.textContent = '';
    if (!title) {
      errorEl.textContent = 'Title is required.';
      return;
    }
    try {
      await api(`/api/listings/${id}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, tags, description }),
      });
      navigate('#/');
    } catch (err) {
      errorEl.textContent = err.message;
    }
  });
}
