/* DrawMyTrip – map of trip locations, grouped by day.
 * Data lives in data/locations.json. Edits made here stay in this browser
 * until you export the text and push it to the repo. */
(() => {
  'use strict';

  // Free CARTO basemap key (https://carto.com/basemaps/apikey). It is visible to anyone
  // who opens the page, which is normal for map keys; restrict it to your site in CARTO.
  const CARTO_KEY = 'cb1_5dej_1_f11e974b0c898bc06d747c16';
  const DATA_URL = 'data/locations.json';
  const DRAFT_KEY = 'drawmytrip:draft:v1';
  const UNASSIGNED_COLOR = '#FF3D8B';
  const DAY_COLORS = ['#2EE6F6', '#B8F33A', '#FFB224', '#9C7CFF', '#FF6B3D', '#4DA3FF', '#3CF2A6', '#F5E663'];
  const BEST_TIMES = ['Morning', 'Afternoon', 'Evening', 'Any'];
  const PRIORITIES = ['Must', 'Nice', 'Maybe'];
  const NEAREST_LINES = 3;

  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const serialize = (d) => JSON.stringify(d, null, 2) + '\n';

  const state = {
    data: null,          // the JSON object, edited in place
    baseNorm: '',        // file contents as last loaded (normalised)
    baseLocs: [],        // per-location JSON from the file, to spot edits
    selectedKey: null,
    activeDay: 'all',    // 'all' | 'none' (unassigned) | day number
  };
  let nextKey = 1;

  /* ---------- Geometry ---------- */
  function distanceKm(a, b) {
    const R = 6371, rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const fmtKm = (d) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`);
  const hasCoords = (l) => Number.isFinite(l.lat) && Number.isFinite(l.lng);
  const fmtHours = (h) => (Math.round(h * 10) / 10).toString();

  /* ---------- Data helpers ---------- */
  const locs = () => state.data.locations;
  const keyOf = (l) => l.__key;
  const byKey = (k) => locs().find((l) => l.__key === k);
  const dayOf = (l) => (Number.isInteger(l.day) && l.day > 0 ? l.day : null);
  const anyDays = () => locs().some((l) => dayOf(l));
  const hoursOf = (l) => (Number.isFinite(l.hours) ? l.hours : 0);
  const hoursPerDay = () => Number(state.data.trip?.hoursPerDay) || null;

  function tagKeys() {
    // Internal key that is NOT written to the exported JSON (non-enumerable).
    for (const l of locs()) {
      if (!l.__key) Object.defineProperty(l, '__key', { value: nextKey++, enumerable: false });
    }
  }

  function dayCount() {
    const fromTrip = Number(state.data.trip?.days) || 0;
    return Math.max(fromTrip, 0, ...locs().map((l) => dayOf(l) || 0));
  }
  const dayColor = (d) => (d ? DAY_COLORS[(d - 1) % DAY_COLORS.length] : UNASSIGNED_COLOR);
  const colorOf = (l) => dayColor(dayOf(l));

  function dayDate(d) {
    const s = state.data.trip?.startDate;
    if (!s) return '';
    const dt = new Date(`${s}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return '';
    dt.setDate(dt.getDate() + d - 1);
    return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  // Stops of a day (null = unassigned), in visiting order:
  // explicit "order" first, then best time of day, then file order.
  function stopsOf(day) {
    const rank = (l) => {
      const i = BEST_TIMES.indexOf(l.bestTime);
      return i === -1 ? BEST_TIMES.length : i;
    };
    return locs()
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => (day === null ? !dayOf(l) : dayOf(l) === day))
      .sort((a, b) => {
        const oa = Number.isFinite(a.l.order) ? a.l.order : Infinity;
        const ob = Number.isFinite(b.l.order) ? b.l.order : Infinity;
        if (oa !== ob) return oa - ob;
        if (rank(a.l) !== rank(b.l)) return rank(a.l) - rank(b.l);
        return a.i - b.i;
      })
      .map(({ l }) => l);
  }
  const stopNumber = (l) => (dayOf(l) ? stopsOf(dayOf(l)).indexOf(l) + 1 : null);

  function routeKm(stops) {
    const pts = stops.filter(hasCoords);
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += distanceKm(pts[i - 1], pts[i]);
    return total;
  }

  function isActive(l) {
    if (state.activeDay === 'all') return true;
    if (state.activeDay === 'none') return !dayOf(l);
    return dayOf(l) === state.activeDay;
  }

  function changedCount() {
    return locs().filter((l, i) => JSON.stringify(l) !== state.baseLocs[i]).length
      + Math.max(0, state.baseLocs.length - locs().length);
  }
  const isDirty = () => serialize(state.data) !== state.baseNorm;

  /* ---------- Draft (unsaved edits kept in this browser) ---------- */
  function saveDraft() {
    try {
      if (isDirty()) localStorage.setItem(DRAFT_KEY, JSON.stringify({ base: state.baseNorm, data: state.data }));
      else localStorage.removeItem(DRAFT_KEY);
    } catch (_) { /* storage unavailable: edits live until reload */ }
  }
  function readDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (_) { return null; }
  }
  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* ignore */ }
  }

  /* ---------- Map ---------- */
  const map = L.map('map', { zoomControl: false, preferCanvas: false }).setView([13.75, 100.52], 12);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  // Standard 256px tiles only (no "@2x" high-DPI tiles, which are ~4x the download),
  // fetched only for the area on screen once panning/zooming stops.
  // Added to the map after the first fit, so the default view's tiles aren't fetched for nothing.
  const tiles = L.tileLayer(`https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${CARTO_KEY}`, {
    maxZoom: 20,
    updateWhenZooming: false,
    updateWhenIdle: true,
    keepBuffer: 1,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  });
  const routeLayer = L.layerGroup().addTo(map);
  const linkLayer = L.layerGroup().addTo(map);
  const pinLayer = L.layerGroup().addTo(map);

  map.on('click', () => { if (state.selectedKey) select(null); });

  function kmTag(a, b, color) {
    const mid = [(a.lat + b.lat) / 2, (a.lng + b.lng) / 2];
    return L.marker(mid, {
      interactive: false, keyboard: false, zIndexOffset: 500,
      icon: L.divIcon({ className: 'km-tag', html: `<span style="--c:${color}">${fmtKm(distanceKm(a, b))}</span>`, iconSize: [0, 0] }),
    });
  }

  function renderMap() {
    routeLayer.clearLayers();
    linkLayer.clearLayers();
    pinLayer.clearLayers();
    const sel = state.selectedKey ? byKey(state.selectedKey) : null;

    // Day routes, straight lines in visiting order
    if (anyDays()) {
      for (let d = 1; d <= dayCount(); d++) {
        const pts = stopsOf(d).filter(hasCoords);
        if (pts.length < 2) continue;
        const live = state.activeDay === d;
        if (!live && state.activeDay !== 'all') continue;
        const latlngs = pts.map((l) => [l.lat, l.lng]);
        if (live) {
          L.polyline(latlngs, { color: dayColor(d), weight: 10, opacity: 0.18, interactive: false }).addTo(routeLayer);
          L.polyline(latlngs, { color: dayColor(d), weight: 3.5, opacity: 1, className: 'route-live', interactive: false }).addTo(routeLayer);
          for (let i = 1; i < pts.length; i++) kmTag(pts[i - 1], pts[i], dayColor(d)).addTo(routeLayer);
        } else {
          L.polyline(latlngs, { color: dayColor(d), weight: 2, opacity: 0.5, interactive: false }).addTo(routeLayer);
        }
      }
    }

    // Selected stop: lines to its nearest neighbours
    if (sel && hasCoords(sel)) {
      locs()
        .filter((l) => l !== sel && hasCoords(l))
        .map((l) => ({ l, d: distanceKm(sel, l) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, NEAREST_LINES)
        .forEach(({ l }) => {
          L.polyline([[sel.lat, sel.lng], [l.lat, l.lng]], { color: '#ffffff', weight: 1.5, opacity: 0.75, dashArray: '4 6', interactive: false }).addTo(linkLayer);
          kmTag(sel, l, '#ffffff').addTo(linkLayer);
        });
    }

    // Pins
    const focusMode = state.activeDay !== 'all';
    for (const l of locs()) {
      if (!hasCoords(l)) continue;
      const active = isActive(l);
      const selected = l === sel;
      const num = stopNumber(l);
      const cls = ['blip', active ? '' : 'is-dim', selected ? 'is-selected' : ''].join(' ').trim();
      const marker = L.marker([l.lat, l.lng], {
        icon: L.divIcon({
          className: 'blip-wrap',
          html: `<div class="${cls}" style="--c:${colorOf(l)}"><span>${num ?? ''}</span></div>`,
          iconSize: [28, 28], iconAnchor: [14, 14],
        }),
        title: l.name || 'Untitled stop',
        alt: l.name || 'Untitled stop',
        riseOnHover: true,
        zIndexOffset: selected ? 1000 : active ? 200 : 0,
        draggable: selected,
        autoPan: true,
      });
      marker.bindTooltip(esc(l.name || 'Untitled stop'), {
        direction: 'right', offset: [14, 0], className: `name-tag${active ? '' : ' is-dim'}`,
        permanent: selected || (focusMode && active),
      });
      marker.on('add', () => {
        const tip = marker.getTooltip()?.getElement();
        if (tip) tip.style.setProperty('--c', colorOf(l));
      });
      marker.on('tooltipopen', (e) => e.tooltip.getElement()?.style.setProperty('--c', colorOf(l)));
      marker.on('click', (e) => { L.DomEvent.stopPropagation(e); select(l === sel ? null : keyOf(l)); });
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        l.lat = Math.round(p.lat * 1e6) / 1e6;
        l.lng = Math.round(p.lng * 1e6) / 1e6;
        commit();
        syncCoordInputs(l);
        toast('Pin moved');
      });
      marker.addTo(pinLayer);
    }
  }

  function fitTo(list, animate = true) {
    const pts = list.filter(hasCoords).map((l) => [l.lat, l.lng]);
    if (!pts.length) return;
    const small = window.matchMedia('(max-width: 860px)').matches;
    const opts = {
      paddingTopLeft: small ? [24, 210] : [60, 230],
      paddingBottomRight: small ? [24, 80] : [60, 120],
      maxZoom: 15, animate, duration: 0.6,
    };
    if (pts.length === 1) map.flyTo(pts[0], 15, { duration: animate ? 0.6 : 0 });
    else if (animate) map.flyToBounds(pts, opts);
    else map.fitBounds(pts, opts);
  }

  /* ---------- HUD: title, stats, day bar ---------- */
  function renderTitle() {
    const t = state.data.trip || {};
    $('#tripName').textContent = t.name || 'My trip';
    document.title = `${t.name || 'My trip'} · DrawMyTrip`;
    const n = dayCount();
    if (t.startDate && n) {
      const first = dayDate(1), last = dayDate(n);
      $('#tripDates').textContent = n > 1 ? `${first} to ${last}  ·  ${n} days` : first;
    } else {
      $('#tripDates').textContent = '';
    }
  }

  function stat(value, label, { unit = '', accent, over = false } = {}) {
    return `<div class="stat${over ? ' is-over' : ''}" style="${accent ? `--accent:${accent}` : ''}"><b>${value}${unit ? `<small>${unit}</small>` : ''}</b><span>${label}</span></div>`;
  }

  function renderStats() {
    const el = $('#stats');
    const a = state.activeDay;
    const cap = hoursPerDay();
    if (typeof a === 'number') {
      const stops = stopsOf(a);
      const hrs = stops.reduce((s, l) => s + hoursOf(l), 0);
      const over = cap && hrs > cap;
      el.innerHTML =
        stat(stops.length, 'Stops', { accent: dayColor(a) }) +
        stat(fmtHours(hrs), cap ? `Hours, of ${cap} a day` : 'Hours', { unit: 'h', accent: dayColor(a), over }) +
        stat(routeKm(stops).toFixed(1), 'Route', { unit: 'km', accent: dayColor(a) }) +
        `<p class="stat-note">Straight-line distance between stops, in visiting order</p>`;
    } else if (a === 'none') {
      const stops = stopsOf(null);
      el.innerHTML =
        stat(stops.length, 'Unassigned') +
        stat(fmtHours(stops.reduce((s, l) => s + hoursOf(l), 0)), 'Hours', { unit: 'h' });
    } else {
      const all = locs();
      const hrs = all.reduce((s, l) => s + hoursOf(l), 0);
      const unassigned = all.filter((l) => !dayOf(l)).length;
      let html = stat(all.length, 'Stops') + stat(fmtHours(hrs), 'Hours', { unit: 'h' });
      if (anyDays()) {
        let km = 0;
        for (let d = 1; d <= dayCount(); d++) km += routeKm(stopsOf(d));
        html += stat(km.toFixed(1), 'All routes', { unit: 'km' }) + stat(unassigned, 'Unassigned');
      } else {
        html += stat(unassigned, 'Without a day');
      }
      el.innerHTML = html;
    }
  }

  function dayOptions() {
    const opts = [{ v: 'all', name: 'All days', meta: `${locs().length} stops`, c: '#ECF1F8' }];
    for (let d = 1; d <= dayCount(); d++) {
      const n = stopsOf(d).length;
      opts.push({ v: d, name: `Day ${d}`, meta: [dayDate(d), `${n} stop${n === 1 ? '' : 's'}`].filter(Boolean).join(' · '), c: dayColor(d) });
    }
    const un = stopsOf(null).length;
    if (un) opts.push({ v: 'none', name: 'No day', meta: `${un} stop${un === 1 ? '' : 's'}`, c: UNASSIGNED_COLOR });
    return opts;
  }

  function renderDayBar() {
    const bar = $('#daybar');
    if (!anyDays()) {
      if (state.activeDay !== 'all') state.activeDay = 'all';
      bar.innerHTML = `<p class="day-hint">No days set yet. Open a stop in the list and pick its day to colour the map by day.</p>`;
      return;
    }
    const opts = dayOptions();
    if (!opts.some((o) => o.v === state.activeDay)) state.activeDay = 'all';
    bar.innerHTML =
      `<button class="keycap" data-step="-1" title="Previous day (Q)" aria-label="Previous day">Q</button>` +
      `<div class="daybar-scroll">` +
      opts.map((o) => `<button class="daychip" style="--c:${o.c}" data-day="${o.v}" aria-pressed="${o.v === state.activeDay}">` +
        `<span class="dc-name">${esc(o.name)}</span><span class="dc-meta">${esc(o.meta)}</span></button>`).join('') +
      `</div>` +
      `<button class="keycap" data-step="1" title="Next day (E)" aria-label="Next day">E</button>`;
  }

  $('#daybar').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-day]');
    if (chip) {
      const v = chip.dataset.day;
      setDay(v === 'all' || v === 'none' ? v : Number(v));
      return;
    }
    const step = e.target.closest('[data-step]');
    if (step) stepDay(Number(step.dataset.step));
  });

  function setDay(day, { fit = true } = {}) {
    state.activeDay = day;
    renderAll({ keepDetail: true });
    if (fit) fitTo(day === 'all' ? locs() : locs().filter(isActive));
    $('#daybar .daychip[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    if (!state.selectedKey) {
      const group = $(`#sideBody .group[data-group="${day}"]`);
      if (group) group.scrollIntoView({ block: 'start', behavior: 'smooth' });
      else $('#sideBody').scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function stepDay(dir) {
    if (!anyDays()) return;
    const opts = dayOptions().map((o) => o.v);
    const i = opts.indexOf(state.activeDay);
    setDay(opts[(i + dir + opts.length) % opts.length]);
  }

  /* ---------- Sidebar ---------- */
  function renderSideHead() {
    const n = changedCount();
    const dirty = isDirty();
    $('#sideHead').innerHTML =
      `<div class="side-head-row"><h2>Stops<small>${locs().length}</small></h2>` +
      `<button class="btn btn-primary${dirty ? ' is-pulsing' : ''}" id="exportBtn">Export data</button></div>` +
      `<p class="changes${dirty ? ' has-changes' : ''}">` +
      (dirty
        ? `${n || 'Some'} stop${n === 1 ? '' : 's'} edited. Export and push to keep the changes.<button class="link-btn" id="discardBtn">Discard</button>`
        : 'Matches data/locations.json') +
      `</p>`;
  }

  $('#sideHead').addEventListener('click', (e) => {
    if (e.target.closest('#exportBtn')) openExport();
    const discard = e.target.closest('#discardBtn');
    if (discard) {
      if (!discard.classList.contains('is-armed')) {
        discard.classList.add('is-armed');
        discard.textContent = 'Click again to discard';
        setTimeout(() => { if (discard.isConnected) { discard.classList.remove('is-armed'); discard.textContent = 'Discard'; } }, 3000);
        return;
      }
      discardEdits();
    }
  });

  function itemHtml(l) {
    const num = stopNumber(l);
    return `<button class="item${isActive(l) ? '' : ' is-dim'}" style="--c:${isActive(l) ? colorOf(l) : 'var(--dim)'}" data-key="${keyOf(l)}">` +
      `<span class="num"><span>${num ?? ''}</span></span>` +
      `<span class="t"><b>${esc(l.name || 'Untitled stop')}</b><small>${esc([l.zone, l.bestTime].filter(Boolean).join(' · '))}</small></span>` +
      `<span class="h">${Number.isFinite(l.hours) ? `${fmtHours(l.hours)}<small>h</small>` : '–'}</span></button>`;
  }

  function renderList() {
    const body = $('#sideBody');
    if (!locs().length) {
      body.innerHTML = `<p class="empty">No stops in data/locations.json yet. Add objects to the "locations" list and push.</p>`;
      return;
    }
    if (!anyDays()) {
      body.innerHTML = `<div class="group">${locs().map(itemHtml).join('')}</div>`;
      return;
    }
    const cap = hoursPerDay();
    let html = '';
    for (let d = 1; d <= dayCount(); d++) {
      const stops = stopsOf(d);
      const hrs = stops.reduce((s, l) => s + hoursOf(l), 0);
      const dim = state.activeDay !== 'all' && state.activeDay !== d;
      html += `<section class="group${dim ? ' is-dim' : ''}" data-group="${d}">` +
        `<div class="group-head" style="--c:${dayColor(d)}"><h3>Day ${d}</h3><p>${esc(dayDate(d))}</p>` +
        `<span class="gh-right${cap && hrs > cap ? ' is-over' : ''}">${fmtHours(hrs)}h · ${routeKm(stops).toFixed(1)} km</span></div>` +
        (stops.length ? stops.map(itemHtml).join('') : `<p class="empty" style="padding:8px 20px">Nothing planned yet.</p>`) +
        `</section>`;
    }
    const un = stopsOf(null);
    if (un.length) {
      const dim = state.activeDay !== 'all' && state.activeDay !== 'none';
      html += `<section class="group${dim ? ' is-dim' : ''}" data-group="none"><div class="group-head" style="--c:${UNASSIGNED_COLOR}"><h3>No day</h3><p>Pick a day for these</p>` +
        `<span class="gh-right">${un.length}</span></div>${un.map(itemHtml).join('')}</section>`;
    }
    body.innerHTML = html;
  }

  const FIELDS = [
    { key: 'name', label: 'Name', type: 'text', full: true },
    { key: 'day', label: 'Day', type: 'day' },
    { key: 'order', label: 'Stop order in the day', type: 'number', step: 1, min: 1, placeholder: 'Auto' },
    { key: 'hours', label: 'Hours to spend', type: 'number', step: 0.5, min: 0 },
    { key: 'priority', label: 'Priority', type: 'select', options: PRIORITIES },
    { key: 'bestTime', label: 'Best time', type: 'select', options: BEST_TIMES },
    { key: 'category', label: 'Category', type: 'text', list: 'categories' },
    { key: 'zone', label: 'Area / zone', type: 'text', list: 'zones', full: true },
    { key: 'openingHours', label: 'Opening hours', type: 'text', full: true },
    { key: 'notes', label: 'Notes', type: 'textarea', full: true },
    { key: 'lat', label: 'Latitude', type: 'number', step: 'any' },
    { key: 'lng', label: 'Longitude', type: 'number', step: 'any' },
  ];

  function fieldHtml(l, f) {
    const id = `f-${f.key}`;
    const v = l[f.key];
    let input;
    if (f.type === 'day') {
      const opts = [`<option value="">No day</option>`];
      for (let d = 1; d <= dayCount(); d++) {
        opts.push(`<option value="${d}"${dayOf(l) === d ? ' selected' : ''}>Day ${d}${dayDate(d) ? ` · ${esc(dayDate(d))}` : ''}</option>`);
      }
      input = `<select id="${id}" data-field="day">${opts.join('')}</select>`;
    } else if (f.type === 'select') {
      const options = f.options.includes(v) || v == null || v === '' ? f.options : [...f.options, v];
      input = `<select id="${id}" data-field="${f.key}"><option value="">–</option>${options.map((o) => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea id="${id}" data-field="${f.key}">${esc(v)}</textarea>`;
    } else if (f.type === 'number') {
      input = `<input id="${id}" data-field="${f.key}" type="number" inputmode="decimal" step="${f.step}"${f.min != null ? ` min="${f.min}"` : ''} placeholder="${esc(f.placeholder || '')}" value="${Number.isFinite(v) ? v : ''}">`;
    } else {
      input = `<input id="${id}" data-field="${f.key}" type="text"${f.list ? ` list="${f.list}"` : ''} value="${esc(v)}">`;
    }
    return `<div class="field${f.full ? ' full' : ''}" data-wrap="${f.key}"><label for="${id}">${f.label}</label>${input}</div>`;
  }

  function renderDetail() {
    const l = byKey(state.selectedKey);
    if (!l) { state.selectedKey = null; renderList(); return; }
    const uniq = (k) => [...new Set(locs().map((x) => x[k]).filter(Boolean))].sort();
    $('#sideBody').innerHTML =
      `<div class="detail">` +
      `<div class="detail-top" id="detailTop"></div>` +
      `<div class="form">${FIELDS.map((f) => fieldHtml(l, f)).join('')}` +
      `<p class="field full hint">Tip: drag the pin on the map to move it.</p></div>` +
      `<datalist id="categories">${uniq('category').map((c) => `<option value="${esc(c)}">`).join('')}</datalist>` +
      `<datalist id="zones">${uniq('zone').map((c) => `<option value="${esc(c)}">`).join('')}</datalist>` +
      `<div class="dist" id="distList"></div>` +
      `</div>`;
    $('#sideBody').scrollTop = 0;
    updateDetailLive();
  }

  // Parts of the detail view that depend on values being edited (no input re-render, so typing keeps focus)
  function updateDetailLive() {
    const l = byKey(state.selectedKey);
    const top = $('#detailTop');
    if (!l || !top) return;
    const d = dayOf(l);
    top.style.setProperty('--c', colorOf(l));
    const where = d ? `Day ${d}${dayDate(d) ? `, ${dayDate(d)}` : ''} · stop ${stopNumber(l)} of ${stopsOf(d).length}` : 'No day yet';
    top.innerHTML = `<button class="link-btn back" id="backBtn">← All stops</button><h3>${esc(l.name || 'Untitled stop')}</h3><p>${esc(where)}</p>`;

    // mark edited fields
    const i = locs().indexOf(l);
    const base = state.baseLocs[i] ? JSON.parse(state.baseLocs[i]) : {};
    document.querySelectorAll('.field[data-wrap]').forEach((el) => {
      const k = el.dataset.wrap;
      el.classList.toggle('is-changed', JSON.stringify(l[k] ?? null) !== JSON.stringify(base[k] ?? null));
    });

    // distances
    const dl = $('#distList');
    if (!hasCoords(l)) { dl.innerHTML = `<h4>Distances</h4><p class="note">Add a latitude and longitude to see distances.</p>`; return; }
    const rows = locs().filter((x) => x !== l && hasCoords(x)).map((x) => ({ x, d: distanceKm(l, x) })).sort((a, b) => a.d - b.d);
    let routeNote = '';
    if (d) {
      const stops = stopsOf(d).filter(hasCoords);
      const idx = stops.indexOf(l);
      const parts = [];
      if (idx > 0) parts.push(`${fmtKm(distanceKm(stops[idx - 1], l))} from ${stops[idx - 1].name}`);
      if (idx > -1 && idx < stops.length - 1) parts.push(`${fmtKm(distanceKm(l, stops[idx + 1]))} to ${stops[idx + 1].name}`);
      if (parts.length) routeNote = `<p class="note">On the Day ${d} route: ${esc(parts.join(', then '))}.</p>`;
    }
    dl.innerHTML = `<h4>Distance to other stops</h4>${routeNote}<ol>` +
      rows.map(({ x, d: km }) => `<li><button data-key="${keyOf(x)}" style="--c:${colorOf(x)}"><span class="dot"></span><span class="nm">${esc(x.name || 'Untitled stop')}</span><span class="km">${fmtKm(km)}</span></button></li>`).join('') +
      `</ol><p class="note">Straight-line distance. Travel by road is usually longer.</p>`;
  }

  function syncCoordInputs(l) {
    if (byKey(state.selectedKey) !== l) return;
    const la = $('#f-lat'), ln = $('#f-lng');
    if (la) la.value = l.lat;
    if (ln) ln.value = l.lng;
  }

  $('#sideBody').addEventListener('click', (e) => {
    if (e.target.closest('#backBtn')) { select(null); return; }
    const item = e.target.closest('[data-key]');
    if (item) select(Number(item.dataset.key), { pan: true });
  });

  function readField(el) {
    const k = el.dataset.field;
    const raw = el.value;
    if (k === 'day') return raw === '' ? null : Number(raw);
    if (el.type === 'number') {
      if (raw.trim() === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    if (el.tagName === 'SELECT') return raw === '' ? null : raw;
    return raw;
  }

  function onFieldEdit(e) {
    const el = e.target.closest('[data-field]');
    if (!el) return;
    const l = byKey(state.selectedKey);
    if (!l) return;
    const v = readField(el);
    if (v === undefined) return; // half-typed number
    const k = el.dataset.field;
    // Keep an untouched blank text field as it was in the file (e.g. "" vs missing)
    if (l[k] === undefined && (v === '' || v === null)) return;
    l[k] = v;
    const structural = ['day', 'order', 'bestTime', 'lat', 'lng'].includes(k);
    commit();
    if (k === 'day' && v !== null && typeof state.activeDay === 'number' && state.activeDay !== v) {
      // follow the stop to its new day so it stays highlighted
      setDay(v, { fit: false });
    }
    if (structural && (k === 'lat' || k === 'lng') && hasCoords(l)) map.panTo([l.lat, l.lng]);
  }
  $('#sideBody').addEventListener('input', (e) => {
    if (e.target.matches('input[type="text"], textarea, input[type="number"]')) onFieldEdit(e);
  });
  $('#sideBody').addEventListener('change', (e) => {
    if (e.target.matches('select')) onFieldEdit(e);
  });

  /* ---------- Selection ---------- */
  function select(key, { pan = false } = {}) {
    state.selectedKey = key;
    renderMap();
    if (key) {
      renderDetail();
      const l = byKey(key);
      if (pan && l && hasCoords(l)) {
        if (!map.getBounds().pad(-0.15).contains([l.lat, l.lng])) map.flyTo([l.lat, l.lng], Math.max(map.getZoom(), 14), { duration: 0.5 });
      }
    } else {
      renderList();
    }
  }

  /* ---------- Render all / commit ---------- */
  function renderAll({ keepDetail = false } = {}) {
    renderTitle();
    renderStats();
    renderDayBar();
    renderSideHead();
    renderMap();
    if (state.selectedKey && byKey(state.selectedKey)) {
      if (keepDetail && $('#detailTop')) updateDetailLive();
      else renderDetail();
    } else {
      state.selectedKey = null;
      renderList();
    }
  }

  function commit() {
    saveDraft();
    renderAll({ keepDetail: true });
  }

  function discardEdits() {
    const fresh = JSON.parse(state.baseNorm);
    state.data = fresh;
    tagKeys();
    clearDraft();
    state.selectedKey = null;
    state.activeDay = 'all';
    renderAll();
    toast('Changes discarded');
  }

  /* ---------- Export ---------- */
  const dlg = $('#exportDialog');
  function openExport() {
    $('#exportText').value = serialize(state.data);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    $('#exportText').scrollTop = 0;
  }
  $('#copyBtn').addEventListener('click', async () => {
    const text = $('#exportText').value;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const ta = $('#exportText');
      ta.focus(); ta.select();
      document.execCommand('copy');
    }
    toast('Copied. Paste it into data/locations.json and push.');
  });
  $('#downloadBtn').addEventListener('click', () => {
    const blob = new Blob([$('#exportText').value], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'locations.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Downloaded locations.json');
  });

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-on'), 2600);
  }

  /* ---------- Keyboard ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]') || dlg.open || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'q') stepDay(-1);
    else if (k === 'e') stepDay(1);
    else if (k === 'escape' && state.selectedKey) select(null);
    else if (/^[0-9]$/.test(k) && anyDays()) {
      const n = Number(k);
      if (n === 0) setDay('all');
      else if (n <= dayCount()) setDay(n);
    }
  });

  /* ---------- Load ---------- */
  function showLoadError(title, detail) {
    const el = $('#loadError');
    el.hidden = false;
    const local = location.protocol === 'file:';
    el.innerHTML = `<h2>${esc(title)}</h2><p>${detail}</p>` +
      (local ? `<p>Pages opened straight from disk can't read files. Open the GitHub Pages link instead, or run <code>python3 -m http.server</code> in the repo folder and visit <code>http://localhost:8000</code>.</p>` : '');
    $('#tripName').textContent = 'No data';
    tiles.addTo(map);
  }

  async function load() {
    let text;
    try {
      const res = await fetch(`${DATA_URL}?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`the server answered ${res.status}`);
      text = await res.text();
    } catch (err) {
      showLoadError("Couldn't load the locations", `Reading <code>${DATA_URL}</code> failed: ${esc(err.message)}.`);
      return;
    }
    let fileData;
    try {
      fileData = JSON.parse(text);
    } catch (err) {
      showLoadError('The data file has a typo', `<code>${DATA_URL}</code> is not valid JSON (${esc(err.message)}). Fix it and push again.`);
      return;
    }
    if (!fileData || !Array.isArray(fileData.locations)) {
      showLoadError('The data file is missing its list', `<code>${DATA_URL}</code> needs a <code>"locations"</code> list.`);
      return;
    }

    state.baseNorm = serialize(fileData);
    state.baseLocs = fileData.locations.map((l) => JSON.stringify(l));

    let data = fileData;
    const draft = readDraft();
    if (draft && draft.data && Array.isArray(draft.data.locations)) {
      if (draft.base === state.baseNorm && serialize(draft.data) !== state.baseNorm) {
        data = draft.data;
        setTimeout(() => toast('Restored your unsaved edits'), 400);
      } else {
        if (draft.base !== state.baseNorm && serialize(draft.data) !== state.baseNorm) {
          setTimeout(() => toast('The data file changed since your last edits, so your older edits were cleared'), 400);
        }
        clearDraft();
      }
    }
    state.data = data;
    tagKeys();
    renderAll();
    fitTo(locs(), false);
    tiles.addTo(map);
  }

  load();
})();
