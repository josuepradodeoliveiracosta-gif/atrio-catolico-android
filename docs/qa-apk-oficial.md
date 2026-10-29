# Executor manual do APK oficial — preparação

## Estado comprovado

O executor foi implementado e possui testes locais de suas proteções. **Ainda não
foi executado contra um APK de produção.** A aprovação dos testes locais não
comprova que os seletores de acessibilidade funcionarão em todos os APKs antigos.
Os 13 testes Android anteriores continuam sendo evidência do laboratório Firebase
emulado, não desta sessão oficial.

Não é preciso recompilar, tornar o release depurável ou trocar sua assinatura.
O workflow instala um APK já existente do artefato
`atrio-catolico-release-assinado`, gerado por `build-apk.yml`. Verifica o run de
origem, SHA-256 do APK, certificado permanente, pacote `br.com.atriocatolico`,
`debuggable=false` e projeto Firebase `atrio-catolico` extraído dos recursos do APK.
Registra versão e commit de origem. Um APK assinado de uma PR continua sendo um
candidato de homologação, não uma versão integrada à main.

## Escopo de uma sessão

1. Conferir os logins dos UIDs fixos `qa_clara_v19`, `qa_miguel_v19` e `qa_lucia_v19`.
2. Clara entra pela tela do APK, publica **uma** discussão identificada como
   simulação e sai pelo botão do perfil.
3. Miguel e Lúcia entram, localizam somente o título exclusivo da sessão,
   respondem **uma vez cada** e saem pela interface.
4. Clara entra novamente e abre a central de notificações. Consultas de leitura
   do Firestore confirmam autoria, texto das respostas e dois avisos internos.

O Python não grava posts/respostas pelo backend. Os tokens usados nas consultas
são dos próprios bots, sujeitos às regras normais, sem conta administrativa no CI.
O APK pode executar seus efeitos normais (registro de token, avisos e chamadas ao
Guardião). Não há promessa de entrega FCM, teste de instalação sobre versão antiga,
marcação dos avisos como lidos nem validação visual do texto de cada aviso.

Há dois modos manuais:

- `preflight` (padrão): valida o APK e os três logins, sem abrir a interface nem
  publicar conteúdo. O login REST pode atualizar metadados de acesso do Auth.
- `session`: faz as verificações e executa os toques acima em Android virtual
  conectado ao Firebase oficial.

Não há disparo por push, PR, cron ou término de outro workflow. `session_id` é
obrigatório; a presença de uma discussão com esse título impede reutilização.
Execuções são serializadas. **Re-run jobs é recusado**; não há retentativa do
clique de envio. Em falha parcial, conservar o ID de sessão/post no relatório e
investigar antes de autorizar outra sessão. Não há limpeza automática de conteúdo
ou contas em produção. Esses controles não são um mecanismo de exatamente-uma-vez
contra operadores externos que deliberadamente criem sessões diferentes.

## Configurar os logins, preservando os bots

Os bots atuais usam custom tokens no Worker. Para o formulário de e-mail/senha do
APK, vincular esse provedor **aos mesmos UIDs**, sem criar três contas substitutas.

Em um ambiente privado com Python e Application Default Credentials de um
operador autorizado do projeto `atrio-catolico` (por exemplo, Cloud Shell), preparar
um arquivo `bots-private.json` com e-mails dedicados que você controla e senhas
fortes de 16 a 128 caracteres. O formato é:

```json
{
  "clara": {"email": "EMAIL_DEDICADO_CLARA", "password": "SENHA_FORTE_CLARA"},
  "miguel": {"email": "EMAIL_DEDICADO_MIGUEL", "password": "SENHA_FORTE_MIGUEL"},
  "lucia": {"email": "EMAIL_DEDICADO_LUCIA", "password": "SENHA_FORTE_LUCIA"}
}
```

Os valores acima são marcadores, não credenciais válidas. Usar um arquivo fora
do checkout, com permissão `600`; não colocá-lo em commits ou anexá-lo ao chat.
O provedor E-mail/senha deve estar habilitado no Firebase Authentication.

Com o código desta PR disponível nesse ambiente:

```sh
python3 -m pip install firebase-admin==7.7.0
chmod 600 /CAMINHO/PRIVADO/bots-private.json
python3 scripts/qa_official/link_logins.py /CAMINHO/PRIVADO/bots-private.json
python3 scripts/qa_official/link_logins.py /CAMINHO/PRIVADO/bots-private.json --apply
```

