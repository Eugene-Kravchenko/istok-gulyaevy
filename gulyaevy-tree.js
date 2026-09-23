(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const ns = 'http://www.w3.org/2000/svg';
  const els = {
    peopleCount: $('#peopleCount'), familiesCount: $('#familiesCount'), yearsRange: $('#yearsRange'),
    scopeDirect: $('#scopeDirect'), searchToggle: $('#searchToggle'),
    searchPanel: $('#searchPanel'), search: $('#personSearch'), searchMeta: $('#searchMeta'),
    peopleList: $('#peopleList'), treeCard: $('#treeCard'), stage: $('#treeStage'), svg: $('#treeSvg'),
    viewport: $('#treeViewport'), edges: $('#treeEdges'), nodes: $('#treeNodes'), loading: $('#loadingState'),
    error: $('#errorState'), errorText: $('#errorText'), zoomValue: $('#zoomValue'), summary: $('#viewSummary'),
    drawer: $('#personDrawer'), detailName: $('#detailName'), details: $('#personDetails'), makeRoot: $('#makeRoot'),
    copy: $('#copyLink'), toast: $('#toast'), dialog: $('#shareDialog'), shareInput: $('#shareInput'),
    sidebar: $('#cabinetSidebar'), backdrop: $('#sidebarBackdrop')
  };

  const state = {
    people: new Map(), families: new Map(), root: '', selected: '', direction: 'ancestors', scope: 'direct',
    graph: null, camera: { x: 0, y: 0, scale: 1 }, pointers: new Map(), drag: null, moved: false, resizeTimer: 0
  };

  const CARD_W = 176;
  const CARD_H = 92;
  const PAD = 44;

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
      if (!birth && !death) return '';
      return compact(`${birth ? `р. ${birth}` : ''}${birth && death ? ' · ' : ''}${death ? `ум. ${death}` : ''}`);
    }
    const born = yearFrom(birth);
    const died = yearFrom(death);
    if (!born && !died) return '';
    return `${born || '?'}–${death ? died || '?' : ''}`;
  }

  function clanOf(person) {
    const familyName = compact(`${person.surname} ${person.name}`).toLowerCase().replaceAll('ё', 'е');
    if (familyName.includes('черепанов')) return 'cherepanov';
    if (familyName.includes('нагорнов')) return 'nagornov';
    if (familyName.includes('аржиловск') || familyName.includes('ржиловск')) return 'arzhilovsky';
    if (familyName.includes('гуляев')) return 'gulyaev';
    return 'related';
  }

  function familyClan(family) {
    const orderedIds = [...family.children, family.husband, family.wife].filter(Boolean);
    for (const id of orderedIds) {
      const clan = clanOf(personById(id) || { surname: '', name: '' });
      if (clan !== 'related') return clan;
    }
    return 'related';
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

    const queue = [{ person: root, generation: 0 }];
    const visited = new Set([root.id]);
    while (queue.length) {
      const current = queue.shift();
      const relatives = state.direction === 'ancestors'
        ? parentsOf(current.person).map((entry) => entry.person)
        : childrenOf(current.person).map((entry) => entry.person);
      for (const relative of relatives) {
        const generation = current.generation + (state.direction === 'ancestors' ? -1 : 1);
        addGraphNode(nodes, relative, generation, true);
        directIds.add(relative.id);
        if (!visited.has(relative.id)) {
          visited.add(relative.id);
          queue.push({ person: relative, generation });
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

    const minGeneration = state.direction === 'ancestors' ? Number.NEGATIVE_INFINITY : 0;
    const maxGeneration = state.direction === 'ancestors' ? 0 : Number.POSITIVE_INFINITY;
    const queue = branchSeeds.map((node) => ({ person: node.person, generation: node.generation }));
    const visited = new Set(branchSeeds.map((node) => node.id));
    while (queue.length) {
      const current = queue.shift();
      if (current.generation >= maxGeneration) continue;
      for (const { person: child } of childrenOf(current.person)) {
        const generation = current.generation + 1;
        if (generation < minGeneration || generation > maxGeneration) continue;
        addGraphNode(nodes, child, generation, false);
        addSpouses(child, generation);
        if (!visited.has(child.id)) { visited.add(child.id); queue.push({ person: child, generation }); }
      }
    }
  }

  function visibleFamilies(graph) {
    const families = [];
    for (const family of state.families.values()) {
      const parents = [family.husband, family.wife].filter((id) => graph.nodes.has(id));
      const children = family.children.filter((id) => graph.nodes.has(id));
      if (!children.length && parents.length < 2) continue;
      if (!parents.length) continue;
      const direct = parents.some((id) => graph.directIds.has(id)) && (children.some((id) => graph.directIds.has(id)) || parents.every((id) => graph.directIds.has(id)));
      families.push({ id: family.id, parents, children, direct });
    }
    return families;
  }

  function buildLayoutUnits(graph, families) {
    const units = new Map();
    const personToUnit = new Map();
    const assigned = new Set();
    const candidates = families
      .filter((family) => family.parents.length === 2)
      .sort((a, b) => Number(b.direct) - Number(a.direct) || b.children.length - a.children.length || a.id.localeCompare(b.id));

    for (const family of candidates) {
      if (family.parents.some((id) => assigned.has(id))) continue;
      const memberIds = [...family.parents].sort((a, b) => {
        const sexA = graph.nodes.get(a)?.person.sex || '';
        const sexB = graph.nodes.get(b)?.person.sex || '';
        return (sexA === 'M' ? -1 : sexB === 'M' ? 1 : 0) || a.localeCompare(b);
      });
      const unit = { id: `couple:${family.id}`, memberIds, width: CARD_W * 2 + 20, height: CARD_H };
      units.set(unit.id, unit);
      memberIds.forEach((id) => { assigned.add(id); personToUnit.set(id, unit.id); });
    }

    for (const node of graph.nodes.values()) {
      if (assigned.has(node.id)) continue;
      const unit = { id: `person:${node.id}`, memberIds: [node.id], width: CARD_W, height: CARD_H };
      units.set(unit.id, unit);
      personToUnit.set(node.id, unit.id);
    }
    return { units, personToUnit };
  }

  function layoutGraph(graph) {
    if (!window.dagre?.graphlib?.Graph) throw new Error('Модуль компоновки древа не загрузился');
    const layout = new window.dagre.graphlib.Graph({ multigraph: true });
    layout.setGraph({
      rankdir: state.direction === 'ancestors' ? 'BT' : 'TB',
      ranker: 'network-simplex',
      acyclicer: 'greedy',
      nodesep: 18,
      edgesep: 10,
      ranksep: 54,
      marginx: PAD,
      marginy: PAD
    });
    layout.setDefaultEdgeLabel(() => ({}));

    const families = visibleFamilies(graph);
    const { units, personToUnit } = buildLayoutUnits(graph, families);
    for (const unit of units.values()) layout.setNode(unit.id, { width: unit.width, height: unit.height });
    for (const family of families) {
      const hubId = `family:${family.id}`;
      layout.setNode(hubId, { width: 4, height: 4 });
      const weight = family.direct ? 18 : 5;
      const parentUnits = [...new Set(family.parents.map((id) => personToUnit.get(id)).filter(Boolean))];
      const childUnits = [...new Set(family.children.map((id) => personToUnit.get(id)).filter(Boolean))];
      if (state.direction === 'ancestors') {
        childUnits.forEach((childId, index) => layout.setEdge(childId, hubId, { minlen: 1, weight }, `child:${family.id}:${index}`));
        parentUnits.forEach((parentId, index) => layout.setEdge(hubId, parentId, { minlen: 1, weight }, `parent:${family.id}:${index}`));
      } else {
        parentUnits.forEach((parentId, index) => layout.setEdge(parentId, hubId, { minlen: 1, weight }, `parent:${family.id}:${index}`));
        childUnits.forEach((childId, index) => layout.setEdge(hubId, childId, { minlen: 1, weight }, `child:${family.id}:${index}`));
      }
    }

    window.dagre.layout(layout);
    for (const unit of units.values()) {
      const placed = layout.node(unit.id);
      const startX = placed.x - unit.width / 2;
      unit.memberIds.forEach((personId, index) => {
        const node = graph.nodes.get(personId);
        node.x = startX + index * (CARD_W + 20);
        node.y = placed.y - CARD_H / 2;
      });
    }
    for (const family of families) {
      const placed = layout.node(`family:${family.id}`);
      family.hub = { x: placed.x, y: placed.y };
      family.clan = familyClan(state.families.get(family.id));
    }
    assignFamilyLanes(families, graph);
    return { ...graph, families, units, width: layout.graph().width, height: layout.graph().height };
  }

  function assignFamilyLanes(families, graph) {
    const groups = new Map();
    for (const family of families) {
      const parents = family.parents.map((id) => graph.nodes.get(id)).filter(Boolean);
      const children = family.children.map((id) => graph.nodes.get(id)).filter(Boolean);
      if (!parents.length || !children.length) continue;
      const parentBottom = Math.max(...parents.map((node) => node.y + CARD_H));
      const childTop = Math.min(...children.map((node) => node.y));
      const centers = [...parents, ...children].map((node) => node.x + CARD_W / 2);
      const top = parentBottom + 12;
      const bottom = childTop - 12;
      const key = `${Math.round(parentBottom)}:${Math.round(childTop)}`;
      const item = { family, left: Math.min(...centers), right: Math.max(...centers), top, bottom, lane: 0 };
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    for (const items of groups.values()) {
      const laneEnds = [];
      items.sort((a, b) => a.left - b.left || a.right - b.right || a.family.id.localeCompare(b.family.id));
      for (const item of items) {
        let lane = laneEnds.findIndex((right) => item.left > right + 18);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = Math.max(laneEnds[lane] ?? Number.NEGATIVE_INFINITY, item.right);
        item.lane = lane;
      }
      const laneCount = laneEnds.length;
      for (const item of items) {
        const available = Math.max(8, item.bottom - item.top);
        item.family.busY = item.top + available * (item.lane + 1) / (laneCount + 1);
      }
    }
  }

  function splitName(name) {
    const words = compact(name).split(' ');
    const lines = [''];
    for (const word of words) {
      const current = lines.at(-1);
      if (!current || `${current} ${word}`.length <= 16) lines[lines.length - 1] = compact(`${current} ${word}`);
      else lines.push(word);
    }
    return lines;
  }

  function familyConnectionPaths(family, graph) {
    const parents = family.parents.map((id) => graph.nodes.get(id)).filter(Boolean).sort((a, b) => a.x - b.x);
    const children = family.children.map((id) => graph.nodes.get(id)).filter(Boolean).sort((a, b) => a.x - b.x);
    const paths = [];
    let trunkX = family.hub.x;
    let trunkStartY = family.hub.y;

    if (parents.length >= 2) {
      const left = parents[0];
      const right = parents.at(-1);
      const spouseY = (left.y + right.y) / 2 + CARD_H / 2;
      const leftEdge = left.x + CARD_W;
      const rightEdge = right.x;
      const adjacent = Math.abs(left.y - right.y) < 2 && rightEdge - leftEdge >= 0 && rightEdge - leftEdge <= 70;
      if (adjacent) {
        trunkX = (leftEdge + rightEdge) / 2;
        trunkStartY = spouseY;
        paths.push({ type: 'spouse', d: `M ${leftEdge} ${spouseY} H ${rightEdge}` });
      } else {
        const leftCenter = left.x + CARD_W / 2;
        const rightCenter = right.x + CARD_W / 2;
        const parentBottom = Math.max(left.y, right.y) + CARD_H;
        const pairBusY = Math.min(family.hub.y, parentBottom + 22);
        trunkX = (leftCenter + rightCenter) / 2;
        trunkStartY = pairBusY;
        paths.push({ type: 'family', d: `M ${leftCenter} ${left.y + CARD_H} V ${pairBusY} M ${rightCenter} ${right.y + CARD_H} V ${pairBusY}` });
        paths.push({ type: 'spouse', d: `M ${leftCenter} ${pairBusY} H ${rightCenter}` });
      }
    } else if (parents.length === 1) {
      trunkX = parents[0].x + CARD_W / 2;
      trunkStartY = parents[0].y + CARD_H;
    }

    if (children.length) {
      const nearestChildY = Math.min(...children.map((child) => child.y));
      const parentBottom = parents.length ? Math.max(...parents.map((parent) => parent.y + CARD_H)) : family.hub.y;
      const busY = family.busY ?? clamp(family.hub.y, parentBottom + 20, nearestChildY - 20);
      paths.push({ type: 'family', d: `M ${trunkX} ${trunkStartY} V ${busY}` });
      const childCenters = children.map((child) => child.x + CARD_W / 2);
      paths.push({ type: 'family', d: `M ${Math.min(...childCenters, trunkX)} ${busY} H ${Math.max(...childCenters, trunkX)}` });
      children.forEach((child) => paths.push({ type: 'family', foster: Boolean(personById(child.id)?.famc.find((ref) => ref.id === family.id && ref.pedi === 'foster')), d: `M ${child.x + CARD_W / 2} ${busY} V ${child.y}` }));
    }
    return paths;
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
    els.edges.appendChild(defs);

    for (const family of graph.families) {
      for (const path of familyConnectionPaths(family, graph)) {
        const classes = `${path.type}${family.direct ? ' direct' : ''}${path.foster ? ' foster' : ''}`;
        els.edges.appendChild(svgEl('path', { d: path.d, class: `tree-edge edge-halo ${classes}`, 'data-family-id': family.id }));
        els.edges.appendChild(svgEl('path', { d: path.d, class: `tree-edge clan-${family.clan} ${classes}`, 'data-family-id': family.id }));
      }
    }

    for (const node of graph.nodes.values()) {
      const clan = clanOf(node.person);
      const classes = ['tree-node', `clan-${clan}`];
      if (!node.direct) classes.push('branch');
      if (node.id === state.root) classes.push('root');
      if (node.id === state.selected) classes.push('selected');
      const datesText = life(node.person);
      const fullLife = life(node.person, true);
      const group = svgEl('g', { class: classes.join(' '), transform: `translate(${node.x} ${node.y})`, role: 'button', tabindex: '0', 'data-person-id': node.id, 'data-clan': clan, 'aria-label': compact(`${node.person.name} ${datesText}`) });
      const title = svgEl('title');
      title.textContent = compact(`${node.person.name}${fullLife ? ` · ${fullLife}` : ''}`);
      group.appendChild(title);
      group.appendChild(svgEl('rect', { class: 'node-card', width: CARD_W, height: CARD_H, rx: 10 }));
      group.appendChild(svgEl('path', { class: 'node-accent', d: `M0 10A10 10 0 0 1 10 0h3v${CARD_H}h-3A10 10 0 0 1 0 ${CARD_H - 10}Z` }));
      const lines = splitName(node.person.name);
      const firstLineY = datesText ? 40 - (lines.length - 1) * 8 : 51 - (lines.length - 1) * 7.5;
      const name = svgEl('text', { class: 'node-name', x: 20, y: firstLineY });
      lines.forEach((line, index) => {
        const tspan = svgEl('tspan', { x: 20, dy: index ? 15 : 0 });
        tspan.textContent = line;
        name.appendChild(tspan);
      });
      group.appendChild(name);
      if (datesText) {
        const dates = svgEl('text', { class: 'node-life', x: 22, y: 78 });
        dates.textContent = datesText;
        group.appendChild(dates);
      }
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
    if (state.scope === 'all' && els.drawer.classList.contains('open')) {
      els.drawer.classList.remove('open');
      requestAnimationFrame(fitTree);
      return;
    }
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
    const readableScale = els.stage.clientWidth < 620 ? .62 : .82;
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
    url.searchParams.delete('depth');
    history.replaceState(null, '', url);
  }

  function applyControls() {
    $$('[data-direction]').forEach((button) => button.classList.toggle('active', button.dataset.direction === state.direction));
    $$('[data-scope]').forEach((button) => button.classList.toggle('active', button.dataset.scope === state.scope));
    els.scopeDirect.textContent = state.direction === 'ancestors' ? 'Прямые предки' : 'Прямые потомки';
  }

  function changeView() {
    applyControls();
    updateUrl();
    if (state.scope === 'all') els.drawer.classList.remove('open');
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
      const relationInfo = foster ? 'приёмная связь' : life(person);
      return `<button class="relation${foster ? ' foster' : ''}" data-detail-person="${esc(person.id)}" type="button"><b>${esc(person.name)}</b>${relationInfo ? `<span>${esc(relationInfo)}</span>` : ''}</button>`;
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
    const detailedLife = life(person, true);
    els.details.innerHTML = `
      ${person.id === state.root ? '<span class="root-mark">● Центр текущего древа</span>' : ''}
      ${detailedLife ? `<p class="life-line">${esc(detailedLife)}</p>` : ''}
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
    els.peopleList.innerHTML = shown.map((person) => {
      const personLife = life(person);
      return `<button class="person-option${person.id === state.root ? ' active' : ''}" data-search-person="${esc(person.id)}" type="button" role="option"><b>${esc(person.name)}</b>${personLife ? `<span>${esc(personLife)}</span>` : ''}</button>`;
    }).join('') || '<p class="empty-small">Совпадений нет</p>';
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
      if (event.target.closest?.('.tree-node')) {
        state.moved = false;
        return;
      }
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

      els.peopleCount.textContent = state.people.size;
      els.familiesCount.textContent = state.families.size;
      els.yearsRange.textContent = yearRange();
      applyControls();
      updateUrl();
      renderPeople();
      renderDetails(personById(state.root));
      els.drawer.classList.toggle('open', state.scope === 'direct');
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
