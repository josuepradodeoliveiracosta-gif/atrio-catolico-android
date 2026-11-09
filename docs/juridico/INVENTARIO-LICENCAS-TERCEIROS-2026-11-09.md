# Inventário preliminar de licenças e materiais de terceiros — Átrio Católico

**Data da fotografia:** 09/11/2026  
**Base:** `main`, anterior a esta alteração documental.  
**Escopo:** manifesto Android, pacotes Node, requisitos Python, recursos versionados e origens documentadas.  
**Custo externo desta análise:** R$ 0,00.  
**Estado:** auditoria documental preliminar; **não constitui parecer jurídico, SBOM exaustiva ou certificação de conformidade**.

## 1. Regra fundamental

O arquivo [LICENSE](../../LICENSE) reserva os direitos sobre o conteúdo **original** do Átrio Católico e **não substitui** licenças de bibliotecas, ferramentas, dados, mídias e outros materiais de terceiros. O projeto pode ser proprietário e usar componentes de código aberto, mas precisa preservar os direitos e cumprir os avisos e condições aplicáveis. Não declarar que a distribuição de APK já está em conformidade até auditar a composição efetiva do artefato distribuído.

## 2. Dependências Android identificadas

Fonte: [app/build.gradle.kts](../../app/build.gradle.kts) e [build.gradle.kts](../../build.gradle.kts). As versões da plataforma/BOM **não equivalem** à lista resolvida de todos os artefatos.

