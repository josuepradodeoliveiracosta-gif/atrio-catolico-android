# Perfil 2.0 — preparação Android QA isolada

**Agente 2 · 14/11/2026 · Issue #105 · PR filha da #296 · sem deploy.**

## Referências e contexto

- PR #291: histórico paginado; PR #294: contratos Firebase Emulator;
  PR #296: Rules QA somente offline, **não publicadas**.
- Firebase alvo: atrio-catolico-qa-perfil/(default);
  índice posts(uid ASCENDING, createdAt DESCENDING) confirmado READY
  pelo fundador via Termux, registrado na Issue #105.
- Registro Android criado no projeto QA:
  br.com.atriocatolico.perfilqa,
  Firebase App ID 1:492511505084:android:17949b85935e25aedb7eb9.
- PR #193 (Conversas) também altera app/build.gradle.kts e possui
  variante chatQa; Agente 7 precisa reconciliar ambos os deltas.
- Produção atrio-catolico, QA Geral e Guardião V2 não são destinos.

## Implementado sem conectar Firebase remoto

1. BuildType perfilQa, applicationIdSuffix .perfilqa, assinatura debug e
   relays PUSH/GUARDIAN_V2/AVATAR vazios, sem substituir APK oficial.
2. Desativado por padrão: opt-in ATRIO_PERFIL_QA_BUILD=1,
   exclusivamente via tarefa Gradle :app:assemblePerfilQa.
   Endpoints/assinaturas de produção, OTA, preview e Chat QA bloqueados.
3. Configuração QA exclusiva obrigatória:
   app/src/perfilQa/google-services.json. O arquivo é ignorado pelo Git;
   ausência causa erro antes do build, sem fallback permitido.
4. Gate Python local exige SHA-256 aprovado, project ID, sender,
   Firebase App ID e pacote exatos; rejeita JSON duplicado, referências
   ao projeto oficial, configuração alterada e arquivo symlink.
5. Testes Python de configurações sintéticas integrados ao workflow
   existente de Firestore/CI. Nenhum workflow novo ou serviço pago.

**Importante:** esta preparação não gera APK com Firebase real. Os
checks padrão compilam/debugam o aplicativo sem habilitar perfilQa.
O plugin Google Services e os recursos do APK Perfil QA ainda devem
ser comprovados dentro de um APK futuro pelo Agente 5.

## Instruções para etapa FUTURA, somente após revisão/autorização

Exemplo de obtenção de configuração Android pelo fundador em um clone
QA aprovado no Termux, **somente leitura remota**, sem substituir
app/google-services.json de produção:

~~~bash
# Conferir primeiro se ja existe. NAO sobrescrever sem inspecao.
mkdir -p app/src/perfilQa
firebase apps:sdkconfig ANDROID \
  1:492511505084:android:17949b85935e25aedb7eb9 \
  --project atrio-catolico-qa-perfil \
  --out app/src/perfilQa/google-services.json
~~~

Não enviar o JSON inteiro ao GitHub nem publicar chaves/tokens.
Para um build QA futuro formalmente aprovado:

~~~bash
export ATRIO_PERFIL_QA_CONFIG_SHA256="$(
  sha256sum app/src/perfilQa/google-services.json | awk '{print $1}'
)"
ATRIO_PERFIL_QA_BUILD=1 gradle :app:assemblePerfilQa --no-daemon
~~~

Esses comandos **não foram executados** pelo agente; o build exige
a configuração cliente real do Firebase QA e não foi validado em APK.
A CLI pode impedir sobrescrita de arquivo existente; preferir essa
proteção. As Security Rules reais do banco estão deny-all conforme o
editor do Console; a release precisa de verificação read-only do
Agente 4. Não publicar Rules da PR #296 sem autorização específica.

## Compatibilidade funcional a resolver antes de QA remota

A revisão estática do código em #296 identificou uma dependência além do
buildType: o cadastro atual em OnlineAtrioApp.kt escreve em
users/{uid}/private/account e community_consents/{uid}; o fluxo após
verificação também atualiza users/{uid}/private/account. A política
restritiva candidata #296 **nega** essas rotas, deliberadamente.
OnlineUserScreen ainda observa coleções administrativas, salvos,
notificações e respostas que também continuam bloqueadas.

**Impacto:** um APK Perfil QA corretamente configurado NÃO significa
homologação funcional integral do fluxo de cadastro ou das demais abas.
Não ampliar Rules automaticamente para dar acesso a esses caminhos.
Antes de testes remotos, Agentes 4, 5 e 7 deverão escolher um roteiro
mínimo seguro: QA de perfil/histórico com identidades e dados sintéticos
autorizados, ou uma tela/fluxo de QA limitado sem as operações proibidas.
Nenhuma conta ou documento foi criado nesta análise.

## Próximos responsáveis e gates

- **Agente 4:** auditar Rules efetivas no projeto QA e manter deny-all
  até aprovação separada da política QA e dos dados sintéticos.
- **Agente 5:** conferir CI no SHA exato, build futuro da variante,
  applicationId, Firebase App ID, projeto, certificado, versionCode e
  hash do APK; depois QA físico e acessibilidade sob autorização.
- **Agente 7:** revisar build.gradle.kts frente à PR #193 preservando
  chatQa, debug/release, OTA e assinatura; organizar sequência
  de dependências #291 → #294 → #296 → esta PR.
- **Fundador:** decidir autorizações futuras de configuração real,
  publicação de Rules, contas/dados fictícios, instalação de QA e merge.

**Sem deploy, backend remoto, contas, dados reais, backups, cobrança,
merge ou alteração de main.** A implantação do índice READY ocorreu
antes e foi executada exclusivamente no Termux do fundador.
