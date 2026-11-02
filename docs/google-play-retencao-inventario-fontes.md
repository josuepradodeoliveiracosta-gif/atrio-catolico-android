# Átrio Católico — revisão de retenção: Firestore, D1 e fornecedores

**02/11/2026 · PR #71 · QA e auditoria de fontes, SEM aprovação jurídica nem deploy.**

## Identidade e contato confirmados

- Controlador indicado como pessoa física: **Josué Prado de Oliveira Costa**.
- Endereço informado e testado: **atriocatolico.privacidade@gmail.com**.
- Pendências: prazos reais de retenção, hipóteses legais, proteção de menores,
  transferências internacionais, direitos de terceiros e executor de exclusão real.

## Registro automático de fontes

A biblioteca de QA localizada em
cloudflare/account-deletion-audit/src/qa-retention-source-registry.js
combina os contratos de escopo do Firestore, fontes externas e esquemas D1.

| Fonte auditada em código | Unidades | Situação |
| --- | ---: | --- |
| Escopos de dados Firestore Rules | 31 | Decisão pendente |
| Tabelas D1 de Avatar | 4 | Decisão pendente |
| Tabelas D1 de Push/Guardião | 3 | Decisão pendente |
| Fontes externas (Auth, Cloudinary, FCM) | 5 | Decisão pendente |
| **Total** | **43** | **0 aprovações jurídicas** |

Dois caminhos estruturais de Firestore Rules (contêiner e regra
universal de negação) não são registros de dados e não entram nas
43 unidades.

Os testes detectam a adição, remoção ou alteração de tabelas nos
arquivos cloudflare/avatar-worker/schema.sql e
cloudflare/push-worker/schema.sql e exigem atualização da cobertura
de privacidade. Nenhum teste acessa dados reais.

## Lacuna concreta: D1 usado pelo serviço Push

- **delivered** possui event_key e data. O identificador pode permitir
  correlação com pessoa e exige auditoria da forma como é produzido.
- **guardiao_ai_budget** tem event_key e dia. A hipótese de associação
  a identidade e a retenção precisam de exame.
- **push_delivery_stats** agrupa métricas por hora/tipo/resultado.
  Aparentemente agregado não significa comprovadamente anônimo.
- No D1 Avatar, **avatar_moderation** contém actor_uid, target_uid e
  motivo. Pode haver direitos de terceiros e retenção legal de denúncias.

Não presumir que apagar a conta no Firebase remova automaticamente
as referências guardadas nos dois D1 ou no Cloudinary.

## Decisões exigidas por fonte

1. Dados, finalidades e hipóteses legais por categoria, especialmente
   convicções religiosas, perfis públicos e registros de moderação.
2. Prazo de conservação, ponto de partida, exceções, descarte, backups
   e justificativa legal efetiva.
3. Procedimentos de remoção/anonimização, inclusive referências a
   terceiros, e confirmação de um pedido concluído.
4. Comparação com serviços atualmente implantados e bases legadas;
   esse registro é somente fotografia do código da PR.
5. Revisão de segurança, inventário paginado, exclusão idempotente e
   barreira efetiva contra novas escritas durante o processo.

Todas as linhas do novo registro são somente de revisão e preservam:
retentionPeriodDays = null; automaticDeletionAuthorized = false;
lawfulBasisReviewed = false; productionEvidenceUrl = null.

O resumo de QA mantém accountDeletionAuthorized = false e
playReleaseAuthorized = false, mesmo quando a CI passa.

## Execução dos testes

A suíte Node já existente em cloudflare/account-deletion-audit detecta
os novos testes automaticamente. Não cria outro workflow ou novo
serviço, não faz deploy e não altera backups, Firestore, Auth ou D1.

**Próximo critério real:** aprovar os prazos e bases legais de cada
fonte e homologar o processamento efetivo das solicitações de exclusão.
Os manifestos de evidências da Play permanecem sem aprovação.

## Ficha local de revisão para Termux (02/11/2026)

O novo script cloudflare/account-deletion-audit/src/qa-retention-worksheet.js
gera uma ficha JSON com 43 fontes e perguntas inicialmente vazias,
sem dados de usuários ou aprovações fictícias. Na branch da PR #71:

    pkg install nodejs-lts
    node cloudflare/account-deletion-audit/src/qa-retention-worksheet.js --template > "$HOME/atrio-retencao-revisao-privada.json"

O arquivo permanece fora do repositório, no diretório privado do Termux.
Não adicionar o documento a um commit, issue, chat público ou Play Console.

Cada fonte exige indicação de finalidade, base legal, avaliação de dados
sensíveis, gatilho e período de retenção, descarte ou anonimização,
impacto sobre terceiros, backups, evidências técnicas e jurídicas,
identificação de revisores distintos e data. O status aceita somente
'pending' e 'in_review'; não existe estado que libere exclusão.

Depois de uma revisão real e independente, conferir as informações
preenchidas localmente, sem enviar conteúdo do documento ao GitHub:

    node cloudflare/account-deletion-audit/src/qa-retention-worksheet.js --audit "$HOME/atrio-retencao-revisao-privada.json"

A inspeção retorna apenas contagens. Bloqueia inventário ausente ou
duplicado, alterações de escopo, URLs fora do padrão HTTPS sem parâmetros,
campos provisórios e revisão com data futura. Não contata as URLs nem
comprova que revisores são verdadeiros ou que a decisão jurídica procede.

Mesmo quando 43/43 linhas estiverem estruturalmente completas:
independentEvidenceVerified=false, legalRetentionApproved=false,
productionDeletionExecutorVerified=false e googlePlayReleaseAuthorized=false.
Preenchimento nunca autoriza assinar AAB, implantar executor ou apagar dados.

A suíte Node existente executa os testes de regressão da ficha;
não cria novo workflow nem recompila desnecessariamente o Android.
