const state = {
  report: null,
  items: [],
  selectedIndex: 0,
  viewMode: "route",
  selectedNodeId: undefined,
  treeKey: undefined,
  treeBaseViewBox: undefined,
  treeViewBox: undefined,
  drag: undefined,
};

const els = {
  fileInput: document.querySelector("#fileInput"),
  baseline: document.querySelector("#baseline"),
  recommendations: document.querySelector("#recommendations"),
  selectedType: document.querySelector("#selectedType"),
  selectedTitle: document.querySelector("#selectedTitle"),
  selectedScore: document.querySelector("#selectedScore"),
  statGrid: document.querySelector("#statGrid"),
  details: document.querySelector("#details"),
  treeSvg: document.querySelector("#treeSvg"),
  emptyTree: document.querySelector("#emptyTree"),
  viewModes: [...document.querySelectorAll(".view-mode")],
  zoomIn: document.querySelector("#zoomIn"),
  zoomOut: document.querySelector("#zoomOut"),
  zoomFit: document.querySelector("#zoomFit"),
};

els.fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  loadReport(JSON.parse(await file.text()));
});

for (const button of els.viewModes) {
  button.addEventListener("click", () => {
    state.viewMode = button.dataset.viewMode ?? "route";
    state.treeKey = undefined;
    renderViewModeButtons();
    renderSelected();
  });
}

els.zoomIn.addEventListener("click", () => zoomTree(0.82));
els.zoomOut.addEventListener("click", () => zoomTree(1.22));
els.zoomFit.addEventListener("click", fitTree);

els.treeSvg.addEventListener("wheel", (event) => {
  if (!state.treeViewBox) return;
  event.preventDefault();
  zoomTree(event.deltaY > 0 ? 1.12 : 0.88, svgPoint(event));
}, { passive: false });

els.treeSvg.addEventListener("pointerdown", (event) => {
  if (!state.treeViewBox || event.button !== 0) return;
  state.drag = { x: event.clientX, y: event.clientY };
  els.treeSvg.setPointerCapture(event.pointerId);
  els.treeSvg.classList.add("dragging");
});

els.treeSvg.addEventListener("pointermove", (event) => {
  if (!state.drag || !state.treeViewBox) return;
  const rect = els.treeSvg.getBoundingClientRect();
  const dx = (event.clientX - state.drag.x) * (state.treeViewBox.w / rect.width);
  const dy = (event.clientY - state.drag.y) * (state.treeViewBox.h / rect.height);
  state.treeViewBox = {
    ...state.treeViewBox,
    x: state.treeViewBox.x - dx,
    y: state.treeViewBox.y - dy,
  };
  state.drag = { x: event.clientX, y: event.clientY };
  applyTreeViewBox();
});

for (const eventName of ["pointerup", "pointercancel", "pointerleave"]) {
  els.treeSvg.addEventListener(eventName, () => {
    state.drag = undefined;
    els.treeSvg.classList.remove("dragging");
  });
}

fetch("report.json")
  .then((response) => response.ok ? response.json() : undefined)
  .then((report) => {
    if (report) loadReport(report);
  })
  .catch(() => {});

function loadReport(report) {
  state.report = report;
  state.items = [
    ...(report.ranked ?? []).map((score, index) => ({ kind: "Recommended", score, index })),
    ...(report.rejected ?? []).slice(0, 8).map((rejected, index) => ({ kind: "Near Miss", rejected, index })),
  ];
  state.selectedIndex = 0;
  state.selectedNodeId = undefined;
  state.treeKey = undefined;
  state.treeBaseViewBox = undefined;
  state.treeViewBox = undefined;
  render();
}

function render() {
  renderBaseline();
  renderRecommendations();
  renderViewModeButtons();
  renderSelected();
}

function renderViewModeButtons() {
  for (const button of els.viewModes) {
    button.classList.toggle("active", button.dataset.viewMode === state.viewMode);
  }
}

