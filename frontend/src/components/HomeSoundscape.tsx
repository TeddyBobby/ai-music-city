import { useEffect, useRef } from "react";
import "./HomeSoundscape.css";

/** Decorative, independent of audio playback. No audio context or microphone is needed. */
export function HomeSoundscape() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastDraw = 0;
    let visible = true;
    let dark = document.documentElement.dataset.theme !== "light";
    let phase = 0;
    let disposed = false;

    function draw() {
      if (!width || !height) return;
      ctx!.clearRect(0, 0, width, height);
      const mobile = width < 600;
      const lines = mobile ? 22 : 34;
      const center = height * 0.42;
      const amplitude = height * (mobile ? 0.16 : 0.23);

      // Two drifting ribbons share a quiet center around the writing surface.
      for (let ribbon = 0; ribbon < 2; ribbon++) {
        const gradient = ctx!.createLinearGradient(0, 0, width, height * 0.4);
        if (dark) {
          gradient.addColorStop(0, "rgba(160, 202, 103, .05)");
          gradient.addColorStop(0.25, "rgba(173, 216, 133, .29)");
          gradient.addColorStop(0.62, "rgba(80, 175, 151, .24)");
          gradient.addColorStop(1, "rgba(139, 189, 150, .08)");
        } else {
          gradient.addColorStop(0, "rgba(102, 141, 54, .04)");
          gradient.addColorStop(0.25, "rgba(114, 145, 66, .24)");
          gradient.addColorStop(0.62, "rgba(56, 137, 116, .22)");
          gradient.addColorStop(1, "rgba(95, 153, 126, .07)");
        }
        ctx!.strokeStyle = gradient;
        ctx!.lineWidth = mobile ? 0.7 : 0.85;
        for (let line = 0; line < lines; line++) {
          const strand = line / (lines - 1) - 0.5;
          ctx!.beginPath();
          for (let x = -8; x <= width + 8; x += 8) {
            const u = x / width;
            const envelope = 0.4 + 0.6 * Math.sin(Math.PI * u) ** 2;
            const wave =
              Math.sin(
                u * Math.PI * 2.25 +
                  phase * 0.65 +
                  ribbon * 2.5 +
                  strand * 0.65,
              ) *
                0.68 +
              Math.sin(u * Math.PI * 4.1 - phase * 0.4 + strand * 1.4) * 0.24;
            const spread =
              strand *
              height *
              (0.26 + 0.12 * Math.cos(u * Math.PI * 3 + phase * 0.3));
            const y =
              center +
              wave * amplitude * envelope +
              spread +
              ribbon * height * 0.13;
            if (x === -8) ctx!.moveTo(x, y);
            else ctx!.lineTo(x, y);
          }
          ctx!.stroke();
        }
      }

      // Broad concentric rings slowly radiate from the outer edge of the scene.
      ctx!.lineWidth = 0.7;
      for (let ring = 0; ring < 6; ring++) {
        const travel = (ring / 6 + phase * 0.025) % 1;
        const alpha = Math.sin(travel * Math.PI) * (dark ? 0.14 : 0.11);
        ctx!.strokeStyle = dark
          ? `rgba(174, 214, 142, ${alpha})`
          : `rgba(81, 133, 86, ${alpha})`;
        ctx!.beginPath();
        ctx!.ellipse(
          width * 0.9,
          height * 0.39,
          36 + travel * width * 0.44,
          26 + travel * height * 0.31,
          -0.25,
          0,
          Math.PI * 2,
        );
        ctx!.stroke();
      }
    }

    function tick(now: number) {
      if (disposed) return;
      // 24fps is sufficient for this slow ambient motion, keeping local generation responsive.
      if (now - lastDraw >= 1000 / 24) {
        phase += Math.min((now - lastDraw) / 1000, 0.08) * 0.38;
        lastDraw = now;
        draw();
      }
      frame = requestAnimationFrame(tick);
    }

    function sync() {
      cancelAnimationFrame(frame);
      frame = 0;
      const animate = visible && !document.hidden && !reducedMotion.matches;
      canvas!.dataset.animated = String(animate);
      draw();
      if (animate && !disposed) {
        lastDraw = performance.now();
        frame = requestAnimationFrame(tick);
      }
    }

    function resize() {
      const bounds = canvas!.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      // Avoid allocating a large retina surface just for background decoration.
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas!.width = Math.round(width * ratio);
      canvas!.height = Math.round(height * ratio);
      ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersection = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        sync();
      },
      { root: document.getElementById("main-content") },
    );
    intersection.observe(canvas);
    const themeObserver = new MutationObserver(() => {
      dark = document.documentElement.dataset.theme !== "light";
      draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    document.addEventListener("visibilitychange", sync);
    reducedMotion.addEventListener("change", sync);
    resize();
    sync();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
      themeObserver.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener("change", sync);
    };
  }, []);

  return (
    <div className="home-soundscape" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
