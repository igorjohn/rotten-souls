# Onde paramos

Atualizado em 2026-09-08. Este arquivo existe pra uma sessão nova pegar o fio
sem reler o histórico inteiro. Detalhe de decisão fica em `decisions.md`,
número fica em `perf.md`.

## O jogo está jogável

`pnpm dev` e abre `http://localhost:5173`. O ciclo fecha: descer a escadaria,
cruzar o portão de névoa, cutscene do chefe, lutar, morrer com "VOCÊ MORREU",
voltar pro alto da escadaria, vencer com "GRANDE INIMIGO ABATIDO".

M0 a M5 fechados e commitados, um commit por marco. Repositório em
`github.com/igorjohn/rotten-souls`, privado, branch `main`.

## Últimos números

Frame 7,7 ms contra teto de 16. 75 draw calls contra 300. 70 mil triângulos
contra 1,5 milhão. Download 9,8 MB contra 60 MB.

## Em andamento

- **Agente do Blender.** Rodando em segundo plano, dono de `scripts/blender/**`,
  `src/entities/anim/retarget.ts`, `src/entities/appearance.ts`,
  `public/assets/models/**` e `assets-src/models/**`. Missão: assar as animações
  CC0 no esqueleto do Vharen definitivo pelo Blender sem interface, e dar pele
  ao jogador. Quando terminar, revisar, verificar visualmente e commitar.

## Pendências conhecidas

- **Vharen definitivo atrás de `?vharen`.** O modelo é bom, a animação deforma.
  É o que o agente do Blender está resolvendo.
- **Link público.** Nunca publicado. O Igor adiou duas vezes; o critério do M0
  segue aberto. `pnpm build` gera `dist/` pronto pra subir estático.
- **Texturas em KTX2.** Falta o codificador do KTX-Software na máquina. Ganho
  seria de memória de vídeo, não de download.
- **Bloqueio e aparo.** Cortados no M1 quando a arma virou montante sem escudo.
- **Props do Tripo.** Cortados por orçamento de crédito. Sobraram 19 créditos
  na Higgsfield.

## Balanceamento, e por que está assim

O Igor jogou e reclamou de três coisas, todas corrigidas com medição antes de
mexer:

1. "Parece que seguro uma espada de 50kg". `Sword_Attack` dura 1,50 s e rodava
   a 1,4x, dando 1,07 s por golpe leve. Agora roda a 2,4x e sai em 0,63 s.
2. "A esquiva está lenta". O estado durava 0,62 s enquanto o clipe `Roll` de
   1,46 s ainda estava no meio, então a animação era cortada. Agora o clipe roda
   na velocidade exata pra caber em 0,52 s.
3. "O boss se defende". Ele não se defende; o poise dele era 62 e ele atravessava
   os golpes sem reagir. Caiu pra 34.

Depois entraram hitstop de 60 a 110 ms no impacto, encadeamento de até três
golpes leves, e cancelamento do fim do golpe por esquiva.

## Parâmetros de URL

`?mute` abre sem som, `?size=LxA` força a resolução do buffer, `?vharen` liga o
modelo gerado do chefe.

## Chaves

`.env` tem `GEMINI_API_KEY` (sem cota de imagem, não use) e
`OPENROUTER_API_KEY` (funciona, uns US$ 9 de saldo, teto de US$ 5 combinado com
o Igor). O `.env` nunca entrou no git; confirmado por busca no histórico.

## Armadilhas já mapeadas

Estão detalhadas em `decisions.md`, mas as que mais custaram tempo:

- O relógio dos nós do Three só avança dentro do loop de animação dele. Com loop
  próprio é preciso chamar `nodeFrame.update()` à mão, senão passe de cena,
  bloom e oclusão rodam uma vez só na vida.
- Num canvas de WebGPU o primeiro `toDataURL` congela o conteúdo devolvido. A
  captura vai por alvo de render, e a leitura vem com as linhas alinhadas em
  múltiplos de 64 pixels.
- Corpo cinemático do Rapier só anda quando o mundo dá um passo. Calcular
  deslocamento por frame faz o jogo andar mais devagar quanto maior o fps.
- O carregador de glTF do Three remove pontos dos nomes de nó.
