/* Lanista Ball Tracker web app: reads a video in the browser, runs engine.js on every frame,
 * and shows the numbers plus a replay of the ball's path. Nothing is uploaded anywhere. */
(function () {
  "use strict";
  var MAX_W = 960, MAX_FRAMES = 6000, LONG_FRAMES = 2400, SHAKY = 0.08; // tripod clips score 0-2%, handheld or panning 10-80%
  var $ = function (id) { return document.getElementById(id); };
  var els = {
    pick: $("pick"), file: $("file"), drop: $("drop"), sample: $("sample"), tool: $("tool"),
    progress: $("progress"), bar: $("bar"), ptext: $("ptext"), result: $("result"), again: $("again"),
    board: $("board"), chips: $("chips"), notes: $("notes"), replay: $("replay"), canvas: $("canvas"),
    slider: $("slider"), play: $("play"), message: $("message"), setup: $("setup"), fname: $("fname")
  };
  var choice = { filmed: "240", direction: "auto" };
  document.querySelectorAll("[data-group]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var g = btn.getAttribute("data-group");
      choice[g] = btn.getAttribute("data-value");
      document.querySelectorAll('[data-group="' + g + '"]').forEach(function (b) { b.setAttribute("aria-pressed", b === btn ? "true" : "false"); });
    });
  });
  function setChoice(g, v) { var b = document.querySelector('[data-group="' + g + '"][data-value="' + v + '"]'); if (b) b.click(); }

  els.pick.addEventListener("click", function () { els.file.click(); });
  els.file.addEventListener("change", function () { if (els.file.files[0]) run(els.file.files[0]); els.file.value = ""; });
  ["dragenter", "dragover"].forEach(function (t) { els.drop.addEventListener(t, function (e) { e.preventDefault(); els.drop.classList.add("over"); }); });
  ["dragleave", "drop"].forEach(function (t) { els.drop.addEventListener(t, function (e) { e.preventDefault(); els.drop.classList.remove("over"); }); });
  els.drop.addEventListener("drop", function (e) { var f = e.dataTransfer.files[0]; if (f) run(f); });
  els.sample.addEventListener("click", function () {
    setChoice("filmed", "240");
    setChoice("direction", "auto");
    $("distance").value = "";
    showProgress("Loading the sample video…", 0);
    fetch("media/sample-batting-practice.mp4").then(function (r) { return r.blob(); }).then(function (b) {
      run(new File([b], "Sample: batting practice (240 fps)", { type: "video/mp4" }));
    }).catch(function () { showMessage("bad", "The sample didn't load", "Check your connection and try again."); });
  });
  els.again.addEventListener("click", reset);
  document.querySelectorAll("[data-start]").forEach(function (a) {
    a.addEventListener("click", function (e) { e.preventDefault(); reset(); els.tool.scrollIntoView({ behavior: "smooth", block: "start" }); els.pick.focus({ preventScroll: true }); });
  });

  function reset() {
    stopPlay();
    els.result.hidden = true; els.progress.hidden = true; els.message.hidden = true;
    els.setup.hidden = false;
    if (state.url) { URL.revokeObjectURL(state.url); state.url = null; }
  }
  function showProgress(text, frac) {
    els.setup.hidden = true; els.result.hidden = true; els.message.hidden = true; els.progress.hidden = false;
    els.ptext.textContent = text; els.bar.style.width = Math.round((frac || 0) * 100) + "%";
  }
  function showMessage(kind, title, body, tips) {
    els.progress.hidden = true; els.result.hidden = false; els.setup.hidden = true;
    els.board.hidden = true; els.chips.innerHTML = ""; els.notes.innerHTML = ""; els.notes.hidden = true; els.replay.hidden = !state.hasReplay;
    els.message.hidden = false;
    els.message.className = "message " + kind;
    els.message.innerHTML = "<h3>" + title + "</h3><p>" + body + "</p>" + (tips ? "<ul>" + tips.map(function (t) { return "<li>" + t + "</li>"; }).join("") + "</ul>" : "");
  }

  var state = { url: null, hasReplay: false };

  // ------------------------------------------------------------ decoding with WebCodecs + mp4box
  function demux(buffer) {
    return new Promise(function (resolve, reject) {
      if (!window.MP4Box) return reject(new Error("no mp4box"));
      var mp4 = MP4Box.createFile(), info = null, samples = [];
      mp4.onError = function (e) { reject(new Error(String(e))); };
      mp4.onReady = function (i) {
        info = i;
        var track = i.videoTracks[0];
        if (!track) return reject(new Error("no video track"));
        mp4.setExtractionOptions(track.id, null, { nbSamples: 100000 });
        mp4.start();
      };
      mp4.onSamples = function (id, user, s) { samples = samples.concat(s); };
      buffer.fileStart = 0;
      mp4.appendBuffer(buffer);
      mp4.flush();
      setTimeout(function () {
        if (!info) return reject(new Error("not an mp4/mov file"));
        var track = info.videoTracks[0], trak = mp4.getTrackById(track.id), desc = null;
        trak.mdia.minf.stbl.stsd.entries.forEach(function (entry) {
          var box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
          if (box && !desc) {
            var ds = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
            box.write(ds);
            desc = new Uint8Array(ds.buffer, 8);
          }
        });
        resolve({ track: track, samples: samples, description: desc });
      }, 0);
    });
  }

  function rotationOf(track) {
    var m = track.matrix || [];
    if (m.length < 2) return 0;
    var a = Math.round(Math.atan2(m[1], m[0]) * 180 / Math.PI);
    return ((a % 360) + 360) % 360;
  }

  function Sizer(w, h, rot) {
    var dw = rot === 90 || rot === 270 ? h : w, dh = rot === 90 || rot === 270 ? w : h;
    var s = Math.min(1, MAX_W / dw);
    this.w = Math.round(dw * s / 2) * 2; this.h = Math.round(dh * s / 2) * 2; this.rot = rot;
    var c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(this.w, this.h) : Object.assign(document.createElement("canvas"), { width: this.w, height: this.h });
    this.ctx = c.getContext("2d", { willReadFrequently: true });
  }
  Sizer.prototype.read = function (src, sw, sh) {
    var ctx = this.ctx, w = this.w, h = this.h;
    ctx.save();
    if (this.rot) {
      ctx.translate(w / 2, h / 2); ctx.rotate(this.rot * Math.PI / 180);
      var rw = this.rot === 90 || this.rot === 270 ? h : w, rh = this.rot === 90 || this.rot === 270 ? w : h;
      ctx.drawImage(src, -rw / 2, -rh / 2, rw, rh);
    } else ctx.drawImage(src, 0, 0, w, h);
    ctx.restore();
    var rgba = ctx.getImageData(0, 0, w, h).data, gray = new Uint8Array(w * h);
    for (var i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114 + 500) / 1000;
    return { gray: gray, rgba: rgba };
  };

  function pickFps(fileFps) {
    if (fileFps >= 100) return fileFps;
    if (choice.filmed === "normal") return fileFps;
    return Number(choice.filmed);
  }

  async function decodeWebCodecs(file, onInfo, onFrame) {
    if (typeof VideoDecoder === "undefined") throw new Error("no webcodecs");
    var buf = await file.arrayBuffer();
    var d = await demux(buf);
    var t = d.track, samples = d.samples;
    if (!samples.length) throw new Error("no samples");
    var ts = t.timescale || samples[0].timescale;
    var durs = samples.map(function (s) { return s.duration; }).filter(function (x) { return x > 0; }).sort(function (a, b) { return a - b; });
    var fileFps = ts / durs[durs.length >> 1];
    var config = { codec: t.codec, codedWidth: t.video.width, codedHeight: t.video.height, optimizeForLatency: false };
    if (d.description) config.description = d.description;
    var sup = await VideoDecoder.isConfigSupported(config).catch(function () { return { supported: false }; });
    if (!sup.supported) { var err = new Error("codec"); err.codec = t.codec; throw err; }
    var ctsSorted = samples.map(function (s) { return Math.round(1e6 * s.cts / s.timescale); }).sort(function (a, b) { return a - b; });
    var indexOf = new Map(); ctsSorted.forEach(function (c, i) { indexOf.set(c, i); });
    var rot = rotationOf(t), sizer = new Sizer(t.video.width, t.video.height, rot);
    var total = Math.min(samples.length, MAX_FRAMES);
    var go = onInfo({ fileFps: fileFps, frames: samples.length, w: sizer.w, h: sizer.h,
      times: ctsSorted.map(function (c) { return (c - ctsSorted[0]) / 1e6; }) });
    if (go === false) return { aborted: true };
    var queue = [], failed = null, flushed = false, processed = 0;
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var decoder = new VideoDecoder({ output: function (frame) { queue.push(frame); }, error: function (e) { failed = e; } });
    decoder.configure(config);
    (async function feed() {
      for (var k = 0; k < total; k++) {
        while (!failed && (decoder.decodeQueueSize > 8 || queue.length > 8)) await sleep(2);
        if (failed) return;
        var s = samples[k];
        decoder.decode(new EncodedVideoChunk({ type: s.is_sync ? "key" : "delta", timestamp: Math.round(1e6 * s.cts / s.timescale),
          duration: Math.round(1e6 * s.duration / s.timescale), data: s.data }));
      }
      await decoder.flush();
      flushed = true;
    })().catch(function (e) { failed = failed || e; });
    for (;;) {
      if (failed) throw failed;
      if (!queue.length) { if (flushed) break; await sleep(2); continue; }
      var frame = queue.shift();
      var idx = indexOf.has(frame.timestamp) ? indexOf.get(frame.timestamp) : processed;
      var px = sizer.read(frame);
      frame.close();
      onFrame(idx, px.gray, px.rgba, processed, total);
      processed++;
      if (processed % 4 === 0) await sleep(0);
    }
    try { decoder.close(); } catch (e) { /* already closed */ }
    return { truncated: samples.length > MAX_FRAMES };
  }

  // Fallback: play the video slowly and grab every frame the browser shows.
  function decodeVideoElement(url, onInfo, onFrame) {
    return new Promise(function (resolve, reject) {
      var v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.src = url; v.preload = "auto";
      if (!("requestVideoFrameCallback" in v)) return reject(new Error("no frame callback"));
      var sizer = null, t0 = null, deltas = [], pending = [], fileFps = 0, last = -1, count = 0, times = [];
      v.addEventListener("error", function () { reject(new Error("video element can't play this file")); });
      v.addEventListener("loadedmetadata", function () {
        sizer = new Sizer(v.videoWidth, v.videoHeight, 0);
        v.playbackRate = 0.125;
        v.play().catch(reject);
        v.requestVideoFrameCallback(cb);
      });
      function handle(mt, px) {
        var idx = Math.round((mt - t0) * fileFps);
        if (idx <= last) return;
        last = idx; times[idx] = mt;
        onFrame(idx, px.gray, px.rgba, idx, Math.round(v.duration * fileFps));
      }
      function cb(now, meta) {
        var mt = meta.mediaTime, px = sizer.read(v);
        if (t0 === null) t0 = mt;
        if (!fileFps) {
          pending.push([mt, px]);
          if (pending.length > 1) { var dd = mt - pending[pending.length - 2][0]; if (dd > 0) deltas.push(dd); }
          if (pending.length >= 12) {
            fileFps = 1 / Math.min.apply(null, deltas);
            if (onInfo({ fileFps: fileFps, frames: Math.round(v.duration * fileFps), w: sizer.w, h: sizer.h, times: times }) === false) { v.pause(); return resolve({ aborted: true }); }
            pending.forEach(function (p) { handle(p[0], p[1]); });
            pending = [];
          }
        } else handle(mt, px);
        if (!v.ended && ++count < MAX_FRAMES) v.requestVideoFrameCallback(cb); else resolve({});
      }
      v.addEventListener("ended", function () { resolve({}); });
    });
  }

  // ------------------------------------------------------------ main flow
  async function run(file, opts) {
    opts = opts || {};
    reset();
    els.fname.textContent = file.name;
    showProgress("Opening " + file.name + "…", 0);
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(file);
    state.hasReplay = false;
    var engine = null, info = null, refused = false, tooLong = false;
    var dist = parseFloat($("distance").value);
    function onInfo(i) {
      info = i;
      var fps = pickFps(i.fileFps);
      info.fps = fps;
      if (fps < 100) { refused = true; return false; }
      if (i.frames > LONG_FRAMES && !opts.allowLong) { tooLong = true; refused = true; return false; }
      engine = BallEngine.create({ fps: fps, width: i.w, height: i.h, direction: choice.direction,
        cameraDistanceM: dist > 0 ? dist * 0.3048 : null, hfovDeg: dist > 0 ? 65 : null });
      return true;
    }
    var lastUi = 0;
    function onFrame(idx, gray, rgba, n, total) {
      if (!engine) return;
      engine.push(idx, gray, rgba);
      var now = performance.now();
      if (now - lastUi > 120) { lastUi = now; showProgress("Looking for the ball… picture " + (n + 1) + " of " + total, (n + 1) / total); }
    }
    var out;
    try {
      out = await decodeWebCodecs(file, onInfo, function (idx, g, r, n, t) { if (!refused) onFrame(idx, g, r, n, t); });
    } catch (e) {
      if (e && e.message === "codec") {
        return showMessage("bad", "This browser can't read this video format",
          "The video is in a format (" + e.codec + ") this browser can't open.",
          ["Open this page in <b>Safari</b> on a Mac or iPhone, or in Chrome on a Mac.", "Or on iPhone: Settings → Camera → Formats → <b>Most Compatible</b>, then film again."]);
      }
      try {
        engine = null; info = null; refused = false; tooLong = false;
        out = await decodeVideoElement(state.url, onInfo, function (idx, g, r, n, t) { if (!refused) onFrame(idx, g, r, n, t); });
      } catch (e2) {
        return showMessage("bad", "This video couldn't be opened", "Try an .mp4 or .mov file straight from your phone.");
      }
    }
    if (!info) return showMessage("bad", "This video couldn't be opened", "Try an .mp4 or .mov file straight from your phone.");
    state.times = info.times;
    if (tooLong) {
      showMessage("warn", "This video is long",
        "It has " + info.frames.toLocaleString() + " pictures. Checking all of them can take several minutes, especially on a phone, and a long video often holds more than one swing.",
        ["<b>Trim it to the swing:</b> in Photos, tap <b>Edit</b> and drag the ends of the timeline in close around the hit, then save it.", "Then choose the trimmed video here."]);
      var anyway = document.createElement("button");
      anyway.type = "button"; anyway.className = "btn"; anyway.textContent = "Check the whole video anyway";
      anyway.addEventListener("click", function () { run(file, { allowLong: true }); });
      els.message.appendChild(anyway);
      return;
    }
    if (refused) {
      return showMessage("bad", "This video isn't slow motion",
        "It plays at " + Math.round(info.fileFps) + " pictures per second, so the ball shows up in only 1 or 2 pictures. That's not enough to measure it.",
        ["Record in <b>Slo-Mo</b> in your phone's Camera app (240 fps is best).", "If this <b>was</b> filmed in Slo-Mo, pick <b>Slo-Mo 240</b> or <b>Slo-Mo 120</b> under “Filmed in” and try again."]);
    }
    showProgress("Working out the numbers…", 1);
    await new Promise(function (r) { setTimeout(r, 30); });
    var res = engine.finish();
    state.res = res; state.info = info;
    var shaky = res.shake >= SHAKY;
    var good = res.events.filter(function (e) { return e.confidence !== "low"; });
    var hits = good.filter(function (e) { return e.type === "hit"; });
    var hit = hits.slice().sort(function (a, b) { return b.m.n - a.m.n; })[0];
    setupReplay(hit);
    if (!hit) {
      return showMessage("warn", "No hit could be measured in this video",
        "The tracker didn't find a ball flying clearly enough to measure.",
        (shaky ? ["<b>The phone moved</b> during the video. Put it on a tripod, or lean it on something steady, and don't follow the ball with it."] : []).concat(info.fileFps < 100 ? ["This file plays at " + Math.round(info.fileFps) + " pictures per second and was treated as <b>Slo-Mo " + info.fps + "</b>. If it's a normal-speed video, it can't be measured: film in Slo-Mo."] : []).concat(["Film from the <b>side</b>, about 10 ft from where the ball flies.", shaky ? "Use good light." : "Use a <b>tripod</b> and good light.", "Trim the video to just the swing.", "If the ball flies left or right in the picture, set “Ball travels” to match."]));
    }
    showResult(hit, { truncated: out && out.truncated, shaky: shaky, hits: hits.length });
  }

  function warnText(w) {
    return { offplane: "The ball flew partly toward or away from the camera, so the speed is a rough number. Film from the side for exact numbers.",
      small: "The ball is small in the picture. Move the phone closer, or enter the phone's distance.",
      few: "The ball was seen in only a few pictures, so the numbers are less exact. A closer, side-on camera helps." }[w];
  }
  function showResult(e, extra) {
    els.progress.hidden = true; els.message.hidden = true; els.setup.hidden = true;
    els.result.hidden = false; els.board.hidden = false;
    var cell = function (v, unit, label) { return "<div><b>" + v + "<small>" + unit + "</small></b><span>" + label + "</span></div>"; };
    els.board.innerHTML =
      cell(e.exitVelocity.toFixed(1), "mph", "Exit velo ±" + e.m.sigmaMph.toFixed(1)) +
      cell((e.launchAngle >= 0 ? "" : "−") + Math.abs(e.launchAngle).toFixed(1), "°", "Launch angle") +
      cell(Math.round(e.carryFt), "ft", "Distance") +
      cell(e.pitchM ? e.pitchM.speedMph.toFixed(1) : "—", e.pitchM ? "mph" : "", "Pitch speed");
    var chips = [];
    var reliable = e.confidence === "high" && !extra.shaky && !e.otherBalls;
    chips.push('<span class="chip ' + (reliable ? "good" : "fair") + '">' + (reliable ? "Reliable reading" : "Fair reading") + "</span>");
    if (e.barrel) chips.push('<span class="chip good">Barrel</span>');
    chips.push('<span class="chip plain">' + kind(e.launchAngle) + "</span>");
    chips.push('<span class="chip plain">' + (e.m.scale.method === "camera" ? "Scaled by your phone distance" : "Scaled by the ball's size") + "</span>");
    els.chips.innerHTML = chips.join("");
    var notes = e.m.warnings.map(warnText).filter(Boolean);
    if (state.info && state.info.fileFps < 100) notes.push("This file plays at " + Math.round(state.info.fileFps) + " pictures per second, so it was treated as Slo-Mo " + state.info.fps + " (your “Filmed in” choice).");
    if (extra.shaky) notes.push("The phone moved during the video, so the numbers are less exact. Use a tripod, or lean the phone on something steady.");
    if (e.otherBalls && !extra.shaky) notes.push("Another ball was flying in the picture at the same time. Check in the replay that the yellow path follows the hit ball.");
    if (extra.hits > 1) notes.push("This video has " + extra.hits + " hits. These numbers are for the clearest one. Film one swing per video.");
    if (extra.truncated) notes.push("Only the first " + MAX_FRAMES.toLocaleString() + " pictures were checked. Trim long videos to the swing.");
    els.notes.innerHTML = notes.map(function (n) { return "<li>" + n + "</li>"; }).join("");
    els.notes.hidden = !notes.length;
  }
  function kind(la) { return la < 10 ? "Ground ball" : la < 25 ? "Line drive" : la < 50 ? "Fly ball" : "Pop-up"; }

  // ------------------------------------------------------------ replay
  var vid = null, playTimer = null;
  function setupReplay(hit) {
    stopPlay();
    if (!hit || !state.times) { els.replay.hidden = true; state.hasReplay = false; return; }
    state.hit = hit; state.hasReplay = true; els.replay.hidden = false;
    var first = (hit.pitch ? hit.pitch[0].frame : hit.batted[0].frame) - 6, last = hit.batted[hit.batted.length - 1].frame + 4;
    first = Math.max(0, first); last = Math.min(state.times.length - 1, last);
    els.slider.min = first; els.slider.max = last; els.slider.value = last;
    vid = document.createElement("video"); vid.muted = true; vid.playsInline = true; vid.preload = "auto"; vid.src = state.url;
    var cw = state.info.w, ch = state.info.h;
    els.canvas.width = cw; els.canvas.height = ch;
    vid.addEventListener("loadeddata", function () { seek(+els.slider.value); });
    vid.addEventListener("seeked", draw);
  }
  function seek(idx) {
    if (!vid || !state.times[idx] && state.times[idx] !== 0) return;
    var t = state.times[idx];
    vid.currentTime = t + 0.25 / (state.info.fileFps || 30);
  }
  function draw() {
    var ctx = els.canvas.getContext("2d"), w = els.canvas.width, h = els.canvas.height, idx = +els.slider.value, hit = state.hit;
    ctx.drawImage(vid, 0, 0, w, h);
    function path(tr, col) {
      var pts = tr.filter(function (p) { return p.frame <= idx; });
      if (!pts.length) return;
      ctx.lineWidth = Math.max(2, w / 320); ctx.strokeStyle = col; ctx.beginPath();
      pts.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
      ctx.stroke();
      pts.forEach(function (p) {
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, p.diameter / 2), 0, Math.PI * 2);
        ctx.fillStyle = col; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1; ctx.stroke();
      });
    }
    if (hit.pitch) path(hit.pitch, "#ff50ff");
    path(hit.batted, "#ffd400");
  }
  els.slider.addEventListener("input", function () { stopPlay(); seek(+els.slider.value); });
  function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; els.play.textContent = "Play"; } }
  els.play.addEventListener("click", function () {
    if (playTimer) return stopPlay();
    if (+els.slider.value >= +els.slider.max) els.slider.value = els.slider.min;
    els.play.textContent = "Pause";
    playTimer = setInterval(function () {
      var v = +els.slider.value + 1;
      if (v > +els.slider.max) return stopPlay();
      els.slider.value = v; seek(v);
    }, 90);
  });
})();
