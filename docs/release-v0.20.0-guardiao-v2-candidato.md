# Átrio Católico 0.20.0 — Candidato de release com Guardião V2

Data da preparação: 31/10/2026. Base `main`: `79143b27008d5fb5c29fd3124cb6d37ead4cb554`.
Branch: `release/atrio-v0.20.0-guardian-v2-prep-20261031`.
A base inclui as mudanças da branch `feature/guardian-v2-nonpunitive-write-boundary-20261031`.

## Autorização do responsável

O responsável autorizou preparar a moderação autônoma completa do Guardião V2 e o release Android. A autorização cobre a preparação de recursos de alerta, classificação, fila de revisão, registros de auditoria, quarentena reversível, resolução administrativa e recurso dos usuários, respeitando política e permissões técnicas. **Autorização não equivale a implantação, nem comprova funcionalidades que ainda não existem.** As limitações da versão atual abaixo não devem ser anunciadas como prontas.

## Capacidades existentes no código

- Classificação de posts, respostas e denúncias; reconhecimento conservador de ameaças, fraude, dados pessoais e repetição.
- Criação transacional de caso, auditoria e aviso; deduplicação e pré-condição de versão do documento.
- Revisão e resolução humana, notificações privadas e recursos existentes no app.
- Quarentena reversível de respostas potencialmente fraudulentas, condicionada aos gates de retenção e à política Firestore.
- Chave de parada emergencial e permissões distintas para modo sombra, análise e retenção.
- Nova barreira de escrita não punitiva, que aceita apenas caso + auditoria + aviso + verificação do conteúdo, quando a decisão é `review` ou `warn`.

### Não prontas ou não homologadas

- Suspender/banir usuários automaticamente e excluir posts com subcoleções de respostas automaticamente **não estão implementados como autonomia segura**.
- O executor de observação da produção possui `roles/datastore.viewer`, não escrita; não elevar sua permissão.
- O Worker Cloudflare atualmente instalado é `atrio-guardian-v2-qa`, no modo de testes, e não um backend produtivo homologado.
- A integração administrativa no Android depende de `GUARDIAN_V2_WORKER_URL`, não fornecida no build existente; autenticação produtiva do Worker deve ser realizada sem chave JSON permanente.
- A escrita autônoma produtiva depende de identidade WIF distinta, orçamento transacional, revisão de IAM, regras Firestore efetivamente publicadas, monitoramento e rollback.
- A observação real passou em 31/10/2026 na execução manual #41169618367 com 0 documentos; isso não demonstra classificação de usuários nem ciclo agendado.

## Candidato Android

- `versionName = 0.20.0`; `versionCode = 35`, superior ao último debug `0.19.7` code 34 na base.
- `applicationId = br.com.atriocatolico` preservado.
- A assinatura existente permanece a mesma, obtida apenas dos secrets na compilação manual da `main`.
- O workflow `build-apk.yml` inclui `ATRIO_GUARDIAN_V2_WORKER_URL` e recusa assinar o APK V2 até que:
  - `vars.ATRIO_GUARDIAN_V2_RELEASE_APPROVED = true`, definido após implantação e revisão do backend;
  - `vars.ATRIO_GUARDIAN_V2_WORKER_URL` contenha a URL HTTPS de um Worker produtivo, sem identificadores QA/teste;
  - os secrets de assinatura anteriores estejam disponíveis.
- Ao concluir as condições, o acionamento manual na `main` produz o artefato `atrio-catolico-release-assinado`. O build não publica Play Store nem cria GitHub Release automaticamente.

## Ordem de implantação autorizada, mas pendente de pré-condições técnicas

1. Implementar a identidade produtiva de escrita WIF, distinta da conta de observação e vinculada a workflow exato, repositório, branch e ambiente.
2. Garantir controle atômico diário de uso/custo, limites de mutações, logs sanitizados e parada emergencial que falhe fechada. O IAM de servidor não é limitado pelas regras Firestore do APK.
3. Implantar e integrar backend de produção de forma que somente ações explicitamente permitidas sejam efetuadas, com trilha de auditoria e restauração.
4. Publicar as regras Firestore V2 de maneira coordenada, mantendo segurança de sessões, recursos e notificações.
5. Configurar as duas variables de release e executar build manual assinado na `main`.
6. Implantar progressivamente: orientação/triagem, retenção reversível apenas onde prevista, revisão e recursos. Não habilitar banimento/exclusão irreversível sem código, trilha de revisão e integração homologada.

## Garantias sobre este trabalho

O usuário pediu anteriormente para não repetir testes. **Nenhum teste manual, suíte de CI, compilação, deploy, alteração IAM, publicação, mudança na Cloudflare ou Firebase foi disparado neste trabalho.** A branch da release é candidata, não APK concluído ou moderador ativo. `main` e backup permanecem preservados.