| Componente/família | Referência direta observada | Licença/condição de referência | Pendência |
| --- | --- | --- | --- |
| AndroidX/Jetpack Compose | `androidx.core`, `work`, `activity-compose`, `compose.ui`, `foundation`, `material3`, `material-icons-extended`, BOM Compose | Projeto AndroidX geralmente Apache-2.0 ([fonte](https://github.com/androidx/androidx)) | Conferir POM/licenças e avisos de cada versão e dependência transitiva |
| Kotlin e plugins | `org.jetbrains.kotlin.android`, `org.jetbrains.kotlin.plugin.compose`, versão declarada 2.3.20 | Projeto Kotlin sob Apache-2.0 ([fonte](https://github.com/JetBrains/kotlin)) | Verificar componentes redistribuídos, exceções e licenças de terceiros incorporados |
| Firebase para Android | BOM `35.0.2`; `firebase-auth`, `firebase-firestore`, `firebase-messaging` | Há código-fonte Firebase Android sob Apache-2.0 ([fonte](https://github.com/firebase/firebase-android-sdk)); não presumir que todos os binários/serviços seguem a mesma licença | Conferir metadados de cada AAR/JAR efetivo e termos de uso de serviços |
| Google Play Services | `com.google.android.gms:play-services-base:18.11.1` e plugin Google Services 4.5.0 | Sujeito a condições próprias do SDK/serviços ([termos do Google para desenvolvedores mobile](https://developers.google.com/mobile/terms?hl=pt-br)) | Validar termos aplicáveis à versão, uso e redistribuição; **não classificar como Apache-2.0 por inferência** |
| JUnit 4 | `junit:junit:4.13.2` em `testImplementation` | EPL-1.0 na referência oficial do projeto ([fonte](https://github.com/junit-team/junit4)) | Manter separado de bibliotecas incluídas no APK de produção |
| Ferramentas Android e teste instrumentado | `com.android.application`, AndroidX test runner/core/ext, Compose UI test | Dependem das licenças de cada ferramenta/artefato | Inspecionar metadados resolvidos; diferenciar teste de produção |

**Não realizado:** `gradle dependencies`, SBOM do APK/AAB, inspeção da árvore Maven resolvida ou conferência de avisos no pacote de distribuição. Um BOM sozinho não identifica todas as versões transitivas.

## 3. Pacotes JavaScript / Node

Fontes: [tests/security/package.json](../../tests/security/package.json), [tests/security/package-lock.json](../../tests/security/package-lock.json) e os `package.json` de `cloudflare/avatar-worker`, `guardian-worker` e `push-worker`.

- **697 entradas de pacotes** no `package-lock.json` de testes, mais **1 entrada raiz** (total: 698).
- **559 nomes de pacote distintos** ao considerar entradas aninhadas; entradas duplicadas podem representar versões/instalações distintas.
- Dependências diretas de testes registradas: `@firebase/rules-unit-testing@4.0.1` (Apache-2.0 no lockfile), `firebase@11.10.0` (Apache-2.0 no lockfile) e `firebase-tools@13.35.1` (MIT no lockfile).
- Os três `package.json` de Workers examinados **não declaram dependências npm externas**. Isso não elimina dependências de serviços, APIs ou scripts de CI.

### Frequência das declarações de licença no lockfile

| Valor de `license` | Entradas |
| --- | ---: |
| MIT | 479 |
| Apache-2.0 | 107 |
| ISC | 61 |
| BSD-3-Clause | 24 |
| BlueOak-1.0.0 | 8 |
| BSD-2-Clause | 7 |
| Python-2.0 | 2 |
| (MIT OR CC0-1.0) | 2 |
| public domain | 1 |
| CC0-1.0 | 1 |
| (BSD-2-Clause OR MIT OR Apache-2.0) | 1 |
| 0BSD | 1 |
| BSD | 1 |
| Sem campo `license` | 3 |
| **Total** | **698** |

As três entradas sem `license` são: raiz do projeto (`packages[""]`), `fuzzy@0.1.3` e `valid-url@1.0.9`. A entrada raiz não é uma biblioteca externa. **Ausência de campo no lockfile não prova ausência de licença.**

- Para `fuzzy@0.1.3`, o [README no npm](https://www.npmjs.com/package/fuzzy) menciona MIT, embora a ficha npm possa aparecer como licença não declarada.
- Para `valid-url@1.0.9`, a [ficha npm](https://www.npmjs.com/package/valid-url) não declara licença; há [identificação externa de MIT](https://security.snyk.io/package/npm/valid-url), que **não substitui** conferir o texto do pacote distribuído.
- **Ação pendente:** consultar os artefatos npm exatos e suas licenças/avisos antes de distribuir código desses pacotes. O lockfile registra alegações de metadados, não atesta a integridade jurídica de cada licença.

**Separação importante:** estes pacotes pertencem ao ambiente Node de **testes/CLI**; a presença no lockfile não implica inclusão no APK Android. Uma análise de segurança de dependências é tarefa separada de licenciamento.

## 4. Python e infraestrutura

- [scripts/qa_official/requirements.txt](../../scripts/qa_official/requirements.txt) declara `uiautomator2==3.7.1` para QA; o [projeto upstream](https://github.com/openatx/uiautomator2) apresenta licença MIT. **Pendência:** conferir a distribuição específica 3.7.1 e suas dependências transitivas.
- O repositório usa GitHub Actions, Firebase e Cloudflare. Licenças de bibliotecas são diferentes de **termos de uso de serviço**; contratos/termos de plataformas também devem ser observados.
- Não foi executada instalação, download de pacotes, alteração de configurações nem acesso a produção.

## 5. Arquivos de mídia, ícones, fontes e dados

A árvore completa da `main` consultada via API GitHub tinha **457 caminhos** e `truncated=false` na fotografia auditada. Um inventário de arquivos versionados **não identifica** necessariamente todos os itens carregados dinamicamente.

| Ativo / local | Evidência | Situação jurídica documentada |
| --- | --- | --- |
| Emojis em `app/src/main/assets/reaction_emojis.tsv` | [Proveniência Unicode 17 / CLDR release-48 com hashes](../../tools/emoji/provenance.json); [gerador](../../tools/emoji/generate.py); [texto Unicode License v3](../../app/src/main/assets/UNICODE-LICENSE.txt) | Aviso já versionado; verificar manutenção dos avisos em distribuição e eventuais condições dos dados |
| Glifos/fonte de emoji | [ReactionEmojiData.kt](../../app/src/main/java/br/com/atriocatolico/ReactionEmojiData.kt) usa `Paint.hasGlyph` | Emojis exibidos pela fonte **do dispositivo**, sem fonte de emoji empacotada pelo seletor |
| Fontes próprias `.ttf` / `.otf` | Nenhum arquivo com tais extensões observado na árvore `main` | Não comprova ausência de fontes remotas, dinâmicas ou futuras |
| Ícone do app | [`res/drawable/ic_atrio.xml`](../../app/src/main/res/drawable/ic_atrio.xml), vetor local | Origem/titularidade gráfica não demonstrada só pelo XML; guardar arquivo/projeto-fonte original em local privado |
| Selo Fundador | `res/raw/selo_fundador_base64.txt` e [documento da arte](../selo-fundador-arte.md) | Documento informa arte gerada/aprovada em conversa; isso não substitui registro dos termos de uso, proveniência e autoria humana de elementos relevantes |
| Vídeo de abertura | `res/raw/abertura_atrio.mp4` e [documentação de substituição, hashes e áudio](../qa-homologacao/ABERTURA-VIDEO-INICIAL.md) | **Pendente prioritário:** confirmar autorizações relativas a imagem, música/trilha, interpretação, voz, arquivo-fonte e possíveis materiais de terceiros |
| Outros recursos gráficos | Componentes Compose, XML vetorial e textos Base64 na árvore versionada | Verificar se usam desenhos, logotipos, fontes ou imagens fornecidos por terceiros |

[Política Unicode](https://www.unicode.org/policies/licensing_policy.html): dados e software Unicode geralmente usam a licença Unicode v3, com ressalvas sobre outros materiais, como arquivos de fontes. **Não copiar glifos de tabelas/PDFs Unicode supondo que a licença do catálogo autoriza redistribuir fontes.**

## 6. Pendências priorizadas e próximos passos sem custo

1. **Alta — vídeo e áudio:** guardar, em pasta privada, fonte e permissões de uso do vídeo de abertura e da trilha, identificando criadores e materiais de terceiros. Não publicar dados pessoais ou contratos no repositório aberto.
2. **Alta — componentes efetivamente distribuídos:** quando houver ambiente de build, obter lista resolvida de dependências Release, gerar avisos aplicáveis e examinar os arquivos presentes no APK. Não afirmar conformidade do APK sem essa revisão.
3. **Média — bibliotecas npm sem metadados:** revisar os pacotes distribuídos de `fuzzy` e `valid-url`, registrando licenças e respectivos titulares; não declarar violação sem evidências.
4. **Média — identidade visual:** documentar a procedência de ícones, selos e artes, preservando arquivos originais e autorizações em local privado.
5. **Média — condições de serviços Google/Firebase/Cloudflare:** revisar requisitos contratuais e avisos aplicáveis à distribuição, sem ativar serviços novos.
6. **Rotina — atualização:** repetir o inventário quando houver novas dependências, imagens, vídeo, fonte, SDK ou publicação.

**Resultado desta etapa:** inventário documental com pendências explícitas, sem alteração de código, licença proprietária existente, mídia, dependências, assinatura, APK, ambientes, Firebase, Cloudflare, backups ou credenciais.

**Limite:** o conteúdo deste arquivo não constitui decisão jurídica definitiva, contrato de cessão, prova de que todas as licenças estão atendidas ou autorização para redistribuir material de terceiros.
