#!/usr/bin/env python3
"""Fatia o clipe bruto de golpes de espada em amostras separadas.

Detecta silencio, corta cada golpe com um pouco de pre-roll e de cauda,
normaliza o pico e exporta mp3 mono em public/assets/audio/swings.
O jogo sorteia uma amostra a cada golpe; a diferenca entre leve e pesado
sai de pitch e volume no runtime, nao de conjuntos separados, porque as
gravacoes tem todas o mesmo carater. Rodar de novo e idempotente.
"""
import json
import os
import re
import shutil
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRADA = os.path.join(RAIZ, 'assets-src/audio/espada-raw.wav')
SAIDA = os.path.join(RAIZ, 'public/assets/audio/swings')

LIMIAR = '-40dB'   # abaixo disso conta como silencio
MINIMO = 0.12      # segundos de silencio que separam dois golpes
PREROLL = 0.020    # segundos antes do onset, preserva o transiente
CAUDA = 0.090      # segundos depois, preserva a queda
PICO = -1.0        # dBFS alvo do pico


def ffmpeg(args, **kw):
    return subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y'] + args,
                          check=True, **kw)


def duracao_de(caminho):
    saida = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                            '-of', 'csv=p=0', caminho], capture_output=True, text=True, check=True)
    return float(saida.stdout.strip())


def regioes_com_som(caminho, total):
    """Devolve os pares (inicio, fim) das partes que nao sao silencio."""
    log = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', caminho, '-af',
                          f'silencedetect=noise={LIMIAR}:d={MINIMO}', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    inicios = [float(v) for v in re.findall(r'silence_start: ([0-9.]+)', log)]
    fins = [float(v) for v in re.findall(r'silence_end: ([0-9.]+)', log)]
    if not fins:
        return [(0.0, total)]
    saida = []
    for fim in fins:
        seguintes = [s for s in inicios if s > fim]
        saida.append((fim, min(seguintes) if seguintes else total))
    return saida


def pico_de(caminho):
    log = subprocess.run(['ffmpeg', '-hide_banner', '-i', caminho, '-af', 'volumedetect',
                          '-f', 'null', '-'], capture_output=True, text=True).stderr
    achado = re.search(r'max_volume: (-?[0-9.]+) dB', log)
    return float(achado.group(1)) if achado else 0.0


def main():
    if not os.path.isfile(ENTRADA):
        sys.exit(f'falta {ENTRADA}')

    shutil.rmtree(SAIDA, ignore_errors=True)
    os.makedirs(SAIDA)

    total = duracao_de(ENTRADA)
    amostras = []

    for i, (a, b) in enumerate(regioes_com_som(ENTRADA, total), start=1):
        inicio = max(0.0, a - PREROLL)
        dur = min(total - inicio, (b - a) + PREROLL + CAUDA)
        if dur < 0.12:
            continue

        bruto = os.path.join(SAIDA, f'.tmp-{i}.wav')
        ffmpeg(['-ss', f'{inicio:.4f}', '-t', f'{dur:.4f}', '-i', ENTRADA,
                '-ac', '1', '-ar', '48000', bruto])

        atual = pico_de(bruto)
        ganho = PICO - atual
        saida_fade = max(0.0, dur - 0.06)
        nome = f'swing-{i:02d}.mp3'

        ffmpeg(['-i', bruto, '-af',
                f'volume={ganho:.2f}dB,afade=t=in:st=0:d=0.008,'
                f'afade=t=out:st={saida_fade:.4f}:d=0.06',
                '-c:a', 'libmp3lame', '-b:a', '128k', '-ac', '1',
                os.path.join(SAIDA, nome)])
        os.remove(bruto)

        amostras.append({'arquivo': nome, 'duracao': round(dur, 3)})
        print(f'  {nome}  {dur:.3f}s  pico {atual:+.1f}dB, ganho {ganho:+.1f}dB')

    manifesto = {
        'fonte': 'YouTube 4bJI-e28kFg, sword slash (sound effects), canal Mani creation',
        'licenca': 'licenca padrao do YouTube, uso nao liberado explicitamente',
        'amostras': amostras,
    }
    with open(os.path.join(SAIDA, 'manifest.json'), 'w') as arquivo:
        json.dump(manifesto, arquivo, indent=2, ensure_ascii=False)
        arquivo.write('\n')

    tamanho = sum(os.path.getsize(os.path.join(SAIDA, a['arquivo'])) for a in amostras)
    print(f'\n{len(amostras)} amostras, {tamanho / 1024:.1f} KB em {SAIDA}')


if __name__ == '__main__':
    main()