function renderBaseline() {
  const baseline = state.report?.baseline;
  if (!baseline) {
    els.baseline.innerHTML = "";
    return;
  }
  els.baseline.innerHTML = [
    metric("DPS", number(primaryDps(baseline))),
    metric("EHP", number(baseline.effectiveHitPool)),
    metric("Life", number(baseline.life)),
    metric("Armour", number(baseline.armour)),
    metric("Elemental", `${number(baseline.fireResistance)}/${number(baseline.coldResistance)}/${number(baseline.lightningResistance)}`),
    metric("Chaos", number(baseline.chaosResistance)),
  ].join("");
}

function renderRecommendations() {
  els.recommendations.innerHTML = state.items.map((item, index) => {
    const score = item.score;
    const candidate = score?.candidate ?? item.rejected?.candidate;
    const audit = item.rejected?.audit;
    const final = candidate?.outputs ?? {};
    const dpsDelta = score ? signed(score.dpsDeltaPct, 1) : audit ? signed(audit.dpsDeltaPct, 1) : "n/a";
    const ehpDelta = score ? signed(score.ehpDeltaPct, 1) : deltaPct(state.report.baseline.effectiveHitPool, final.effectiveHitPool);
    const active = index === state.selectedIndex ? " active" : "";
    return `
      <button class="card${active}" data-index="${index}">
        <div class="eyebrow">${item.kind}</div>
        <div class="card-title">${escapeHtml(shortLabel(candidate?.label ?? "Unknown"))}</div>
        <div class="card-meta">
          <span>DPS ${dpsDelta}%</span>
          <span>EHP ${ehpDelta}%</span>
          <span>${resText(final)}</span>
        </div>
      </button>
    `;
  }).join("");
  for (const button of els.recommendations.querySelectorAll(".card")) {
    button.addEventListener("click", () => {
      state.selectedIndex = Number(button.dataset.index);
      state.selectedNodeId = undefined;
      render();
    });
  }
}

