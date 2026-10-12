"""Export the Unity Eggbot art to the browser's self-contained GLB.

Run with Blender 4.1 (no third-party Python packages required):
  blender --background --python tools/export-eggbot.py -- \
      --unity-source ../TileStormEvolution

The output is eggbot/assets/eggbot.glb beside this repository's tools folder.
Unity's material GUID remaps and clip frame ranges are read from the source
metadata. The original FBX geometry and animation are retained, including the
antenna skin and individually addressable eyes, eyelid layers and wheels.
"""

import argparse
import json
import math
from pathlib import Path
import re
import shutil
import struct
import sys
import tempfile

import bpy
from mathutils import Matrix, Quaternion, Vector
import numpy as np


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--unity-source", type=Path, required=True)
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parent.parent / "eggbot/assets")
    parser.add_argument("--texture-size", type=int, default=1024)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1:])


def unity_clips(path):
    text = path.read_text(encoding="utf-8")
    clips = []
    for match in re.finditer(r"      name: ([^\n]+)\n(.*?)(?=    - serializedVersion:|    isReadable:)", text, re.S):
        name, data = match.groups()
        clips.append({"name": name,
                      "firstFrame": int(float(re.search(r"firstFrame: (.+)", data)[1])),
                      "lastFrame": int(float(re.search(r"lastFrame: (.+)", data)[1])),
                      "loop": re.search(r"loopTime: (.+)", data)[1] == "1"})
    if not clips:
        raise ValueError("No named animation clips found in Unity FBX metadata")
    return clips


def unity_material_remaps(model_meta, material_folder):
    materials = {}
    by_guid = {re.search(r"guid: (\w+)", meta.read_text())[1]: meta.with_suffix("")
               for meta in material_folder.glob("*.mat.meta")}
    for name, guid in re.findall(r"      name: (.+)\n    second: \{fileID: \d+, guid: (\w+)",
                                 model_meta.read_text()):
        materials[name] = by_guid[guid]
    return materials


def unity_material(path, guid_files):
    text = path.read_text(encoding="utf-8")
    textures = {}
    for name, guid in re.findall(r"    - (\w+):\n        m_Texture: \{fileID: \d+, guid: (\w+)", text):
        textures[name] = guid_files[guid]
    floats = {name: float(value) for name, value in
              re.findall(r"    - (\w+): (-?[\d.eE+]+)\s*$", text, re.M)}
    colors = {name: tuple(float(value) for value in values) for name, *values in
              re.findall(r"    - (\w+): \{r: (.+?), g: (.+?), b: (.+?), a: (.+?)\}", text)}
    return {"name": re.search(r"  m_Name: (.+)", text)[1], "textures": textures,
            "floats": floats, "colors": colors}


def texture_image(path, directory, limit, data=False):
    image = bpy.data.images.load(str(path), check_existing=False)
    image.colorspace_settings.name = "Non-Color" if data else "sRGB"
    width, height = image.size
    if max(width, height) > limit:
        ratio = limit / max(width, height)
        image.scale(max(1, round(width * ratio)), max(1, round(height * ratio)))
    image.filepath_raw = str(directory / (path.stem + ("-data" if data else "") + ".png"))
    image.file_format = "PNG"
    image.save()
    return image


def image_node(material, image):
    node = material.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    node.extension = "REPEAT"
    return node


def pixel_array(image):
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape(-1, 4)


def occlusion_group():
    group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    return group


