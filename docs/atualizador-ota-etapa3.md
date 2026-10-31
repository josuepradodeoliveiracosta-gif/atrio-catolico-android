# Átrio Católico — Atualizador OTA, Etapa 3: detector (sem instalação)

Data: 31/10/2026. Branch de preparação sobre as alterações da Etapa 2 (PR #66), que depende da Etapa 1 (PR #65). Este documento **não** afirma que as PRs já foram integradas ou que os usuários receberam atualização.

## Comportamento implementado nesta proposta

- Quando a comunidade autenticada abre, a versão **release** consulta uma vez a API pública do repositório oficial:
  `https://api.github.com/repos/josuepradodeoliveiracosta-gif/atrio-catolico-android/releases/latest`.
- Se não existir release estável, a API retorna 404; o aplicativo continua funcionando e o painel mostra que ainda não há atualização publicada.
- Se houver release, exige dois assets exatos: `update.json` e `atrio-catolico.apk`, cada um com URL própria dentro do mesmo tag do GitHub.
- Obtém o manifesto por HTTPS; os redirecionamentos só podem ir para hosts de distribuição conhecidos do próprio GitHub, sem HTTP.
- Confere canal stable, esquema conhecido, pacote `br.com.atriocatolico`, `versionCode` maior, versão/tag/URLs coerentes, tamanho e SHA-256 formatados, SDK mínimo e **certificado SHA-256 declarado compatível com o certificado do APK instalado**.
- O manifesto é **metadado não confiável por si só**. Em futura implementação de instalação, o APK baixado também deverá ter seu hash verificado e sua assinatura real conferida pelo Android.
- Em builds **debug**, o detector não consulta GitHub e exibe orientação de que é uma versão de testes. Isso evita oferecer uma atualização release incompatível com a chave debug.
- Ao encontrar atualização válida, mostra mensagem discreta com ação para abrir a tela Perfil; a seção **Atualizações do Átrio** exibe versão, resumo das novidades e botão de verificação manual.
- Falha de rede ou manifesto inválido nunca impede o uso normal do Átrio e não mostra texto bruto da exceção.
- Não usa Firebase, Cloudflare ou chaves de usuário para consultar GitHub. Não adiciona permissão de instalação, não baixa APK nem executa ações em segundo plano.

## Revisão de custo, privacidade e limites

- Uma consulta automática por abertura da tela da comunidade (somente release) e consultas manuais quando o usuário pedir. Não instala polling contínuo ou nova infraestrutura paga.
- HTTPS, timeouts, redirecionamentos limitados, tamanho máximo de resposta e nenhuma credencial enviada ao GitHub.
- GitHub tem limites para chamadas anônimas e o usuário poderá ver mensagem de indisponibilidade quando houver rate limiting, queda de rede ou mudança no serviço; o aplicativo continua funcional.
- A detecção neste passo não oferece botão de instalação ou download: essa é a Etapa 4.

## Validação automatizada

Os testes JUnit em `app/src/test/java/br/com/atriocatolico/OtaUpdatePolicyTest.kt` cobrem aumento de `versionCode`, assinatura incompatível, links fora do GitHub oficial, releases draft/prerelease, pacote incorreto, Android desatualizado, manifesto inválido e ausência de atualizações obrigatórias.
A CI existente `selos-ci.yml` já executa `gradle :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest`, sem necessidade de adicionar outro job custoso.

Não houve teste de rede real no aparelho nesta proposta: ele exige integração das PRs e uma publicação válida e aprovada no GitHub Releases.

## Ordem de integração segura

1. Revisar/mesclar PR #65 (Etapa 1).
2. Revisar/mesclar PR #66 (Etapa 2), sem executar o modo `publish` até concluir o QA.
3. Revisar esta PR de Etapa 3; validar testes JVM e compilação Android.
4. Testar no aparelho sem release (mensagem de canal vazio), com manifesto inválido (falha fechada) e com release de teste autorizado, **sem divulgar atualização não homologada**.
5. Só depois avançar à Etapa 4 (download, verificação do arquivo APK e solicitação de instalação pelo Android).

**Atenção:** este patch não aumenta a versão `0.20.0 / code 35` nem muda o certificado de assinatura. A numeração deverá ser incrementada na futura release aprovada que de fato distribuir o detector.
