<script>
  import { onMount } from 'svelte';
  import ForceGraph3D from '3d-force-graph';
  import * as THREE from 'three';

  let { tree, selectedId = null, highlight = [], onSelect } = $props();

  let el;
  // The graph instance lives outside Svelte's reactive system on purpose:
  // 3d-force-graph mutates its own data and runs its own render loop.
  let graph;
  const meshes = new Map(); // node id → THREE.Mesh, for the pulse loop
  let highlightSet = new Set();
  let raf;

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

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

  function makeNodeObject(node) {
    const cfg = LEVEL[node.level] ?? LEVEL.kr;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(cfg.size, 24, 24),
      new THREE.MeshLambertMaterial({ color: cfg.color, transparent: true, opacity: 0.95 })
    );
    mesh.userData.baseColor = new THREE.Color(cfg.color);
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

  export function flyTo(ids, ms = 1200) {
    if (!graph || !ids?.length) return;
    const want = new Set(ids);
    const nodes = graph.graphData().nodes.filter((n) => want.has(n.id) && Number.isFinite(n.x));
    if (!nodes.length) return;
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

  function animate() {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
    for (const [id, mesh] of meshes) {
      const hi = highlightSet.has(id);
      const sel = id === selectedId;
      const target = hi ? 1.3 + 0.35 * pulse : sel ? 1.35 : 1;
      mesh.scale.setScalar(mesh.scale.x + (target - mesh.scale.x) * 0.2);
      const mat = mesh.material;
      if (hi) {
        mat.color.copy(RED).lerp(WHITE, 0.25 * pulse);
        mat.emissive.copy(RED);
        mat.emissiveIntensity = 0.3 + 0.7 * pulse;
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
      .nodeLabel((n) => `<div class="tip"><b>${esc(n.label)}</b><span>${esc(n.owner)}${n.target ? ' · ' + esc(n.target) : ''}</span></div>`)
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
      .onBackgroundClick(() => onSelect?.(null));
    graph.d3Force('charge').strength(-160);

    graph.graphData(toGraphData(tree, null));
    const ro = new ResizeObserver(() => graph.width(el.clientWidth).height(el.clientHeight));
    ro.observe(el);
    setTimeout(() => graph.zoomToFit(900, 60), 700);
    animate();

    return () => {
      cancelAnimationFrame(raf);
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
  });

  $effect(() => {
    highlightSet = new Set(highlight);
    if (highlight.length) flyTo(highlight);
  });
</script>

<div class="graph" bind:this={el}></div>
