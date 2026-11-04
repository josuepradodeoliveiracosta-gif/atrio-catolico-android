# Abertura em tela cheia — vídeo de inicialização

**Estado atual:** abertura fullscreen integrada à `main` pela PR #116; vídeo substituído pela PR #118 e áudio ativado pela PR #119. Alteração posterior exige exibição completa a cada nova abertura e remove os atalhos de pulo. Integração de código não equivale a APK assinado ou instalado.

## Comportamento previsto

- `MainActivity` exibe `AtrioStartupVideo` antes da autenticação ou da demonstração em **toda nova instância** do aplicativo, inclusive após processo encerrado e restaurado. Um `ViewModel` não persistido mantém a conclusão em alterações de configuração e retornos do segundo plano na mesma instância, mas é renovado após fechar e abrir o app.
- A apresentação ocupa a área toda, esconde temporariamente as barras de sistema e **preserva a proporção do vídeo** (sem cortar conteúdo). Em telas com outra proporção podem existir faixas na cor do fundo.
- Reproduz **uma vez, até o final, com o áudio embutido no vídeo**, respeitando o volume de mídia do Android (não altera o ajuste do sistema). Não há botão de **Pular**. A tecla **Voltar** encerra a Activity, sem abrir o login ou a comunidade; na próxima abertura o vídeo recomeça. Apenas erro de mídia ou tempo de segurança de 15 segundos de atividade retomada pode liberar a navegação para impedir travamento permanente.
- Ao finalizar, restaura as barras de sistema e abre o fluxo já existente, sem mexer em autenticação, navegação, Firestore, avisos, Workers ou segurança.
- A antiga chamada após autenticação fica temporariamente com função de compatibilidade inerte; não há segundo vídeo após login.

## Histórico da primeira mídia (PR #116)

| Dado | Valor |
| --- | --- |
| Destino no repositório | `app/src/main/res/raw/abertura_atrio.mp4` |
| Formato | MP4, H.264 + AAC |
| Resolução | 1080 × 1920 (9:16) |
| Duração | 10,026 s |
| Tamanho | 2.876.778 bytes |
| SHA-256 | `000ec24458026080c20e1f7f56441e9288a44b153176338797e1a316608d75f5` |
| Git blob SHA-1 calculado | `3d8fe939b612492014b35b2f5e727d4d128900c4` |
| Blob MP4 previamente presente na `main` | `005e8dbc2d9ddc25a11588891b2669ec756e3607` (3.378.959 bytes), **não é o arquivo enviado** |

**Integridade confirmada na PR #116:** o blob da branch para `app/src/main/res/raw/abertura_atrio.mp4` agora é `3d8fe939b612492014b35b2f5e727d4d128900c4` — idêntico ao SHA-1 calculado do arquivo enviado. O código usa `R.raw.abertura_atrio`; reprodução offline, sem hospedagem remota e sem introduzir dependência nova.


## Mídia atual e alteração de áudio

- Vídeo atual `1000088162.mp4`, recompactado para o APK em `app/src/main/res/raw/abertura_atrio.mp4` na PR #118.
- Resolução 1080 × 1920, duração 10,054 segundos, H.264/AAC, 2.306.457 bytes; SHA-256 da mídia otimizada `75522c6bf7a8c6e7e0052964a450068e6febc0c8963412d610e0699e76dea22d`.
- O código da abertura altera apenas a regulagem de volume `MediaPlayer.setVolume(0f, 0f)` para `setVolume(1f, 1f)`; o volume de mídia efetivo continua controlado pelo Android e pelo usuário.
- Sem alterações no vídeo, Firebase, Cloudflare, assinatura, versionCode, backup ou publicação.

## Homologação da abertura e do áudio

- [x] MP4 otimizado da PR #118 preservado (SHA-256 informado na seção da mídia atual); não foi alterado nesta PR.
- [ ] Compilação Android de testes e verificações de segurança/versão/Firestore aprovadas no **head atualizado** (conferir após último commit documental).
- [ ] Em aparelho Android: iniciar sem internet, com volume de mídia audível, e conferir o vídeo completo (~10 segundos), com trilha sonora sincronizada e nenhuma tela de login à frente.
- [ ] Conferir ausência de som com volume de mídia no mínimo, controle de volume durante o vídeo e interrupção da trilha ao encerrar o aplicativo com Voltar.
- [ ] Confirmar que não existe controle **Pular** nem gesto que avance ao login/comunidade antes do término natural do vídeo.
- [ ] Durante o vídeo, pressionar **Voltar**: sair do aplicativo, não entrar na comunidade. Abrir novamente: assistir à abertura desde o início.
- [ ] Fechar por Voltar ou remover a tarefa dos Recentes e abrir pelo ícone: reproduzir novamente em ambas as situações.
- [ ] Forçar parada ou matar o processo após ter assistido ao vídeo e abrir novamente, inclusive com estado de Activity restaurado: exibir a abertura outra vez.
- [ ] Enviar o app ao segundo plano e voltar: não reiniciar.
- [ ] Após login/logoff, conferir que não aparece uma segunda abertura.
- [ ] Testar orientação diferente, texto ampliado, leitor de tela e erro/corrupção do arquivo com fallback.
- [ ] Testar modo demonstrativo e modo autenticado. CI aprovada não prova teste em aparelho.
- [ ] Após checks obrigatórios aprovados e revisão, integrar a PR que torna a abertura obrigatória; distribuição oficial assinada fica em fluxo separado e autorizado.

**Não executado por esta tarefa:** publicação, geração de release, mudança de versão/assinatura, modificação de backend, backup, cron, regras Firebase ou Workers.
