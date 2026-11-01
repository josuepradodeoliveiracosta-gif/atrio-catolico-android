# Exclusão de conta — ensaio destrutivo APENAS no Firestore Emulator

**Documento de QA, 31/10/2026. Nenhum usuário de produção foi afetado.**

Esta proposta complementa as PRs #73 → #74 → #77 → #78 → #79 → #80, que permanecem em revisão. Não libera exclusão de conta real, não satisfaz sozinha as exigências da Google Play e não modifica a infraestrutura OTA.

## O que é efetivamente testado

O arquivo `tests/security/qa-deletion-executor.mjs` executa a **remoção verdadeira de documentos fictícios no Firestore Emulator** e simula a exclusão de mídia e Firebase Auth por meio de conjuntos de dados em memória. O ensaio é restrito ao projeto `demo-atrio-v11`, servidor local `127.0.0.1:8089` e a um UID de fixture fixo: `qa-delete-alice`.

O executor exige que o pedido `account_deletion_requests/qa-delete-alice` exista com status `requested`, uma aprovação de teste explícita e que não haja variáveis de credenciais administrativas reais. Não aceita uma lista de documentos, URLs ou IDs de conta provenientes do usuário.

O processo aplica os passos na seguinte ordem:

1. Simular bloqueio de novas escritas (flag exclusiva do teste).
2. Remover registros privados das subcoleções da conta fictícia.
3. Remover somente referências fictícias previamente enumeradas, mantendo a publicação, a resposta e a notificação da conta `qa-delete-bob`.
4. Remover imagem fictícia de um `Set` em memória, sem conexão Cloudinary.
5. Remover documentos raiz da conta fictícia no Firestore Emulator.
6. Verificar que os caminhos de fixture desapareceram **antes** de mexer na identidade.
7. Remover a identidade fictícia no `Set` de autenticação; **não** chamar o Firebase Auth real.
8. Verificar novamente os caminhos e marcar conclusão do *ensaio*, não de uma solicitação real.

O progresso é registrado em uma base `SQLite :memory:` temporária. Interrupções depois dos efeitos de cada fase, antes do checkpoint, são simuladas; uma nova instância do executor retoma de maneira idempotente, incluindo a etapa que simula a remoção da identidade. Uma alteração inesperada em fase já marcada como completa causa erro. Os registros do segundo usuário e o relatório de moderação são preservados nos testes.

## Limitações de segurança — obrigatórias

- **Não é executor de produção.** O código está exclusivamente em `tests/security/`, não nos Workers nem no aplicativo.
- Os documentos removidos são **fixtures de teste**; os caminhos aceitos são literais e fixos. Não existe exclusão genérica de conteúdos de qualquer UID.
- A trava de escritas é apenas uma variável de QA, não é efetiva em um banco real.
- A base SQLite de checkpoints é efêmera, não fornece durabilidade entre processos, múltiplos Workers, quedas ou concorrência.
- O processo só verifica os documentos de fixture; não descobre todas as coleções antigas, reações ou referências dinâmicas.
- Cloudinary e Auth são simulados. Os recursos reais, o Cloudflare D1 e os próprios dados reais do Firestore não são acessados.
- **O resultado do teste é `qa_fixture_cleaned_only` e traz `productionReady:false` e `publicAccountDeleted:false`.**
- Não instalar credenciais reais neste job ou adicionar variáveis que contornem o guard do emulador.

## Próxima implementação necessária

Projetar um processador administrativo **distinto** com credenciais mínimas e IAM, autenticação/reautenticação, aprovação operacional, cobertura completa das coleções/subcoleções, decisões de retenção, bloqueio de escritas real, checkpoint durável e serialização concorrente, limpeza segura do Cloudinary/D1/FCM/Auth com reconsultas de confirmação, auditoria sem PII e testes de recuperação entre sistemas. Somente depois homologar o portal HTTPS público e publicar a política de privacidade.

### Execução sem custo de serviços externos

O GitHub Actions reutiliza o job do Firestore Emulator já existente:

```bash
cd tests/security
npx firebase emulators:exec --only firestore --project demo-atrio-v11 \
  "node relational-inventory-emulator.test.mjs && node --experimental-sqlite qa-deletion-emulator.test.mjs"
```

O ensaio é intencionalmente destrutivo **apenas para seus registros falsos e descartáveis**, e as restrições devem permanecer intactas.
