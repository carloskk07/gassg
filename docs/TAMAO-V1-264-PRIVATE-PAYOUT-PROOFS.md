# TAMÃO V1.264 — Comprovantes privados de repasses declarados

## Entrega
A V1.263 criou um livro de **declarações do fundador** de repasses de comissões já maduras. A V1.264 passa a vincular um **arquivo real** à declaração, no armazenamento privado Supabase, com hash SHA-256 calculado a partir dos bytes e validado no servidor. Não são dados bancários independentes: comprovante recebido de alguém e integridade do arquivo são coisas distintas de liquidação confirmada pelo PSP.

## Fluxo no Admin
1. Acesse Aquisição → Financiamento e crescimento → Comprovantes declarados de repasses externos.
2. Consulte o mês em V1.263, depois clique **Consultar comprovantes da competência** na nova seção.
3. Em uma declaração ativa e elegível, o superadmin escolhe PDF, PNG ou JPEG até 3 MB e clica **Anexar comprovante**.
4. O backend consulta a elegibilidade por \`claim_id\`, devolve **token de upload temporário** vinculado a um caminho \`claim_id/uuid.ext\`; navegador envia diretamente ao bucket privado.
5. O backend **baixa os bytes armazenados**, valida tamanho, assinatura do formato PDF/PNG/JPEG e SHA-256 informado pelo navegador, confronta com um SHA previamente declarado na V1.263 (quando existir) e só então grava metadados transacionalmente.
6. Para o superadmin e o perfil financeiro, **Reverificar integridade** rebaixa o arquivo e compara bytes, tamanho e SHA-256 armazenados. **Consultar arquivo privado** realiza essa mesma validação antes de emitir uma URL de leitura temporária (60 segundos).

### Conservação documental
- Cada declaração admite um arquivo vinculado; reenvio idêntico é idempotente, outro caminho é rejeitado. A referência original do repasse não é editada.
- Declarações retificadas não aceitam novos anexos, mas documentos previamente vinculados continuam consultáveis para auditoria. Não existe exclusão automática de provas.
- Upload realizado sem finalização pode deixar um objeto não vinculado. Um futuro inventário de órfãos deve aplicar quarentena e revisão do fundador antes de remoção.
- O arquivo é privado, sem URL permanente ou política de leitura direta para usuários. A autenticação e autorização ocorrem na Edge \`admin-ops\`; a chave de serviço não sai no navegador.
- Não habilitar acesso público aos buckets ou criar política permissiva no \`storage.objects\`.

## Segurança de banco
Migração \`supabase/migrations/20261014235930_owner_payout_private_proofs_v1_264.sql\`:
- Bucket separado \`tamao-owner-referral-payout-proofs-v1-264\`, \`public=false\`, até 3 MiB e lista de MIME reduzida.
- Tabela \`public.platform_referral_payout_proofs_v1_264\` com RLS habilitado, sem acesso direto aos papéis de frontend nem serviço.
- RPCs: \`admin_owner_payout_proof_eligible_v1_264\` (superadmin), \`admin_owner_payout_proof_attach_v1_264\` (superadmin), \`admin_owner_payout_proof_path_v1_264\` e \`admin_owner_payout_proofs_read_v1_264\` (superadmin ou financeiro). Wrapper SQL permite apenas \`service_role\`.
- O banco bloqueia anexo em declaração retificada ou com comissão agora inelegível; o SHA legado precisa coincidir. O Storage precisa confirmar a existência do objeto.
- O relatório da competência inclui totais e até 30 declarações com ou sem anexo, metadados do arquivo e alerta de lacunas. O campo \`verifiedBytesAtUpload\` descreve a verificação na finalização, não a revalidação atual ou confirmação de banco.

## Segurança de conteúdo
No backend:
- PDF: primeiros bytes \`%PDF-\`.
- PNG: assinatura de oito bytes.
- JPEG: início \`FF D8 FF\`.
- Hash SHA-256 da leitura efetiva do Storage, comparado com hash do arquivo selecionado, e recalculado para cada visualização ou verificação.
- Link temporário só criado após checagem de integridade; caminho validado por claim UUID e extensão permitida.
- Nenhum endpoint recebe credenciais bancárias, realiza Pix, retificação financeira, estorno, saque ou alteração de carteira.

## Limitações explícitas
- Verificar a integridade do arquivo apenas prova que **os bytes ainda são iguais** aos anexados. Um comprovante pode ser falso, cancelado, forjado, pertencer a outra transferência ou não refletir o destinatário real.
- Não há conectores oficiais de extrato/PSP vinculados à identidade do beneficiário nesta etapa. **Não elevar** \`bankVerified\` ou \`providerConfirmed\`: permanecem \`false\`; valor pago externo comprovado permanece \`null\`.
- SHA-256 não é antivírus nem verificação avançada de arquivos; o download pode exigir cuidado com PDFs potencialmente maliciosos.
- A ausência de repasses reais impede simular evidências de terceiros em produção. A migração, ACL, consulta vazia e testes de contratos são verificáveis, mas ainda é necessária a primeira operação real autorizada para validação ponta a ponta.

## Próxima evolução
Criar conciliação opcional por comprovantes oficiais/PSP com transferência, status, valor, identificador do destinatário e sinais de liquidação assinados ou lidos diretamente do provedor. Não misturar pagamentos de clientes a revendas com benefícios pagos pelo TAMÃO. A maior prioridade é eliminar falsas alegações de desembolso.
