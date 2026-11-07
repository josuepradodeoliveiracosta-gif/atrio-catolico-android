# Átrio Conversas — validação em dois celulares Android (sem produção)

**Estado:** roteiro preparado; testes com dispositivos físicos ainda **não realizados**.
**PR:** #193 · **Escopo:** chat privado e grupos textuais · **Ambiente:** homologação segregada.

## Pré-condições para iniciar

- [ ] E2E Android emulado **aprovado no commit exato** da PR, incluindo pedido, aceite, envio, bloqueio, desbloqueio, grupos e logout.
- [ ] Contas de teste **adultas e autorizadas**, sem dados de terceiros ou menores.
- [ ] Ambiente de homologação isolado, com projeto Firebase de teste, regras específicas revisadas e chave do Worker separada. **Não usar o Firebase nem as credenciais oficiais.**
- [ ] APK de teste distinto, sem assinar como Release oficial e sem substituir o APK da produção.
- [ ] Autorização de notificações Android concedida nos dois aparelhos de teste. Confirmar previamente os gates administrativos e política de retenção de homologação.
- [ ] Dois aparelhos Android físicos disponíveis, preferencialmente versões de Android ou fabricantes distintos.
- [ ] Registros de teste sem textos sensíveis, sem tokens FCM ou dados de autenticação em capturas ou logs.

## Cenários obrigatórios (registrar APROVADO / FALHOU / NÃO EXECUTADO)

| Cenário | Execução / resultado esperado | Estado |
|---|---|---|
| 01. Primeira solicitação | A solicita conversa com B; B vê o pedido, mas não há chat aceito automático | NÃO EXECUTADO |
| 02. Recusa de contato | B recusa; A não consegue enviar segunda mensagem | NÃO EXECUTADO |
| 03. Aceite | B aceita explicitamente; A consegue enviar e B consegue responder | NÃO EXECUTADO |
| 04. Envio em tempo real | Mensagem confirmada no servidor aparece nos dois aparelhos, sem duplicação | NÃO EXECUTADO |
| 05. Bloqueio | B bloqueia A; A não consegue enviar, inclusive após reiniciar e reconectar | NÃO EXECUTADO |
| 06. Desbloqueio | Somente B remove bloqueio; a conversa pode continuar sem perder histórico | NÃO EXECUTADO |
| 07. Offline | Desligar a rede, tentar enviar e reconectar; nenhuma mensagem fantasma ou duplicada | NÃO EXECUTADO |
| 08. Notificação fora do app | Com app em segundo plano e depois fechado, testar alerta sem expor prévia privada indevida | NÃO EXECUTADO |
| 09. Sem permissão de notificar | Negar notificações; mensagens ainda ficam disponíveis ao abrir a conversa | NÃO EXECUTADO |
| 10. Conta alternada | Fazer logout e login de outro usuário; nenhuma conversa, badge ou convite da conta anterior aparece | NÃO EXECUTADO |
| 11. Grupo fechado | A cria grupo, B aceita convite, envia texto, sai e perde acesso; histórico permanece aos membros autorizados | NÃO EXECUTADO |
| 12. Encerrar grupo | Administrador encerra grupo; mensagens anteriores continuam disponíveis apenas aos membros autorizados, novas escritas são negadas | NÃO EXECUTADO |
| 13. Denúncia | Denunciar mensagem selecionada; confirmar encaminhamento restrito sem acesso geral da moderação às conversas | NÃO EXECUTADO |
| 14. Retenção e exclusão | Confirmar política aprovada e comportamento da exclusão antes de propor ativação pública | NÃO EXECUTADO |
| 15. Sem privilégios | Usuário não elegível ou com gate desativado nunca recebe acesso a chats ou grupos | NÃO EXECUTADO |

## Dados a registrar por ensaio

- **Data, commit e build:** registrar exatamente o APK homologado; não misturar com a versão Release.
- **Celular A / B:** modelo, versão Android, condições de rede e permissão de notificação.
- **Evidência:** resultado aprovado/reprovado, horário local e referência do log **sanitizado** (sem UID, CPF, e-mail, token ou conteúdo pessoal).
- **Falha:** passos reproduzíveis, comportamento esperado, comportamento observado e vínculo para issue/PR.
- **Repetição:** testar o mesmo cenário com papéis A e B invertidos, sobretudo bloqueio, convite e autenticação.

## Condições de reprovação imediata

- Acesso a chat, grupo, mensagem ou token de outra conta após logout.
- Mensagem enviada após bloqueio ou antes do aceite, pela UI ou por cliente alternativo.
- Abertura de grupos por usuários sem elegibilidade do servidor.
- Push que revela conteúdo privado apesar das preferências de privacidade.
- Mudanças em Firebase oficial, `firestore.rules`, APK Release, chaves, backups ou usuários reais para realizar o teste.
- Falha de sincronização que anuncie envio como confirmado quando o servidor o recusou.

## Portão de publicação

**Não liberar o chat** enquanto qualquer ensaio crítico estiver em NÃO EXECUTADO ou FALHOU.
Um CI verde em emulador **não substitui** FCM em aparelho físico, revisão jurídica/LGPD/ECA Digital, autorização administrativa para menores, critérios de denúncia e moderação, e regras de retenção/deleção aprovadas.

**Nenhuma implantação de produção é autorizada por este documento.**
