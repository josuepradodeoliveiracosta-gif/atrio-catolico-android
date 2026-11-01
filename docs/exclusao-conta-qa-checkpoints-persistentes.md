# Átrio Católico — checkpoints persistentes e concorrência (somente QA)

**31/10/2026 — Código de teste isolado, não habilitado na produção.**

Esta etapa continua a preparação da exclusão de conta para a Play Store, após as PRs #73 → #74 → #77 → #78 → #79 → #80 → #81. A issue #72 permanece bloqueadora.

## Implementação

O arquivo `tests/security/qa-deletion-sqlite-lease.mjs` introduz um **bloqueio exclusivo em SQLite em arquivo temporário**, com prazo de validade e número de geração para impedir que dois executores de teste registrem a mesma operação simultaneamente.

A operação de gravar um checkpoint utiliza uma transação SQLite `BEGIN IMMEDIATE`, conferindo, no mesmo banco e sob a mesma transação, o identificador do detentor, a geração e o prazo de validade do lease. Um executor deslocado ou com autorização expirada é impedido de registrar sucesso.

O executor `qa-deletion-executor.mjs` da PR #81 aceita opcionalmente essa camada de teste. Confere posse antes e após efeitos e antes de cada checkpoint. Acrescentei simulações de falha **antes** dos efeitos, além das interrupções **depois** dos efeitos já existentes. Nenhuma nova operação de remoção genérica ou endpoint de produção foi implementado.

## Novos testes

- Banco SQLite em um arquivo descartável de `os.tmpdir()`: fecha, reabre e recupera checkpoint já gravado.
- Segunda conexão simultânea recebe `qa_lease_busy` enquanto a primeira possui o lease.
- Lease expirado pode ser retomado; execução antiga perde direito de confirmar etapas, inclusive após tentar renovar ou liberar o token antigo.
- O *fencing* é confirmado pela mesma transação que escreve o checkpoint.
- No Firestore Emulator local (`127.0.0.1:8089` / projeto `demo-atrio-v11`), a execução com duas conexões SQLite não consegue duplicar a limpeza.
- O teste interrompe depois de limpar subcoleções fictícias e reabre o arquivo SQLite, retomando as fases restantes.
- Simulam-se erros antes de tocar nos documentos, na mídia Cloudinary **falsa** e no Firebase Auth **falso**, com retorno seguro.
- Registros de outro usuário, incluindo conteúdo e mídia de QA, são preservados.

## Restrições obrigatórias antes da produção

**Isso não é durabilidade de produção.** O SQLite fica na máquina efêmera do GitHub Actions, enquanto a aplicação real utiliza Firebase, Cloudflare e Cloudinary distribuídos. O lease com TTL não impede operações externas lentas de terminar após expirar: é indispensável desenhar controles de concorrência com fencing em cada serviço, revalidação após remoção e checkpoints duráveis e independentes do processo.

O bloqueio de novas escritas no executor atual é uma variável fictícia; não corresponde a regra de segurança que impeça novas escritas no aplicativo real. O executor conhece exclusivamente caminhos fixos da conta de testes `qa-delete-alice`; não varre todos os dados históricos.

Antes de disponibilizar a exclusão de conta aos usuários: projetar o backend real com autenticação e supervisão, retenções legais, cobertura integral, etapas idempotentes verificadas, checkpoints persistentes em infraestrutura confiável, proteção contra concorrência em todos os sistemas, revogação de tokens, autorização de acesso, URL pública HTTPS e política de privacidade.

A aplicação, a OTA, os backups, a assinatura e os serviços reais permanecem intocados. Nenhum APK/AAB foi publicado nem usuário real excluído.
