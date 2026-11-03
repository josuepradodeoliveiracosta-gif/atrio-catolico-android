# Átrio Católico — kit sem custo para testes fechados no Google Play

**Data de referência:** 03/11/2026 · **Trilha:** Teste fechado · **Estado:** preparação; não foi enviado nenhum app à Play Console.

## Objetivo

Deixar todos os insumos que **não dependem de pagar a conta do Google Play Console** organizados no GitHub, para reduzir retrabalho quando o proprietário puder pagar a inscrição. A inscrição no Play Console exige **taxa única de US$ 25**, segundo o suporte oficial. Não existe um método autorizado para obter a faixa de teste fechado da **Google Play** sem conta de desenvolvedor. Não inserir dados pessoais ou de pagamento em issues, commits ou screenshots públicas.

### Identificação da candidata (verificar novamente antes de assinar)
- Nome: **Átrio Católico**
- Application ID: `br.com.atriocatolico`
- Versão candidata: **0.20.2**, `versionCode=37`
- Target/compile SDK: **36**
- Fonte da candidata: PR #71, `feature/play-closed-testing-aab-20261031`, **rascunho, não mesclada**.
- Canal desejado: **Teste fechado**, apenas para pessoas convidadas. Não é lançamento público, nem faixa de teste interno.
- Workflow de assinatura: `.github/workflows/play-signed-aab-manual.yml`, **manual, restrito à main e com gates**. Ele não publica automaticamente.

## Entregas já preparadas no repositório

Arquivos em formato de metadados pt-BR, prontos para **copiar e revisar**, e compatíveis com a estrutura de metadados do Fastlane:
- `fastlane/metadata/android/pt-BR/title.txt` — nome.
- `fastlane/metadata/android/pt-BR/short_description.txt` — descrição curta.
- `fastlane/metadata/android/pt-BR/full_description.txt` — descrição completa.
- `fastlane/metadata/android/pt-BR/changelogs/37.txt` — nota da versão candidata.

Os textos respeitam os limites do Google (nome 30 caracteres, curta 80, completa 4.000 e notas de versão 500). **Não configuram um aplicativo na Play Console nem ativam distribuição automática.** Antes de utilizar, conferir se os recursos citados são efetivamente visíveis e estáveis na candidata assinada.

**Nova verificação sem custos:** `python3 scripts/play_listing_preflight.py` examina os quatro textos da loja, o `applicationId`, o `versionCode` do Gradle, caracteres de controle, limites, placeholders e promessas de exclusão não comprovadas. Mostra separadamente os totais ainda pendentes da privacidade e UGC. O teste automatizado `scripts/test_play_listing_preflight.py` roda na CI e o mesmo verificador é obrigatório antes da assinatura manual. Resultado `METADADOS_PLAY: OK` **não significa** que a Play autorizou uma publicação. O script não confere imagens, certificados, URL ou revisão jurídica. Alterações restritas a textos de metadados não precisam recompilar o aplicativo ou reiniciar emuladores.

A infraestrutura gratuita existente já tem código de página de suporte/exclusão e propostas de política e termos, mas **não há publicação HTTPS comprovada**, nem homologação da exclusão real e de UGC. A Cloudflare Pages `atrio-catolico-privacidade-qa` foi consultada e **não tinha deploy**; o domínio `-qa.pages.dev` é apenas para QA e não deve ser apresentado como URL de produção.

## Trabalhos que podemos concluir sem criar a conta Play

| Ordem | Entrega gratuita | Condição para considerar concluído |
| --- | --- | --- |
| 1 | Política pública e termos da comunidade | Texto revisado, contato verificável, HTTPS público, condizente com SDKs e práticas reais |
| 2 | Exclusão de contas | Fluxo no aplicativo + recurso Web público + processamento efetivo e verificável; não basta congelar a conta |
| 3 | Proteção de publicações de usuários | Termos e aceite, denúncias, bloqueio, moderação e Push respeitando bloqueios, verificados no backend real |
| 4 | Materiais gráficos | Ícone 512×512 PNG (com alfa), até 1024 KB; imagem de destaque 1024×500 JPG ou PNG 24 bits sem alfa; no mínimo 2 screenshots reais para celular |
| 5 | Informações para os formulários | Inventário de dados, permissões/SDKs, dados usados para autenticação, conteúdos, notificações e moderação; respostas finais só após auditoria |
| 6 | Pacote da candidata | Fonte consolidada e homologada, certificado de upload/app signing definido, AAB assinado e `versionCode` único; nenhuma chave privada no Git |
| 7 | Testes essenciais no Android | Cadastro, login, posts, respostas, perfil, denúncias, bloqueios, notificações, pedido e execução de exclusão, instalação/atualização |
| 8 | Testadores | Convite voluntário e lista privada com consentimento; endereços de e-mail e feedback NÃO entram no repositório público |