function renderSelected() {
  const item = state.items[state.selectedIndex];
  const candidate = item?.score?.candidate ?? item?.rejected?.candidate;
  if (!candidate) {
    drawPassiveDiff(undefined);
    return;
  }

  const score = item.score;
  const audit = item.rejected?.audit;
  const final = candidate.outputs ?? {};
  const baseline = state.report.baseline ?? {};
  els.selectedType.textContent = item.kind;
  els.selectedTitle.textContent = shortLabel(candidate.label ?? "Unknown");
  els.selectedScore.textContent = score ? `Score ${number(score.score)}` : "Rejected";
  els.statGrid.innerHTML = [
    stat("DPS", number(primaryDps(final)), score ? signed(score.dpsDeltaPct, 1) : audit ? signed(audit.dpsDeltaPct, 1) : deltaPct(primaryDps(baseline), primaryDps(final))),
    stat("EHP", number(final.effectiveHitPool), score ? signed(score.ehpDeltaPct, 1) : deltaPct(baseline.effectiveHitPool, final.effectiveHitPool)),
    stat("Elemental", resText(final), ""),
    stat("Chaos", number(final.chaosResistance), delta(final.chaosResistance, baseline.chaosResistance)),
  ].join("");

  const passive = candidate.passiveDiff;
  if (passive?.nodes?.length && !passive.nodes.some((node) => node.id === state.selectedNodeId)) {
    state.selectedNodeId = defaultSelectedNodeId(passive);
  }
  const detailLines = [
    candidate.note,
    score?.explanation,
    ...(score?.warnings ?? []),
    ...(item.rejected?.reasons ?? []).map((reason) => `Rejected: ${reason}`),
    passive ? `Passive action: ${passive.action}, ${passive.pointCount} pts` : undefined,
  ].filter(Boolean);
  const artifacts = [
    candidate.label && candidate.label !== shortLabel(candidate.label)
      ? { label: "Route Text", value: candidate.label }
      : undefined,
    passive?.exportXmlPath
      ? { label: "PoB2 XML", value: passive.exportXmlPath }
      : undefined,
  ].filter(Boolean);
  els.details.innerHTML = [
    renderNodeInspector(passive),
    renderRouteGroups(passive),
    detailLines.length
      ? `<ul class="detail-list">${detailLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
      : `<div class="muted">No extra details for this recommendation.</div>`,
    renderArtifacts(artifacts),
  ].filter(Boolean).join("");
  bindNodeRows(passive);

  drawPassiveDiff(passive);
}

function drawPassiveDiff(passive) {
  els.treeSvg.innerHTML = "";
  if (!passive?.nodes?.length) {
    state.treeKey = undefined;
    state.treeBaseViewBox = undefined;
    state.treeViewBox = undefined;
    els.emptyTree.style.display = "grid";
    return;
  }
  els.emptyTree.style.display = "none";

  const nodes = passive.nodes.filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y));
  if (!nodes.length) {
    els.emptyTree.style.display = "grid";
    els.emptyTree.textContent = "Passive diff has no coordinates.";
    return;
  }

  const boundsNodes = nodesForBounds(nodes, passive);
  const padding = state.viewMode === "route" ? 190 : 260;
  const minX = Math.min(...boundsNodes.map((node) => node.x)) - padding;
  const minY = Math.min(...boundsNodes.map((node) => node.y)) - padding;
  const maxX = Math.max(...boundsNodes.map((node) => node.x)) + padding;
  const maxY = Math.max(...boundsNodes.map((node) => node.y)) + padding;
  const baseViewBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  const treeKey = `${state.selectedIndex}:${state.viewMode}`;
  if (state.treeKey !== treeKey) {
    state.treeKey = treeKey;
    state.treeBaseViewBox = baseViewBox;
    state.treeViewBox = { ...baseViewBox };
  } else {
    state.treeBaseViewBox = baseViewBox;
  }
  applyTreeViewBox();

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const ringLayer = svg("g", { class: "rings" });
  for (const group of passive.groups ?? []) {
    if (!group.orbits?.length) continue;
    for (const orbit of group.orbits) {
      ringLayer.appendChild(svg("circle", {
        cx: group.x,
        cy: group.y,
        r: orbitRadius(orbit),
        fill: "none",
        stroke: "rgba(153, 126, 70, 0.22)",
        "stroke-width": "10",
      }));
    }
  }
  els.treeSvg.appendChild(ringLayer);

  const edgeLayer = svg("g", { class: "edges" });
  for (const edge of passive.edges ?? []) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    edgeLayer.appendChild(svg("path", {
      d: edgePath(edge, from, to, passive),
      stroke: edgeColor(edge, passive),
      "stroke-width": "22",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      fill: "none",
      opacity: "0.72",
    }));
  }
  els.treeSvg.appendChild(edgeLayer);

  const nodeLayer = svg("g", { class: "nodes" });
  for (const node of [...nodes].sort((a, b) => nodeLayerRank(a, passive) - nodeLayerRank(b, passive))) {
    const role = nodeRole(node.id, passive);
    const size = nodeSize(node);
    const selected = node.id === state.selectedNodeId;
    const group = svg("g", {
      transform: `translate(${node.x} ${node.y})`,
      class: `tree-node ${role}${selected ? " selected" : ""}`,
      "data-node-id": node.id,
      role: "button",
      tabindex: "0",
      "aria-label": `${node.name}, ${roleLabel(role)}`,
    });
    group.addEventListener("click", () => {
      state.selectedNodeId = node.id;
      renderSelected();
    });
    group.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      state.selectedNodeId = node.id;
      renderSelected();
    });
    group.appendChild(svg("circle", {
      r: String(size.outer + 30),
      fill: "rgba(0,0,0,0.5)",
    }));
    if (selected) {
      group.appendChild(svg("circle", {
        r: String(size.outer + 48),
        fill: "none",
        stroke: "#ffe7a4",
        "stroke-width": "12",
        opacity: "0.78",
        class: "selected-node-ring",
      }));
    }
    appendNodeIcon(group, node, role, size);
    appendNodeFrame(group, node, role, size);
    group.appendChild(svg("circle", {
      r: String(size.outer * 0.62),
      fill: "none",
      stroke: strokeForRole(role),
      "stroke-width": role === "refund" ? "9" : "7",
      opacity: role === "baseline" ? "0.42" : "0.76",
    }));
    group.appendChild(svg("circle", {
      r: String(Math.max(4, size.inner * 0.3)),
      fill: coreFillForRole(role),
      opacity: role === "baseline" ? "0.62" : "0.82",
    }));
    group.appendChild(svg("title", {}, `${node.name}\n${(node.stats ?? []).join("\n")}`));
    group.appendChild(svg("circle", {
      r: String(size.outer + 42),
      fill: "rgba(0, 0, 0, 0.001)",
      class: "node-hit",
    }));
    nodeLayer.appendChild(group);
  }
  els.treeSvg.appendChild(nodeLayer);
}

function zoomTree(factor, center = undefined) {
  if (!state.treeViewBox) return;
  const current = state.treeViewBox;
  const point = center ?? { x: current.x + current.w / 2, y: current.y + current.h / 2 };
  const nextW = Math.max(120, Math.min((state.treeBaseViewBox?.w ?? current.w) * 2.6, current.w * factor));
  const nextH = Math.max(120, Math.min((state.treeBaseViewBox?.h ?? current.h) * 2.6, current.h * factor));
  const px = (point.x - current.x) / current.w;
  const py = (point.y - current.y) / current.h;
  state.treeViewBox = {
    x: point.x - nextW * px,
    y: point.y - nextH * py,
    w: nextW,
    h: nextH,
  };
  applyTreeViewBox();
}

function fitTree() {
  if (!state.treeBaseViewBox) return;
  state.treeViewBox = { ...state.treeBaseViewBox };
  applyTreeViewBox();
}

function applyTreeViewBox() {
  const viewBox = state.treeViewBox;
  if (!viewBox) return;
  els.treeSvg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`);
}

