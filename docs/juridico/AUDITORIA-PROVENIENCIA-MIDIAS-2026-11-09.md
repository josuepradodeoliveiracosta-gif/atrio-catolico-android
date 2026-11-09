# Auditoria preliminar de procedência de mídias e identidade visual — Átrio Católico

**Data da análise:** 09/11/2026  
**Escopo:** fontes de evidência existentes no GitHub público para o vídeo de abertura, seu áudio, ícone, selo Fundador, emojis e outras mídias do aplicativo.  
**Custo externo:** R$ 0,00.  
**Classificação:** relatório técnico-documental; **não é parecer jurídico, laudo de originalidade, autorização de uso nem certificação de direitos autorais**.

## 1. Método e alcance

- Inspeção **somente de leitura** da árvore da `main` pelo endpoint de árvore recursiva do GitHub (`truncated=false`; **457 entradas**, entre arquivos e diretórios, na fotografia examinada), de arquivos de documentação, configurações, histórico de commits por caminho e descrições de PRs pertinentes.
- Não houve inspeção audiovisual direta do MP4, análise espectral da trilha ou identificação de obras, pessoas e marcas dentro da mídia. A API de conteúdo usada nesta auditoria não forneceu inspeção dos bytes binários.
- Documentos e PRs são **declarações de procedência** e registros de ações técnicas; não são, por si, cessões de direitos, comprovações de autorização de terceiros ou registros oficiais.
- O inventário complementar de bibliotecas e dados consta em [INVENTARIO-LICENCAS-TERCEIROS-2026-11-09.md](INVENTARIO-LICENCAS-TERCEIROS-2026-11-09.md).

## 2. Matriz de evidências e pendências

