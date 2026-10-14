# TAMÃO V1.268 — Orientações de ativação multibanco

A central V1.267 já mostrava duas vias financeiras segregadas. Nesta evolução, ela ajuda a entender o próximo passo real de cada opção para as revendas, sem transformar capacidades declaradas no catálogo em conexões verificadas.

- Adaptador marcado como implemented (não manual): código disponível, mas conexão, credencial, homologação e transação real continuam sem comprovação só pelo catálogo.
- ready_for_credentials: opção aguardando configuração e homologação. A declaração de suporte a API/webhook não comprova conexão.
- manual_only ou connection_mode=manual: não há confirmação automática bancária nesse modo, ainda que o fluxo interno esteja implementado.
- Evidência real: um pedido com registro de verificação pelo PSP aparece como observação do período, sem extrapolar a conclusão para liquidação bancária.
- Sem tentativas/evidências: mensagem de estado vazio verdadeira, não preenchida com transações demonstrativas.

A seção mostra contagens de estágios não mutuamente exclusivos (não somar) e um roteiro para revendas: escolha do PSP, configuração/homologação, transação legítima e inspeção da evidência. Não altera webhook, credenciais, status financeiro, liberação de benefícios ou repasses. A administração segue superadmin/finance, apenas leitura, com isolamento por conta e competência.

Implementação limitada a js/admin-acquisition.js e teste tests/owner-psp-readiness-v1-268.mjs. Nenhuma alteração de schema nem na Edge Function.
