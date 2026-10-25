# E-mails transacionais TAMÃO — modelos de autenticação
Última revisão: 25/10/2026

**Escopo:** modelos oficiais do Supabase Auth existente + SMTP SendPulse existente. NÃO contratar serviço, gerar nova credencial, alterar autenticação, habilitar notificações ou enviar marketing por estes modelos.

**IMPORTANTE — estado real:** GitHub armazena o conteúdo revisado e os testes. O projeto Supabase hospedado **NÃO sincroniza automaticamente** os modelos HTML do repositório. A atualização só está aplicada a usuários depois de salvar o assunto e o HTML na seção **Authentication → Emails → Templates** do dashboard. A ferramenta conectada atualmente permite apenas consultar a página (e a conexão Opera pode ficar indisponível), não editar/salvar as configurações Auth. Não afirmar deploy ou envio de e-mail com esse conteúdo antes de conferir assunto e modelo na página hospedada e um e-mail de prova.

## Aplicação na infraestrutura existente

1. Abra [Authentication → Emails → Templates](https://supabase.com/dashboard/project/lgugwujpunhslavewffd/auth/templates), **não** SendPulse: este último é o transportador SMTP, enquanto o Supabase Auth monta o assunto e o conteúdo.
2. Abra a categoria correspondente ao `slug` em `manifest.json`. Copie o `subject` e o conteúdo HTML do respectivo arquivo; clique **Save changes**. Faça isso somente para os modelos já existentes; as notificações de segurança desligadas continuam desligadas.
3. Verifique que todas as variáveis `{{ .ConfirmationURL }}`, `{{ .Token }}`, `{{ .NewEmail }}`, `{{ .OldEmail }}`, `{{ .Provider }}` e `{{ .FactorType }}` usadas no respectivo modelo continuam intactas. Nunca substitua os tokens por URLs fixas nem envie códigos estáticos.
4. Envie **somente um** link para conta autorizada no `admin.tamao.com.br`, confirme o **assunto real** em português, o remetente `contato@tamao.com.br`, o botão funcional, validade/consumo único, as restrições de acesso e o registro de envio do SendPulse. Não automatizar envios reais de teste sem consentimento.
5. Mantenha o modelo de link com **um único botão e sem tracking**. A SendPulse não deve substituir URLs de confirmação por redirecionadores; verifique configuração de rastreamento ao homologar.

**Cuidado de segurança:** notificações não dão links de login. O código de reautenticação usa `{{ .Token }}` e nunca uma URL fictícia; o alerta de e-mail alterado usa `{{ .OldEmail }}`, o de alteração de e-mail usa `{{ .NewEmail }}`. Nenhum novo método de autenticação ou tipo de e-mail foi criado.

Documentação: https://supabase.com/docs/guides/auth/auth-email-templates

## Inventário da mesma instalação

| Modelo existente no Supabase | Assunto proposto | Arquivo |
|---|---|---|
| magic-link-or-otp | TAMÃO | Seu link de acesso | [magic-link-or-otp.html](./magic-link-or-otp.html) |
| confirm-sign-up | TAMÃO | Confirme seu cadastro | [confirm-sign-up.html](./confirm-sign-up.html) |
| invite-user | TAMÃO | Você recebeu um convite | [invite-user.html](./invite-user.html) |
| reset-password | TAMÃO | Redefina sua senha | [reset-password.html](./reset-password.html) |
| change-email-address | TAMÃO | Confirme a troca de e-mail | [change-email-address.html](./change-email-address.html) |
| reauthentication | TAMÃO | Código de verificação | [reauthentication.html](./reauthentication.html) |
| password-changed | TAMÃO | Sua senha foi alterada | [password-changed.html](./password-changed.html) |
| email-address-changed | TAMÃO | Seu e-mail foi alterado | [email-address-changed.html](./email-address-changed.html) |
| phone-number-changed | TAMÃO | Seu telefone foi alterado | [phone-number-changed.html](./phone-number-changed.html) |
| sign-in-method-linked | TAMÃO | Novo método de acesso vinculado | [sign-in-method-linked.html](./sign-in-method-linked.html) |
| sign-in-method-removed | TAMÃO | Método de acesso removido | [sign-in-method-removed.html](./sign-in-method-removed.html) |
| mfa-method-added | TAMÃO | Verificação de segurança ativada | [mfa-method-added.html](./mfa-method-added.html) |
| mfa-method-removed | TAMÃO | Verificação de segurança removida | [mfa-method-removed.html](./mfa-method-removed.html) |

**Regra de conclusão operacional:** `HTML validado no GitHub` ≠ `Template salvo no Supabase` ≠ `E-mail recebido`. Registrar cada prova separadamente no `docs/TAMAO_EXECUCAO.md`.