O primeiro comando do script só verifica. `--apply` altera apenas e-mail/senha dos
três UIDs já existentes; não muda claims, selos, papéis ou perfis Firestore. Recusa
contas desativadas, e-mail diferente já vinculado ou e-mail pertencente a outro UID.
As três alterações não são transacionais: se uma falhar, algumas anteriores podem
ter concluído. Usar o mesmo arquivo para conferir o estado e concluir; não gerar
outras senhas silenciosamente. Não conceder papéis IAM amplos só para contornar
uma falha; a operação exige permissão para gerenciar esses usuários no Firebase.

## Configurar GitHub e escolher o APK

No repositório, em **Settings → Secrets and variables → Actions**:

- Secret `ATRIO_QA_BOTS_JSON`: conteúdo do arquivo privado acima.
- Variable `ATRIO_RELEASE_CERT_SHA256`: fingerprint SHA-256 público do certificado
  permanente conhecido, obtido do APK assinado confiável ou do keystore. Não é a
  senha da chave nem o hash do arquivo APK. Aceita com ou sem `:`.

Não adicionar chave administrativa Firebase a esse workflow. Ele usa a API key
pública extraída do próprio APK e os logins limitados dos três bots.

Na execução aprovada de **Gerar APK do Atrio Catolico**, selecionar o artefato
`atrio-catolico-release-assinado`. Anotar o número no endereço `/actions/runs/ID`.
Baixar e extrair o arquivo; calcular o hash do **APK**, não do ZIP:

```sh
sha256sum app-release.apk
# Se tiver Android build-tools disponíveis:
apksigner verify --print-certs app-release.apk
```

O certificado esperado deve vir da assinatura permanente já conhecida; não copiar
automaticamente o certificado de um APK de origem desconhecida para aceitá-lo.

## Disponibilização e execução

O arquivo `.github/workflows/qa-official-apk.yml` precisa existir na branch padrão
para o GitHub disponibilizar `workflow_dispatch`. Enquanto estiver apenas na
PR #15, **o botão Run workflow pode não estar disponível**. Esta implementação
não mescla a PR nem publica a 0.19.0; a disponibilização do workflow é uma etapa
separada da execução. Pode ser integrada isoladamente após revisão, preservando
os demais trabalhos da PR em homologação.

Depois de disponível: **Actions → QA manual do APK oficial (producao) → Run workflow**.
Escolher uma revisão revisada do executor e informar:

- `mode`: `preflight` para conferir ou `session` para a sessão autorizada.
- `apk_run_id`: execução de origem do release escolhido.
- `apk_sha256`: SHA-256 exato do APK extraído.
- `session_id`: identificador novo para a sessão, por exemplo `qa_apk_20261027_01`.

O mesmo ID pode ser usado no preflight e depois na sessão, pois o preflight não
publica. Cada nova sessão em produção continua dependendo de solicitação do
fundador; deixar o workflow disponível não autoriza execuções espontâneas.

## Evidências e limitações

O artefato `qa-official-evidence-RUN_ID` contém `apk.json`, `preflight.json` e,
quando iniciado o cenário, `session.json`. Só considerar sucesso real quando o
workflow finalizar com sucesso **e** `session.json.status` for `passed`.
`preflight_passed_no_ui_session` não significa teste do aplicativo aprovado.

Não são enviados screenshots, hierarquias de interface, logcat, e-mails, senhas
ou tokens. O relatório contém etapa, checks, hashes e ID da discussão de teste.
Uma falha de interface registra a etapa, sem despejar conteúdo da comunidade.
Um pop-up, seletor incompatível ou tela inesperada interrompe o teste; o executor
não tenta cliques aleatórios nem troca a ação por uma escrita administrativa.
O laboratório usa as cotas existentes do GitHub/Firebase; não muda planos nem
contrata Test Lab ou outro serviço pago.

## Validação sem produção

```sh
python3 -m unittest discover -s tests/qa_official -v
bash -n scripts/qa_official/run-device.sh
```

`qa-official-checks.yml` roda esses testes isolados nas PRs sem secrets e sem
conexões ao Firebase. A primeira sessão real continua pendente da configuração,
da disponibilização manual do workflow e da execução no APK escolhido.

Referências: [UIAutomator2](https://github.com/openatx/uiautomator2),
[APK Analyzer](https://developer.android.com/tools/apkanalyzer),
[Firebase Auth Admin](https://firebase.google.com/docs/auth/admin/manage-users),
[GitHub: workflows manuais](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