function svgPoint(event) {
  const viewBox = state.treeViewBox;
  const rect = els.treeSvg.getBoundingClientRect();
  if (!viewBox || !rect.width || !rect.height) return undefined;
  return {
    x: viewBox.x + ((event.clientX - rect.left) / rect.width) * viewBox.w,
    y: viewBox.y + ((event.clientY - rect.top) / rect.height) * viewBox.h,
  };
}

function nodeLayerRank(node, passive) {
  return {
    baseline: 0,
    route: 1,
    refund: 2,
    target: 3,
  }[nodeRole(node.id, passive)] ?? 0;
}

function defaultSelectedNodeId(passive) {
  return passive.allocateNodeIds?.[0]
    ?? passive.routeNodeIds?.[0]
    ?? passive.refundNodeIds?.[0]
    ?? passive.nodes?.[0]?.id;
}

function renderNodeInspector(passive) {
  if (!passive?.nodes?.length) return "";
  const node = passive.nodes.find((candidate) => candidate.id === state.selectedNodeId)
    ?? passive.nodes.find((candidate) => candidate.id === defaultSelectedNodeId(passive));
  if (!node) return "";
  const role = nodeRole(node.id, passive);
  return `
    <section class="node-inspector ${role}">
      <div class="inspector-kicker">${escapeHtml(roleLabel(role))}</div>
      <div class="inspector-title">${escapeHtml(node.name ?? `Passive ${node.id}`)}</div>
      <div class="inspector-meta">
        <span>${escapeHtml(node.type ?? "Passive")}</span>
        <span>ID ${escapeHtml(node.id)}</span>
      </div>
      ${renderStats(node.stats, "inspector-stats")}
    </section>
  `;
}

function renderRouteGroups(passive) {
  if (!passive?.nodes?.length) return "";
  const groups = [
    { label: "Allocate", ids: passive.allocateNodeIds ?? [], role: "target" },
    { label: "Path", ids: (passive.routeNodeIds ?? []).filter((id) => !(passive.allocateNodeIds ?? []).includes(id)), role: "route" },
    { label: "Refund", ids: passive.refundNodeIds ?? [], role: "refund" },
  ];
  const nodeById = new Map(passive.nodes.map((node) => [node.id, node]));
  return `
    <section class="route-groups">
      ${groups.map((group) => renderRouteGroup(group, nodeById)).filter(Boolean).join("")}
    </section>
  `;
}

