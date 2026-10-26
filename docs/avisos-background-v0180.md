# Átrio Católico 0.18.0 — Avisos em segundo plano sem servidor pago

## O que o APK pode fazer
- Novo controle **Perfil > Avisos no celular > Verificação em segundo plano**.
- Ativação voluntária separada do controle FCM 0.17.0.
- Solicita a permissão de notificações somente quando o usuário pedir ativação (Android 13+).
- Usa WorkManager nativo para consultar avisos a cada **aproximadamente 30 minutos**, exigindo rede.
- Pode gerar notificação local mesmo se o aplicativo não estiver aberto na tela
  e seu processo já tiver sido encerrado normalmente; **não há garantia de execução
  após encerramento forçado pelo usuário, restrições de fabricante ou economia
  de bateria.** O Android também pode atrasar os intervalos significativamente.
- Respostas: consulta somente as notificações privadas do usuário autenticado,
  filtrando as não lidas.
- Selos: consulta o pedido do próprio usuário e notifica resultados recentes.
- Administração: revalida `admins/{uid}.enabled` no Firestore antes de consultar
  denúncias ou pedidos de selos; ignora o pedido de selo da própria conta.
- Usa título/corpo genérico local e abre o aplicativo, sem mostrar texto de
  discussões, e-mails, identidades ou justificativas administrativas.
- Respeita preferências existentes na central de avisos (respostas, selo, administração).
- Ao sair da conta desativa a verificação e cancela o trabalho agendado;
  tarefas pendentes verificam UID autenticado antes de mostrar um aviso.
- Após ativação usa a data de adesão como ponto inicial: não gera enxurrada
  de notificações sobre eventos anteriores.
- Armazena identificadores já notificados por UID no aparelho, com limite
  de 500, e usa sobreposição de 5 minutos para reduzir perdas/duplicações.
- Usa consultas incrementais com limite máximo de 25 documentos por fonte
  para reduzir a utilização da cota Firestore.
- Nenhuma mudança em regras, índices ou projeto Firebase; não há chaves de servidor.

## Custos e limites
**Sem ativação de cobranças:** o trabalho usa o Firestore existente no plano
gratuito. Contudo, cada verificação consome leituras da cota compartilhada,
e o Spark possui **50.000 leituras/dia** no banco gratuito. O uso pode esgotar
essa cota se muitas contas ligarem a funcionalidade. Confira o consumo em
Console Firebase > Firestore > Uso antes de convidar muitos usuários.
A consulta incremental reduz custos, mas cada consulta vazia também
pode consumir leitura mínima. O período de 30 minutos não é contrato
de entrega e poderá se tornar maior dependendo do Android.

Este método NÃO é push em tempo real. O FCM continua preparado na 0.17,
mas ainda requer emissor confiável para notificações instantâneas.
O PR separado #12 contém planejamento/testes de eventos de envio,
sem servidor e sem agendamento ativo.

## Testes necessários em aparelhos Android
1. Instalar o APK assinado por cima da 0.17.0, sem desinstalar.
2. Abrir Perfil, ativar apenas **Verificação em segundo plano** e permitir
   avisos Android. Confirmar que FCM pode continuar desligado.
3. Publicar uma resposta de outra conta depois da ativação, deixar o
   aplicativo em segundo plano e verificar se surge aviso posteriormente.
4. Conferir que respostas anteriores à ativação não geram avisos.
5. Desativar categoria Respostas na central; confirmar ausência de aviso local.
6. Analisar selo e verificar que resultado é apresentado só ao dono.
7. Admin: testar pedido de outro usuário, denúncia, depois revogar
   `admins/{uid}.enabled` e verificar que o acesso não permanece.
8. Desligar verificação, trocar de conta e sair. Garantir isolamento e
   ausência de novas notificações da conta anterior.
9. Testar Android 13+, restrição de bateria e app removido de recentes.
   Encerrar aplicativo à força em Ajustes Android para comprovar que
   nenhum aviso é garantido nessa condição.
10. Observar uso do Firestore ao testar múltiplos aparelhos.

As verificações automatizadas cobrem compilação Android, política de
notificação e regras Firestore, mas não demonstram recebimento real.
