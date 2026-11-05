# Homologação e evidências de qualidade

| Evidência | Demonstra | Não demonstra |
| --- | --- | --- |
| Teste unitário | Lógica local com entradas controladas | Provedor real ou deploy |
| Firebase Emulator | SDK/Firestore/Auth no emulador | Produção Firebase |
| Worker QA privado | Resposta no ambiente de homologação | Todas as rotas do Worker oficial |
| GitHub Actions `success` | Jobs passaram naquele commit | Integração, instalação ou Play |
| APK/AAB gerado | Build para SHA identificado | Assinatura, distribuição ou funcionamento |
| Deploy/release verificado | Versão de serviço/artefato identificada | Publicação universal ou testes em todos os aparelhos |

### Registro padrão

```text
Objetivo:
Issue, PR e commit SHA:
Ambiente e conta fictícia:
Risco / cenários negativos:
Workflow, job e resultado:
O que ficou comprovado:
O que ainda NÃO foi comprovado:
Dados de terceiros preservados:
Aprovação e próximo passo:
```

### Portões para liberação

1. Revisão de escopo e permissões.
2. Testes de negação, concorrência, erro de rede, retomada e idempotência.
3. Proteção de dados de terceiros, retenção e moderação.
4. Revisão de IAM e cobertura de todas as rotas privilegiadas.
5. Autorização separada para ambiente oficial.
6. Evidência externa de deploy e/ou Play Console.

**Importante:** a [PR #71](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/71) acumula provas de QA de exclusão de contas, mas isso não autoriza excluir usuários reais.

[Índice](../INDEX.md).
