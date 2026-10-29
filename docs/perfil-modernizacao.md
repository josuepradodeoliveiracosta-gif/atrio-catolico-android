# Perfil: auditoria e revisão para celular

## Base e escopo

Base remota consultada: `9642369eef4b230cc17e98a4a82375ccb4d2e77c`.
`app/build.gradle.kts` nessa base: versionName 0.19.0, versionCode 27.
Esta branch é uma proposta de interface; não é uma versão oficial publicada.

## Diagnóstico e prioridades

| Prioridade | Constatação no código anterior | Ação e risco |
| --- | --- | --- |
| Alta | Diagnóstico Cloudflare e token FCM ocupavam a tela comum | Área avançada expansível; baixo risco, mesmos serviços e ações |
| Alta | Revisões do Guardião ficavam fora da rolagem, antes da identidade | Atalho em Minha participação; baixo risco, mesma navegação |
| Alta | Conta ficava depois da lista potencialmente longa de publicações | Conta antes da lista, publicações expansíveis; baixo risco |
| Alta | Cancelar ou voltar fechava o editor descartando rascunho sem aviso | Confirmação de descarte e testes da interface; risco moderado de fluxo |
| Alta | Callback de gravação podia atuar depois da saída/troca do editor | Ignorar callback de sessão descartada, sem cancelar a gravação já enviada |
| Média | Switches sem nome acessível específico e texto disputando largura | Rótulos para leitor de tela e espaço flexível para texto |
| Média | Publicações são filtro do feed carregado, não histórico integral | Aviso explícito; nenhuma contagem fictícia nem consulta nova |
| Média | Preferências por categoria estavam apenas na central; texto dizia incorretamente que a versão não enviava avisos com app fechado | Atalho direto e orientação atualizada, sem mudar preferências |
| Futura | Não há upload, URL ou armazenamento de foto no perfil atual | Manter inicial/arte do Fundador; planejar armazenamento e regras separadamente |
| Futura | Tema global é fixo claro, com cores fixas em várias telas | Não ativar modo escuro parcialmente; novos cartões usam tokens Material |
| Futura | Chips dos selos usam texto pequeno e rolagem horizontal | Preservar componente global; revisar acessibilidade em mudança própria |

## Mapa dos componentes e serviços auditados

- `ProfileScreen.kt`: perfil conectado, biografia privada, formulário, publicações e acesso administrativo.
- `OnlineAtrioApp.kt`: login/cadastro, listener privado do perfil, listener de administradores e Fundador, navegação, paginação, logout e troca de usuário.
- `MainActivity.kt`: `AtrioTheme`, cartões de discussão, navegação e perfil **de demonstração** separado; não é duplicação acidental do perfil conectado.
- `BadgeUi.kt` e `FounderBadgeArt.kt`, `PriestBadgeArt.kt`, `DeaconBadgeArt.kt`, `LayBadgeArt.kt`, `ModeratorBadgeArt.kt`: selos visuais. A condição de moderador visual não concede administração.
- `ClergyBadgeReviewScreen.kt`, `ModerationScreen.kt`, `AdminBroadcastPanel.kt`: destinos administrativos existentes. Mantidas as verificações atuais de acesso.
- `PushSettings.kt`: controles por aparelho/UID, permissão Android, consulta de token e diagnóstico.
- `AtrioPushService.kt`/`PushRegistry`, `PushRegistrationDiagnostic.kt`: cadastro, recebimento e apresentação de push.
- `BackgroundNoticeWorker.kt`/`BackgroundNoticeScheduler`, `BackgroundNoticePolicy.kt`: verificação periódica, distinta de push instantâneo.
- `InstantPushRelay.kt`, `ThreadPushSubscriptions.kt`, `NotificationCenter.kt`, `NotificationModels.kt`: envio, inscrições e central/preferências existentes.
- `GuardiaoAppealsScreen.kt`/`GuardiaoReviewClient.kt`: revisões abertas pelo atalho do Perfil.
- `firestore.rules`: autorização real de perfis, selos, denúncias e dispositivos; sem alteração.

O e-mail e a biografia são privados; o nome é copiado para novas publicações. Não existe histórico agregado de respostas nem foto personalizada nesta tela. Não foram inventados contadores, configurações de segurança ou botões sem implementação.

