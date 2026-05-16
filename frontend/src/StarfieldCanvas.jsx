import { useEffect, useRef } from "react";

export default function StarfieldCanvas() {
  const canvasRef = useRef();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const stars = Array.from({ length: 300 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.2 + 0.3,
      opacity: Math.random() * 0.6 + 0.1,
      twinkleSpeed: Math.random() * 0.02 + 0.005,
      twinkleOffset: Math.random() * Math.PI * 2,
    }));

    let frame = 0;
    let rafId;

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Nebula glow
      const nebula = ctx.createRadialGradient(
        canvas.width * 0.65, canvas.height * 0.35, 0,
        canvas.width * 0.65, canvas.height * 0.35, canvas.width * 0.5
      );
      nebula.addColorStop(0,   "rgba(124,77,255,0.06)");
      nebula.addColorStop(0.5, "rgba(79,195,247,0.03)");
      nebula.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.fillStyle = nebula;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Secondary nebula
      const nebula2 = ctx.createRadialGradient(
        canvas.width * 0.2, canvas.height * 0.7, 0,
        canvas.width * 0.2, canvas.height * 0.7, canvas.width * 0.35
      );
      nebula2.addColorStop(0,   "rgba(0,191,165,0.04)");
      nebula2.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.fillStyle = nebula2;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Stars
      stars.forEach(star => {
        const opacity = star.opacity * (0.7 + 0.3 * Math.sin(frame * star.twinkleSpeed + star.twinkleOffset));
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(240,244,255,${opacity.toFixed(3)})`;
        ctx.fill();
      });

      frame++;
      rafId = requestAnimationFrame(draw);
    }

    draw();
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}
