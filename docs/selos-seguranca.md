# Selos da comunidade — operação segura (V2)

> **Estado:** implementação no código do app e nas regras versionadas. **Não significa regras publicadas no Firebase de produção.** A leitura da versão publicada e a autorização para implantá-la são passos separados.

## Modelo atual

- `badges/{uid}`: identificação pública, acessível individualmente por usuários autenticados (listagem negada).
  - `lay`: `leigo` ou `leiga`, autodeclarado e editável pelo titular.
  - `clergy`: `padre`, `diacono`, `religioso` ou `religiosa`; **somente após revisão administrativa**.
  - `moderator`: booleano, selo visual conferido/revogado **somente pelo Fundador administrativo**.
- `badge_requests/{uid}`: pedido privado de verificação religiosa, acessível ao titular e à administração habilitada. Estados: `pending`, `approved`, `rejected`, `revoked`; `dismissed` legado.
- `badge_events/{eventId}`: registro administrativo de decisões, privado, somente criação, sem atualização/exclusão pelo SDK cliente.
- `app_config/founder.uid` e `admins/{uid}.enabled`: autoridade real do Fundador. O selo visível **não concede** permissões administrativas.

Apenas `lay` é livre. Solicitar Padre, Diácono, Religioso ou Religiosa não concede status verificado. A escolha opcional no onboarding é somente autodeclaração.

## Fluxos administrativos

1. O membro solicita a verificação; ela aparece na fila como pendente.
2. O administrador autorizado confirma identidade e vínculo eclesial por canal independente.
3. Aprovar exige **batch atômico** que vincula o pedido `approved` ao `clergy` correto. Rejeitar altera o pedido com justificativa. Ambos geram evento de auditoria no mesmo batch pela interface.
4. Revogar exige mudança atômica do pedido `approved -> revoked` e remoção do campo `clergy`, acompanhada de justificativa e evento.
5. O membro pode pedir nova avaliação após rejeição ou revogação; selos antigos não são revogados automaticamente.
6. O Fundador autorizado administra o selo **visual** de Moderador sem conceder direitos de moderação via Firestore.

O uso do Firebase Admin SDK ou Console pode ignorar Firestore Rules. Por isso, não grave `badges` ou `badge_requests` isoladamente no Console: além da autorização administrativa adequada, esses procedimentos exigem consistência e auditoria.

## Antes de ativar no Firebase

1. Confirmar o SHA atual da `main`, preservar `applicationId`, assinatura e backup protegido, e verificar os testes de regras e compilação no GitHub.
2. No Termux com sessão Firebase CLI **já autenticada**, e código atualizado via `git pull --ff-only`, executar somente:
   ```bash
   node --test scripts/selos-v2-production-preflight.test.mjs
   node scripts/selos-v2-production-preflight.mjs
   ```
3. Interpretar o retorno: **0** = conteúdo das regras coincide; **2** = regras de produção divergem (auditoria humana necessária); **1** = consulta ou autenticação indisponível/inválida. Nenhum desses códigos é autorização de deploy.
4. Se houver divergências, detalhar as regiões e linhas exclusivas da produção com os scripts existentes, sempre em modo GET/read-only:
   ```bash
   node scripts/termux-firestore-rules-diff-readonly.mjs
   node scripts/termux-firestore-production-only-readonly.mjs
   ```
5. Revisar integralmente funções, regras exclusivas da produção, efeitos sobre cadastro, e-mail, Guardião, notificações, moderação e perfis. **Não sobrescrever regras de produção com o arquivo do repositório sem revisão e autorização explícita para esse conteúdo e projeto.**
6. Depois de possível publicação autorizada e conferência de hashes, validar o app em homologação com duas contas, incluindo verificação, rejeição, revogação, nova solicitação, perda de rede, perfil e discussões.
7. Somente então avaliar distribuição de APK/Release, seguindo política de assinatura, versionamento e OTA.

## Publicação controlada — revisão específica de 06/11/2026

A auditoria realizada pelo responsável confirmou que as regras publicadas da
produção correspondiam **exatamente** ao arquivo de regras do commit histórico
`9e36ea3f29f1c7bd9c03eaa0ee947b9be368b546`, com SHA-256:

```
ddf58ff4a5db0b559b1162418006c69763381a37612933a4bf1c5b96e7b0d8f1
```

As regras atuais dos Selos V2, que preservam a íntegra das regras fora da seção
de badges, correspondem ao SHA-256:

```
aa04c106e69287b7e7f513addf3dd4e9fc3ad246b69a7d20b2f38c5068c9899e
```

O novo `scripts/selos-v2-production-guarded-deploy.mjs` confere esses dois
fingerprints, verifica `firebase.json`, reconsulta a origem imediatamente
antes da operação e exige confirmação específica. Se qualquer referência
mudar, **não publica**. O padrão do script faz somente leitura:

```bash
node --test scripts/selos-v2-production-guarded-deploy.test.mjs
node scripts/selos-v2-production-guarded-deploy.mjs
```

A saída `READ_ONLY_PREVIEW` **não concede autorização de publicar**.
Somente após autorização expressa do responsável, a execução com os dois
argumentos `--apply` e `--confirm=atrio-catolico:selos-v2` poderá iniciar
`firebase deploy --only firestore:rules --project atrio-catolico`. Se a CLI
falhar, reconsulte o Firebase antes de qualquer nova tentativa: é possível
que a publicação tenha ocorrido mesmo sem confirmação local.

Essa preparação não altera regras em produção nem preserva backups do Firebase
automaticamente: o backup protegido preexistente permanece intocado.

## Limites de segurança

- O auditor usa apenas HTTPS GET ao Firebase Rules API, sem gravar documentos ou emitir comandos de deploy.
- Ele compara fingerprints SHA-256 e marcadores estruturais; **marcadores não provam sozinho que uma regra é segura**.
- Regras novas podem não conter todas as políticas operacionais ativas. Diferenças exigem inspeção humana; o auditor nunca aprova publicação.
- Não copie credenciais, tokens OAuth ou documentos de identificação para o GitHub, para o chat nem para logs.
- O script `scripts/termux-firestore-rules-guarded-deploy.mjs` está vinculado a hashes históricos de outra etapa. **Não usar como publicador dos Selos V2**, nem tentar contornar seus bloqueios.
- A criação de `badge_events` não reconstrói decisões anteriores e não substitui controles de acesso ao Console/Admin SDK.
- Nenhuma execução de testes deve usar contas ou documentos reais: o CI roda isoladamente.
