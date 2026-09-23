(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const els = {
    peopleCount: $('#peopleCount'), familiesCount: $('#familiesCount'), yearsRange: $('#yearsRange'),
    search: $('#personSearch'), searchMeta: $('#searchMeta'), peopleList: $('#peopleList'),
    treeSvg: $('#treeSvg'), treeScroll: $('#treeScroll'), loading: $('#loadingState'),
    error: $('#errorState'), errorText: $('#errorText'), depth: $('#depthSelect'),
    fit: $('#fitTree'), details: $('#personDetails'), detailName: $('#detailName'),
    personPanel: $('#personPanel'), peoplePanel: $('.people-panel'), copy: $('#copyLink'),
    toast: $('#toast'), dialog: $('#shareDialog'), shareInput: $('#shareInput')
  };

  const state = { people: new Map(), families: new Map(), selected: null, direction: 'ancestors', depth: 5 };
  const ns = 'http://www.w3.org/2000/svg';

  const cleanRef = (value = '') => value.trim();
  const cleanName = (value = '') => value.replaceAll('/', '').replace(/\s+/g, ' ').trim();
  const compact = (value = '') => value.replace(/\s+/g, ' ').trim();
  const esc = (value = '') => String(value).replace(/[&<>\"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const yearFrom = (value = '') => (value.match(/(?:16|17|18|19|20)\d{2}/) || [])[0] || '';

  function parseGedcom(text) {
    const people = new Map();
    const families = new Map();
    let record = null;
    let kind = '';
    let event = '';
    let lastFamilyRef = null;
    let lastSource = null;

    for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const match = rawLine.match(/^(\d+)\s+(?:(@[^@]+@)\s+)?([^\s]+)(?:\s+(.*))?$/);
      if (!match) continue;
      const level = Number(match[1]);
      const id = match[2] || '';
      const tag = match[3];
      const value = match[4] || '';

      if (level === 0) {
        event = ''; lastFamilyRef = null; lastSource = null;
        if (tag === 'INDI') {
          kind = 'INDI';
          record = { id, name: '', given: '', surname: '', sex: '', birth: '', death: '', famc: [], fams: [], notes: [], sources: [] };
          people.set(id, record);
        } else if (tag === 'FAM') {
          kind = 'FAM';
          record = { id, husband: '', wife: '', children: [], marriage: '', notes: [] };
          families.set(id, record);
        } else { kind = ''; record = null; }
        continue;
      }
      if (!record) continue;

      if (kind === 'INDI') {
        if (level === 1) {
          event = '';
          if (tag === 'NAME' && !record.name) record.name = cleanName(value);
          else if (tag === 'SEX') record.sex = value;
          else if (tag === 'BIRT' || tag === 'DEAT') event = tag;
          else if (tag === 'FAMC') { lastFamilyRef = { id: cleanRef(value), pedi: '' }; record.famc.push(lastFamilyRef); }
          else if (tag === 'FAMS') record.fams.push(cleanRef(value));
          else if (tag === 'NOTE') record.notes.push(value);
          else if (tag === 'SOUR') { lastSource = { id: cleanRef(value), page: '' }; record.sources.push(lastSource); }
        } else if (level === 2) {
          if (tag === 'GIVN' && !record.given) record.given = value;
          else if (tag === 'SURN' && !record.surname) record.surname = value;
          else if (tag === 'DATE' && event === 'BIRT') record.birth = value;
          else if (tag === 'DATE' && event === 'DEAT') record.death = value;
          else if (tag === 'PEDI' && lastFamilyRef) lastFamilyRef.pedi = value.toLowerCase();
          else if (tag === 'PAGE' && lastSource) lastSource.page = value;
          else if ((tag === 'CONC' || tag === 'CONT') && record.notes.length) record.notes[record.notes.length - 1] += (tag === 'CONT' ? '\n' : '') + value;
        }
      } else if (kind === 'FAM') {
        if (level === 1) {
          event = '';
          if (tag === 'HUSB') record.husband = cleanRef(value);
          else if (tag === 'WIFE') record.wife = cleanRef(value);
          else if (tag === 'CHIL') record.children.push(cleanRef(value));
          else if (tag === 'MARR') event = 'MARR';
          else if (tag === 'NOTE') record.notes.push(value);
        } else if (level === 2) {
          if (tag === 'DATE' && event === 'MARR') record.marriage = value;
          else if ((tag === 'CONC' || tag === 'CONT') && record.notes.length) record.notes[record.notes.length - 1] += (tag === 'CONT' ? '\n' : '') + value;
        }
      }
    }

    for (const person of people.values()) {
      person.name = person.name || compact(`${person.given} ${person.surname}`) || 'Имя не указано';
      person.search = compact(`${person.name} ${person.given} ${person.surname}`).toLocaleLowerCase('ru');
    }
    return { people, families };
  }

  function life(person, detailed = false) {
    const birth = person.birth || '?';
    const death = person.death || '';
    if (detailed) return death ? `р. ${birth} · ум. ${death}` : `р. ${birth}`;
    return `${yearFrom(birth) || '?'}–${death ? yearFrom(death) || '?' : ''}`;
  }

  function personById(id) { return state.people.get(id); }
  function familiesAsChild(person) { return person.famc.map((ref) => ({ ref, family: state.families.get(ref.id) })).filter((item) => item.family); }
  function familiesAsSpouse(person) { return person.fams.map((id) => state.families.get(id)).filter(Boolean); }

  function parentsOf(person) {
    const result = [];
    for (const { ref, family } of familiesAsChild(person)) {
      for (const id of [family.husband, family.wife]) {
        const parent = personById(id);
        if (parent && !result.some((item) => item.person.id === id && item.foster === (ref.pedi === 'foster'))) result.push({ person: parent, foster: ref.pedi === 'foster' });
      }
    }
    return result;
  }

  function spousesOf(person) {
    const result = [];
    for (const family of familiesAsSpouse(person)) {
      for (const id of [family.husband, family.wife]) {
        if (id && id !== person.id && personById(id) && !result.some((item) => item.person.id === id)) result.push({ person: personById(id), family });
      }
    }
    return result;
  }

  function childrenOf(person) {
    const result = [];
    for (const family of familiesAsSpouse(person)) {
      for (const id of family.children) if (personById(id) && !result.some((item) => item.person.id === id)) result.push({ person: personById(id), family });
    }
    return result;
  }

  function siblingsOf(person) {
    const result = [];
    for (const { family } of familiesAsChild(person)) {
      for (const id of family.children) if (id !== person.id && personById(id) && !result.some((item) => item.id === id)) result.push(personById(id));
    }
    return result;
  }

  function relationMarkup(title, entries, fosterAware = false) {
    if (!entries.length) return '';
    return `<section class="relation-section"><h3>${esc(title)}</h3><div class="relation-list">${entries.map((entry) => {
      const person = entry.person || entry;
      const foster = fosterAware && entry.foster;
      return `<button class="relation${foster ? ' foster' : ''}" data-person="${esc(person.id)}"><b>${esc(person.name)}</b><span>${foster ? 'приёмная связь' : esc(life(person))}</span></button>`;
    }).join('')}</div></section>`;
  }

  function renderDetails(person) {
    els.detailName.textContent = person.name;
    const parents = parentsOf(person);
    const sources = person.sources.filter((source) => source.page);
    els.details.innerHTML = `
      <p class="life-line">${esc(life(person, true))}</p>
      ${relationMarkup('Родители', parents, true)}
      ${relationMarkup('Супруги', spousesOf(person))}
      ${relationMarkup('Дети', childrenOf(person))}
      ${relationMarkup('Братья и сёстры', siblingsOf(person))}
      ${person.notes.length ? `<section class="relation-section"><h3>Примечания исследования</h3>${person.notes.map((note) => `<p class="detail-note">${esc(note).replaceAll('\n', '<br>')}</p>`).join('')}</section>` : ''}
      ${sources.length ? `<section class="relation-section"><h3>Источники</h3><div class="source-list">${sources.map((source) => `<div class="source-item">${esc(source.page)}</div>`).join('')}</div></section>` : ''}
      ${!parents.length && !spousesOf(person).length && !childrenOf(person).length ? '<p class="empty-small">В GEDCOM для этого человека не указаны дополнительные семейные связи.</p>' : ''}`;
    els.details.querySelectorAll('[data-person]').forEach((button) => button.addEventListener('click', () => selectPerson(button.dataset.person)));
  }

  function renderPeople(filter = '') {
    const term = compact(filter).toLocaleLowerCase('ru');
    const all = [...state.people.values()].sort((a, b) => `${a.surname} ${a.given}`.localeCompare(`${b.surname} ${b.given}`, 'ru'));
    const matches = term ? all.filter((person) => person.search.includes(term)) : all;
    const shown = matches.slice(0, 90);
    els.searchMeta.textContent = term ? `Найдено: ${matches.length}` : `${all.length} человек · показаны первые ${shown.length}`;
    els.peopleList.innerHTML = shown.map((person) => `<button class="person-option${person.id === state.selected ? ' active' : ''}" data-person="${esc(person.id)}" role="option" aria-selected="${person.id === state.selected}"><b>${esc(person.name)}</b><span>${esc(life(person))}</span></button>`).join('') || '<p class="empty-small">Совпадений нет</p>';
    els.peopleList.querySelectorAll('[data-person]').forEach((button) => button.addEventListener('click', () => {
      selectPerson(button.dataset.person);
      els.peoplePanel.classList.remove('open');
    }));
  }

  function buildTree(person, direction, maxDepth, depth = 0, path = new Set()) {
    const node = { person, depth, children: [], uid: `${person.id}-${depth}-${Math.random().toString(36).slice(2, 7)}`, foster: false };
    if (depth >= maxDepth || path.has(person.id)) return node;
    const nextPath = new Set(path); nextPath.add(person.id);
    const links = direction === 'ancestors' ? parentsOf(person) : childrenOf(person).map((entry) => ({ person: entry.person, foster: false }));
    node.children = links.filter((link) => !nextPath.has(link.person.id)).map((link) => {
      const child = buildTree(link.person, direction, maxDepth, depth + 1, nextPath);
      child.foster = Boolean(link.foster);
      return child;
    });
    return node;
  }

  function layoutTree(root) {
    const cardW = 174, cardH = 60, gapX = 34, gapY = 68, pad = 42;
    let leaf = 0;
    const nodes = [];
    function walk(node) {
      node.children.forEach(walk);
      node.x = node.children.length ? node.children.reduce((sum, child) => sum + child.x, 0) / node.children.length : leaf++ * (cardW + gapX);
      nodes.push(node);
    }
    walk(root);
    const levels = Math.max(...nodes.map((node) => node.depth), 0);
    for (const node of nodes) {
      node.y = node.depth * (cardH + gapY);
    }
    const maxX = Math.max(...nodes.map((node) => node.x), 0);
    const width = Math.max(520, maxX + cardW + pad * 2);
    const height = Math.max(420, (levels + 1) * (cardH + gapY) - gapY + pad * 2);
    nodes.forEach((node) => { node.x += pad; node.y += pad; });
    return { nodes, width, height, cardW, cardH };
  }

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }

  function nodeTitle(person) {
    const words = person.name.split(' ');
    if (words.length <= 3) return person.name;
    return `${words.slice(0, 2).join(' ')} ${words.at(-1)}`;
  }

  function renderTree(center = false) {
    const person = personById(state.selected);
    if (!person) return;
    const root = buildTree(person, state.direction, state.depth - 1);
    const layout = layoutTree(root);
    els.treeSvg.replaceChildren();
    els.treeSvg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
    els.treeSvg.setAttribute('width', layout.width);
    els.treeSvg.setAttribute('height', layout.height);

    for (const parent of layout.nodes) {
      for (const child of parent.children) {
        const startY = parent.y + layout.cardH;
        const endY = child.y;
        const sx = parent.x + layout.cardW / 2;
        const ex = child.x + layout.cardW / 2;
        const middle = (startY + endY) / 2;
        const path = svgEl('path', { class: `tree-edge${child.foster ? ' foster' : ''}`, d: `M${sx} ${startY} V${middle} H${ex} V${endY}` });
        els.treeSvg.appendChild(path);
      }
    }

    for (const node of layout.nodes) {
      const group = svgEl('g', { class: `tree-node${node.person.id === state.selected ? ' selected' : ''}`, transform: `translate(${node.x} ${node.y})`, tabindex: '0', role: 'button', 'aria-label': node.person.name });
      group.appendChild(svgEl('rect', { width: layout.cardW, height: layout.cardH, rx: 8 }));
      group.appendChild(svgEl('circle', { class: 'sex-dot', cx: 12, cy: 14, r: 3 }));
      const title = svgEl('text', { class: 'node-name', x: 21, y: 19 });
      const shownName = nodeTitle(node.person);
      title.textContent = shownName.length > 24 ? `${shownName.slice(0, 23)}…` : shownName;
      group.appendChild(title);
      const dates = svgEl('text', { class: 'node-life', x: 12, y: 42 });
      dates.textContent = life(node.person, true);
      group.appendChild(dates);
      const activate = () => selectPerson(node.person.id);
      group.addEventListener('click', activate);
      group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } });
      els.treeSvg.appendChild(group);
    }
    els.treeSvg.removeAttribute('hidden');
    if (center) requestAnimationFrame(centerTree);
  }

  function centerTree() {
    const selected = els.treeSvg.querySelector('.tree-node.selected');
    if (!selected) return;
    const transform = selected.getAttribute('transform').match(/[\d.]+/g) || [0, 0];
    const x = Number(transform[0]);
    const y = Number(transform[1]);
    els.treeScroll.scrollTo({ left: Math.max(0, x - els.treeScroll.clientWidth / 2 + 87), top: Math.max(0, y - els.treeScroll.clientHeight / 2 + 30), behavior: 'smooth' });
  }

  function selectPerson(id, initial = false) {
    if (!personById(id)) return;
    state.selected = id;
    renderPeople(els.search.value);
    renderDetails(personById(id));
    renderTree(true);
    if (!initial) els.personPanel.classList.add('open');
    const url = new URL(location.href);
    url.searchParams.set('person', id);
    url.searchParams.set('view', state.direction);
    history.replaceState(null, '', url);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  async function copyLink() {
    const link = location.href;
    try {
      await navigator.clipboard.writeText(link);
      showToast('Ссылка скопирована');
    } catch {
      els.shareInput.value = link;
      els.dialog.showModal();
      requestAnimationFrame(() => els.shareInput.select());
    }
  }

  async function init() {
    try {
      const response = await fetch('../../data/gulyaevy.ged', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Ответ сервера: ${response.status}`);
      const parsed = parseGedcom(await response.text());
      state.people = parsed.people; state.families = parsed.families;
      if (!state.people.size) throw new Error('В файле нет записей о людях');

      els.peopleCount.textContent = state.people.size;
      els.familiesCount.textContent = state.families.size;
      const years = [...state.people.values()].flatMap((person) => [yearFrom(person.birth), yearFrom(person.death)]).filter(Boolean).map(Number);
      els.yearsRange.textContent = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : 'XVII–XX вв.';
      const params = new URLSearchParams(location.search);
      if (params.get('view') === 'descendants') state.direction = 'descendants';
      document.querySelectorAll('[data-direction]').forEach((button) => button.classList.toggle('active', button.dataset.direction === state.direction));
      const requested = params.get('person');
      const fallback = [...state.people.values()].find((person) => person.name.includes('Юрий Геннадьевич') && person.surname === 'Гуляев') || [...state.people.values()][0];
      els.loading.hidden = true;
      selectPerson(state.people.has(requested) ? requested : fallback.id, true);
    } catch (error) {
      els.loading.hidden = true; els.error.hidden = false;
      els.errorText.textContent = `Не удалось прочитать данные. ${error.message}`;
    }
  }

  els.search.addEventListener('input', () => renderPeople(els.search.value));
  els.depth.addEventListener('change', () => { state.depth = Number(els.depth.value); renderTree(true); });
  document.querySelectorAll('[data-direction]').forEach((button) => button.addEventListener('click', () => {
    state.direction = button.dataset.direction;
    document.querySelectorAll('[data-direction]').forEach((item) => item.classList.toggle('active', item === button));
    selectPerson(state.selected, true);
  }));
  els.fit.addEventListener('click', centerTree);
  els.copy.addEventListener('click', copyLink);
  $('#openPeople').addEventListener('click', () => els.peoplePanel.classList.add('open'));
  $('#closePeople').addEventListener('click', () => els.peoplePanel.classList.remove('open'));
  $('#closeDetails').addEventListener('click', () => els.personPanel.classList.remove('open'));
  window.addEventListener('resize', () => { if (window.innerWidth > 1180) els.personPanel.classList.remove('open'); });
  init();
})();
