import { useEffect, useRef, useState } from "react";
import { t } from "../i18n";

type Props = {
  /** Where the STL is served from. */
  src: string;
  /** The model's colour. */
  color?: string;
};

/**
 * A model that can be turned and zoomed, drawn on its own small canvas.
 *
 * three.js and the loader are fetched only when this is first shown, so the
 * home page costs nothing until a model is on screen. The wheel zooms only
 * while the model has been touched, so scrolling the page past it still scrolls
 * the page; it turns by itself until it is.
 */
export default function ModelViewer({ src, color = "#d9b77a" }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let live = true;
    let stop = () => {};

    (async () => {
      try {
        const [THREE, { STLLoader }, { OrbitControls }] = await Promise.all([
          import("three"),
          import("three/examples/jsm/loaders/STLLoader.js"),
          import("three/examples/jsm/controls/OrbitControls.js"),
        ]);
        const response = await fetch(src);
        if (!response.ok) throw new Error("missing");
        const buffer = await response.arrayBuffer();
        if (!live) return;

        const geometry = new STLLoader().parse(buffer);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!;
        const centre = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        geometry.translate(-centre.x, -centre.y, -centre.z);
        const radius = Math.max(size.x, size.y, size.z) * 0.5;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        el.appendChild(renderer.domElement);
        renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:pan-y";

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(35, 1, radius * 0.05, radius * 40);
        camera.up.set(0, 0, 1);
        camera.position.set(radius * 2.4, -radius * 3.2, radius * 1.6);

        scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.1));
        const sun = new THREE.DirectionalLight(0xffffff, 1.6);
        sun.position.set(radius * 2, -radius * 3, radius * 4);
        scene.add(sun);
        const fill = new THREE.DirectionalLight(0x99bbff, 0.6);
        fill.position.set(-radius * 3, radius * 2, radius);
        scene.add(fill);

        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 }),
        );
        scene.add(mesh);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.enablePan = false;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 1.6;
        controls.minDistance = radius * 1.2;
        controls.maxDistance = radius * 8;
        controls.enableZoom = false;

        const touched = () => {
          controls.autoRotate = false;
          controls.enableZoom = true;
        };
        const left = () => {
          controls.enableZoom = false;
        };
        renderer.domElement.addEventListener("pointerdown", touched);
        renderer.domElement.addEventListener("pointerleave", left);

        const fit = () => {
          const w = el.clientWidth || 300;
          const h = el.clientHeight || 225;
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        fit();
        const watcher = new ResizeObserver(fit);
        watcher.observe(el);

        let frame = 0;
        let visible = true;
        const seen = new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
        });
        seen.observe(el);
        const loop = () => {
          frame = requestAnimationFrame(loop);
          if (!visible) return;
          controls.update();
          renderer.render(scene, camera);
        };
        loop();
        setState("ready");

        stop = () => {
          cancelAnimationFrame(frame);
          watcher.disconnect();
          seen.disconnect();
          controls.dispose();
          renderer.dispose();
          geometry.dispose();
          renderer.domElement.remove();
        };
      } catch {
        if (live) setState("missing");
      }
    })();

    return () => {
      live = false;
      stop();
    };
  }, [src, color]);

  return (
    <div className="homePic" style={{ aspectRatio: "4 / 3" }}>
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      {state !== "ready" && (
        <div className="hole">{state === "missing" ? t("Model coming soon") : t("Loading…")}</div>
      )}
    </div>
  );
}