## Antes e depois

| Antes | Proposta |
| --- | --- |
| Botão de revisões fixo acima da identidade | Revisões e salvos na seção Minha participação |
| Ajustes e dados técnicos de push juntos | Controles comuns visíveis; diagnóstico sob expansão |
| Conta depois de toda a lista de posts | Conta acessível antes das publicações |
| Cancelamento imediato do formulário | Descarte confirmado quando houver alterações |
| Mensagens pequenas sem anúncio acessível | Confirmação e erros com região de anúncio educada |

## Preservação e limites

- Sem alteração de Firebase Auth, regras, esquema, índices, serviços Cloudflare, assinatura, versão, permissões Android ou backup.
- Mesmo `update` de displayName/bio, mesmos limites de 35/180 caracteres. Não grava no Firebase ao apenas abrir o Perfil.
- Serviços, cadastros, preferências e agendamento de notificações preservados. Expandir diagnóstico não cadastra dispositivos nem envia push.
- O logout mantém o comportamento existente: desativa o registro e a verificação dessa sessão antes de sair. Não mudamos essa política nesta PR.
- Os selos e acessos administrativos mantêm os mesmos componentes e condições. Não concedemos novos privilégios.
- Sem nova consulta para calcular participação. A lista é expandida sob demanda, preservando a paginação do feed.
- A confirmação de descarte protege Cancelar, toque fora e Voltar no diálogo; não constitui garantia de salvar rascunho após encerramento do aplicativo.
- Firebase Auth pode apresentar o nome em cache durante reconexão; o listener Firestore continua sendo a fonte do nome atualizado. Esse comportamento anterior não foi reescrito.
- Diagnóstico de envio não comprova recebimento real; autorização do Android e restrições de bateria ainda precisam ser verificadas no aparelho.

## Validação

Adicionados quatro testes Compose do editor real com persistência simulada:
1. Nome válido, normalização e bloqueio de envio duplicado enquanto salva.
2. Falha preserva o texto e permite nova tentativa.
3. Cancelamento exige confirmação, permite continuar e descartar sem gravar.
4. Troca de UID limpa rascunho e ignora conclusão antiga.

A suíte é chamada no runner Android existente, isolado em `demo-atrio-v11`. Um teste adicional da tela completa usa fonte a 150%, verifica os atalhos/rolagem e gera capturas de identidade, notificações e conta no artefato de QA.
Os checks da PR compilam Android, executam testes unitários e testes Firestore no emulador. O job Android virtual também testa os fluxos autenticados existentes, incluindo edição do perfil/selos e logout/login.

Ambiente local desta revisão: Java 17 disponível; Gradle, Android SDK e emulador não instalados. Resultados executados de CI devem ser consultados na aba Checks da PR; não presumir aprovação pela existência dos testes.

## Roteiro de revisão pelo celular

1. Abrir o Perfil: conferir identidade, selos e biografia; verificar e-mail privado e número da versão.
2. Editar nome/apresentação; cancelar, continuar editando e descartar. Salvar e verificar retorno ao perfil.
3. Sem conexão, verificar comportamento de espera/erro; reconectar antes de repetir uma gravação pendente.
4. Abrir Salvos, Revisões e Central; usar Voltar e conferir navegação.
5. Expandir publicações, abrir uma discussão e carregar mais; não interpretar a lista como histórico completo.
6. Expandir/recolher diagnóstico; confirmar que preferências não mudam por essa ação.
7. Testar fonte ampliada, tela estreita e TalkBack nos controles.
8. Conferir Fundador/Padre/Diácono/Leigo/Moderador com contas já autorizadas, sem atribuir papéis para o teste.
9. Repetir login/logout e troca de contas; verificar ausência de rascunho de outro usuário.
10. Antes de integrar, repetir o teste de push com dois celulares, inclusive em segundo plano, mediante autorização. Compilar não prova recebimento.

## Próximas melhorias, fora desta PR

Foto personalizada exige definição de armazenamento, custo, privacidade e validação. Histórico completo precisa de consultas/índices e avaliação de leituras. Tema escuro deve cobrir o aplicativo inteiro. Estado de permissão/canal do Android, recuperação de senha e gestão de conta merecem fluxos próprios. Não expor um botão de excluir conta sem tratar reautenticação e dados associados.
