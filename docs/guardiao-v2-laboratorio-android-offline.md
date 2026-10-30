# Átrio Guardião LAB — teste seguro no Android físico

Esta é uma demonstração isolada, na branch QA, não o Átrio oficial. O módulo Android guardianlab usa diretamente os arquivos GuardianPreflight.kt e GuardianUiPolicy.kt do app real, copiados temporariamente para a pasta de build. Seu identificador é br.com.atriocatolico.guardianlab, que não substitui br.com.atriocatolico.

## O que o laboratório faz

Permite experimentar no telefone o aviso preventivo com conteúdo fictício, mantendo o rascunho ao escolher Revisar; permite Continuar somente em simulação de memória. Mostra também botões de denúncia, arquivamento, remoção e recurso que são APENAS uma maquete local. Ao reiniciar, os dados somem; não existe autenticação, Firestore ou moderador real.

O app LAB não declara Firebase SDK, Cloudflare SDK ou permissão INTERNET. A CI audita o APK usando aapt e falha se houver permissões de rede, notificações ou armazenamento. Não valida a moderação real 24 horas.

## Instalação usando apenas Android

1. Abrir https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/workflows/guardian-lab-offline.yml
2. Escolher a execução com estado success. Não instalar APK de job pendente ou falho.
3. Baixar o artefato guardian-lab-android-offline, extrair o ZIP e instalar o APK Debug no Android. A instalação é independente e não substitui o Átrio oficial.
4. Abrir o ícone Átrio Guardião LAB (offline), de preferência com internet desligada.
5. Publicar um exemplo legítimo; depois escolher o exemplo de link suspeito, tocar Revisar e conferir que o texto permanece.
6. Tocar Continuar na simulação e explorar denúncia/revisão fictícias. Reiniciar para descartar o estado.
7. Não usar nome, CPF, senha, e-mail ou informações reais, pois não são necessários.

## Critérios

- Workflow e testes unitários concluídos com success.
- Log GUARDIAN_LAB_APK_OFFLINE_PASS presente.
- Celular abre LAB com identificador separado e sem solicitar acesso à rede.
- O rascunho permanece ao selecionar Revisar e nenhum dado real é criado.
- Nenhuma inferência sobre autenticação, Firestore ou autonomia da moderação real.

Regra financeira: não contratar serviços nem adquirir minutos do Actions; se a cota gratuita terminar, parar.
