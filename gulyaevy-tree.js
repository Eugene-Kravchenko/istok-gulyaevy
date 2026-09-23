(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const ns = 'http://www.w3.org/2000/svg';
  const els = {
    peopleCount: $('#peopleCount'), familiesCount: $('#familiesCount'), yearsRange: $('#yearsRange'),
    depth: $('#depthSelect'), scopeDirect: $('#scopeDirect'), searchToggle: $('#searchToggle'),
    searchPanel: $('#searchPanel'), search: $('#personSearch'), searchMeta: $('#searchMeta'),
    peopleList: $('#peopleList'), treeCard: $('#treeCard'), stage: $('#treeStage'), svg: $('#treeSvg'),
    viewport: $('#treeViewport'), edges: $('#treeEdges'), nodes: $('#treeNodes'), loading: $('#loadingState'),
    error: $('#errorState'), errorText: $('#errorText'), zoomValue: $('#zoomValue'), summary: $('#viewSummary'),
    drawer: $('#personDrawer'), detailName: $('#detailName'), details: $('#personDetails'), makeRoot: $('#makeRoot'),
    copy: $('#copyLink'), toast: $('#toast'), dialog: $('#shareDialog'), shareInput: $('#shareInput'),
    sidebar: $('#cabinetSidebar'), backdrop: $('#sidebarBackdrop')
  };

  const state = {
    people: new Map(), families: new Map(), root: '', selected: '', direction: 'ancestors', scope: 'direct', depth: 8,
    graph: null, camera: { x: 0, y: 0, scale: 1 }, pointers: new Map(), drag: null, moved: false, resizeTimer: 0
  };

  const CARD_W = 214;
  const CARD_H = 82;
  const GAP_X = 34;
  const GAP_Y = 90;
  const PAD = 64;

  const compact = (value = '') => String(value).replace(/\s+/g, ' ').trim();
  const cleanName = (value = '') => compact(value.replaceAll('/', ''));
  const cleanRef = (value = '') => value.trim();
  const esc = (value = '') => String(value).replace(/[&<>\"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const yearFrom = (value = '') => (String(value).match(/(?:16|17|18|19|20)\d{2}/) || [])[0] || '';
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function svgEl(tag, attrs = {}) {
    const element = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

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
        } else {
          kind = ''; record = null;
        }
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

  function personById(id) { return state.people.get(id); }
  function familiesAsChild(person) { return person.famc.map((ref) => ({ ref, family: state.families.get(ref.id) })).filter((item) => item.family); }
  function familiesAsSpouse(person) { return person.fams.map((id) => state.families.get(id)).filter(Boolean); }

  function parentsOf(person) {
    const result = [];
    for (const { ref, family } of familiesAsChild(person)) {
      for (const id of [family.husband, family.wife]) {
        const parent = personById(id);
        if (parent && !result.some((item) => item.person.id === id)) result.push({ person: parent, foster: ref.pedi === 'foster' });
      }
    }
    return result;
  }

  function spousesOf(person) {
    const result = [];
    for (const family of familiesAsSpouse(person)) {
      for (const id of [family.husband, family.wife]) {
        const spouse = id && id !== person.id ? personById(id) : null;
        if (spouse && !result.some((item) => item.person.id === id)) result.push({ person: spouse, family });
      }
    }
    return result;
  }

  function childrenOf(person) {
    const result = [];
    for (const family of familiesAsSpouse(person)) {
      for (const id of family.children) {
        const child = personById(id);
        if (child && !result.some((item) => item.person.id === id)) result.push({ person: child, family });
      }
    }
    return result;
  }

  function siblingsOf(person) {
    const result = [];
    for (const { family } of familiesAsChild(person)) {
      for (const id of family.children) {
        const sibling = id !== person.id ? personById(id) : null;
        if (sibling && !result.some((item) => item.id === id)) result.push(sibling);
      }
    }
    return result;
  }

  function life(person, detailed = false) {
    const birth = person.birth || '';
    const death = person.death || '';
    if (detailed) {
      if (!birth && !death) return 'Даты жизни уточняются';
      return compact(`${birth ? `р. ${birth}` : ''}${birth && death ? ' · ' : ''}${death ? `ум. ${death}` : ''}`);
    }
    const born = yearFrom(birth);
    const died = yearFrom(death);
    if (!born && !died) return 'Даты уточняются';
    return `${born || '?'}–${death ? died || '?' : ''}`;
  }

  function addGraphNode(nodes, person, generation, direct = false) {
    if (!person) return null;
    const existing = nodes.get(person.id);
    if (existing) {
      existing.direct ||= direct;
      if (Math.abs(generation) < Math.abs(existing.generation)) existing.generation = generation;
      return existing;
    }
    const node = { id: person.id, person, generation, direct, x: 0, y: 0 };
    nodes.set(person.id, node);
    return node;
  }

  function buildGraph() {
    const root = personById(state.root);
    const nodes = new Map();
    const directIds = new Set();
    addGraphNode(nodes, root, 0, true);
    directIds.add(root.id);

    const queue = [{ person: root, generation: 0, level: 0 }];
    const visited = new Set([root.id]);
    while (queue.length) {
      const current = queue.shift();
      if (current.level >= state.depth - 1) continue;
      const relatives = state.direction === 'ancestors'
        ? parentsOf(current.person).map((entry) => entry.person)
        : childrenOf(current.person).map((entry) => entry.person);
      for (const relative of relatives) {
        const generation = current.generation + (state.direction === 'ancestors' ? -1 : 1);
        addGraphNode(nodes, relative, generation, true);
        directIds.add(relative.id);
        if (!visited.has(relative.id)) {
          visited.add(relative.id);
          queue.push({ person: relative, generation, level: current.level + 1 });
        }
      }
    }

    if (state.scope === 'all') addFamilyBranches(nodes, directIds);

    const edges = [];
    const edgeKeys = new Set();
    const addEdge = (from, to, type, foster = false) => {
      const key = `${type}:${from}:${to}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push({ from, to, type, foster, direct: directIds.has(from) && directIds.has(to) });
    };

    for (const family of state.families.values()) {
      if (nodes.has(family.husband) && nodes.has(family.wife)) addEdge(family.husband, family.wife, 'spouse');
      for (const childId of family.children) {
        if (!nodes.has(childId)) continue;
        const child = personById(childId);
        const foster = Boolean(child?.famc.find((ref) => ref.id === family.id && ref.pedi === 'foster'));
        if (nodes.has(family.husband)) addEdge(family.husband, childId, 'parent', foster);
        if (nodes.has(family.wife)) addEdge(family.wife, childId, 'parent', foster);
      }
    }
    return { nodes, edges, directIds };
  }

  function addFamilyBranches(nodes, directIds) {
    const directNodes = [...nodes.values()].filter((node) => node.direct);
    const addSpouses = (person, generation) => {
      for (const { person: spouse } of spousesOf(person)) addGraphNode(nodes, spouse, generation, directIds.has(spouse.id));
    };
    directNodes.forEach((node) => addSpouses(node.person, node.generation));

    const branchSeeds = [];
    for (const node of directNodes) {
      for (const sibling of siblingsOf(node.person)) {
        const siblingNode = addGraphNode(nodes, sibling, node.generation, false);
        branchSeeds.push(siblingNode);
        addSpouses(sibling, node.generation);
      }
    }

    const minGeneration = state.direction === 'ancestors' ? -(state.depth - 1) : 0;
    const maxGeneration = state.direction === 'ancestors' ? 0 : state.depth - 1;
    const queue = branchSeeds.map((node) => ({ person: node.person, generation: node.generation }));
    const visited = new Set(branchSeeds.map((node) => `${node.id}:${node.generation}`));
    while (queue.length) {
      const current = queue.shift();
      if (current.generation >= maxGeneration) continue;
      for (const { person: child } of childrenOf(current.person)) {
        const generation = current.generation + 1;
        if (generation < minGeneration || generation > maxGeneration) continue;
        addGraphNode(nodes, child, generation, false);
        addSpouses(child, generation);
        const key = `${child.id}:${generation}`;
        if (!visited.has(key)) { visited.add(key); queue.push({ person: child, generation }); }
      }
    }
  }

  function layoutGraph(graph) {
    const layers = new Map();
    for (const node of graph.nodes.values()) {
      if (!layers.has(node.generation)) layers.set(node.generation, []);
      layers.get(node.generation).push(node);
    }
    const generations = [...layers.keys()].sort((a, b) => a - b);
    for (const layer of layers.values()) layer.sort((a, b) => `${a.person.surname} ${a.person.given}`.localeCompare(`${b.person.surname} ${b.person.given}`, 'ru'));

    const adjacency = new Map();
    for (const node of graph.nodes.values()) adjacency.set(node.id, []);
    for (const edge of graph.edges) {
      adjacency.get(edge.from)?.push(edge.to);
      adjacency.get(edge.to)?.push(edge.from);
    }

    const reorder = (orderedGenerations) => {
      const positions = new Map();
      for (const layer of layers.values()) layer.forEach((node, index) => positions.set(node.id, index));
      for (const generation of orderedGenerations) {
        const layer = layers.get(generation);
        layer.forEach((node, index) => { node._previous = index; });
        layer.sort((a, b) => {
          const score = (node) => {
            const neighbors = (adjacency.get(node.id) || []).filter((id) => positions.has(id));
            if (!neighbors.length) return node._previous;
            return neighbors.reduce((sum, id) => sum + positions.get(id), 0) / neighbors.length;
          };
          return score(a) - score(b) || a._previous - b._previous;
        });
      }
    };
    for (let pass = 0; pass < 5; pass++) {
      reorder(generations);
      reorder([...generations].reverse());
    }

    const maxCount = Math.max(...[...layers.values()].map((layer) => layer.length), 1);
    const contentW = maxCount * CARD_W + Math.max(0, maxCount - 1) * GAP_X;
    const width = contentW + PAD * 2;
    const height = generations.length * CARD_H + Math.max(0, generations.length - 1) * GAP_Y + PAD * 2;
    generations.forEach((generation, rank) => {
      const layer = layers.get(generation);
      const layerW = layer.length * CARD_W + Math.max(0, layer.length - 1) * GAP_X;
      const startX = PAD + (contentW - layerW) / 2;
      layer.forEach((node, index) => {
        node.x = startX + index * (CARD_W + GAP_X);
        node.y = PAD + rank * (CARD_H + GAP_Y);
      });
    });
    return { ...graph, width, height, generations };
  }

  function splitName(name) {
    const words = compact(name).split(' ');
    const lines = [''];
    for (const word of words) {
      const current = lines.at(-1);
      if (!current || `${current} ${word}`.length <= 19) lines[lines.length - 1] = compact(`${current} ${word}`);
      else if (lines.length < 2) lines.push(word);
      else lines[1] = `${lines[1]} ${word}`;
    }
    return lines.slice(0, 2).map((line) => line.length > 22 ? `${line.slice(0, 21)}…` : line);
  }

  function edgePath(edge, graph) {
    const from = graph.nodes.get(edge.from);
    const to = graph.nodes.get(edge.to);
    if (!from || !to) return '';
    if (edge.type === 'spouse') {
      const left = from.x <= to.x ? from : to;
      const right = left === from ? to : from;
      return `M ${left.x + CARD_W} ${left.y + CARD_H / 2} H ${right.x}`;
    }
    const parent = from.generation < to.generation ? from : to;
    const child = parent === from ? to : from;
    const sx = parent.x + CARD_W / 2;
    const sy = parent.y + CARD_H;
    const ex = child.x + CARD_W / 2;
    const ey = child.y;
    const bend = sy + (ey - sy) * .52;
    return `M ${sx} ${sy} C ${sx} ${bend}, ${ex} ${bend}, ${ex} ${ey}`;
  }

  function drawGraph() {
    const graph = layoutGraph(buildGraph());
    state.graph = graph;
    els.edges.replaceChildren();
    els.nodes.replaceChildren();

    const defs = svgEl('defs');
    const filter = svgEl('filter', { id: 'nodeShadow', x: '-20%', y: '-20%', width: '140%', height: '150%' });
    filter.appendChild(svgEl('feDropShadow', { dx: '0', dy: '3', stdDeviation: '4', 'flood-color': '#332f25', 'flood-opacity': '.09' }));
    defs.appendChild(filter);
    const textClip = svgEl('clipPath', { id: 'nodeTextClip', clipPathUnits: 'userSpaceOnUse' });
    textClip.appendChild(svgEl('rect', { x: 20, y: 22, width: 184, height: 55 }));
    defs.appendChild(textClip);
    els.edges.appendChild(defs);

    for (const edge of graph.edges) {
      els.edges.appendChild(svgEl('path', { d: edgePath(edge, graph), class: `tree-edge ${edge.type}${edge.direct ? ' direct' : ''}${edge.foster ? ' foster' : ''}` }));
    }

    for (const node of graph.nodes.values()) {
      const classes = ['tree-node'];
      if (!node.direct) classes.push('branch');
      if (node.id === state.root) classes.push('root');
      if (node.id === state.selected) classes.push('selected');
      const group = svgEl('g', { class: classes.join(' '), transform: `translate(${node.x} ${node.y})`, role: 'button', tabindex: '0', 'data-person-id': node.id, 'aria-label': `${node.person.name}, ${life(node.person)}` });
      group.appendChild(svgEl('rect', { class: 'node-card', width: CARD_W, height: CARD_H, rx: 10 }));
      group.appendChild(svgEl('path', { class: 'node-accent', d: `M0 10a10 10 0 0 1 10-10h2v82h-2A10 10 0 0 1 0 72Z` }));
      const badgeText = node.id === state.root ? 'Центр' : (!node.direct ? 'Ветвь' : 'Линия');
      group.appendChild(svgEl('rect', { class: 'node-badge', x: 159, y: 10, width: 43, height: 15, rx: 7.5 }));
      const badge = svgEl('text', { class: 'node-badge-text', x: 180.5, y: 20.5, 'text-anchor': 'middle' });
      badge.textContent = badgeText;
      group.appendChild(badge);
      const lines = splitName(node.person.name);
      const name = svgEl('text', { class: 'node-name', x: 22, y: lines.length > 1 ? 30 : 38, 'clip-path': 'url(#nodeTextClip)' });
      lines.forEach((line, index) => {
        const tspan = svgEl('tspan', { x: 22, dy: index ? 16 : 0 });
        tspan.textContent = line;
        name.appendChild(tspan);
      });
      group.appendChild(name);
      const dates = svgEl('text', { class: 'node-life', x: 22, y: 68, 'clip-path': 'url(#nodeTextClip)' });
      dates.textContent = life(node.person);
      group.appendChild(dates);
      group.addEventListener('click', () => { if (!state.moved) selectPerson(node.id, true); });
      group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPerson(node.id, true); } });
      els.nodes.appendChild(group);
    }

    const mode = state.scope === 'direct' ? (state.direction === 'ancestors' ? 'Прямые предки' : 'Прямые потомки') : 'Все родственники';
    const direction = state.direction === 'ancestors' ? 'предки' : 'потомки';
    els.summary.textContent = `${mode} · ${direction} · ${graph.nodes.size} ${plural(graph.nodes.size, ['человек', 'человека', 'человек'])} на схеме`;
    els.svg.removeAttribute('hidden');
    els.loading.hidden = true;
    requestAnimationFrame(() => focusRoot());
  }

  function plural(number, forms) {
    const n = Math.abs(number) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
  }

  function visibleStageSize() {
    const drawerWidth = els.drawer.classList.contains('open') && els.stage.clientWidth > 760 ? Math.min(340, els.stage.clientWidth * .35) : 0;
    return { width: Math.max(260, els.stage.clientWidth - drawerWidth), height: Math.max(260, els.stage.clientHeight) };
  }

  function updateCamera() {
    els.viewport.setAttribute('transform', `translate(${state.camera.x} ${state.camera.y}) scale(${state.camera.scale})`);
    els.zoomValue.textContent = `${Math.round(state.camera.scale * 100)}%`;
  }

  function fitTree() {
    if (!state.graph) return;
    const size = visibleStageSize();
    const scale = clamp(Math.min((size.width - 44) / state.graph.width, (size.height - 44) / state.graph.height), .12, 1.15);
    state.camera.scale = scale;
    state.camera.x = (size.width - state.graph.width * scale) / 2;
    state.camera.y = (size.height - state.graph.height * scale) / 2;
    updateCamera();
  }

  function focusRoot() {
    if (!state.graph) return;
    const node = state.graph.nodes.get(state.root);
    if (!node) return;
    const size = visibleStageSize();
    const fitScale = Math.min((size.width - 44) / state.graph.width, (size.height - 44) / state.graph.height);
    const readableScale = els.stage.clientWidth < 620 ? .54 : .68;
    const scale = clamp(Math.max(fitScale, readableScale), .18, 1);
    state.camera.scale = scale;
    state.camera.x = size.width / 2 - (node.x + CARD_W / 2) * scale;
    state.camera.y = state.direction === 'ancestors'
      ? size.height - 38 - (node.y + CARD_H) * scale
      : 38 - node.y * scale;
    updateCamera();
  }

  function centerAtActualSize() {
    if (!state.graph) return;
    const node = state.graph.nodes.get(state.root);
    const size = visibleStageSize();
    state.camera.scale = 1;
    state.camera.x = size.width / 2 - (node.x + CARD_W / 2);
    state.camera.y = size.height / 2 - (node.y + CARD_H / 2);
    updateCamera();
  }

  function zoomAt(factor, clientX, clientY) {
    const rect = els.svg.getBoundingClientRect();
    const px = clientX == null ? rect.width / 2 : clientX - rect.left;
    const py = clientY == null ? rect.height / 2 : clientY - rect.top;
    const oldScale = state.camera.scale;
    const newScale = clamp(oldScale * factor, .12, 2.4);
    const worldX = (px - state.camera.x) / oldScale;
    const worldY = (py - state.camera.y) / oldScale;
    state.camera.x = px - worldX * newScale;
    state.camera.y = py - worldY * newScale;
    state.camera.scale = newScale;
    updateCamera();
  }

  function updateUrl() {
    const url = new URL(location.href);
    url.searchParams.set('person', state.root);
    url.searchParams.set('view', state.direction);
    url.searchParams.set('scope', state.scope);
    url.searchParams.set('depth', String(state.depth));
    history.replaceState(null, '', url);
  }

  function applyControls() {
    $$('[data-direction]').forEach((button) => button.classList.toggle('active', button.dataset.direction === state.direction));
    $$('[data-scope]').forEach((button) => button.classList.toggle('active', button.dataset.scope === state.scope));
    els.scopeDirect.textContent = state.direction === 'ancestors' ? 'Прямые предки' : 'Прямые потомки';
    els.depth.value = String(state.depth);
  }

  function changeView() {
    applyControls();
    updateUrl();
    drawGraph();
  }

  function setRoot(id) {
    if (!personById(id)) return;
    state.root = id;
    state.selected = id;
    updateUrl();
    renderPeople(els.search.value);
    renderDetails(personById(id));
    els.drawer.classList.add('open');
    drawGraph();
  }

  function relationMarkup(title, entries, fosterAware = false) {
    if (!entries.length) return '';
    return `<section class="relation-section"><h3>${esc(title)}</h3><div class="relation-list">${entries.map((entry) => {
      const person = entry.person || entry;
      const foster = fosterAware && entry.foster;
      return `<button class="relation${foster ? ' foster' : ''}" data-detail-person="${esc(person.id)}" type="button"><b>${esc(person.name)}</b><span>${foster ? 'приёмная связь' : esc(life(person))}</span></button>`;
    }).join('')}</div></section>`;
  }

  function renderDetails(person) {
    els.detailName.textContent = person.name;
    const parents = parentsOf(person);
    const spouses = spousesOf(person);
    const children = childrenOf(person);
    const siblings = siblingsOf(person);
    const notes = person.notes.filter((note) => !/добавлено по (семейной схеме|предоставленной)/i.test(note));
    const sources = person.sources.filter((source) => source.page);
    els.details.innerHTML = `
      ${person.id === state.root ? '<span class="root-mark">● Центр текущего древа</span>' : ''}
      <p class="life-line">${esc(life(person, true))}</p>
      ${relationMarkup('Родители', parents, true)}
      ${relationMarkup('Супруги', spouses)}
      ${relationMarkup('Дети', children)}
      ${relationMarkup('Братья и сёстры', siblings)}
      ${notes.length ? `<section class="relation-section"><h3>Примечания исследования</h3>${notes.map((note) => `<p class="detail-note">${esc(note).replaceAll('\n', '<br>')}</p>`).join('')}</section>` : ''}
      ${sources.length ? `<section class="relation-section"><h3>Источники</h3><div class="source-list">${sources.map((source) => `<div class="source-item">${esc(source.page)}</div>`).join('')}</div></section>` : ''}
      ${!parents.length && !spouses.length && !children.length && !siblings.length ? '<p class="empty-small">В GEDCOM пока не указаны дополнительные семейные связи.</p>' : ''}`;
    els.makeRoot.hidden = person.id === state.root;
    els.details.querySelectorAll('[data-detail-person]').forEach((button) => button.addEventListener('click', () => selectPerson(button.dataset.detailPerson, true)));
  }

  function selectPerson(id, openDrawer = true) {
    const person = personById(id);
    if (!person) return;
    state.selected = id;
    renderDetails(person);
    if (openDrawer) els.drawer.classList.add('open');
    if (state.graph?.nodes.has(id)) drawSelection();
  }

  function drawSelection() {
    els.nodes.querySelectorAll('.tree-node').forEach((group) => {
      group.classList.toggle('selected', group.getAttribute('data-person-id') === state.selected);
    });
  }

  function renderPeople(filter = '') {
    const term = compact(filter).toLocaleLowerCase('ru');
    const all = [...state.people.values()].sort((a, b) => `${a.surname} ${a.given}`.localeCompare(`${b.surname} ${b.given}`, 'ru'));
    const matches = term ? all.filter((person) => person.search.includes(term)) : all;
    const shown = matches.slice(0, 70);
    els.searchMeta.textContent = term ? `Найдено: ${matches.length}` : `${all.length} человек · начните вводить имя`;
    els.peopleList.innerHTML = shown.map((person) => `<button class="person-option${person.id === state.root ? ' active' : ''}" data-search-person="${esc(person.id)}" type="button" role="option"><b>${esc(person.name)}</b><span>${esc(life(person))}</span></button>`).join('') || '<p class="empty-small">Совпадений нет</p>';
    els.peopleList.querySelectorAll('[data-search-person]').forEach((button) => button.addEventListener('click', () => {
      setRoot(button.dataset.searchPerson);
      toggleSearch(false);
    }));
  }

  function toggleSearch(open) {
    const shouldOpen = open ?? els.searchPanel.hidden;
    els.searchPanel.hidden = !shouldOpen;
    els.searchToggle.setAttribute('aria-expanded', String(shouldOpen));
    if (shouldOpen) setTimeout(() => els.search.focus(), 0);
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  async function copyLink() {
    updateUrl();
    try {
      await navigator.clipboard.writeText(location.href);
      showToast('Ссылка на это древо скопирована');
    } catch {
      els.shareInput.value = location.href;
      els.dialog.showModal();
      setTimeout(() => els.shareInput.select(), 50);
    }
  }

  function setSidebar(open) {
    els.sidebar.classList.toggle('open', open);
    els.backdrop.classList.toggle('show', open);
  }

  function bindEvents() {
    $$('[data-direction]').forEach((button) => button.addEventListener('click', () => { state.direction = button.dataset.direction; changeView(); }));
    $$('[data-scope]').forEach((button) => button.addEventListener('click', () => { state.scope = button.dataset.scope; changeView(); }));
    els.depth.addEventListener('change', () => { state.depth = Number(els.depth.value); changeView(); });
    els.searchToggle.addEventListener('click', () => toggleSearch());
    els.search.addEventListener('input', () => renderPeople(els.search.value));
    document.addEventListener('click', (event) => { if (!event.target.closest('.search-wrap')) toggleSearch(false); });
    $('#zoomIn').addEventListener('click', () => zoomAt(1.22));
    $('#zoomOut').addEventListener('click', () => zoomAt(1 / 1.22));
    els.zoomValue.addEventListener('click', centerAtActualSize);
    $('#fitTree').addEventListener('click', fitTree);
    $('#fullScreen').addEventListener('click', async () => {
      if (!document.fullscreenElement) await els.treeCard.requestFullscreen?.();
      else await document.exitFullscreen?.();
    });
    document.addEventListener('fullscreenchange', () => setTimeout(fitTree, 80));
    els.copy.addEventListener('click', copyLink);
    $('#closeDetails').addEventListener('click', () => els.drawer.classList.remove('open'));
    els.makeRoot.addEventListener('click', () => setRoot(state.selected));
    $$('[data-locked]').forEach((button) => button.addEventListener('click', () => showToast('Раздел пока недоступен в кабинете Павла')));
    $('#openSidebar').addEventListener('click', () => setSidebar(true));
    $('#closeSidebar').addEventListener('click', () => setSidebar(false));
    els.backdrop.addEventListener('click', () => setSidebar(false));

    els.svg.addEventListener('wheel', (event) => { event.preventDefault(); zoomAt(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY); }, { passive: false });
    els.svg.addEventListener('pointerdown', (event) => {
      els.svg.setPointerCapture(event.pointerId);
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      state.moved = false;
      state.drag = { startX: event.clientX, startY: event.clientY, cameraX: state.camera.x, cameraY: state.camera.y };
      if (state.pointers.size === 2) {
        const points = [...state.pointers.values()];
        state.drag.pinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        state.drag.pinchScale = state.camera.scale;
      }
      els.svg.classList.add('dragging');
    });
    els.svg.addEventListener('pointermove', (event) => {
      if (!state.pointers.has(event.pointerId) || !state.drag) return;
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const dx = event.clientX - state.drag.startX;
      const dy = event.clientY - state.drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) state.moved = true;
      if (state.pointers.size === 1) {
        state.camera.x = state.drag.cameraX + dx;
        state.camera.y = state.drag.cameraY + dy;
        updateCamera();
      } else if (state.pointers.size === 2) {
        const points = [...state.pointers.values()];
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        const midpointX = (points[0].x + points[1].x) / 2;
        const midpointY = (points[0].y + points[1].y) / 2;
        zoomAt((state.drag.pinchScale * distance / state.drag.pinchDistance) / state.camera.scale, midpointX, midpointY);
      }
    });
    const endPointer = (event) => {
      state.pointers.delete(event.pointerId);
      if (!state.pointers.size) {
        state.drag = null;
        els.svg.classList.remove('dragging');
        setTimeout(() => { state.moved = false; }, 0);
      }
    };
    els.svg.addEventListener('pointerup', endPointer);
    els.svg.addEventListener('pointercancel', endPointer);
    window.addEventListener('resize', () => { clearTimeout(state.resizeTimer); state.resizeTimer = setTimeout(fitTree, 130); });
  }

  function yearRange() {
    const years = [];
    for (const person of state.people.values()) {
      for (const value of [person.birth, person.death]) {
        const year = Number(yearFrom(value));
        if (year) years.push(year);
      }
    }
    return years.length ? `${Math.min(...years)}–${Math.max(...years)}` : 'XVII–XXI вв.';
  }

  async function init() {
    bindEvents();
    try {
      const response = await fetch('../../data/gulyaevy.ged', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = parseGedcom(await response.text());
      state.people = parsed.people;
      state.families = parsed.families;
      if (!state.people.size) throw new Error('В GEDCOM нет записей о людях');

      const params = new URLSearchParams(location.search);
      const requested = params.get('person');
      const pavel = state.people.get('@I297@') || [...state.people.values()].find((person) => person.name.includes('Павел Павлович') && person.surname.includes('Гуляев'));
      state.root = requested && state.people.has(requested) ? requested : (pavel?.id || state.people.keys().next().value);
      state.selected = state.root;
      state.direction = ['ancestors', 'descendants'].includes(params.get('view')) ? params.get('view') : 'ancestors';
      state.scope = ['direct', 'all'].includes(params.get('scope')) ? params.get('scope') : 'direct';
      state.depth = clamp(Number(params.get('depth')) || 8, 3, 10);

      els.peopleCount.textContent = state.people.size;
      els.familiesCount.textContent = state.families.size;
      els.yearsRange.textContent = yearRange();
      applyControls();
      updateUrl();
      renderPeople();
      renderDetails(personById(state.root));
      els.drawer.classList.add('open');
      drawGraph();
    } catch (error) {
      console.error(error);
      els.loading.hidden = true;
      els.error.hidden = false;
      els.errorText.textContent = `Не удалось прочитать данные: ${error.message}`;
    }
  }

  init();
})();
