# Direção de arte, Pátio das Cinzas

Base: seção 3 do `PROMPT.md`. Este arquivo é o detalhamento operacional.

## Princípio

O look Souls vem de iluminação e composição, não de contagem de polígonos. Em
tela escura com névoa e pontos de fogo, o que uma engine nativa faz a mais quase
não se percebe. É essa brecha que o projeto explora.

## Paleta

| Papel | Hex | Uso |
|---|---|---|
| Fundo | `#05070c` | Céu, sombra profunda, HTML de fundo |
| Pedra escura | `#3a3b3f` | Muro, pilar, chão em sombra |
| Pedra clara | `#6b6a63` | Pedra tocada pelo luar |
| Musgo | `#3d4a2b` | Fresta, base de muro, canto úmido |
| Fogo | `#ff8a2a` | Núcleo da chama, luz pontual de braseiro |
| Brasa | `#ffd17a` | Faísca, ponta da chama, bloom |
| Lua | `#8fa9c9` | Luz-chave direcional, contorno de silhueta |
| Sangue e HUD | `#8b1e1e` | Barra de vida, tela de morte |

## Iluminação

1. Uma única luz com sombra em tempo real: a lua. Direcional, fria (`#8fa9c9`),
   vinda de trás e de cima da arena, sombra suave.
2. Braseiros são luz pontual de raio curto, laranja quente, **sem sombra**.
   Doze no anel. Cada um com chama, faísca e um fio de fumaça.
3. Ambiente vem do HDRI com intensidade baixa (0,35), só pra não ter preto chapado.
4. Exposição do tonemapping em 0,86 com ACES filmic. Escuro de verdade.

## Névoa

Três camadas, cada uma com um trabalho:

- **Névoa de altura**, mais densa nos primeiros 2 metros, esconde a junção
  entre chão e parede e dá peso ao passo do personagem.
- **Névoa de distância**, come o fundo e barateia tudo que está longe.
- **God ray fraco** vindo da lua, atravessando os arcos.

## Materiais

Rugosidade alta em quase tudo. Brilho só em poça e metal. Normal e oclusão
sempre. Pedra com musgo nas frestas, metal oxidado, madeira queimada.

## Pós-processo

Bloom baixo e largo, sem estourar o fogo. Oclusão de ambiente pra assentar os
objetos no chão. Vinheta leve. Grão fino. Color grading puxando azul-esverdeado
nas sombras e âmbar nas luzes. Aberração cromática só se quase não der pra ver.

## Escala

Arquitetura grande demais pro personagem: arcos de 8 metros, pilares de 10.
Vharen tem no mínimo 2,5 vezes a altura do jogador. Silhueta legível contra a
névoa é o critério que manda em qualquer decisão de forma.
