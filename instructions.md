# How to use the Ball Tracker

This guide takes you from nothing to your first measured hit in about 10 minutes. Copy each command
box into the **Terminal** app on a Mac and press Return.

---

## 1. Open the project

You need the `ball-tracking-spike` project folder (ask Kevin for it). Open **Terminal** (press
⌘ + Space, type *Terminal*, press Return) and go into the folder. For example:

```
cd ~/Work/Arcus/Lanista/ball-tracking-spike
```

Do this every time you open a new Terminal window.

## 2. One-time setup

```
brew install uv yt-dlp ffmpeg
uv sync
```

This installs everything the tracker needs. You only do it once.

## 3. Get the test videos

```
tools/get_test_videos.sh
```

This downloads the real YouTube clips shown on the web page into `data/youtube/`, so you don't have
to search for anything.

## 4. Measure a real hit

This is real batting practice, filmed in slow motion at 240 pictures per second:

```
uv run lanista-ball analyze data/youtube/A5mFi-aVQJ0.mp4 --fps 240 --start 240 --end 340
```

`--fps 240` tells the tracker the video was filmed at 240 pictures per second. `--start` and `--end`
point it at the part of the video with the swing.

Watch what the tracker saw:

```
open out/results/A5mFi-aVQJ0.annotated.mp4
```

The pink line is the pitch coming in and the yellow line is the ball after the hit. The tracker also
prints a warning that this camera filmed the ball flying toward it, so the speed is only a rough
number. That's why the phone has to be side-on (see the web page).

## 5. See why slow motion matters

This video shows a 99 mph reading on a radar gun, but it was filmed at normal speed:

```
uv run lanista-ball analyze data/youtube/8LTKNTePAHA.mp4
```

The tracker refuses it and explains why. At normal speed the camera catches the ball in only 1 or 2
pictures, which isn't enough to measure anything.

## 6. Measure your own swing

1. **Film it right.**
   * **iPhone Slo-Mo at 240 fps.** In Settings, then Camera, then Record Slo-mo, pick 1080p at 240 fps.
   * **Phone on a tripod, sideways (landscape).**
   * **About 10 ft (3 m) to the side of where the ball will fly**, facing across its path, a step in
     front of the hitter.
   * **Phone level**, good light, and one swing per clip if you can.
2. **AirDrop the video to your Mac.** It lands in Downloads.
3. **Run it**, using your video's file name:

```
uv run lanista-ball analyze ~/Downloads/IMG_1234.MOV --fps 240
open out/results/IMG_1234.annotated.mp4
```

If you measured how far the phone was from the ball's path, add it for better accuracy. Here it's 3 m,
and 65 is the iPhone main camera's view angle in degrees:

```
uv run lanista-ball analyze ~/Downloads/IMG_1234.MOV --fps 240 --camera-distance-m 3 --hfov 65
```

## Reading the results

| You see | It means |
|---|---|
| **Exit velocity** | How fast the ball left the bat, in mph. The ± is the margin of error |
| **Launch angle** | How steeply the ball went up. Below 10° is a ground ball, 10-25° a line drive, 25-50° a fly ball |
| **Est. carry** | How far the ball would fly before landing, in feet, with no wind |
| **Barrel** | `True` when speed and angle are in MLB's "perfect contact" zone (98+ mph at about 26-30°) |
| **Incoming pitch** | Speed of the pitch near the plate, when the pitch is in the picture |
| **Confidence** | high / medium. Low-confidence results are hidden rather than shown wrong |

Every run also saves the full details to `out/results/<video name>.result.json`.

## When something goes wrong

| Message | What to do |
|---|---|
| *too low for reliable ball metrics … not analysed* | The video isn't slow motion. Record in Slo-Mo at 240 fps. If it **is** slow motion, add `--fps 240` |
| *no reliable ball event found* | The ball wasn't seen clearly. Move the camera closer, add light, keep the background still, or use `--start` and `--end` around the swing |
| *ball moves toward/away from the camera* | The camera isn't side-on. Turn it to face across the ball's path |
| *ball is only N px wide* | The ball is too small in the picture. Move closer, or add `--camera-distance-m` |

## Extras

| Option | What it does |
|---|---|
| `--mode pitching` | Measures a pitch instead of a hit |
| `--direction left` or `right` | Tells the tracker which way the hit ball travels in the picture |
| `--show-low` | Also prints results the tracker isn't confident about |
