# Release público do Átrio — modo de moderação humana

**Alternativa de lançamento; não é a homologação do motor autônomo Guardião V2.**

## Motivação

A instalação OTA privada A→B já foi comprovada fisicamente no Android. A política obrigatória de e-mail foi aprovada em testes reais e no Firestore produtivo. O código do Guardião V2 passou por ensaios offline, mas o gateway V2 autônomo ainda não foi homologado integralmente em produção. Tratar `ATRIO_GUARDIAN_V2_RELEASE_APPROVED=false` como se fosse `true` seria um registro falso.

O Átrio já oferece **denúncias de conteúdo e participantes, bloqueio de usuários, aceite de regras comunitárias e painel administrativo humano** (Firestore Rules e interface `ModerationScreen`). Isso possibilita preparar **uma edição pública com revisão humana** enquanto o motor V2 não está aprovado, desde que a administração se comprometa com atendimento efetivo das denúncias e das solicitações de usuários.

## Seleção segura do modo

A variável de repositório em GitHub **Actions → Variables** é `ATRIO_RELEASE_MODERATION_MODE`. Valor padrão implícito: `guardian_v2` (continua exigindo `ATRIO_GUARDIAN_V2_RELEASE_APPROVED=true` e URL oficial do Worker).

Somente uma decisão explícita de usar `ATRIO_RELEASE_MODERATION_MODE=human` libera a alternativa. Neste caso:

- No **APK Release normal**, o campo `BuildConfig.GUARDIAN_V2_WORKER_URL` é vazio. A ação humana V2 no gateway deixa de estar disponível no APK; **não** são desativadas as denúncias comuns, a tela de revisão do Firestore, os bloqueios pessoais ou a confirmação obrigatória de e-mail.
- O workflow **não** exige homologação falsa do V2. `ATRIO_GUARDIAN_V2_RELEASE_APPROVED` deve permanecer `false` até aprovação efetiva. Nunca fingir que o V2 está pronto.
- Um comprovante `release-moderation-mode.txt` é armazenado **junto ao APK assinado**, após a verificação do certificado permanente. A etapa de validação e o job de publicação rejeitam artifacts sem o arquivo ou com modo diferente do solicitado. **Nenhuma chave, senha ou dado pessoal é incluído no comprovante.**
- Modos desconhecidos são rejeitados. O modo humano não altera automaticamente a configuração do Worker Cloudflare, as Firestore Rules, nem um eventual cron separado. O estado remoto deve continuar sendo verificado de forma independente.

## Portões que NUNCA são dispensados

| Gate | Verificação |
| --- | --- |
| `ATRIO_OTA_E2E_TESTED` | Teste A→B privado real no Android, confirmado em 06/11/2026. Não interpretar como CDN público testado |
| `ATRIO_OTA_RELEASE_APPROVED` | Autorização expressa de distribuição do proprietário, registrada na issue #149 |
| `ATRIO_EMAIL_VERIFICATION_RELEASE_APPROVED` | Política ACTIVE, rules produtivas idênticas, 6/6 resultados reais com duas contas, UX Android aprovada |
| `ATRIO_RELEASE_MODERATION_MODE=human` | Decisão explícita de oferecer moderação humana em vez de V2 autônomo |
| Assinatura | Mesmo certificado permanente, hash SHA-256 independente, `applicationId` intacto e `versionCode` crescente |
| Publicação | Workflow manual `validate`, depois `publish` com confirmação `PUBLICAR ATRIO`; nenhum modo automático |

As variáveis de liberação estão inicialmente `false` e **só devem ser alteradas pelo responsável com base em evidências existentes**. O modo humano não dispensa as três aprovações anteriores. A publicação pela API/CDN do GitHub ainda exige primeiro criar uma Release acessível: o contrato HTTPS/ausência de Release já foi auditado, mas o CDN real não foi testado.

## Responsabilidades operacionais indispensáveis

- Manter uma pessoa responsável verificando regularmente **denúncias de publicações e participantes**; não assumir que sinalizações são removidas automaticamente.
- Responder a conteúdo ilegal, ameaçador, abusivo ou outras violações e manter um caminho de recurso. Testar com conta de QA que a equipe consegue visualizar e analisar a denúncia.
- Disponibilizar um contato de suporte, política de privacidade verídica e procedimento de exclusão de conta **efetivo**, não apenas um botão de solicitação. O trabalho de exclusão de dados e o bloqueio de notificações entre perfis ainda têm questões em aberto no repositório.
- Revisar os Workers produtivos separadamente. No modo humano, **o APK** não usa o gateway V2; isso não prova que algum processo externo de moderação esteja desligado.
- Definir uma alternativa de suspensão/retirada de novas instalações e aviso aos usuários se um problema crítico for identificado. Não desinstalar APKs existentes nem trocar a chave para corrigir falhas.
- Não publicar tokens de Firebase, segredo da chave, e-mails dos participantes ou capturas com dados pessoais nas issues públicas.

## Comportamento em CI e sequência

1. Integrar o código do modo humano somente se CI Android, Firestore, segurança e gates de assinatura/publicação estiverem verdes. Essa integração **não altera a configuração de produção por si só**.
2. Responsável decide e registra `ATRIO_RELEASE_MODERATION_MODE=human` em Actions Variables, sem marcar V2 como homologado.
3. Somente se as aprovações de OTA e e-mail já comprovadas estiverem registradas e após o compromisso operacional com a moderação, executar manualmente `build-apk.yml` na `main`. O artifact `atrio-catolico-release-assinado` conterá APK e comprovante de modo.
4. Extrair e verificar SHA-256 do APK, certificado, pacote e versão 0.20.3/code38. Usar modo `validate` do `ota-publish-release.yml` antes da publicação.
5. Publicar exclusivamente com confirmação expressa. Verificar download do canal público e o processo de atualização em aparelho físico; registrar resultado e eventuais limitações na [issue #149](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/149).

**Não assina ou publica por conta própria.** O novo modo oferece uma alternativa realista para organizar a aprovação, sem falsificar homologação do Guardião V2.
