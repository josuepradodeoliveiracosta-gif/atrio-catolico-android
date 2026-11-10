# Integração OTA com concorrência e recuperação de falhas (QA offline)

**Escopo:** proposta independente, vinculada à melhoria 3/5 do fluxo GitHub.
Nenhuma alteração no código de produção, distribuição de APK ou assinatura.

O servidor existente `ota_qa_loopback_server.py` é testado via HTTP real,
mas **somente em 127.0.0.1 e porta efêmera**, sem acesso a GitHub,
Firebase, Cloudflare, usuário real ou dispositivos físicos.

Cobertura adicional:

1. Cinco clientes simultâneos consultam a API `/releases/latest` com
   modo `api-unavailable-once`: exatamente um recebe **HTTP 503**,
   quatro recebem o manifesto correto e chamadas seguintes recuperam.
2. Cinco clientes simultâneos baixam o mesmo APK sintético com
   `truncated-once`: exatamente uma transferência é truncada,
   quatro correspondem byte a byte ao SHA-256 do manifesto e uma
   repetição entrega o arquivo íntegro, sem alterar o manifesto.

Esses dois testes exercitam o mesmo `ThreadingHTTPServer`, locks e
handlers que alimentam o laboratório OTA Android; não são um mock
isolado da lógica. A suíte já é executada no workflow
`ota-in-app-qa.yml`, cujo filtro de arquivos inclui o teste editado.

**Limitações:** verificam robustez do servidor local e contrato HTTP;
não provam automaticamente recuperação da interface Android sob
concorrência e não equivalem à instalação física de uma atualização.
Nenhum serviço remoto, backup ou código da `main` é modificado.