function renderRouteGroup(group, nodeById) {
  const nodes = group.ids.map((id) => nodeById.get(id)).filter(Boolean);
  if (!nodes.length) return "";
  return `
    <div class="route-group">
      <div class="route-group-title">${escapeHtml(group.label)}</div>
      <div class="node-list">
        ${nodes.map((node) => renderNodeRow(node, group.role)).join("")}
      </div>
    </div>
  `;
}

function renderNodeRow(node, role) {
  const selected = node.id === state.selectedNodeId ? " selected" : "";
  const stats = (node.stats ?? []).slice(0, 2).join(" · ");
  return `
    <button class="node-row ${role}${selected}" data-node-id="${escapeHtml(node.id)}" type="button">
      <span class="node-dot ${role}"></span>
      <span class="node-row-copy">
        <span class="node-row-title">${escapeHtml(node.name ?? `Passive ${node.id}`)}</span>
        ${stats ? `<span class="node-row-stats">${escapeHtml(stats)}</span>` : ""}
      </span>
    </button>
  `;
}

function bindNodeRows(passive) {
  if (!passive?.nodes?.length) return;
  for (const button of els.details.querySelectorAll(".node-row")) {
    button.addEventListener("click", () => {
      state.selectedNodeId = Number(button.dataset.nodeId);
      renderSelected();
    });
  }
}

function renderStats(stats, className) {
  if (!stats?.length) return `<div class="${className} muted">No explicit stat text.</div>`;
  return `<ul class="${className}">${stats.map((statText) => `<li>${escapeHtml(statText)}</li>`).join("")}</ul>`;
}

function renderArtifacts(artifacts) {
  if (!artifacts.length) return "";
  return `
    <div class="artifact-list">
      ${artifacts.map((artifact) => `
        <details class="artifact-details">
          <summary>${escapeHtml(artifact.label)}</summary>
          <div>${escapeHtml(artifact.value)}</div>
        </details>
      `).join("")}
    </div>
  `;
}

function edgePath(edge, from, to, passive) {
  if (edge.orbit === 0 && from.group === to.group && from.orbit === to.orbit) {
    const group = (passive.groups ?? []).find((candidate) => candidate.id === from.group);
    if (group) {
      return orbitArcPath(group, from, to);
    }
  }
  if (edge.orbit && edge.orbit !== 0) {
    return curvedEdgePath(edge, from, to);
  }
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

function orbitArcPath(group, from, to) {
  const radius = Math.hypot(from.x - group.x, from.y - group.y);
  const startAngle = Math.atan2(from.y - group.y, from.x - group.x);
  const endAngle = Math.atan2(to.y - group.y, to.x - group.x);
  let delta = endAngle - startAngle;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const sweep = delta >= 0 ? 1 : 0;
  const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
  return `M ${from.x} ${from.y} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${to.x} ${to.y}`;
}

function curvedEdgePath(edge, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const bend = Math.min(Math.abs(edge.orbit) * 24 + 40, distance * 0.42) * Math.sign(edge.orbit);
  const cx = (from.x + to.x) / 2 + (dy / distance) * bend;
  const cy = (from.y + to.y) / 2 - (dx / distance) * bend;
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
}

function nodesForBounds(nodes, passive) {
  if (state.viewMode !== "route") return nodes;
  const routeIds = new Set([...passive.routeNodeIds, ...passive.allocateNodeIds]);
  const primaryIds = connectedPrimaryRouteIds(passive, routeIds);
  const focused = nodes.filter((node) => primaryIds.has(node.id));
  return focused.length >= 2 ? focused : nodes;
}

function connectedPrimaryRouteIds(passive, routeIds) {
  const start = passive.allocateNodeIds.find((id) => routeIds.has(id)) ?? passive.routeNodeIds.find((id) => routeIds.has(id));
  if (start === undefined) return routeIds;
  const adjacency = new Map();
  for (const edge of passive.edges ?? []) {
    if (!routeIds.has(edge.from) || !routeIds.has(edge.to)) continue;
    if (passive.refundNodeIds.includes(edge.from) || passive.refundNodeIds.includes(edge.to)) continue;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from).push(edge.to);
    adjacency.get(edge.to).push(edge.from);
  }
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size >= 2 ? seen : routeIds;
}

