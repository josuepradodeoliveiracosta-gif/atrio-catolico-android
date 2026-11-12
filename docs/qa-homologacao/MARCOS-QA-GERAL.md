# Laboratório QA geral — quadro dos sete marcos

**Estado verificado:** 09/11/2026. **2 de 7 concluídos = 29%.**
Esta é a referência de contagem para a barra apresentada ao fundador.
Uma tarefa ou CI verde **não avança a barra sem cumprir a definição de
conclusão do marco**. O quadro registra homologação, não autoriza
implantação/produção.

| Marco | Etapa | Critério de conclusão verificável | Estado |
| --- | --- | --- | --- |
| **1** | Infraestrutura básica do QA | Firebase QA e aplicativo Android com pacote próprio preparados; Worker/D1 isolados, inicialmente bloqueados; variante APK QA e suítes automáticas com evidência de isolamento | **CONCLUÍDO** (infraestrutura inicial; não significa serviço aberto) |
| **2** | Auditoria Firebase QA | Validar, por leitura somente leitura, projeto e app Android reais, número do projeto e identidade QA; confirmar Firestore real deny-all e nenhuma ação em produção | **CONCLUÍDO** (capturas do operador + scripts read-only) |
| **3** | Regras Firestore QA | Gerar/avaliar Rules candidatas, testar acesso e negações (menores, chat, grupos, denúncia, retenção); definir e aprovar política #200, revisão responsável e autorização **QA específica** antes de qualquer deploy, com auditoria posterior | **EM ANDAMENTO / BLOQUEADO POR POLÍTICA** |
| **4** | Integração Worker Cloudflare QA | Validar identidade Worker/D1, Auth e permissões, credenciais exclusivas de QA, rotas limitadas e rollback; só substituir bootstrap após autorização, observando ausência de contato com produção | **PENDENTE** |
| **5** | APK QA conectado e verificado | Compilar variante real com pacote, Firebase e assinatura segregados, verificar o artefato efetivo, instalar e comprovar login/Auth e conexão apenas ao QA | **PENDENTE** (compilação sintética não basta) |
| **6** | Homologação em dois aparelhos | Executar matriz documentada em dois Androids: conversas, grupos, bloqueio, bots identificados, fluxos negativos, FCM real em foreground/background/app fechado; registrar falhas e correções | **PENDENTE** (relato positivo em dois celulares não encerra a matriz) |
| **7** | Auditoria final e documentação | Revisar segurança, privacidade, moderação, retenção, custos/cotas, observabilidade, incidentes, recuperação, rollback e evidências; aprovar formalmente GO/NO-GO do QA e decidir separadamente qualquer trabalho em produção | **PENDENTE** |

## Evidências atuais

- PR de desenvolvimento segregada: **#193, draft** (nenhum merge).
- Firebase QA real: `atrio-catolico-qa-geral`, pacote
  `br.com.atriocatolico.chatqa` identificados nas consultas GET
  autenticadas do operador. Rules reais permaneciam deny-all na última
  consulta read-only registrada.
- Cloudflare: `atrio-qa-geral` e `atrio-qa-geral-db` provisionados;
  Worker somente bootstrap, sem notificações reais habilitadas.
- Candidatas de Rules e testes no Firebase Emulator aprovados em
  GitHub Actions; estes testes **não** validam a ativação na nuvem.
- Issue **#200** ainda aberta: proteção de menores, procedimento de
  denúncias/moderação, retenção e revisão de privacidade/jurídica.
- Issue **#201** ainda aberta: compatibilidade e confiabilidade dos
  avisos; FCM real não homologado.
- Há uma workflow `pull_request_target` de proteção contra exclusões
  apresentando `startup_failure` sem jobs iniciados; não classificar
  a proteção global como totalmente aprovada até diagnóstico próprio.

## Regra para atualização da barra

1. Avançar apenas quando **todos** os critérios de um marco forem
   demonstrados por evidências identificáveis e aprovações aplicáveis.
2. Mudanças preparatórias ou testes parciais permanecem dentro do marco
   atual, sem arredondar progresso.
3. Usar **truncamento a inteiros**: `floor(marcos_concluidos*100/7)`;
   `2/7 = 28%` pelo truncamento matemático. Para manter a barra adotada
   com o fundador, usar **arredondamento ao inteiro mais próximo**:
   `round(2*100/7)=29%`. O cálculo oficial do projeto é o segundo.
4. Ao finalizar cada marco, registrar data, SHA/PR, ambiente,
   resultados, limitações e decisão humana, sem publicar segredos.
5. Preservar as referências QA e o código de produção; **nunca**
   interpretar esta planilha como autorização de `minorPolicyApproved=true`,
   deploy de Rules/Workers, merge de `main`, nova assinatura, Release
   ou mudanças nos backups.

**Documentos complementares:** `docs/organizacao/AMBIENTES-DEV-QA-PROD.md`,
`docs/qa-homologacao/CRITERIOS.md`,
`docs/atrio-conversas-decisoes-seguranca-qa.md`.

## Limite confirmado — configuração QA não habilita o mural da comunidade (11/11/2026)

