// Generates CSS linear() easings from SwiftUI's Spring(duration:, bounce:) model (WWDC23 10158).
// omega = 2*pi/duration, zeta = 1 - bounce (bounce >= 0), unit mass, zero initial velocity.
// Usage: node scripts/gen-springs.mjs
const springs = { 'smooth-fast': [0.25, 0], smooth: [0.4, 0], snappy: [0.3, 0.15], bouncy: [0.45, 0.3] };

function position(t, d, bounce) {
  const w = (2 * Math.PI) / d, z = 1 - bounce;
  if (z >= 1) return 1 - (1 + w * t) * Math.exp(-w * t);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
}
function settle(d, b) { // last time the spring is >0.5% away from target
  let last = 0;
  for (let t = 0; t < 5 * d; t += 0.002) if (Math.abs(1 - position(t, d, b)) > 0.005) last = t;
  return last + 0.002;
}
for (const [name, [d, b]] of Object.entries(springs)) {
  const T = settle(d, b), n = 36, pts = [];
  for (let i = 0; i <= n; i++) pts.push(+position((T * i) / n, d, b).toFixed(4));
  pts[n] = 1;
  console.log(`--spring-${name}: linear(${pts.join(', ')});`);
  console.log(`--spring-${name}-time: ${Math.round(T * 1000)}ms;`);
}
