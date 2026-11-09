# Auditoria preliminar de autoria e titularidade — Átrio Católico

**Data:** 09/11/2026  
**Custo externo desta etapa:** R$ 0,00  
**Escopo:** análise documental e amostragem de evidências no repositório público.  
**Estado:** preliminar, **não é certificação de propriedade intelectual nem parecer jurídico**.

## 1. Objeto examinado

- Repositório: [atrio-catolico-android](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android), branch `main`.
- Aplicativo Android com identificador `br.com.atriocatolico`, conforme [Gradle](../../app/build.gradle.kts).
- Áreas relevantes: `app/`, `cloudflare/`, `design/`, `docs/`, `scripts/` e `tests/`, conforme [mapa técnico](../arquitetura/MAPA-REPOSITORIO.md).
- Aviso de [licença proprietária](../../LICENSE), integrado por [PR #207](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/207), commit [a7e9b620](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/commit/a7e9b62000eb76ec097372ca956637482b9fe887).

## 2. Evidências verificadas

| Evidência | Constatação | Limite da conclusão |
| --- | --- | --- |
| Repositório público e controle de versão | Código, documentos e mudanças possuem histórico Git e URLs verificáveis | Publicação ou controle da conta não prova, isoladamente, autoria ou propriedade exclusiva |
| [Commit de licença](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/commit/a7e9b62000eb76ec097372ca956637482b9fe887) | O aviso de direitos foi integrado na `main` | A licença não transfere direitos de terceiros ao projeto |
| [Commit técnico anterior](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/commit/86f1f9dbf9b4cdda682f8a80111ea0ecc644bdb5) | Histórico técnico anterior ao aviso de licença | Um commit não basta para comprovar originalidade do arquivo |
| [Amostra de commit adicional](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/commit/7430caa101eb5a4ca06126f75be618a54490f420) | Autoria do commit associada à conta mantenedora do repositório | Identidade da conta, autor intelectual e titular jurídico são conceitos distintos |
| [Commits amostrados 4e5c723](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/commit/4e5c723985f92ff9ff60a710f137535ddd9fb78b) e [1842777](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/commit/18427774e6fcb3f3d79f1beab30a9107f6d0e5b5) | Metadados exibem a mesma conta como autora dos commits examinados | Não é uma inspeção exaustiva de todo o histórico, nem confirma a primeira criação do programa |
| [Gradle](../../app/build.gradle.kts) | Dependências declaradas de AndroidX/Jetpack, Firebase, Google Play Services e JUnit, além de Kotlin e ferramentas de build | Licenças diretas e transitivas, versões e avisos obrigatórios ainda precisam de inventário completo |
| [README](../../README.md) | Identifica a arquitetura e adverte sobre proteção de credenciais e backups | Não é um contrato de cessão ou de prestação de serviços |

**Conclusão da amostragem:** os cinco commits examinados estão associados à conta mantenedora. Isso é uma **evidência técnica de histórico**, não demonstra por si só titularidade integral nem ausência de colaboradores, contratos ou material pré-existente.

## 3. Verificações de titularidade ainda pendentes

1. **Identificar os titulares juridicamente:** o cabeçalho do `LICENSE` usa o nome do projeto. Confirmar em documentação **privada** o nome do titular dos direitos patrimoniais, sem publicar CPF, endereço, assinaturas ou dados pessoais.
2. **Examinar a origem do código e das artes:** distinguir criação original, geração assistida, adaptação de materiais externos, bibliotecas, imagens, ícones, fontes, textos e possíveis contribuições.
3. **Reunir acordos de colaboração:** se houver terceiros, conferir contratos de trabalho, prestação de serviços, cessão ou licenças efetivamente concedidas. Não pressupor cessão automática.
4. **Examinar contribuições anteriores:** verificar o histórico completo de commits e PRs, incluindo coautores, commits importados, branches antigas, arquivos removidos e proveniência de cada componente relevante.
5. **Inventariar licenças de dependências:** AndroidX/Compose, Firebase, Kotlin, JUnit, plugins Gradle, bibliotecas transitivas, pacotes Node/Cloudflare, fontes e imagens. Guardar os respectivos avisos quando exigidos.
6. **Documentar o uso do nome e símbolo:** arquivar provas de uso do nome/logo com data e contexto. Isso **não equivale** a registro de marca no INPI.
7. **Guardar provas originais:** conservar cópias intactas de repositório, releases, backups e registros originais em local sob controle do responsável, de preferência com hashes e informações de origem. Evitar publicar a prova que dependa de sigilo.

Nenhum contrato, identificação civil, autorização de colaboradores ou prova externa foi solicitado, presumido ou publicado nesta etapa.

## 4. Referência jurídica brasileira (orientação informativa)

- [Lei nº 9.609/1998, art. 2º, § 3º](https://www2.camara.leg.br/legin/fed/lei/1998/lei-9609-19-fevereiro-1998-364738-publicacaooriginal-1-pl.html): proteção do software independe de registro.
- [Lei nº 9.609/1998, art. 4º](https://www2.camara.leg.br/legin/fed/lei/1998/lei-9609-19-fevereiro-1998-364738-publicacaooriginal-1-pl.html): vínculos de trabalho/contratação podem afetar a titularidade; analisar o caso concreto.
- [Lei nº 9.610/1998, arts. 18 e 19](https://www2.camara.leg.br/legin/fed/lei/1998/lei-9610-19-fevereiro-1998-365399-normaatualizada-pl.html): proteção autoral independe de registro, sem afastar regras específicas de software.
- [INPI — guia de software](https://www.gov.br/inpi/pt-br/servicos/programas-de-computador/guia-basico): registro facultativo pode facilitar provas em disputa, mas não foi requerido.

**Limites:** ter um arquivo `LICENSE` ou histórico Git não assegura automaticamente propriedade exclusiva, registro de marca ou êxito judicial. Materiais de terceiros continuam regidos por suas condições. Não modificar retroativamente histórico nem apresentar uma declaração unilateral como prova conclusiva.

## 5. Próximas ações gratuitas e seguras

- Preservar esta auditoria como registro **datado**; qualquer atualização deve criar nova versão ou documentar a mudança.
- Criar inventário de terceiros e revisar obrigações de atribuição sem substituir suas licenças.
- Guardar localmente, fora do GitHub público, documentos privados de autoria, comunicações e acordos.
- Definir política de aceitação de contribuições e comprovantes de autorização **antes** de incorporar código de novas pessoas.
- Acompanhar a evolução do projeto por commits/PRs; nunca afirmar conclusão com base apenas em uma proposta não mesclada.

**Não executado:** registro pago, mudança de visibilidade, publicação de documentos pessoais, alteração de credenciais, Firebase, Cloudflare, APK, workflows ou branches de backup.
