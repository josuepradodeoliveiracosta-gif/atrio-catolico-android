# Firebase QA pelo Termux — roteiro seguro e sem produção

**Status verificado em capturas do responsável (08/11/2026):** o Firebase
`atrio-catolico-qa-geral` foi criado; aplicativo Android `chatQa` registrado,
configuração local copiada e verificada por SHA-256, Authentication por
e-mail/senha ativado e Firestore `(default)` em São Paulo criado com
regras de negação total implantadas. O Worker/D1 QA geral foram criados,
mas `atrio-qa-geral` está em modo bootstrap, com workers.dev e previews
desativados; a integração FCM e o APK real ainda não foram homologados.
**Não usar o projeto oficial `atrio-catolico`.**

O projeto QA-alvo é `atrio-catolico-qa-geral`, com Worker geral planejado
`atrio-qa-geral` e D1 `atrio-qa-geral-db`. O APK `chatQa` mantém
pacote próprio; `CONTA` é apenas um marcador até provisionar a URL real.

## 1. Preparar Termux (Android)

Em uma sessão nova do Termux, sem colar senhas nem tokens neste chat:

```sh
pkg update
pkg install -y nodejs-lts git python
node --version
npm --version
npm install -g firebase-tools
firebase --version
```

Se a instalação global falhar por permissões, **não usar sudo**. Corrigir o
prefixo npm do próprio Termux ou usar `npx firebase-tools` para as consultas.
O Firebase CLI pode exigir navegador externo e autenticação interativa.

## 2. Descoberta SOMENTE leitura

```sh
firebase login
firebase projects:list
```

Confira se já existe um projeto **exclusivo QA**, com ID contendo o segmento
`qa` (por exemplo, `atrio-catolico-qa-geral`; exemplo **não reservado**).
Não selecionar `atrio-catolico` nem presumir que o projeto QA existe.

Caso ainda não exista, **somente após decisão explícita do responsável**, criar
um novo projeto usando o Console Firebase ou, de forma interativa:

```sh
# SUBSTITUIR pelo ID QA escolhido e conferir antes de executar.
firebase projects:create atrio-catolico-qa-geral --display-name "Atrio Catolico QA Geral"
```

O comando acima **altera a nuvem** e está aqui apenas como instrução futura:
nenhuma automação deve executá-lo. A disponibilidade de projetos e cotas
depende da conta. Após criação, ativar Authentication por e-mail/senha,
Firestore e registrar um app Android **com pacote exato**
`br.com.atriocatolico.chatqa` no Console do projeto QA. Não importar
usuários, documentos, chaves de serviço ou regras da produção.

## 3. Conferir identidade sem expor credenciais

No Console do projeto QA, obter o arquivo de configuração Android
`google-services.json` **do app chatqa**, e guardá-lo somente em
`app/src/chatQa/google-services.json` no clone local da branch de QA.
**Não** substituir `app/google-services.json`, anexar o JSON ao chat,
registrá-lo em issue ou fazer commit. A chave de API contida no arquivo
não deve ser tratada como segredo de servidor, mas a configuração merece
proteção contra publicação e troca acidental.

Na raiz do clone, executar apenas o resumo sanitizado abaixo:

```sh
python3 - <<'PY'
import json, hashlib
from pathlib import Path
p=Path("app/src/chatQa/google-services.json")
if p.is_symlink() or not p.is_file() or p.stat().st_size>65536:
    raise SystemExit("FALHA: arquivo QA ausente, symlink ou tamanho invalido")
raw=p.read_bytes()
data=json.loads(raw)
info=data["project_info"]
clients=data["client"]
if not isinstance(clients,list) or len(clients)!=1:
    raise SystemExit("FALHA: esperado exatamente um app Android QA")
client=clients[0]["client_info"]
project=info["project_id"]
package=client["android_client_info"]["package_name"]
app_id=client["mobilesdk_app_id"]
if project!="atrio-catolico-qa-geral":
    raise SystemExit("FALHA: projeto nao identificado como QA")
if package!="br.com.atriocatolico.chatqa":
    raise SystemExit("FALHA: pacote Android nao e chatqa")
if str(info["project_number"])!=app_id.split(":")[1]:
    raise SystemExit("FALHA: Sender ID nao corresponde ao App ID")
print("Projeto QA:",project)
print("Pacote:",package)
print("App ID:",app_id)
print("SHA-256 do arquivo:",hashlib.sha256(raw).hexdigest())
print("PASSOU: verificacao local, NAO valida cloud, Auth, FCM ou APK")
PY
```

