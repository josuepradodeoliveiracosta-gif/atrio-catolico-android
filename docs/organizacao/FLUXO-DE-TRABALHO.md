# Gestão do trabalho — Átrio Católico

## Etapas padronizadas

| Etapa | Requisito |
| --- | --- |
| **Planejado** | Objetivo, escopo e critérios de aceite registrados |
| **Em desenvolvimento** | Branch, Issue e commits relacionados |
| **Em homologação** | CI e testes negativos no ambiente correto |
| **Integrado** | Merge comprovado na `main`, SHA exato |
| **Publicado** | Release/deploy e funcionamento verificados |
| **Bloqueado** | Dependência ou autorização pendente descrita |

Essas etapas são **convenções de trabalho** e não representam um GitHub Project já criado.

## Modelo de cada tarefa

```text
Módulo / objetivo:
Estado:
Issue / PR / SHA:
Ambiente de teste:
Escopo e não escopo:
Riscos, custo e dependências:
Critérios de aceite:
Resultados e evidências:
Pendências e aprovação necessária:
```

Os modelos [técnico](../../.github/ISSUE_TEMPLATE/tarefa-tecnica.md) e [de design](../../.github/ISSUE_TEMPLATE/proposta-design.md) facilitam criar Issues diretamente pelo Android.

## Regras de trabalho

1. Não mesclar reestruturação documental com mudança no motor de exclusão ou em Workers oficiais.
2. Separar conclusão de teste, integração, publicação e instalação no aparelho.
3. Revisar `main` antes de começar e antes de mesclar PR.
4. Uma PR por responsabilidade, evitando modificar caminhos de execução sem controle.
5. Proteger código de produção, dados pessoais, backup e credenciais.
6. Não inventar quadro GitHub Projects ou URL; se necessário, configurar Project através de ferramenta com acesso explícito ao recurso.

[Índice](../INDEX.md).
