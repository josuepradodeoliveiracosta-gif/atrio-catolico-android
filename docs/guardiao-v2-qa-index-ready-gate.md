# Átrio Guardião V2 — índice de paginação para respostas: Firebase QA

**Escopo autorizado:** SOMENTE projeto `atrio-catolico-qa-v2`, banco `(default)`, índice simples `replies.createdAt` com `queryScope=COLLECTION_GROUP` e `order=DESCENDING`. Sem regras, documentos, moderação real, produção, Cloud Run, cobrança ou backup.

## Auditoria real (GitHub Actions #40974575245)

A consulta Google OIDC/WIF com conta `guardian-qa-reader` verificou:
- índice composto QA `posts (qaFixture ASC, createdAt DESC)`: **READY**;
- índice composto QA `replies (qaFixture ASC, createdAt DESC)`: **READY**;
- índice composto QA `reports (qaFixture ASC, createdAt DESC)`: **READY**;
- índice simples para `replies.createdAt COLLECTION_GROUP DESC`: **MISSING**.

A conta de leitura não tem `datastore.indexes.update`; corretamente **não foi ampliada**. O comando deve ser executado pela identidade pessoal autenticada no Google Cloud Shell **com permissão de administrar índices somente no QA**.

## Aplicação manual protegida (somente Google Cloud Shell)

Foi preparado `cloudflare/guardian-worker/scripts/apply-qa-replies-index.py`, sem dependências Python externas. O código:
- exige que o projeto selecionado no Cloud Shell seja exatamente `atrio-catolico-qa-v2`;
- verifica explicitamente `billingEnabled=false`; falha fechado se cobrança estiver ligada ou não puder ser consultada;
- usa token temporário de `gcloud auth print-access-token`, nunca o armazena no disco nem em logs;
- lê a configuração atual do campo e preserva os modos atuais antes de acrescentar o índice específico;
- usa REST `PATCH ...?updateMask=indexConfig` para alterar apenas esse campo do projeto QA, sem alterações de TTL ou índices de outras coleções;
- exige argumento `--apply` para qualquer alteração; por padrão só faz auditoria local.

**No Google Cloud Shell**, a partir de qualquer diretório:
```bash
gcloud config set project atrio-catolico-qa-v2
curl -fsSL "https://raw.githubusercontent.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/feature/guardiao-autonomo-20261029/cloudflare/guardian-worker/scripts/apply-qa-replies-index.py" -o /tmp/guardiao-qa-index.py
python3 /tmp/guardiao-qa-index.py
# Depois de revisar a mensagem de DRY RUN:
python3 /tmp/guardiao-qa-index.py --apply
```

Se o script disser `STOP`, **não ignorar o bloqueio**. A opção `--apply` não foi executada automaticamente pelo ChatGPT, pois o Google Cloud Shell do usuário não está conectado como ferramenta de escrita.

## Acompanhar criação

A operação de criação é assíncrona, não implica que o índice já esteja READY. Conferir manualmente:
```bash
gcloud firestore indexes fields list --project=atrio-catolico-qa-v2 --collection-group=replies --format=json
```

Ou repetir o job **Índices Firebase QA — auditoria WIF somente leitura** no GitHub Actions e confirmar `repliesCreatedAtGroup:"ready"`. Caso retorne `building`, o índice ainda não está pronto. Não instalar nenhuma nova versão do APK nem ligar a moderação real antes de observar READY e concluir os demais bloqueios.

### Custos e limites

O projeto precisa permanecer no Spark ou com faturamento desativado. Construir índices consome espaço dentro das quotas gratuitas do Firestore; o script não habilita conta de cobrança. Embora o código esteja preparado, **o índice só será criado após o usuário executar o comando no seu Cloud Shell**. Nada altera o Firebase oficial `atrio-catolico`, o Worker `atrio-push` ou os backups.

Referências: [Firestore single-field index definitions](https://firebase.google.com/docs/reference/firestore/indexes), [Field.patch REST API](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.collectionGroups.fields/patch), [Cloud Firestore Spark pricing](https://firebase.google.com/pricing).


## Auditoria de query real adicionada (29/10/2026)

- A auditoria foi repetida após o `--apply` manual no projeto QA. No segundo disparo, `repliesCreatedAtGroup=building`, enquanto os três índices compostos permaneceram `ready`.
- Adicionado `src/qa-query-probe.js`: **somente quando o índice reportar `ready`**, o CI executará uma única consulta real de `replies` no projeto `atrio-catolico-qa-v2` com a mesma ordenação `createdAt DESC, __name__ DESC` do scanner.
- Essa API Firestore é um **POST de leitura** (`documents:runQuery`), não um comando de escrita. A consulta limita a resposta a um documento e projeta somente `__name__`. Os logs exibem apenas `query_ok` ou `unavailable`, sem ID, texto ou dados de usuários.
- Se o índice ainda estiver em `building`, a consulta não ocorre. Se o índice estiver `ready` mas a consulta falhar, o CI **não** reportará aprovação e fechará com falha.
- Não há autorização para escanear dados reais ou aplicar punições. O scanner continua desativado no ambiente oficial.

Não repetir a criação do índice: reexecutar **somente a auditoria de leitura** até obter `repliesCreatedAtGroup=ready` e `guardian_qa_replies_query_probe: query_ok`.
