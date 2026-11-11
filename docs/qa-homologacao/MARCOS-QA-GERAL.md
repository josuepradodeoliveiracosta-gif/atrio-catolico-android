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
