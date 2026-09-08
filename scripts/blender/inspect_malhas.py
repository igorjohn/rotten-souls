import bpy, os
from mathutils import Vector
ROOT = "/Users/igorjohn/GitHub/app-souls-web"

def limpar(): bpy.ops.wm.read_factory_settings(use_empty=True)

def bbox_mundo(ob):
    mn = Vector((1e9,1e9,1e9)); mx = Vector((-1e9,-1e9,-1e9))
    for v in ob.data.vertices:
        w = ob.matrix_world @ v.co
        for i in range(3):
            mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])
    return mn, mx

def uv_stats(ob, uvl):
    if not uvl: return None
    mn = [9e9,9e9]; mx = [-9e9,-9e9]; fora = 0
    for l in uvl.data:
        u,v = l.uv
        mn[0]=min(mn[0],u); mn[1]=min(mn[1],v); mx[0]=max(mx[0],u); mx[1]=max(mx[1],v)
        if u<-0.001 or u>1.001 or v<-0.001 or v>1.001: fora+=1
    return mn, mx, fora, len(uvl.data)

def area_uv(ob, uvl):
    """Fracao do quadrado UV realmente coberta, por amostragem em grade."""
    if not uvl: return 0
    grade = set()
    N = 96
    for l in uvl.data:
        u,v = l.uv
        if 0<=u<=1 and 0<=v<=1:
            grade.add((int(u*(N-1)), int(v*(N-1))))
    return len(grade)/(N*N)

for rotulo, path in [("VHAREN", "assets-src/models/vharen/bruto/vharen-bruto.glb"),
                     ("CC0", "assets-src/models/personagem-cc0/AnimationLibrary.gltf")]:
    limpar()
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, path))
    print("="*70); print(rotulo, " fps da cena:", bpy.context.scene.render.fps)
    for ob in bpy.data.objects:
        if ob.type != 'MESH' or ob.name.startswith('Icosphere'): continue
        mn, mx = bbox_mundo(ob)
        print(f"  malha {ob.name}: bbox mundo min=({mn.x:.4f},{mn.y:.4f},{mn.z:.4f}) max=({mx.x:.4f},{mx.y:.4f},{mx.z:.4f}) altura={mx.z-mn.z:.4f}")
        # Todas as camadas de UV, nao so a ativa: o mannequim CC0 tem duas e as
        # duas sao inuteis, uma inteira em (0,0) e outra cobrindo 1%.
        for uvl in ob.data.uv_layers:
            u = uv_stats(ob, uvl)
            if u:
                print(f"       uv {uvl.name!r} ativa={uvl.active} render={uvl.active_render} "
                      f"min={[round(x,3) for x in u[0]]} max={[round(x,3) for x in u[1]]} "
                      f"loops_fora={u[2]}/{u[3]} cobertura~{area_uv(ob, uvl)*100:.1f}%")
        for m in ob.data.materials:
            if not m: continue
            print(f"       material {m.name}: nodes={m.use_nodes}")
            if m.use_nodes:
                for n in m.node_tree.nodes:
                    if n.type == 'BSDF_PRINCIPLED':
                        for k in ('Base Color','Metallic','Roughness','Emission Color','Emission Strength','Normal'):
                            s = n.inputs.get(k)
                            if not s: continue
                            lig = s.links[0].from_node.name if s.links else None
                            val = None if s.links else (tuple(round(x,3) for x in s.default_value) if hasattr(s.default_value,'__len__') else round(s.default_value,3))
                            print(f"          {k}: link={lig} valor={val}")
                    if n.type == 'TEX_IMAGE' and n.image:
                        print(f"          textura {n.image.name} {n.image.size[0]}x{n.image.size[1]}")
