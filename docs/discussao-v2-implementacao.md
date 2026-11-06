# Discussão V2 — implementação de interface e testes

Estado: proposta de código destinada à `main`, sem implantação Firebase/Workers
e sem modificar backups protegidos. Uma compilação CI é diferente da homologação
real com contas no celular.

## O que mudou

1. `DiscussionDetailV2.kt`: tela responsiva em Compose; o formulário não fica
   mais no último item da lista. O compositor começa como uma faixa pequena
   na base e se expande somente quando a pessoa quer responder.
2. Comentários compactos: autor, selo institucional existente, texto, reações e
   resposta ficam próximos; não há margens artificiais de centenas de pixels.
3. Reações mantêm seletor completo e resumo ao lado de `Reagir`, preservando
   long press e ações do Firestore/validação do backend.
4. Opções administrativas (editar/excluir/denunciar) em menus; apenas callbacks
   e permissões previamente existentes são usados. Nunca concede privilégios
   a partir do selo visual.
5. Acompanhamento agora usa rótulo curto e comunica honestamente que não gera
   novos avisos, ou que o modo local é apenas deste aparelho.
6. Ordenação real no Firestore: `createdAt` ASC/DESC, limite 30 com
   `Carregar mais respostas`, sem migrar documentos e sem índices compostos
   adicionais. A contagem `30+` indica mais respostas disponíveis, não
   falsamente o total exato. A ordenação padrão continua antiga primeiro.
7. Hora relativa usa `createdAt` existente, sem criar outro listener e sem
   gravar dados novos.
8. APK Debug incrementa para 0.19.9 (versionCode 36). Identidade Android,
   release, assinatura e versão oficial 0.20.4/code39 permanecem iguais.

## Testes automatizados

- `DiscussionDetailPolicyTest`: tempos relativos e estados sem timestamp.
- `DiscussionDetailV2UiTest`: compositor, envio/citação, denúncia pelo menu,
  ordenação e alinhamento de reações; não acessa o Firebase de produção.
- `ReactionEmojiUiTest`: permanece compilando; long press de comentário,
  seleção rápida, catálogo e tons de pele preservados.
- CI `Validar selos (Android e Firestore)`: deve compilar
  `:app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest`.
  Instrumentação Android com emulador continua sendo uma etapa de
  homologação separada se o job não executar testes de interface em emulador.

## Homologação antes de distribuir release

- Alternar entre contas Fundador/usuário comum, sem ampliar autorização.
- Verificar textos curtos/longos, português, fonte ampliada e celular estreito.
- Abrir teclado, responder, mencionar e cancelar; confirmar rascunho local,
  envio idempotente e aviso do Guardião, inclusive após perda de conexão.
- Reações múltiplas e rolagem nas duas ordenações com mais de 30 respostas.
- Denúncia e exclusão com confirmações existentes.
- Confirmar que não houve mudança em regras, coleções, notificações,
  moderação, identidade/certificado ou backup.

## Limites do escopo

Não são ativados avisos de acompanhamento (a infraestrutura ainda não os
garante). Não são criadas APIs novas, tabelas, índices compostos, permissões
ou serviços pagos. `repliesFooter`, Guardião, menções, reações, notificações
de respostas e demais contratos existentes permanecem integrados.
