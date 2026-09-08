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

# Marca cada textura ja comprimida. Recomprimir JPEG em cima de JPEG perde
# qualidade a cada passada, e o script tem que poder rodar quantas vezes quiser.
for arquivo in public/assets/textures/*/*.jpg; do
  marca="$(dirname "$arquivo")/.$(basename "$arquivo").ok"
  [ -e "$marca" ] && continue
  nome=$(basename "$arquivo" .jpg)
  case "$nome" in
    normal) q=$QUALIDADE_NORMAL ;;
    color)  q=$QUALIDADE_COR ;;
    *)      q=$QUALIDADE_DADOS ;;
  esac
  sips -s format jpeg -s formatOptions "$q" "$arquivo" --out "$arquivo" >/dev/null 2>&1
  touch "$marca"
done

GLTF=./node_modules/.bin/gltf-transform
if [ -x "$GLTF" ]; then
  for fonte in assets-src/models/*/*.gltf assets-src/models/*/*.glb; do
    [ -e "$fonte" ] || continue
    nome=$(basename "$(dirname "$fonte")")
    destino="public/assets/models/$nome.glb"
    # Meshopt em vez de Draco: comprime malha e tambem as faixas de animacao,
    # que nesta biblioteca sao a maior parte do arquivo.
    "$GLTF" optimize "$fonte" "$destino" \
      --compress meshopt --texture-compress webp --simplify false >/dev/null
    echo "modelo: $fonte -> $destino"
  done
else
  echo "gltf-transform ausente, rode pnpm install" >&2
fi

depois=$(du -sk public/assets | cut -f1)
echo "public/assets: ${antes} KB -> ${depois} KB"
