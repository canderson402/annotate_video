import React, { useEffect, useRef, useState } from 'react';

interface VisualizerProps {
  isActive: boolean;
  debug?: boolean;
}

type VisualizerMode = 'orbs' | 'shapes' | 'scroll' | 'tunnel' | 'plasma' | 'plasmaWarp';

const MODES: VisualizerMode[] = ['scroll', 'tunnel', 'plasma', 'plasmaWarp'];

const Visualizer: React.FC<VisualizerProps> = ({ isActive, debug = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const modeRef = useRef<VisualizerMode>('plasmaWarp');
  const modeIndexRef = useRef<number>(0);
  const modeStartTimeRef = useRef<number>(0);
  const scrollDirectionRef = useRef<{ x: number; y: number }>({ x: 1, y: 0 });
  const forceUpdateRef = useRef<() => void>(() => {});
  const [currentModeName, setCurrentModeName] = useState<string>('plasmaWarp');

  const handleNextMode = () => {
    modeIndexRef.current = (modeIndexRef.current + 1) % MODES.length;
    modeRef.current = MODES[modeIndexRef.current];
    modeStartTimeRef.current = timeRef.current;
    setCurrentModeName(modeRef.current);
    forceUpdateRef.current();
  };

  useEffect(() => {
    if (!isActive || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const hsl = (h: number, s: number, l: number, a: number = 1): string => {
      const hue = ((h % 360) + 360) % 360;
      return `hsla(${hue}, ${s}%, ${l}%, ${a})`;
    };

    modeIndexRef.current = Math.floor(Math.random() * MODES.length);
    modeRef.current = MODES[modeIndexRef.current];
    modeStartTimeRef.current = 0;

    const randomizeScrollDirection = () => {
      const angle = Math.random() * Math.PI * 2;
      scrollDirectionRef.current = {
        x: Math.cos(angle),
        y: Math.sin(angle),
      };
    };
    randomizeScrollDirection();

    // Shape definitions
    interface Shape {
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      rotation: number;
      rotationSpeed: number;
      type: 'triangle' | 'square' | 'pentagon' | 'hexagon' | 'star' | 'circle';
      hueOffset: number;
    }

    const shapes: Shape[] = [];
    const shapeTypes: Shape['type'][] = ['triangle', 'square', 'pentagon', 'hexagon', 'star', 'circle'];

    const createShapes = () => {
      shapes.length = 0;
      for (let i = 0; i < 25; i++) {
        shapes.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          size: 30 + Math.random() * 60,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.05,
          type: shapeTypes[Math.floor(Math.random() * shapeTypes.length)],
          hueOffset: Math.random() * 360,
        });
      }
    };
    createShapes();

    // Scroll elements - smooth random blob shapes
    interface ScrollElement {
      x: number;
      y: number;
      size: number;
      hueOffset: number;
      rotation: number;
      rotationSpeed: number;
      // Random control points for blob shape (offsets from base radius)
      blobPoints: number[];
      blobPhase: number;
    }

    const scrollElements: ScrollElement[] = [];
    const createScrollElements = () => {
      scrollElements.length = 0;
      for (let i = 0; i < 45; i++) {
        // Generate random blob control points (8-12 points)
        const numPoints = 8 + Math.floor(Math.random() * 5);
        const blobPoints: number[] = [];
        for (let p = 0; p < numPoints; p++) {
          blobPoints.push(0.6 + Math.random() * 0.8); // Radius multiplier between 0.6 and 1.4
        }
        scrollElements.push({
          x: Math.random() * canvas.width * 2 - canvas.width * 0.5,
          y: Math.random() * canvas.height * 2 - canvas.height * 0.5,
          size: 25 + Math.random() * 60,
          hueOffset: Math.random() * 360,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.015,
          blobPoints,
          blobPhase: Math.random() * Math.PI * 2,
        });
      }
    };
    createScrollElements();

    // Draw smooth blob shape
    const drawBlob = (x: number, y: number, size: number, rotation: number, blobPoints: number[], phase: number, time: number, strokeColor: string, fillColor: string) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);

      const numPoints = blobPoints.length;
      const points: { x: number; y: number }[] = [];

      // Generate points around the blob with smooth variation
      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * Math.PI * 2;
        // Animate the blob points slightly
        const radiusMod = blobPoints[i] + Math.sin(time * 1.5 + phase + i * 0.5) * 0.15;
        const r = size * radiusMod;
        points.push({
          x: Math.cos(angle) * r,
          y: Math.sin(angle) * r,
        });
      }

      // Draw smooth curve through points using bezier curves
      ctx.beginPath();
      for (let i = 0; i < numPoints; i++) {
        const curr = points[i];
        const next = points[(i + 1) % numPoints];
        const prev = points[(i - 1 + numPoints) % numPoints];
        const nextNext = points[(i + 2) % numPoints];

        if (i === 0) {
          ctx.moveTo(curr.x, curr.y);
        }

        // Calculate control points for smooth curve
        const cp1x = curr.x + (next.x - prev.x) * 0.2;
        const cp1y = curr.y + (next.y - prev.y) * 0.2;
        const cp2x = next.x - (nextNext.x - curr.x) * 0.2;
        const cp2y = next.y - (nextNext.y - curr.y) * 0.2;

        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, next.x, next.y);
      }
      ctx.closePath();

      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.restore();
    };

    const drawShape = (x: number, y: number, size: number, rotation: number, type: Shape['type'], color: string, fill: boolean = false, fillColor?: string) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      switch (type) {
        case 'triangle':
          for (let i = 0; i < 3; i++) {
            const angle = (Math.PI * 2 / 3) * i - Math.PI / 2;
            const px = Math.cos(angle) * size;
            const py = Math.sin(angle) * size;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.closePath();
          break;
        case 'square':
          ctx.rect(-size / 2, -size / 2, size, size);
          break;
        case 'pentagon':
          for (let i = 0; i < 5; i++) {
            const angle = (Math.PI * 2 / 5) * i - Math.PI / 2;
            const px = Math.cos(angle) * size;
            const py = Math.sin(angle) * size;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.closePath();
          break;
        case 'hexagon':
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI * 2 / 6) * i;
            const px = Math.cos(angle) * size;
            const py = Math.sin(angle) * size;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.closePath();
          break;
        case 'star':
          for (let i = 0; i < 10; i++) {
            const angle = (Math.PI * 2 / 10) * i - Math.PI / 2;
            const r = i % 2 === 0 ? size : size * 0.5;
            const px = Math.cos(angle) * r;
            const py = Math.sin(angle) * r;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.closePath();
          break;
        case 'circle':
          ctx.arc(0, 0, size, 0, Math.PI * 2);
          break;
      }
      if (fill && fillColor) {
        ctx.fillStyle = fillColor;
        ctx.fill();
      }
      ctx.stroke();
      ctx.restore();
    };

    // Function to reinitialize elements when mode changes
    const reinitializeMode = () => {
      if (modeRef.current === 'shapes') createShapes();
      if (modeRef.current === 'scroll') {
        randomizeScrollDirection();
        createScrollElements();
      }
    };

    // Expose reinitialize function for manual mode switching
    forceUpdateRef.current = reinitializeMode;

    const animate = () => {
      timeRef.current += 0.016;
      const time = timeRef.current;

      // Switch mode every 20 seconds (only if not in debug mode)
      if (!debug && time - modeStartTimeRef.current >= 20) {
        modeStartTimeRef.current = time;
        modeIndexRef.current = (modeIndexRef.current + 1) % MODES.length;
        modeRef.current = MODES[modeIndexRef.current];
        reinitializeMode();
      }

      const baseHue = time * 25;

      // Clear with animated background
      const bgGradient = ctx.createLinearGradient(
        canvas.width * (0.5 + Math.sin(time * 0.1) * 0.5),
        0,
        canvas.width * (0.5 + Math.cos(time * 0.1) * 0.5),
        canvas.height
      );
      bgGradient.addColorStop(0, hsl(baseHue, 60, 5));
      bgGradient.addColorStop(0.5, hsl(baseHue + 40, 50, 8));
      bgGradient.addColorStop(1, hsl(baseHue + 80, 60, 5));
      ctx.fillStyle = bgGradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const mode = modeRef.current;

      if (mode === 'orbs') {
        for (let i = 0; i < 8; i++) {
          const x = canvas.width * (0.5 + Math.sin(time * 0.3 + i * 0.8) * 0.4 + Math.cos(time * 0.2 + i) * 0.2);
          const y = canvas.height * (0.5 + Math.cos(time * 0.25 + i * 0.7) * 0.4 + Math.sin(time * 0.15 + i) * 0.2);
          const radius = 100 + Math.sin(time * 2 + i) * 50 + i * 20;
          const hue = baseHue + i * 45 + Math.sin(time + i) * 20;

          const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
          gradient.addColorStop(0, hsl(hue, 80, 60, 0.8));
          gradient.addColorStop(0.4, hsl(hue + 30, 70, 50, 0.4));
          gradient.addColorStop(1, hsl(hue + 60, 60, 40, 0));

          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        }

        ctx.globalCompositeOperation = 'screen';
        for (let w = 0; w < 4; w++) {
          ctx.beginPath();
          ctx.strokeStyle = hsl(baseHue + w * 90, 70, 50, 0.3);
          ctx.lineWidth = 2;
          for (let x = 0; x <= canvas.width; x += 4) {
            const y = canvas.height / 2 +
              Math.sin(x * 0.01 + time * (w + 1) * 0.3) * 100 +
              Math.cos(x * 0.02 - time * 0.2) * 50 +
              (w - 1.5) * 60;
            x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      else if (mode === 'shapes') {
        shapes.forEach((shape) => {
          shape.x += shape.vx;
          shape.y += shape.vy;
          shape.rotation += shape.rotationSpeed;

          if (shape.x < -shape.size) shape.x = canvas.width + shape.size;
          if (shape.x > canvas.width + shape.size) shape.x = -shape.size;
          if (shape.y < -shape.size) shape.y = canvas.height + shape.size;
          if (shape.y > canvas.height + shape.size) shape.y = -shape.size;

          const hue = baseHue + shape.hueOffset + time * 30;
          const pulseSize = shape.size * (1 + Math.sin(time * 3 + shape.hueOffset) * 0.2);

          ctx.shadowColor = hsl(hue, 80, 50, 1);
          ctx.shadowBlur = 20;
          drawShape(shape.x, shape.y, pulseSize, shape.rotation, shape.type, hsl(hue, 80, 60, 0.8));
          ctx.shadowBlur = 0;

          ctx.fillStyle = hsl(hue, 70, 50, 0.2);
          drawShape(shape.x, shape.y, pulseSize, shape.rotation, shape.type, hsl(hue, 80, 60, 0.8));
        });

        ctx.globalCompositeOperation = 'lighter';
        shapes.forEach((shape, i) => {
          shapes.slice(i + 1, i + 4).forEach((other) => {
            const dist = Math.hypot(shape.x - other.x, shape.y - other.y);
            if (dist < 200) {
              ctx.beginPath();
              ctx.strokeStyle = hsl(baseHue + shape.hueOffset, 60, 50, (1 - dist / 200) * 0.3);
              ctx.lineWidth = 1;
              ctx.moveTo(shape.x, shape.y);
              ctx.lineTo(other.x, other.y);
              ctx.stroke();
            }
          });
        });
        ctx.globalCompositeOperation = 'source-over';
      }

      else if (mode === 'scroll') {
        // Cycling background color
        const bgHue = (time * 15) % 360;
        ctx.fillStyle = hsl(bgHue, 50, 12);
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const scrollSpeed = 1; // Slowed down
        const dir = scrollDirectionRef.current;

        scrollElements.forEach((el) => {
          el.x += dir.x * scrollSpeed;
          el.y += dir.y * scrollSpeed;
          el.rotation += el.rotationSpeed;

          if (el.x < -100) el.x += canvas.width + 200;
          if (el.x > canvas.width + 100) el.x -= canvas.width + 200;
          if (el.y < -100) el.y += canvas.height + 200;
          if (el.y > canvas.height + 100) el.y -= canvas.height + 200;

          const hue = baseHue + el.hueOffset + time * 20;
          const pulse = 1 + Math.sin(time * 2 + el.hueOffset) * 0.15;

          const strokeColor = hsl(hue, 80, 65, 0.8);
          const fillColor = hsl(hue, 70, 50, 0.5);

          ctx.shadowColor = hsl(hue, 80, 50, 0.6);
          ctx.shadowBlur = 20;
          drawBlob(el.x, el.y, el.size * pulse, el.rotation, el.blobPoints, el.blobPhase, time, strokeColor, fillColor);
          ctx.shadowBlur = 0;
        });
        ctx.globalCompositeOperation = 'source-over';
      }

      else if (mode === 'tunnel') {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        for (let ring = 0; ring < 15; ring++) {
          const ringTime = time + ring * 0.1;
          const radius = (ringTime * 50) % (Math.max(canvas.width, canvas.height) * 0.8);
          const hue = baseHue + ring * 24 + time * 30;
          const alpha = 1 - radius / (Math.max(canvas.width, canvas.height) * 0.8);

          ctx.strokeStyle = hsl(hue, 80, 50, alpha * 0.6);
          ctx.lineWidth = 3;

          ctx.beginPath();
          for (let a = 0; a <= Math.PI * 2; a += 0.1) {
            const warp = Math.sin(a * 6 + time * 2 + ring) * 20;
            const px = centerX + Math.cos(a + time * 0.5) * (radius + warp);
            const py = centerY + Math.sin(a + time * 0.5) * (radius + warp);
            a === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.stroke();
        }

        ctx.globalCompositeOperation = 'screen';
        for (let i = 0; i < 12; i++) {
          const angle = (Math.PI * 2 / 12) * i + time * 0.3;
          const hue = baseHue + i * 30 + time * 20;

          ctx.beginPath();
          ctx.strokeStyle = hsl(hue, 70, 50, 0.3);
          ctx.lineWidth = 2;
          ctx.moveTo(centerX, centerY);
          ctx.lineTo(
            centerX + Math.cos(angle) * canvas.width,
            centerY + Math.sin(angle) * canvas.height
          );
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      else if (mode === 'plasma') {
        // Plasma effect using sine waves
        const imageData = ctx.createImageData(canvas.width, canvas.height);
        const data = imageData.data;
        const scale = 0.02;

        for (let y = 0; y < canvas.height; y += 2) {
          for (let x = 0; x < canvas.width; x += 2) {
            const v1 = Math.sin(x * scale + time);
            const v2 = Math.sin((y * scale + time) / 2);
            const v3 = Math.sin((x * scale + y * scale + time) / 2);
            const v4 = Math.sin(Math.sqrt(x * x + y * y) * scale * 0.5 + time);

            const v = (v1 + v2 + v3 + v4) / 4;

            const hue = (baseHue + v * 60 + 180) % 360;
            const lightness = 40 + v * 20;

            // Convert HSL to RGB
            const h = hue / 360;
            const s = 0.8;
            const l = lightness / 100;

            const hue2rgb = (p: number, q: number, t: number) => {
              if (t < 0) t += 1;
              if (t > 1) t -= 1;
              if (t < 1/6) return p + (q - p) * 6 * t;
              if (t < 1/2) return q;
              if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
              return p;
            };

            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            const r = hue2rgb(p, q, h + 1/3);
            const g = hue2rgb(p, q, h);
            const b = hue2rgb(p, q, h - 1/3);

            // Set 2x2 block for performance
            for (let dy = 0; dy < 2 && y + dy < canvas.height; dy++) {
              for (let dx = 0; dx < 2 && x + dx < canvas.width; dx++) {
                const idx = ((y + dy) * canvas.width + (x + dx)) * 4;
                data[idx] = r * 255;
                data[idx + 1] = g * 255;
                data[idx + 2] = b * 255;
                data[idx + 3] = 255;
              }
            }
          }
        }

        ctx.putImageData(imageData, 0, 0);

        // Add some overlay effects
        ctx.globalCompositeOperation = 'overlay';
        for (let i = 0; i < 5; i++) {
          const x = canvas.width * (0.5 + Math.sin(time * 0.3 + i * 1.2) * 0.4);
          const y = canvas.height * (0.5 + Math.cos(time * 0.25 + i * 1.5) * 0.4);
          const radius = 100 + Math.sin(time + i) * 50;

          const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
          gradient.addColorStop(0, hsl(baseHue + i * 72, 80, 70, 0.3));
          gradient.addColorStop(1, hsl(baseHue + i * 72 + 30, 60, 50, 0));

          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      else if (mode === 'plasmaWarp') {
        // Faster, more warped plasma effect
        const imageData = ctx.createImageData(canvas.width, canvas.height);
        const data = imageData.data;
        const fastTime = time * .8; // Faster animation

        for (let y = 0; y < canvas.height; y += 2) {
          for (let x = 0; x < canvas.width; x += 2) {
            // Different wave patterns for morphing effect
            const cx = x - canvas.width / 2;
            const cy = y - canvas.height / 2;
            const dist = Math.sqrt(cx * cx + cy * cy);

            const v1 = Math.sin(x * 0.03 + fastTime * 1.2);
            const v2 = Math.sin(y * 0.025 - fastTime * 0.8);
            const v3 = Math.sin((x * 0.02 + y * 0.02) + fastTime);
            const v4 = Math.sin(dist * 0.03 - fastTime * 1.5);
            const v5 = Math.cos(x * 0.015 * Math.sin(fastTime * 0.3) + y * 0.015 * Math.cos(fastTime * 0.4));

            const v = (v1 + v2 + v3 + v4 + v5) / 5;

            // More dramatic color shifts
            const hue = (baseHue + v * 90 + Math.sin(fastTime * 0.5) * 30 + 180) % 360;
            const saturation = 75 + v * 15;
            const lightness = 35 + v * 25;

            // Convert HSL to RGB
            const h = hue / 360;
            const s = saturation / 100;
            const l = lightness / 100;

            const hue2rgb = (p: number, q: number, t: number) => {
              if (t < 0) t += 1;
              if (t > 1) t -= 1;
              if (t < 1/6) return p + (q - p) * 6 * t;
              if (t < 1/2) return q;
              if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
              return p;
            };

            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            const r = hue2rgb(p, q, h + 1/3);
            const g = hue2rgb(p, q, h);
            const b = hue2rgb(p, q, h - 1/3);

            // Set 2x2 block for performance
            for (let dy = 0; dy < 2 && y + dy < canvas.height; dy++) {
              for (let dx = 0; dx < 2 && x + dx < canvas.width; dx++) {
                const idx = ((y + dy) * canvas.width + (x + dx)) * 4;
                data[idx] = r * 255;
                data[idx + 1] = g * 255;
                data[idx + 2] = b * 255;
                data[idx + 3] = 255;
              }
            }
          }
        }

        ctx.putImageData(imageData, 0, 0);

        // Add swirling overlay effects
        ctx.globalCompositeOperation = 'screen';
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2 + fastTime * 0.4;
          const dist = 120 + Math.sin(fastTime * 2 + i) * 60;
          const x = canvas.width / 2 + Math.cos(angle) * dist;
          const y = canvas.height / 2 + Math.sin(angle) * dist;
          const radius = 60 + Math.sin(fastTime * 1.5 + i * 0.5) * 30;

          const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
          gradient.addColorStop(0, hsl(baseHue + i * 45 + fastTime * 20, 90, 70, 0.4));
          gradient.addColorStop(1, hsl(baseHue + i * 45 + 30, 70, 50, 0));

          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fillStyle = gradient;
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationRef.current);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, [isActive, debug]);

  if (!isActive) return null;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="visualizer-canvas"
      />
      {debug && (
        <div className="visualizer-debug">
          <span className="visualizer-mode-name">{currentModeName}</span>
          <button className="visualizer-next-btn" onClick={handleNextMode}>
            Next
          </button>
        </div>
      )}
    </>
  );
};

export default Visualizer;
