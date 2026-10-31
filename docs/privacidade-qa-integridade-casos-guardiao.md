# Privacidade — integridade de casos do Guardião (QA)

Continuidade da PR #98. **Somente testes com SQLite e Firestore falso; nenhuma implantação.**

O adaptador de moderação agora exige que caso, trilha de auditoria e notificação referenciem o MESMO `guard_[hex]`. Quarentena opcional também precisa usar o mesmo caso. Os sufixos de revisão e resolução são explícitos. Lotes mistos, IDs repetidos ou campos `caseId` divergentes falham antes do ticket e de qualquer escrita. Quando uma atualização parcial omite o proprietário original, o adaptador consulta o caso/quarentena persistido e compara o UID de origem.

Os testes exercitam lotes malformados, dono de caso divergente, lote válido e bloqueio após freeze, além dos testes existentes que chamam as funções reais de revisão, resolução e varredura do Guardião.

**Limites:** somente `qa-freeze-alice` e `qa-freeze-bob` em infraestrutura fictícia. O Worker ativo não importa esse adaptador, portanto continua existindo risco de bypass. IAM, cron, FCM, retenção legal, versões de Worker implantadas e integração distribuída ainda não estão cobertos. A issue #72 permanece aberta; `main`, produção, backups, assinatura e OTA intocados.
