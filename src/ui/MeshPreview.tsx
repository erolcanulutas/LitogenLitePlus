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
  /** Upper thickness of each band in mm, ascending; last is the full depth. */
  bandBounds: number[];
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
 * The relief always runs along the model's thinnest axis, with its base on
 * zero, so a fragment's thickness is its coordinate on that axis. Which axis
 * that is depends on the print orientation, so it is read off the bounding box
 * rather than assumed.
 */
const BACKLIT_VERT = `
  uniform vec3 uAxis;
  varying float vThickness;
  void main() {
    vThickness = dot(position, uAxis);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Light crosses every band on its way out, not just the one at the surface,
 * so absorption is accumulated through the stack. Each band absorbs by its own
 * colour: white passes most of what reaches it, black stops nearly all of it,
 * and a coloured band tints whatever gets through.
 */
const MAX_BANDS = 8;

const BACKLIT_FRAG = `
  uniform float uK;
  uniform int uCount;
  uniform float uBounds[${MAX_BANDS}];
  uniform vec3 uColors[${MAX_BANDS}];
  varying float vThickness;

  void main() {
    float total = max(vThickness, 0.0);
    vec3 transmitted = vec3(1.0);
    float lo = 0.0;

    for (int i = 0; i < ${MAX_BANDS}; i++) {
      if (i >= uCount) break;

      float seg = clamp(total, lo, uBounds[i]) - lo;
      if (seg > 0.0) {
        // Absorption per mm, per channel: uK is what a white band costs, and
        // darker pigment costs up to three times that.
        vec3 sigma = uK * (1.0 + 2.0 * (vec3(1.0) - uColors[i]));
        transmitted *= exp(-sigma * seg);
      }
      lo = uBounds[i];
    }

    gl_FragColor = vec4(transmitted, 1.0);
  }
`;

/**
 * The axis the relief runs along: the thinnest one, pointing from the flat
 * back towards the picture surface.
 */
function reliefAxis(box: THREE.Box3): THREE.Vector3 {
  const ex = box.max.x - box.min.x;
  const ey = box.max.y - box.min.y;
  const ez = box.max.z - box.min.z;

  const axis = new THREE.Vector3();
  if (ex <= ey && ex <= ez) axis.set(1, 0, 0);
  else if (ey <= ez) axis.set(0, 1, 0);
  else axis.set(0, 0, 1);

  // Point away from the base plane, which sits on zero.
  const lo = Math.abs(box.min.dot(axis));
  const hi = Math.abs(box.max.dot(axis));
  if (lo > hi) axis.negate();

  return axis;
}

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

    /**
     * OrbitControls fixes its orbit axis from camera.up when constructed, so
     * changing up afterwards leaves the orbit spinning about the wrong axis —
     * which, once the model lies flat and the camera looks along what used to
     * be up, degenerates into unusable rotation. Rebuilding is the reliable
     * way to move that axis.
     */
    const makeControls = () => {
      controlsRef.current?.dispose();
      const c = new OrbitControls(camera, renderer.domElement);
      c.enableDamping = true;
      c.dampingFactor = 0.08;
      controlsRef.current = c;
      return c;
    };

    makeControls();

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

      // Face the picture, whichever way the model is oriented, and keep "up"
      // off the view axis — otherwise the orbit degenerates.
      const box = geo.boundingBox;
      const axis = box ? reliefAxis(box) : new THREE.Vector3(0, -1, 0);
      const up = Math.abs(axis.z) > 0.5
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);

      const upChanged = !camera.up.equals(up);
      camera.up.copy(up);

      camera.position.copy(s.center).addScaledVector(axis, dist);
      camera.near = Math.max(0.1, dist / 100);
      camera.far = dist * 10;
      camera.updateProjectionMatrix();

      const controls = upChanged ? makeControls() : controlsRef.current!;
      controls.target.copy(s.center);
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
      controlsRef.current?.update();
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
      controlsRef.current?.dispose();
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

      // Falloff scaled to this model, so a white band reads roughly 50% at the
      // thinnest point and 8% at the thickest, whatever Max is set to.
      const box = geo.boundingBox ?? new THREE.Box3();
      const axis = reliefAxis(box);
      const maxThickness = Math.max(
        0.1,
        Math.max(Math.abs(box.min.dot(axis)), Math.abs(box.max.dot(axis))),
      );
      const k = 3.15 / maxThickness;

      const starts = mesh.bandStarts.length > 0 ? mesh.bandStarts : [0];

      if (backlit) {
        // One material for everything: the shader walks the whole stack per
        // fragment, so splitting the draw by band would tell it less, not more.
        const bounds = new Float32Array(MAX_BANDS);
        const colors = Array.from(
          { length: MAX_BANDS },
          () => new THREE.Color(0xffffff),
        );

        const count = Math.min(MAX_BANDS, starts.length);
        for (let b = 0; b < count; b++) {
          colors[b].set(mesh.colors[b] ?? "#f2f2f2");
          bounds[b] =
            mesh.bandBounds[b] ?? ((b + 1) / count) * maxThickness;
        }
        // The last band must reach the back, whatever rounding says.
        bounds[count - 1] = Math.max(bounds[count - 1], maxThickness);

        mats.push(
          new THREE.ShaderMaterial({
            uniforms: {
              uK: { value: k },
              uAxis: { value: axis.clone() },
              uCount: { value: count },
              uBounds: { value: bounds },
              uColors: { value: colors },
            },
            vertexShader: BACKLIT_VERT,
            fragmentShader: BACKLIT_FRAG,
            side: THREE.DoubleSide,
          }),
        );
      } else {
        // A draw group per band lets each carry its own colour, matching what
        // the exported 3MF assigns to the corresponding body.
        for (let b = 0; b < starts.length; b++) {
          const from = starts[b];
          const to = b + 1 < starts.length ? starts[b + 1] : mesh.triangleCount;

          geo.addGroup(from * 3, (to - from) * 3, b);
          mats.push(
            new THREE.MeshStandardMaterial({
              color: new THREE.Color(mesh.colors[b] ?? "#d8dee9"),
              roughness: 0.72,
              metalness: 0.02,
              side: THREE.DoubleSide,
              flatShading,
            }),
          );
        }
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

    // The grid lies in XY, so it needs to cover those two extents.
    const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y);
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
