# TAMÃO V1.256 — comprovantes privados

## Escopo
Um gasto de divulgação já registrado (V1.255) poderá receber um comprovante em PDF, PNG ou JPEG com até 3 MiB. O arquivo fica em bucket privado do Supabase, com um único vínculo imutável por despesa: SHA-256, formato, tamanho, responsável e data.

## Envio seguro
1. Superadmin consulta despesas e documentos no Admin, seleciona um gasto ativo e um arquivo.
2. Backend autentica o usuário, confere elegibilidade no banco e gera uma autorização temporária para um caminho aleatório exclusivo do gasto.
3. Navegador envia os bytes diretamente ao Storage com token assinado, sem receber a chave administrativa.
4. Backend autentica novamente e baixa o objeto para verificar assinatura binária do formato, tamanho e SHA-256.
5. RPC restrita armazena somente metadados e impede substituição silenciosa.

## Consulta
Superadmin e finance podem consultar a lista de metadados; o caminho não é mostrado na listagem. Ao solicitar download, o backend emite URL assinada válida por 60 segundos, com preferência de transferência como arquivo. Não há URL pública permanente.

O comprovante de uma despesa corrigida continua arquivado para auditoria. Esta etapa não fornece confirmação bancária, antivírus abrangente, ROI, saldo disponível, transferência, pagamento de benefício ou ativação de incentivos.

## Limitações
Um arquivo por despesa, sem sobrescrita. É possível corrigir a despesa original e criar um novo lançamento para o arquivo correto. Tokens de envio do Supabase têm validade de até duas horas; uma autorização usada sem finalização pode deixar objetos órfãos privados a limpar futuramente. PDFs devem ser tratados como documentos externos não confiáveis.

## Segurança
Bucket privado com limite de MIME/tamanho. Nenhuma política de Storage concede leitura a anon/authenticated; tabelas de metadados têm RLS e acesso direto revogado. Backend exige sessão administrativa, papéis e valida dados no banco. Nenhuma chave de serviço é entregue ao cliente.

## Implementação
- Migração: supabase/migrations/20261014220000_owner_campaign_private_receipts_v1_256.sql
- Backend: supabase/functions/admin-ops/index.ts
- Interface: js/admin-acquisition.js, js/bootstrap.js
- Auditoria: tests/owner-campaign-private-receipts-v1-256.mjs
