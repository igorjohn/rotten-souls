# Perf

Regra da seção 4 do briefing: sem número aqui, o marco não fecha.

Como medir: rodar `pnpm dev`, abrir o jogo, apertar `F3` pro painel, ou chamar
`window.perf()` no console em modo de desenvolvimento.

## Orçamento (limites duros)

| Item | Limite |
|---|---|
| Download inicial | 60 MB, meta 40 MB |
| Triângulos por frame | 1 500 000 |
| Draw calls por frame | 300 |
| Frame time | 16 ms em M-series a 1080p |
| Luzes com sombra em tempo real | 1 |

## M0, setup

Data: 2026-09-08
Máquina: Mac M-series, navegador embutido do Claude Code
Backend: **WebGPU** confirmado no boot (`[boot] backend webgpu`)
Resolução do buffer: 1600x900 com pixel ratio 1,5, ou seja 2400x1350

| Métrica | Valor | Limite | Situação |
|---|---|---|---|
| Frame time | 7,01 ms | 16 ms | dentro |
| Draw calls | 28 | 300 | dentro |
| Triângulos | 21 907 | 1 500 000 | dentro |
| Escala de resolução | 1,00 | mínimo 0,62 | sem redução |
| Download de asset | 1,65 MB (HDRI 1k) | 60 MB | dentro |

Ressalva honesta: o painel de preview roda a página como documento oculto, então
o `requestAnimationFrame` não dispara e o loop cai num agendador de `setTimeout`
de 16 ms. Por isso o **fps medido ali não vale** (aparece por volta de 20, é a
cadência do timer, não o custo do frame). O número que vale é o **frame time**,
que mede trabalho real de CPU mais submissão de GPU. Os 28 draw calls e os 21 907
triângulos numa cena "vazia" são do fundo equiretangular e do pré-filtro de
ambiente do HDRI.

Medição definitiva de fps fica pra quando houver build publicado, aberto numa
janela de navegador de verdade.
