# Eggbot browser playground

`eggbot.html` is a standalone Three.js / WebGL2 recreation of Unity's
`EggbotAnimationTest` scene. The home page Eggbot icon opens it. The existing
Launch button continues to launch the game; the icon has its own analytics
event (`eggbot-playground-clicked`). No Unity player or server backend is needed.

The page includes every exported animation, imported loop/once settings,
last-frame holding, the idle/console sequence, camera orbit and zoom, robot
turn/tilt, ground contact, distance-based wheel rolling, and all five gaze
modes. Pupils and two independent eyelid layers use the source UV calculations,
including natural blinking and per-eye gaze. Each page load starts with
No animation selected. Cameras and robot rotation
can also be controlled with the keyboard or touch gestures.

No animation retains the authored pose with procedural gameplay balance:
`pitch = 0.1 * sin(7.8 * time) * sin(1.8 * time)` radians and the same
rotated `(0, 0, -pitch)` translation as `EggbotController.UpdateSway`.
Shoulder corrections include forward/back swing and a small outward lift,
staying below ten degrees; hand and finger joints retain their authored local
pose. Stationary Eggbot also glances left/right by 22–32 degrees approximately
every 2–3 seconds, with eased returns to his heading. Glances stop during travel
or dragging. A separate balance pivot keeps this motion apart from imported
clips and manual tilt. All procedural body/arm motion is reset and disabled
when any clip or the sequence is selected, including held end poses.

Click or tap a visible grid point to turn and travel there. Movement uses the
main app's cosine `SmoothingUtils.Ease` and 0.25-second turns. Travel duration
is `(distance + 1) / 3`, half gameplay's travel speed for this small grid.
New clicks replace the destination; manual robot dragging
cancels travel, and Reset view also restores the starting position. Every valid
grid destination clears manual tilt, with or without an animation. Wheels roll
from actual travel. This open grid moves directly to the point without tile
navigation or obstacle routing.

After reaching a clicked destination, Eggbot turns toward the camera once over
0.45 seconds, using the shortest horizontal turn and the same cosine easing.
The camera position is sampled at arrival; later camera movement does not turn
him again. Another grid journey triggers a new arrival turn. Manual robot
dragging, Reset, or a new destination cancels an unfinished arrival turn.
Idle glances resume around the new heading once the turn finishes.

After manual tilt input stops, Eggbot holds that lean for two seconds and eases
upright over one second. Recovery pauses while dragging and restarts from the
current angle when grabbed again. This applies in every animation mode; it
does not change the camera pitch or the selected clip's authored body motion.

The eye debug controls are retained in an HTML comment in `eggbot.html` for
future tuning; uncomment them to enable live comparison. They expose the saved
test scene's gaze strength (1.3) and pupil UV bias (0, 0.07).
The bias also feeds eyelid following.
The original upper/lower resting scalars (4.5 / 0), pupil-to-lid scale (0.724),
and lower follow scale (0.5) remain in the lid calculation. Changes to the live
controls last until the page reloads.

## Local preview and checks

On Windows, double-click `Preview Eggbot.cmd` in the repository root. It starts
a localhost server on a free port and opens Eggbot in your default browser.
Keep its terminal window open while previewing; close it or press Ctrl+C to stop.
Python 3 must be available as `python`.

From the repository root:

```powershell
node tests/eggbot-checks.mjs
python -m http.server 8874 --bind 127.0.0.1
```

Open `http://127.0.0.1:8874/eggbot.html`. Serve the directory over HTTP; browsers
cannot load the model/module dependencies reliably from a `file:` URL.
Everything needed by the scene is hosted alongside the page, including the
vendored Three.js 0.186.1 library. WebGL2 and hardware acceleration are required.
The page displays an explanation if graphics creation or asset loading fails.

Browser checks: play each clip, confirm once clips hold their last frame;
run a full sequence cycle; try every gaze mode (context gaze follows the hands
only during Console Loop); rotate/tilt Eggbot, orbit and zoom; reset the view;
reload to check No animation is selected; check full screen and a narrow/mobile
viewport. Check the home page icon routes here without recording a game launch.
In No animation, watch the wobble, occasional shoulders and stationary glances;
select a clip to verify those additions stop. Tilt Eggbot, then click the grid
to verify travel clears manual tilt in both procedural and animation modes.

## Re-export after changing Unity art or animations

With Blender 4.1 installed, run from this repository (adjust the executable and
Unity checkout path as needed):

```powershell
& 'C:\Program Files\Blender Foundation\Blender 4.1\blender.exe' --background --python tools/export-eggbot.py -- --unity-source ../TileStormEvolution
```

The script reads `Eggbot_Model.fbx`, the material GUID remaps, Unity material
values/textures and animation clip metadata. It converts the FBX geometry,
articulated node animations and antenna skin into `eggbot/assets/eggbot.glb`,
plus `eggbot.json` with source clip ranges and `ground.jpg`. Textures are embedded
and limited to 1024 pixels; Unity metallic/smoothness/AO maps are repacked for
glTF. Keep the original mesh/node names so gaze and wheel controllers can find
their parts. glTF UV V points down, and Unity's FBX/camera handedness reverses
horizontal gaze for this model. The runtime converts both pupil UV offsets at
the rendering boundary while retaining the original texture coordinates.

`tools/export-eggbot.py` also handles the source FBX body's geometric rotation,
root animation rotation basis, antenna joint conversion and the animation
importer's frame offset. Root yaw is picked up above the user pitch pivot as
in Unity, rather than tipping the body and wheels from side to side. Use the
script rather than a plain
FBX-to-GLB conversion to keep the parts aligned and the clip ranges correct.
The browser model uses metres, +Y up and +Z facing forward. Unit conversion and
static FBX transforms are retained in the hierarchy.

New clips are listed automatically after re-export. The sequence expects
`Idle_01`, `Console_Start`, `Console_Loop`, `Console_End`; it is disabled if one
is missing. Adding a clip requires exporting and publishing updated assets;
the browser does not read Unity's `Resources` directory at runtime.

Publish through this repository's usual GitHub Pages workflow. Lighting and
material rendering have been matched for this browser scene; they are not
pixel-identical to Unity's URP output.
