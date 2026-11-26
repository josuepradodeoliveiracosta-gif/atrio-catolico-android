# Marco 4 — painel administrativo local

A central consolida até 30 snapshots JSON fornecidos explicitamente pelo operador,
sem servidor, banco, credencial, rede ou publicação em GitHub Pages. O painel
HTML é gerado exclusivamente em diretório POSIX privado 0700, pertencente ao
usuário executor, com arquivo novo 0600, sem sobrescrita ou seguimento de
symlink no destino. O controle de acesso depende da conta local do sistema
operacional e do diretório privado; não equivale a RBAC remoto. Não compartilhar
o HTML ou os snapshots, nem colocar em diretórios sincronizados ou públicos.

## Uso
Em terminal privado com Python 3, na raiz do repositório:
```sh
umask 077
mkdir -m 700 "$HOME/atrio-diagnostico-privado"
python3 -m scripts.diagnostic_admin_dashboard \
  --snapshot /caminho/central-qa.json \
  --private-dir "$HOME/atrio-diagnostico-privado"
```
Abrir diagnostics.html localmente, sem publicar ou enviar. Usar um novo
diretório privado para outra geração. Pode repetir --snapshot até 30 vezes.
Nenhum arquivo é sobrescrito. O painel não apaga arquivos de entrada.

## Indicadores
CI por SHA, contagens de estados, inventário por ambiente/componente,
gravidade de triagem, metadados QA separados e histórico de sinais para
revisão. O HTML não possui JavaScript, links externos, formulários ou
carregamento remoto. Estrutura semântica, texto explícito e contraste
claro/escuro; acessibilidade em navegador ainda requer teste.

O histórico é uma visão derivada dos arquivos fornecidos, não um banco de
incidentes confirmados. Repetições não comprovam novos incidentes, nem ausência
de observação comprova resolução. O painel reavalia expiração de 24h, rejeita
snapshots futuros/duplicados, campos adicionais e tentativas de marcar saúde
global ou correção como comprovadas. A última data não equivale ao HEAD atual.
Os arquivos importados não são autenticados ou assinados; a interface não
promove metadados a saúde operacional.

## Limites
O painel não importa automaticamente os dados Android, não é acessível a
usuários do app, não cria papéis no Firebase e não altera regras de segurança.
Um painel web multioperador com RBAC de servidor, retenção, trilha de auditoria
e histórico persistente exige arquitetura e homologação separadas.
Sem deploy, merge ou acesso a dados reais.

## Validação
python3 -m unittest scripts.test_diagnostic_admin_dashboard -v
Teste manual em navegador local, inclusive leitor de tela e fonte ampliada.
O marco anterior teve gate Android/Firestore e CodeQL aprovados, mas a suíte
QA Android dos três bots apresentou HTTP 429 no download Gradle (run
45909253820, job 140213370252); não é aprovação de todos os checks.
