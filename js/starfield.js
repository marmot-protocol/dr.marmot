import { starfieldCanvas } from './dom.js';

export function initStarfield() {
    const ctx = starfieldCanvas.getContext('2d');
    let stars = [];

    function resize() {
        starfieldCanvas.width = 1366;
        starfieldCanvas.height = 768;
        stars = Array.from({ length: 120 }, () => ({
            x: Math.random() * starfieldCanvas.width,
            y: Math.random() * starfieldCanvas.height,
            r: Math.random() * 1.4 + 0.3,
            a: Math.random(),
            speed: Math.random() * 0.008 + 0.002,
        }));
    }

    function draw() {
        ctx.clearRect(0, 0, starfieldCanvas.width, starfieldCanvas.height);
        for (const s of stars) {
            s.a += s.speed;
            const alpha = (Math.sin(s.a) * 0.5 + 0.5) * 0.8 + 0.1;
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(160,160,255,${alpha.toFixed(2)})`;
            ctx.fill();
        }
        requestAnimationFrame(draw);
    }

    window.addEventListener('resize', resize);
    resize();
    draw();
}