def browser_material(source, directory, limit, ao_group):
    material = bpy.data.materials.new(source["name"])
    material.use_nodes = True
    material.use_backface_culling = True
    material["unityMaterial"] = source["name"]
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = nodes.get("Principled BSDF")
    floats, colors, textures = source["floats"], source["colors"], source["textures"]
    shader.inputs["Base Color"].default_value = colors.get("_BaseColor", (1, 1, 1, 1))
    shader.inputs["Metallic"].default_value = floats.get("_Metallic", 0)
    shader.inputs["Roughness"].default_value = 1 - floats.get("_Smoothness", .5)
    if "_BaseMap" in textures:
        node = image_node(material, texture_image(textures["_BaseMap"], directory, limit))
        links.new(node.outputs["Color"], shader.inputs["Base Color"])
        if floats.get("_Surface", 0) == 1:
            material.blend_method = "BLEND"
            links.new(node.outputs["Alpha"], shader.inputs["Alpha"])
    normal_strength = floats.get("_BumpScale", 1)
    if "_BumpMap" in textures and normal_strength > 0:
        texture = image_node(material, texture_image(textures["_BumpMap"], directory, limit, data=True))
        normal = nodes.new("ShaderNodeNormalMap")
        normal.inputs["Strength"].default_value = normal_strength
        links.new(texture.outputs["Color"], normal.inputs["Color"])
        links.new(normal.outputs["Normal"], shader.inputs["Normal"])
    if "_EmissionMap" in textures:
        texture = image_node(material, texture_image(textures["_EmissionMap"], directory, limit))
        emission = colors.get("_EmissionColor", (1, 1, 1, 1))
        # glTF expresses values above one through KHR_materials_emissive_strength.
        shader.inputs["Emission Strength"].default_value = max(emission[:3])
        links.new(texture.outputs["Color"], shader.inputs["Emission Color"])

    metallic_path = textures.get("_MetallicGlossMap")
    ao_path = textures.get("_OcclusionMap")
    if metallic_path or ao_path:
        # Unity stores metallic in R and smoothness in A. glTF uses occlusion R,
        # roughness G and metallic B. Pack a single image for those three channels.
        inputs = [texture_image(path, directory, limit, data=True)
                  for path in (metallic_path, ao_path) if path]
        size = (max(image.size[0] for image in inputs), max(image.size[1] for image in inputs))
        for image in inputs:
            if tuple(image.size) != size:
                image.scale(*size)
        metallic_image = inputs[0] if metallic_path else None
        ao_image = inputs[-1] if ao_path else None
        pixels = np.ones((size[0] * size[1], 4), dtype=np.float32)
        pixels[:, 1] = 1 - floats.get("_Smoothness", .5)
        pixels[:, 2] = floats.get("_Metallic", 0)
        if metallic_image:
            metallic = pixel_array(metallic_image)
            pixels[:, 1] = 1 - metallic[:, 3] * floats.get("_Smoothness", 1)
            # With a metallic map Unity's _Metallic scalar is ignored.
            pixels[:, 2] = metallic[:, 0]
        if ao_image:
            pixels[:, 0] = 1 - floats.get("_OcclusionStrength", 1) * (1 - pixel_array(ao_image)[:, 1])
        packed = bpy.data.images.new(source["name"] + "_ORM", *size, alpha=True)
        packed.colorspace_settings.name = "Non-Color"
        packed.pixels.foreach_set(pixels.ravel())
        packed.filepath_raw = str(directory / (source["name"] + "_ORM.png"))
        packed.file_format = "PNG"
        packed.save()
        texture = image_node(material, packed)
        separate = nodes.new("ShaderNodeSeparateColor")
        links.new(texture.outputs["Color"], separate.inputs["Color"])
        links.new(separate.outputs["Green"], shader.inputs["Roughness"])
        links.new(separate.outputs["Blue"], shader.inputs["Metallic"])
        if ao_path:
            ao = nodes.new("ShaderNodeGroup")
            ao.node_tree = ao_group
            links.new(separate.outputs["Red"], ao.inputs["Occlusion"])
    return material


def clip_action(source_action, name, start, end):
    action = bpy.data.actions.new(name)
    # Sample the original FBX curves without changing their node paths. Strip
    # source-frame offsets so every independently playable clip starts at zero.
    for source_curve in source_action.fcurves:
        curve = action.fcurves.new(source_curve.data_path, index=source_curve.array_index)
        curve.keyframe_points.add(end - start + 1)
        for frame, point in zip(range(start, end + 1), curve.keyframe_points):
            point.co = (frame - start, source_curve.evaluate(frame))
            point.interpolation = "LINEAR"
        curve.update()
    return action