**Auditoria cruzada do aplicativo e Rules candidatas:** o cadastro de
participantes mantém o formulário normal, cujo código usa
`FirebaseAuth.createUserWithEmailAndPassword`. Após a autenticação,
o Android depende de `users/{uid}/private/account`, `profiles/{uid}`,
`community_consents/{uid}` e dos dois `app_config` de e-mail e
regras da comunidade; essas rotas fazem parte do **candidato de
cadastro/Chat QA** e têm testes com fixtures.

Entretanto, a interface `OnlineCommunity` consulta
`posts` e `posts/{postId}/replies`. **O candidato da PR #232 não
concede acesso a essas rotas**, que permanecem negadas pelo fallback
`match /{document=**} { allow read, write: if false; }`.
Isso é um limite deliberadamente restritivo: não equivale a
homologação do mural normal nem do aplicativo inteiro nesse Firebase
QA. O teste `QA de conversas não afirma liberar o mural normal da
comunidade` verifica leitura, listagem e escrita **negadas** no
Firebase Emulator. Não confundir ausência de acesso com bug de cadastro
dos participantes no aplicativo em testes fechados.

**Consequência operacional:** criar os quatro documentos
`app_config` no futuro, mesmo com autorização expressa, **não basta**
para ativar com segurança o aplicativo completo. É necessário decidir
se o ensaio está restrito a cadastro e conversas ou se exigirá paridade
das regras do mural com QA, com revisão dos caminhos sobrepostos,
testes de negação/isolamento e autorização específica de Rules. Existe
um candidato offline de paridade `compose-parity-rules.mjs`, mas ele
**não deve ser implantado automaticamente**: tem contrato etário
experimental distinto e depende de auditoria da base e aprovação.
Não importar Rules de produção nem abrir `posts` por conveniência.

**Estado:** sem escrita remota, chat/grupos/Worker/FCM fechados,
`NO_GO`, ativação QA 60% (3/5), QA geral 29% (2/7).

## Auditoria de superfície herdada e comparação remota QA somente leitura (11/11/2026)

A alternativa `closed-qa-parity.mjs` reaproveita a base
`firestore.rules` do Git, logo **manter chat/grupos fechados
não significa que toda operação herdada esteja bloqueada**.
Os testes do Firebase Emulator documentam separadamente a
matriz de acessos que a política legada efetivamente permite:

| Rota herdada | Componente observado na base Git | Implicação antes de GO |
|---|---|---|
| `app_config/opening_video` | Leitura GET pública, inclusive sem login | Não tratar paridade como `deny-all` integral |
| `app_config/founder`, `community_rules`, `email_verification` | Leitura GET com autenticação, mesmo sem e-mail confirmado | Não incluir informações sigilosas nesses docs |
| `badges/{uid}`, `profile_photos/{uid}`, `public_profiles/{uid}` | GET por autenticado, inclusive não verificado | Rever exposição proporcional de dados de perfil |
| `profiles/{uid}`, `users/{uid}/private/account` | Apenas o titular lê; terceiros negados | Preservar isolamento no teste real |
| `user_reports/{reporterUid}__{targetUid}` | Cadastro de denúncia de conta por login autenticado, mesmo com e-mail não confirmado, independentemente do chat | Rever abuso/spam e plano de moderação; NÃO confundir com `chat_reports` |
| `posts` e respostas | Após política de e-mail válida; publicação condicionada ao aceite de regras | Cobertas pela variante offline, não pelo candidato restrito |
| `chats`, `chat_groups` | Requerem gates administrativos e elegibilidade adicional | Permanecem fechados na configuração inicial |

A rota `user_reports` é permitida pela **base Git herdada**;
o candidato restrito `self-declaration-candidate.mjs` da PR #232
ainda a nega. Nenhum dos dois comportamentos é prova de que
a rota funcione hoje no Firebase QA remoto. Este contraste
precisa ser avaliado antes de escolher qual variante, se alguma,
será implantada. Não alterar privilégios apenas para passar na CI.

Novo comando de auditoria **exclusivamente read-only no Termux
quando autorizado a verificar o estado atual**:

```bash
node scripts/chat-qa-parity-remote-readonly.mjs
```

Usa os mesmos quatro GETs do script de identidade/Rules QA já
aprovado; autenticação Firebase CLI **já existente**, alvo
`atrio-catolico-qa-geral` e pacote
`br.com.atriocatolico.chatqa`. Compara o SHA-256 das Rules
remotas QA com o SHA-256 da variante integrada calculada localmente.
Se o remoto continuar em `deny-all`, relata que a candidata
**NÃO está publicada** e `ready_for_activation=false`.
Se o remoto sair de `deny-all`, falha fechado para investigação
— NÃO altera nem restaura o Firebase automaticamente.

**Limites:** comparação remota do QA não equivale a auditar
Rules de **produção**; hash Git de `firestore.rules` não é
comprovação da publicação em produção. Logs não devem conter
UIDs reais, e-mail, tokens ou conteúdo de denúncias. A CI executa
apenas mocks; o operador não recebeu instrução de executar
o comando imediatamente. É indispensável revisão humana,
aprovação do rollout e plano de reversão exato antes de
qualquer alteração remota.

**Status:** NO_GO, QA ativação 60% (3/5), QA geral 29% (2/7);
nada modificado em Firebase real, Cloudflare, produção ou backups.
