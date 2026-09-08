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

## M1, gray box jogável

Data: 2026-09-08
Máquina: Mac M-series, navegador embutido do Claude Code
Backend: WebGPU
Resolução do buffer: 1600x900 com pixel ratio 1,5, ou seja 2400x1350
Cena: arena completa em gray box, jogador na arena com lock-on ativo

| Métrica | Valor | Limite | Situação |
|---|---|---|---|
| Frame time | 6,76 ms | 16 ms | 42% do orçamento |
| Draw calls | 10 | 300 | 3% do orçamento |
| Triângulos | 3 185 | 1 500 000 | 0,2% do orçamento |
| Luzes com sombra | 1 (a lua) | 1 | no limite |
| Luzes sem sombra | 14 braseiros | sem limite | ok |
| Escala de resolução | 1,00 | mínimo 0,62 | sem redução |
| Download de asset | 1,65 MB | 60 MB | 3% do orçamento |

Os 10 draw calls saem do uso de `InstancedMesh` no muro, nos pilares e na
escadaria: 28 blocos de muro custam uma chamada, não 28. É folga que vai ser
gasta no M3, quando entrar o kit modular com textura, e no M4, com o chefe.

Sobre a medição: `renderer.info.autoReset` está desligado e o painel calcula a
média por frame a partir do delta acumulado na janela. O contador do WebGPU é
preenchido depois do render, que é assíncrono, então zerar antes de desenhar
leria sempre um frame incompleto. Sem esse cuidado o número saía 138 vezes maior.

O fps de 143 medido aqui roda num relógio de `MessageChannel`, não no
`requestAnimationFrame`, porque o painel de preview trata a página como
documento oculto. Serve pra comparar entre marcos, mas o fps definitivo continua
pendente de um build aberto numa janela de navegador de verdade.