**Importante:** já há execução de muitos testes de integração em ambiente segregado. Isso não valida automaticamente segurança e exclusão nos serviços produtivos. Os documentos `docs/google-play-privacidade-evidencias.json` (**0/9 requisitos verificados**) e `docs/google-play-ugc-evidencias.json` (**0/6**) permanecem sem aprovação real, assim como `releaseAuthorized:false`.

## Material gráfico a fotografar no próprio Android

Capturas **reais** da variante destinada à Play, não ilustrações ou telas inventadas. Ordem sugerida: (1) entrada/comunidade, (2) lista de discussões, (3) tópico com respostas, (4) perfil, (5) denúncia/bloqueio, quando aprovados. Não mostrar telefone, CPF, e-mails, nomes reais, tokens, informação privada ou documentos de teste não autorizados. A Play exige screenshot legível entre 320 e 3840 pixels por lado, dentro das proporções permitidas; preferir 1080×1920.

Antes de enviar capturas, conferir direitos de uso de fotografias, imagens religiosas, marcas e textos. A página de destaque deve transmitir a identidade visual, sem prometer função que não esteja ativa na variante Play.

## Dados e declarações a auditar antes de preencher a Play Console

- **Dados pessoais/conta:** e-mail, identificador de usuário, nome e foto de perfil, conforme autenticação e perfil realmente usados.
- **Conteúdo gerado por usuários:** discussões, respostas, denúncias, bloqueios e histórico de moderação; atenção a eventual dado religioso/sensível fornecido voluntariamente.
- **Mensageria:** registros Firestore `users/{uid}/pushDevices`, tokens FCM, permissões e endpoints de entrega. Revisar tópicos legados.
- **Serviços externos:** Firebase Auth, Firestore, Cloudflare, Cloudinary e outros SDKs/serviços efetivamente presentes no AAB. Não afirmar ausência de compartilhamento sem auditoria.
- **Retenção e exclusão:** exceções legais, dados de terceiros, cópias/derivados, tokens e registros de auditoria. Confirmar exclusão real fim a fim.
- **Acesso para análise:** se login for obrigatório, preparar credenciais **fictícias e descartáveis** em canal privado da Play Console quando a conta existir. Nunca publicá-las no GitHub.

As respostas à seção **Segurança dos dados**, classificação indicativa, público-alvo e declarações de anúncios devem refletir o aplicativo e os serviços **reais**, não o comportamento dos emuladores. Não criar respostas afirmativas fictícias agora.

## Quando houver orçamento para a Play Console

1. Registrar conta de desenvolvedor pessoal, pagar a taxa, concluir identidade/contatos/verificações requeridas.
2. Criar **Átrio Católico** com o application ID correto; revisar a escolha inicial de tipo de app, disponibilidade, classificação indicativa, público-alvo, privacidade, Segurança dos dados e acesso para revisores.
3. Publicar política/URL de exclusão **funcionais**, adicionar materiais gráficos e os quatro textos já preparados.
4. Finalizar os gates verdadeiros, revisar/mesclar o código aprovado e executar o workflow manual de AAB **assinado** em `main`. Confirmar certificado, versão e assinatura antes de qualquer upload.
5. Abrir `Teste fechado`, cadastrar testadores por lista ou grupo, enviar o AAB e submeter a release para revisão da Google. Após aprovação, distribuir apenas o link oficial de adesão.
6. Para uma eventual fase pública posterior, contas pessoais elegíveis normalmente precisam de **12 testadores inscritos por 14 dias consecutivos** antes de pedir acesso à produção. Isso não impede iniciar o teste fechado assim que a configuração da Play Console estiver concluída.

**O custo da conta não é um motivo para desativar gates.** Não mudar a PR para pronta, não marcar evidências como aprovadas e não mexer em Workers/dados de produção sem testes e revisão.

## Alternativa gratuita distinta da Play

A documentação do **Android Developer Console** descreve uma modalidade gratuita de distribuição limitada para até **20 dispositivos** fora da Google Play. Isso **não é o teste fechado da Play Store**, não conta para a exigência de testadores da Play e tem regras de cadastro/verificação próprias. Vale apenas como alternativa facultativa para uma pequena prévia, se o proprietário quiser posteriormente.

## Fontes oficiais

- Cadastro e taxa: https://support.google.com/googleplay/android-developer/answer/6112435?hl=pt-BR
- Testes fechados: https://support.google.com/googleplay/android-developer/answer/14151465?hl=pt-BR
- Ficha e limites: https://support.google.com/googleplay/android-developer/answer/9859152?hl=pt-BR
- Imagens: https://support.google.com/googleplay/android-developer/answer/9866151
- Requisitos de exclusão: https://support.google.com/googleplay/android-developer/answer/10144311
- Publicação de uma release: https://support.google.com/googleplay/android-developer/answer/9859348
- Distribuição limitada distinta da Play: https://support.google.com/android-developer-console/answer/16640817?hl=en
