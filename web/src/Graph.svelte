<script>
  import { onMount, untrack } from 'svelte';
  import ForceGraph3D from '3d-force-graph';
  import * as THREE from 'three';
  import SpriteText from 'three-spritetext';
  import { unitName } from './lib/company.js';
  import NodeCard from './NodeCard.svelte';

  let {
    tree,
    company = null,
    selectedId = null,
    highlight = [],
    preview = [],
    showTeamLabels = false,
    onSelect
  } = $props();

  let el;
  // The graph instance lives outside Svelte's reactive system on purpose:
  // 3d-force-graph mutates its own data and runs its own render loop.
  let graph;
  const meshes = new Map(); // node id → THREE.Mesh, for the pulse loop
  let highlightSet = new Set();
  // Transient hover pointer from the side panel. Unlike `highlight` it never
  // moves the camera: the mouse is already where the user is looking.
  let previewSet = new Set();
  let raf;
  // Which node the pointer is over — the only part of the hover card that is
  // Svelte state. $state.raw because the force layout mutates these node objects
  // every tick and we only ever swap which one is held, never write through it.
  let hovered = $state.raw(null);
  let hoverTimer;
  let anchorEl = $state(null);
  const HOVER_DELAY = 150; // long enough that sweeping across the tree does not flash cards
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  // { from, to, start, ms } while a programmatic move is re-levelling camera.up.
  let upTween = null;

  const LEVEL = {
    company: { color: '#f5c542', size: 10 },
    objective: { color: '#4f9cff', size: 6.5 },
    kr: { color: '#5ad38a', size: 3.6 }
  };
  const WHITE = new THREE.Color('#ffffff');
  const RED = new THREE.Color('#ff3b30');

  // contributes 0 → red, 1 → green
  function linkColor(c) {
    const t = Math.max(0, Math.min(1, c ?? 0.5));
    return `hsl(${Math.round(120 * t)}, 75%, ${52 - 10 * t}%)`;
  }

  function makeNodeObject(node) {
    const cfg = LEVEL[node.level] ?? LEVEL.kr;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(cfg.size, 24, 24),
      new THREE.MeshLambertMaterial({ color: cfg.color, transparent: true, opacity: 0.95 })
    );
    mesh.userData.baseColor = new THREE.Color(cfg.color);

    // The team label hangs under the sphere as a child of the mesh, so it
    // follows the node without a second layout pass. It is created empty and
    // hidden; the effect below fills it in, because node objects are reused
    // across data updates and this function does not run again for them.
    // (It is seeded here as well, because 3d-force-graph may build the object
    // after the effect has already walked the meshes it knew about.)
    const text = unitName(company, node.unitId) ?? node.owner ?? '';
    const label = new SpriteText(text, 6, '#e6ebf5');
    label.material.depthWrite = false;
    // Anchor the sprite's left edge just right of the sphere, vertically centred.
    label.center.set(0, 0.5);
    label.position.x = cfg.size + 3;
    label.visible = showTeamLabels && !!text;
    mesh.add(label);
    mesh.userData.label = label;

    meshes.set(node.id, mesh);
    return mesh;
  }

  // Reuse existing node objects (they carry x/y/z) so an edit nudges the
  // layout instead of re-heating the whole simulation.
  function toGraphData(t, prev) {
    const prevById = new Map((prev?.nodes ?? []).map((n) => [n.id, n]));
    const nodes = t.nodes.map((n) => {
      const existing = prevById.get(n.id);
      return existing ? Object.assign(existing, n) : { ...n };
    });
    const ids = new Set(nodes.map((n) => n.id));
    const links = t.nodes
      .filter((n) => n.parent && ids.has(n.parent))
      .map((n) => ({ source: n.parent, target: n.id, contributes: n.contributes ?? 0.5 }));
    return { nodes, links };
  }

  // Trackball lets the user roll `camera.up` freely; every programmatic move
  // tweens it back to world up over the flight so the view un-rolls smoothly.
  function levelCamera(ms) {
    if (!graph) return;
    const cam = graph.camera();
    const controls = graph.controls();
    if (!cam || !controls) return;
    const from = cam.up.clone().normalize();
    const view = controls.target.clone().sub(cam.position).normalize();
    // Looking (almost) straight down the tree makes lookAt with up = +Y undefined.
    let to = WORLD_UP.clone();
    if (Math.abs(view.dot(WORLD_UP)) > 0.98) to = new THREE.Vector3(0, 0, -1);
    if (from.distanceToSquared(to) < 1e-6) { upTween = null; return; }
    // Upside down: a straight lerp would pass through the origin, so nudge off the antipode.
    if (from.dot(to) < -0.999) {
      const nudge = view.clone().cross(to);
      if (nudge.lengthSq() < 1e-6) nudge.set(1, 0, 0);
      from.addScaledVector(nudge.normalize(), 0.01).normalize();
    }
    upTween = { from, to, start: performance.now(), ms };
  }

  export function flyTo(ids, ms = 1200) {
    if (!graph || !ids?.length) return;
    clearTimeout(hoverTimer);
    hovered = null;
    const want = new Set(ids);
    const nodes = graph.graphData().nodes.filter((n) => want.has(n.id) && Number.isFinite(n.x));
    if (!nodes.length) return;
    levelCamera(ms);
    const c = { x: 0, y: 0, z: 0 };
    for (const n of nodes) { c.x += n.x; c.y += n.y; c.z += n.z; }
    c.x /= nodes.length; c.y /= nodes.length; c.z /= nodes.length;
    let radius = 0;
    for (const n of nodes) radius = Math.max(radius, Math.hypot(n.x - c.x, n.y - c.y, n.z - c.z));
    const dist = Math.max(140, radius * 2.2 + 120);
    // Approach along the camera's current bearing so the move feels continuous.
    const cam = graph.cameraPosition();
    const dir = new THREE.Vector3(cam.x - c.x, cam.y - c.y, cam.z - c.z);
    if (dir.length() < 1) dir.set(0, 0.3, 1);
    dir.normalize();
    graph.cameraPosition({ x: c.x + dir.x * dist, y: c.y + dir.y * dist, z: c.z + dir.z * dist }, c, ms);
  }

  // Frames the whole tree and levels the horizon. The mount-time overview and
  // the `f` shortcut share it so both moves look the same.
  export function frameAll(ms = 900) {
    if (!graph) return;
    clearTimeout(hoverTimer);
    hovered = null;
    graph.zoomToFit(ms, 60);
    levelCamera(ms);
  }

  function animate() {
    if (upTween) {
      const cam = graph?.camera();
      if (!cam) {
        upTween = null;
      } else {
        const t = Math.min(1, (performance.now() - upTween.start) / upTween.ms);
        if (t >= 1) {
          cam.up.copy(upTween.to);
          upTween = null;
        } else {
          // Quadratic.Out, matching the library's position tween.
          const e = 1 - (1 - t) ** 2;
          // Lerp + normalize is fine here: the arc is short and lookAt re-orthogonalises.
          cam.up.copy(upTween.from).lerp(upTween.to, e).normalize();
        }
      }
    }
    // The card rides with its node: one style write a frame beats pushing 60
    // state updates a second through Svelte.
    if (hovered && anchorEl && Number.isFinite(hovered.x)) {
      const { x, y } = graph.graph2ScreenCoords(hovered.x, hovered.y, hovered.z);
      const w = anchorEl.offsetWidth;
      const h = anchorEl.offsetHeight;
      // Beside the sphere, flipped to its left when that would run off the stage.
      let left = x + 14;
      if (left + w > el.clientWidth - 8) left = x - 14 - w;
      left = Math.max(8, Math.min(left, el.clientWidth - w - 8));
      const top = Math.max(8, Math.min(y - 10, el.clientHeight - h - 8));
      anchorEl.style.transform = `translate(${left}px, ${top}px)`;
    }
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
    for (const [id, mesh] of meshes) {
      const hi = highlightSet.has(id);
      const prev = previewSet.has(id);
      const sel = id === selectedId;
      const target = hi ? 1.3 + 0.35 * pulse : prev ? 1.5 : sel ? 1.35 : 1;
      mesh.scale.setScalar(mesh.scale.x + (target - mesh.scale.x) * 0.2);
      const mat = mesh.material;
      if (hi) {
        mat.color.copy(RED).lerp(WHITE, 0.25 * pulse);
        mat.emissive.copy(RED);
        mat.emissiveIntensity = 0.3 + 0.7 * pulse;
      } else if (prev) {
        // Steady white bloom, no pulse — a pointer, not an alarm.
        mat.color.copy(mesh.userData.baseColor).lerp(WHITE, 0.85);
        mat.emissive.copy(WHITE);
        mat.emissiveIntensity = 0.9;
      } else if (sel) {
        mat.color.copy(mesh.userData.baseColor).lerp(WHITE, 0.5);
        mat.emissive.copy(mesh.userData.baseColor);
        mat.emissiveIntensity = 0.5;
      } else {
        mat.color.copy(mesh.userData.baseColor);
        mat.emissiveIntensity = 0;
      }
    }
    raf = requestAnimationFrame(animate);
  }

  onMount(() => {
    graph = ForceGraph3D()(el)
      .backgroundColor('#0b0f17')
      .dagMode('td')
      .dagLevelDistance(90)
      .onDagError((loopIds) => console.warn('DAG cycle, falling back to free layout', loopIds))
      .nodeId('id')
      // No library tooltip: the hover card below says the same things the Detail
      // panel says, as the same component.
      .nodeLabel(() => null)
      .nodeThreeObject(makeNodeObject)
      .linkWidth((l) => 0.5 + 2.8 * (l.contributes ?? 0.5))
      .linkColor((l) => linkColor(l.contributes))
      .linkOpacity(0.9)
      .linkDirectionalParticles((l) => ((l.contributes ?? 0.5) >= 0.4 ? 2 : 0))
      .linkDirectionalParticleWidth(1.4)
      .linkDirectionalParticleSpeed(0.005)
      .d3VelocityDecay(0.3)
      .warmupTicks(80)
      .onNodeClick((n) => { onSelect?.(n.id); flyTo([n.id], 800); })
      // Fires with null on every frame the pointer is over empty space, so it
      // stays cheap: clear a timer, and touch state only on the way in or out.
      .onNodeHover((n) => {
        clearTimeout(hoverTimer);
        if (n) hoverTimer = setTimeout(() => (hovered = n), HOVER_DELAY);
        else if (hovered) hovered = null;
      })
      .onBackgroundClick(() => onSelect?.(null));
    graph.d3Force('charge').strength(-160);
    // Inertia would keep rotating camera.up while we tween it; the tradeoff is
    // that user tumbling no longer coasts.
    graph.controls().staticMoving = true;
    if (import.meta.env.DEV) window.__graph = graph;

    graph.graphData(toGraphData(tree, null));
    const ro = new ResizeObserver(() => graph.width(el.clientWidth).height(el.clientHeight));
    ro.observe(el);
    setTimeout(() => frameAll(900), 700);
    animate();

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(hoverTimer);
      ro.disconnect();
      graph._destructor?.();
    };
  });

  $effect(() => {
    const t = tree;
    if (!graph) return;
    graph.graphData(toGraphData(t, graph.graphData()));
    const alive = new Set(t.nodes.map((n) => n.id));
    for (const id of [...meshes.keys()]) if (!alive.has(id)) meshes.delete(id);
    // A hovered node may have been edited away or edited in place; re-point at
    // whatever the new data holds for it, which also refreshes the card.
    //
    // untrack, and it matters: a tracked read of `hovered` would make this
    // effect depend on the pointer, and graphData() re-heats the force layout
    // (alpha 1, then 80 warmup ticks). Hovering a node would shove the whole
    // tree — the node slid out from under the cursor, the hover cleared, and
    // the clear re-heated it again.
    untrack(() => {
      if (hovered) hovered = graph.graphData().nodes.find((n) => n.id === hovered.id) ?? null;
    });
  });

  // Node objects survive data updates (see toGraphData), so makeNodeObject does
  // not run again for an existing node and the label text has to be rewritten
  // in place — on a tree edit, a team rename, and a dataset switch alike.
  $effect(() => {
    const t = tree;
    const c = company;
    const on = showTeamLabels;
    for (const n of t.nodes) {
      const label = meshes.get(n.id)?.userData.label;
      if (!label) continue;
      const text = unitName(c, n.unitId) ?? n.owner ?? '';
      if (label.text !== text) label.text = text;
      label.visible = on && !!text;
    }
  });

  $effect(() => {
    highlightSet = new Set(highlight);
    if (highlight.length) flyTo(highlight);
  });

  $effect(() => {
    previewSet = new Set(preview);
  });
</script>

<div class="graph" bind:this={el}></div>

<!-- Never for the node whose Detail panel is already open: it would repeat what
     is on screen. -->
{#if hovered && hovered.id !== selectedId}
  <div class="hover-card" bind:this={anchorEl}>
    <NodeCard node={hovered} {company} />
  </div>
{/if}
