---
'@dudousxd/nestjs-resilience': patch
---

Adiciona `license`, `description` e `author` ao package.json.

O pacote estava publicado sem campo `license`, o que legalmente significa
"todos os direitos reservados" e não MIT — ausência de licença é o oposto de
permissivo. Isso trava due diligence jurídica de qualquer empresa avaliando o
ecossistema, e era o único pacote do monorepo sem os campos: os seis
adapters irmãos já declaravam MIT.