Esse resumo não imprime API key, conta de serviço, ID token ou FCM token.
O hash é **apenas** uma referência de integridade; ele não prova que o
projeto é de fato separado nem que o arquivo foi emitido pelo Google.

## 4. Conferir gates do build (sem publicar)

Quando o Worker QA real e **separado** já estiver aprovado e o endereço
`https://NOME-QA.CONTA.workers.dev` for conhecido, preencher manualmente
as variáveis abaixo **somente no terminal local**, usando os valores
conferidos do JSON QA e seu SHA-256. Não usar a URL de Worker oficial.

```sh
export ATRIO_CHAT_QA_PROJECT="atrio-catolico-qa-geral"
export ATRIO_CHAT_QA_APP_ID="1:NUMERO:android:HEX"
export ATRIO_CHAT_QA_WORKER_URL="https://atrio-qa-geral.CONTA.workers.dev"
export ATRIO_CHAT_QA_CONFIG_SHA256="SHA256_DE_64_CARACTERES"
python3 scripts/chat_qa_build_gate.py
```

O gate deve **falhar** se os valores ainda forem placeholders. Não desativar
o gate para fazer o build passar.

Quando a configuração QA real estiver aprovada, produzir **apenas um resumo
sanitizado** para auditoria, sem anexar o JSON original:

```sh
python3 scripts/chat_qa_build_gate.py --receipt > chat-qa-preflight.json
```

O arquivo `chat-qa-preflight.json` contém somente projeto, pacote, App ID,
Sender ID, URL de Worker QA e SHA-256 da configuração — nunca API key,
credencial privada, token ou texto de mensagens. Ele registra explicitamente
que o APK, os serviços na nuvem e a entrega FCM **ainda não foram verificados**.
Confira o arquivo antes de compartilhá-lo. Se o gate falhar, não use o
comprovante e não prossiga para publicação ou testes conectados. Para uma compilação futura exclusivamente
QA, usar `ATRIO_CHAT_QA_BUILD=1` e `:app:assembleChatQa`, após conferir
que variáveis gerais de Worker e assinatura de produção estão vazias.

## 5. Portões que continuam fechados

- Nenhuma ativação de push ou Worker QA sem projeto Auth/Firestore/FCM,
  conta de serviço e D1 exclusivos, auditados e autorizados.
- Nenhuma implantação de regras candidatas em Firestore de produção.
- Nenhuma afirmação de FCM real antes de testar dois aparelhos, inclusive
  segundo plano, aplicativo fechado, bloqueios e grupos.
