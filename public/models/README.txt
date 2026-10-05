REAL MODELS (optional)
======================
Drop free low-poly .glb files in this folder and edit models.json. Without them the game uses its
built-in humanoid.  Models only load when the game is served over http (npm start or Render),
not when index.html is opened straight from disk.

Good free CC0 sources: Quaternius (quaternius.com / quaternius.itch.io), Kenney (kenney.nl), KayKit.
Download the glTF/GLB version of an animated character pack (FBX/OBJ can be converted to GLB first).

CHARACTERS
  { "file": "models/soldier.glb", "scale": 1, "yaw": 0,
    "clips": { "idle": "Idle", "walk": "Walk", "run": "Run", "shoot": "Shoot", "death": "Death",
               "crouch": "Crouch_Idle", "crouchwalk": "Crouch_Walk", "prone": "Prone", "hit": "Hit" } }
  - List several characters and each bot picks one at random.
  - The model is auto-scaled to about 1.85 m tall. Use "scale" to tweak, e.g. 1.1.
  - If bots walk backwards, set "yaw": 3.1416.
  - "clips" is optional: animation names are auto-detected (idle, walk, run, shoot, death, crouch,
    prone...). Use "clips" only to override names. Missing stance clips fall back to squashing the
    model for crouch and tipping it over for prone.

PROPS (buildings, trees, cars...)
  { "file": "models/house.glb", "x": 20, "z": -15, "ry": 0, "scale": 1, "box": [8, 8, 5] }
  - x/z place it on the 90x90 map (-45..45). "box": [width, depth, height] adds invisible collision
    so players, bots and bullets are blocked. Leave "box" out for decoration only.

WEAPONS (viewmodels)
  "weapons": { "smg": { "type": "fbx", "file": "models/uzi.fbx",
                        "tex": {"map": "...png", "normal": "...png", "orm": "...png"},
                        "length": 0.5, "yaw": -1.5708, "off": [0, -0.01, 0.06] },
               "rl":  { "type": "obj", "file": "models/rpg7.obj", "length": 0.85, "yaw": -1.5708 } }
  Keys are weapon ids: ar, smg (shown as Uzi), mk, sg, pt, rl (RPG-7). The model is auto-scaled to "length" metres
  and centred; "yaw" turns it so the muzzle points forward (both included models need -1.5708). "off" nudges it.
  "orm" is an Occlusion/Roughness/Metallic packed texture (R/G/B).
