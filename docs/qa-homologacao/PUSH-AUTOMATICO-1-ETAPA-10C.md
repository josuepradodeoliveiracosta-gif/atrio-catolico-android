# Marco 10C — diagnóstico IAM inconclusivo

Evidência enviada pelo titular: dez consultas Policy Troubleshooter v3beta retornaram PERMISSION_DENIED e access UNKNOWN. Não há avaliação efetiva do principal; a recusa é da consulta diagnóstica, não prova de que a conta do Worker tenha ou não os acessos examinados. A causa específica do erro não foi apurada, pois a saída filtrada não inclui detalhes.

Alternativa somente leitura: console Policy Troubleshooter, conta administrativa já autorizada, modo Manual, principal atrio-qa-general-push@atrio-catolico-qa-general.iam.gserviceaccount.com, recurso //firestore.googleapis.com/projects/atrio-catolico-qa-general/databases/(default), iniciar por datastore.entities.create. Esperado acesso negado. Depois de obter evidência válida, completar matriz 10B, verificar políticas herdadas, grupos, deny/PAB, outros projetos e vínculo do secret. Se o console também falhar, solicitar revisão por administrador já autorizado, sem conceder privilégios ao Worker ou habilitar serviços para contornar a restrição. Não repetir consultas que falharam com a mesma identidade.

Referência: https://docs.cloud.google.com/policy-intelligence/docs/troubleshoot-access

GO laboratório 246 testes; NO-GO ativação hospedada. Cotas observadas no marco 10B, Firebase billing false, métricas devem ser revalidadas antes de ensaio. Nenhum deploy, cron, IAM, SQL remoto, faturamento ou novo disparo deliberado de workflow.
