"""Inspeciona os dois esqueletos: nomes, hierarquia, direcao e comprimento no repouso."""
import bpy, sys, os, json
from mathutils import Vector

ROOT = "/Users/igorjohn/GitHub/app-souls-web"
VHAREN = os.path.join(ROOT, "assets-src/models/vharen/bruto/vharen-bruto.glb")
CC0 = os.path.join(ROOT, "assets-src/models/personagem-cc0/AnimationLibrary.gltf")

def limpar():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def importar(path):
    antes = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in antes]

def descrever(rotulo, objetos):
    print("=" * 70)
    print(rotulo)
    print("=" * 70)
    for o in objetos:
        print(f"  obj {o.name!r} tipo={o.type} pai={o.parent.name if o.parent else None} "
              f"escala={tuple(round(v,5) for v in o.scale)} loc={tuple(round(v,4) for v in o.location)}")
        if o.type == 'MESH':
            print(f"       verts={len(o.data.vertices)} polys={len(o.data.polygons)} "
                  f"uv={[l.name for l in o.data.uv_layers]} mats={[m.name if m else None for m in o.data.materials]}")
            print(f"       grupos={len(o.vertex_groups)}")
        if o.type == 'ARMATURE':
            arm = o.data
            print(f"       ossos={len(arm.bones)}  matrix_world escala={tuple(round(v,5) for v in o.matrix_world.to_scale())}")
            for b in arm.bones:
                head = b.head_local; tail = b.tail_local
                d = (tail - head)
                print(f"       - {b.name:22s} pai={(b.parent.name if b.parent else '-'):22s} "
                      f"head=({head.x:7.4f},{head.y:7.4f},{head.z:7.4f}) "
                      f"len={b.length:7.4f} dir=({d.normalized().x:6.3f},{d.normalized().y:6.3f},{d.normalized().z:6.3f})")
    print()

def acoes():
    print("acoes:", len(bpy.data.actions))
    for a in bpy.data.actions:
        print(f"   {a.name!r} frames={tuple(round(v,2) for v in a.frame_range)} curvas={len(a.fcurves)}")

limpar()
objs = importar(VHAREN)
descrever("VHAREN (gerado)", objs)
acoes()

limpar()
objs = importar(CC0)
descrever("CC0 AnimationLibrary", [o for o in objs if o.type != 'MESH' or True])
acoes()
