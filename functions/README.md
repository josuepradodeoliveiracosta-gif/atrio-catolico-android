# Insígnias de contribuição

O APK apenas lê a pontuação e envia a preferência de destaque. Os créditos,
estornos, níveis públicos e o registro da primeira publicação são escritos pelo
Firebase Admin SDK nas Cloud Functions; as regras negam gravações de clientes
nesses dados.

## Regras do piloto

- `conversation`: +1 por reação à discussão e +3 pela primeira resposta de cada
  pessoa; níveis em 15, 45, 100, 220 e 450 pontos.
- `helpful`: +1 por reação à resposta e +2 pela primeira resposta direta de cada
  pessoa; níveis em 15, 45, 100, 220 e 450 pontos.
- `welcome`: +2 para quem responde à primeira publicação de outra pessoa e +3
  quando essa pessoa responde diretamente; níveis em 10, 30, 65, 120 e 200.
- Reações, respostas e créditos são idempotentes por pessoa e conteúdo. A
  remoção do conteúdo ou interação recalcula o crédito e pode estorná-lo.
- As interações anteriores ao início das funções não são importadas. Conteúdo
  antigo pode receber pontos por interações novas. A primeira publicação é
  identificada pela publicação mais antiga disponível e guardada fora do perfil
  público; não exige rótulo público de novato.
- Uma única trilha pode ser destacada. O visitante vê apenas essa trilha e seu
  nível; os totais individuais não formam um ranking público.

## Verificação e implantação

`node --test functions/contribution-core.test.cjs` testa limites, ações
repetidas, auto-interações, as três trilhas e estornos. `npm test` em
`tests/security` também valida as permissões Firestore no emulador.
O teste de integração das funções roda com Node.js 22 e Java 21+:

```sh
firebase emulators:exec --only firestore,functions --project demo-atrio-v11 \
  "node functions/contribution-emulator.test.cjs"
```

Esta alteração adiciona código-fonte, não ativa as funções no Firebase. A
publicação requer aprovação e configuração do projeto; Cloud Functions pode
exigir o plano Blaze e gerar custos conforme o uso.