- Política de menores, moderação e retenção (#200), matriz física (#199),
  regressões (#201) e autorização de lançamento continuam pendentes.
- Não colar `firebase login:ci`, refresh tokens, JSON de service account,
  `google-services.json` completo, FCM tokens nem credenciais em chats,
  GitHub Actions, comentários ou logs.

**Escopo:** este roteiro não altera `main`, APK Release, Firebase oficial,
Workers/D1 oficiais ou backups.

## 6. Auditoria das regras reais — somente leitura

Depois de atualizar o clone de QA com `git pull --ff-only`, execute
`node scripts/termux-firestore-qa-readonly.mjs` para conferir por
**duas consultas GET exclusivas ao projeto `atrio-catolico-qa-geral`**
que as regras publicadas continuam em negação total.
Não publique regras candidatas enquanto o plano de menores, moderação
e retenção da issue #200 estiver sem aprovação; o resultado
`firestoreRulesCurrentlyDenyAll: true` **não autoriza chat**.
Se o Firebase CLI mudar seus módulos privados de autenticação, o
script falhará de modo seguro, sem ler arquivos de tokens manualmente.

## 7. Preflight offline do APK QA sem URL de Cloudflare

Enquanto o Worker `atrio-qa-geral` nao tiver URL aprovada, somente a
compilacao da variante `chatQa` em laboratorio pode ocorrer com relay
vazio e flag offline explicita. O Firebase continua sendo o QA geral,
mas suas regras continuam deny-all, portanto conversas permanecem fechadas.

No clone Termux apos atualizar a branch, definir:

```sh
cd "$HOME/atrio-qa-app"
export ATRIO_CHAT_QA_BUILD=1
export ATRIO_CHAT_QA_OFFLINE_ONLY=1
export ATRIO_CHAT_QA_WORKER_URL=""
export ATRIO_CHAT_QA_PROJECT="atrio-catolico-qa-geral"
export ATRIO_CHAT_QA_CONFIG_SHA256="$(sha256sum app/src/chatQa/google-services.json | cut -d' ' -f1)"
export ATRIO_CHAT_QA_APP_ID="$(python3 -c 'import json; print(json.load(open("app/src/chatQa/google-services.json"))["client"][0]["client_info"]["mobilesdk_app_id"])')"
python3 scripts/chat_qa_build_gate.py
```

Esse comando NAO compila, instala ou publica APK; somente valida localmente.
A eventual compilacao de laboratorio, quando houver Android SDK e Gradle,
deve usar exclusivamente `gradle :app:assembleChatQa`. A compilacao offline
usa `PUSH_RELAY_URL=""` e nunca URL ficticia, oficial ou de Cloudflare.
Nao autoriza chat, grupos, FCM ou distribuicao do APK.

## 8. Verificação independente da identidade Firebase real (somente leitura)

Uma auditoria adicional foi preparada para ser executada no Termux, com o login
Firebase CLI já existente. A API oficial Firebase Management permite ler
metadados do projeto e do aplicativo Android **sem baixar chaves ou publicar
configurações**. A verificação realiza **somente dois GETs**: projeto QA
`projects/atrio-catolico-qa-geral` e aplicativo Android desse projeto.

Após atualizar a branch QA e concluir o gate local da seção 7, mantenha a
variável `ATRIO_CHAT_QA_APP_ID` com o valor obtido do
`app/src/chatQa/google-services.json` já validado. Execute:

```sh
node scripts/termux-firebase-qa-identity-readonly.mjs
node scripts/termux-firestore-qa-readonly.mjs
```

O primeiro comando verifica que o **projeto e aplicativo registrados no
Firebase real** estão ativos, que o número do projeto corresponde ao Sender ID
da configuração e que o pacote Android é exatamente
`br.com.atriocatolico.chatqa`. O segundo verifica somente as Rules
atualmente publicadas no Firestore QA, que devem continuar em negação total
até aprovação específica. Ambos falham fechados em caso de identidade errada,
permissão insuficiente ou mudança incompatível no Firebase CLI.

**Evidência sanitizada:** somente os relatórios JSON resumidos podem ser
compartilhados após revisão; nunca compartilhar token OAuth, API key,
`google-services.json` integral, JSON de conta de serviço, mensagens ou
tokens FCM. Passar nestas duas leituras **não comprova Auth funcionando,
Firestore gravando, entrega FCM nem isolamento de rede do APK em execução**.
Nada disso autoriza substituir o bootstrap Cloudflare, abrir endpoint,
implantar Rules, fazer merge ou publicar APK Release.

A suíte automatizada testa ambas as auditorias **com respostas simuladas
e sem nenhuma consulta real ao Google**. A checagem na nuvem só é considerada
concluída após relatório obtido da conta QA real pelo operador autorizado.
