import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type PreviewMesh = {
  /** 9 floats per triangle, in the exported (upright) orientation. */
  positions: Float32Array;
  triangleCount: number;
  /** Start triangle of each colour band, lowest first. */
  bandStarts: number[];
  /** One CSS colour per band. */
  colors: string[];
};

type Props = {
  mesh: PreviewMesh | null;
  /** Flat shading shows every facet, which is how a slicer draws it. */
  flatShading: boolean;
  /** Pale backdrop, so dark filament colours stay readable. */
  lightBackground: boolean;
  /** Ground grid under the model, for a sense of scale. */
  showGrid: boolean;
  /** Light it from behind, the way a lithophane is actually looked at. */
  backlit: boolean;
};

/**
 * Backlit shading.
 *
 * A lithophane is read by transmitted light, and transmission falls off
 * exponentially with thickness rather than linearly — Beer-Lambert. Surface
 * shading cannot show that, which is why a picture can look fine on screen and
 * come out muddy once printed.
 *
 * The model is oriented with the base at y = 0 and the relief cut into -y, so
 * a fragment's thickness is exactly -y. No extra data is needed.
 */
const BACKLIT_VERT = `
  varying float vThickness;
  void main() {
    vThickness = -position.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const BACKLIT_FRAG = `
  uniform vec3 uTint;
  uniform float uK;
  varying float vThickness;
  void main() {
    float transmitted = exp(-uK * max(vThickness, 0.0));
    gl_FragColor = vec4(uTint * transmitted, 1.0);
  }