def patch_glb(path, clips, metadata):
    raw = path.read_bytes()
    magic, version, length = struct.unpack_from("<III", raw)
    if magic != 0x46546C67 or version != 2 or length != len(raw):
        raise ValueError("Exporter produced an invalid GLB header")
    json_length, chunk_type = struct.unpack_from("<II", raw, 12)
    document = json.loads(raw[20:20 + json_length])
    remaining = bytearray(raw[20 + json_length:])
    # Blender 4.1's FBX -> glTF path leaves this model's root antenna joint in
    # Blender coordinates, although the rigid objects and skin data are Y-up.
    # Its importer compensates for this, masking the problem in a round trip;
    # Three.js correctly renders that uncorrected antenna along +Z. Apply the
    # missing axis conversion to each skin's default root joint transform.
    # Animated joint channels already receive this conversion in the exporter.
    conversion = Matrix.Rotation(-math.pi / 2, 3, "X")
    rotation = conversion.to_quaternion()
    parents = {child: index for index, node in enumerate(document["nodes"])
               for child in node.get("children", [])}

    # The imported root animation is expressed in the FBX's Y-up frame, while
    # the exported rigid hierarchy retains a +90 X conversion parent. Without
    # changing basis, root yaw about Y becomes a visible roll about world Z.
    # Convert only the animated body root's rotations into its parent's local
    # frame. Child articulation and skinned joint channels are already local.
    body = next(index for index, node in enumerate(document["nodes"])
                if node.get("name") == "EggBot")
    parent = document["nodes"][parents[body]]
    values = parent.get("rotation", [0, 0, 0, 1])
    basis = Quaternion((values[3], *values[:3]))
    corrected = set()
    # Accessor offsets address the BIN payload after its 8-byte chunk header.
    for animation in document.get("animations", []):
        for channel in animation["channels"]:
            if channel["target"].get("node") != body or channel["target"].get("path") != "rotation":
                continue
            accessor_index = animation["samplers"][channel["sampler"]]["output"]
            if accessor_index in corrected:
                continue
            corrected.add(accessor_index)
            accessor = document["accessors"][accessor_index]
            view = document["bufferViews"][accessor["bufferView"]]
            if accessor["componentType"] != 5126 or accessor["type"] != "VEC4":
                raise ValueError("Expected float quaternion tracks for EggBot root")
            offset = 8 + view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
            stride = view.get("byteStride", 16)
            for frame in range(accessor["count"]):
                position = offset + frame * stride
                x, y, z, w = struct.unpack_from("<4f", remaining, position)
                value = basis.inverted() @ Quaternion((w, x, y, z)) @ basis
                struct.pack_into("<4f", remaining, position, value.x, value.y, value.z, value.w)
            # Blender does not normally emit quaternion min/max, but stale
            # bounds would be incorrect after a basis change.
            accessor.pop("min", None)
            accessor.pop("max", None)
    roots = {joint for skin in document.get("skins", []) for joint in skin["joints"]
             if parents.get(joint) not in skin["joints"]}
    for index in roots:
        node = document["nodes"][index]
        if "translation" in node:
            node["translation"] = list(conversion @ Vector(node["translation"]))
        values = node.get("rotation", [0, 0, 0, 1])
        value = rotation @ Quaternion((values[3], *values[:3]))
        node["rotation"] = [value.x, value.y, value.z, value.w]

    by_name = {clip["name"]: clip for clip in clips}
    for animation in document.get("animations", []):
        animation["extras"] = by_name[animation["name"]]
    if set(by_name) != {animation["name"] for animation in document.get("animations", [])}:
        raise ValueError("Exported animation names do not match the Unity clips")
    document["asset"]["extras"] = metadata
    encoded = json.dumps(document, separators=(",", ":")).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    path.write_bytes(struct.pack("<III", magic, version, 20 + len(encoded) + len(remaining)) +
                     struct.pack("<II", len(encoded), chunk_type) + encoded + remaining)
    return document


