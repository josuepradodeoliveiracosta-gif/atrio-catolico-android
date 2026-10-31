# Átrio Católico — Etapa 4: download e instalador seguro (proposta)

Data de preparação: 31/10/2026.
Esta branch parte da Etapa 3 (PR #67), que depende das PRs #65 e #66.
**Nenhum release foi publicado, nenhuma instalação foi acionada e a main/backup não foram alterados por esta proposta.**

## Funcionalidade preparada

No aplicativo **release**, após detectar uma versão estável no repositório oficial:

1. Usuário entra em Perfil → Atualizações do Átrio e escolhe **Baixar atualização**.
2. O APK vem de `https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/releases/download/...`, com no máximo cinco redirecionamentos por HTTPS para domínios de assets do GitHub. Não são enviados dados de usuário ou tokens.
3. Download em pasta privada `cache/ota/`, com verificação de tamanho máximo, progresso visível e botão Cancelar. Um arquivo temporário nunca é exposto ao instalador.
4. No fim, valida SHA-256 do arquivo, pacote, `versionName`, `versionCode`, assinatura do APK declarada e igualdade com o **certificado do Átrio já instalado**.
5. Antes de instalar, refaz a validação do arquivo em cache para detectar alterações.
6. O botão **Instalar atualização** abre o instalador do Android através de `FileProvider`; se o aparelho não permitir instalar dessa fonte, abre a tela de autorização do sistema e pede retorno manual ao aplicativo.
7. O usuário confirma a instalação na interface do próprio Android. O Átrio não instala silenciosamente.

O Android faz a validação definitiva das assinaturas durante a instalação. A inspeção de certificados no arquivo não substitui essa verificação do sistema.
Não há pedido de acesso ao armazenamento externo: o único arquivo exposto via `FileProvider` é da subpasta privada de atualizações.

## Proteções

- Sem download automático, instalação em segundo plano, privilégios administrativos ou coleta de dados pessoais.
- **Debug** não oferece updates release, pois a assinatura pode ser diferente.
- Atualização somente quando `versionCode` cresce; APKs de outro pacote, outra assinatura, tamanhos discrepantes, arquivo alterado ou HTTP são rejeitados.
- Download falho ou cancelado não apaga dados do perfil nem altera o APK já instalado.
- O controle de versão e assinatura é local, usando o pacote instalado como referência confiável.
- A interface mantém mensagem clara quando conexão, disco, permissões ou validação não funcionam.
- A permissão `android.permission.REQUEST_INSTALL_PACKAGES` é necessária para esta distribuição fora de loja. Em eventual publicação na Google Play, revisar as políticas da loja antes de distribuir este instalador.

## Testes automatizados e não concluídos

- `app/src/test/java/br/com/atriocatolico/OtaApkPolicyTest.kt`: casos positivos e negativos de tamanho, hash, URL oficial, pacote, assinatura e versões.
- O workflow Android já existente executa `testDebugUnitTest` e compilação completa; não cria nova infraestrutura de CI.
- **Ainda falta** homologar o download e o fluxo de instalação em aparelhos reais com versões release assinadas pela mesma JKS, incluindo autorização de fontes desconhecidas, falta de espaço, cancelamento e retorno ao app.
- O teste de verificação do certificado do APK ocorre em tempo de execução no Android; os testes JVM exercitam a política pura, não assinam um APK de verdade.

## Ordem de ativação

1. Revisar e integrar #65, #66 e #67 em ordem; depois revisar esta proposta.
2. Proteger branch principal, tag `v*` e chave de assinatura permanente, sem modificar backups.
3. Validar APK real e certificado conhecido, aprovar a distribuição pelo GitHub Releases, sem reaproveitar artefatos expirados.
4. Incrementar `versionCode` na **nova versão release efetivamente distribuída**, mantendo a assinatura permanente.
5. Instalar essa versão uma vez nos aparelhos dos participantes e validar que detecta, baixa e instala uma versão posterior sem desinstalação. Se o APK antigo for debug com outro certificado, documentar migração única e preservar dados locais antes de desinstalar.
6. Só então liberar o canal ao público; manter o usuário responsável por confirmar instalações.

**Atenção:** este código ainda não disponibiliza um APK novo. O Android não permite garantir instalação silenciosa ou sem consentimento.
