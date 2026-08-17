import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type PreviewMesh = {
  /** 9 floats per triangle, in the exported (upright) orientation. */
  positions: Float32Array;
  triangleCount: number;
};

type Props = {
  mesh: PreviewMesh | null;
  /** Flat shading shows every facet, which is how a slicer draws it. */
  flatShading: boolean;
};

/**
 * Shows the generated mesh exactly as exported — same triangles, same
 * orientation — so faceting and edge quality can be judged without a round
 * trip through a slicer.
 */
export default function MeshPreview({ mesh, flatShading }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const fitRef = useRef<(() => void) | null>(null);

  // Scene lives for the lifetime of the panel; only the geometry swaps.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);

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

    const material = new THREE.MeshStandardMaterial({
      color: 0xd8dee9,
      roughness: 0.72,
      metalness: 0.02,
      side: THREE.DoubleSide,
      flatShading: true,
    });
    materialRef.current = material;

    const mesh3d = new THREE.Mesh(new THREE.BufferGeometry(), material);
    scene.add(mesh3d);

    // Frames the model regardless of its size.
    const fit = () => {
      const geo = geometryRef.current;
      if (!geo) return;
      geo.computeBoundingSphere();
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

    const swapGeometry = (next: THREE.BufferGeometry) => {
      mesh3d.geometry.dispose();
      mesh3d.geometry = next;
    };
    (host as HTMLDivElement & { __swap?: typeof swapGeometry }).__swap =
      swapGeometry;

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      mesh3d.geometry.dispose();
      material.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  // New mesh -> new geometry, then reframe.
  useEffect(() => {
    const host = hostRef.current as
      | (HTMLDivElement & { __swap?: (g: THREE.BufferGeometry) => void })
      | null;
    if (!host?.__swap) return;

    const geo = new THREE.BufferGeometry();
    if (mesh && mesh.triangleCount > 0) {
      geo.setAttribute(
        "position",
        new THREE.BufferAttribute(mesh.positions, 3),
      );
      geo.computeVertexNormals();
    }
    geometryRef.current = geo;
    host.__swap(geo);
    fitRef.current?.();
  }, [mesh]);

  useEffect(() => {
    const m = materialRef.current;
    if (!m) return;
    m.flatShading = flatShading;
    m.needsUpdate = true;
  }, [flatShading]);

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