| Ativo | Evidência GitHub verificável | O que foi possível constatar | O que **não** foi comprovado |
| --- | --- | --- | --- |
| Vídeo de abertura `app/src/main/res/raw/abertura_atrio.mp4` | [PR #116](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/116), [PR #118](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/118), [documentação de QA](../qa-homologacao/ABERTURA-VIDEO-INICIAL.md) e [commit de substituição](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/commit/34b1141a873a1749d8eb69e190369c3da2bde30a) | Arquivo integrado, versão otimizada e metadados de integridade registrados; as PRs declaram que o arquivo de origem foi fornecido em conversa | Se o vídeo foi integralmente criado pelo responsável, se utiliza trechos de terceiros ou se há permissões para exibição/distribuição |
| Áudio/trilha do mesmo MP4 | [PR #118](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/118) relata trilha AAC preservada; [PR #119](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/119) habilita reprodução sonora | O áudio existente no MP4 pode ser reproduzido pelo app; nenhuma faixa autônoma foi identificada entre os recursos de mídia versionados | Autoria da composição, fonograma, voz, interpretação, licenças de bibliotecas de áudio ou autorizações necessárias |
| Ícone do aplicativo `app/src/main/res/drawable/ic_atrio.xml` | [Primeiro commit do caminho em 25/10/2026](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/commit/91b178e4cc3032d7d574c14a9d4e825135cfde2f) e [arquivo vetorial](../../app/src/main/res/drawable/ic_atrio.xml) | Ícone local formado por desenho vetorial geométrico com cruz em XML | Quem desenhou o elemento, se deriva de outra marca/arte ou se existe autorização de uso de eventuais referências |
| Selo Fundador `app/src/main/res/raw/selo_fundador_base64.txt` | [Commit de inclusão em 25/10/2026](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/commit/13a97e6bff16b81c9f4c6b29db17ea17bf1d0f29), [documentação do selo](../selo-fundador-arte.md) e [exibição](../../app/src/main/java/br/com/atriocatolico/FounderBadgeArt.kt) | Arte WebP codificada em Base64, incorporada ao APK; a documentação declara arte gerada e aprovada em conversa | Condições de geração e uso aplicáveis, eventual composição com obras alheias ou exclusividade jurídica sobre elementos gerados |
| Emojis/descrições | [proveniência Unicode 17/CLDR](../../tools/emoji/provenance.json), [licença Unicode v3](../../app/src/main/assets/UNICODE-LICENSE.txt), [leitura de catálogo](../../app/src/main/java/br/com/atriocatolico/ReactionEmojiData.kt) | Origem dos dados e hashes são declarados, licença versionada; glifos de emojis exibidos por fonte nativa do Android | Conformidade de cada meio de redistribuição, incluindo avisos efetivamente entregues ao usuário |
| Outras artes/mídias de usuários | Documentação de [avatares e fotos](../cloudinary-fotos-0197.md) e área `cloudflare/avatar-worker/` | A aplicação prevê imagens de perfis tratadas por serviços externos | Titularidade, consentimentos, permissões de publicação, direitos de imagem e gestão de denúncias de cada upload |

## 3. Histórico e integridade do vídeo

- O histórico do caminho registra vídeo de abertura desde [25/10/2026](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/commit/00cf5023edd7a7188fa135694f9bdaa3cb76b83a), troca pelo MP4 da [PR #116](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/116) e substituição pela versão atual na [PR #118](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/118) em 04/11/2026.
- **Versão atual do arquivo**, na fotografia examinada: **2.306.457 bytes**, Git blob SHA-1 `ed8c45f231e6729c258e084be0a2310f22ae609c`, de acordo com a árvore da `main`. A PR #118 documenta SHA-256 `75522c6bf7a8c6e7e0052964a450068e6febc0c8963412d610e0699e76dea22d`, resolução 1080 × 1920, duração 10,054 s e H.264/AAC.
- A PR #118 relata arquivo recebido de nome `1000088162.mp4`, recomprimido com perdas. O SHA-256 acima refere-se **à versão otimizada**, não ao original recebido; a documentação não prova a licença do conteúdo.
- A [PR #119](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/119) muda **apenas o volume do reprodutor**, sem mudar a trilha. Ativar o som não regulariza direitos sobre música, gravação ou outras obras eventualmente incorporadas.
- A existência de Git blob, hash e histórico fornece rastreabilidade **técnica**; não constitui declaração de domínio público nem autorização de exploração comercial.

## 4. Classificação dos riscos e ações

| Prioridade | Item | Ação gratuita recomendada |
| --- | --- | --- |
| **Alta** | Vídeo e trilha sonora | Conferir, **em arquivo privado**, quem produziu cada camada (imagem, edição, música, voz, interpretação, gravações) e guardar originais, licenças, termos e autorizações de terceiros, se aplicável; se as permissões de publicação estiverem incertas, não ampliar distribuição até esclarecer |
| **Média** | Selo Fundador | Preservar prompt/contexto criativo e arquivo-fonte original; conferir condições de uso do gerador e se foram inseridos materiais externos |
| **Média** | Ícone/identidade visual | Guardar rascunhos, arquivos-fonte e histórico de desenvolvimento; realizar busca de similaridade ou conflito de marca separadamente, sem afirmar exclusividade pelo GitHub |
| **Média** | Imagens de perfis e uploads | Revisar Termos de Uso, denúncia/remoção e tratamento de imagens/dados pessoais com atenção à LGPD e direitos de imagem |
| **Baixa** | Unicode/CLDR | Verificar se avisos de licença exigidos acompanham os dados em distribuições futuras |
| **Contínua** | Mídias novas | Registrar fonte, titular, licença, finalidade, comprovação de uso e hash **antes** de integrar em releases |

### Checklist privado de procedência (não preencher no repositório público)

Para cada mídia: título e finalidade; arquivo de origem; data de criação/obtenção; criador/titular; eventuais coautores; fontes de música, fontes gráficas, fotografia, voz e gravações; licença/contrato e sua versão; prova de consentimento e limites (aplicativo, redes sociais, comercial, território, prazo); comprovante de compra, se existente; SHA-256 do original e da versão publicada; local de guarda seguro; revisão jurídica quando necessária.

**Não enviar ao GitHub público:** CPF, assinaturas, contratos confidenciais, autorizações com dados pessoais, documentos de identidade ou fotos privadas usadas apenas como prova.

## 5. Resultado e limites desta etapa

- **Concluído:** rastreabilidade documental do vídeo, da alteração de som, do ícone, do selo e da origem declarada dos dados Unicode; pendências e prioridades formalizadas.
- **Não concluído:** comprovação de autoria/licenças de todo o conteúdo audiovisual, verificação dos arquivos-fonte privados e inspeção audiovisual direta; não declarar conformidade jurídica do vídeo nem exclusividade do logotipo.
- **Não realizado:** alterações em mídia, código, assinatura, versão, Firebase, Cloudflare, permissões, usuários, serviços externos, `LICENSE`, testes, workflow, backup ou publicação de APK.
- **Sem despesa:** nenhuma taxa, contratação ou registro foi solicitado.

Esta auditoria é um registro de evidências disponíveis no GitHub na data acima; **não é uma autorização para reutilizar materiais de terceiros**, nem substitui consulta profissional quando direitos forem contestados.
