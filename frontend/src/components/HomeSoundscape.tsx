import { useEffect, useRef } from "react";
import "./HomeSoundscape.css";

const HEADLINE = "让想象，有回响。";

function waveAt(u: number, phase: number, ribbon = 0, strand = 0) {
  const envelope = 0.4 + 0.6 * Math.sin(Math.PI * u) ** 2;
  return (
    (Math.sin(
      u * Math.PI * 2.25 + phase * 0.65 + ribbon * 2.5 + strand * 0.65,
    ) *
      0.68 +
      Math.sin(u * Math.PI * 4.1 - phase * 0.4 + strand * 1.4) * 0.24) *
    envelope
  );
}

/** Decorative, independent of audio playback. No audio context or microphone is needed. */
export function HomeSoundscape() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const titleCanvasRef = useRef<HTMLCanvasElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const titleCanvas = titleCanvasRef.current;
    const title = titleRef.current;
    const titleCtx = titleCanvas?.getContext("2d");
    if (!canvas || !ctx || !titleCanvas || !title) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let titleWidth = 0;
    let titleHeight = 0;
    let titleOffsetX = 0;
    let font = "";
    let fontSize = 36;
    let baseline = 0;
    let titleAmplitude = 0;
    let textStart = 0;
    let textSpan = 1;
    let titleRendered = false;
    let glyphs: { text: string; x: number; advance: number }[] = [];
    let frame = 0;
    let lastDraw = 0;
    let visible = true;
    let dark = document.documentElement.dataset.theme !== "light";
    let phase = 0;
    let disposed = false;

    function titleWave(x: number) {
      const u = (titleOffsetX + x) / width;
      const envelope = 0.4 + 0.6 * Math.sin(Math.PI * u) ** 2;
      const position = Math.max(0, Math.min(1, (x - textStart) / textSpan));
      // Each letter samples a different point on the background wave and a
      // gently changing amplitude. Remove the landscape's edge attenuation so
      // the first letters flow as clearly as those at the center of the scene.
      const amplitude =
        0.72 + 0.28 * (0.5 + 0.5 * Math.sin(position * Math.PI * 2.3 - 0.8));
      return (waveAt(u, phase) / envelope) * titleAmplitude * amplitude;
    }

    function drawTitle() {
      if (!titleCtx || !titleWidth || !titleHeight || !glyphs.length) return;
      titleCtx.clearRect(0, 0, titleWidth, titleHeight);
      titleCtx.font = font;
      titleCtx.textAlign = "center";
      titleCtx.textBaseline = "alphabetic";
      titleCtx.fillStyle = dark ? "#dceacb" : "#2f503b";
      for (const glyph of glyphs) {
        const x = glyph.x + glyph.advance / 2;
        const slope = (titleWave(x + 1) - titleWave(x - 1)) / 2;
        titleCtx.save();
        titleCtx.translate(x, baseline + titleWave(x));
        titleCtx.rotate(Math.max(-0.08, Math.min(0.08, Math.atan(slope))));
        titleCtx.fillText(glyph.text, 0, 0);
        titleCtx.restore();
      }
      // Keep a real heading available to assistive technology and as fallback.
      if (!titleRendered) {
        title!.dataset.rendered = "true";
        titleRendered = true;
      }
    }

    function draw() {
      if (!width || !height) return;
      ctx!.clearRect(0, 0, width, height);
      const mobile = width < 600;
      const lines = mobile ? 22 : 34;
      // On a stacked phone layout, keep the ripples around the greeting rather
      // than hiding their center beneath the opaque composer card.
      const center = height * (mobile ? 0.28 : 0.42);
      const amplitude = height * (mobile ? 0.12 : 0.23);

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
            const spread =
              strand *
              height *
              (0.26 + 0.12 * Math.cos(u * Math.PI * 3 + phase * 0.3));
            const y =
              center +
              waveAt(u, phase, ribbon, strand) * amplitude +
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
      drawTitle();
    }

    function tick(now: number) {
      if (disposed) return;
      // 24fps is sufficient for this slow ambient motion, keeping local generation responsive.
      if (now - lastDraw >= 1000 / 24) {
        phase += Math.min((now - lastDraw) / 1000, 0.08) * 0.64;
        lastDraw = now;
        draw();
      }
      frame = requestAnimationFrame(tick);
    }

    function sync() {
      cancelAnimationFrame(frame);
      frame = 0;
      if (disposed) return;
      const animate = visible && !document.hidden && !reducedMotion.matches;
      canvas!.dataset.animated = String(animate);
      titleCanvas!.dataset.animated = String(animate);
      draw();
      if (animate && !disposed) {
        lastDraw = performance.now();
        frame = requestAnimationFrame(tick);
      }
    }

    function resize() {
      if (disposed) return;
      const bounds = canvas!.getBoundingClientRect();
      const titleBounds = titleCanvas!.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      titleWidth = titleBounds.width;
      titleHeight = titleBounds.height;
      titleOffsetX = titleBounds.left - bounds.left;
      // Avoid allocating a large retina surface just for background decoration.
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas!.width = Math.round(width * ratio);
      canvas!.height = Math.round(height * ratio);
      ctx!.setTransform(ratio, 0, 0, ratio, 0, 0);
      if (titleCtx && titleWidth && titleHeight) {
        const titleRatio = Math.min(window.devicePixelRatio || 1, 2);
        titleCanvas!.width = Math.round(titleWidth * titleRatio);
        titleCanvas!.height = Math.round(titleHeight * titleRatio);
        titleCtx.setTransform(titleRatio, 0, 0, titleRatio, 0, 0);
        const style = getComputedStyle(title!);
        fontSize = Number.parseFloat(style.fontSize) || 36;
        const tracking = Number.parseFloat(style.letterSpacing) || 0;
        const characters = Array.from(HEADLINE);
        const setFont = () => {
          font = `${style.fontWeight || "550"} ${fontSize}px ${style.fontFamily}`;
          titleCtx.font = font;
        };
        setFont();
        const measure = () =>
          characters.map((text) => titleCtx.measureText(text).width);
        let advances = measure();
        let textWidth =
          advances.reduce((sum, value) => sum + value, 0) +
          tracking * (characters.length - 1);
        const available = Math.max(1, titleWidth - 16);
        if (textWidth > available) {
          const spacing = tracking * (characters.length - 1);
          fontSize *= Math.max(1, available - spacing) / (textWidth - spacing);
          setFont();
          advances = measure();
          textWidth =
            advances.reduce((sum, value) => sum + value, 0) +
            tracking * (characters.length - 1);
        }
        let x =
          style.textAlign === "left"
            ? 8
            : Math.max(8, (titleWidth - textWidth) / 2);
        textStart = x;
        textSpan = Math.max(1, textWidth);
        glyphs = characters.map((text, index) => {
          const glyph = { text, x, advance: advances[index] };
          x += advances[index] + tracking;
          return glyph;
        });
        const metrics = titleCtx.measureText(HEADLINE);
        const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.85;
        const descent = metrics.actualBoundingBoxDescent || fontSize * 0.12;
        baseline = (titleHeight + ascent - descent) / 2;
        // Reserve room for the actual font bounds and its maximum rotation.
        // The wave's harmonics sum to at most .92, so these bounds remain safe
        // at every phase rather than clipping the letters at a passing crest.
        const rotationInset = Math.max(...advances) * 0.04;
        const safeExcursion =
          (titleHeight - ascent - descent) / 2 - rotationInset - 6;
        const maxExcursion = titleHeight <= 100 ? 18 : 28;
        titleAmplitude =
          Math.max(0, Math.min(maxExcursion, safeExcursion)) / 0.92;
      }
      draw();
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resizeObserver.observe(titleCanvas);
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
    window.addEventListener("resize", resize);
    document.fonts?.addEventListener("loadingdone", resize);
    void document.fonts?.ready.then(() => {
      if (!disposed) resize();
    });
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
      window.removeEventListener("resize", resize);
      document.fonts?.removeEventListener("loadingdone", resize);
      delete title.dataset.rendered;
    };
  }, []);

  return (
    <>
      <div className="home-soundscape" aria-hidden="true">
        <canvas ref={canvasRef} />
      </div>
      <div className="simple-home-heading home-flow-heading">
        <h1 ref={titleRef} className="home-flow-title">
          <span className="home-flow-copy">{HEADLINE}</span>
          <canvas
            ref={titleCanvasRef}
            className="home-flow-canvas"
            aria-hidden="true"
          />
        </h1>
      </div>
    </>
  );
}