def main():
    args = arguments()
    if bpy.app.version[:2] != (4, 1):
        raise RuntimeError("Use Blender 4.1 for this exporter; its FBX/glTF axis corrections are version-specific")
    source = args.unity_source.resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    art = source / "Assets/Art/Eggbot"
    model_path = art / "Eggbot_Model.fbx"
    animation_path = art / "Resources/EggbotAnimations/Eggbot_Anims.fbx"
    clips = unity_clips(animation_path.with_suffix(".fbx.meta"))
    bpy.ops.wm.read_factory_settings(use_empty=True)

    # Blender's default animation offset is +1; Unity clip ranges address the
    # original FBX frame times, so explicitly use zero offset at import.
    bpy.ops.import_scene.fbx(filepath=str(animation_path), anim_offset=0, use_image_search=False)
    fps = bpy.context.scene.render.fps
    source_objects = {obj.name: obj for obj in bpy.data.objects}
    source_actions = {name: obj.animation_data.action for name, obj in source_objects.items()
                      if obj.animation_data and obj.animation_data.action}
    for name, obj in source_objects.items():
        obj.name = "Source_" + name
    bpy.ops.import_scene.fbx(filepath=str(model_path), use_image_search=False)
    model_objects = {obj.name: obj for obj in bpy.data.objects if not obj.name.startswith("Source_")}

    # Blender's FBX importer does not bake the root EggBot mesh's geometric
    # rotation in this 3ds Max export. The raw body is Z-up while the transform
    # tree is Y-up. Bake only that mesh's authored -90 X geometric rotation;
    # children and animation transforms must remain untouched.
    model_objects["EggBot"].data.transform(Matrix.Rotation(-math.pi / 2, 4, "X"))
    model_objects["EggBot"].data.update()
    for name, target in model_objects.items():
        if name not in source_actions:
            continue
        target.rotation_mode = source_objects[name].rotation_mode
        target.animation_data_create()
        for clip in clips:
            action = clip_action(source_actions[name], name + "_" + clip["name"],
                                 clip["firstFrame"], clip["lastFrame"])
            track = target.animation_data.nla_tracks.new()
            track.name = clip["name"]
            # Exporter temporarily enables every NLA track when sampling it.
            # Keep them muted initially so glTF's default node transforms are
            # the original model bind pose, not a stacked clip's first frame.
            track.mute = True
            strip = track.strips.new(clip["name"], 0, action)
            strip.extrapolation = "NOTHING"
            strip.blend_type = "REPLACE"
        target.animation_data.action = None
    for obj in source_objects.values():
        bpy.data.objects.remove(obj, do_unlink=True)

    # The FBX import is already Unity-style Y-up. Orient that into Blender's
    # Z-up before the glTF exporter performs its standard Y-up conversion.
    wrapper = bpy.data.objects.new("EggbotModel", None)
    bpy.context.scene.collection.objects.link(wrapper)
    wrapper.rotation_euler.x = math.pi / 2
    model_objects["EggBot"].parent = wrapper
    wrapper["frontAxis"] = "+Z"
    wrapper["upAxis"] = "+Y"

    guid_files = {re.search(r"guid: (\w+)", path.read_text())[1]: path.with_suffix("")
                  for path in (art / "Materials").glob("*.meta")}
    remaps = unity_material_remaps(model_path.with_suffix(".fbx.meta"), art / "Materials")
    # Remove imported material names so exported material names stay exact.
    for material in list(bpy.data.materials):
        material.name = "Source_" + material.name
    with tempfile.TemporaryDirectory(prefix="eggbot-export-") as temp:
        directory = Path(temp)
        group = occlusion_group()
        by_path = {path: browser_material(unity_material(path, guid_files), directory,
                                         args.texture_size, group)
                   for path in sorted(set(remaps.values()), key=str)}
        materials = {name: by_path[path] for name, path in remaps.items()}
        for obj in model_objects.values():
            if obj.type == "MESH":
                for index, imported in enumerate(obj.data.materials):
                    name = re.sub(r"\.\d{3}$", "", imported.name.removeprefix("Source_"))
                    obj.data.materials[index] = materials[name]
        scene = bpy.context.scene
        scene.render.fps = fps
        scene.frame_start = 0
        scene.frame_end = max(clip["lastFrame"] - clip["firstFrame"] for clip in clips)
        scene.frame_set(0)
        bpy.ops.export_scene.gltf(
            filepath=str(output / "eggbot.glb"), export_format="GLB", export_yup=True,
            export_animations=True, export_animation_mode="NLA_TRACKS", export_nla_strips=True,
            export_force_sampling=True, export_anim_slide_to_zero=True,
            export_optimize_animation_size=True, export_extras=True,
            export_image_format="AUTO", export_cameras=False, export_lights=False)

    metadata = {"sourceModel": str(model_path.relative_to(source)).replace("\\", "/"),
                "sourceAnimation": str(animation_path.relative_to(source)).replace("\\", "/"),
                "fps": fps, "upAxis": "+Y", "frontAxis": "+Z", "units": "metres",
                "defaultPose": "source model bind pose", "rootAnimationFrame": "conversion parent local",
                "uvVFlipped": True, "textureMaximumSize": args.texture_size,
                "clips": clips}
    document = patch_glb(output / "eggbot.glb", clips, metadata)
    ground = source / "Assets/Application/ClassicTS/Data/UI/components/Textures/blueGraph1024x1024.jpg"
    if ground.exists():
        shutil.copyfile(ground, output / "ground.jpg")
    metadata["nodes"] = [node.get("name") for node in document.get("nodes", [])]
    metadata["triangles"] = sum(document["accessors"][primitive["indices"]]["count"] // 3
                                for mesh in document["meshes"] for primitive in mesh["primitives"])
    metadata["fileSize"] = (output / "eggbot.glb").stat().st_size
    (output / "eggbot.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