function edgeColor(edge, passive) {
  if (passive.refundNodeIds.includes(edge.from) || passive.refundNodeIds.includes(edge.to)) return "#a9433e";
  if (passive.allocateNodeIds.includes(edge.from) || passive.allocateNodeIds.includes(edge.to)) return "#4cae68";
  return "#4f87c5";
}

function nodeRole(id, passive) {
  if (passive.refundNodeIds.includes(id)) return "refund";
  if (passive.allocateNodeIds.includes(id)) return "target";
  if (passive.routeNodeIds.includes(id)) return "route";
  return "baseline";
}

function roleLabel(role) {
  return {
    refund: "Refund",
    target: "Allocate",
    route: "Path",
    baseline: "Current",
  }[role] ?? "Passive";
}

function fillForRole(role) {
  return {
    refund: "rgba(144, 42, 36, 0.92)",
    target: "rgba(48, 137, 76, 0.94)",
    route: "rgba(55, 102, 158, 0.92)",
    baseline: "rgba(105, 91, 64, 0.88)",
  }[role];
}

function coreFillForRole(role) {
  return {
    refund: "#c94c43",
    target: "#4fd27f",
    route: "#62adff",
    baseline: "#b59c62",
  }[role];
}

function strokeForRole(role) {
  return {
    refund: "#ffb0a8",
    target: "#b8ffd0",
    route: "#bbdcff",
    baseline: "#c1aa72",
  }[role];
}

function appendNodeIcon(parent, node, role, size) {
  if (!node.iconSprite) return;
  const sprite = node.iconSprite;
  const iconSize = nodeIconSize(node, size);
  const image = svg("svg", {
    x: -iconSize / 2,
    y: -iconSize / 2,
    width: iconSize,
    height: iconSize,
    viewBox: `${sprite.x} ${sprite.y} ${sprite.w} ${sprite.h}`,
    class: `node-icon ${role}`,
  });
  image.appendChild(svg("image", {
    href: "tree-assets/skills.webp",
    x: "0",
    y: "0",
    width: "1029",
    height: "1508",
    preserveAspectRatio: "none",
  }));
  if (role === "refund" || role === "baseline") {
    image.setAttribute("opacity", role === "refund" ? "0.74" : "0.64");
  }
  parent.appendChild(image);
}

function appendNodeFrame(parent, node, role, size) {
  const crop = nodeFrameCrop(node, role);
  const image = svg("svg", {
    x: -size.sprite / 2,
    y: -size.sprite / 2,
    width: size.sprite,
    height: size.sprite,
    viewBox: `${crop.x} ${crop.y} ${crop.w} ${crop.h}`,
    class: `node-frame ${role}`,
  });
  image.appendChild(svg("image", {
    href: "tree-assets/frame.webp",
    x: "0",
    y: "0",
    width: "583",
    height: "542",
    preserveAspectRatio: "none",
  }));
  parent.appendChild(image);
}

function nodeIconSize(node, size) {
  if (node.type === "Keystone") return size.sprite * 0.58;
  if (node.type === "Notable") return size.sprite * 0.54;
  if (node.type === "Socket") return size.sprite * 0.44;
  return size.sprite * 0.46;
}

function nodeFrameCrop(node, role) {
  const overlay = frameCropByKey(frameKeyForNode(node, role));
  if (overlay) return overlay;
  if (node.type === "Keystone") return role === "target"
    ? { x: 505, y: 12, w: 78, h: 80 }
    : { x: 504, y: 302, w: 78, h: 78 };
  if (node.type === "Notable") return role === "target"
    ? { x: 126, y: 0, w: 116, h: 116 }
    : role === "refund"
      ? { x: 0, y: 405, w: 78, h: 76 }
      : { x: 0, y: 0, w: 122, h: 122 };
  if (node.type === "Socket") return role === "target"
    ? { x: 433, y: 37, w: 72, h: 72 }
    : { x: 507, y: 102, w: 76, h: 76 };
  return role === "target"
    ? { x: 210, y: 172, w: 42, h: 44 }
    : role === "refund"
      ? { x: 519, y: 176, w: 43, h: 44 }
      : { x: 364, y: 173, w: 43, h: 44 };
}

