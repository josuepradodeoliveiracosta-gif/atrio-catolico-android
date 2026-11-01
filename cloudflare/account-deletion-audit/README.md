# Worker de auditoria para exclusão de conta — somente leitura

**Código de preparação, NÃO implantado nem habilitado.** O Worker não apaga contas. Ele pode ser usado futuramente por uma equipe autorizada para conferir um pedido antes de aprovar um processador administrativo separado.

- `GET /health`: informa que não há exclusões habilitadas.
- `POST /admin/audit`: requer `ACCOUNT_DELETION_AUDIT_ENABLED=true` e token de alta entropia como secret `ACCOUNT_DELETION_AUDIT_SECRET`.
- O corpo só aceita `{"uid":"<UID validado>"}`. O usuário não pode fornecer projeto, coleção ou ação de exclusão.
- Depois de autorizado, lê `account_deletion_requests/{uid}` **somente** pelo Firestore REST com identidade de serviço separada e **papel somente-leitura**. Não retorna dados pessoais, apenas presença e um inventário de categorias.
- Nenhuma função de escrita, `DELETE`, Cloudinary, Firebase Auth delete ou rota de execução foi implementada. Falhas de IAM, rede ou credenciais devolvem 503, sem dados.

Configuração está em `wrangler.example.toml` **sem segredos**. Não criar deploy, domínio ou cron automático. Para auditoria futura exigir Cloudflare Access adicional e revisão de logs/limites; a flag false é o padrão.

Testes offline: `node --test cloudflare/account-deletion-audit/src/*.test.js` na raiz do repositório.

**Próxima revisão obrigatória:** executor idempotente com fluxo de retenção e reautenticação, isolamento de contas, limpeza de subcoleções, imagens e referências. A inclusão de um executor não deverá ser implementada por troca automática da flag de auditoria.
