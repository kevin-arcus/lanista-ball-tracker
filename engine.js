/* Lanista ball tracker: in-browser port of the Python prototype (ball-tracking-spike).
 * Classical computer vision + physics, no machine-learning model.
 *
 *   detect  : temporal-median background, blob shape filters      (detect.py)
 *   track   : seed-and-extend linking with a physical speed band   (track.py)
 *   refine  : motion-blurred disk model fit on each tracked ball   (detect.py fit_blurred_disk)
 *   measure : gravity-aware velocity, drag back to contact, carry  (measure.py, physics.py, pipeline.py)
 *
 * Works in the browser (window.BallEngine) and in Node (module.exports) for testing.
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------- physics
  var G = 9.81, MASS = 0.145, DIAM = 0.0737, RAD = DIAM / 2, AREA = Math.PI * RAD * RAD;
  var RHO = 1.2, CD = 0.38, MPH = 2.2369362920544, FT = 3.280839895;
  var KDRAG = 0.5 * RHO * CD * AREA / MASS;

  function accel(v, axis, spin) {
    var s = Math.hypot(v[0], v[1], v[2]);
    var a = [0, -G, 0];
    if (s < 1e-9) return a;
    a[0] -= KDRAG * s * v[0]; a[1] -= KDRAG * s * v[1]; a[2] -= KDRAG * s * v[2];
    if (axis && spin > 0) {
      var sf = RAD * spin / s, cl = 1 / (2.32 + 0.4 / sf);
      var lx = axis[1] * v[2] - axis[2] * v[1], ly = axis[2] * v[0] - axis[0] * v[2], lz = axis[0] * v[1] - axis[1] * v[0];
      var n = Math.hypot(lx, ly, lz);
      if (n > 1e-12) {
        var k = 0.5 * RHO * cl * AREA / MASS * s * s / n;
        a[0] += k * lx; a[1] += k * ly; a[2] += k * lz;
      }
    }
    return a;
  }
  function add(a, b, h) { return [a[0] + h * b[0], a[1] + h * b[1], a[2] + h * b[2]]; }
  // RK4; tSpan may be negative. Returns {p, v} at the end, or the path when keepPath.
  function integrate(p, v, tSpan, dt, axis, rpm, stopGround) {
    var spin = (rpm || 0) * 2 * Math.PI / 60;
    var n = Math.max(1, Math.ceil(Math.abs(tSpan) / dt)), h = tSpan / n;
    var prev = null;
    for (var i = 0; i < n; i++) {
      var k1v = accel(v, axis, spin), k1p = v;
      var v2 = add(v, k1v, h / 2), k2v = accel(v2, axis, spin), k2p = v2;
      var v3 = add(v, k2v, h / 2), k3v = accel(v3, axis, spin), k3p = v3;
      var v4 = add(v, k3v, h), k4v = accel(v4, axis, spin), k4p = v4;
      prev = p;
      p = [p[0] + h / 6 * (k1p[0] + 2 * k2p[0] + 2 * k3p[0] + k4p[0]), p[1] + h / 6 * (k1p[1] + 2 * k2p[1] + 2 * k3p[1] + k4p[1]), p[2] + h / 6 * (k1p[2] + 2 * k2p[2] + 2 * k3p[2] + k4p[2])];
      v = [v[0] + h / 6 * (k1v[0] + 2 * k2v[0] + 2 * k3v[0] + k4v[0]), v[1] + h / 6 * (k1v[1] + 2 * k2v[1] + 2 * k3v[1] + k4v[1]), v[2] + h / 6 * (k1v[2] + 2 * k2v[2] + 2 * k3v[2] + k4v[2])];
      if (stopGround && h > 0 && p[1] <= 0) break;
    }
    return { p: p, v: v, prev: prev };
  }
  function backspin(la) { return Math.min(3000, Math.max(0, 1000 + 50 * la)); }
  function carryFt(evMs, la, h0) {
    if (evMs <= 0) return 0;
    var r = la * Math.PI / 180;
    var v = [evMs * Math.cos(r), evMs * Math.sin(r), 0];
    var out = integrate([0, h0, 0], v, 12, 2e-3, [0, 0, 1], backspin(la), true);
    var a = out.prev || [0, h0, 0], b = out.p;
    if (b[1] > 0) return b[0] * FT;
    var f = a[1] / (a[1] - b[1]);
    return (a[0] + f * (b[0] - a[0])) * FT;
  }
  function barrel(ev, la) {
    if (ev < 98) return false;
    var lo, hi;
    if (ev < 100) { lo = 26 - (ev - 98); hi = 30 + 1.5 * (ev - 98); }
    else { var e = Math.min(ev, 116) - 100; lo = 24 - e; hi = 33 + e * 17 / 16; }
    return la >= lo && la <= hi;
  }

  // ---------------------------------------------------------------- detection
  function medianBg(refs, n) {
    var bg = new Float32Array(n), i, a, b, c, d, lo, hi;
    if (refs.length === 4) {
      var A = refs[0], B = refs[1], C = refs[2], D = refs[3];
      for (i = 0; i < n; i++) {
        a = A[i]; b = B[i]; c = C[i]; d = D[i];
        lo = Math.min(a, b, c, d); hi = Math.max(a, b, c, d);
        bg[i] = (a + b + c + d - lo - hi) * 0.5;
      }
    } else {
      var vals = new Array(refs.length);
      for (i = 0; i < n; i++) {
        for (var k = 0; k < refs.length; k++) vals[k] = refs[k][i];
        vals.sort(function (x, y) { return x - y; });
        var m = vals.length >> 1;
        bg[i] = vals.length % 2 ? vals[m] : (vals[m - 1] + vals[m]) / 2;
      }
    }
    return bg;
  }
  function dilate3(src, w, h) { // 3x3 square max, separable
    var tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), x, y, i;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      tmp[i] = src[i] | (x > 0 ? src[i - 1] : 0) | (x < w - 1 ? src[i + 1] : 0);
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      out[i] = tmp[i] | (y > 0 ? tmp[i - w] : 0) | (y < h - 1 ? tmp[i + w] : 0);
    }
    return out;
  }
  function erode3(src, w, h) {
    var tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), x, y, i;
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      tmp[i] = src[i] & (x > 0 ? src[i - 1] : 0) & (x < w - 1 ? src[i + 1] : 0);
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      i = y * w + x;
      out[i] = tmp[i] & (y > 0 ? tmp[i - w] : 0) & (y < h - 1 ? tmp[i + w] : 0);
    }
    return out;
  }

  function Detector(cfg) {
    this.cfg = cfg;
    this.w = cfg.width; this.h = cfg.height;
    this.offsets = cfg.offsets;
    this.maxOff = Math.max.apply(null, cfg.offsets.map(Math.abs));
    this.buf = []; // {idx, gray, rgba}
    this.done = -1;
    this.byFrame = {};
  }
  Detector.prototype.push = function (idx, gray, rgba) {
    this.buf.push({ idx: idx, gray: gray, rgba: rgba });
    this.byFrame[idx] = this.byFrame[idx] || [];
    for (;;) {
      var pos = this.nextPos();
      if (pos < 0 || this.buf.length - 1 - pos < this.maxOff) break;
      this.process(pos);
      while (this.buf.length && (pos = this.nextPos()) > this.maxOff) this.buf.shift();
    }
  };
  Detector.prototype.nextPos = function () {
    for (var i = 0; i < this.buf.length; i++) if (this.buf[i].idx > this.done) return i;
    return -1;
  };
  Detector.prototype.flush = function () {
    var pos;
    while ((pos = this.nextPos()) >= 0) this.process(pos);
    this.buf = [];
    return this.byFrame;
  };
  Detector.prototype.process = function (pos) {
    var cfg = this.cfg, w = this.w, h = this.h, n = w * h;
    var cur = this.buf[pos];
    this.done = cur.idx;
    var refs = [];
    for (var o = 0; o < this.offsets.length; o++) {
      var j = pos + this.offsets[o];
      if (j >= 0 && j < this.buf.length) refs.push(this.buf[j].gray);
    }
    if (refs.length < 3) return;
    var bg = medianBg(refs, n), g = cur.gray;
    var diff = new Uint8Array(n), i;
    for (i = 0; i < n; i++) { var d = g[i] - bg[i]; diff[i] = d < 0 ? -d : d; }
    if (cfg.exclude) for (var e = 0; e < cfg.exclude.length; e++) {
      var r = cfg.exclude[e];
      for (var yy = r[1]; yy < r[1] + r[3] && yy < h; yy++) for (var xx = r[0]; xx < r[0] + r[2] && xx < w; xx++) diff[yy * w + xx] = 0;
    }
    // noise level from a subsampled histogram
    var hist = new Uint32Array(256), cnt = 0;
    for (i = 0; i < n; i += 7) { hist[diff[i]]++; cnt++; }
    var half = cnt / 2, acc = 0, med = 0;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= half) { med = i; break; } }
    var thr = Math.max(cfg.minThreshold, cfg.noiseK * (1.4826 * med + 1e-3));
    var mask = new Uint8Array(n);
    for (i = 0; i < n; i++) mask[i] = diff[i] > thr ? 1 : 0;
    for (i = 0; i < cfg.closeIter; i++) mask = dilate3(mask, w, h);
    for (i = 0; i < cfg.closeIter; i++) mask = erode3(mask, w, h);
    this.components(cur, diff, mask);
  };
  Detector.prototype.components = function (cur, diff, mask) {
    var cfg = this.cfg, w = this.w, h = this.h, n = w * h, rgba = cur.rgba;
    var dmin = cfg.minDiam, dmax = cfg.maxDiam, maxE = cfg.maxElong;
    var aMin = Math.max(4, 0.5 * dmin * dmin), aMax = Math.PI / 4 * dmax * dmax * maxE;
    var stack = new Int32Array(n), seen = new Uint8Array(n), cands = [];
    var pix = new Int32Array(Math.ceil(aMax) + 16);
    for (var s0 = 0; s0 < n; s0++) {
      if (!mask[s0] || seen[s0]) continue;
      var sp = 0, area = 0, tooBig = false;
      stack[sp++] = s0; seen[s0] = 1;
      var sw = 0, swx = 0, swy = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      var minx = w, maxx = 0, miny = h, maxy = 0, vmaxSum = 0, satSum = 0, dmaxv = 0;
      while (sp) {
        var p = stack[--sp], x = p % w, y = (p - x) / w;
        if (area < pix.length) pix[area] = p; else tooBig = true;
        area++;
        var wt = diff[p];
        sw += wt; swx += wt * x; swy += wt * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
        if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (wt > dmaxv) dmaxv = wt;
        if (rgba) {
          var q = p * 4, R = rgba[q], Gc = rgba[q + 1], B = rgba[q + 2];
          var mx = Math.max(R, Gc, B), mn = Math.min(R, Gc, B);
          vmaxSum += mx; satSum += mx > 0 ? (mx - mn) / mx : 0;
        }
        if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
        if (y > 0) {
          if (mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
          if (x > 0 && mask[p - w - 1] && !seen[p - w - 1]) { seen[p - w - 1] = 1; stack[sp++] = p - w - 1; }
          if (x < w - 1 && mask[p - w + 1] && !seen[p - w + 1]) { seen[p - w + 1] = 1; stack[sp++] = p - w + 1; }
        }
        if (y < h - 1) {
          if (mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
          if (x > 0 && mask[p + w - 1] && !seen[p + w - 1]) { seen[p + w - 1] = 1; stack[sp++] = p + w - 1; }
          if (x < w - 1 && mask[p + w + 1] && !seen[p + w + 1]) { seen[p + w + 1] = 1; stack[sp++] = p + w + 1; }
        }
      }
      if (tooBig || area < aMin || area > aMax || sw <= 0) continue;
      if (Math.max(maxx - minx + 1, maxy - miny + 1) > dmax * maxE * 1.2) continue;
      var cx = swx / sw, cy = swy / sw;
      var nn = Math.max(area - 1, 1);
      var a = (sxx - sx * sx / area) / nn, c = (syy - sy * sy / area) / nn, b = (sxy - sx * sy / area) / nn;
      var tr = (a + c) / 2, det = Math.sqrt(((a - c) / 2) * ((a - c) / 2) + b * b);
      var l1 = Math.max(tr + det, 1e-6), l0 = Math.max(tr - det, 1e-6);
      var elong = Math.sqrt(l1 / l0);
      if (elong > maxE) continue;
      var fill = area / (Math.PI * 2 * Math.sqrt(l1) * 2 * Math.sqrt(l0));
      if (fill < cfg.minFill || fill > 1.35) continue;
      var angle = 0.5 * Math.atan2(2 * b, a - c);
      var blend = Math.min(1, (elong - 1) / 2);
      var diam = Math.sqrt(l0) * (4 - (4 - 2 * Math.sqrt(3)) * blend);
      var length = Math.max(diam, 2 * Math.sqrt(3) * Math.sqrt(l1));
      if (diam < dmin || diam > dmax) continue;
      var whiteness = rgba ? (vmaxSum / area / 255) * (1 - satSum / area) : 0.5;
      var score = (1 / elong) * Math.min(fill, 1) * (0.5 + whiteness);
      cands.push({ frame: cur.idx, x: cx, y: cy, diameter: diam, length: length, angle: angle, area: area, elongation: elong,
        whiteness: whiteness, contrast: dmaxv, score: score });
    }
    cands.sort(function (p, q) { return q.score - p.score; });
    cands = cands.slice(0, cfg.maxCands);
    // keep a small foreground patch per candidate for the sub-pixel fit later
    for (var k = 0; k < cands.length; k++) {
      var cd = cands[k], r0 = Math.max(cd.diameter / 2, 1.5), lh0 = Math.max(0, (cd.length - cd.diameter) / 2);
      var hw = Math.ceil(r0 + lh0 + Math.max(4, 0.6 * r0));
      var x0 = Math.round(cd.x) - hw, y0 = Math.round(cd.y) - hw, pw = 2 * hw + 1;
      if (x0 < 0 || y0 < 0 || x0 + pw > w || y0 + pw > h) continue;
      var patch = new Uint8Array(pw * pw);
      for (var py = 0; py < pw; py++) patch.set(diff.subarray((y0 + py) * w + x0, (y0 + py) * w + x0 + pw), py * pw);
      cd.patch = { x0: x0, y0: y0, size: pw, data: patch };
    }
    this.byFrame[cur.idx] = cands;
  };

  // ---------------------------------------------------------------- tracking
  function polyfit2(f, v) { // least squares v = c0 + c1 f + c2 f^2
    var n = f.length, S = [0, 0, 0, 0, 0], T = [0, 0, 0];
    for (var i = 0; i < n; i++) {
      var x = f[i], x2 = x * x;
      S[0] += 1; S[1] += x; S[2] += x2; S[3] += x2 * x; S[4] += x2 * x2;
      T[0] += v[i]; T[1] += v[i] * x; T[2] += v[i] * x2;
    }
    return solve([[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]], T);
  }
  function polyfit(f, v, deg) {
    var m = deg + 1, A = [], B = [], i, j, k;
    for (i = 0; i < m; i++) { A.push(new Array(m).fill(0)); B.push(0); }
    var f0 = 0; for (i = 0; i < f.length; i++) f0 += f[i]; f0 /= f.length;
    for (k = 0; k < f.length; k++) {
      var pw = [1]; for (i = 1; i < 2 * m; i++) pw.push(pw[i - 1] * (f[k] - f0));
      for (i = 0; i < m; i++) { B[i] += v[k] * pw[i]; for (j = 0; j < m; j++) A[i][j] += pw[i + j]; }
    }
    var c = solve(A, B);
    return function (x) { var s = 0, t = 1; for (var q = 0; q < m; q++) { s += c[q] * t; t *= (x - f0); } return s; };
  }
  function solve(A, b) { // Gaussian elimination with partial pivoting
    var n = b.length, M = A.map(function (r, i) { return r.slice().concat([b[i]]); }), i, j, k;
    for (i = 0; i < n; i++) {
      var p = i; for (k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
      var t = M[i]; M[i] = M[p]; M[p] = t;
      var d = M[i][i]; if (Math.abs(d) < 1e-12) d = 1e-12;
      for (k = i + 1; k < n; k++) { var fct = M[k][i] / d; for (j = i; j <= n; j++) M[k][j] -= fct * M[i][j]; }
    }
    var x = new Array(n).fill(0);
    for (i = n - 1; i >= 0; i--) { var s = M[i][n]; for (j = i + 1; j < n; j++) s -= M[i][j] * x[j]; x[i] = s / (Math.abs(M[i][i]) < 1e-12 ? 1e-12 : M[i][i]); }
    return x;
  }

  function predict(pts, frame) {
    var fwd = frame > pts[pts.length - 1].frame;
    if (pts.length < 5) {
      var a = fwd ? pts[pts.length - 2] : pts[1], b = fwd ? pts[pts.length - 1] : pts[0];
      var k = (frame - b.frame) / (b.frame - a.frame);
      return [b.x + (b.x - a.x) * k, b.y + (b.y - a.y) * k];
    }
    var sel = fwd ? pts.slice(-6) : pts.slice(0, 6);
    var f = sel.map(function (p) { return p.frame; });
    var px = polyfit(f, sel.map(function (p) { return p.x; }), 2), py = polyfit(f, sel.map(function (p) { return p.y; }), 2);
    return [px(frame), py(frame)];
  }
  function extend(track, byFrame, used, cfg, fwd, range) {
    var pts = track.slice(), gap = 0;
    for (;;) {
      var last = fwd ? pts[pts.length - 1] : pts[0];
      var f = last.frame + (1 + gap) * (fwd ? 1 : -1);
      if (f < range[0] || f > range[1]) break;
      var pr = predict(pts, f);
      var a = fwd ? pts[pts.length - 2] : pts[0], b = fwd ? pts[pts.length - 1] : pts[1];
      var step = Math.hypot(b.x - a.x, b.y - a.y) / Math.abs(b.frame - a.frame);
      var near = fwd ? pts.slice(-5) : pts.slice(0, 5), dm = 0;
      for (var i = 0; i < near.length; i++) dm += near[i].diameter; dm /= near.length;
      var gate = cfg.seedGate * step + 0.6 * dm + 2.0, best = null, bd = gate;
      var cs = byFrame[f] || [];
      for (i = 0; i < cs.length; i++) {
        var c = cs[i]; if (used.has(c)) continue;
        var r = c.diameter / dm; if (r > cfg.maxSizeRatio || r < 1 / cfg.maxSizeRatio) continue;
        var d = Math.hypot(c.x - pr[0], c.y - pr[1]);
        if (d < bd) { best = c; bd = d; }
      }
      if (!best) { gap++; if (gap > cfg.maxGap) break; continue; }
      gap = 0;
      if (fwd) pts.push(best); else pts.unshift(best);
    }
    return pts;
  }
  function trim(pts) {
    pts = pts.slice();
    var changed = true;
    while (changed && pts.length >= 6) {
      changed = false;
      for (var e = 0; e < 2; e++) {
        var rest = e === 0 ? pts.slice(0, -1) : pts.slice(1), p = e === 0 ? pts[pts.length - 1] : pts[0];
        var pr = predict(rest, p.frame);
        var ds = rest.map(function (q) { return q.diameter; }).sort(function (x, y) { return x - y; });
        var dmed = ds[ds.length >> 1];
        if (Math.hypot(p.x - pr[0], p.y - pr[1]) > Math.max(3, 0.35 * dmed)) { pts = rest; changed = true; break; }
      }
    }
    return pts;
  }
  function quality(pts) {
    var n = pts.length, f = pts.map(function (p) { return p.frame; });
    var d = pts.map(function (p) { return p.diameter; });
    var deg = n >= 10 ? 3 : n >= 5 ? 2 : 1;
    var fx = polyfit(f, pts.map(function (p) { return p.x; }), deg), fy = polyfit(f, pts.map(function (p) { return p.y; }), deg);
    var ss = 0, i;
    for (i = 0; i < n; i++) { var ex = pts[i].x - fx(f[i]), ey = pts[i].y - fy(f[i]); ss += ex * ex + ey * ey; }
    var rms = Math.sqrt(ss / n), dmean = mean(d);
    var steps = [], nsteps = [];
    for (i = 1; i < n; i++) {
      var st = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y) / (f[i] - f[i - 1]);
      steps.push(st); nsteps.push(st / ((d[i] + d[i - 1]) / 2));
    }
    var mw = mean(pts.map(function (p) { return p.whiteness; }));
    return { n: n, rmsFrac: rms / Math.max(dmean, 1), speedPx: median(steps), speedCv: nsteps.length > 1 ? std(nsteps) / mean(nsteps) : 0,
      sizeCv: std(d) / dmean, whiteness: mw };
  }
  function mean(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
  function std(a) { var m = mean(a), s = 0; for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return a.length ? Math.sqrt(s / a.length) : 0; }
  function median(a) { if (!a.length) return 0; var b = a.slice().sort(function (x, y) { return x - y; }), m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }

  function findTracks(byFrame, cfg) {
    var frames = Object.keys(byFrame).map(Number).sort(function (a, b) { return a - b; });
    if (!frames.length) return [];
    var range = [frames[0], frames[frames.length - 1]], seeds = [], loR = 1 / cfg.maxSizeRatio;
    for (var fi = 0; fi < frames.length; fi++) {
      var f = frames[fi], A = byFrame[f] || [];
      if (!A.length) continue;
      for (var g1 = 1; g1 <= cfg.maxGap + 1; g1++) {
        var B = byFrame[f + g1] || [];
        if (!B.length) continue;
        for (var ia = 0; ia < A.length; ia++) for (var ib = 0; ib < B.length; ib++) {
          var a = A[ia], b = B[ib];
          var dx = b.x - a.x, dy = b.y - a.y, sab = Math.hypot(dx, dy) / g1, r = b.diameter / a.diameter;
          var sdiam = sab / ((a.diameter + b.diameter) / 2);
          if (sab < cfg.minStepPx || r > cfg.maxSizeRatio || r < loR || sdiam < cfg.minStepDiam || sdiam > cfg.maxStepDiam) continue;
          for (var g2 = 1; g2 <= cfg.maxGap + 1; g2++) {
            var C = byFrame[f + g1 + g2] || [];
            var px = b.x + dx / g1 * g2, py = b.y + dy / g1 * g2, dm = (a.diameter + b.diameter) / 2;
            var gate = cfg.seedGate * sab * g2 + 0.6 * dm + 2.0;
            for (var ic = 0; ic < C.length; ic++) {
              var c = C[ic], e = Math.hypot(c.x - px, c.y - py), rc = c.diameter / dm;
              if (e > gate || rc > cfg.maxSizeRatio || rc < loR) continue;
              seeds.push([e / gate - 0.1 * (a.whiteness + b.whiteness + c.whiteness), a, b, c]);
            }
          }
        }
      }
    }
    seeds.sort(function (p, q) { return p[0] - q[0]; });
    if (seeds.length > cfg.maxSeeds) seeds.length = cfg.maxSeeds;
    var used = new Set(), tried = new Set(), tracks = [], ids = new Map(), nextId = 0;
    function id(o) { if (!ids.has(o)) ids.set(o, nextId++); return ids.get(o); }
    for (var s = 0; s < seeds.length; s++) {
      var sa = seeds[s][1], sb = seeds[s][2], sc = seeds[s][3];
      if (used.has(sa) || used.has(sb) || used.has(sc)) continue;
      var key = id(sa) + "," + id(sb) + "," + id(sc);
      if (tried.has(key)) continue;
      var pts = extend([sa, sb, sc], byFrame, used, cfg, true, range);
      pts = extend(pts, byFrame, used, cfg, false, range);
      var tr = trim(pts);
      if (tr.length < cfg.minLen) {
        for (var k = 0; k + 2 < pts.length; k++) tried.add(id(pts[k]) + "," + id(pts[k + 1]) + "," + id(pts[k + 2]));
        continue;
      }
      var q = quality(tr);
      if (q.rmsFrac > cfg.maxRmsFrac || q.speedCv > cfg.maxSpeedCv || q.sizeCv > cfg.maxSizeCv || q.speedPx < cfg.minStepPx) continue;
      for (k = 0; k < pts.length; k++) used.add(pts[k]);
      tracks.push(tr);
    }
    tracks.sort(function (p, q) { return p[0].frame - q[0].frame; });
    return tracks;
  }

  // ---------------------------------------------------------------- sub-pixel fit
  var SUB = [-1 / 3, 0, 1 / 3];
  function blurredDisk(size, x0, y0, cx, cy, r, lh, th, out) {
    lh = Math.max(lh, 1e-3);
    var ct = Math.cos(th), st = Math.sin(th), rr = r * r, inv = 1 / (2 * lh * 9), i = 0;
    for (var py = 0; py < size; py++) for (var px = 0; px < size; px++, i++) {
      var acc = 0;
      for (var a = 0; a < 3; a++) for (var b = 0; b < 3; b++) {
        var dx = x0 + px + SUB[a] - cx, dy = y0 + py + SUB[b] - cy;
        var s = dx * ct + dy * st, u = -dx * st + dy * ct, h2 = rr - u * u;
        if (h2 <= 0) continue;
        var hh = Math.sqrt(h2), ov = Math.min(s + hh, lh) - Math.max(s - hh, -lh);
        if (ov > 0) acc += ov;
      }
      out[i] = acc * inv;
    }
  }
  function greyClose(data, size, k) {
    var rad = k >> 1;
    function pass(src, op) {
      var tmp = new Float64Array(size * size), out = new Float64Array(size * size), x, y, j, v;
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) {
        v = src[y * size + x];
        for (j = -rad; j <= rad; j++) { var xx = x + j; if (xx >= 0 && xx < size) v = op(v, src[y * size + xx]); }
        tmp[y * size + x] = v;
      }
      for (y = 0; y < size; y++) for (x = 0; x < size; x++) {
        v = tmp[y * size + x];
        for (j = -rad; j <= rad; j++) { var yy = y + j; if (yy >= 0 && yy < size) v = op(v, tmp[yy * size + x]); }
        out[y * size + x] = v;
      }
      return out;
    }
    return pass(pass(data, Math.max), Math.min);
  }
  function fitPoint(c) {
    if (!c.patch) return null;
    var P = c.patch, size = P.size, n = size * size;
    var r0 = Math.max(c.diameter / 2, 1.5), lh0 = Math.max(0, (c.length - c.diameter) / 2);
    var data = new Float64Array(n), i;
    for (i = 0; i < n; i++) data[i] = P.data[i];
    data = greyClose(data, size, Math.max(5, Math.round(0.4 * r0)) | 1);
    var sorted = Array.prototype.slice.call(data).sort(function (a, b) { return a - b; });
    var a0 = sorted[Math.floor(0.98 * (n - 1))];
    var half = (size - 1) / 2;
    var p = [c.x, c.y, r0, lh0 + 0.5, c.angle, a0, 0];
    var lo = [c.x - half / 2, c.y - half / 2, 0.5 * r0, 0, c.angle - Math.PI, 0, -50];
    var hi = [c.x + half / 2, c.y + half / 2, 1.8 * r0, Math.max(3 * half, 1), c.angle + Math.PI, 512, 50];
    var model = new Float64Array(n), tmp = new Float64Array(n);
    function resid(q, out) {
      blurredDisk(size, P.x0, P.y0, q[0], q[1], q[2], q[3], q[4], tmp);
      var ss = 0;
      for (var k = 0; k < n; k++) { var e = q[5] * tmp[k] + q[6] - data[k]; out[k] = e; ss += e * e; }
      return ss;
    }
    var res = new Float64Array(n), cost = resid(p, res), lambda = 1e-2, steps = [0.05, 0.05, 0.05, 0.05, 0.01, 0, 0];
    var J = []; for (i = 0; i < 7; i++) J.push(new Float64Array(n));
    for (var it = 0; it < 40; it++) {
      for (var j = 0; j < 7; j++) {
        if (j === 5) { blurredDisk(size, P.x0, P.y0, p[0], p[1], p[2], p[3], p[4], tmp); J[5].set(tmp); continue; }
        if (j === 6) { J[6].fill(1); continue; }
        var q = p.slice(); q[j] += steps[j];
        resid(q, model);
        for (var k = 0; k < n; k++) J[j][k] = (model[k] - res[k]) / steps[j];
      }
      var JtJ = [], Jtr = [];
      for (var a = 0; a < 7; a++) {
        JtJ.push(new Array(7).fill(0)); var s = 0;
        for (k = 0; k < n; k++) s += J[a][k] * res[k];
        Jtr.push(-s);
        for (var b = 0; b <= a; b++) { var t = 0; for (k = 0; k < n; k++) t += J[a][k] * J[b][k]; JtJ[a][b] = t; JtJ[b][a] = t; }
      }
      var improved = false;
      for (var tries = 0; tries < 6; tries++) {
        var A = JtJ.map(function (row, ri) { var r2 = row.slice(); r2[ri] *= (1 + lambda); r2[ri] += 1e-9; return r2; });
        var dlt = solve(A, Jtr), cand = p.slice();
        for (a = 0; a < 7; a++) cand[a] = Math.min(hi[a], Math.max(lo[a], p[a] + dlt[a]));
        var r2 = new Float64Array(n), c2 = resid(cand, r2);
        if (c2 < cost) { p = cand; res = r2; cost = c2; lambda = Math.max(lambda / 3, 1e-7); improved = true; break; }
        lambda *= 4;
      }
      if (!improved || cost < 1e-9) break;
    }
    if (p[5] <= 0) return null;
    var rmsFrac = Math.sqrt(cost / n) / p[5];
    return { x: p[0], y: p[1], diameter: 2 * p[2], blur: 2 * p[3], cost: rmsFrac };
  }
  function refineTracks(tracks) {
    tracks.forEach(function (tr) {
      tr.forEach(function (c) {
        var fit = fitPoint(c);
        if (!fit || fit.cost > 0.35 || fit.diameter < 0.6 * c.diameter || fit.diameter > 1.6 * c.diameter) return;
        c.x = fit.x; c.y = fit.y; c.diameter = fit.diameter; c.length = Math.max(fit.diameter, fit.diameter + fit.blur); c.refined = true;
      });
    });
  }

  // ---------------------------------------------------------------- measurement
  function robustLin(t, y) {
    var keep = t.map(function () { return true; }), coef = [0, 0];
    function fit() {
      var n = 0, st = 0, sy = 0, stt = 0, sty = 0;
      for (var i = 0; i < t.length; i++) if (keep[i]) { n++; st += t[i]; sy += y[i]; stt += t[i] * t[i]; sty += t[i] * y[i]; }
      var den = n * stt - st * st;
      var b = den ? (n * sty - st * sy) / den : 0, a = (sy - b * st) / n;
      return [a, b, n, den];
    }
    for (var it = 0; it < 2; it++) {
      coef = fit();
      var res = t.map(function (ti, i) { return y[i] - (coef[0] + coef[1] * ti); });
      var mad = 1.4826 * median(res.filter(function (_, i) { return keep[i]; }).map(Math.abs)) + 1e-9;
      var nk = res.map(function (r) { return Math.abs(r) <= Math.max(3.5 * mad, 1e-6); });
      if (nk.filter(Boolean).length < 3 || nk.every(function (v, i) { return v === keep[i]; })) break;
      keep = nk;
    }
    coef = fit();
    var ss = 0, n = coef[2];
    for (var i = 0; i < t.length; i++) if (keep[i]) { var e = y[i] - (coef[0] + coef[1] * t[i]); ss += e * e; }
    var s2 = ss / Math.max(1, n - 2), sb = coef[3] > 0 ? Math.sqrt(s2 * n / coef[3]) : 0;
    return { a: coef[0], b: coef[1], sb: sb };
  }
  function scaleFor(tr, calib) {
    var d = tr.map(function (p) { return p.diameter; }).sort(function (a, b) { return a - b; });
    var core = d.length >= 5 ? d.slice(Math.floor(d.length * 0.2), Math.ceil(d.length * 0.8)) : d;
    var dmed = median(core);
    if (calib.cameraDistanceM && calib.hfovDeg) {
      var f = calib.width / 2 / Math.tan(calib.hfovDeg * Math.PI / 360);
      return { s: f / calib.cameraDistanceM, method: "camera", dmed: dmed };
    }
    return { s: dmed / DIAM, method: "ball", dmed: dmed };
  }
  function measure(tr, calib, tRef, drag) {
    var fps = calib.fps;
    var t = tr.map(function (p) { return p.frame / fps; }), t0 = mean(t);
    var sc = scaleFor(tr, calib), s = sc.s;
    var tt = t.map(function (v) { return v - t0; });
    var roll = (calib.rollDeg || 0) * Math.PI / 180, cr = Math.cos(-roll), sr = Math.sin(-roll);
    var cxm = calib.width / 2, cym = calib.height / 2;
    var xy = tr.map(function (p) { var dx = p.x - cxm, dy = p.y - cym; return [dx * cr - dy * sr + cxm, dx * sr + dy * cr + cym]; });
    var X = xy.map(function (q) { return (q[0] - xy[0][0]) / s; });
    var Y = xy.map(function (q, i) { return -(q[1] - xy[0][1]) / s + 0.5 * G * tt[i] * tt[i]; });
    var fx = robustLin(tt, X), fy = robustLin(tt, Y);
    var vel = [fx.b, fy.b, 0], pos = [fx.a, fy.a, 0];
    if (tRef === undefined || tRef === null) tRef = t0;
    var dt = tRef - t0, vref = vel;
    if (drag !== false && Math.abs(dt) > 1e-6) vref = integrate(pos, vel, dt, Math.min(1e-3, Math.abs(dt) / 4)).v;
    var speed = Math.hypot(vref[0], vref[1], vref[2]);
    var vn = Math.hypot(vel[0], vel[1]) || 1e-9;
    var fitSig = Math.sqrt(Math.pow(vel[0] / vn * fx.sb, 2) + Math.pow(vel[1] / vn * fy.sb, 2));
    var d = tr.map(function (p) { return p.diameter; });
    var scaleRel = sc.method === "ball" ? std(d) / mean(d) / Math.sqrt(d.length) : 0;
    var sigma = Math.hypot(fitSig, speed * scaleRel);
    var angle = Math.atan2(vref[1], Math.abs(vref[0])) * 180 / Math.PI;
    var warnings = [];
    if (d.length >= 5) {
      var fd = polyfit(tt, d, 1), rel = Math.abs(fd(tt[tt.length - 1]) - fd(tt[0])) / mean(d);
      if (rel > 0.12) warnings.push("offplane");
    }
    if (sc.dmed < 4 && sc.method === "ball") warnings.push("small");
    if (tr.length < 6) warnings.push("few");
    return { speedMs: speed, speedMph: speed * MPH, sigmaMph: sigma * MPH, angle: angle, tRef: tRef, scale: sc, n: tr.length, warnings: warnings, velocity: vref };
  }
  function contactTime(pitch, batted, fps) {
    var tb0 = batted[0].frame / fps;
    if (!pitch || pitch.length < 3) return tb0 - 0.5 / fps;
    var P = pitch.slice(-6), Bt = batted.slice(0, 6);
    function lin(pts, key) { return polyfit(pts.map(function (p) { return p.frame / fps; }), pts.map(function (p) { return p[key]; }), 1); }
    var px = lin(P, "x"), py = lin(P, "y"), bx = lin(Bt, "x"), by = lin(Bt, "y");
    var ta = pitch[pitch.length - 1].frame / fps, best = ta, bd = Infinity;
    for (var i = 0; i <= 200; i++) {
      var ts = ta + (tb0 - ta) * i / 200, d = Math.hypot(px(ts) - bx(ts), py(ts) - by(ts));
      if (d < bd) { bd = d; best = ts; }
    }
    return best;
  }
  function hdir(tr) { return tr[tr.length - 1].x - tr[0].x >= 0 ? 1 : -1; }
  function stepSpeed(tr) {
    var s = []; for (var i = 1; i < tr.length; i++) s.push(Math.hypot(tr[i].x - tr[i - 1].x, tr[i].y - tr[i - 1].y) / (tr[i].frame - tr[i - 1].frame));
    return median(s);
  }
  function trackScore(tr) {
    var q = quality(tr);
    return tr.length * (1 - Math.min(q.rmsFrac, 0.9)) * (1 - Math.min(q.speedCv, 0.9)) * (0.5 + q.whiteness);
  }
  function confidence(m) {
    var rel = m.sigmaMph / Math.max(m.speedMph, 1e-6);
    if (m.n >= 8 && rel < 0.03 && !m.warnings.length) return "high";
    if (m.n >= 5 && rel < 0.08) return "medium";
    return "low";
  }

  function buildEvents(tracks, calib, opts) {
    var fps = calib.fps, minMph = opts.minSpeedMph || 15;
    var fast = tracks.filter(function (tr) { return measure(tr, calib, null, false).speedMph >= minMph; });
    fast.sort(function (a, b) { return a[0].frame - b[0].frame; });
    var groups = [];
    fast.forEach(function (tr) {
      var g = groups[groups.length - 1];
      if (g && (tr[0].frame - Math.max.apply(null, g.map(function (t) { return t[t.length - 1].frame; }))) / fps <= 0.4) g.push(tr);
      else groups.push([tr]);
    });
    var events = [];
    groups.forEach(function (g) {
      var ranked = g.slice().sort(function (a, b) { return trackScore(b) - trackScore(a); });
      if (opts.mode === "pitching") {
        var pt = ranked[0], mp = measure(pt, calib, pt[0].frame / fps);
        events.push({ type: "pitch", pitch: pt, pitchM: mp, confidence: confidence(mp) });
        return;
      }
      var want = opts.direction === "left" ? -1 : opts.direction === "right" ? 1 : 0;
      var pitch = null, batted = null, bestSc = 0;
      g.forEach(function (b) {
        if (want && hdir(b) !== want) return;
        g.forEach(function (p) {
          if (p === b || hdir(p) === hdir(b)) return;
          var gap = b[0].frame - p[p.length - 1].frame;
          if (gap < -2 || gap > 0.05 * fps + 3) return;
          var d = median(b.map(function (q) { return q.diameter; }));
          var dist = Math.hypot(p[p.length - 1].x - b[0].x, p[p.length - 1].y - b[0].y);
          if (dist > (stepSpeed(p) + stepSpeed(b)) * (Math.max(gap, 0) + 1) + 4 * d) return;
          var sc = trackScore(p) + trackScore(b);
          if (sc > bestSc) { bestSc = sc; pitch = p; batted = b; }
        });
      });
      if (!batted) for (var i = 0; i < ranked.length; i++) if (!want || hdir(ranked[i]) === want) { batted = ranked[i]; break; }
      if (!batted) return;
      var tc = contactTime(pitch, batted, fps);
      var m = measure(batted, calib, tc);
      var ev = { type: "hit", batted: batted, m: m, contactTime: tc, confidence: confidence(m),
        exitVelocity: m.speedMph, launchAngle: m.angle, carryFt: carryFt(m.speedMs, m.angle, opts.contactHeight || 0.9),
        barrel: barrel(m.speedMph, m.angle) };
      if (pitch) { ev.pitch = pitch; ev.pitchM = measure(pitch, calib, pitch[0].frame / fps); }
      events.push(ev);
    });
    return events;
  }

  // ---------------------------------------------------------------- public API
  function create(o) {
    var fps = o.fps, k = Math.max(1, Math.min(8, Math.round(fps / 60)));
    var minSpeed = o.minSpeedMph || 15, maxSpeed = o.maxSpeedMph || 130, perFrame = DIAM * fps;
    var det = new Detector({ width: o.width, height: o.height, offsets: [-2 * k, -k, k, 2 * k], minThreshold: 14, noiseK: 5,
      closeIter: 2, minDiam: o.minDiam || 3, maxDiam: o.maxDiam || 70, maxElong: 7, minFill: 0.6, maxCands: 30, exclude: o.exclude });
    var tcfg = { minLen: fps < 100 ? 3 : 5, maxGap: 2, minStepPx: 1.0, maxSizeRatio: 1.8, seedGate: 0.25, maxRmsFrac: 0.25, maxSpeedCv: 0.3,
      maxSizeCv: 0.35, minStepDiam: 0.8 * (minSpeed / MPH) / perFrame, maxStepDiam: 1.3 * (maxSpeed / MPH) / perFrame, maxSeeds: 20000 };
    var calib = { fps: fps, width: o.width, height: o.height, cameraDistanceM: o.cameraDistanceM, hfovDeg: o.hfovDeg, rollDeg: o.rollDeg || 0 };
    return {
      push: function (idx, gray, rgba) { det.push(idx, gray, rgba); },
      finish: function () {
        var byFrame = det.flush();
        var tracks = findTracks(byFrame, tcfg);
        refineTracks(tracks);
        var events = buildEvents(tracks, calib, o);
        var cands = 0; for (var f in byFrame) cands += byFrame[f].length;
        return { events: events, tracks: tracks, candidates: cands, fps: fps };
      }
    };
  }

  var api = { create: create, carryFt: carryFt, barrel: barrel, MPH: MPH };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BallEngine = api;
})(typeof self !== "undefined" ? self : this);
