---
name: Testes do emulador Firestore
description: Requisitos do ambiente local para executar testes de regras do Firestore.
---
O Firebase Emulator exige JDK 21 ou mais recente neste ambiente. O módulo Java disponível instalou GraalVM 19, então foi necessário adicionar o pacote de sistema `jdk21`.

Os testes de regras que chamam `context.firestore()` do `@firebase/rules-unit-testing` 4 falharam com a árvore Firebase 11 instalada, antes de avaliar regras. Os testes novos usam `@firebase/app` e `@firebase/firestore` modulares diretamente com `connectFirestoreEmulator(..., { mockUserToken })`.

**Why:** o workspace pode ter cópias incompatíveis de componentes Firebase; o emulador pode iniciar e ainda assim o adaptador compat falhar antes de acessar as regras.

**How to apply:** ao validar regras, confirme JDK 21 e os pacotes Firebase resolvidos. Se o método compat falhar, use os SDKs modulares consistentes e não trate o erro do harness como falha da regra.