function frameKeyForNode(node, role) {
  if (node.frame === "Notable" || node.frame?.startsWith("NotableFrame")) {
    return role === "target" ? "NotableFrameCanAllocate" : role === "refund" ? "NotableFrameUnallocated" : "NotableFrameAllocated";
  }
  if (node.frame === "Keystone" || node.frame?.startsWith("KeystoneFrame")) {
    return role === "target" ? "KeystoneFrameCanAllocate" : role === "refund" ? "KeystoneFrameUnallocated" : "KeystoneFrameAllocated";
  }
  if (node.frame?.startsWith("JewelFrame") || node.type === "Socket") {
    return role === "target" ? "JewelFrameCanAllocate" : role === "refund" ? "JewelFrameUnallocated" : "JewelFrameAllocated";
  }
  return role === "target" ? "PSSkillFrameHighlighted" : role === "refund" ? "PSSkillFrame" : "PSSkillFrameActive";
}

function frameCropByKey(key) {
  return {
    KeystoneFrameAllocated: { x: 504, y: 302, w: 78, h: 78 },
    KeystoneFrameCanAllocate: { x: 505, y: 12, w: 78, h: 80 },
    KeystoneFrameUnallocated: { x: 504, y: 302, w: 78, h: 78 },
    NotableFrameAllocated: { x: 0, y: 0, w: 122, h: 122 },
    NotableFrameCanAllocate: { x: 126, y: 0, w: 116, h: 116 },
    NotableFrameUnallocated: { x: 0, y: 405, w: 78, h: 76 },
    JewelFrameAllocated: { x: 507, y: 102, w: 76, h: 76 },
    JewelFrameCanAllocate: { x: 433, y: 37, w: 72, h: 72 },
    JewelFrameUnallocated: { x: 507, y: 102, w: 76, h: 76 },
    PSSkillFrameActive: { x: 364, y: 173, w: 43, h: 44 },
    PSSkillFrameHighlighted: { x: 210, y: 172, w: 42, h: 44 },
    PSSkillFrame: { x: 519, y: 176, w: 43, h: 44 },
  }[key];
}

function nodeSize(node) {
  if (node.type === "Keystone") return { outer: 74, inner: 42, sprite: 132 };
  if (node.type === "Notable") return { outer: 64, inner: 34, sprite: 124 };
  if (node.type === "Socket") return { outer: 58, inner: 28, sprite: 98 };
  return { outer: 44, inner: 23, sprite: 64 };
}

function orbitRadius(orbit) {
  return {
    1: 0,
    2: 82,
    3: 162,
    4: 335,
    5: 493,
    6: 662,
    7: 846,
    8: 251,
    9: 1080,
    10: 1322,
  }[orbit] ?? 162;
}

function svg(name, attrs = {}, text) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, String(value));
  }
  if (text) element.textContent = text;
  return element;
}

function metric(label, value) {
  return `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div></div>`;
}

function stat(label, value, deltaValue) {
  const bad = String(deltaValue).startsWith("-") ? " bad" : "";
  return `<div class="stat"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="delta${bad}">${deltaValue || "&nbsp;"}</div></div>`;
}

function primaryDps(outputs) {
  return [outputs?.fullDps, outputs?.combinedDps, outputs?.totalDps, outputs?.totalDotDps]
    .find((value) => typeof value === "number" && value > 0);
}

function resText(outputs) {
  return `${number(outputs.fireResistance)}/${number(outputs.coldResistance)}/${number(outputs.lightningResistance)} ele, ${number(outputs.chaosResistance)} chaos`;
}

function number(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(value).toLocaleString()
    : "n/a";
}

function signed(value, digits = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function delta(after, before) {
  if (typeof after !== "number" || typeof before !== "number") return "";
  const value = after - before;
  return `${value >= 0 ? "+" : ""}${Math.round(value).toLocaleString()}`;
}

function deltaPct(before, after) {
  if (!before || !after) return "n/a";
  return signed(((after - before) / before) * 100, 1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function shortLabel(label) {
  return String(label)
    .replace(/\s+via\s+.+?(?=;\s+refund|$)/, "")
    .replace(/;\s+refund\s+.+$/, " · refund package");
}