`;

/**
 * Shows the generated mesh exactly as exported — same triangles, same
 * orientation — so faceting and edge quality can be judged without a round
 * trip through a slicer.
 */
export default function MeshPreview({
  mesh,
  flatShading,
  lightBackground,
  showGrid,
  backlit,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const materialsRef = useRef<THREE.Material[]>([]);
  const controlsRef = useRef<OrbitControls | null>(null);
  const fitRef = useRef<(() => void) | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);

  // Scene lives for the lifetime of the panel; only the geometry swaps.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 5000);
    // The exported model stands with +Z up. OrbitControls puts its poles on
    // the camera's up axis, so leaving three's default +Y here would park them
    // sideways: yaw would feel free while pitch hit a wall early.
    camera.up.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    // The backing store is sized in device pixels, so the canvas must be
    // pinned in CSS pixels too — otherwise it lays out at its attribute size
    // and overflows the panel by the pixel ratio on a HiDPI screen.
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-1, -1.4, 0.9);
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x88bbff, 0.7);
    rim.position.set(1.2, 0.8, -0.6);
    scene.add(rim);

    // Material list, one per colour band; filled in when a mesh arrives.
    const mesh3d = new THREE.Mesh(
      new THREE.BufferGeometry(),
      [] as THREE.Material[],
    );
    scene.add(mesh3d);

    // Frames the model regardless of its size, and sizes the grid to match.
    const fit = () => {
      const geo = geometryRef.current;
      if (!geo) return;
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const s = geo.boundingSphere;
      if (!s) return;


      const dist = (s.radius * 1.6) / Math.tan((camera.fov * Math.PI) / 360);
      controls.target.copy(s.center);
      // Look at the relief side: the model is extruded along -Y.
      camera.position.set(s.center.x, s.center.y - dist, s.center.z);
      camera.near = Math.max(0.1, dist / 100);
      camera.far = dist * 10;
      camera.updateProjectionMatrix();
      controls.update();
    };
    fitRef.current = fit;

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w === 0 || h === 0) return;
      // updateStyle is off on purpose: the canvas is pinned to 100% in CSS
      // above, so three only needs to resize the backing store.
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let raf = 0;
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    const swapGeometry = (
      next: THREE.BufferGeometry,
      mats: THREE.Material[],
    ) => {
      mesh3d.geometry.dispose();
      for (const m of materialsRef.current) m.dispose();
      mesh3d.geometry = next;
      mesh3d.material = mats;
      materialsRef.current = mats;
    };
    (host as HTMLDivElement & { __swap?: typeof swapGeometry }).__swap =
      swapGeometry;

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      mesh3d.geometry.dispose();
      for (const m of materialsRef.current) m.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  // New mesh -> new geometry and one material per band, then reframe.
  useEffect(() => {
    const host = hostRef.current as
      | (HTMLDivElement & {
          __swap?: (
            g: THREE.BufferGeometry,
            m: THREE.Material[],
          ) => void;
        })
      | null;
    if (!host?.__swap) return;

    const geo = new THREE.BufferGeometry();
    const mats: THREE.Material[] = [];

    if (mesh && mesh.triangleCount > 0) {
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(mesh.positions, 3),
      );
      geo.computeVertexNormals();
      geo.computeBoundingBox();

      // Falloff scaled to this model, so the thickest part always lands at
      // roughly 3% transmission whatever Max thickness is set to.
      const maxThickness = Math.max(0.1, -(geo.boundingBox?.min.y ?? -1));
      const k = 3.5 / maxThickness;

      // A draw group per band lets each carry its own colour, matching what
      // the exported 3MF assigns to the corresponding body.
      const starts = mesh.bandStarts.length > 0 ? mesh.bandStarts : [0];
      for (let b = 0; b < starts.length; b++) {
        const from = starts[b];
        const to = b + 1 < starts.length ? starts[b + 1] : mesh.triangleCount;
        const color = new THREE.Color(mesh.colors[b] ?? "#d8dee9");

        geo.addGroup(from * 3, (to - from) * 3, b);
        mats.push(
          backlit
            ? new THREE.ShaderMaterial({
                uniforms: {
                  uTint: { value: color },
                  uK: { value: k },
                },
                vertexShader: BACKLIT_VERT,
                fragmentShader: BACKLIT_FRAG,
                side: THREE.DoubleSide,
              })
            : new THREE.MeshStandardMaterial({
                color,
                roughness: 0.72,
                metalness: 0.02,
                side: THREE.DoubleSide,
                flatShading,
              }),
        );
      }
    }

    geometryRef.current = geo;
    host.__swap(geo, mats);
    fitRef.current?.();
    // Toggling a shading mode rebuilds the materials here rather than mutating
    // them in a second effect; it is a manual switch, not a per-frame cost.
  }, [mesh, flatShading, backlit]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (scene) {
      scene.background = new THREE.Color(lightBackground ? 0xe8ecf2 : 0x0b1220);
    }
  }, [lightBackground]);

  /**
   * The grid is built here rather than alongside the geometry, so that
   * anything else which rebuilds the geometry — toggling flat shading, say —
   * cannot quietly drop it.
   */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (gridRef.current) {
      scene.remove(gridRef.current);
      gridRef.current.geometry.dispose();
      (gridRef.current.material as THREE.Material).dispose();
      gridRef.current = null;
    }

    const box = geometryRef.current?.boundingBox;
    if (!showGrid || !box) return;

    const size = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    if (!(size > 0)) return;

    // 10mm spacing, so it reads as a ruler as well as a floor.
    const span = Math.max(20, Math.ceil((size * 2) / 10) * 10);
    const grid = new THREE.GridHelper(span, span / 10);
    // GridHelper lies in XZ; this model stands with Z up.
    grid.rotation.x = Math.PI / 2;
    grid.position.set(
      (box.min.x + box.max.x) / 2,
      (box.min.y + box.max.y) / 2,
      box.min.z,
    );

    gridRef.current = grid;
    scene.add(grid);
  }, [showGrid, mesh, lightBackground]);

  return (
    <div
      ref={hostRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {!mesh && (
        <div className="preview-empty">
          Generate a model to see it here. Drag to orbit, scroll to zoom.
        </div>
      )}
    </div>
  );
}
