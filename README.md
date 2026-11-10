# Lanista Ball Tracker

Measure a baseball hit from a slow-motion phone video, right in the browser: exit velocity, launch
angle, distance and pitch speed. The video is processed on the device and never uploaded.

Live: https://kevin-arcus.github.io/lanista-ball-tracker/

| File | What it is |
|---|---|
| `index.html` | The page and the measuring tool |
| `app.js` | Reads the video (WebCodecs + mp4box.js), runs the engine, shows results and the replay |
| `engine.js` | Ball detection, tracking and physics (port of the Python prototype `ball-tracking-spike`) |
| `instructions.md` | The guide shown on the page |
| `test/run.js` | Runs the engine on a video from the command line: `node test/run.js clip.mp4 240` (needs ffmpeg) |
