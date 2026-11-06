# Auditoria do canal oficial GitHub Releases HTTPS — sem publicação

**Estado em 06/11/2026:** a API pública `https://api.github.com/repos/josuepradodeoliveiracosta-gif/atrio-catolico-android/releases/latest` respondeu HTTP `404` e `/releases?per_page=5` retornou a lista vazia `[]`. Isso é normal enquanto nenhum Release público existe, e o cliente deve mostrar "sem versão publicada" em vez de tentar instalar alguma coisa.

O teste histórico em aparelho físico comprovou OTA **pelo servidor local em Termux**, com A `0.20.1/code36` e B `0.20.2/code37`, assinatura permanente, dados e sessão preservados. Esse resultado é **distinto** da entrega via CDN GitHub Releases.

## Verificação atual sem risco de divulgação

O módulo `scripts/ota_official_https_probe.py` é deliberadamente **somente leitura**.

- Executa `GET` exclusivamente nos dois endpoints públicos e fixos de `api.github.com`.
- Exige HTTPS com certificados TLS validados pelo sistema, sem token, redirecionamentos ou URLs fornecidas por terceiros.
- Espera `404` de `releases/latest` e uma lista vazia `[]` de `releases`. Uma resposta `403`, `5xx`, um redirecionamento, uma Release existente ou uma resposta ilegível **não** é declarada sucesso.
- Limita respostas JSON a 256 KiB e não acessa os assets de Release, não grava arquivos, não executa Gradle, não instala APKs e não altera variáveis/gates.
- Testa offline um **exemplo hipotético** de resposta GitHub Releases e manifesto `update.json`: três assets com nomes únicos e URLs exatas do repositório, pacote `br.com.atriocatolico`, versão crescente, hash SHA-256 válido, certificado público permanente, HTTPS obrigatório, Release estável não forçada e limites de tamanho. Exemplos adulterados, URL externa, certificado diferente e downgrade devem falhar.

No repositório, um workflow manual, `.github/workflows/ota-official-https-readonly.yml`, permite ao titular repetir a consulta quando desejar. A execução desse workflow também é exclusivamente leitura e **não publica nenhuma Release**.

Executável a partir da raiz do repositório:

```sh
python3 -m unittest discover -s scripts -p 'test_ota_official_https_probe.py' -v
python3 -m scripts.ota_official_https_probe --check-empty
```

## O que o teste comprova — e o que não comprova

| Pergunta | Evidência |
| --- | --- |
| API oficial do repositório acessível com TLS? | A consulta com HTTPS retornou resposta GitHub; ver o status do workflow manual quando executado |
| Há Release pública agora? | Não, listagem vazia e `latest` 404 no dia da auditoria |
| Contrato hipotético de metadados rejeita dados perigosos? | Testes de unidade sem efeitos externos |
| Aplicativo em produção consegue baixar o APK via GitHub CDN? | **Não comprovado** |
| Certificado do APK oferecido pelo GitHub corresponde aos bytes reais? | **Não comprovado por este teste** |
| O instalador Android confirma update vindo da URL oficial? | **Não comprovado por este teste** |
| A atualização real A→B pelo Termux preservou sessão/dados? | **Sim**, homologada separadamente pelo titular |

**Limite fundamental:** nenhuma Release pública está disponível. Não é possível fazer um download real por `https://github.com/.../releases/download/...` sem publicar uma Release acessível (ou definir um procedimento de distribuição aprovada separado). Criar um Release público só para simular homologação violaria a decisão de não divulgar antes do aceite. Não confundir o teste de metadados simulado com E2E de CDN real.

## Próxima aprovação

A issue [#149](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/149) deve continuar aberta. A revisão dos resultados dos testes negativos já automatizados e da política de instalação pode prosseguir sem republicar APKs. Qualquer disponibilização pública exige **autorização nova e expressa** para distribuição e verificação dos demais gates existentes. Não modificar `ATRIO_OTA_E2E_TESTED` nem `ATRIO_OTA_RELEASE_APPROVED`, a chave permanente, o backup ou os serviços de produção durante essa auditoria.
