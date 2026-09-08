#!/usr/bin/env bash
# Compressao dos assets antes de irem pro bundle. Regra da secao 8: nada entra
# em public/assets sem passar por aqui.
#
# Texturas: recomprime JPEG. Cor, rugosidade e oclusao aguentam qualidade baixa;
# normal precisa de mais, porque artefato de JPEG em normal vira relevo falso.
#
# GLB: passa pelo gltf-transform com Meshopt quando ele existir.
#
# KTX2 ainda nao roda aqui: o encoder do KTX-Software nao esta instalado nesta
# maquina e nao ha formula do Homebrew pra ele. Ver docs/decisions.md.

set -euo pipefail
cd "$(dirname "$0")/.."

QUALIDADE_COR=62
QUALIDADE_NORMAL=82
QUALIDADE_DADOS=58

if ! command -v sips >/dev/null 2>&1; then
  echo "sips ausente, esta etapa so roda em macOS" >&2
  exit 1
fi

antes=$(du -sk public/assets | cut -f1)

for arquivo in public/assets/textures/*/*.jpg; do
  nome=$(basename "$arquivo" .jpg)
  case "$nome" in
    normal) q=$QUALIDADE_NORMAL ;;
    color)  q=$QUALIDADE_COR ;;
    *)      q=$QUALIDADE_DADOS ;;
  esac
  sips -s format jpeg -s formatOptions "$q" "$arquivo" --out "$arquivo" >/dev/null 2>&1
done

if command -v gltf-transform >/dev/null 2>&1; then
  for modelo in public/assets/models/*.glb; do
    [ -e "$modelo" ] || continue
    gltf-transform optimize "$modelo" "$modelo" --compress meshopt --texture-compress webp
  done
else
  echo "gltf-transform ausente, GLB nao otimizado (nenhum GLB no projeto ainda)"
fi

depois=$(du -sk public/assets | cut -f1)
echo "public/assets: ${antes} KB -> ${depois} KB"
