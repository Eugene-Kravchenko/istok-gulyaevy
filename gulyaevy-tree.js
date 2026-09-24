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
    sidebar: $('#cabinetSidebar'), backdrop: $('#sidebarBackdrop'), branchToggle: $('#branchToggle'),
    branchPanel: $('#branchPanel'), branchList: $('#branchList'), branchCount: $('#branchCount'), branchTotal: $('#branchTotal')
  };

  const state = {
    people: new Map(), families: new Map(), root: '', selected: '', direction: 'ancestors', scope: 'direct',
    graph: null, components: [], expandedBranch: -1, camera: { x: 0, y: 0, scale: 1 }, pointers: new Map(), drag: null, moved: false, resizeTimer: 0, stageWidth: 0, hovered: ''
  };

  const CARD_W = 196;
  const CARD_H = 110;
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

  function readableDate(value) {
    const date = compact(value);
    const between = date.match(/^BET (.+) AND (.+)$/i);
    if (between) return `между ${readableDate(between[1])} и ${readableDate(between[2])}`;
    const qualifiers = { ABT: 'около', BEF: 'до', AFT: 'после', EST: 'примерно', CAL: 'примерно' };
    const qualified = date.match(/^(ABT|BEF|AFT|EST|CAL) (.+)$/i);
    if (qualified) return `${qualifiers[qualified[1].toUpperCase()]} ${readableDate(qualified[2])}`;
    const months = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
    const full = date.match(/^(\d{1,2}) ([A-Z]{3}) (\d{4})$/i);
    if (full && months[full[2].toUpperCase()]) return `${full[1].padStart(2, '0')}.${months[full[2].toUpperCase()]}.${full[3]}`;
    return date;
  }

  function life(person, detailed = false) {
    const birth = person.birth || '';
    const death = person.death || '';
    if (detailed) {
      if (!birth && !death) return '';
      return compact(`${birth ? `р. ${readableDate(birth)}` : ''}${birth && death ? ' · ' : ''}${death ? `ум. ${readableDate(death)}` : ''}`);
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

  function buildComponents() {
    const neighbors = new Map([...state.people.keys()].map((id) => [id, new Set()]));
    for (const family of state.families.values()) {
      const members = [family.husband, family.wife, ...family.children].filter((id) => neighbors.has(id));
      for (const id of members.slice(1)) {
        neighbors.get(members[0]).add(id);
        neighbors.get(id).add(members[0]);
      }
    }
    const seen = new Set();
    const components = [];
    for (const id of neighbors.keys()) {
      if (seen.has(id)) continue;
      const members = [id];
      seen.add(id);
      for (let index = 0; index < members.length; index++) {
        for (const relative of neighbors.get(members[index])) {
          if (!seen.has(relative)) { seen.add(relative); members.push(relative); }
        }
      }
      components.push(members);
    }
    return components.sort((a, b) => b.length - a.length);
  }

  function orderedComponents() {
    return [...state.components].sort((a, b) =>
      Number(b.includes(state.root)) - Number(a.includes(state.root)) || b.length - a.length);
  }

  function branchRepresentative(members) {
    if (members.includes(state.root)) return state.root;
    return members.find((id) => personById(id)?.surname.includes('Черепанов')) || members[0];
  }

  function setBranchPanel(open) {
    els.branchPanel.hidden = !open || state.scope !== 'all';
    els.branchToggle.setAttribute('aria-expanded', String(!els.branchPanel.hidden));
    els.branchToggle.setAttribute('aria-label', els.branchPanel.hidden ? 'Открыть список ветвей' : 'Закрыть список ветвей');
  }

  function renderBranchPanel() {
    els.branchCount.textContent = state.components.length;
    els.branchTotal.textContent = state.people.size;
    els.branchList.replaceChildren();
    for (const [index, members] of orderedComponents().entries()) {
      const representativeId = branchRepresentative(members);
      const representative = personById(representativeId);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'branch-item';
      button.dataset.branchIndex = index;
      button.setAttribute('aria-expanded', String(state.expandedBranch === index));
      button.classList.toggle('active', members.includes(state.selected));
      const name = document.createElement('strong');
      name.textContent = representative?.name || 'Ветвь без названия';
      button.title = name.textContent;
      const count = document.createElement('span');
      count.textContent = members.length;
      button.append(name, count);
      els.branchList.appendChild(button);
      const people = document.createElement('div');
      people.className = 'branch-members';
      people.hidden = state.expandedBranch !== index;
      for (const id of [...members].sort((a, b) => {
        const personA = personById(a);
        const personB = personById(b);
        return (Number(yearFrom(personA?.birth)) || 9999) - (Number(yearFrom(personB?.birth)) || 9999)
          || personA.name.localeCompare(personB.name, 'ru');
      })) {
        const person = personById(id);
        const entry = document.createElement('button');
        entry.type = 'button';
        entry.className = 'branch-person';
        entry.dataset.personId = id;
        entry.title = person.name;
        const label = document.createElement('span');
        label.textContent = person.name;
        const year = document.createElement('small');
        year.textContent = yearFrom(person.birth) || '';
        entry.append(label, year);
        people.appendChild(entry);
      }
      els.branchList.appendChild(people);
    }
  }

  function updateBranchSelection() {
    const components = orderedComponents();
    els.branchList.querySelectorAll('.branch-item').forEach((button) => {
      button.classList.toggle('active', components[Number(button.dataset.branchIndex)]?.includes(state.selected));
    });
    els.branchList.querySelectorAll('.branch-person').forEach((button) => {
      button.classList.toggle('active', button.dataset.personId === state.selected);
    });
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
      if (state.direction === 'descendants') {
        for (const { person: spouse } of spousesOf(current.person)) {
          addGraphNode(nodes, spouse, current.generation, true);
          directIds.add(spouse.id);
        }
      }
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

    if (state.scope === 'all') {
      for (const person of state.people.values()) addGraphNode(nodes, person, 0, directIds.has(person.id));
    }

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

  function layoutGraph(graph) {
    if (state.scope === 'all') return layoutCombined(graph);
    if (state.direction === 'ancestors') return layoutPedigree(graph);
    return layoutDescendants(graph);
  }

  // Keep the selected person on one card. Their ancestors rise above it and
  // their families descend below it, as in a conventional focused pedigree.
  function layoutCombined(graph) {
    const ancestors = layoutPedigree(graph);
    const descendants = layoutDescendants(graph);
    const ancestorRoot = ancestors.nodes.get(state.root);
    const descendantRoot = descendants.nodes.get(state.root);
    const relativeX = ancestorRoot.x - descendantRoot.x;
    const relativeY = ancestorRoot.y - descendantRoot.y;
    const siblingFamilies = familiesAsChild(personById(state.root));
    const siblingIds = [...new Set(siblingFamilies.flatMap(({ family }) => family.children))]
      .filter((id) => id !== state.root && state.people.has(id));
    const siblingStart = siblingIds.length ? ancestorRoot.x - siblingIds.length * (CARD_W + 16) : PAD;
    const offsetX = Math.max(0, PAD - Math.min(PAD, relativeX + PAD, siblingStart));
    const shifted = (node, x, y) => ({ ...node, x: node.x + x, y: node.y + y });
    const renderNodes = ancestors.renderNodes.map((node) => shifted(node, offsetX, 0));
    for (const node of descendants.renderNodes) {
      if (node.id === state.root && node === descendantRoot) continue;
      renderNodes.push(shifted(node, offsetX + relativeX, relativeY));
    }
    siblingIds.forEach((id, index) => renderNodes.push({
      id, person: personById(id), x: siblingStart + offsetX + index * (CARD_W + 16),
      y: ancestorRoot.y, direct: false
    }));
    const nodes = new Map();
    renderNodes.forEach((node) => { if (!nodes.has(node.id)) nodes.set(node.id, node); });
    const families = [
      ...ancestors.families.map((family) => ({ ...family, transform: `translate(${offsetX} 0)` })),
      ...descendants.families.map((family) => ({ ...family, transform: `translate(${offsetX + relativeX} ${relativeY})` }))
    ];
    for (const { family } of siblingFamilies) {
      const ids = siblingIds.filter((id) => family.children.includes(id));
      if (!ids.length) continue;
      const rootCenter = ancestorRoot.x + offsetX + CARD_W / 2;
      const busY = ancestorRoot.y - (184 - CARD_H) / 2;
      const paths = [];
      ids.forEach((id) => {
        const sibling = nodes.get(id);
        const siblingCenter = sibling.x + CARD_W / 2;
        paths.push({ type: 'family', d: `M ${rootCenter} ${busY} H ${siblingCenter} V ${sibling.y}` });
      });
      families.push({ id: `${family.id}:siblings`, parents: [family.husband, family.wife].filter(Boolean),
        children: ids, direct: false, clan: familyClan(family), paths });
    }
    const right = Math.max(ancestors.width + offsetX, descendants.width + offsetX + relativeX);
    const bottom = Math.max(ancestors.height, descendants.height + relativeY);
    return { ...graph, nodes, renderNodes, families, width: right, height: bottom };
  }

  function layoutDescendants(graph) {
    const cardGap = 24;
    const branchGap = 42;
    const levelHeight = 192;
    let deepest = 0;
    const makeUnit = (personId, family, generation, path) => {
      deepest = Math.max(deepest, generation);
      const spouseId = family ? [family.husband, family.wife].find((id) => id && id !== personId && state.people.has(id)) : '';
      const memberIds = [personId, spouseId].filter(Boolean);
      const nextPath = new Set(path);
      nextPath.add(personId);
      const children = [];
      if (family) for (const childId of family.children) {
        if (!state.people.has(childId) || nextPath.has(childId)) continue;
        const child = personById(childId);
        const childFamilies = familiesAsSpouse(child);
        if (childFamilies.length) childFamilies.forEach((nextFamily) => {
          children.push({ id: childId, unit: makeUnit(childId, nextFamily, generation + 1, nextPath) });
        });
        else children.push({ id: childId, unit: makeUnit(childId, null, generation + 1, nextPath) });
      }
      const cardsWidth = memberIds.length * CARD_W + Math.max(0, memberIds.length - 1) * cardGap;
      const childrenWidth = children.reduce((sum, entry) => sum + entry.unit.width, 0)
        + Math.max(0, children.length - 1) * branchGap;
      return { personId, memberIds, family, generation, children, width: Math.max(cardsWidth, childrenWidth) };
    };
    const rootFamilies = familiesAsSpouse(personById(state.root));
    const roots = (rootFamilies.length ? rootFamilies : [null]).map((family) => makeUnit(state.root, family, 0, new Set()));
    const renderNodes = [];
    const firstById = new Map();
    const families = [];
    const place = (unit, left) => {
      const middle = left + unit.width / 2;
      const cardsWidth = unit.memberIds.length * CARD_W + Math.max(0, unit.memberIds.length - 1) * cardGap;
      const firstX = middle - cardsWidth / 2;
      const y = PAD + unit.generation * levelHeight;
      const cards = new Map();
      unit.memberIds.forEach((id, index) => {
        const node = { id, person: personById(id), x: firstX + index * (CARD_W + cardGap), y, direct: true };
        renderNodes.push(node);
        cards.set(id, node);
        if (!firstById.has(id)) firstById.set(id, node);
      });
      const pathParts = [];
      if (unit.memberIds.length === 2) {
        pathParts.push({ type: 'spouse', d: `M ${firstX + CARD_W} ${y + CARD_H / 2} H ${firstX + CARD_W + cardGap}` });
      }
      const childNodes = [];
      let cursor = left + (unit.width - (unit.children.reduce((sum, entry) => sum + entry.unit.width, 0)
        + Math.max(0, unit.children.length - 1) * branchGap)) / 2;
      for (const entry of unit.children) {
        const childNode = place(entry.unit, cursor);
        childNodes.push({ id: entry.id, node: childNode });
        cursor += entry.unit.width + branchGap;
      }
      if (childNodes.length) {
        const center = middle;
        const busY = y + CARD_H + (levelHeight - CARD_H) / 2;
        const centers = childNodes.map((entry) => entry.node.x + CARD_W / 2);
        pathParts.push({ type: 'family', d: `M ${center} ${y + CARD_H} V ${busY} M ${Math.min(...centers)} ${busY} H ${Math.max(...centers)}` });
        childNodes.forEach((entry) => {
          const foster = Boolean(personById(entry.id).famc.find((ref) => ref.id === unit.family.id && ref.pedi === 'foster'));
          pathParts.push({ type: 'family', foster, d: `M ${entry.node.x + CARD_W / 2} ${busY} V ${entry.node.y}` });
        });
      }
      if (unit.family) families.push({ id: `${unit.family.id}:desc:${families.length}`, parents: unit.memberIds,
        children: unit.children.map((entry) => entry.id), direct: true, clan: familyClan(unit.family), paths: pathParts });
      return cards.get(unit.personId);
    };
    let x = PAD;
    roots.forEach((unit) => { place(unit, x); x += unit.width + 80; });
    return { ...graph, nodes: firstById, renderNodes, families,
      width: x - 80 + PAD, height: PAD * 2 + deepest * levelHeight + CARD_H };
  }

  // Each ancestor couple owns a separate horizontal interval. This keeps
  // connections local to one family instead of sharing a generation-wide bus.
  function layoutPedigree(graph) {
    const gap = 24;
    const branchGap = 42;
    const levelHeight = 184;
    let deepest = 0;
    const makeUnit = (memberIds, generation, familyId, path) => {
      deepest = Math.max(deepest, generation);
      const members = memberIds.filter((id) => state.people.has(id));
      const unit = { memberIds: members, generation, familyId, parents: [], width: members.length * CARD_W + (members.length - 1) * gap };
      for (const childId of members) {
        const person = personById(childId);
        if (path.has(childId)) continue;
        const nextPath = new Set(path);
        nextPath.add(childId);
        for (const { family } of familiesAsChild(person)) {
          const parentIds = [family.husband, family.wife].filter((id) => state.people.has(id));
          if (!parentIds.length) continue;
          unit.parents.push({ childId, unit: makeUnit(parentIds, generation + 1, family.id, nextPath) });
        }
      }
      const parentsWidth = unit.parents.reduce((sum, entry) => sum + entry.unit.width, 0)
        + Math.max(0, unit.parents.length - 1) * branchGap;
      unit.width = Math.max(unit.width, parentsWidth);
      return unit;
    };
    const rootUnit = makeUnit([state.root], 0, '', new Set());
    const renderNodes = [];
    const families = [];
    const firstById = new Map();
    const place = (unit, left) => {
      const middle = left + unit.width / 2;
      const cardsWidth = unit.memberIds.length * CARD_W + Math.max(0, unit.memberIds.length - 1) * gap;
      const firstX = middle - cardsWidth / 2;
      const y = PAD + (deepest - unit.generation) * levelHeight;
      const cardById = new Map();
      unit.memberIds.forEach((id, index) => {
        const node = { id, person: personById(id), x: firstX + index * (CARD_W + gap), y, direct: true };
        renderNodes.push(node);
        cardById.set(id, node);
        if (!firstById.has(id)) firstById.set(id, node);
      });
      if (unit.memberIds.length === 2) {
        families.push({ id: `${unit.familyId}:pair:${renderNodes.length}`, parents: unit.memberIds, children: [], direct: true,
          clan: familyClan(state.families.get(unit.familyId)),
          paths: [{ type: 'spouse', d: `M ${firstX + CARD_W} ${y + CARD_H / 2} H ${firstX + CARD_W + gap}` }] });
      }
      let cursor = left + (unit.width - (unit.parents.reduce((sum, entry) => sum + entry.unit.width, 0)
        + Math.max(0, unit.parents.length - 1) * branchGap)) / 2;
      for (const entry of unit.parents) {
        const ancestor = entry.unit;
        const ancestorCenter = cursor + ancestor.width / 2;
        place(ancestor, cursor);
        const child = cardById.get(entry.childId);
        const sameChild = unit.parents.filter((candidate) => candidate.childId === entry.childId);
        const childX = child.x + CARD_W / 2 + (sameChild.indexOf(entry) - (sameChild.length - 1) / 2) * 48;
        const fromY = PAD + (deepest - ancestor.generation) * levelHeight + CARD_H;
        const midY = fromY + (y - fromY) / 2;
        const parentIds = ancestor.memberIds;
        const foster = Boolean(child.person.famc.find((ref) => ref.id === ancestor.familyId && ref.pedi === 'foster'));
        families.push({ id: `${ancestor.familyId}:link:${families.length}`, parents: parentIds, children: [entry.childId], direct: true,
          clan: familyClan(state.families.get(ancestor.familyId)), paths: [{ type: 'family', foster,
            d: `M ${ancestorCenter} ${fromY} V ${midY} H ${childX} V ${y}` }] });
        cursor += ancestor.width + branchGap;
      }
    };
    place(rootUnit, PAD);
    return { ...graph, nodes: firstById, renderNodes, families,
      width: rootUnit.width + PAD * 2, height: PAD * 2 + deepest * levelHeight + CARD_H };
  }

  function splitName(name) {
    const words = compact(name).split(' ');
    const lines = [''];
    for (const word of words) {
      const current = lines.at(-1);
      if (!current || `${current} ${word}`.length <= 18) lines[lines.length - 1] = compact(`${current} ${word}`);
      else lines.push(word);
    }
    return lines;
  }

  function drawGraph() {
    const graph = layoutGraph(buildGraph());
    state.graph = graph;
    state.hovered = '';
    els.edges.replaceChildren();
    els.nodes.replaceChildren();
    els.treeCard.classList.toggle('all-relatives', state.scope === 'all');
    const desktopTip = $('#stageTip .desktop-tip');
    const mobileTip = $('#stageTip .mobile-tip');
    desktopTip.textContent = state.scope === 'all' ? 'Наведите на человека — выделится его семья · перетаскивайте схему' : 'Колесо — масштаб · перетаскивание — перемещение';
    mobileTip.textContent = state.scope === 'all' ? 'Коснитесь человека · двигайте древо пальцем' : 'Двигайте пальцем · масштабируйте двумя пальцами';

    const defs = svgEl('defs');
    const filter = svgEl('filter', { id: 'nodeShadow', x: '-20%', y: '-20%', width: '140%', height: '150%' });
    filter.appendChild(svgEl('feDropShadow', { dx: '0', dy: '3', stdDeviation: '4', 'flood-color': '#332f25', 'flood-opacity': '.09' }));
    defs.appendChild(filter);
    els.edges.appendChild(defs);

    for (const component of graph.componentBoxes || []) {
      const label = svgEl('g', { class: 'component-label', transform: `translate(${component.x + PAD} 20)` });
      label.appendChild(svgEl('rect', { width: Math.min(component.width - PAD * 2, 285), height: 27, rx: 13 }));
      const caption = svgEl('text', { x: 13, y: 18 });
      caption.textContent = `${component.isRoot ? 'Ветвь выбранного человека' : 'Отдельная ветвь'} · ${component.count}`;
      label.appendChild(caption);
      els.edges.appendChild(label);
    }

    for (const family of graph.families) {
      const familyGroup = svgEl('g', { class: 'family-group', 'data-family-id': family.id });
      if (family.transform) familyGroup.setAttribute('transform', family.transform);
      for (const path of family.paths) {
        const classes = `${path.type}${family.direct ? ' direct' : ''}${path.foster ? ' foster' : ''}`;
        familyGroup.appendChild(svgEl('path', { d: path.d, class: `tree-edge edge-halo ${classes}` }));
        familyGroup.appendChild(svgEl('path', { d: path.d, class: `tree-edge clan-${family.clan} ${classes}` }));
      }
      els.edges.appendChild(familyGroup);
    }

    for (const node of graph.renderNodes || graph.nodes.values()) {
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
      const lineHeight = lines.length > 4 ? 12 : 15;
      const firstLineY = datesText ? Math.max(20, 69 - lines.length * lineHeight) : Math.max(24, 68 - (lines.length - 1) * lineHeight / 2);
      const name = svgEl('text', { class: 'node-name', x: 20, y: firstLineY,
        style: `font-size:${lines.length > 4 ? 11 : lines.length > 3 ? 12 : 13}px` });
      lines.forEach((line, index) => {
        const tspan = svgEl('tspan', { x: 20, dy: index ? lineHeight : 0 });
        tspan.textContent = line;
        name.appendChild(tspan);
      });
      group.appendChild(name);
      if (datesText) {
        const dates = svgEl('text', { class: 'node-life', x: 22, y: CARD_H - 14 });
        dates.textContent = datesText;
        group.appendChild(dates);
      }
      group.addEventListener('click', () => { if (!state.moved) (state.scope === 'all' ? setRoot : selectPerson)(node.id, true); });
      group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); (state.scope === 'all' ? setRoot : selectPerson)(node.id, true); } });
      group.addEventListener('pointerenter', () => setHoveredPerson(node.id));
      group.addEventListener('pointerleave', () => setHoveredPerson(''));
      group.addEventListener('focus', () => setHoveredPerson(node.id));
      group.addEventListener('blur', () => setHoveredPerson(''));
      els.nodes.appendChild(group);
    }

    const mode = state.scope === 'direct' ? (state.direction === 'ancestors' ? 'Прямые предки' : 'Прямые потомки') : 'Все люди';
    const direction = state.direction === 'ancestors' ? 'предки' : 'потомки';
    els.summary.textContent = state.scope === 'all'
      ? `На схеме ${graph.nodes.size} ${plural(graph.nodes.size, ['человек', 'человека', 'человек'])} · в базе ${state.people.size} · выберите человека для перехода`
      : `${mode} · ${direction} · ${graph.nodes.size} ${plural(graph.nodes.size, ['человек', 'человека', 'человек'])} на схеме`;
    els.svg.removeAttribute('hidden');
    els.loading.hidden = true;
    updateFamilyFocus();
    requestAnimationFrame(() => {
      focusRoot();
      state.stageWidth = els.stage.clientWidth;
    });
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
    const drawerHeight = els.drawer.classList.contains('open') && els.stage.clientWidth <= 760 ? els.drawer.offsetHeight : 0;
    return { width: Math.max(260, els.stage.clientWidth - drawerWidth), height: Math.max(120, els.stage.clientHeight - drawerHeight) };
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
    const scale = clamp(Math.min((size.width - 44) / state.graph.width, (size.height - 44) / state.graph.height), .02, 1.15);
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
    const readableScale = state.scope === 'all' ? (els.stage.clientWidth < 620 ? .56 : .72) : .82;
    const scale = clamp(Math.max(fitScale, readableScale), .18, 1);
    state.camera.scale = scale;
    state.camera.x = size.width / 2 - (node.x + CARD_W / 2) * scale;
    state.camera.y = state.scope === 'all'
      ? size.height * (els.stage.clientWidth < 620 ? .56 : .64) - (node.y + CARD_H / 2) * scale
      : state.direction === 'ancestors'
      ? (els.stage.clientWidth < 620
        ? Math.min(els.stage.clientHeight * .45, 260) - (node.y + CARD_H / 2) * scale
        : size.height - 38 - (node.y + CARD_H) * scale)
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
    const newScale = clamp(oldScale * factor, .02, 2.4);
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
    els.branchToggle.hidden = state.scope !== 'all';
    if (state.scope !== 'all') setBranchPanel(false);
    const fitButton = $('#fitTree');
    fitButton.setAttribute('aria-label', 'Показать древо целиком');
    fitButton.title = fitButton.getAttribute('aria-label');
    $('#pageHelp').textContent = state.scope === 'all'
      ? `Предки, братья, сёстры, супруги и потомки выбранного человека показаны одной схемой. Все ${state.people.size} записей доступны через поиск.`
      : 'Исследуйте прямую линию предков или откройте боковые ветви семьи.';
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
    state.expandedBranch = -1;
    renderBranchPanel();
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
    state.hovered = '';
    updateBranchSelection();
    if (state.scope === 'all') setBranchPanel(false);
    renderDetails(person);
    if (openDrawer) els.drawer.classList.add('open');
    if (state.graph?.nodes.has(id)) {
      drawSelection();
      if (openDrawer) requestAnimationFrame(() => revealPerson(id));
    }
  }

  function revealPerson(id) {
    const node = state.graph?.nodes.get(id);
    if (!node) return;
    const { width, height } = visibleStageSize();
    const left = state.camera.x + node.x * state.camera.scale;
    const top = state.camera.y + node.y * state.camera.scale;
    const right = left + CARD_W * state.camera.scale;
    const bottom = top + CARD_H * state.camera.scale;
    if (left >= 12 && right <= width - 12 && top >= 12 && bottom <= height - 12) return;
    state.camera.x = width / 2 - (node.x + CARD_W / 2) * state.camera.scale;
    state.camera.y = height / 2 - (node.y + CARD_H / 2) * state.camera.scale;
    updateCamera();
  }

  function setHoveredPerson(id) {
    if (state.scope !== 'all' || state.hovered === id) return;
    state.hovered = id;
    updateFamilyFocus();
  }

  function updateFamilyFocus() {
    if (!state.graph) return;
    const focusId = state.hovered && state.graph.nodes.has(state.hovered) ? state.hovered : state.selected;
    const touchingFamilies = state.graph.families
      .filter((family) => family.parents.includes(focusId) || family.children.includes(focusId));
    const activeFamilies = new Set(touchingFamilies.map((family) => family.id));
    const activePeople = new Set([focusId]);
    for (const family of state.graph.families) {
      if (activeFamilies.has(family.id)) [...family.parents, ...family.children].forEach((id) => activePeople.add(id));
    }
    els.edges.querySelectorAll('.family-group').forEach((group) => {
      const focused = activeFamilies.has(group.getAttribute('data-family-id'));
      group.classList.toggle('is-focused', focused);
      if (focused) els.edges.appendChild(group);
    });
    els.nodes.querySelectorAll('.tree-node').forEach((group) => {
      group.classList.toggle('is-family-member', activePeople.has(group.getAttribute('data-person-id')));
      group.classList.toggle('is-focus-person', group.getAttribute('data-person-id') === focusId);
    });
    if (state.scope === 'all') els.summary.textContent = `На схеме ${state.graph.nodes.size} человек · в базе ${state.people.size} · ${state.components.length} отдельных ветвей`;
  }

  function drawSelection() {
    els.nodes.querySelectorAll('.tree-node').forEach((group) => {
      group.classList.toggle('selected', group.getAttribute('data-person-id') === state.selected);
    });
    updateFamilyFocus();
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
    $$('[data-scope]').forEach((button) => button.addEventListener('click', () => { state.scope = button.dataset.scope; changeView(); setBranchPanel(false); }));
    els.branchToggle.addEventListener('click', () => setBranchPanel(els.branchPanel.hidden));
    $('#closeBranches').addEventListener('click', () => setBranchPanel(false));
    els.branchList.addEventListener('click', (event) => {
      const person = event.target.closest('.branch-person');
      if (person) { setRoot(person.dataset.personId); setBranchPanel(false); return; }
      const branch = event.target.closest('.branch-item');
      if (!branch) return;
      const index = Number(branch.dataset.branchIndex);
      state.expandedBranch = state.expandedBranch === index ? -1 : index;
      els.branchList.querySelectorAll('.branch-item').forEach((button) => {
        button.setAttribute('aria-expanded', String(Number(button.dataset.branchIndex) === state.expandedBranch));
      });
      els.branchList.querySelectorAll('.branch-members').forEach((people, position) => {
        people.hidden = position !== state.expandedBranch;
      });
    });
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
    window.addEventListener('resize', () => {
      clearTimeout(state.resizeTimer);
      state.resizeTimer = setTimeout(() => {
        const width = els.stage.clientWidth;
        if (!state.stageWidth) {
          state.stageWidth = width;
          return;
        }
        if (Math.abs(width - state.stageWidth) > 40) {
          state.stageWidth = width;
          focusRoot();
        }
      }, 160);
    });
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
      state.components = buildComponents();

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
      renderBranchPanel();
      applyControls();
      setBranchPanel(false);
      updateUrl();
      renderPeople();
      renderDetails(personById(state.root));
      els.drawer.classList.toggle('open', state.scope === 'direct' && els.stage.clientWidth > 760);
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
