# How to measure a hit

Everything happens on this page. Your video is read by your own browser and is never uploaded
anywhere.

---

## 1. Film the swing

* **Use Slo-Mo.** Open the Camera app and swipe to **Slo-Mo**. On iPhone, set it to 240 fps first:
  Settings → Camera → Record Slo-mo → **1080p at 240 fps**.
* **Phone on a tripod, sideways (landscape).** A still phone makes the ball easy to find.
* **Stand the phone about 10 ft (3 m) to the side** of where the ball will fly, facing across its
  path, a step in front of the hitter.
* **Keep it level**, use good light, and film **one swing per clip**. Trim the clip to the swing if
  you can.

## 2. Open this page on the phone or on a computer

* **On the phone:** tap **Choose a video** and pick the Slo-Mo clip from your library.
* **On a Mac:** AirDrop the clip to the Mac, then drag it onto the page or click **Choose a video**.

## 3. Check the two settings

* **Filmed in.** Pick **Slo-Mo 240** (the iPhone default) or **Slo-Mo 120**. If the file itself
  is already 240 fps, the page uses that automatically.
* **Ball travels** (optional). If there's a lot going on in the picture, tell the page whether the
  hit ball goes left or right on screen.
* **Phone distance** (optional). Measure from the phone straight across to the ball's path, in
  feet. It makes the numbers more exact.

## 4. Read the results

| You see | It means |
|---|---|
| **Exit velocity** | How fast the ball left the bat, in mph. The ± is the margin of error |
| **Launch angle** | How steeply the ball went up. Below 10° is a ground ball, 10–25° a line drive, 25–50° a fly ball |
| **Distance** | How far the ball would carry before landing, in feet, with no wind |
| **Pitch speed** | Speed of the incoming pitch near the plate, when the pitch is in the picture |
| **Barrel** | Speed and angle are in MLB's "perfect contact" zone (98+ mph at about 26–30°) |
| **Reliable / Fair reading** | How confident the tracker is. If it isn't confident, it says so instead of showing a number |

Drag the slider under the picture, or press **Play**, to watch the ball's path picture by picture.
Pink is the pitch coming in and yellow is the ball after the hit.

## If it doesn't work

| The page says | What to do |
|---|---|
| *This video isn't slow motion* | Film in Slo-Mo. If it **was** Slo-Mo, pick Slo-Mo 240 or 120 under "Filmed in" and try again |
| *No hit could be measured* | Film from the side, use a tripod and good light, and trim the clip to the swing |
| *This browser can't read this video format* | Open the page in Safari, or on iPhone set Settings → Camera → Formats → **Most Compatible** and film again |
| *The speed is a rough number* | The phone wasn't side-on to the ball's flight. Move it so it faces across the ball's path |

---

## For developers: the command-line version

The same tracker exists as a Python project (`ball-tracking-spike`, ask Kevin), with a few more
options such as batch runs and 3-D mode:

```
uv sync
uv run lanista-ball analyze my_swing.mov --fps 240
uv run lanista-ball analyze my_swing.mov --fps 240 --camera-distance-m 3 --hfov 65
```
